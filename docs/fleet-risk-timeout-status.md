# Fleet risk acquisition repair — local source GREEN, hosted recovery pending

## Decision boundary

The user's priority is complete fleet-risk acquisition first. Quick-update timeouts/conflicts and modal latency remain deferred. Deployed `53af7ee` already contains the deadline/diagnostic changes below; its authorized formal test failed at source/getships/SOURCE_TIMEOUT and that one-run authorization is consumed. The current candidate adds only the official-source native HTTPS/gzip transport and safe diagnostics. SQL, cron, Vault, credentials, UI, business saves, parsing/identity, pacing and atomic last-good publication remain unchanged. New deployment is operator-led; another formal refresh requires current explicit one-run consent. Push remains user-owned.

## Deadline accounting — unchanged from deployed 53af7ee

| Boundary | Previous | Candidate | Meaning |
|---|---:|---:|---|
| One official request (including body) | 15s | 45s | Finite deadline; no blind automatic retries |
| Complete collector | 120s | 125s | Shared by manual and scheduled routes |
| Legacy direct roster/details handler | 105s | 125s | Does not exceed the whole-request ceiling |
| Database RPC | 8s | 12s | Caller signal can stop it earlier |
| Worker | 125s after claim | 135s from request entry | Includes parsing/claim time; source and RPCs share the remaining time |
| Failure settlement | 5s | 8s | Same-run guarded failure only, never a second success publication |
| Browser read/acceptance call | 20s | unchanged | Does not wait for the background collector |
| Cron HTTP dispatch | 210s | unchanged | Existing source definition; not fresh proof of installed settings |
| SQL lease | 240s | unchanged | Prevents stale workers from publishing |

The application target is at most 135s plus 8s failure settlement, not a promise of available hosted lifetime. Supabase documents Free worker wall clock 150s, Paid 400s and CPU 2s excluding async I/O. A warm worker or platform shutdown can terminate earlier. These hard limits cannot be increased by editing this function. See https://supabase.com/docs/guides/functions/limits .

## Diagnostic contract

`FLEET_RISK_RUN_FAILED` adds only `phase`, `action`, `reason`, `elapsedMs` to existing `runId`/public error code. Source actions identify entry/login/company/roster/detail reads; database diagnostics identify the exact RPC; worker expiration and invalid publication are separate. No raw response, cookies, credentials, submitted bodies or raw transport error messages are logged. Existing sanitized user-visible codes and SQL schema remain unchanged.

## Preserved earlier evidence (before the current transport repair)

- Controlled original-entrypoint timeout regressions first failed on 20s source, 9s database, 128s manual/scheduled worker and missing source-stage attribution; the old hung-body control passed. These are compressed-clock tests, not real hosted latency.
- Saved official HTML replay validates all 39 identities/current headers, four outsourced managers, exact company IMO/name aliases, pagination and no partial results. It is dated evidence, not new source data.
- Local source trial with the extended Fetch deadline still failed on `getships` after about 59.5s overall. Therefore increasing limits alone has NOT restored acquisition.
- Independent Python and Node native HTTPS controls, then original Deno roster code with a native HTTPS adapter, returned all 39 roster identities. This proves a useful transport comparison, not successful collection of all current risk details.
- A native HTTPS experiment later reached the 30/39 progress marker but failed on a `getship` request; total elapsed 118.5s. An earlier native cancellation fault was separately reproduced and corrected at a controlled stream interface. Neither result qualifies as complete source acceptance.
- At that earlier gate, the unproven native adapter and tests were preserved outside the repository under `experimental-native-https-candidate/`, and the delivered `53af7ee` retained Fetch. The current, separately verified native-gzip implementation is described below; it is not that failed experiment.
- An earlier combined replay command hit the tool's 120s outer limit after source/timeout tests had passed; the complete collector suite separately passed under a 240s test-command budget. Tool timeout and product-source timeout are distinct receipts.

## Current transport repair and real-source evidence

