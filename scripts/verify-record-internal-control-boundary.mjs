import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';

const base='c73928d78c078a1c80c1464df24bee075cdec639';
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'});
const source=path=>fs.readFileSync(path,'utf8').replace(/\r\n/g,'\n');
const parse=(path,text)=>ts.createSourceFile(path,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const jsx=(path,text)=>{const file=parse(path,text),values=[];const visit=node=>{if(ts.isJsxElement(node)||ts.isJsxSelfClosingElement(node)||ts.isJsxFragment(node)){values.push(node.getText(file));return;}ts.forEachChild(node,visit);};visit(file);return values;};
const permitted=new Set(['src/App.tsx','src/InternalControlPage.tsx']);
const paths=git('ls-tree','-r','--name-only',base,'src','public','supabase','index.html','ship-itinerary.html').trim().split('\n');
let jsxBlocks=0,jsxFiles=0;
for(const path of paths){
 const originalBytes=execFileSync('git',['show',base+':'+path]),currentBytes=fs.readFileSync(path);
 if(originalBytes.includes(0)){assert.deepEqual(currentBytes,originalBytes,'unchanged binary '+path);continue;}
 const before=originalBytes.toString('utf8'),now=source(path);
 if(/\.(tsx|jsx)$/.test(path)){const expected=jsx(path,before);assert.deepEqual(jsx(path,now),expected,'exact JSX boundary '+path);jsxFiles++;jsxBlocks+=expected.length;}
 if(!permitted.has(path))assert.equal(now,before,'unchanged root/source/style/public/SQL '+path);
}
assert.match(source('src/main.tsx'),/import App from ['"]\.\/App/);
console.log(JSON.stringify({gate:'exact original UI and SQL boundary',base,checkedPaths:paths.length,jsxFiles,jsxBlocks,nonJsxLogicOnly:[...permitted]}));

// Execute only trusted local repository expressions parsed by TypeScript.
// No browser/fixture/user data is interpolated into executable source.
// Execute the actual App handoff predicate, not a parallel implementation.
const app=source('src/App.tsx'),file=parse('src/App.tsx',app),variables=new Map();
const visit=node=>{if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.initializer)variables.set(node.name.text,node.initializer.getText(file));ts.forEachChild(node,visit);};visit(file);
const transpile=text=>ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const exports={};new Function('exports',transpile(source('src/durableRelatedMutation.ts')))(exports);
const lease={sectionKey:'task:t1',leaseOwnerId:'owner-token',ownerUserId:'qa-owner',authorizationEpoch:'records-v1|key-a|qa-owner',generation:4};
let current=true;const ref={current:exports.createDurableRelatedMutationHandoff(lease,()=>current,'delete')};
const matches=new Function('relatedMutationHandoffInFlight','relatedMutationLeaseMatches',transpile('return '+variables.get('relatedMutationHandoffMatchesCurrent')))(ref,exports.relatedMutationLeaseMatches);
const cases=[];assert.equal(matches(lease),true);cases.push('pending same-owner handoff retained');
ref.current.finish(false,false);assert.equal(matches(lease),true);cases.push('unconfirmed rejected same-owner handoff retained');
for(const field of Object.keys(lease)){const changed={...lease,[field]:typeof lease[field]==='number'?99:'wrong-'+lease[field]};assert.equal(matches(changed),false);cases.push('mismatched '+field+' cannot retain');}
current=false;assert.equal(matches(lease),false);cases.push('revoked current ownership cannot retain');current=true;
ref.current=exports.createDurableRelatedMutationHandoff(lease,()=>current,'delete');ref.current.finish(true,true);assert.equal(matches(lease),false);cases.push('confirmed handoff no longer retained');
// Execute the actual retained-task initializer with exact section and current handoff.
const retained=new Function('activeEditLock','editingTaskId','relatedMutationHandoffMatchesCurrent','confirmedCloudData',transpile('return '+variables.get('retainedRelatedTask')));
const task={id:'t1',description:'confirmed'},confirmedCloudData={current:{tasks:[task]}};
assert.equal(retained(lease,'t1',()=>true,confirmedCloudData),task);assert.equal(retained({...lease,sectionKey:'task:t2'},'t1',()=>true,confirmedCloudData),undefined);assert.equal(retained(lease,'t1',()=>false,confirmedCloudData),undefined);cases.push('task fallback uses only exact entity and current handoff');
assert.equal(new Set(cases).size,10);
console.log(JSON.stringify({gate:'actual App source-executed lifecycle predicates; not mounted/SQL',cases}));
