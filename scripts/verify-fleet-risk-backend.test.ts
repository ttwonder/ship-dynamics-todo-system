import {
  coverage,
  createFleetRiskHandler,
  parseRosterPage,
  parseShipDetail,
  reconcilePages,
} from "../supabase/functions/fleet-risk/service.ts";
import { REFERENCE_FLEET } from "../supabase/functions/fleet-risk/referenceFleet.ts";
import type { RosterShip } from "../supabase/functions/fleet-risk/types.ts";

// Optional absolute file: URL keeps raw official fixtures outside a future repo copy.
const fixtures = new URL(Deno.args[0] ?? "../../psc-risk-20261110/", import.meta.url);
const fixture = (name: string) => Deno.readTextFile(new URL(name, fixtures));
const queryId = "2c5b124f-1517-4d93-8d2c-254fab725dcb";
const origin = "https://ttwonder.github.io";
const request = (body: unknown, signal?: AbortSignal) =>
  new Request("https://local.invalid/fleet-risk", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
// Controlled HTTP replay of untouched saved official bodies; never a live result.
async function replay(overrides: Record<string, string> = {}) {
  const files: Record<string, string> = {
    entry: "autonomous-entry.html",
    login: "autonomous-entry-result.html",
    getcompanies: "autonomous-company-search.html",
    page0: "autonomous-ships-page0.html",
    page1: "autonomous-ships-page1.html",
  };
  const bodies: Record<string, string> = {};
  for (const [key, file] of Object.entries(files)) bodies[key] = overrides[key] ?? await fixture(file);
  const calls: { action: string; values: Record<string, string>; cookie: string | null; at: number }[] = [];
  let sessions = 0;
  const fetchImpl: typeof fetch = (input, init) => {
    const url = new URL(String(input));
    equal(url.origin + url.pathname, "https://apcis.tmou.org/public/");
    equal(init?.redirect, "manual");
    const action = url.searchParams.get("action") ?? "entry";
    const values = Object.fromEntries(new URLSearchParams(String(init?.body ?? "")));
    const cookie = new Headers(init?.headers).get("cookie");
    calls.push({ action, values, cookie, at: performance.now() });
    if (action === "entry") {
      sessions++;
      equal(cookie, null, "fresh server-only session");
    } else equal(cookie, `fixture_session=${sessions}`);
    if (action === "login") equal(values, { captcha: "6" });
    if (action === "getcompanies") equal(values.compimo, "0882415");
    if (action === "getships") {
      equal(values.name, "FPMC");
      equal(values.compimo, "");
    }
    const key = action === "getships"
      ? `page${values.Page}`
      : action === "getship"
      ? `getship:${values.HUID}`
      : action;
    if (!(key in bodies)) throw new Error(`Unexpected controlled replay action ${action}`);
    const headers = new Headers({ "content-type": "text/html; charset=UTF-8" });
    if (action === "entry") {
      headers.set("set-cookie", `fixture_session=${sessions}; Path=/public/; Secure; HttpOnly`);
    }
    return Promise.resolve(new Response(bodies[key], { headers }));
  };
  return { calls, fetchImpl, bodies };
}

function equal(actual: unknown, expected: unknown, note = "") {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${note}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
function assert(value: unknown, note = "assertion failed"): asserts value {
  if (!value) throw new Error(note);
}

function throws(fn: () => unknown, code: string) {
  let actual = "NO_ERROR";
  try {
    fn();
  } catch (error) {
    actual = (error as Error).message;
  }
  equal(actual, code);
}

Deno.test("current FPMC 28 header is SRS, not historical list/inspection HRS", async () => {
  const html = await fixture("live-ship-9528378.html");
  const list = await fixture("autonomous-ships-page0.html");
  assert(/FPMC 28<\/td>[\s\S]*?High Risk Ship/.test(list), "historical positive control");
  const result = parseShipDetail(html, { name: "FPMC 28", imo: "9528378" });
  equal(result.risk, "SRS");
  equal(result.priority, "No Priority");
  equal(result.companyImo, "0882415");
  equal(result.companyName, "FORMOSA PLASTICS MARINE CORPORATION");
  equal(result.windowFrom, "2026-11-17");
  equal(result.windowTo, "2027-02-17");
  equal(result.sourceUpdatedAt, null);
});

Deno.test("roster handler replays public entry + company + both pages, returns identity-only 39", async () => {
  const transport = await replay();
  const handler = createFleetRiskHandler({ fetchImpl: transport.fetchImpl });
  const response = await handler(request({ action: "roster", queryId }));
  equal(response.status, 200);
  equal(response.headers.get("access-control-allow-origin"), origin);
  equal(response.headers.get("cache-control"), "no-store");
  equal(response.headers.get("vary"), "Origin");
  const result = await response.json();
  equal(result.ok, true);
  equal(result.action, "roster");
  equal(result.queryId, queryId);
  equal(result.declaredTotal, 39);
  equal(result.ships.length, 39);
  equal(result.company, {
    name: "FORMOSA PLASTICS MARINE CORPORATION",
    imo: "0882415",
    performance: "Medium",
  });
  equal(result.coverage, { referenceCount: 39, missingReferenceImos: [], addedReferenceImos: [] });
  equal(result.ships, JSON.parse(await fixture("autonomous-live-roster.json")).rows);
  assert(!JSON.stringify(result).includes("fixture_session"));
  assert(result.queryStartedAt <= result.rosterRetrievedAt);
  equal(transport.calls.map((call) => call.action), [
    "entry",
    "login",
    "getcompanies",
    "getships",
    "getships",
  ]);
});

Deno.test("CORS rejects missing/unlisted origin; allowed OPTIONS has exact public API headers without fetching", async () => {
  let reads = 0;
  const handler = createFleetRiskHandler({
    fetchImpl: () => {
      reads++;
      return Promise.reject(new Error("must not fetch"));
    },
  });
  for (const badOrigin of [null, "https://evil.invalid", "null", "https://ttwonder.github.io.evil.invalid"]) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (badOrigin) headers.origin = badOrigin;
    const response = await handler(
      new Request("https://local.invalid", {
        method: "POST",
        headers,
        body: JSON.stringify({ action: "roster", queryId }),
      }),
    );
    equal(response.status, 403);
    equal(response.headers.get("access-control-allow-origin"), null);
  }
  const preflight = await handler(
    new Request("https://local.invalid", {
      method: "OPTIONS",
      headers: { origin, "access-control-request-method": "POST" },
    }),
  );
  equal(preflight.status, 204);
  equal(preflight.headers.get("access-control-allow-origin"), origin);
  equal(preflight.headers.get("access-control-allow-methods"), "POST, OPTIONS");
  equal(
    preflight.headers.get("access-control-allow-headers"),
    "authorization, apikey, content-type, x-client-info, x-application-name",
  );
  equal((await handler(new Request("https://local.invalid", { headers: { origin } }))).status, 405);
  equal(reads, 0);
});

Deno.test("invalid query, body, arbitrary ship and batch over four are rejected before source reads", async () => {
  let reads = 0;
  const handler = createFleetRiskHandler({
    fetchImpl: () => {
      reads++;
      return Promise.reject(new Error("must not fetch"));
    },
  });
  const ships = await sampleShips();
  const invalid = [
    null,
    [],
    {},
    { action: "other", queryId },
    { action: ["details"], queryId, ships },
    { action: "roster", queryId: "oops" },
    { action: "roster", queryId, url: "http://127.0.0.1" },
    { action: "details", queryId, ships: [] },
    { action: "details", queryId, ships: Array(5).fill(ships[0]) },
    { action: "details", queryId, ships: [ships[0], ships[0]] },
    ...[
      { name: "OTHER SHIP" },
      { name: "FPMC" + "A".repeat(77) },
      { imo: "9528379" },
      { imo: 9528378 },
      { huid: "https://evil.invalid" },
      { huid: "00000000" },
      { name: " FPMC 28" },
      { url: "https://evil.invalid" },
    ]
      .map((change) => ({ action: "details", queryId, ships: [{ ...ships[0], ...change }] })),
  ];
  for (const body of invalid) {
    const response = await handler(request(body));
    equal(response.status, 400, JSON.stringify(body));
    const result = await response.json();
    equal(result.ok, false);
    assert(typeof result.error === "string");
  }
  equal(
    (await handler(
      new Request("https://local.invalid", {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: "{",
      }),
    )).status,
    400,
  );
  equal(
    (await handler(
      new Request("https://local.invalid", {
        method: "POST",
        headers: { origin, "content-type": "text/plain" },
        body: "{}",
      }),
    )).status,
    415,
  );
  equal(reads, 0);
});

Deno.test("bounded input rejects over 16 KiB before any source fetch", async () => {
  let reads = 0;
  const handler = createFleetRiskHandler({
    fetchImpl: () => {
      reads++;
      return Promise.reject(new Error("unused"));
    },
  });
  const response = await handler(request({ action: "roster", queryId, padding: "x".repeat(17000) }));
  equal(response.status, 413);
  equal((await response.json()).error, "REQUEST_BODY_TOO_LARGE");
  equal(reads, 0);
});

Deno.test("bounded source stream stops at 1 MiB and returns a sanitized error", async () => {
  let cancelled = false;

  // Bound the synthetic stream itself for the RED baseline (no unbounded test).
  let chunks = 0;
  const boundedFetch: typeof fetch = () =>
    Promise.resolve(
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            if (chunks++ < 5) controller.enqueue(new Uint8Array(300000));
            else controller.close();
          },
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { "content-type": "text/html" } },
      ),
    );

  const response = await createFleetRiskHandler({ fetchImpl: boundedFetch })(
    request({ action: "roster", queryId }),
  );
  equal(response.status, 502);
  equal(await response.json(), { ok: false, error: "SOURCE_BODY_TOO_LARGE" });
  assert(cancelled);
});

