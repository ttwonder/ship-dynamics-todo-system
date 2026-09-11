import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import ts from 'typescript';import {execFileSync} from 'node:child_process';
const base='53e230329f250045f0c971154729b70a223e7fba',root=process.env.QA_EVIDENCE_ROOT;assert.ok(root&&path.isAbsolute(root));fs.mkdirSync(root,{recursive:true});
const parse=(p,s)=>ts.createSourceFile(p,s,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),printer=ts.createPrinter(),print=(n,s)=>printer.printNode(ts.EmitHint.Unspecified,n,s),walk=(s,p)=>{const a=[];const visit=n=>{if(p(n))a.push(n);ts.forEachChild(n,visit);};visit(s);return a;};
const receipts=[];
for(const file of ['src/App.tsx','src/Management.tsx']){
 const before=execFileSync('git',['show',base+':'+file],{encoding:'utf8'}).replaceAll('\r\n','\n'),after=fs.readFileSync(file,'utf8').replaceAll('\r\n','\n');let expected=before;
 const replacements=file==='src/App.tsx'?[
 ["<span>請先點擊上方的保存按鈕，並等待雲端確認。</span>", "<span>{hasManagementPrivateDraft()?'管理表單尚有未提交的修改，請回到各表單按保存；上方保存不會提交這些欄位。':'請先點擊上方的保存按鈕，並等待雲端確認。'}</span>"],
 ['<ManagementView data={data}','<ManagementView key={`${currentUser.id}:${identitySessionGeneration.current}`} onPrivateDraftChange={onManagementPrivateDraftChange} data={data}']
 ]:[
 ["selectUser(selectedDirectory.key.slice(5)); go('people');","if (selectUser(selectedDirectory.key.slice(5))) go('people');"],
 ["selectVessel(selectedDirectory.key.slice(7)); go('vessels');","if (selectVessel(selectedDirectory.key.slice(7))) go('vessels');"],
 ['<TaskCategoryManager key="task"',"<TaskCategoryManager reportDraft={reportDraft('categories')} key=\"task\""],
 ['<TaskCategoryManager key="meeting"',"<TaskCategoryManager reportDraft={reportDraft('categories')} key=\"meeting\""],
 ['<EquipmentSubcategoryManager key="equipment"',"<EquipmentSubcategoryManager reportDraft={reportDraft('categories')} key=\"equipment\""],
 ['captureDraft={site.capture}','captureDraft={site.capture} resetSitePassword={site.initialize}'],
 ['onSaveSupabaseConfig={onSaveSupabaseConfig}','onSaveSupabaseConfig={saveConfig}'],
 ["setSaveNotice('要事分類已保存');return saved;","setSaveNotice('要事分類已保存');return saved&&current();"],
 ["setSaveNotice('臨會/專題待辦分類已保存');return saved;","setSaveNotice('臨會/專題待辦分類已保存');return saved&&current();"],
 ["setSaveNotice('設備故障細項已保存');return saved;","setSaveNotice('設備故障細項已保存');return saved&&current();"]
 ];
 for(const [a,b] of replacements){assert.ok(expected.includes(a),a);expected=expected.replaceAll(a,b);}
 if(file.endsWith('App.tsx')){const marker='return <div className="app">';assert.equal(expected.split(marker).length,2);const [prefix,view]=expected.split(marker);expected=prefix+marker+view.replace(/\bsavePhase\b/g,'visibleSavePhase').replace(/\bsaveToast\b/g,'visibleSaveToast').replace(/\bvisibleCloudStatus\b/g,'visibleSaveStatus');}
 const a=parse(file,expected),b=parse(file,after),old=parse(file,before);const roots=s=>{const result=[];const visit=n=>{if(ts.isJsxElement(n)||ts.isJsxFragment(n)||ts.isJsxSelfClosingElement(n)){result.push(print(n,s));return;}ts.forEachChild(n,visit);};visit(s);return result;};assert.deepEqual(roots(b),roots(a),file+' exact JSX roots with named internal substitutions only');
 const commits=s=>walk(s,n=>ts.isCallExpression(n)&&n.expression.getText(s)==='commit').map(n=>n.arguments.slice(0,5).map(v=>print(v,s)));assert.deepEqual(commits(b),commits(old),'original business mutation/audit bodies unchanged');
 if(file.endsWith('App.tsx')){let configExpected=before;for(const [a,b] of [["async (config:SupabaseConfig) => {", "async (config:SupabaseConfig, reload?:{prepare:()=>boolean;committed:()=>void}) => {"], ["if(!await ensureCloudDurableBeforeLeaseRelease('cloud-config-change'))return false;\n    try{", "if(!await ensureCloudDurableBeforeLeaseRelease('cloud-config-change'))return false;\n    let privateReloadCancelled=false;\n    try{"], ["        pendingTaskCreationRunGeneration.current+=1;\n        saveSupabaseConfig(config);\n        window.location.reload();", "        if(reload&&!reload.prepare()){privateReloadCancelled=true;return false;}\n        pendingTaskCreationRunGeneration.current+=1;\n        saveSupabaseConfig(config);\n        reload?.committed();\n        if(!hasPageDraftContext()&&!hasUnsavedWork.current&&!cloudSaveInFlight.current&&!cloudSyncInFlight.current&&!pendingCloudData.current.size()){\n          savePhaseRef.current='saved';\n          setSavePhase('saved');\n        }\n        window.location.reload();"], ["if(!changed)alert('等待期間出現新的待同步要事、關注燈或編輯作業", "if(!changed&&!privateReloadCancelled)alert('等待期間出現新的待同步要事、關注燈或編輯作業"]]){assert.ok(configExpected.includes(a));configExpected=configExpected.replace(a,b);}const configTree=parse(file,configExpected);const init=s=>walk(s,n=>ts.isVariableDeclaration(n)&&n.name.getText(s)==='saveCloudConfiguration').map(n=>print(n.initializer,s));assert.deepEqual(init(b),init(configTree),'exact config handshake only');}
 if(file.endsWith('App.tsx'))for(const name of ['commitManagement','enqueueCloudSave']){const init=s=>walk(s,n=>ts.isVariableDeclaration(n)&&n.name.getText(s)===name).map(n=>print(n.initializer,s));assert.deepEqual(init(b),init(old),name+' preserved');}
 receipts.push({file,jsxRootCount:roots(b).length,exactSubstitutions:replacements.length,originalMutationArgumentsUnchanged:true});
}
assert.equal(execFileSync('git',['diff','--name-only',base,'--','*.css','src/main.tsx','index.html'],{encoding:'utf8'}).trim(),'');
const out={status:'PASS',base,layer:'exact-source-boundary-not-pixel-parity',receipts};fs.writeFileSync(path.join(root,'private-boundary.json'),JSON.stringify(out,null,2));console.log(JSON.stringify(out));
