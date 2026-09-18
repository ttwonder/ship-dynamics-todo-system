import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createServer} from 'vite';
const server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
try{
 assert.equal(fs.existsSync('src/cloudRevisionPoll.ts'),true,'parked shore lists need a minimal revision fallback when hosted Realtime is absent');
 const {startRecordRevisionPoll}=await server.ssrLoadModule('/src/cloudRevisionPoll.ts');
 let tick,visible=true,cleared=0,resolve,reads=0,signal;const revisions=[];
 const clock={every:(fn,ms)=>{assert.equal(ms,15000);tick=fn;return 1;},clear:()=>cleared++,visible:()=>visible};
 const stop=startRecordRevisionPoll(s=>{reads++;signal=s;return new Promise(r=>{resolve=r;});},r=>revisions.push(r),clock);
 visible=false;await tick();assert.equal(reads,0);visible=true;
 const first=tick();await tick();assert.equal(reads,1,'at most one read in flight');resolve(7);await first;assert.deepEqual(revisions,[7]);
 const next=tick();stop();assert.equal(signal.aborted,true);resolve(8);await next;assert.deepEqual(revisions,[7],'late results after cleanup cannot wake a new context');assert.equal(cleared,1);
 let absentCalls=0;startRecordRevisionPoll(async()=>{absentCalls++;return null;},()=>assert.fail('missing capability is not a revision'),clock);await tick();await tick();assert.equal(absentCalls,1,'missing additive SQL disables only fallback, not the existing app');
 const cloud=fs.readFileSync('src/cloud.ts','utf8');assert.ok(cloud.includes('read_ship_dynamics_internal_control_public_revision_v1')&&cloud.includes('startRecordRevisionPoll'),'production revision subscription must wire the real RPC through the same wakeup callback');
 console.log('PASS record revision polling: visible-only, single-flight, late cleanup fence, missing SQL compatibility and shared wakeup wiring');
}finally{await server.close();}
