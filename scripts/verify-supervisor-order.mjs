import assert from 'node:assert/strict';
import {createServer} from 'vite';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'}),cases=[];
const test=(name,fn)=>{try{fn();cases.push({name,ok:true});}catch(e){cases.push({name,ok:false,error:e.message.slice(0,250)});}};
try {
 const {vesselSupervisorOptions}=await server.ssrLoadModule('/src/vesselDashboardFilters.ts');
 const {createInitialData}=await server.ssrLoadModule('/src/data/seed.ts');
 const {normalizeAppData}=await server.ssrLoadModule('/src/normalize.ts');
 const {assertActorAuthorizedForAppDataChange}=await server.ssrLoadModule('/src/cloudAuthorization.ts');
 const {default:Picker}=await server.ssrLoadModule('/src/VesselFilterControls.tsx');
 const base=createInitialData();
 base.users=['a','b','c'].map(id=>({...base.users[0],id,name:`QA ${id}`,username:id,department:'督導',role:'admin',isActive:true,managedVesselIds:['v']}));
 const vessels=[{id:'v',assignedUserIds:['a','b','c'],delegateManagers:[]}];
 const ordered=()=>vesselSupervisorOptions(vessels,base.users,['b','a','a','inactive']).map(x=>x.id);
 test('saved stable-ID order wins; duplicate/hidden ignored, new appends',()=>assert.deepEqual(ordered(),['b','a','c']));
 test('legacy missing order preserves existing order',()=>assert.deepEqual(vesselSupervisorOptions(vessels,base.users).map(x=>x.id),['a','b','c']));
 test('normalization retains optional order without inventing legacy default',()=>{
  assert.equal(Object.hasOwn(normalizeAppData(base).settings,'supervisorOrder'),false);
  const candidate=structuredClone(base);candidate.settings.supervisorOrder=['b','a','b',null,7];
  assert.deepEqual(normalizeAppData(candidate).settings.supervisorOrder,['b','a']);
 });
 const next=structuredClone(base);next.settings.supervisorOrder=['b','a','c'];
 for(const role of ['owner','admin','operator','vessel'])test(`order permission ${role}`,()=>{
  const b=structuredClone(base),n=structuredClone(next);b.users[0].role=n.users[0].role=role;
  if(['owner','admin'].includes(role))assert.doesNotThrow(()=>assertActorAuthorizedForAppDataChange(b,n,'a'));
  else assert.throws(()=>assertActorAuthorizedForAppDataChange(b,n,'a'));
 });
 test('order exception never admits unrelated admin settings',()=>{const n=structuredClone(next);n.settings.systemTitle='changed';assert.throws(()=>assertActorAuthorizedForAppDataChange(base,n,'a'));});
 test('inactive admin cannot save order',()=>{const b=structuredClone(base),n=structuredClone(next);b.users[0].isActive=n.users[0].isActive=false;assert.throws(()=>assertActorAuthorizedForAppDataChange(b,n,'a'));});
 const props={filters:{selfManagedOnly:false,shipTypes:[],attentionGroups:[],meetingOnly:false,supervisorIds:[]},shipTypes:[],supervisors:vesselSupervisorOptions(vessels,base.users),onChange(){}};
 test('only enabled admin entry renders sorting button',()=>{
  assert.match(renderToStaticMarkup(React.createElement(Picker,{...props,onSaveSupervisorOrder:async()=>true})),/>排序<\/button>/);
  assert.doesNotMatch(renderToStaticMarkup(React.createElement(Picker,props)),/>排序<\/button>/);
 });
 console.log(JSON.stringify({layer:'model/SSR/authorization',cases,passed:cases.filter(x=>x.ok).length,total:cases.length},null,2));
 if(cases.some(x=>!x.ok))process.exitCode=1;
}finally{await server.close();}
