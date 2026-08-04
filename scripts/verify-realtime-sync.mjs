import assert from 'node:assert/strict';
import { createServer } from 'vite';
import fs from 'node:fs';

const server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
try{
  const sync=await server.ssrLoadModule('/src/realtimeSync.ts');
  const clean={incomingRevision:8,confirmedRevision:7,hasUnsavedChanges:false,hasActiveItemLease:false,hasBatchLease:false,saveInFlight:false};
  assert.equal(sync.cloudWakeupAction(clean),'refresh');
  assert.equal(sync.cloudWakeupAction({...clean,incomingRevision:7}),'ignore');
  assert.equal(sync.cloudWakeupAction({...clean,incomingRevision:6}),'ignore');
  for(const field of ['hasUnsavedChanges','hasActiveItemLease','hasBatchLease','saveInFlight']){
    assert.equal(sync.cloudWakeupAction({...clean,[field]:true}),'defer',`${field} must prevent automatic replacement`);
  }
  const cloud=fs.readFileSync('src/cloud.ts','utf8');
  const app=fs.readFileSync('src/App.tsx','utf8');
  const schema=fs.readFileSync('supabase/schema.sql','utf8');
  assert.ok(cloud.includes('export function subscribeToCloudRevision')&&cloud.includes("'postgres_changes'")&&cloud.includes('workspace_key=eq.'),'cloud must subscribe only to the configured workspace row');
  assert.ok(cloud.includes('removeChannel(channel)'),'cloud revision subscription must clean up its channel');
  assert.ok(schema.includes("pubname='supabase_realtime'")&&schema.includes('alter publication supabase_realtime add table public.ship_dynamics_app_state'),'schema deployment must idempotently enable workspace revision events when Supabase Realtime is available');
  assert.ok(app.includes('subscribeToCloudRevision(')&&app.includes('cloudWakeupAction('),'App must route Realtime events through the safe wakeup decision');
  assert.ok(app.includes("window.addEventListener('focus'")&&app.includes("window.addEventListener('online'"),'focus and reconnect must backfill missed Realtime events');
  const refreshStart=app.indexOf('const refreshFromCloudWakeup');
  const refreshEnd=app.indexOf('\n  useEffect(',refreshStart);
  const refresh=app.slice(refreshStart,refreshEnd);
  assert.ok(refresh.includes('fetchCloudData(')&&refresh.includes('cloudWakeupAction('),'wakeup refresh must fetch authority and recheck safety after the request');
  assert.ok(refresh.indexOf('cloudWakeupAction(',refresh.indexOf('fetchCloudData('))<refresh.indexOf('confirmCloudSnapshot('),'the second safety check must happen before adopting the remote snapshot');
  console.log('Realtime wakeup decision contracts passed.');
}finally{await server.close();}
