import { createFleetRiskHandler } from '../supabase/functions/fleet-risk/service.ts';
import { createSnapshotHandler, createSnapshotRpc } from '../supabase/functions/fleet-risk/handler.ts';

const fixtures = new URL(Deno.args[0] ?? '../../psc-risk-20261110/', import.meta.url);
const read = (name: string) => Deno.readTextFile(new URL(name, fixtures));
const origin = 'https://ttwonder.github.io';
const runId = '6a8f166b-83ee-4da5-8f91-b227e5c09df1';
function assert(value: unknown, note: string): asserts value { if (!value) throw new Error(note); }

// Controlled time compression, not measured public-source/hosted latency.
async function clock<T>(fn: (sleep: (ms: number) => Promise<void>, durations: number[]) => Promise<T>): Promise<T> {
  const original = globalThis.setTimeout, originalClear = globalThis.clearTimeout, signalTimeout = AbortSignal.timeout;
  const timers = new Set<number>(), durations: number[] = [];
  const scaled = ((callback: Parameters<typeof setTimeout>[0], ms = 0, ...args: unknown[]) => {
    durations.push(ms);
    const id = original(callback, ms / 100, ...args); timers.add(id); return id;
  }) as typeof setTimeout;
  globalThis.setTimeout = scaled;
  AbortSignal.timeout = (ms: number) => {
    const controller = new AbortController();
    scaled(() => controller.abort(new DOMException('Synthetic deadline', 'TimeoutError')), ms);
    return controller.signal;
  };
  try { return await fn(ms => new Promise(resolve => { const id = original(resolve, ms / 100); timers.add(id); }), durations); }
  finally { globalThis.setTimeout = original; AbortSignal.timeout = signalTimeout; for (const timer of timers) originalClear(timer); }
}
async function replay(delayAction?: string) {
  const bodies: Record<string, string> = {};
  for (const [key, name] of Object.entries({entry:'autonomous-entry.html',login:'autonomous-entry-result.html',getcompanies:'autonomous-company-search.html',page0:'autonomous-ships-page0.html',page1:'autonomous-ships-page1.html'})) bodies[key] = await read(name);
  const calls: string[] = [];
  return { calls, fetch: (sleep: (ms: number) => Promise<void>): typeof fetch => async (input, init) => {
    const action = new URL(String(input)).searchParams.get('action') ?? 'entry';
    const fields = new URLSearchParams(String(init?.body ?? ''));
    const key = action === 'getships' ? `page${fields.get('Page')}` : action;
    calls.push(key);
    if (key === delayAction) await sleep(20000);
    if (init?.signal?.aborted) throw init.signal.reason;
    assert(bodies[key], `Unexpected replay key ${key}`);
    return new Response(bodies[key], { headers: { 'content-type':'text/html' } });
  } };
}
function request(action: 'refresh' | 'scheduled') {
  return new Request('https://local.invalid/fleet-risk', { method:'POST', headers:{'content-type':'application/json', ...(action === 'refresh' ? {origin} : {'x-fleet-scheduler-token':'synthetic-schedule-token'})}, body:JSON.stringify(action === 'refresh' ? {action,requestId:runId} : {action}) });
}

Deno.test('source request completing after 20s is accepted with the complete original roster', async () => {
  const source = await replay('page0');
  await clock(async (sleep, durations) => {
    const result = await createFleetRiskHandler({fetchImpl:source.fetch(sleep)})(new Request('https://local.invalid', {method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({action:'roster',queryId:runId})}));
    const body = await result.json();
    assert(result.status === 200, `20s source response was cut off: ${body.error}`);
    assert(body.declaredTotal === 39 && body.ships.length === 39, 'Complete roster required');
    assert(durations.includes(45000) && durations.includes(125000), '45s per-source and 125s legacy handler caps must remain finite');
  });
});

Deno.test('source body is covered by the extended deadline, not headers alone', async () => {
  await clock(async () => {
    let cancelled = false;
    const result = await createFleetRiskHandler({fetchImpl:async () => new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('<html>'));},cancel(){cancelled=true;}}),{headers:{'content-type':'text/html'}})})(new Request('https://local.invalid',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({action:'roster',queryId:runId})}));
    assert(result.status === 504 && (await result.json()).error === 'SOURCE_TIMEOUT', 'Hung body must still time out');
    assert(cancelled, 'Timed-out response body must be cancelled');
  });
});

