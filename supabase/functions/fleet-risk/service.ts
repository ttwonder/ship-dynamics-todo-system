import type {
  Company,
  Coverage,
  DetailRow,
  FleetRiskRequest,
  FleetRiskResponse,
  Priority,
  Risk,
  RosterShip,
  ShipIdentity,
  ShipRisk,
} from "./types.ts";
import { REFERENCE_FLEET } from "./referenceFleet.ts";

const SOURCE_URL = "https://apcis.tmou.org/public/";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Local isolate protection only; not durable/distributed rate limiting.
let inFlight = 0;

/** Up to four independent paced sessions; publish only the complete fleet. */
export async function collectFleetRisk(options: {
  signal: AbortSignal;
  fetchImpl?: typeof fetch;
  concurrency?: number;
  onProgress?: (done: number, total: number) => void | Promise<void>;
}) {
  const concurrency = options.concurrency ?? 3;
  if (![2, 3, 4].includes(concurrency)) throw new SourceError("INVALID_CONCURRENCY", 400);
  const stop = new AbortController();
  const abort = () => stop.abort(options.signal.reason);
  options.signal.addEventListener("abort", abort, { once: true });
  if (options.signal.aborted) abort();
  const budget = abortScope(stop.signal, 120000, "REQUEST_TIMEOUT", 504);
  // Stagger request starts across lanes as well as pacing each session. This
  // retains overlapping reads without sending a burst to the public service.
  let turn = Promise.resolve(), firstRequest = true;
  const fetchImpl: typeof fetch = async (input, init) => {
    const slot = turn.then(async () => {
      if (firstRequest) firstRequest = false;
      else await pause(budget.signal);
    });
    turn = slot.catch(() => {});
    await slot;
    if (budget.signal.aborted) throw abortReason(budget.signal);
    return (options.fetchImpl ?? fetch)(input, init);
  };
  const session = new PublicSession(fetchImpl, budget.signal);
  const sessions = [session];
  try {
    const fields = await session.open();
    const company = parseCompany(await session.read("getcompanies", {
      ...fields, Param: "0", Value: "0882415", compimo: "0882415",
    }));
    const shipFields = { ...fields, Param: "1", Value: "FPMC", name: "FPMC", compimo: "" };
    const first = parseRosterPage(await session.read("getships", shipFields));
    const pages = [first];
    for (let page = 1; page < first.pageCount; page++) {
      pages.push(parseRosterPage(await session.read("getships", { ...shipFields, Page: String(page) })));
    }
    const ships = reconcilePages(pages), checkedCoverage = coverage(ships);
    if (checkedCoverage.missingReferenceImos.length) fail("FLEET_COVERAGE_INCOMPLETE");
    const rosterRetrievedAt = new Date().toISOString();
    const rows: DetailRow[] = new Array(ships.length);
    let cursor = 0, completed = 0, workersStarted = 0;
    let progress = Promise.resolve();
    await options.onProgress?.(0, ships.length);
    const worker = async () => {
      // APCIS rejects simultaneous reads sharing one session. Reuse the roster
      // session for one lane and keep only one independent session per other lane.
      const lane = workersStarted++ === 0 ? session : new PublicSession(fetchImpl, budget.signal);
      if (lane !== session) { sessions.push(lane); await lane.open(); }
      while (!budget.signal.aborted) {
        const index = cursor++;
        if (index >= ships.length) return;
        const ship = ships[index];
        const parsed = parseShipDetail(await lane.read("getship", { HUID: ship.huid }), ship);
        rows[index] = { name: ship.name, imo: ship.imo, ...parsed, status: "ok", retrievedAt: new Date().toISOString(), sourceUrl: SOURCE_URL };
        const done = ++completed;
        progress = progress.then(() => options.onProgress?.(done, ships.length));
        await progress;
      }
      throw abortReason(budget.signal);
    };
    let firstError: unknown;
    await Promise.allSettled(Array.from({ length: concurrency }, async () => {
      try { await worker(); }
      catch (error) { if (!firstError) firstError = error; stop.abort(error); }
    }));
    await progress;
    if (firstError) throw firstError;
    if (budget.signal.aborted) throw abortReason(budget.signal);
    if (completed !== ships.length || rows.some(row => !row || row.status !== "ok")) fail("FLEET_INCOMPLETE");
    return { company, rosterRetrievedAt, count: rows.length, rows, coverage: checkedCoverage };
  } finally {
    sessions.forEach(lane => lane.close()); budget.close(); options.signal.removeEventListener("abort", abort);
  }
}