Deno.test("user request abort cancels source read with 499, never leaks the supplied abort reason", async () => {
  const controller = new AbortController();
  const fetchImpl: typeof fetch = (_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    });
  const timer = setTimeout(() => controller.abort(new Error("SECRET_COOKIE_SHOULD_NOT_LEAK")), 15);
  try {
    const response = await createFleetRiskHandler({ fetchImpl })(
      request({ action: "roster", queryId }, controller.signal),
    );
    equal(response.status, 499);
    equal(await response.json(), { ok: false, error: "REQUEST_ABORTED" });
  } finally {
    clearTimeout(timer);
  }
});

Deno.test("15-second source timeout and under-110-second request budget are installed and cleaned up", async () => {
  const original = globalThis.setTimeout;
  const durations: number[] = [];
  globalThis.setTimeout =
    ((handler: Parameters<typeof setTimeout>[0], timeout?: number, ...args: unknown[]) => {
      durations.push(timeout ?? 0);
      return original(handler, timeout === 15000 ? 10 : timeout, ...args);
    }) as typeof setTimeout;
  let timer: number | undefined;
  const fetchImpl: typeof fetch = (_input, init) =>
    new Promise((resolve, reject) => {
      timer = original(
        () => resolve(new Response("synthetic timeout guard", { headers: { "content-type": "text/html" } })),
        80,
      );
      init?.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(init.signal?.reason);
      }, { once: true });
    });
  try {
    const response = await createFleetRiskHandler({ fetchImpl })(request({ action: "roster", queryId }));
    equal(response.status, 504);
    equal((await response.json()).error, "SOURCE_TIMEOUT");
    assert(durations.includes(15000));
    assert(durations.some((ms) => ms > 90000 && ms < 110000));
  } finally {
    globalThis.setTimeout = original;
    clearTimeout(timer);
  }
});

