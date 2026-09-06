// Owner-side fixture setup only. No UI callbacks are invoked by this module.
export async function internalControlInput(initial,vite){
 const at=initial.updatedAt,owner=initial.users[0];
 initial.users.push({...structuredClone(owner),id:'qa-operator',username:'qa-operator',name:'QA OPERATOR',role:'operator',department:'督導',managedVesselIds:['qa-v1']});
 for(const v of initial.vessels){v.fullName=v.name;v.shortName=v.name;}
 initial.vessels[0].assignedUserIds=['qa-operator'];
 const ic=await vite.ssrLoadModule('/src/internalControlData.ts');
 const cases=['withdraw','case-delete','task-delete','restricted'].map(name=>({id:'qa-'+name,vesselId:name==='restricted'?'qa-v2':'qa-v1',reportDate:at.slice(0,10),reportSource:'日常',description:'QA '+name,priority:'低',category:'維修',isAware:false,status:'QA pending',departments:['督導'],syncToTask:true,isClosed:false,createdBy:owner.id,updatedBy:owner.id,createdAt:at,updatedAt:at,statusLogs:[],origin:'internal-control'}));
 ic.createInternalControlCases(initial,cases,owner,at,Object.fromEntries(cases.map(c=>[c.id,{categories:['維修'],expectedDate:'',ownerUserIds:c.vesselId==='qa-v1'?['qa-operator']:[],isAbnormal:false}])));
 const task=structuredClone(initial.tasks[0]);
 initial.tasks.push({...task,id:'qa-unrelated-task',internalControlCaseId:undefined,isInternalControl:false,vesselId:'qa-v2',vesselIds:['qa-v2'],description:'QA UNRELATED TASK',ownerUserIds:[]});
 initial.meetings=[{id:'qa-unrelated-meeting',subject:'QA UNRELATED MEETING',meetingDate:at.slice(0,10),reason:'QA unchanged',participantUserIds:[],taskDescription:'',vessels:['qa-v2'],vesselScopeMode:'selected',priority:'高',isAbnormal:false,isInternalControl:false,departments:['督導'],trackingUserIds:[],responsibleUserIds:[],expectedDate:'',resolution:'待處理',status:'進行中',statusLogs:[],taskItems:[],createdBy:owner.id,createdAt:at,updatedAt:at}];
 const withdrawn=initial.internalControlCases.find(c=>c.id==='qa-withdraw');
 initial.taskDismissals=[{id:'qa-withdraw-dismissal',userId:'qa-operator',itemKind:'task',itemId:withdrawn.linkedTaskId,dismissedBy:'qa-operator',dismissedAt:at}];
 initial.notifications=[{id:'qa-withdraw-notice',userId:'qa-operator',vesselId:'qa-v1',taskId:withdrawn.linkedTaskId,kind:'task_created',title:'QA seeded notification',message:'QA fixture',actorId:owner.id,createdAt:at}];
 const {normalizeAppData}=await vite.ssrLoadModule('/src/normalize.ts');
 Object.assign(initial,normalizeAppData(initial));
}
export async function seedInternalControlLegacy(db,workspace,initial){
 const legacy={...structuredClone(initial),revision:99,users:initial.users.map(u=>({...u,role:u.id==='qa-operator'?'owner':u.role,name:'LEGACY '+u.name})),tasks:[],internalControlCases:[]};
 await db.query('insert into ship_dynamics_app_state(workspace_key,revision,payload) values($1,99,$2::jsonb)',[workspace,JSON.stringify(legacy)]);
}
