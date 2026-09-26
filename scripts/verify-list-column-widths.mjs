import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createServer} from 'vite';
const server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
const oldStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
const store=new Map();let blocked=false;const cases=[];
try{
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>{if(blocked)throw new Error('disabled storage');return store.get(key)??null;}}});
  const {readTaskListWidths,taskListColumns:cols}=await server.ssrLoadModule('/src/useTaskListColumns.tsx');
  const key='["test-workspace","operator-a","total"]',prefix='ship-task-list-widths-v1:';
  const check=(name,fn)=>{fn();cases.push(name);};
  check('no saved preferences use responsive defaults',()=>assert.equal(readTaskListWidths(key),null));
  check('new defaults preserve item/department/owner baselines and reduce requested columns',()=>{
    const c=Object.fromEntries(cols.map(c=>[c.key,c]));
    assert.equal(c.item.width,300);assert.equal(c.department.width,170);assert.equal(c.owners.width,90);
    assert.ok(c.vessel.width<160&&c.type.width>50&&c.attention.width<91&&c.created.width<110&&c.deadline.width<110&&c.status.width<260);
    assert.equal(c.created.width,c.deadline.width);assert.equal(c.created.min,c.deadline.min);
    assert.ok(42+cols.reduce((n,c)=>n+c.width,0)<=1259,'fits existing 1366 compact page content box');
  });
  for(const bad of ['{broken','null','{}','[]','[10]',JSON.stringify(cols.map(()=> '100')),JSON.stringify(cols.map(()=>null))])check('invalid saved shape '+bad.slice(0,18),()=>{store.set(prefix+key,bad);assert.equal(readTaskListWidths(key),null);});
  check('valid widths restore only exact actor/list key',()=>{const widths=cols.map(c=>c.width+20);store.set(prefix+key,JSON.stringify(widths));assert.deepEqual(readTaskListWidths(key),widths);assert.equal(readTaskListWidths('another-actor'),null);assert.equal(readTaskListWidths(key+'closed'),null);});
  check('width bounds retain legible dates and actions',()=>{store.set(prefix+key,JSON.stringify(cols.map(()=>-1)));assert.deepEqual(readTaskListWidths(key),cols.map(c=>c.min));store.set(prefix+key,JSON.stringify(cols.map(()=>99999)));assert.deepEqual(readTaskListWidths(key),cols.map(()=>1200));});
  check('unavailable storage leaves list usable',()=>{blocked=true;assert.equal(readTaskListWidths(key),null);blocked=false;});
  check('both original callers use workspace/actor/list, not name/session or permission generation',()=>{
    const app=fs.readFileSync('src/App.tsx','utf8');
    for(const mode of ['total','closed'])assert.ok(app.includes(`columnPreferenceKey={JSON.stringify([cloudWorkspaceIdentity(listBatchConfig),currentUser.id,'${mode}'])}`));
    assert.ok(app.includes("<th>追蹤窗口{columns.resizeHandle('owners')}</th>"));
  });
  console.log(JSON.stringify({layer:'actual width module + original caller source',status:'PASS',cases},null,2));
}finally{if(oldStorage)Object.defineProperty(globalThis,'localStorage',oldStorage);else delete globalThis.localStorage;await server.close();}