Deno.test("per-isolate concurrency rejects a third request and releases slots after abort", async () => {
  const controllers = [new AbortController(), new AbortController()];
  let starts = 0;
  const fetchImpl: typeof fetch = (_url, init) =>
    new Promise((_resolve, reject) => {
      starts++;
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      if (starts > 2) reject(new Error("third source call must not happen"));
    });
  const handler = createFleetRiskHandler({ fetchImpl });
  const pending = controllers.map((c) => handler(request({ action: "roster", queryId }, c.signal)));
  try {
    await new Promise((resolve) => setTimeout(resolve, 10));
    const response = await createFleetRiskHandler({ fetchImpl })(request({ action: "roster", queryId }));
    equal(response.status, 429);
    equal((await response.json()).error, "BUSY");
    equal(starts, 2);
  } finally {
    controllers.forEach((c) => c.abort());
    await Promise.all(pending);
  }
  const after = await createFleetRiskHandler({ fetchImpl: () => Promise.reject(new Error("synthetic")) })(
    request({ action: "roster", queryId }),
  );
  equal(after.status, 502);
});

Deno.test("source changed to a stronger challenge stops without even submitting arithmetic", async () => {
  const entry = await fixture("autonomous-entry.html");
  const transport = await replay({
    entry: entry.replace(
      "<h4>Please enter",
      '<div class="g-recaptcha" data-sitekey="synthetic-negative"></div><h4>Please enter',
    ),
  });
  const response = await createFleetRiskHandler({ fetchImpl: transport.fetchImpl })(
    request({ action: "roster", queryId }),
  );
  equal(response.status, 502);
  equal((await response.json()).error, "UNSUPPORTED_CHALLENGE");
  equal(transport.calls.length, 1);
});