Deno.test('database response at 9s succeeds under the new 12s bound', async () => {
  await clock(async (sleep, durations) => {
    const rpc = createSnapshotRpc('https://fixture.invalid','synthetic-server-key', async (_input, init) => {
      await sleep(9000);
      if (init?.signal?.aborted) throw init.signal.reason;
      return new Response('true',{headers:{'content-type':'application/json'}});
    });
    assert(await rpc('progress_ship_fleet_risk_v1',{}) === true, 'Progress after 9s must be accepted');
    assert(durations.includes(12000), 'Database RPC deadline must be 12s');
  });
});

for (const action of ['refresh','scheduled'] as const) Deno.test(`${action}: work finishing after 128s can publish under the shared 135s invocation limit`, async () => {
  await clock(async (sleep, durations) => {
    const jobs: Promise<void>[] = [], writes: Record<string,unknown>[] = [];
    const state = {snapshot:null,attempt:{id:runId,trigger:action === 'scheduled'?'scheduled':'manual',status:'running',startedAt:'2026-11-13T00:00:00.123456Z'},serverTime:'2026-11-13T00:02:08Z',nextScheduledAt:'2026-11-13T23:00:00Z'};
    const handler = createSnapshotHandler({schedulerToken:'synthetic-schedule-token',waitUntil:p=>jobs.push(p),rpc:async (name,p) => {
      if (name === 'claim_ship_fleet_risk_v1') return {acquired:true,runId,state};
      if (name === 'read_ship_fleet_risk_v1') return state;
      if (name === 'finish_ship_fleet_risk_v1') writes.push(p);
      return true;
    },collector:async ({signal}) => {
      await sleep(128000);
      if (signal.aborted) throw signal.reason;
      return {company:{name:'Synthetic fleet',imo:'0882415',performance:'Medium'},rosterRetrievedAt:'2026-11-13T00:00:01Z',count:0,rows:[],coverage:{referenceCount:0,missingReferenceImos:[],addedReferenceImos:[]}};
    }});
    assert((await handler(request(action))).status === 202, 'Acquired work starts asynchronously');
    await Promise.all(jobs);
    assert(writes.length === 1 && writes[0].p_snapshot !== null, `${action} work was prematurely timed out`);
    assert(durations.some(ms => ms > 130000 && ms <= 135000), 'Shared invocation deadline must be <=135s');
  });
});

Deno.test('failure diagnostics distinguish the exact source action without raw errors or cookies', async () => {
  const source = await replay();
  await clock(async (sleep) => {
    const normal = source.fetch(sleep), jobs: Promise<void>[] = [], failures: unknown[][] = [];
    const state = {snapshot:{id:'last-good'},attempt:{id:runId,trigger:'manual',status:'running',startedAt:'2026-11-13T00:00:00Z'},serverTime:'2026-11-13T00:00:00Z',nextScheduledAt:'2026-11-13T23:00:00Z'};
    const handler = createSnapshotHandler({waitUntil:p=>jobs.push(p),rpc:async (name) => name === 'claim_ship_fleet_risk_v1' ? {acquired:true,runId,state} : true,
      collector:async (options) => {
        const {collectFleetRisk} = await import('../supabase/functions/fleet-risk/service.ts');
        return collectFleetRisk({...options,fetchImpl:async (input,init) => {
          if (new URL(String(input)).searchParams.get('action') === 'getships') return await new Promise<Response>((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(init.signal?.reason),{once:true}));
          return normal(input,init);
        }});
      },onFailure:(...args)=>{failures.push(args);}});
    await handler(request('refresh')); await Promise.all(jobs);
    assert(failures.length === 1, 'One terminal failure log');
    const diagnostic = failures[0][2] as Record<string,unknown> | undefined;
    assert(diagnostic?.phase === 'source' && diagnostic.action === 'getships' && diagnostic.reason === 'SOURCE_TIMEOUT', `Missing sanitized source-stage diagnosis: ${JSON.stringify(diagnostic)}`);
  });
});


