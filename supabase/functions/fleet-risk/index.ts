import { createSnapshotHandler, createSnapshotRpc } from "./handler.ts";

declare const EdgeRuntime: { waitUntil(job: Promise<unknown>): void };
let handler: ((request: Request) => Promise<Response>) | null = null;
try {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const schedulerToken = Deno.env.get("FLEET_RISK_SCHEDULER_TOKEN") ?? "";
  const allowedOrigins = (Deno.env.get("FLEET_RISK_ALLOWED_ORIGINS") ?? "https://ttwonder.github.io").split(",").map(value => value.trim()).filter(Boolean);
  if (!url || !key || !schedulerToken || typeof EdgeRuntime === "undefined" || typeof EdgeRuntime.waitUntil !== "function") throw new Error("CONFIGURATION_REQUIRED");
  handler = createSnapshotHandler({
    rpc: createSnapshotRpc(url, key), allowedOrigins, schedulerToken,
    waitUntil: job => EdgeRuntime.waitUntil(job),
    onFailure: (runId, code, diagnostic) => console.warn("FLEET_RISK_RUN_FAILED", { runId, code, ...diagnostic }),
  });
} catch {
  console.error("FLEET_RISK_CONFIGURATION_REQUIRED");
}
Deno.serve(request => handler ? handler(request) : new Response(JSON.stringify({ ok: false, error: "CONFIGURATION_REQUIRED" }), {
  status: 503, headers: { "content-type": "application/json", "cache-control": "no-store" },
}));
