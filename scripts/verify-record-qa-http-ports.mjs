import assert from 'node:assert/strict';
import fs from 'node:fs';
import {EventEmitter} from 'node:events';
const source=fs.readFileSync(new URL('./record-storage-local-qa.mjs',import.meta.url),'utf8');
const start=source.indexOf('  // Windows can allocate browser/Fetch-blocked'),end=source.indexOf('  origin=`http://127.0.0.1:',start);
assert.ok(start>=0&&end>start,'execute the real QA listener admission block');
const allocate=new (Object.getPrototypeOf(async function(){}).constructor)('http',source.slice(start,end));
class Listener extends EventEmitter{
 constructor(ports){super();this.ports=ports;this.starts=0;this.closes=0;this.listening=false;}
 listen(port,host,ready){assert.equal(port,0);assert.equal(host,'127.0.0.1');this.port=this.ports[this.starts]??this.ports.at(-1);this.starts++;this.listening=true;ready();return this;}
 address(){return this.listening?{port:this.port}:null;}
 close(done){this.closes++;this.listening=false;done();}
}
const cases=[];
for(const [name,ports,starts,closes] of [['safe-port-no-retry',[41000],1,0],['browser-blocked-ports-closed-before-retry',[6667,6000,10080,1720,41000],5,4],['privileged-port-skipped',[80,41000],2,1]]){
 const http=new Listener(ports);await allocate(http);assert.equal(http.address().port,41000);assert.equal(http.starts,starts);assert.equal(http.closes,closes);assert.equal(http.listenerCount('error'),0);cases.push(name);
}
const blocked=new Listener([6667]);await assert.rejects(()=>allocate(blocked),/could not allocate a browser-safe port/);assert.equal(blocked.starts,12);assert.equal(blocked.closes,12);assert.equal(blocked.listening,false);assert.equal(blocked.listenerCount('error'),0);cases.push('bounded-exhaustion-leaves-no-listener');
console.log(JSON.stringify({gate:'record-qa-http-ports',status:'PASS',layer:'actual QA allocation block with simulated listener; real browser checked separately',caseCount:cases.length,cases}));
