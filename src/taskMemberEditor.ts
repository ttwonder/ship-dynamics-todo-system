import { getSupabaseClient, type ResolvedSupabaseConfig } from './cloud';
import type { TaskItem, TaskVesselProgress } from './types';
import { taskProgressForVessel } from './taskVesselProgress';
import { NormalizedDurableStateStore } from './normalizedRepository';

export type MemberContext = {ok:true;protocol:string;section_key:string;task:TaskItem;progress:TaskVesselProgress;expected:{structure:string;member:string;source:{collection:string;id:string;version:number}[]};actor_guard:unknown;closure:{vesselId:string;isClosed:boolean}[];revision:number};
type Lease={section_key:string;locked_by:string;lease_version:string;expires_at:string};
type Pending={params:Record<string,unknown>;draft:string};
type MemberDraft={progress:TaskVesselProgress;baseline:TaskVesselProgress;expected:MemberContext['expected'];quickStatus:string};
export type MemberConfirmation={operationId:string;vesselId:string;submitted:TaskVesselProgress;progress:TaskVesselProgress};
const clone=<T,>(x:T):T=>JSON.parse(JSON.stringify(x));
export const memberPendingKey=(config:ResolvedSupabaseConfig,actor:string,task:string,vessel:string)=>'ship-dynamics-member-pending-v1:'+JSON.stringify([config.supabaseUrl,config.workspaceKey,actor,task,vessel]);

