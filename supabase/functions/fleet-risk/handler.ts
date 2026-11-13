import { collectFleetRisk, sourceFailureCode, sourceFailureDetails } from "./service.ts";

type RpcName = "read_ship_fleet_risk_v1" | "claim_ship_fleet_risk_v1" | "progress_ship_fleet_risk_v1" | "finish_ship_fleet_risk_v1";
export type SnapshotRpc = (name: RpcName, params: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>;
type BackendFailure = "BACKEND_TIMEOUT" | "BACKEND_ABORTED" | "BACKEND_UNAVAILABLE" | "BACKEND_HTTP_ERROR" | "BACKEND_RESPONSE_ERROR";
class SnapshotRpcError extends Error {
  constructor(readonly action: RpcName, readonly reason: BackendFailure) { super(reason); this.name = "SnapshotRpcError"; }
}
export interface FailureDiagnostics {
  phase: "source" | "database" | "worker" | "publication";
  action: string | null;
  reason: string;
  elapsedMs: number;
}
interface Attempt { id: string; trigger: "manual" | "scheduled"; status: string; startedAt: string }
interface State { snapshot: unknown; attempt: Attempt | null; serverTime: string; nextScheduledAt: string }
interface Claim { acquired: boolean; runId: string | null; state: State }
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** Server credential never reaches the browser. */
export function createSnapshotRpc(baseUrl: string, serviceKey: string, transport: typeof fetch = fetch): SnapshotRpc {
  const base = new URL(baseUrl);
  if ((base.protocol !== "https:" && !(base.protocol === "http:" && ["127.0.0.1", "localhost"].includes(base.hostname))) || base.username || base.password || base.search || base.hash || !serviceKey) throw new Error("BACKEND_CONFIGURATION");
  return async (name, params, signal) => {
    const deadline = AbortSignal.timeout(12000);
    const requestSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
    let readingBody = false;
    try {
      const response = await transport(`${base.origin}/rest/v1/rpc/${name}`, {
        method: "POST", cache: "no-store", redirect: "error",
        signal: requestSignal,
        headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, "content-type": "application/json" },
        body: JSON.stringify(params),
      });
      if (!response.ok) { await response.body?.cancel(); throw new SnapshotRpcError(name, "BACKEND_HTTP_ERROR"); }
      readingBody = true;
      return await response.json();
    } catch (error) {
      if (error instanceof SnapshotRpcError) throw error;
      const reason: BackendFailure = requestSignal.aborted
        ? (requestSignal.reason instanceof Error && requestSignal.reason.name === "TimeoutError" ? "BACKEND_TIMEOUT" : "BACKEND_ABORTED")
        : readingBody ? "BACKEND_RESPONSE_ERROR" : "BACKEND_UNAVAILABLE";
      throw new SnapshotRpcError(name, reason);
    }
  };
}
async function readBody(request: Request): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("INVALID_REQUEST");
  const deadline = AbortSignal.timeout(5000);
  const abort = () => { void reader.cancel().catch(() => {}); };
  deadline.addEventListener("abort", abort, { once: true });
  try {
    let size = 0, text = "";
    const decoder = new TextDecoder();
    while (true) {
      const chunk = await reader.read();
      if (deadline.aborted) throw new Error("INVALID_REQUEST");
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 4096) throw new Error("INVALID_REQUEST");
      text += decoder.decode(chunk.value, { stream: true });
    }
    const value = JSON.parse(text + decoder.decode());
    if (!object(value)) throw new Error("INVALID_REQUEST");
    return value;
  } finally { deadline.removeEventListener("abort", abort); await reader.cancel().catch(() => {}); }
}
function claimValue(value: unknown): Claim {
  if (!object(value) || typeof value.acquired !== "boolean" || !(value.runId === null || uuid(value.runId)) || !object(value.state)) throw new Error("BACKEND_PROTOCOL");
  const state = value.state;
  if (typeof state.serverTime !== "string" || !Number.isFinite(Date.parse(state.serverTime)) || typeof state.nextScheduledAt !== "string" || !("snapshot" in state) || !("attempt" in state)) throw new Error("BACKEND_PROTOCOL");
  if (value.acquired && (!uuid(value.runId) || !object(state.attempt) || state.attempt.id !== value.runId || state.attempt.status !== "running" || !["manual", "scheduled"].includes(String(state.attempt.trigger)) || typeof state.attempt.startedAt !== "string" || !Number.isFinite(Date.parse(state.attempt.startedAt)))) throw new Error("BACKEND_PROTOCOL");
  return value as unknown as Claim;
}
function failureCode(error: unknown): string {
  const code = error instanceof SnapshotRpcError ? error.reason : sourceFailureCode(error);
  if (/TIMEOUT/.test(code) || (error instanceof Error && error.name === "TimeoutError")) return "timeout";
  if (/COVERAGE|INCOMPLETE|COUNT_MISMATCH/.test(code)) return "incomplete_snapshot";
  if (error instanceof Error && error.message === "INVALID_SNAPSHOT") return "invalid_snapshot";
  return "upstream_unavailable";
}
export function createSnapshotHandler(options: {
  rpc: SnapshotRpc; waitUntil: (job: Promise<void>) => void;
  collector?: typeof collectFleetRisk; allowedOrigins?: string[]; schedulerToken?: string;
  onFailure?: (runId: string, code: string, diagnostic: FailureDiagnostics) => void;
}) {
  const { rpc } = options;
  const collector = options.collector ?? collectFleetRisk;
  const origins = new Set(options.allowedOrigins ?? ["https://ttwonder.github.io"]);
  const run = async (claim: Claim, invocationStartedAt: number): Promise<void> => {
    const runId = claim.runId!;
    // Independent of the initiating browser's abort signal.
    const controller = new AbortController();
    // Account for body parsing and claim time too. With the bounded 8s failure
    // settlement this targets 143s at the application layer. The host can still
    // terminate earlier; this cannot extend the platform worker lifetime.
    const remaining = Math.max(0, 135000 - (performance.now() - invocationStartedAt));
    const expire = () => controller.abort(new DOMException("Worker deadline", "TimeoutError"));
    const timer = setTimeout(expire, remaining);
    if (!remaining) expire();
    try {
      const collected = await collector({ signal: controller.signal, concurrency: 3, onProgress: async (done, total) => {
        const accepted = await rpc("progress_ship_fleet_risk_v1", { p_run_id: runId, p_done: done, p_total: total }, controller.signal);
        if (accepted !== true) { controller.abort(new Error("STALE_RUN")); throw new Error("STALE_RUN"); }
      } });
      const current = await rpc("read_ship_fleet_risk_v1", {}, controller.signal) as State;
      if (current?.attempt?.id !== runId || current.attempt.status !== "running" || !current.serverTime) throw new Error("STALE_RUN");
      const snapshot = { id: runId, trigger: claim.state.attempt!.trigger,
        queryStartedAt: claim.state.attempt!.startedAt, // Preserve database microseconds.
        queryCompletedAt: current.serverTime, ...collected };
      if (await rpc("finish_ship_fleet_risk_v1", { p_run_id: runId, p_snapshot: snapshot, p_error: null }, controller.signal) !== true) throw new Error("INVALID_SNAPSHOT");
    } catch (error) {
      const workerExpired = controller.signal.aborted && controller.signal.reason instanceof Error
        && controller.signal.reason.name === "TimeoutError" && controller.signal.reason.message === "Worker deadline";
      const source = sourceFailureDetails(error);
      const diagnostic: FailureDiagnostics = {
        ...(workerExpired ? { phase: "worker" as const, action: null, reason: "WORKER_TIMEOUT" }
          : error instanceof SnapshotRpcError ? { phase: "database" as const, action: error.action, reason: error.reason }
          : error instanceof Error && error.message === "INVALID_SNAPSHOT" ? { phase: "publication" as const, action: null, reason: "INVALID_SNAPSHOT" }
          : { phase: "source" as const, ...source }),
        elapsedMs: Math.round(performance.now() - invocationStartedAt),
      };
      controller.abort(error);
      const code = workerExpired ? "timeout" : failureCode(error);
      // Same-run CAS is harmless after replacement or a committed lost ACK.
      try { await rpc("finish_ship_fleet_risk_v1", { p_run_id: runId, p_snapshot: null, p_error: code }, AbortSignal.timeout(8000)); } catch { /* Read projection reports lease expiry if DB is unavailable. */ }
      options.onFailure?.(runId, code, diagnostic);
    } finally { clearTimeout(timer); }
  };
  return async (request: Request): Promise<Response> => {
    const invocationStartedAt = performance.now();
    const origin = request.headers.get("origin");
    const headers = new Headers({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store", vary: "Origin" });
    const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
    const deny = (status: number, error: string) => respond(status, { ok: false, error });
    if (origin && !origins.has(origin)) return deny(403, "ORIGIN_NOT_ALLOWED");
    if (origin) {
      headers.set("access-control-allow-origin", origin);
      headers.set("access-control-allow-methods", "POST, OPTIONS");
      headers.set("access-control-allow-headers", "authorization, apikey, content-type, x-client-info, x-application-name");
    }
    if (request.method === "OPTIONS") return origin ? new Response(null, { status: 204, headers }) : deny(403, "ORIGIN_REQUIRED");
    if (request.method !== "POST") { headers.set("allow", "POST, OPTIONS"); return deny(405, "METHOD_NOT_ALLOWED"); }
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return deny(415, "JSON_REQUIRED");
    let body: Record<string, unknown>;
    try { body = await readBody(request); } catch { return deny(400, "INVALID_REQUEST"); }
    let trigger: "manual" | "scheduled", requestId: string;
    if (body.action === "scheduled") {
      if (!options.schedulerToken || request.headers.get("x-fleet-scheduler-token") !== options.schedulerToken) return deny(403, "SCHEDULE_AUTH_REQUIRED");
      if (Object.keys(body).some(key => key !== "action")) return deny(400, "INVALID_REQUEST");
      trigger = "scheduled"; requestId = crypto.randomUUID();
    } else if (body.action === "refresh") {
      if (!origin) return deny(403, "ORIGIN_REQUIRED");
      if (!uuid(body.requestId) || Object.keys(body).some(key => !["action", "requestId"].includes(key))) return deny(400, "INVALID_REQUEST");
      trigger = "manual"; requestId = body.requestId;
    } else return deny(400, "INVALID_REQUEST");
    try {
      const claim = claimValue(await rpc("claim_ship_fleet_risk_v1", { p_trigger: trigger, p_request_id: requestId }));
      if (claim.acquired) options.waitUntil(run(claim, invocationStartedAt));
      return respond(claim.acquired ? 202 : 200, { ok: true, state: claim.state, runId: claim.runId, started: claim.acquired });
    } catch { return deny(503, "BACKEND_UNAVAILABLE"); }
  };
}