export function sourceFailureCode(error: unknown): string {
  return error instanceof SourceError ? error.code : "SOURCE_UNAVAILABLE";
}

export function createFleetRiskHandler(options?: { allowedOrigins?: string[]; fetchImpl?: typeof fetch }) {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const origins = new Set(
    (options?.allowedOrigins ?? ["https://ttwonder.github.io"]).map((s) => s.trim()).filter(Boolean),
  );
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get("origin");
    const headers = new Headers({
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "vary": "Origin",
    });
    const deny = (status: number, error: string) =>
      new Response(JSON.stringify({ ok: false, error }), { status, headers });
    // CORS is browser policy, not authorization. Only public vessel data is exposed.
    if (!origin || !origins.has(origin)) return deny(403, "ORIGIN_NOT_ALLOWED");
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-methods", "POST, OPTIONS");
    headers.set(
      "access-control-allow-headers",
      "authorization, apikey, content-type, x-client-info, x-application-name",
    );
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "POST") {
      headers.set("allow", "POST, OPTIONS");
      return deny(405, "METHOD_NOT_ALLOWED");
    }
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      return deny(415, "JSON_REQUIRED");
    }
    if (inFlight >= 2) {
      headers.set("retry-after", "2");
      return deny(429, "BUSY");
    }
    inFlight++;
    const budget = abortScope(request.signal, 105000, "REQUEST_TIMEOUT", 504);
    let session: PublicSession | undefined;
    try {
      const incoming = abortScope(budget.signal, 5000, "REQUEST_BODY_TIMEOUT", 408);
      let bodyText: string;
      try {
        bodyText = await readBounded(request, 16384, incoming.signal, "REQUEST_BODY_TOO_LARGE", 413);
      } finally {
        incoming.close();
      }
      let raw: unknown;
      try {
        raw = JSON.parse(bodyText);
      } catch {
        throw new SourceError("INVALID_JSON", 400);
      }
      const input = validateRequest(raw);
      const queryStartedAt = new Date().toISOString();
      session = new PublicSession(fetchImpl, budget.signal);
      const fields = await session.open();
      if (input.action === "details") {
        const rows: DetailRow[] = [];
        for (const ship of input.ships as RosterShip[]) {
          const row: DetailRow = {
            name: ship.name,
            imo: ship.imo,
            retrievedAt: "",
            status: "error",
            risk: null,
            priority: null,
            companyName: null,
            companyImo: null,
            windowFrom: null,
            windowTo: null,
            sourceUpdatedAt: null,
            sourceUrl: SOURCE_URL,
          };
          try {
            const parsed = parseShipDetail(await session.read("getship", { HUID: ship.huid }), ship);
            Object.assign(row, parsed, { status: "ok" });
          } catch (error) {
            if (budget.signal.aborted) throw abortReason(budget.signal);
            row.errorCode = error instanceof SourceError ? error.code : "SOURCE_UNAVAILABLE";
          }
          row.retrievedAt = new Date().toISOString();
          rows.push(row);
        }
        return new Response(
          JSON.stringify(
            {
              ok: true,
              action: "details",
              queryId: input.queryId,
              rows,
              completedAt: new Date().toISOString(),
            } satisfies FleetRiskResponse,
          ),
          { headers },
        );
      }
      const company = parseCompany(
        await session.read("getcompanies", { ...fields, Param: "0", Value: "0882415", compimo: "0882415" }),
      );
      const shipFields = { ...fields, Param: "1", Value: "FPMC", name: "FPMC", compimo: "" };
      const first = parseRosterPage(await session.read("getships", shipFields));
      const pages = [first];
      for (let page = 1; page < first.pageCount; page++) {
        pages.push(parseRosterPage(await session.read("getships", { ...shipFields, Page: String(page) })));
      }
      const ships = reconcilePages(pages);
      const body: FleetRiskResponse = {
        ok: true,
        action: "roster",
        queryId: input.queryId,
        queryStartedAt,
        rosterRetrievedAt: new Date().toISOString(),
        declaredTotal: first.declaredTotal,
        company,
        ships,
        coverage: coverage(ships),
      };
      return new Response(JSON.stringify(body), { headers });
    } catch (error) {
      const known = error instanceof SourceError ? error : new SourceError("SOURCE_UNAVAILABLE");
      return new Response(JSON.stringify({ ok: false, error: known.code }), {
        status: known.status,
        headers,
      });
    } finally {
      session?.close();
      budget.close();
      inFlight--;
    }
  };
}

