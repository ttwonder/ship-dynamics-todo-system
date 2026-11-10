import {useCallback,useEffect,useRef,useState} from 'react';
import {getSupabaseConfig} from '../cloud';
import {createFleetRiskClient} from './client';
import type {FleetRiskState} from './model';

/** One dashboard-scoped snapshot, shared by every card and the existing dialog.
 * Reads never start a source crawl; no business records or persistent cache are written.
 */
export function useFleetRisk() {
  const [client]=useState(()=>createFleetRiskClient(typeof window==='undefined'?null:getSupabaseConfig()));
  const [state,setState]=useState<FleetRiskState|null>(null);
  const [loading,setLoading]=useState(false),[submitting,setSubmitting]=useState(false);
  const [error,setError]=useState(''),[unknown,setUnknown]=useState(false);
  const alive=useRef(false);
  const active=useRef<{kind:'read'|'refresh';controller:AbortController;promise?:Promise<void>}|null>(null);
  const read=useCallback(():Promise<void>=>{
    // Opening the dialog while a read/dispatch is pending joins it, not another request.
    if(active.current)return active.current.promise||Promise.resolve();
    const task={kind:'read' as const,controller:new AbortController(),promise:undefined as Promise<void>|undefined};
    active.current=task;setLoading(true);setError('');
    task.promise=(async()=>{
      try{const next=await client.read(task.controller.signal);if(alive.current&&active.current===task){setState(next);setUnknown(false);}}
      catch(e){if(alive.current&&active.current===task&&!task.controller.signal.aborted)setError(e instanceof Error?e.message:'無法讀取風險清單，原清單未變更。');}
      finally{if(alive.current&&active.current===task){active.current=null;setLoading(false);}}
    })();
    return task.promise;
  },[client]);
  useEffect(()=>{
    alive.current=true;void read();
    return()=>{alive.current=false;active.current?.controller.abort();active.current=null;};
  },[read]);
  useEffect(()=>{
    if(state?.attempt?.status!=='running'||error||submitting)return;
    const timer=setTimeout(()=>void read(),2500);
    return()=>clearTimeout(timer);
  },[state,error,submitting,read]);
  const refresh=useCallback(async()=>{
    if(!state||active.current?.kind==='refresh'||state.attempt?.status==='running'||unknown)return;
    active.current?.controller.abort();
    const task={kind:'refresh' as const,controller:new AbortController(),promise:undefined as Promise<void>|undefined};
    active.current=task;setLoading(false);setSubmitting(true);setError('');
    task.promise=(async()=>{
      try{
        const result=await client.refresh(crypto.randomUUID(),task.controller.signal);
        if(alive.current&&active.current===task){setState(result.state);setUnknown(false);}
      }catch(e){if(alive.current&&active.current===task&&!task.controller.signal.aborted){setUnknown(true);setError(e instanceof Error?e.message:'更新請求結果未確認，請讀取更新狀態。');}}
      finally{if(alive.current&&active.current===task){active.current=null;setSubmitting(false);}}
    })();
    return task.promise;
  },[client,state,unknown]);
  return {state,loading,submitting,error,unknown,read,refresh};
}
export type FleetRiskController=ReturnType<typeof useFleetRisk>;
