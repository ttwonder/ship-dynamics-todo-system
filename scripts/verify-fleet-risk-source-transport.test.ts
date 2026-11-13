import { EventEmitter } from 'node:events';
import type { request as HttpsRequest } from 'node:https';
import { gzipSync } from 'node:zlib';
import { createFleetRiskHandler } from '../supabase/functions/fleet-risk/service.ts';

// Optional external diagnostic baseline; final run imports the production adapter.
const module = await import(Deno.args[1] ?? '../supabase/functions/fleet-risk/sourceFetch.ts');
const createSourceFetch = module.createSourceFetch ?? module.createBufferedSourceFetch;
const encode = (text: string) => new TextEncoder().encode(text);
const target = 'https://apcis.tmou.org/public/?action=getships';
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function rejected(promise: Promise<unknown>) {
  try { await promise; } catch (error) { return error as Error; }
  throw new Error('Expected rejection, not successful/partial source bytes');
}
function transport(options: { body?: Uint8Array; headers?: string[]; hold?: boolean; holdHeaders?: boolean; closeEarly?: boolean; status?: number } = {}) {
  const body = options.body ?? encode('ok');
  const calls: { url: URL; options: Record<string, unknown>; body?: Uint8Array }[] = [];
  let responseDestroyed = false, requestDestroyed = false;
  const response = Object.assign(new EventEmitter(), {
    statusCode: options.status ?? 200,
    rawHeaders: options.headers ?? ['Content-Type', 'text/html', 'Content-Length', String(body.length)],
    destroy() { if (!responseDestroyed) { responseDestroyed = true; response.emit('close'); } return response; },
  });
  const req = Object.assign(new EventEmitter(), {
    end: (_body?: Uint8Array) => req,
    destroy() { requestDestroyed = true; return req; },
  });
  let deliverHeaders: (() => void) | undefined;
  const request = ((url: URL, init: Record<string, unknown>, callback: (r: unknown) => void) => {
    const call = { url, options: init, body: undefined as Uint8Array | undefined }; calls.push(call);
    deliverHeaders = () => {
      callback(response);
      if (!responseDestroyed && !options.hold) {
        response.emit('data', body);
        if (!options.closeEarly) response.emit('end');
        response.emit('close');
      }
    };
    req.end = payload => { call.body = payload; if (!options.holdHeaders) queueMicrotask(() => deliverHeaders?.()); return req; };
    return req;
  }) as unknown as typeof HttpsRequest;
  return { fetch: createSourceFetch(request) as typeof fetch, calls, response, req,
    deliverHeaders: () => deliverHeaders?.(), responseDestroyed: () => responseDestroyed, requestDestroyed: () => requestDestroyed };
}

