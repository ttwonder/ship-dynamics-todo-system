import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import ts from 'typescript';import {createHash} from 'node:crypto';
const base='460539b063cb8281f7b85ab3efc5d84117632b4f',root=process.env.QA_EVIDENCE_ROOT;assert.ok(root&&path.isAbsolute(root));fs.mkdirSync(root,{recursive:true});
const printer=ts.createPrinter(),parse=(name,text)=>ts.createSourceFile(name,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),canonical=(n,sf)=>printer.printNode(ts.EmitHint.Unspecified,n,sf);
const report={base,scope:'unchanged visible JSX/source boundaries; not pixel-parity or independent review',files:{}};
for(const file of ['src/App.tsx','src/Management.tsx']){
 const before=execFileSync('git',['show',base+':'+file],{encoding:'utf8'}),after=fs.readFileSync(file,'utf8'),a=parse(file,before),b=parse(file,after);
 const walk=(sf,pred)=>{const result=[];const visit=n=>{if(pred(n))result.push(n);ts.forEachChild(n,visit);};visit(sf);return result;};
 const jsx=sf=>walk(sf,n=>ts.isJsxOpeningElement(n)||ts.isJsxSelfClosingElement(n));const left=jsx(a),right=jsx(b);assert.equal(right.length,left.length,file+' JSX element count');const exceptions=[];
 const allowed=(tag,key)=>file==='src/App.tsx'?tag==='ManagementView'&&['commit','captureCommitContext'].includes(key):
 (tag==='OwnerSettings'&&['captureDraft','captureContinuation','captureCommitContext'].includes(key))||
 (['TaskCategoryManager','EquipmentSubcategoryManager'].includes(tag)&&['key','onSave'].includes(key))||
 (tag==='div'&&key==='key')||(tag==='button'&&key==='onClick')||
 (['PersonEditor','VesselEditor'].includes(tag)&&key==='setDraft')||(tag==='RolePermissionMatrix'&&key==='onChange');
 for(let i=0;i<left.length;i++){
  const x=left[i],y=right[i],tag=x.tagName.getText(a);assert.equal(y.tagName.getText(b),tag);
  const attrs=(n,sf)=>Object.fromEntries(n.attributes.properties.map(p=>[p.name?.getText(sf)||'spread',canonical(p,sf)])),old=attrs(x,a),now=attrs(y,b);
  for(const key of new Set([...Object.keys(old),...Object.keys(now)]))if(old[key]!==now[key]){assert.ok(allowed(tag,key),`${file} unapproved ${tag}.${key}`);exceptions.push({element:i,tag,attribute:key,before:old[key]||null,after:now[key]||null});}
 }
 assert.deepEqual(walk(a,ts.isJsxText).map(n=>n.text.replaceAll('\r\n','\n')),walk(b,ts.isJsxText).map(n=>n.text.replaceAll('\r\n','\n')),file+' exact visible text');
 if(file.endsWith('Management.tsx')){
  const commits=sf=>walk(sf,n=>ts.isCallExpression(n)&&n.expression.getText(sf)==='commit').map(n=>n.arguments.slice(0,5).map(arg=>canonical(arg,sf)));
  assert.deepEqual(commits(b),commits(a),'every original mutation/audit argument remains exact');assert.equal(commits(b).length,11);assert.equal(commits(b).filter(args=>/creatingUser|creatingVessel/.test(args[1])).length,2,'two create/update shared callsites give thirteen action classes');
 }else{
  const init=(sf,name)=>walk(sf,n=>ts.isVariableDeclaration(n)&&n.name.getText(sf)===name).map(n=>canonical(n.initializer,sf));
  for(const name of ['commit','enqueueCloudSave','saveCloudConfiguration'])assert.deepEqual(init(a,name),init(b,name),name+' unchanged');
  let stripped=after.replace(/  \/\/ Only Management intents serialize here;[\s\S]*?(?=  const liveCreatingTaskId)/,'').replace(/  const captureManagementContext=[\s\S]*?(?=  const mutationLeaseIsOwned)/,'').replace('commit={commitManagement} captureCommitContext={captureManagementContext}','commit={commit}');
  assert.equal(stripped.replaceAll('\r\n','\n'),before.replaceAll('\r\n','\n'),'App all other source bytes unchanged');
 }
 report.files[file]={jsxElements:left.length,allowedInternalChanges:exceptions,sourceSHA256:createHash('sha256').update(JSON.stringify(after)).digest('hex')};
}
report.status='PASS';fs.writeFileSync(path.join(root,'boundary.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:'PASS',elements:Object.fromEntries(Object.entries(report.files).map(([p,v])=>[p,v.jsxElements])),commitCallsites:11,actionClasses:13}));
