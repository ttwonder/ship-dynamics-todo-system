import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createServer} from 'vite';

const source=fs.readFileSync('src/App.tsx','utf8'),ast=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const initializers=[];const walk=n=>{if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==='assignedOwnerUserIds')initializers.push(n.initializer.getText(ast));ts.forEachChild(n,walk);};walk(ast);assert.equal(initializers.length,1);
const users=[
 {id:'supervisor',department:'督導',isActive:true,role:'operator'},
 {id:'marine',department:'海務',isActive:true,role:'operator'},
 {id:'engineer',department:'船工',isActive:true,role:'operator'},
 {id:'inactive',department:'督導',isActive:false,role:'operator'},
 {id:'vessel',department:'督導',isActive:true,role:'vessel'},
 {id:'other-supervisor',department:'督導',isActive:true,role:'operator'},
 {id:'other-marine',department:'海務',isActive:true,role:'admin'},
];
const vessel={id:'v1',assignedUserIds:['supervisor','marine','engineer','inactive','vessel','missing','marine']};
const server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'error'});
const cases=[];const check=(name,fn)=>{fn();cases.push(name);};
try{
 const helpers=fs.existsSync('src/newTaskOwnerDefaults.ts')?await server.ssrLoadModule('/src/newTaskOwnerDefaults.ts'):{};
 const initial=vm.runInNewContext(ts.transpileModule(initializers[0],{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,{liveVessel:vessel,live:{users},...helpers});
 check('actual-App-new-draft-only-assigned-active-supervisor',()=>assert.deepEqual(Array.from(initial),['supervisor'],'new task must not preselect all assigned departments'));
 const {newTaskOwnerDefaults,updateNewTaskOwnerSelection}=helpers;
 check('selected-departments-add-only-corresponding-vessel-managers',()=>assert.deepEqual(newTaskOwnerDefaults(vessel,users,['海務']),['supervisor','marine']));
 check('multiple-departments-dedupe-and-omit-invalid-accounts',()=>assert.deepEqual(newTaskOwnerDefaults(vessel,users,['海務','船工','海務']),['supervisor','marine','engineer']));
 check('no-corresponding-manager-does-not-select-other-vessels-or-admins',()=>assert.deepEqual(newTaskOwnerDefaults({id:'empty',assignedUserIds:[]},users,['海務']),[]));
 check('missing-vessel-does-not-invent-owners',()=>assert.deepEqual(newTaskOwnerDefaults(undefined,users,['海務']),[]));
 const defaults=d=>newTaskOwnerDefaults(vessel,users,d);
 check('department-add-and-remove-only-auto-owned-choices',()=>{
  const added=updateNewTaskOwnerSelection(['supervisor'],['supervisor'],defaults([]),defaults(['海務']));
  assert.deepEqual(added,{selectedIds:['supervisor','marine'],automaticIds:['supervisor','marine']});
  const removed=updateNewTaskOwnerSelection(added.selectedIds,added.automaticIds,defaults(['海務']),defaults([]));
  assert.deepEqual(removed,{selectedIds:['supervisor'],automaticIds:['supervisor']});
 });
 check('manual-person-selected-before-department-survives-uncheck',()=>{
  const added=updateNewTaskOwnerSelection(['supervisor','marine'],['supervisor'],defaults([]),defaults(['海務']));
  assert.deepEqual(added.automaticIds,['supervisor']);
  assert.deepEqual(updateNewTaskOwnerSelection(added.selectedIds,added.automaticIds,defaults(['海務']),defaults([])).selectedIds,['supervisor','marine']);
 });
 check('manual-uncheck-is-not-reselected-by-an-unrelated-department',()=>{
  const next=updateNewTaskOwnerSelection(['supervisor'],['supervisor'],defaults(['海務']),defaults(['海務','船工']));
  assert.deepEqual(next.selectedIds,['supervisor','engineer']);
 });
 check('manual-supervisor-uncheck-is-respected',()=>assert.deepEqual(updateNewTaskOwnerSelection([],[],defaults([]),defaults(['海務'])).selectedIds,['marine']));
 check('manual-other-person-retained-when-automatic-department-is-removed',()=>assert.deepEqual(updateNewTaskOwnerSelection(['supervisor','marine','other-marine'],['supervisor','marine'],defaults(['海務']),defaults([])).selectedIds,['supervisor','other-marine']));
 check('unchanged-departments-do-not-reselect-cleared-owners',()=>assert.deepEqual(updateNewTaskOwnerSelection([],[],defaults(['海務']),defaults(['海務'])).selectedIds,[]));
 const editorSource=fs.readFileSync('src/EditModals.tsx','utf8'),editorAst=ts.createSourceFile('EditModals.tsx',editorSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const editorLocal=name=>{const found=[];const visit=n=>{if(ts.isVariableDeclaration(n)&&n.name.getText(editorAst)===name)found.push(n.initializer.getText(editorAst));ts.forEachChild(n,visit);};visit(editorAst);assert.equal(found.length,1);return found[0];};
 const callbacks=ts.transpileModule(`globalThis.changeDepartments=${editorLocal('changeDepartments')};globalThis.changeOwners=${editorLocal('changeOwners')};`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 for(const [label,creating,role,ownerUserIds] of [['saved-task',false,'operator',['marine']],['vessel-new-task',true,'vessel',[]]])check('actual-editor-preserves-'+label+'-owners',()=>{
  const draft={vesselId:'v1',departments:['海務'],ownerUserIds:[...ownerUserIds]},context={data:{vessels:[vessel]},users,draft,creating,currentUser:{role},automaticOwnerIds:{current:[]},...helpers,change:fn=>fn(draft)};
  vm.createContext(context);vm.runInContext(callbacks,context);context.changeDepartments(['船工']);
  assert.deepEqual(draft.ownerUserIds,ownerUserIds);assert.deepEqual(draft.departments,['船工']);
 });
 console.log(JSON.stringify({status:'PASS',layer:'actual-App-initializer-production-helpers-and-controlled-editor-callbacks',cases},null,2));
}finally{await server.close();}