Deno.test("risk is scoped to current tf header, not a separate earlier synthetic heading", async () => {
  const html = await fixture("live-ship-9528378.html");
  equal(
    parseShipDetail("<h2>High Risk Ship, Priority I</h2>" + html, { name: "FPMC 28", imo: "9528378" }).risk,
    "SRS",
  );
});

Deno.test("roster count/identity/limits fail closed; coverage never fabricates rows", async () => {
  const firstBody = await fixture("autonomous-ships-page0.html");
  const first = parseRosterPage(firstBody);
  const second = parseRosterPage(await fixture("autonomous-ships-page1.html"));
  throws(() => reconcilePages([first]), "ROSTER_COUNT_MISMATCH");
  throws(() => reconcilePages([first, { ...second, declaredTotal: 40 }]), "ROSTER_COUNT_MISMATCH");
  throws(
    () => reconcilePages([first, { ...second, ships: [first.ships[0], ...second.ships.slice(1)] }]),
    "ROSTER_COUNT_MISMATCH",
  );
  throws(() => parseRosterPage(firstBody.replace("Found 39", "Found 101")), "ROSTER_LIMIT_EXCEEDED");
  throws(() => parseRosterPage(firstBody.replace("on 2 page(s)", "on 6 page(s)")), "ROSTER_LIMIT_EXCEEDED");
  throws(() => parseRosterPage(firstBody.replace("9433834", "9433835")), "ROSTER_FORMAT_CHANGED");
  throws(
    () => parseRosterPage(firstBody.replace("Elements from 1 to 25", "Elements from 1 to 26")),
    "ROSTER_COUNT_MISMATCH",
  );
  throws(() => parseRosterPage("No matching records"), "ROSTER_FORMAT_CHANGED");
  equal(
    REFERENCE_FLEET,
    JSON.parse(await fixture("reference-fleet.json")).rows.map((r: RosterShip) => ({
      name: r.name,
      imo: r.imo,
    })),
  );
  const changed = [...REFERENCE_FLEET.slice(1), { name: "FPMC TEST NEW", imo: "1234567" }];
  equal(coverage(changed), {
    referenceCount: 39,
    missingReferenceImos: ["9528366"],
    addedReferenceImos: ["1234567"],
  });
  equal(changed.length, 39);
});

Deno.test("dynamic FPMC addition with a generic non-v4 HUID is source-validated, not reference-authorized", async () => {
  const transport = await replay();
  const ship = { name: "FPMC TEST NEW", imo: "1234567", huid: "00000000-0000-1000-0000-000000000001" };
  transport.bodies[`getship:${ship.huid}`] = (await fixture("live-ship-9528378.html")).replaceAll(
    "FPMC 28",
    ship.name,
  ).replaceAll("9528378", ship.imo);
  const response = await createFleetRiskHandler({ fetchImpl: transport.fetchImpl })(
    request({ action: "details", queryId: crypto.randomUUID(), ships: [ship] }),
  );
  const result = await response.json();
  equal(response.status, 200);
  equal(result.rows[0].status, "ok");
  equal(result.rows[0].name, ship.name);
});