function validateRequest(raw: unknown): FleetRiskRequest {
  const invalid = (): never => {
    throw new SourceError("INVALID_REQUEST", 400);
  };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return invalid();
  const value = raw as Record<string, unknown>;
  if (
    typeof value.queryId !== "string" || !UUID.test(value.queryId) ||
    (value.action !== "roster" && value.action !== "details")
  ) return invalid();
  const fields = value.action === "roster" ? ["action", "queryId"] : ["action", "queryId", "ships"];
  if (Object.keys(value).some((key) => !fields.includes(key))) return invalid();
  if (value.action === "roster") return { action: "roster", queryId: value.queryId };
  if (!Array.isArray(value.ships) || value.ships.length < 1 || value.ships.length > 4) {
    throw new SourceError("BATCH_LIMIT_EXCEEDED", 400);
  }
  const ships: RosterShip[] = value.ships.map((ship: unknown) => {
    if (!ship || typeof ship !== "object" || Array.isArray(ship)) return invalid();
    const s = ship as Record<string, unknown>;
    if (
      Object.keys(s).some((key) => !["name", "imo", "huid"].includes(key)) || !validName(s.name) ||
      !validImo(s.imo) || typeof s.huid !== "string" || !UUID.test(s.huid)
    ) return invalid();
    return { name: s.name, imo: s.imo, huid: s.huid };
  });
  if (
    new Set(ships.map((s) => s.imo)).size !== ships.length ||
    new Set(ships.map((s) => s.huid.toLowerCase())).size !== ships.length
  ) return invalid();
  return { action: "details", queryId: value.queryId, ships };
}

class SourceError extends Error {
  constructor(readonly code: string, readonly status = 502) {
    super(code);
  }
}
function fail(code = "SOURCE_FORMAT_CHANGED"): never {
  throw new SourceError(code);
}

