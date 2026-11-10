import * as source from '../supabase/functions/fleet-risk/service.ts';
const fixtures=new URL(Deno.args[0] ?? '../../psc-risk-20261110/',import.meta.url);
const file=(name:string)=>Deno.readTextFile(new URL(name,fixtures));
Deno.test('public-entry readiness is respected before the first company query',async()=>{
  let loginAt=0,companyDelay=0,companyAccepted=false;
  const fetchImpl:typeof fetch=async(input)=>{
    const action=new URL(String(input)).searchParams.get('action')||'entry';
    if(action==='getships'){companyAccepted=true;throw new Error('STOP_AFTER_COMPANY');}
    if(action==='getcompanies'){
      companyDelay=performance.now()-loginAt;
      if(companyDelay<1200)return new Response('',{status:500,headers:{'content-type':'text/html'}});
      return new Response(await file('autonomous-company-search.html'),{headers:{'content-type':'text/html'}});
    }
    const body=await file(action==='entry'?'autonomous-entry.html':'autonomous-entry-result.html');
    if(action==='login')loginAt=performance.now();
    return new Response(body,{headers:{'content-type':'text/html'}});
  };
  try{await source.collectFleetRisk({signal:new AbortController().signal,fetchImpl,concurrency:3});}catch{/* Stop after the validated company; do not query the fleet. */}
  assert(companyAccepted,`source company query happened too soon after entry (${Math.round(companyDelay)}ms)`);
});
function assert(value:unknown,message:string):asserts value{if(!value)throw new Error(message);}
Deno.test('whole-fleet collector publishes only a complete fresh batch, with bounded concurrency',async()=>{
  const collect=(source as Record<string,unknown>).collectFleetRisk as (input:Record<string,unknown>)=>Promise<any>;
  assert(typeof collect==='function','missing complete concurrent collector');
  const roster=JSON.parse(await file('autonomous-live-roster.json')).rows;
  const bodies:Record<string,string>={entry:await file('autonomous-entry.html'),login:await file('autonomous-entry-result.html'),getcompanies:await file('autonomous-company-search.html'),page0:await file('autonomous-ships-page0.html'),page1:await file('autonomous-ships-page1.html')};
  for(const ship of roster)bodies[ship.huid]=await file(`live-ship-${ship.imo}.html`);
  let active=0,maxActive=0,entries=0,failImo=false,lastQueryStarted=-Infinity;
  const activeSessions=new Set<string>();
  const progress:number[]=[];
  const fetchImpl:typeof fetch=async(input,init)=>{
    const action=new URL(String(input)).searchParams.get('action')||'entry';
    const data=new URLSearchParams(String(init?.body||''));
    if(['getcompanies','getships','getship'].includes(action)){
      const now=performance.now();
      if(now-lastQueryStarted<1000)return new Response('',{status:500,headers:{'content-type':'text/html'}});
      lastQueryStarted=now;
    }
    if(action==='entry')entries++;
    let key=action==='getships'?'page'+data.get('Page'):action==='getship'?data.get('HUID')!:action;
    if(action==='getship'){
      const cookie=new Headers(init?.headers).get('cookie')||'';
      if(!cookie||activeSessions.has(cookie))return new Response('',{status:500,headers:{'content-type':'text/html'}});
      activeSessions.add(cookie);
      active++;maxActive=Math.max(active,maxActive);
      try{await new Promise<void>((resolve,reject)=>{const done=()=>{init?.signal?.removeEventListener('abort',abort);resolve();};const timer=setTimeout(done,1800);const abort=()=>{clearTimeout(timer);init?.signal?.removeEventListener('abort',abort);reject(new Error('fixture fetch aborted'));};init?.signal?.addEventListener('abort',abort,{once:true});if(init?.signal?.aborted)abort();});}finally{active--;activeSessions.delete(cookie);}
      if(failImo&&key===roster[0].huid)return new Response('not a ship',{headers:{'content-type':'text/html'}});
    }
    assert(bodies[key],'fixture exists '+key);
    return new Response(bodies[key],{headers:{'content-type':'text/html',...(action==='entry'?{'set-cookie':`qa_session=local-${entries}; Path=/public/`}:{})}});
  };
  const result=await collect({fetchImpl,signal:new AbortController().signal,concurrency:3,onProgress:(done:number)=>{progress.push(done);}});
  assert(result.rows.length===39,'all declared vessels, no partial result');
  assert(entries===3,'three independent bounded worker sessions, not a new session per ship');
  assert(maxActive>=2&&maxActive<=3,'overlapping calls remain within the approved two-to-three active detail range');
  assert(progress.length===40&&progress.every((n,i)=>n===i),'progress monotonic including roster');
  assert(result.rows.find((r:any)=>r.imo==='9528378').risk==='SRS','current header, not historical HRS');
  failImo=true;let failure='';try{await collect({fetchImpl,signal:new AbortController().signal,concurrency:3});}catch(error){failure=(error as Error).message;}
  assert(!!failure,'one invalid source rejects whole new snapshot');
  assert(active===0,'no dangling detail calls after rejection');
});