/** One original editor. Member CAS, lease generation and publish revision never alias. */
export class TaskMemberEditor {
  readonly contexts=new Map<string,MemberContext>();
  scope=''; task:TaskItem|null=null; writable=false; message='';
  confirmation:MemberConfirmation|undefined;
  private lease:Lease|null=null;
  private generation=0;
  private timer:ReturnType<typeof setInterval>|null=null;
  private busy=false;
  private parentLeases:Lease[]=[];
  private disposed=false;
  private frozen=false;
  private drafts=new NormalizedDurableStateStore();
  quickStatus='';
  private workspace(){return JSON.stringify([this.config.supabaseUrl,this.config.workspaceKey]);}
  private draftEntity(vesselId:string){return 'task-member-v1:'+JSON.stringify([this.taskId,vesselId]);}
  private localDraft(vesselId:string){return this.drafts.load<MemberDraft>(this.workspace(),this.actorId,this.draftEntity(vesselId))?.draft;}
  private pending(vesselId:string):Pending|null{
    const raw=localStorage.getItem(memberPendingKey(this.config,this.actorId,this.taskId,vesselId));
    if(!raw)return null;
    const pending=JSON.parse(raw) as Pending,p=pending?.params;
    if(!p||p.p_workspace_key!==this.config.workspaceKey||p.p_actor_user_id!==this.actorId||p.p_task_id!==this.taskId||p.p_vessel_id!==vesselId||typeof p.p_operation_id!=='string'||typeof pending.draft!=='string'||JSON.parse(pending.draft)?.vesselId!==vesselId)throw new Error('pending-member-scope-mismatch');
    return pending;
  }
  hasUnconfirmedDraft(){
    if(this.disposed||!this.identityIsCurrent())return false;
    const content=(p:TaskVesselProgress)=>JSON.stringify([p.status,p.isClosed,p.closedDate||'',p.statusLogs]);
    for(const scope of this.contexts.keys()){
      try{const draft=this.localDraft(scope);if(this.pending(scope)||draft&&(draft.quickStatus||content(draft.progress)!==content(draft.baseline)))return true;}
      catch{return true;}
    }
    return false;
  }
  captureDraft(candidate:TaskItem,vesselId:string,quickStatus:string){
    if(!this.current()||candidate.id!==this.taskId||this.scope!==vesselId||vesselId==='overall')return;
    const ctx=this.contexts.get(vesselId);if(!ctx)return;
    const progress=taskProgressForVessel(candidate,vesselId);
    // Do not persist a not-yet-loaded sibling stub during selector acquisition.
    if(!progress.statusLogs.length&&ctx.progress.statusLogs.length)return;
    try{this.drafts.saveDraft({workspaceId:this.workspace(),actorId:this.actorId,entityKey:this.draftEntity(vesselId),baseVersions:{},draft:{progress:clone(progress),baseline:clone(ctx.progress),expected:clone(ctx.expected),quickStatus}});}
    catch(e:any){this.writable=false;this.message=e.message||'本機草稿未能保存';this.changed();}
  }
  constructor(readonly config:ResolvedSupabaseConfig,readonly actorId:string,readonly actorName:string,readonly taskId:string,readonly isCurrent:()=>boolean,readonly changed:()=>void,readonly identityIsCurrent:()=>boolean=isCurrent){}
  private current(g=this.generation){return !this.disposed&&!this.frozen&&g===this.generation&&this.isCurrent();}
  isUsable(){return this.current();}
  preservesDraft(taskId:string){return !this.disposed&&this.taskId===taskId&&this.identityIsCurrent();}
  checkCurrent(){
    if(this.disposed||this.frozen||this.isCurrent())return;
    this.frozen=true;this.writable=false;++this.generation;
    if(this.timer)clearInterval(this.timer);this.timer=null;
    const lease=this.lease;this.lease=null;
    this.message='協作鎖已失效，目前內容只保留在這個視窗';this.changed();
    void this.release(lease).catch(()=>{/* captured old owner only; TTL remains the fallback */});
  }
  private async rpc(name:string,params:Record<string,unknown>){
    const client=getSupabaseClient(this.config);if(!client)throw new Error('尚未配置 Supabase');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
    try{const {data,error}=await client.rpc(name,params).abortSignal(controller.signal);if(error)throw error;return data;}finally{clearTimeout(timer);}
  }
  private read(vesselId:string):Promise<MemberContext>{return this.rpc('read_ship_dynamics_task_member_v1',{p_workspace_key:this.config.workspaceKey,p_task_id:this.taskId,p_vessel_id:vesselId,p_actor_user_id:this.actorId}).then(r=>{
    if(!r?.ok||r.protocol!=='ship-dynamics-task-member-v1'||r.task?.id!==this.taskId||r.progress?.vesselId!==vesselId||typeof r.section_key!=='string'||typeof r.expected?.member!=='string'||typeof r.expected?.structure!=='string'||!Array.isArray(r.expected?.source))throw new Error(r?.code||'invalid-member-read');return clone(r);
  });}
  private async release(lease:Lease|null){if(!lease)return;await this.rpc('release_ship_dynamics_task_member_lock_v1',{p_workspace_key:this.config.workspaceKey,p_section_key:lease.section_key,p_locked_by:lease.locked_by,p_lease_version:lease.lease_version});}
  async select(vesselId:string):Promise<TaskItem|null>{
    const g=++this.generation;this.scope=vesselId;this.writable=false;this.message='正在確認單船協作鎖';this.changed();
    const previous=this.lease;this.lease=null;if(this.timer)clearInterval(this.timer);this.timer=null;
    try{
      await this.release(previous);if(!this.current(g))return null;
      // Validate the exact private residue before any member RPC. Never migrate a whole-task request.
      const pending=this.pending(vesselId),saved=this.localDraft(vesselId);
      const fresh=await this.read(vesselId);if(!this.current(g))return null;
      if(saved&&(saved.progress?.vesselId!==vesselId||saved.baseline?.vesselId!==vesselId||typeof saved.expected?.member!=='string'||typeof saved.expected?.structure!=='string'))throw new Error('local-member-draft-scope-mismatch');
      const owner=crypto.randomUUID();
      const result=await this.rpc('claim_ship_dynamics_edit_lock',{p_workspace_key:this.config.workspaceKey,p_section_key:fresh.section_key,p_locked_by:owner,p_locked_by_name:this.actorName,p_ttl_seconds:75});
      if(!result?.ok)throw new Error(result?.code||'lock-conflict');
      if(typeof result.lease_version!=='string'||result.section_key!==fresh.section_key||result.locked_by!==owner)throw new Error('invalid-member-lease');
      const lease:Lease=clone(result);
      if(!this.current(g)){await this.release(lease);return null;}
      this.lease=lease;
      // A reopened selector keeps its original same-member precondition, not a rebase.
      if(!this.contexts.has(vesselId))this.contexts.set(vesselId,saved?{...fresh,progress:clone(saved.baseline),expected:clone(saved.expected)}:fresh);
      const ctx=this.contexts.get(vesselId)!;
      const progress=saved?.progress||(pending?JSON.parse(pending.draft) as TaskVesselProgress:ctx.progress);
      this.quickStatus=saved?.quickStatus||'';
      this.task={...clone(ctx.task),vesselProgress:ctx.closure.map(c=>c.vesselId===vesselId?clone(progress):{...c,status:'',statusLogs:[]})};
      this.writable=true;this.message='';this.changed();
      this.timer=setInterval(()=>{void this.renew(g,lease);},25000);
      return clone(this.task);
    }catch(e:any){if(this.current(g)){this.message=e.message||String(e);this.writable=false;this.changed();}return null;}
  }
  private async renew(g:number,lease:Lease){
    if(!this.current(g)||this.lease!==lease)return;
    try{const r=await this.rpc('renew_ship_dynamics_task_member_lock_v1',{p_workspace_key:this.config.workspaceKey,p_section_key:lease.section_key,p_locked_by:lease.locked_by,p_lease_version:lease.lease_version,p_ttl_seconds:75});
      if(!this.current(g)||this.lease!==lease)return;
      if(!r?.ok||r.lease_version!==lease.lease_version)throw new Error(r?.code||'lock-conflict');lease.expires_at=r.expires_at;
    }catch{if(this.current(g)&&this.lease===lease){this.writable=false;this.message='協作鎖已失效，目前內容只保留在這個視窗';this.changed();}}
  }
  private async releaseParents(){
    const leases=this.parentLeases.splice(0);
    for(const lease of leases)await this.rpc('release_ship_dynamics_edit_lock',{p_workspace_key:this.config.workspaceKey,p_section_key:lease.section_key,p_locked_by:lease.locked_by});
  }
  private async promote(pending:Pending,vesselId:string,g:number):Promise<Pending>{
    const child=this.lease;this.lease=null;if(this.timer)clearInterval(this.timer);this.timer=null;
    await this.release(child);if(!this.current(g))throw new Error('stale-member-scope');
    const expected=pending.params.p_expected as MemberContext['expected'];
    const keys=[`task:${this.taskId}`,...expected.source.map(s=>s.collection==='meetings'?`meeting:${s.id}`:`internal-control:${s.id}`)].sort();
    for(const key of keys){
      const owner=crypto.randomUUID();const r=await this.rpc('claim_ship_dynamics_edit_lock',{p_workspace_key:this.config.workspaceKey,p_section_key:key,p_locked_by:owner,p_locked_by_name:this.actorName,p_ttl_seconds:75});
      if(!r?.ok||typeof r.lease_version!=='string')throw new Error(r?.code||'lock-conflict');
      this.parentLeases.push(clone(r));if(!this.current(g))throw new Error('stale-member-scope');
    }
    const latest=await this.read(vesselId);
    if(!this.current(g)||JSON.stringify(latest.expected)!==JSON.stringify(expected))throw new Error('member-context-conflict');
    // Recheck the closure vector under the exact parent/source graph; never rebase CAS.
    if(!latest.closure.some(c=>c.vesselId===vesselId))throw new Error('member-context-conflict');
    return {draft:pending.draft,params:{...clone(pending.params),p_operation_id:crypto.randomUUID(),p_command:{...(pending.params.p_command as object),mode:'shared'},p_lock_guards:this.parentLeases.map(l=>({section_key:l.section_key,locked_by:l.locked_by,lease_version:l.lease_version}))}};
  }
  async save(candidate:TaskItem,vesselId:string,publish:(revision:number)=>Promise<void>,prepareSubmit:()=>Promise<void>=async()=>{}):Promise<boolean>{
    if(this.busy||!this.current()||this.scope!==vesselId)return false;
    const ctx=this.contexts.get(vesselId);if(!ctx)return false;
    const key=memberPendingKey(this.config,this.actorId,this.taskId,vesselId),draft=JSON.stringify(taskProgressForVessel(candidate,vesselId));
    this.busy=true;let g=this.generation;
    try{
      let pending=this.pending(vesselId),r:any;
      // A proved zero-write promotion failure detached the child. Only an explicit
      // retry reacquires it; select preserves the original member/source CAS.
      if(!pending&&!this.lease){if(!await this.select(vesselId))return false;g=this.generation;}
      if(pending){r=await this.rpc('get_ship_dynamics_task_member_receipt_v1',pending.params);if(!this.current(g))return false;}
      if(!pending){
        await prepareSubmit();if(!this.current(g))return false;
        const lease=this.lease;if(!this.writable||!lease||Date.parse(lease.expires_at)<=Date.now())throw new Error('協作鎖已失效，目前內容只保留在這個視窗');
        const progress=taskProgressForVessel(candidate,vesselId),old=ctx.progress;
        const prefix=progress.statusLogs.slice(0,Math.max(0,progress.statusLogs.length-old.statusLogs.length));
        if(JSON.stringify(progress.statusLogs.slice(prefix.length))!==JSON.stringify(old.statusLogs))throw new Error('單船進度歷程只能附加，不得刪除、改寫或偽造既有紀錄');
        pending={draft,params:{p_workspace_key:this.config.workspaceKey,p_operation_id:crypto.randomUUID(),p_task_id:this.taskId,p_vessel_id:vesselId,p_command:{status:progress.status,isClosed:progress.isClosed,...(progress.closedDate?{closedDate:progress.closedDate}:{}),newStatusLogs:prefix.map(l=>({text:l.text})),mode:'leaf'},p_expected:clone(ctx.expected),p_actor_user_id:this.actorId,p_actor_guard:clone(ctx.actor_guard),p_lock_guards:[{section_key:lease.section_key,locked_by:lease.locked_by,lease_version:lease.lease_version}]}};
        localStorage.setItem(key,JSON.stringify(pending));
      }
      if(!r||r.status==='missing'){
        try{r=await this.rpc('save_ship_dynamics_task_member_v1',pending.params);}
        catch{r=await this.rpc('get_ship_dynamics_task_member_receipt_v1',pending.params);if(r?.status==='missing')throw new Error('雲端保存結果尚未確認；已保留原始請求與草稿');}
      }
      if(!this.current(g))return false;
      if(r?.ok===false&&r.code==='transition-required'){
        // Authoritative zero-write result terminates the leaf request. Shared is new.
        localStorage.removeItem(key);
        pending=await this.promote(pending,vesselId,g);
        await prepareSubmit();if(!this.current(g))return false;
        localStorage.setItem(key,JSON.stringify(pending));
        try{r=await this.rpc('save_ship_dynamics_task_member_v1',pending.params);}
        catch{r=await this.rpc('get_ship_dynamics_task_member_receipt_v1',pending.params);}
        if(!this.current(g))return false;
      }
      if(r?.ok!==true||r.status!=='committed'){
        if(r?.ok===false&&r.status!=='mismatch')localStorage.removeItem(key);
        throw new Error(r?.code||'雲端保存結果尚未確認；已保留原始請求與草稿');
      }
      if(r.operation_id!==pending.params.p_operation_id||!Number.isSafeInteger(r.revision))throw new Error('invalid-member-receipt');
      const confirmed=await this.read(vesselId);if(!this.current(g))return false;
      await publish(r.revision);if(!this.current(g))return false;
      this.contexts.set(vesselId,confirmed);
      const saved=this.localDraft(vesselId),submitted=JSON.parse(pending.draft) as TaskVesselProgress;
      if(saved){
        const count=saved.progress.statusLogs.length-submitted.statusLogs.length;
        if(count<0||JSON.stringify(saved.progress.statusLogs.slice(count))!==JSON.stringify(submitted.statusLogs))throw new Error('local-member-draft-history-conflict');
        const progress={...saved.progress,statusLogs:[...saved.progress.statusLogs.slice(0,count),...clone(confirmed.progress.statusLogs)]};
        this.drafts.saveDraft({workspaceId:this.workspace(),actorId:this.actorId,entityKey:this.draftEntity(vesselId),baseVersions:{},draft:{...saved,progress,baseline:clone(confirmed.progress),expected:clone(confirmed.expected)}});
      }
      this.confirmation={operationId:String(pending.params.p_operation_id),vesselId,submitted:JSON.parse(pending.draft),progress:clone(confirmed.progress)};
      this.changed();
      localStorage.removeItem(key);
      return pending.draft===draft;
    }catch(e:any){if(this.current(g)){this.message=e.message||String(e);this.changed();alert(this.message);}return false;}finally{try{await this.releaseParents();}catch{/* exact parent owners expire; never replace a business receipt */}this.busy=false;}
  }
  async suspend(){++this.generation;this.writable=false;if(this.timer)clearInterval(this.timer);this.timer=null;const lease=this.lease;this.lease=null;await this.release(lease);}
  async dispose(){this.disposed=true;++this.generation;if(this.timer)clearInterval(this.timer);this.timer=null;const lease=this.lease;this.lease=null;try{await this.release(lease);}catch{/* only the captured old lease may expire */}}
  async close(){if(this.busy)return false;for(const scope of this.contexts.keys())if(!localStorage.getItem(memberPendingKey(this.config,this.actorId,this.taskId,scope)))this.drafts.removeDraft(this.workspace(),this.actorId,this.draftEntity(scope));this.disposed=true;++this.generation;if(this.timer)clearInterval(this.timer);this.timer=null;const lease=this.lease;this.lease=null;await this.release(lease);return true;}
}