function abortReason(signal: AbortSignal): SourceError {
  return signal.reason instanceof SourceError ? signal.reason : new SourceError("REQUEST_ABORTED", 499);
}
function abortScope(parent: AbortSignal, milliseconds: number, code: string, status: number) {
  const controller = new AbortController();
  const onAbort = () => controller.abort(abortReason(parent));
  const timer = setTimeout(() => controller.abort(new SourceError(code, status)), milliseconds);
  parent.addEventListener("abort", onAbort, { once: true });
  if (parent.aborted) onAbort();
  return {
    signal: controller.signal,
    close() {
      clearTimeout(timer);
      parent.removeEventListener("abort", onAbort);
    },
  };
}
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}
async function pause(signal: AbortSignal, milliseconds = 1300) {
  let timer: number | undefined;
  try {
    await abortable(
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, milliseconds);
      }),
      signal,
    );
  } finally {
    clearTimeout(timer);
  }
}
async function readBounded(
  message: Request | Response,
  limit: number,
  signal: AbortSignal,
  code: string,
  status: number,
): Promise<string> {
  if (signal.aborted) throw abortReason(signal);
  const tooLarge = () => new SourceError(code, status);
  if (Number(message.headers.get("content-length")) > limit) {
    void message.body?.cancel().catch(() => {});
    throw tooLarge();
  }
  if (!message.body) return "";
  const reader = message.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const chunks: string[] = [];
  let bytes = 0, complete = false;
  try {
    while (true) {
      const { done, value } = await abortable(reader.read(), signal);
      if (done) {
        complete = true;
        break;
      }
      bytes += value.byteLength;
      if (bytes > limit) throw tooLarge();
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } finally {
    if (!complete) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function clean(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
}
function text(html: string): string {
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return html.replace(/<[^>]*>/g, " ").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, key: string) => {
    if (!key.startsWith("#")) return entities[key.toLowerCase()] ?? whole;
    const point = key[1].toLowerCase() === "x" ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
      ? String.fromCodePoint(point)
      : fail();
  }).replace(/\s+/g, " ").trim();
}
function cells(row: string, tag: "td" | "th" = "td"): string[] {
  const pattern = new RegExp(`<${tag}\\b[^>]*?\\/>|<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, "gi");
  return [...row.matchAll(pattern)].map((m) => text(m[1] ?? ""));
}
function dataTable(html: string, label: "Ship data" | "Company data"): string[] {
  const matches = [
    ...html.matchAll(
      new RegExp(`<h2\\b[^>]*>\\s*${label}\\s*<\\/h2>\\s*<table\\b[^>]*>([\\s\\S]*?)<\\/table>`, "gi"),
    ),
  ];
  if (matches.length !== 1) fail();
  const rows = [...matches[0][1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  if (rows.length !== 2) fail();
  const headers = cells(rows[0][1], "th");
  if (headers[0] !== "Name" || headers[1] !== "IMO number") fail();
  const values = cells(rows[1][1]);
  if (values.length !== headers.length) fail();
  return values;
}
function attributes(tag: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    result[match[1].toLowerCase()] = text(match[2] ?? match[3]);
  }
  return result;
}
function inputs(html: string): Record<string, string>[] {
  return [...html.matchAll(/<input\b[^>]*>/gi)].map((m) => attributes(m[0]));
}
function clickRows(html: string, kind: "ship" | "company") {
  return [...html.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi)]
    .filter((m) => attributes(m[1]).onclick === `onclick_${kind}(this)`)
    .map((m) => ({ html: m[2], values: cells(m[2]) }));
}
function parseCompany(raw: string): Company {
  const html = clean(raw);
  if (!text(html).includes("COMPANIES SEARCH RESULTS")) fail();
  const rows = clickRows(html, "company");
  if (rows.length !== 1) fail("COMPANY_IDENTITY_MISMATCH");
  const values = rows[0].values;
  if (values.length !== 6 || values[2] !== "0882415" || values[1] !== "FORMOSA PLASTICS MARINE CORPORATION") {
    fail("COMPANY_IDENTITY_MISMATCH");
  }
  if (!["High", "Medium", "Low", "Very Low", "Unknown"].includes(values[5])) fail();
  return { name: values[1], imo: "0882415", performance: values[5] };
}
interface RosterPage {
  declaredTotal: number;
  pageCount: number;
  from: number;
  to: number;
  ships: RosterShip[];
}
export function parseRosterPage(raw: string): RosterPage {
  const html = clean(raw);
  const matches = [
    ...text(html).matchAll(/Found (\d+) elements on (\d+) page\(s\)\. Elements from (\d+) to (\d+)/g),
  ];
  if (!text(html).includes("SHIPS SEARCH RESULTS") || matches.length !== 1) fail("ROSTER_FORMAT_CHANGED");
  const [declaredTotal, pageCount, from, to] = matches[0].slice(1).map(Number);
  if (
    declaredTotal < 1 || declaredTotal > 100 || pageCount < 1 || pageCount > 5 || from < 1 || to < from ||
    to > declaredTotal
  ) fail("ROSTER_LIMIT_EXCEEDED");
  const ships = clickRows(html, "ship").map(({ html: row, values }, i) => {
    const ids = inputs(row).filter((input) => input.type === "hidden" && !input.name);
    if (
      values.length !== 11 || Number(values[0]) !== from + i || !validName(values[1]) ||
      !validImo(values[2]) || ids.length !== 1 || !UUID.test(ids[0].value ?? "")
    ) fail("ROSTER_FORMAT_CHANGED");
    // Columns after IMO are historical inspection data and intentionally discarded.
    return { name: values[1], imo: values[2], huid: ids[0].value };
  });
  if (ships.length !== to - from + 1) fail("ROSTER_COUNT_MISMATCH");
  return { declaredTotal, pageCount, from, to, ships };
}
export function reconcilePages(pages: RosterPage[]): RosterShip[] {
  const first = pages[0];
  if (!first || first.pageCount !== pages.length) fail("ROSTER_COUNT_MISMATCH");
  const ships: RosterShip[] = [];
  for (const page of pages) {
    if (
      page.declaredTotal !== first.declaredTotal || page.pageCount !== first.pageCount ||
      page.from !== ships.length + 1
    ) fail("ROSTER_COUNT_MISMATCH");
    ships.push(...page.ships);
  }
  // Duplicate/conflicting identities mean the changing pages are not a complete snapshot.
  const byImo = new Map(ships.map((ship) => [ship.imo, ship]));
  if (
    ships.length !== first.declaredTotal || byImo.size !== first.declaredTotal ||
    new Set(ships.map((s) => s.huid.toLowerCase())).size !== ships.length
  ) fail("ROSTER_COUNT_MISMATCH");
  return [...byImo.values()];
}
export function coverage(ships: ShipIdentity[]): Coverage {
  const expected = new Set(REFERENCE_FLEET.map((ship) => ship.imo));
  const actual = new Set(ships.map((ship) => ship.imo));
  return {
    referenceCount: expected.size,
    missingReferenceImos: [...expected].filter((imo) => !actual.has(imo)).sort(),
    addedReferenceImos: [...actual].filter((imo) => !expected.has(imo)).sort(),
  };
}

type Action = "login" | "getcompanies" | "getships" | "getship";
class PublicSession {
  private cookies = new Map<string, { value: string; expires: number }>();
  private hasRead = false;
  constructor(private fetchImpl: typeof fetch, private signal: AbortSignal) {}
  close() {
    this.cookies.clear();
  }
  private storeCookies(headers: Headers) {
    const values = headers.getSetCookie();
    if (values.length > 16) fail("SOURCE_COOKIE_LIMIT");
    for (const cookie of values) {
      if (cookie.length > 4096) fail("SOURCE_COOKIE_LIMIT");
      const pair = /^([!#$%&'*+.^_`|~0-9a-z-]+)=([^;\r\n]*)/i.exec(cookie);
      if (!pair) fail("SOURCE_COOKIE_FORMAT");
      const domain = /;\s*Domain=([^;]+)/i.exec(cookie)?.[1].trim().toLowerCase().replace(/^\./, "");
      if (domain && !["apcis.tmou.org", "tmou.org"].includes(domain)) continue;
      const path = /;\s*Path=([^;]+)/i.exec(cookie)?.[1].trim() ?? "/public";
      const target = "/public/";
      if (
        !(target === path || (target.startsWith(path) && (path.endsWith("/") || target[path.length] === "/")))
      ) continue;
      const age = /;\s*Max-Age=(-?\d+)(?:;|$)/i.exec(cookie);
      const expiry = /;\s*Expires=([^;]+)/i.exec(cookie);
      const expires = age ? Date.now() + Number(age[1]) * 1000 : expiry ? Date.parse(expiry[1]) : Infinity;
      if (expires <= Date.now()) this.cookies.delete(pair[1]);
      else this.cookies.set(pair[1], { value: pair[2], expires: Number.isNaN(expires) ? Infinity : expires });
    }
    if (
      this.cookies.size > 16 ||
      [...this.cookies].reduce((sum, [key, cookie]) => sum + key.length + cookie.value.length, 0) > 8192
    ) fail("SOURCE_COOKIE_LIMIT");
  }
  async read(action?: Action, values?: Record<string, string>): Promise<string> {
    if (this.signal.aborted) throw abortReason(this.signal);
    if (this.hasRead) await pause(this.signal);
    this.hasRead = true;
    const headers = new Headers({
      "accept": "text/html,application/xhtml+xml",
      "cache-control": "no-cache",
      "referer": SOURCE_URL,
      "user-agent": "Mozilla/5.0",
    });
    for (const [key, cookie] of this.cookies) if (cookie.expires <= Date.now()) this.cookies.delete(key);
    if (this.cookies.size) {
      headers.set(
        "cookie",
        [...this.cookies].map(([key, cookie]) => `${key}=${cookie.value}`).join("; "),
      );
    }
    if (values) {
      headers.set("content-type", "application/x-www-form-urlencoded; charset=UTF-8");
      headers.set("x-requested-with", "XMLHttpRequest");
    }
    const url = SOURCE_URL + (action ? `?action=${action}` : "");
    const timeout = abortScope(this.signal, 15000, "SOURCE_TIMEOUT", 504);
    let response: Response | undefined;
    try {
      response = await abortable(
        this.fetchImpl(url, {
          method: values ? "POST" : "GET",
          body: values ? new URLSearchParams(values).toString() : undefined,
          headers,
          signal: timeout.signal,
          redirect: "manual",
          credentials: "omit",
          cache: "no-store",
        }),
        timeout.signal,
      );
      if (
        response.redirected || (response.url && response.url !== url) ||
        (response.status >= 300 && response.status < 400)
      ) fail("SOURCE_REDIRECT_REJECTED");
      if (!response.ok) fail("SOURCE_HTTP_ERROR");
      if (!/^(text\/html|application\/xhtml\+xml)(?:;|$)/i.test(response.headers.get("content-type") ?? "")) {
        fail("SOURCE_CONTENT_TYPE");
      }
      this.storeCookies(response.headers);
      return await readBounded(response, 1024 * 1024, timeout.signal, "SOURCE_BODY_TOO_LARGE", 502);
    } finally {
      if (response?.body && !response.bodyUsed) void response.body.cancel().catch(() => {});
      timeout.close();
    }
  }
  async open(): Promise<Record<string, string>> {
    const entry = clean(await this.read());
    if (
      /recaptcha|hcaptcha|turnstile|<iframe\b|<canvas\b|type=["']password["']|<img\b[^>]*(?:captcha|challenge|verification)/i
        .test(entry)
    ) fail("UNSUPPORTED_CHALLENGE");
    const forms = [...entry.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/gi)].filter((m) =>
      inputs(m[1]).some((i) => i.name === "captcha")
    );
    if (forms.length !== 1 || /<img\b/i.test(forms[0][1])) fail("UNSUPPORTED_CHALLENGE");
    const entryInputs = inputs(forms[0][1]);
    if (entryInputs.length !== 1 || entryInputs[0].type !== "text") fail("UNSUPPORTED_CHALLENGE");
    const formula = /^(\d{1,2})\s*([+-])\s*(\d{1,2})\s*=\s*Send$/.exec(text(forms[0][1]));
    if (!formula) fail("UNSUPPORTED_CHALLENGE");
    const answer = formula[2] === "+"
      ? Number(formula[1]) + Number(formula[3])
      : Number(formula[1]) - Number(formula[3]);
    const loggedIn = clean(await this.read("login", { captcha: String(answer) }));
    if (!text(loggedIn).includes("COMPANY SEARCH") || inputs(loggedIn).some((i) => i.name === "captcha")) {
      fail("PUBLIC_ENTRY_FAILED");
    }

    const defaults: Record<string, string> = {};
    for (const name of ["From", "Till"]) {
      const matches = inputs(loggedIn).filter((i) => i.name === name);
      if (matches.length !== 1) fail();
      sourceDate(matches[0].value ?? "");
      defaults[name] = matches[0].value;
    }
    return {
      ...defaults,
      Page: "0",
      imo: "",
      callsign: "",
      name: "",
      compimo: "",
      compname: "",
      authority: "0",
      flag: "0",
      class: "0",
      ro: "0",
      type: "0",
      result: "0",
      insptype: "-1",
      sort1: "0",
      sort2: "DESC",
      sort3: "0",
      sort4: "DESC",
    };
  }
}

