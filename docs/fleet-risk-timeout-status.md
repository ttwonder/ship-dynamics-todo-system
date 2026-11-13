# Fleet risk timeout candidate — partial repair, not service recovery

## Decision boundary

The user's priority is fleet-risk acquisition first. Quick-update timeouts/conflicts and modal latency remain deferred. This candidate changes only the fleet-risk source/worker deadlines and sanitized failure diagnostics. It does not change SQL, cron timing, Vault, credentials, browser UI, business saves, or the atomic last-good snapshot contract. Deployment, one hosted refresh, SQL Run and GitHub Push are separate user-owned authorization gates.

## Deadline accounting

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

## Evidence and unresolved outcome

- Controlled original-entrypoint timeout regressions first failed on 20s source, 9s database, 128s manual/scheduled worker and missing source-stage attribution; the old hung-body control passed. These are compressed-clock tests, not real hosted latency.
- Saved official HTML replay validates all 39 identities/current headers, four outsourced managers, exact company IMO/name aliases, pagination and no partial results. It is dated evidence, not new source data.
- Local source trial with the extended Fetch deadline still failed on `getships` after about 59.5s overall. Therefore increasing limits alone has NOT restored acquisition.
- Independent Python and Node native HTTPS controls, then original Deno roster code with a native HTTPS adapter, returned all 39 roster identities. This proves a useful transport comparison, not successful collection of all current risk details.
- A native HTTPS experiment later reached the 30/39 progress marker but failed on a `getship` request; total elapsed 118.5s. An earlier native cancellation fault was separately reproduced and corrected at a controlled stream interface. Neither result qualifies as complete source acceptance.
- The unproven native adapter and its tests have been preserved outside the repository under the task artifacts' `experimental-native-https-candidate/`. They are NOT in this delivery candidate. The original Fetch transport remains in production source.
- An earlier combined replay command hit the tool's 120s outer limit after source/timeout tests had passed; the complete collector suite separately passed under a 240s test-command budget. Tool timeout and product-source timeout are distinct receipts.

## Reproducible local verification

Use existing private source fixtures; do not fabricate or publish their contents.

```sh
deno test --cached-only --allow-read='<private-source-fixtures>' scripts/verify-fleet-risk-timeouts.test.ts scripts/verify-fleet-risk-backend.test.ts scripts/verify-fleet-risk-collector.test.ts -- 'file:///<private-source-fixtures>/'
deno check supabase/functions/fleet-risk/index.ts
deno lint supabase/functions/fleet-risk/
QA_EVIDENCE_ROOT='<external evidence directory>' npm run test:fleet-risk:worker
npm run build
```

Allow at least 240 seconds for the combined replay command. Worker integration uses actual embedded PostgreSQL with synthetic source data, not hosted Supabase or natural cron execution. The live source probe is explicit opt-in and never writes Supabase; its failure receipt now includes sanitized source action metadata.

## Final local gate result

The final deadline/diagnostic-only candidate passed 40 Deno cases, 8 embedded-PostgreSQL worker scenarios, Deno type/lint checks, and `npm run build`. The build reported a >500 kB chunk-size warning; no frontend code or chunk configuration was changed. The expanded 10-case timeout suite was additionally rerun against immutable predecessor `8e7f444009292505959fa7f5449bc127ea8c7e00` to bind regression evidence to the actual old entrypoints; that reconstruction does not change the original implementation chronology. Receipts and candidate hashes are in the private task artifacts' `timeout-diagnostic-validation/`. These local gates do not establish hosted acquisition recovery.

## Required next gate

A current, explicit decision is required before deploying this deadline/diagnostic-only candidate to the existing `cyzpcvvhmoiihsqvjspp` fleet-risk function and invoking exactly one formal manual refresh. Do not rotate keys, rerun installation SQL, alter the 07:00 schedule, clear the previous snapshot, or deploy the failed native experiment. Verify deployed bytes, then correlate the accepted run ID, function diagnostics and authoritative final snapshot. Stop on failure rather than repeating the crawl. A successful manual run does not prove the next natural 07:00 execution.

Until that gate succeeds, report: local bounded deadline/diagnostic candidate prepared; overall acquisition repair and natural-schedule success remain unverified.
