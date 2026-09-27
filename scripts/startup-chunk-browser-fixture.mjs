import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

export function installStartupBuildFixture(qa,receipt,directory=process.env.QA_UI_DIST){
 const root=fs.realpathSync(directory);
 assert.ok(!root.toLowerCase().startsWith(fs.realpathSync('.').toLowerCase()+path.sep),'Build QA artifacts must stay outside the product repository');
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'.vite/manifest.json'),'utf8'));
 const files=new Set(Object.values(manifest).flatMap(m=>[m.file,...(m.css||[]),...(m.assets||[])]));
 for(const entry of ['index.html','ship-itinerary.html','ship-internal-control.html','packageorwork-tracking.html','app-version.json'])files.add(entry);
 receipt.builtUi={kind:'original-production-build-with-loopback-config',inputs:Object.fromEntries([...files].map(file=>[file,createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')]))};
 const faults=new Set();
 qa.setUiMiddleware((request,response)=>{
  const file=decodeURIComponent(new URL(request.url,qa.origin).pathname).replace(/^\/+/, '')||'index.html';
  if(!files.has(file)){response.statusCode=404;response.end('QA_ASSET_NOT_FOUND');return;}
  if(faults.delete(file)){response.statusCode=503;response.end('QA_ASSET_DOWNLOAD_FAILURE');return;}
  const ext=path.extname(file),mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.svg':'image/svg+xml'}[ext]||'application/octet-stream';
  response.setHeader('Content-Type',mime);
  response.setHeader('Cache-Control','no-store');
  let body=fs.readFileSync(path.join(root,file));
  if(ext==='.html')body=Buffer.from(body.toString('utf8').replace('<body>','<body><aside id="isolated-qa-label" style="position:fixed;z-index:2147483647;bottom:0;right:0;background:#442200;color:white;padding:4px 10px;font:12px sans-serif;pointer-events:none">真實 UI＋測試資料｜本機 SQL；非正式環境</aside>'));
  response.end(body);
 });
 return {manifest,failNext:name=>{const match=Object.values(manifest).filter(m=>m.name===name);assert.equal(match.length,1);faults.add(match[0].file);}};
}