Deno.test('database timeout is distinguished from source failure and never retries a writer', async () => {
  await clock(async () => {
    const jobs: Promise<void>[] = [], failures: unknown[][] = [], writerCalls: string[] = [];
    const state = {snapshot:{id:'last-good'},attempt:{id:runId,trigger:'manual',status:'running',startedAt:'2026-11-13T00:00:00Z'},serverTime:'2026-11-13T00:00:00Z',nextScheduledAt:'2026-11-13T23:00:00Z'};
    const rpc = createSnapshotRpc('https://fixture.invalid','synthetic-server-key', async (input,init) => {
      const name = new URL(String(input)).pathname.split('/').at(-1)!;
      if (name === 'claim_ship_fleet_risk_v1') return new Response(JSON.stringify({acquired:true,runId,state}));
      writerCalls.push(name);
      if (name === 'progress_ship_fleet_risk_v1') return await new Promise<Response>((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(init.signal?.reason),{once:true}));
      return new Response('true');
    });
    const handler = createSnapshotHandler({rpc,waitUntil:p=>jobs.push(p),collector:async ({onProgress})=>{
      await onProgress?.(0,39); throw new Error('Must not get past timed-out progress');
    },onFailure:(...args)=>failures.push(args)});
    await handler(request('refresh')); await Promise.all(jobs);
    const diagnostic = failures[0]?.[2] as Record<string,unknown>;
    assert(failures[0]?.[1] === 'timeout' && diagnostic.phase === 'database' && diagnostic.action === 'progress_ship_fleet_risk_v1' && diagnostic.reason === 'BACKEND_TIMEOUT', 'Exact database operation required');
    assert(writerCalls.filter(name=>name === 'progress_ship_fleet_risk_v1').length === 1, 'No retry of unconfirmed writer');
    assert(writerCalls.filter(name=>name === 'finish_ship_fleet_risk_v1').length === 1, 'One failure settlement only');
    assert(!JSON.stringify(failures).includes('synthetic-server-key'), 'No credential leaks');
  });
});

Deno.test('database response body remains subject to the 12s timeout', async () => {
  await clock(async () => {
    const rpc = createSnapshotRpc('https://fixture.invalid','synthetic-server-key', async (_input, init) => new Response(new ReadableStream({start(controller){
      controller.enqueue(new TextEncoder().encode('{'));
      init?.signal?.addEventListener('abort',()=>controller.error(init.signal?.reason),{once:true});
    }})));
    let message = '';
    try { await rpc('read_ship_fleet_risk_v1',{}); } catch (error) { message = (error as Error).message; }
    assert(message === 'BACKEND_TIMEOUT', 'Slow body must not be diagnosed as a completed successful read');
  });
});

Deno.test('135s worker bound counts time spent before collection and retains an 8s failure settlement cap', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(performance,'now');
  let elapsed = 0;
  Object.defineProperty(performance,'now',{configurable:true,value:()=>elapsed});
  try { await clock(async (_sleep,durations) => {
    const jobs: Promise<void>[] = [], writes: Record<string,unknown>[] = [], failures: unknown[][] = [];
    const state = {snapshot:{id:'last-good'},attempt:{id:runId,trigger:'scheduled',status:'running',startedAt:'2026-11-13T00:00:00Z'},serverTime:'2026-11-13T00:00:09Z',nextScheduledAt:'2026-11-13T23:00:00Z'};
    const handler = createSnapshotHandler({schedulerToken:'synthetic-schedule-token',waitUntil:p=>jobs.push(p),rpc:async (name,p)=>{
      if(name === 'claim_ship_fleet_risk_v1'){elapsed=9000;return {acquired:true,runId,state};}
      if(name === 'finish_ship_fleet_risk_v1')writes.push(p);
      return true;
    },collector:({signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true})),onFailure:(...args)=>failures.push(args)});
    await handler(request('scheduled')); await Promise.all(jobs);
    assert(durations.includes(126000), '135s minus 9s preparation, not a new full worker budget');
    assert(durations.includes(8000), 'Bounded independent failure settlement');
    assert(writes.length === 1 && writes[0].p_snapshot === null && writes[0].p_error === 'timeout', 'No partial or late publication');
    const diagnostic=failures[0]?.[2] as Record<string,unknown>;
    assert(diagnostic.phase === 'worker' && diagnostic.reason === 'WORKER_TIMEOUT', 'Worker cap distinguished from source/RPC cap');
  }); } finally { if(descriptor)Object.defineProperty(performance,'now',descriptor);else delete (performance as unknown as Record<string,unknown>).now; }
});

Deno.test('raw database exception is reduced to safe metadata', async () => {
  const rpc = createSnapshotRpc('https://fixture.invalid','synthetic-server-key',()=>Promise.reject(new Error('private-token / raw response body / secret-cookie')));
  let caught: unknown;
  try { await rpc('read_ship_fleet_risk_v1',{}); } catch(error) { caught=error; }
  assert(caught instanceof Error && caught.message === 'BACKEND_UNAVAILABLE', 'Raw exception must not escape');
  assert(!JSON.stringify(caught).includes('private-token'), 'No raw secret in diagnostics');
});