- `sourceFetch.ts` now supplies both collector and legacy-handler defaults. It uses the runtime's `node:https`, a fresh HTTP/1.1 connection, gzip and connection-close; no new service, proxy, retry or TLS bypass. Database RPC Fetch remains unchanged.
- Only fixed official HTTPS host/path/actions are accepted. Complete wire length, early close, gzip validity, separate cookies, redirect rejection and cancellation through body/decode are enforced. Wire and streamed decoded bodies each have a 1 MiB cap. Only fixed diagnostic codes are exposed.
- The diagnostic prototype's `node:zlib maxOutputLength` was not enforced by the tested Deno runtime. Direct regressions observed oversized decoded Response and lost wire-limit diagnosis (13 positive controls passed / 2 regressions failed). Product decoding instead uses bounded asynchronous `DecompressionStream`, with cancellation; both regressions now pass.
- Initial native-gzip prototype: original collector 39/39 unique IMOs, 48 complete requests, 115.018 seconds. This was an injected local diagnostic, not hosted evidence.
- Integrated product collector/transport: **39/39 unique IMOs**, complete risk/priority, no missing or added reference IMOs, **48 successful source requests**, maximum concurrency 3. UTC source interval `2026-11-13T13:25:06.936Z` to `2026-11-13T13:27:09.883Z`, receipt **123.0 seconds**. At that retrieval: HRS 5 / SRS 30 / LRS 4. This result was not uploaded to Supabase.
- **58 Deno tests**, typecheck and source lint passed; **8 original-handler/embedded-PostgreSQL scenarios** passed. The latter use a synthetic collector, not hosted source latency. The 18 new transport cases include negative boundaries, cancelled decompression and late errors. Receipts and exact hashes: private task artifacts `transport-regression-red.json` and `transport-validation/`.
- Official backend and frontend source shapes are unchanged. No unrelated browser/build review was restarted. The earlier unsuccessful transport experiments remain archived; they are not the current implementation.
- This demonstrates a transport compatibility repair, not a proven underlying TLS/body-stall mechanism. The 123-second local source measurement is close to the 125-second collector bound and excludes hosted RPC overhead. Supabase documents built-in Node APIs, but the actual Edge runtime and hosted timing remain unverified; do not call this formal service recovery.

## Reproducible local verification

Use existing private source fixtures; do not fabricate or publish their contents.

```sh
deno test --cached-only --allow-read='<private-source-fixtures>,supabase/functions/fleet-risk' scripts/verify-fleet-risk-timeouts.test.ts scripts/verify-fleet-risk-backend.test.ts scripts/verify-fleet-risk-collector.test.ts scripts/verify-fleet-risk-source-transport.test.ts -- 'file:///<private-source-fixtures>/'
deno check supabase/functions/fleet-risk/index.ts
deno lint supabase/functions/fleet-risk/
QA_EVIDENCE_ROOT='<external evidence directory>' npm run test:fleet-risk:worker
npm run build
```

Allow at least 240 seconds for the combined replay command. Worker integration uses actual embedded PostgreSQL with synthetic source data, not hosted Supabase or natural cron execution. The live source probe is explicit opt-in and never writes Supabase; its failure receipt now includes sanitized source action metadata.

## Historical deadline/diagnostic-only gate result

The final deadline/diagnostic-only candidate passed 40 Deno cases, 8 embedded-PostgreSQL worker scenarios, Deno type/lint checks, and `npm run build`. The build reported a >500 kB chunk-size warning; no frontend code or chunk configuration was changed. The expanded 10-case timeout suite was additionally rerun against immutable predecessor `8e7f444009292505959fa7f5449bc127ea8c7e00` to bind regression evidence to the actual old entrypoints; that reconstruction does not change the original implementation chronology. Receipts and candidate hashes are in the private task artifacts' `timeout-diagnostic-validation/`. These local gates do not establish hosted acquisition recovery.

## Required next gate

The earlier `53af7ee` deployment and exact ZIP verification already occurred. Its one formal run `f06dbf7a-800f-43b8-a4d7-873ef4539c31` failed at `source/getships/SOURCE_TIMEOUT` with `elapsedMs=58993`; authoritative readback retained the old complete 39-ship snapshot. The subsequent EarlyDrop was not acquisition success or the initiating source failure. Do not repeat that consumed one-shot script.

Next: prepare an immutable-commit single-file editor artifact, permit only the intentional `node:https` runtime import, verify syntax and original-versus-bundle controlled behavior. The operator replaces the existing project's existing `fleet-risk/index.ts` without changing settings. Require the downloaded deployed source to match the exact bundle before a newly authorized single formal refresh. Do not rotate keys, reinstall SQL/cron, clear data or casually press Test/Run now. Acceptance needs a new successful complete 39-ship snapshot and exact run readback; a local or manual success does not prove the next natural 07:00 execution. If it fails, retain the old snapshot and inspect its new diagnostic rather than blind-retry.

Until those gates succeed, report: local complete-source transport repair and regressions passed; new hosted recovery and natural-schedule success remain pending.
