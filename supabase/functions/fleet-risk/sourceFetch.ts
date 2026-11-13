import { request as httpsRequest } from "node:https";

type TransportCode = "SOURCE_REQUEST_BOUNDARY" | "SOURCE_REDIRECT_REJECTED" | "SOURCE_BODY_TOO_LARGE"
  | "SOURCE_BODY_INCOMPLETE" | "SOURCE_BODY_CLOSED" | "SOURCE_ENCODING_UNSUPPORTED" | "SOURCE_ENCODING_INVALID";
export class SourceTransportError extends Error {
  constructor(readonly code: TransportCode) { super(code); this.name = "SourceTransportError"; }
}
const LIMIT = 1024 * 1024;
const join = (chunks: Uint8Array[], size: number) => {
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
};

/** Fixed public APCIS HTTP/1.1 transport. No proxy, redirects, TLS bypass or retry.
 * A fresh connection and gzip avoid the observed incomplete identity responses.
 * Wire and decoded bodies are bounded; caller cancellation covers both phases.
 */
export function createSourceFetch(requestImpl: typeof httpsRequest = httpsRequest): typeof fetch {
  return (input, init) => {
    const url = new URL(String(input));
    if (url.origin !== "https://apcis.tmou.org" || url.pathname !== "/public/" || url.username || url.password || url.hash
      || [...url.searchParams.keys()].some(key => key !== "action") || url.searchParams.getAll("action").length > 1
      || (url.search && !["login", "getcompanies", "getships", "getship"].includes(url.searchParams.get("action") ?? ""))
      || !["GET", "POST"].includes(init?.method ?? "GET") || (init?.body !== undefined && typeof init.body !== "string")) {
      return Promise.reject(new SourceTransportError("SOURCE_REQUEST_BOUNDARY"));
    }
    const signal = init?.signal;
    if (signal?.aborted) return Promise.reject(signal.reason);
    const headers = Object.fromEntries(new Headers(init?.headers));
    headers["accept-encoding"] = "gzip"; headers["connection"] = "close";
    const payload = init?.body === undefined ? undefined : new TextEncoder().encode(init.body as string);
    if (payload) headers["content-length"] = String(payload.byteLength);
    return new Promise<Response>((resolve, reject) => {
      let settled = false, nativeEnded = false;
      let response: import("node:http").IncomingMessage | undefined;
      let request: import("node:http").ClientRequest | undefined;
      let decoder: ReadableStreamDefaultReader<Uint8Array> | undefined;
      const chunks: Uint8Array[] = []; let size = 0;
      const cleanup = () => signal?.removeEventListener("abort", abort);
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true; cleanup(); chunks.length = 0; reject(error);
        void decoder?.cancel().catch(() => {});
        response?.destroy(); request?.destroy();
      };
      const abort = () => fail(signal?.reason ?? new DOMException("Source aborted", "AbortError"));
      const decode = async (bytes: Uint8Array): Promise<Uint8Array> => {
        // Deno's node:zlib maxOutputLength is not enforced on every supported
        // runtime. Count streamed decoded bytes instead of trusting that option.
        decoder = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")).getReader();
        const decoded: Uint8Array[] = []; let decodedSize = 0;
        try {
          while (true) {
            const next = await decoder.read();
            if (settled) throw signal?.reason ?? new DOMException("Source aborted", "AbortError");
            if (next.done) return join(decoded, decodedSize);
            decodedSize += next.value.byteLength;
            if (decodedSize > LIMIT) throw new SourceTransportError("SOURCE_BODY_TOO_LARGE");
            decoded.push(next.value);
          }
        } catch (error) {
          await decoder.cancel().catch(() => {});
          throw error instanceof SourceTransportError || signal?.aborted ? error : new SourceTransportError("SOURCE_ENCODING_INVALID");
        } finally { decoder.releaseLock(); decoder = undefined; }
      };
      signal?.addEventListener("abort", abort, { once: true });
      try {
        // Cancellation explicitly owns request and response, including late
        // native errors; do not delegate it to the compatibility-layer signal.
        request = requestImpl(url, { method: init?.method ?? "GET", headers, agent: false }, incoming => {
          response = incoming;
          incoming.on("error", fail);
          incoming.once("aborted", () => fail(new SourceTransportError("SOURCE_BODY_CLOSED")));
          incoming.once("close", () => { if (!nativeEnded) fail(new SourceTransportError("SOURCE_BODY_CLOSED")); });
          if (settled) { incoming.destroy(); return; }
          try {
            const responseHeaders = new Headers();
            for (let i = 0; i < incoming.rawHeaders.length; i += 2) responseHeaders.append(incoming.rawHeaders[i], incoming.rawHeaders[i + 1]);
            if ((incoming.statusCode ?? 0) >= 300 && (incoming.statusCode ?? 0) < 400) throw new SourceTransportError("SOURCE_REDIRECT_REJECTED");
            const encoding = responseHeaders.get("content-encoding")?.toLowerCase();
            if (encoding && !["identity", "gzip"].includes(encoding)) throw new SourceTransportError("SOURCE_ENCODING_UNSUPPORTED");
            const length = responseHeaders.get("content-length");
            if (length !== null && (!/^\d+$/.test(length) || Number(length) > LIMIT)) throw new SourceTransportError("SOURCE_BODY_TOO_LARGE");
            incoming.on("data", (chunk: Uint8Array) => {
              if (settled) return;
              size += chunk.byteLength;
              if (size > LIMIT) { fail(new SourceTransportError("SOURCE_BODY_TOO_LARGE")); return; }
              chunks.push(new Uint8Array(chunk));
            });
            incoming.once("end", () => {
              nativeEnded = true;
              if (settled) return;
              void (async () => {
                try {
                  if (length !== null && size !== Number(length)) throw new SourceTransportError("SOURCE_BODY_INCOMPLETE");
                  const bytes = join(chunks, size); chunks.length = 0;
                  const decoded = encoding === "gzip" ? await decode(bytes) : bytes;
                  if (settled) return;
                  if (encoding === "gzip") { responseHeaders.delete("content-encoding"); responseHeaders.delete("content-length"); }
                  const result = new Response(decoded, { status: incoming.statusCode, headers: responseHeaders });
                  settled = true; cleanup(); resolve(result);
                } catch (error) { fail(error); }
              })();
            });
          } catch (error) { fail(error); }
        });
        request.on("error", fail);
        if (settled) request.destroy();
        else if (signal?.aborted) abort();
        else request.end(payload);
      } catch (error) { fail(error); }
    });
  };
}
export const sourceFetch = createSourceFetch();
