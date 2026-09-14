import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createHash} from 'node:crypto';
const inputs=['scripts/verify-meeting-pdf-density.mjs','src/styles.css','src/TemporaryMeetings.tsx','scripts/verify-selected-list-pdf.mjs','src/WorkCenter.tsx'];
const texts=Object.fromEntries(inputs.map(p=>[p,fs.readFileSync(p,'utf8')]));
const ast=ts.createSourceFile('verify.mjs',texts[inputs[0]],ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const executable=ast.statements.filter(n=>!ts.isImportDeclaration(n)).map(n=>n.getFullText(ast)).join('\n');
const cases=[],failures=[];
function check(id,fn){try{fn();cases.push({id,status:'PASS'});}catch(e){cases.push({id,status:'FAIL'});failures.push({id,message:e.message});}}
function replaceOnce(source,from,to){assert.equal(source.split(from).length,2,'mutation must replace one original occurrence');return source.replace(from,to);}
const runPdf=styles=>vm.runInNewContext(executable,{assert,fs:{readFileSync:p=>p==='src/styles.css'?styles:texts[p]},console:{log:()=>{}}},{timeout:1000});
const styles=texts['src/styles.css'];
check('PDF-current-compact-style',()=>assert.doesNotThrow(()=>runPdf(styles)));
check('PDF-unrelated-small-print-allowed',()=>assert.doesNotThrow(()=>runPdf(styles+'\n@media print{body.printing-other .other{font-size:6pt}}')));
check('PDF-target-7pt-rejected',()=>assert.throws(()=>runPdf(replaceOnce(styles,'body.printing-meeting-detail .meeting-print-page{font-size:9.5pt','body.printing-meeting-detail .meeting-print-page{font-size:7pt'))));
check('PDF-target-fractional-7pt-rejected',()=>assert.throws(()=>runPdf(replaceOnce(styles,'body.printing-meeting-detail .meeting-print-meta small{font-size:8.5pt','body.printing-meeting-detail .meeting-print-meta small{font-size:7.9pt'))));
check('PDF-late-target-override-rejected',()=>assert.throws(()=>runPdf(styles+'\n@media print{body.printing-meeting-detail .meeting-print-page{font-size:7pt}}')));
check('PDF-scope-absence-rejected',()=>assert.throws(()=>runPdf(styles.replaceAll('body.printing-meeting-detail','body.printing-other'))));
check('PDF-large-px-allowed',()=>assert.doesNotThrow(()=>runPdf(replaceOnce(styles,'body.printing-meeting-detail .meeting-print-page{font-size:9.5pt','body.printing-meeting-detail .meeting-print-page{font-size:16px'))));
check('PDF-small-px-rejected',()=>assert.throws(()=>runPdf(replaceOnce(styles,'body.printing-meeting-detail .meeting-print-page{font-size:9.5pt','body.printing-meeting-detail .meeting-print-page{font-size:10px'))));

const selectedAst=ts.createSourceFile('selected.mjs',texts['scripts/verify-selected-list-pdf.mjs'],ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),selectionAsserts=[];
function visit(node){if(ts.isCallExpression(node)&&node.expression.getText(selectedAst)==='assert.ok'&&ts.isStringLiteral(node.arguments.at(-1))&&node.arguments.at(-1).text.startsWith('all visible rows must remain selectable'))selectionAsserts.push(node.getText(selectedAst));ts.forEachChild(node,visit);}visit(selectedAst);
assert.equal(selectionAsserts.length,1,'execute the actual selection assertion, not a copied replacement oracle');
const runSelection=workCenter=>vm.runInNewContext(selectionAsserts[0],{assert,workCenter},{timeout:1000}),work=texts['src/WorkCenter.tsx'];
check('SELECT-current-guarded-dispatch',()=>assert.doesNotThrow(()=>runSelection(work)));
const mutations=[
 ['SELECT-complete-unfiltered','runSelected(completableSelectedTasks,canComplete,onBatchComplete)','runSelected(selectedTasks,canComplete,onBatchComplete)'],
 ['SELECT-no-member-filter','const completableSelectedTasks=selectedTasks.filter(task=>!usesPerVesselProgress(task));','const completableSelectedTasks=selectedTasks;'],
 ['SELECT-wrong-callback','runSelected(completableSelectedTasks,canComplete,onBatchComplete)','runSelected(completableSelectedTasks,canComplete,onBatchDelete)'],
 ['SELECT-permission-bypass','runSelected(completableSelectedTasks,canComplete,onBatchComplete)','runSelected(completableSelectedTasks,true,onBatchComplete)'],
 ['SELECT-wrong-task-ids','submit(tasks.map(t=>t.id),selectedInternalCases.map(c=>c.id))','submit(selectedTasks.map(t=>t.id),selectedInternalCases.map(c=>c.id))'],
 ['SELECT-lost-case-ids','submit(tasks.map(t=>t.id),selectedInternalCases.map(c=>c.id))','submit(tasks.map(t=>t.id),[])'],
 ['SELECT-wrong-button','onClick={completeSelected}','onClick={deleteSelected}'],
 ['SELECT-dismiss-filtered','runSelected(selectedTasks,true,onDismiss)','runSelected(completableSelectedTasks,true,onDismiss)'],
];
for(const [id,from,to] of mutations)check(id,()=>assert.throws(()=>runSelection(replaceOnce(work,from,to))));
console.log(JSON.stringify({layer:'source-contract counterfactuals; no UI/SQL and no source mutations on disk',cases,count:cases.length,failures,inputs:Object.fromEntries(inputs.map(p=>[p,createHash('sha256').update(fs.readFileSync(p)).digest('hex')]))}));
assert.deepEqual(failures,[]);
