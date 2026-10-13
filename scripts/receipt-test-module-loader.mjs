import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

// Narrow QA-only loader for the two real, dependency-free client modules.
// Avoid Vite's Windows native-addon lifecycle in these pure-helper assertions.
// The original App/browser and production build still use the actual Vite stack.
const allowed=new Set(['src/cloudBlockReceipt.ts','src/cloudSyncError.ts']);
const cache=new Map();
export function loadReceiptTestModule(relative){
  if(!allowed.has(relative))throw new Error('Module outside the declared receipt QA seam');
  if(cache.has(relative))return cache.get(relative).exports;
  const filename=path.resolve(relative),module={exports:{}};
  cache.set(relative,module);
  const localRequire=specifier=>{
    if(!specifier.startsWith('.'))throw new Error('Unexpected dependency in pure receipt module');
    const target=path.relative(process.cwd(),path.resolve(path.dirname(filename),specifier+'.ts')).replaceAll('\\','/');
    return loadReceiptTestModule(target);
  };
  const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},fileName:filename}).outputText;
  // Reviewed local repository source only; no user/page/service strings enter
  // executable code. Same JS realm preserves Error/instanceof semantics.
  new Function('require','module','exports',code)(localRequire,module,module.exports);
  return module.exports;
}
