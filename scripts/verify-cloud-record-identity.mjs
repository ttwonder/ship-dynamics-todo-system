import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {execFileSync} from 'node:child_process';
// No remote browser or production credentials are used in this identity gate.
import {createServer} from 'vite';
const vite=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
const globals={window:globalThis.window,localStorage:globalThis.localStorage};
const rows=[];
const check=async(name,fn)=>{await fn();rows.push(name);console.log(`PASS ${name}`);};
try {
 const store=new Map();const localStorage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};
 globalThis.window={localStorage,location:{origin:'http://127.0.0.1',hostname:'127.0.0.1'}};globalThis.localStorage=localStorage;
 const cloud=await vite.ssrLoadModule('/src/cloud.ts');
 const recovery=await vite.ssrLoadModule('/src/cloudRecovery.ts');
 const app=await vite.ssrLoadModule('/src/App.tsx');
 const legacy={supabaseUrl:'http://127.0.0.1:49994',supabaseAnonKey:'isolated-qa-not-a-secret',workspaceKey:'isolated-qa',tableName:'ship_dynamics_app_state'};
 const records={...legacy,storageMode:'records-v1',readMode:'delta-v1'};
 await check('same host/key/workspace cannot reuse a legacy durable base in row authority',()=>{
  assert.notEqual(recovery.cloudWorkspaceIdentity(legacy),recovery.cloudWorkspaceIdentity(records));
  assert.notEqual(recovery.cloudConfigIdentity(legacy),recovery.cloudConfigIdentity(records));
  assert.equal(recovery.cloudWorkspaceIdentity(legacy),`cloud-workspace-v2:${JSON.stringify([legacy.supabaseUrl,legacy.tableName,legacy.workspaceKey])}`);
  assert.equal(recovery.cloudConfigIdentity(legacy),recovery.cloudConfigIdentity({...legacy,storageMode:'legacy',readMode:'snapshot'}));
  assert.equal(recovery.cloudWorkspaceIdentity(records),recovery.cloudWorkspaceIdentity({...records,readMode:'snapshot'}),'read optimization is not write authority');
 });
 await check('legacy persisted identity upgrade never blesses row authority',()=>{
  const stored=`${legacy.supabaseUrl}|${legacy.tableName}|${legacy.workspaceKey}|old-key`;
  assert.equal(recovery.normalizeStoredCloudWorkspaceIdentity(stored,legacy),recovery.cloudWorkspaceIdentity(legacy));
  assert.notEqual(recovery.normalizeStoredCloudWorkspaceIdentity(stored,records),recovery.cloudWorkspaceIdentity(records));
  const floors=recovery.updateDurableRevisionFloor(new Map(),recovery.cloudWorkspaceIdentity(records),99);
  assert.equal(recovery.parseDurableRevisionFloors(recovery.serializeDurableRevisionFloors(floors)).floors.get(recovery.cloudWorkspaceIdentity(records)),99);
  assert.equal(floors.has(recovery.cloudWorkspaceIdentity(legacy)),false);
 });
 await check('actual mounted App coordinator rejects a write authority change before and after I/O',async()=>{
  const coordinator=app.createAsyncConfigCoordinator(),token=coordinator.begin(legacy);
  assert.equal(coordinator.isCurrent(token,records),false);
  let calls=0;
  await assert.rejects(()=>coordinator.run(token,()=>records,async()=>{calls++;}),app.StaleAsyncConfigError);assert.equal(calls,0);
  let current=legacy,release;const pending=coordinator.run(token,()=>current,()=>new Promise(resolve=>{release=resolve;}));
  current=records;release('late');await assert.rejects(()=>pending,app.StaleAsyncConfigError);
  assert.equal(coordinator.isCurrent(coordinator.begin(records),{...records}),true);
 });
 await check('runtime opt-in reaches the real App config without stored-mode bleed',()=>{
  window.SHIP_DYNAMICS_SUPABASE_CONFIG=records;
  assert.equal(cloud.getSupabaseConfig().storageMode,'records-v1');assert.equal(cloud.getSupabaseConfig().readMode,'delta-v1');
  store.set('ship-dynamics-supabase-config',JSON.stringify(records));window.SHIP_DYNAMICS_SUPABASE_CONFIG=legacy;
  assert.notEqual(cloud.getSupabaseConfig().storageMode,'records-v1');
  window.SHIP_DYNAMICS_SUPABASE_CONFIG={...records,storageMode:'future'};
  assert.throws(()=>cloud.getSupabaseClient(cloud.getSupabaseConfig()),/模式/);
  window.SHIP_DYNAMICS_SUPABASE_CONFIG=records;
 });
 await check('App change feed listens to its selected authority and does not observe legacy state',()=>{
  assert.equal(cloud.cloudChangeFeedTable(legacy),'ship_dynamics_app_state');assert.equal(cloud.cloudChangeFeedTable(records),'ship_dynamics_record_workspaces');
  const source=fs.readFileSync('src/App.tsx','utf8');
  // Wiring evidence only. Real Realtime remains a separate hosted gate.
  assert.ok(source.includes('subscribeToCloudRevision(queueRevision,undefined,config)'));
  assert.ok(fs.readFileSync('src/cloud.ts','utf8').includes('table:cloudChangeFeedTable(cfg)'));
 });
 await check('all existing App JSX remains byte-identical to the approved baseline',()=>{
  const jsx=text=>{const file=ts.createSourceFile('App.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),result=[];
   const visit=node=>{if(ts.isJsxElement(node)||ts.isJsxSelfClosingElement(node)||ts.isJsxFragment(node)){result.push(node.getText(file).replace(/\r\n/g,'\n'));return;}ts.forEachChild(node,visit);};visit(file);return result;};
  const previous=execFileSync('git',['show','baseline/pre-normalized-storage:src/App.tsx'],{encoding:'utf8'});
  const expected=jsx(previous),actual=jsx(fs.readFileSync('src/App.tsx','utf8'));assert.ok(actual.length>0);assert.deepEqual(actual,expected);
  console.log(JSON.stringify({unchangedAppJsxRoots:actual.length}));
 });
 console.log(JSON.stringify({recordIdentity:'PASS',cases:rows.length,tests:rows}));
} finally {
 await vite.close();for(const[k,v]of Object.entries(globals)){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}
}