function sourceDate(value: string): string {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value);
  if (!match) fail();
  const iso = `${match[3]}-${match[2]}-${match[1]}`;
  const stamp = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(stamp.getTime()) || stamp.toISOString().slice(0, 10) !== iso) fail();
  return iso;
}

function validImo(value: unknown): value is string {
  return typeof value === "string" && /^\d{7}$/.test(value) &&
    [...value.slice(0, 6)].reduce((sum, digit, i) => sum + Number(digit) * (7 - i), 0) % 10 ===
      Number(value[6]);
}
function validName(value: unknown): value is string {
  return typeof value === "string" && /^FPMC/.test(value) && value.length <= 80 &&
    value.trim() === value && !/[<>]/.test(value) &&
    [...value].every((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127);
}

// Only the first current detail header; later criteria/history are not classifications.
export function parseShipDetail(raw: string, expected: ShipIdentity): ShipRisk {
  if (raw.length > 1024 * 1024) fail("SOURCE_BODY_TOO_LARGE");
  const html = clean(raw);
  const company = dataTable(html, "Company data");
  const ship = dataTable(html, "Ship data");
  if (
    !validImo(ship[1]) || !validName(ship[0]) || !/^\d{7}$/.test(company[1]) || !company[0] ||
    company[0].length > 200
  ) fail();
  if (ship[0] !== expected.name || ship[1] !== expected.imo) fail("IDENTITY_MISMATCH");
  const headers = [...html.matchAll(/<div\b[^>]*class=["']tf["'][^>]*>\s*<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)];
  if (headers.length !== 1) fail("CURRENT_RISK_UNKNOWN");
  const current = /^(High|Standard|Low) Risk Ship, (Priority I|Priority II|No Priority)$/.exec(
    text(headers[0][1]),
  );
  if (!current) fail("CURRENT_RISK_UNKNOWN");
  const risks: Record<string, Risk> = { High: "HRS", Standard: "SRS", Low: "LRS" };
  const range = /<h2\b[^>]*class=["']winInspRange["'][^>]*>([\s\S]*?)<\/h2>/i.exec(html);
  let windowFrom = null, windowTo = null;
  if (range) {
    const value = text(range[1]);
    if (value !== "Window Inspection Range: -") {
      const match = /^Window Inspection Range: (\d{2}\.\d{2}\.\d{4}) - (\d{2}\.\d{2}\.\d{4})$/.exec(value);
      if (!match) fail();
      windowFrom = sourceDate(match[1]);
      windowTo = sourceDate(match[2]);
      if (windowFrom > windowTo) fail();
    }
  }
  return {
    risk: risks[current[1]],
    priority: current[2] as Priority,
    companyName: company[0],
    companyImo: company[1],
    windowFrom,
    windowTo,
    sourceUpdatedAt: null,
  };
}