Deno.test('gzip is decoded completely with exact request fields and separate cookies', async () => {
  const text = '<html>' + 'source row '.repeat(4000) + '</html>', compressed = gzipSync(encode(text));
  const t = transport({ body: compressed, headers: ['Content-Type','text/html','Content-Encoding','gzip','Content-Length',String(compressed.length),'Set-Cookie','a=1; Path=/public/','Set-Cookie','b=2; Path=/public/'] });
  const response = await t.fetch(target, { method:'POST', headers:{ cookie:'synthetic=only' }, body:'name=FPMC' });
  assert(await response.text() === text, 'Must deliver the entire decoded body');
  assert(!response.headers.has('content-encoding') && !response.headers.has('content-length'), 'No stale compressed headers');
  assert(response.headers.getSetCookie().length === 2, 'Do not merge Set-Cookie');
  const c = t.calls[0], h = c.options.headers as Record<string,string>;
  assert(c.url.href === target && new TextDecoder().decode(c.body) === 'name=FPMC', 'Query/body identity retained');
  assert(h['accept-encoding'] === 'gzip' && h.connection === 'close' && h.cookie === 'synthetic=only' && h['content-length'] === '9', 'Bounded compatibility request');
  assert(c.options.agent === false && !('rejectUnauthorized' in c.options), 'Independent connection and default certificate verification');
});
Deno.test('uncompressed complete source remains supported', async () => {
  const response = await transport().fetch(target); assert(await response.text() === 'ok', 'Identity response');
});
Deno.test('non-source targets and unsupported actions never open a connection', async () => {
  const t = transport();
  for (const url of ['https://evil.invalid/public/','http://apcis.tmou.org/public/','https://apcis.tmou.org/private/','https://apcis.tmou.org/public/?action=getship&action=login','https://apcis.tmou.org/public/?action=putnews','https://apcis.tmou.org/public/?other=1','https://user:pass@apcis.tmou.org/public/']) await rejected(t.fetch(url));
  await rejected(t.fetch(target,{method:'DELETE'}));
  assert(t.calls.length === 0, 'No socket opened for invalid target');
});
Deno.test('truncated encoded bytes are never returned as a successful body', async () => {
  const t = transport({body:encode('partial'),headers:['Content-Type','text/html','Content-Length','100']});
  assert((await rejected(t.fetch(target))).message === 'SOURCE_BODY_INCOMPLETE', 'Require advertised length');
  assert(t.responseDestroyed() && t.requestDestroyed(), 'Close both sides');
});
Deno.test('early close before end fails closed', async () => {
  const t = transport({closeEarly:true});
  assert((await rejected(t.fetch(target))).message === 'SOURCE_BODY_CLOSED', 'No partial publication');
});
Deno.test('unsupported encoding fails closed', async () => {
  const t = transport({headers:['Content-Type','text/html','Content-Encoding','br']});
  assert((await rejected(t.fetch(target))).message === 'SOURCE_ENCODING_UNSUPPORTED', 'No unrequested decoder');
});
Deno.test('corrupt gzip is rejected', async () => {
  const t = transport({body:encode('not gzip'),headers:['Content-Type','text/html','Content-Encoding','gzip']});
  await rejected(t.fetch(target)); assert(t.responseDestroyed(), 'Dispose corrupt stream');
});
Deno.test('deadline before response headers destroys request and any late response', async () => {
  const t = transport({holdHeaders:true}), controller = new AbortController();
  const result = rejected(t.fetch(target,{signal:controller.signal})); controller.abort(new DOMException('Source deadline','TimeoutError'));
  assert((await result).name === 'TimeoutError' && t.requestDestroyed(), 'Original deadline propagated');
  t.deliverHeaders(); assert(t.responseDestroyed(), 'Late response is also closed');
});
Deno.test('deadline after headers closes a stalled body without partial success', async () => {
  const t = transport({hold:true}), controller = new AbortController();
  const result = rejected(t.fetch(target,{signal:controller.signal})); await Promise.resolve();
  t.response.emit('data',encode('partial')); controller.abort(new DOMException('Source deadline','TimeoutError'));
  assert((await result).name === 'TimeoutError' && t.requestDestroyed() && t.responseDestroyed(), 'Abort owns request and body');
});
Deno.test('repeated late native errors remain handled after cancellation', async () => {
  const t = transport({hold:true}), controller = new AbortController();
  const result = rejected(t.fetch(target,{signal:controller.signal})); await Promise.resolve(); controller.abort(); await result;
  t.response.emit('error',new Error('late body 1')); t.response.emit('error',new Error('late body 2'));
  t.req.emit('error',new Error('late request 1')); t.req.emit('error',new Error('late request 2'));
});
Deno.test('cancellation remains active during asynchronous gzip decoding', async () => {
  const body = gzipSync(encode('bounded source '.repeat(10000)));
  const t = transport({body,headers:['Content-Type','text/html','Content-Encoding','gzip','Content-Length',String(body.length)]});
  const controller = new AbortController(), result = rejected(t.fetch(target,{signal:controller.signal}));
  await Promise.resolve(); controller.abort(new DOMException('Source deadline','TimeoutError'));
  assert((await result).name === 'TimeoutError' && t.requestDestroyed(), 'Do not publish after decoding is cancelled');
});
Deno.test('truncated gzip with matching wire length is rejected', async () => {
  const body = gzipSync(encode('source content')).subarray(0,-5);
  const t = transport({body,headers:['Content-Type','text/html','Content-Encoding','gzip','Content-Length',String(body.length)]});
  assert((await rejected(t.fetch(target))).message === 'SOURCE_ENCODING_INVALID', 'Require a complete gzip stream');
});
Deno.test('redirects never open another source or location', async () => {
  const t = transport({status:302,hold:true,headers:['Location','https://evil.invalid/']});
  assert((await rejected(t.fetch(target))).message === 'SOURCE_REDIRECT_REJECTED' && t.calls.length===1 && t.requestDestroyed(), 'Reject without follow');
});
Deno.test('already cancelled request does not open a connection', async () => {
  const t = transport(), controller = new AbortController(); controller.abort();
  await rejected(t.fetch(target,{signal:controller.signal})); assert(t.calls.length === 0, 'No socket after abort');
});

async function roster(fetchImpl: typeof fetch) {
  return await createFleetRiskHandler({fetchImpl})(new Request('https://local.invalid',{method:'POST',headers:{origin:'https://ttwonder.github.io','content-type':'application/json'},body:JSON.stringify({action:'roster',queryId:'6a8f166b-83ee-4da5-8f91-b227e5c09df1'})}));
}
Deno.test('original handler preserves wire body size-limit diagnosis', async () => {
  const t = transport({body:new Uint8Array(1024*1024+1),headers:['Content-Type','text/html']});
  const response = await roster(t.fetch), data = await response.json();
  assert(response.status === 502 && data.error === 'SOURCE_BODY_TOO_LARGE', `Size diagnosis lost: ${data.error}`);
  assert(t.calls.length === 1, 'No follow-on query');
});
Deno.test('original handler preserves decompressed size-limit diagnosis', async () => {
  const compressed = gzipSync(new Uint8Array(1024*1024+1));
  const t = transport({body:compressed,headers:['Content-Type','text/html','Content-Encoding','gzip','Content-Length',String(compressed.length)]});
  const response = await roster(t.fetch), data = await response.json();
  assert(response.status === 502 && data.error === 'SOURCE_BODY_TOO_LARGE', `Decoded limit diagnosis lost: ${data.error}`);
});
Deno.test('adapter itself bounds decoded bytes before returning a Response', async () => {
  const compressed = gzipSync(new Uint8Array(1024*1024+1));
  const t = transport({body:compressed,headers:['Content-Type','text/html','Content-Encoding','gzip','Content-Length',String(compressed.length)]});
  const error = await rejected(t.fetch(target));
  assert(error.message === 'SOURCE_BODY_TOO_LARGE', 'Decoder must enforce its own output limit');
});
Deno.test('raw native errors do not leak through original handler', async () => {
  const t = transport({holdHeaders:true}), task = roster(t.fetch);
  for (let i=0; i<10 && t.calls.length===0; i++) await new Promise(resolve=>setTimeout(resolve,0));
  assert(t.calls.length===1,'Original handler reached the controlled transport');
  t.req.emit('error',new Error('private-cookie-and-token'));
  const response = await task, data = await response.json();
  assert(data.error === 'SOURCE_UNAVAILABLE' && !JSON.stringify(data).includes('private'), 'Only allowlisted diagnosis');
});
