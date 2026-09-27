import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {gzipSync} from 'node:zlib';

// Run after `vite build --manifest`. Follow static dependencies, not chunk names
// alone: a dynamic page can accidentally be pulled back into the startup graph.
const root=path.resolve(process.argv[2]||'dist');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'.vite/manifest.json'),'utf8'));
const startup=new Set();
function visit(key){if(startup.has(key))return;assert.ok(manifest[key],key);startup.add(key);for(const dep of manifest[key].imports||[])visit(dep);}
visit('index.html');
const deferred=['TrackingPage','Management','MorningWorkspace','TemporaryMeetings','DataAnalysis','InternalControlPage'];
for(const name of deferred){
 const keys=Object.keys(manifest).filter(key=>manifest[key].name===name);
 assert.equal(keys.length,1,`${name} must have a distinct page chunk`);
 const key=keys[0];
 // A page shared by another HTML entry may have no source/isDynamicEntry fields.
 assert.ok(manifest['index.html'].dynamicImports?.includes(key),`${name} must be dynamically imported by main`);
 assert.ok(!startup.has(key),`${name} must not be a static startup dependency`);
}
const files=[...new Set([...startup].map(key=>manifest[key].file))];
const bytes=files.reduce((n,file)=>n+fs.statSync(path.join(root,file)).size,0);
const gzipBytes=files.reduce((n,file)=>n+gzipSync(fs.readFileSync(path.join(root,file))).length,0);
assert.ok(gzipBytes<420000,`startup JS budget exceeded: ${gzipBytes}`);
for(const entry of ['index.html','ship-itinerary.html','ship-internal-control.html','packageorwork-tracking.html']){
 assert.ok(manifest[entry]?.isEntry,`${entry} remains deployable`);
 assert.ok(fs.existsSync(path.join(root,manifest[entry].file)));
}
console.log(JSON.stringify({status:'PASS',layer:'production-build-static-dependency-graph',deferredPages:deferred.length,startupJsFiles:files,bytes,gzipBytes,allFourEntriesPresent:true,hostedLatencyClaim:false}));
