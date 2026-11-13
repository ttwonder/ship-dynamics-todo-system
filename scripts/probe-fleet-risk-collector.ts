import {collectFleetRisk,sourceFailureDetails} from '../supabase/functions/fleet-risk/service.ts';
// Explicit opt-in real official reads; never used by offline tests or application startup.
const output=Deno.args[0];
if(!output||!Deno.args.includes('--live'))throw new Error('Usage: <external evidence directory> --live');
const root=new URL(output.endsWith('/')?output:output+'/');
if(root.protocol!=='file:')throw new Error('Absolute file URL required');
const started=new Date().toISOString(),clock=performance.now(),controller=new AbortController();
let active=0,maxConcurrent=0,requests=0;
const http:{action:string;status:number;contentType:string|null}[]=[];
const fetchImpl:typeof fetch=async(input,init)=>{
  const url=new URL(String(input));if(url.origin!=='https://apcis.tmou.org')throw new Error('Unexpected source host');
  active++;requests++;maxConcurrent=Math.max(active,maxConcurrent);
  try{const response=await fetch(input,init);http.push({action:url.searchParams.get('action')||'entry',status:response.status,contentType:response.headers.get('content-type')});return response;}finally{active--;}
};
try{
  const collected=await collectFleetRisk({signal:controller.signal,fetchImpl,concurrency:3,onProgress:(done,total)=>{if(done===0||done%10===0||done===total)console.log(`Official source progress ${done}/${total}`);}});
  const snapshot={id:crypto.randomUUID(),trigger:'manual',queryStartedAt:started,queryCompletedAt:new Date().toISOString(),...collected};
  const counts=Object.fromEntries(['HRS','SRS','LRS'].map(risk=>[risk,snapshot.rows.filter(row=>row.risk===risk).length]));
  await Deno.mkdir(root,{recursive:true});
  await Deno.writeTextFile(new URL('live-collected-snapshot.json',root),JSON.stringify(snapshot,null,2));
  const receipt={layer:'Real official Tokyo source via production collector; no Supabase/cron contacted',status:'PASS',count:snapshot.count,counts,maxConcurrent,requests,elapsedSeconds:Math.round((performance.now()-clock)/100)/10,startedAt:started,completedAt:snapshot.queryCompletedAt,snapshotFile:new URL('live-collected-snapshot.json',root).href};
  await Deno.writeTextFile(new URL('live-collector-receipt.json',root),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt,null,2));
}catch(error){const receipt={status:'FAIL',diagnostic:sourceFailureDetails(error),error:error instanceof Error?error.message:String(error),http,startedAt:started,elapsedSeconds:Math.round((performance.now()-clock)/100)/10};await Deno.mkdir(root,{recursive:true});await Deno.writeTextFile(new URL('live-collector-failure.json',root),JSON.stringify(receipt,null,2));console.error(JSON.stringify(receipt,null,2));throw error;}