Deno.test("four-row positive batch includes outsourced managers; mismatched identity fails only its row", async () => {
  const saved = JSON.parse(await fixture("autonomous-live-roster.json")).rows as RosterShip[];
  const ships = saved.filter((s) => ["9433834", "9433846", "9528378", "9487677"].includes(s.imo));
  equal(ships.length, 4);
  const transport = await replay();
  for (const ship of ships) {
    transport.bodies[`getship:${ship.huid}`] = await fixture(`live-ship-${ship.imo}.html`);
  }
  transport.bodies[`getship:${ships[2].huid}`] = await fixture("live-ship-9528366.html");
  const result = await (await createFleetRiskHandler({ fetchImpl: transport.fetchImpl })(
    request({ action: "details", queryId, ships }),
  )).json();
  equal(result.rows.length, 4);
  equal(result.rows[0].companyImo, "0104949");
  equal(result.rows[0].risk, "LRS");
  equal(result.rows[2].errorCode, "IDENTITY_MISMATCH");
  equal(result.rows[2].risk, null);
  equal(result.rows[3].status, "ok");
  equal(transport.calls.filter((c) => c.action === "getship").length, 4);
});

Deno.test("image/unknown arithmetic and rejected entry never trigger alternative challenge paths", async () => {
  const original = await fixture("autonomous-entry.html");
  for (
    const entry of [
      original.replace("1 + 5 =", "1 * 5 ="),
      original.replace("<h4>Please enter", '<img src="captcha.php"/><h4>Please enter'),
    ]
  ) {
    const transport = await replay({ entry });
    const response = await createFleetRiskHandler({ fetchImpl: transport.fetchImpl })(
      request({ action: "roster", queryId }),
    );
    equal(response.status, 502);
    equal((await response.json()).error, "UNSUPPORTED_CHALLENGE");
    equal(transport.calls.length, 1);
  }
  const transport = await replay({ login: "<p>Invalid Code</p>" });
  const response = await createFleetRiskHandler({ fetchImpl: transport.fetchImpl })(
    request({ action: "roster", queryId }),
  );
  equal((await response.json()).error, "PUBLIC_ENTRY_FAILED");
  equal(transport.calls.length, 2);
});

Deno.test("off-source redirects, HTTP errors and raw exceptions never expose bodies/cookies", async () => {
  for (
    const [source, code] of [
      [
        new Response("SECRET_COOKIE", { status: 302, headers: { location: "https://evil.invalid" } }),
        "SOURCE_REDIRECT_REJECTED",
      ],
      [new Response("SECRET_COOKIE", { status: 503 }), "SOURCE_HTTP_ERROR"],
      [
        new Response("SECRET_COOKIE", { headers: { "content-type": "application/json" } }),
        "SOURCE_CONTENT_TYPE",
      ],
    ] as const
  ) {
    let calls = 0;
    const response = await createFleetRiskHandler({
      fetchImpl: () => {
        calls++;
        return Promise.resolve(source);
      },
    })(request({ action: "roster", queryId }));
    equal(response.status, 502);
    equal(await response.json(), { ok: false, error: code });
    equal(calls, 1);
    equal(response.headers.get("set-cookie"), null);
  }
  const response = await createFleetRiskHandler({
    fetchImpl: () => Promise.reject(new Error("SECRET_COOKIE")),
  })(request({ action: "roster", queryId }));
  equal(await response.json(), { ok: false, error: "SOURCE_UNAVAILABLE" });
});

Deno.test("source company mismatch and actual handler inconsistent paging fail instead of returning a partial roster", async () => {
  const company = (await fixture("autonomous-company-search.html")).replace(
    "<td>0882415</td>",
    "<td>882415</td>",
  );
  for (
    const [overrides, error] of [[{ getcompanies: company }, "COMPANY_IDENTITY_MISMATCH"], [{
      page1: (await fixture("autonomous-ships-page1.html")).replace("Found 39", "Found 40"),
    }, "ROSTER_COUNT_MISMATCH"]] as const
  ) {
    const transport = await replay(overrides);
    const result = await (await createFleetRiskHandler({ fetchImpl: transport.fetchImpl })(
      request({ action: "roster", queryId }),
    )).json();
    equal(result, { ok: false, error });
  }
});

