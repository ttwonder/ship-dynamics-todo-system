// Test-only process bridge: original Deno collector, real source, no cloud credentials.
import { collectFleetRisk, sourceFailureCode } from '../supabase/functions/fleet-risk/service.ts';
if (!Deno.args.includes('--live')) throw new Error('Explicit --live required');
let active=0,maxConcurrent=0,requests=0;
const startedAt=new Date().toISOString(),clock=performance.now();
const http:{action:string;status:number;lane:number;startMs:number;elapsedMs:number}[]=[];
const lanes=new Map<string,number>();
try {
 const collected=await collectFleetRisk({signal:new AbortController().signal,concurrency:3,
  fetchImpl:async(input,init)=>{
   const url=new URL(String(input));
   if(url.origin!=='https://apcis.tmou.org'||url.pathname!=='/public/')throw new Error('SOURCE_ALLOWLIST');
   const cookie=new Headers(init?.headers).get('cookie')||'';
   if(cookie&&!lanes.has(cookie))lanes.set(cookie,lanes.size+1);
   const start=performance.now();
   active++;requests++;maxConcurrent=Math.max(maxConcurrent,active);
   try{const response=await fetch(input,init);http.push({action:url.searchParams.get('action')||'entry',status:response.status,lane:lanes.get(cookie)||0,startMs:start-clock,elapsedMs:performance.now()-start});return response;}finally{active--;}
  },onProgress:(done,total)=>{console.log(JSON.stringify({kind:'progress',done,total}));},
 });
 console.log(JSON.stringify({kind:'result',collected,metrics:{startedAt,completedAt:new Date().toISOString(),elapsedMs:performance.now()-clock,requests,maxConcurrent,http}}));
}catch(error){console.log(JSON.stringify({kind:'failure',code:sourceFailureCode(error),metrics:{requests,maxConcurrent,errorCode:sourceFailureCode(error),http}}));Deno.exitCode=1;}