Deno.test("whole request budget actually aborts an in-progress source call", async () => {
  const original = globalThis.setTimeout;
  globalThis.setTimeout =
    ((callback: Parameters<typeof setTimeout>[0], ms?: number, ...args: unknown[]) =>
      original(callback, ms === 105000 ? 10 : ms, ...args)) as typeof setTimeout;
  try {
    const fetchImpl: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) =>
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true })
      );
    const response = await createFleetRiskHandler({ fetchImpl })(request({ action: "roster", queryId }));
    equal(response.status, 504);
    equal((await response.json()).error, "REQUEST_TIMEOUT");
  } finally {
    globalThis.setTimeout = original;
  }
});

Deno.test("abort during source body and pacing stops without later fetches", async () => {
  for (const duringBody of [true, false]) {
    const controller = new AbortController();
    let calls = 0;
    let cancelled = false;
    const entry = await fixture("autonomous-entry.html");
    const fetchImpl: typeof fetch = () => {
      calls++;
      return Promise.resolve(
        new Response(
          duringBody
            ? new ReadableStream({
              cancel() {
                cancelled = true;
              },
            })
            : entry,
          { headers: { "content-type": "text/html" } },
        ),
      );
    };
    const timer = setTimeout(() => controller.abort(), 20);
    try {
      const response = await createFleetRiskHandler({ fetchImpl })(
        request({ action: "roster", queryId }, controller.signal),
      );
      equal(response.status, 499);
      equal(calls, 1);
      if (duringBody) assert(cancelled);
    } finally {
      clearTimeout(timer);
    }
  }
});

Deno.test("HTML entity decoding preserves source identity and company display text", async () => {
  const html = (await fixture("live-ship-9528378.html")).replaceAll("FPMC 28", "FPMC&#32;28").replaceAll(
    "FORMOSA PLASTICS MARINE CORPORATION",
    "TEST &amp; &#x43;OMPANY",
  );
  equal(parseShipDetail(html, { name: "FPMC 28", imo: "9528378" }).companyName, "TEST & COMPANY");
});

Deno.test("server cookie jar ignores other hosts/paths and expired cookies", async () => {
  const transport = await replay();
  const fetchImpl: typeof fetch = async (url, init) => {
    const response = await transport.fetchImpl(url, init);
    if (String(url) === "https://apcis.tmou.org/public/") {
      response.headers.append("set-cookie", "other_host=secret; Domain=evil.invalid; Path=/");
      response.headers.append("set-cookie", "other_path=secret; Path=/admin/");
      response.headers.append("set-cookie", "expired=secret; Max-Age=0; Path=/");
    }
    return response;
  };
  const result = await createFleetRiskHandler({ fetchImpl })(request({ action: "roster", queryId }));
  equal(result.status, 200);
  assert(!(await result.text()).includes("secret"));
});

async function sampleShips(): Promise<RosterShip[]> {
  const saved = JSON.parse(await fixture("autonomous-live-roster.json"));
  return saved.rows.filter((s: RosterShip) => ["9528378", "9487677"].includes(s.imo));
}
Deno.test("details batch gets a new session, sequential fresh headers, no cached fallback on second query", async () => {
  const ships = await sampleShips();
  const transport = await replay();
  for (const ship of ships) {
    transport.bodies[`getship:${ship.huid}`] = await fixture(`live-ship-${ship.imo}.html`);
  }
  const handler = createFleetRiskHandler({ fetchImpl: transport.fetchImpl });
  const result = await (await handler(request({ action: "details", queryId, ships }))).json();
  equal(result.action, "details");
  equal(result.ok, true);
  equal(result.queryId, queryId);
  equal(result.rows.map((row: { risk: string }) => row.risk), ["SRS", "HRS"]);
  for (const row of result.rows) {
    equal(row.status, "ok");
    equal(row.companyImo, "0882415");
    equal(row.sourceUpdatedAt, null);
    equal(row.sourceUrl, "https://apcis.tmou.org/public/");
    assert(!("huid" in row));
    assert(row.retrievedAt <= result.completedAt);
  }
  equal(transport.calls.map((c) => c.action), ["entry", "login", "getship", "getship"]);
  for (let i = 1; i < transport.calls.length; i++) {
    assert(transport.calls[i].at - transport.calls[i - 1].at >= 280, "paced source reads");
  }
  // Synthetic failed source on next click must not reuse successful SRS.
  transport.bodies[`getship:${ships[0].huid}`] = "<h2>Unknown source format</h2>";
  const next = await (await handler(request({ action: "details", queryId, ships }))).json();
  equal(next.rows[0].status, "error");
  equal(next.rows[0].risk, null);
  equal(next.rows[0].priority, null);
  equal(next.rows[0].companyImo, null);
  equal(next.rows[0].errorCode, "SOURCE_FORMAT_CHANGED");
  equal(next.rows[1].status, "ok");
  equal(transport.calls.filter((c) => c.action === "entry").length, 2);
  assert(!JSON.stringify(next).includes("fixture_session"));
});

Deno.test("detail must match exact source name and checksum-valid ship IMO", async () => {
  const html = await fixture("live-ship-9528378.html");
  throws(() => parseShipDetail(html, { name: "FPMC 27", imo: "9528378" }), "IDENTITY_MISMATCH");
  throws(() => parseShipDetail(html, { name: "FPMC 28", imo: "9528366" }), "IDENTITY_MISMATCH");
  // Synthetic corrupt source identity; not a claimed source result.
  throws(
    () => parseShipDetail(html.replaceAll("9528378", "9528379"), { name: "FPMC 28", imo: "9528379" }),
    "SOURCE_FORMAT_CHANGED",
  );
  throws(
    () =>
      parseShipDetail(html.replace("<td>0882415</td>", "<td>882415</td>"), {
        name: "FPMC 28",
        imo: "9528378",
      }),
    "SOURCE_FORMAT_CHANGED",
  );
});

Deno.test("all 39 saved official headers match dated source evidence, including four other managers", async () => {
  const saved = JSON.parse(await fixture("tokyo-live-snapshot.json"));
  equal(saved.rows.length, 39);
  const counts: Record<string, number> = {};
  let outsourced = 0;
  for (const row of saved.rows) {
    const parsed = parseShipDetail(await fixture(row.sourceFile), row);
    equal(parsed.risk, row.tokyoRisk, row.imo);
    equal(parsed.priority, row.priority, row.imo);
    equal(parsed.companyImo, row.companyImo, row.imo);
    equal(parsed.companyName, row.companyName, row.imo);
    equal(parsed.sourceUpdatedAt, null);
    counts[parsed.risk] = (counts[parsed.risk] ?? 0) + 1;
    if (parsed.companyImo !== "0882415") outsourced++;
  }
  equal(outsourced, 4);
  console.log(
    "DATED saved HTML evidence only:",
    JSON.stringify({ count: saved.rows.length, counts, outsourced }),
  );
});

Deno.test("unknown current header cannot fall through into later HRS/LRS strings", async () => {
  const html = await fixture("live-ship-9528378.html");
  throws(
    () =>
      parseShipDetail(html.replace("Standard Risk Ship, No Priority", "Unknown Risk, Pending"), {
        name: "FPMC 28",
        imo: "9528378",
      }),
    "CURRENT_RISK_UNKNOWN",
  );
  throws(
    () =>
      parseShipDetail(html.replace("<h2>Ship data</h2>", "<h2>Other data</h2>"), {
        name: "FPMC 28",
        imo: "9528378",
      }),
    "SOURCE_FORMAT_CHANGED",
  );
});

Deno.test("missing/blank optional window remains null; invalid nonempty date fails", async () => {
  const empty = parseShipDetail(await fixture("live-ship-9397779.html"), {
    name: "FPMC C INTELLIGENCE",
    imo: "9397779",
  });
  equal([empty.windowFrom, empty.windowTo], [null, null]);
  const html = await fixture("live-ship-9528378.html");
  const absent = html.replace(/<h2 class="winInspRange">[\s\S]*?<\/h2>/, "");
  equal(parseShipDetail(absent, { name: "FPMC 28", imo: "9528378" }).windowFrom, null);
  throws(
    () => parseShipDetail(html.replace("17.11.2026", "31.11.2026"), { name: "FPMC 28", imo: "9528378" }),
    "SOURCE_FORMAT_CHANGED",
  );
});
