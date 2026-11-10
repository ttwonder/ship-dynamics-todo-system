# Fleet risk database candidate — local only

## Scope and evidence

The SQL and Edge handler have been integrated and verified locally. No hosted database migration, deployment or Push has been performed. Verification uses only isolated local databases and synthetic credentials; the already-declared `@electric-sql/pglite` dev dependency is reused without an installation or symlink.

Run from the repository root, using an external evidence directory:

```bash
QA_EVIDENCE_ROOT=<absolute-external-directory> node scripts/verify-fleet-risk-database.mjs
```

The optional `FLEET_RISK_DEPENDENCY_PACKAGE` points to a package.json with the already-installed PGlite dependency. Default: the repository package.json. `FLEET_RISK_TEST_STAGE` changes the evidence filename only. All databases are isolated in-memory instances, closed at test completion.

Evidence files retain initial missing-feature REDs and later GREENs. The RPC suite executes actual embedded PostgreSQL SQL/PLpgSQL, transactions, constraints, and real `SET ROLE` authorization. Calendar cases substitute exactly five clock expressions in a separate in-memory instance, not in the migration. Cron/net/Vault rehearsal uses explicitly labelled local schema/function shims and substitutes only the marked extension-presence guard. The unmodified installer is separately tested to fail without real extensions. Shims do not send HTTP and are NOT proof of hosted scheduling, real pg_net delivery, Vault encryption, Edge execution, multi-backend lock contention, or current PSC data. Vessel rows and placeholder tokens are synthetic fixtures, never source retrieval evidence.

## Files

1. `supabase/migrations/20261110070000_ship_fleet_risk.sql` — one new singleton table and four frozen RPCs. No business table references, broad application locks, extensions, schedules, or secrets. This is a one-time forward migration, not a reset/reinstall script; an already-existing object fails instead of resetting cached data.
2. `supabase/deployment/fleet-risk-0700-cron-install.sql` — separate opt-in installation; only job `ship-fleet-risk-taipei-0700-v1` may be replaced. No HTTP is sent during install.
3. `supabase/verification/fleet-risk-readback.sql` — explicit READ ONLY transaction; boolean checks, names, schedule and redacted URL only; never invokes the scheduler/writers.
4. `scripts/verify-fleet-risk-database.mjs` — finite isolated tests and JSON evidence.

## Edge integration contract (parent-owned)

- Read `public.read_ship_fleet_risk_v1()` anonymously/authenticated. Display `snapshot` immediately, unchanged, even while `attempt` is running/failed. An expired running lease is projected as failed without writing. `nextScheduledAt` is the strictly next-future Taipei 07:00 according to the database clock.
- Only a trusted backend with `service_role` can call the three writers. No browser grants to the table or any writer. The scheduler invoker is owner-only, including denial to `service_role`.
- Claim with `p_trigger` equal to `manual` or `scheduled` and an immutable `p_request_id` UUID. On `acquired:false`, do not start a second worker. A live run is joined; retries after terminal outcomes do not restart the request. The returned envelope describes the current cache, which can be newer than a historical replay's `runId`.
- A scheduled call before Taipei 07:00 is rejected. At most one scheduled attempt is acquired per Taipei date, including failed/expired attempts. A scheduled caller joining an already-running manual request does not consume a scheduled attempt for that date. Manual attempts remain possible after failure/expiry with a new request ID.
- Fixed lease: four minutes from acquisition. Progress cannot renew it. Progress is monotone (`done` and `total` never decrease), with `0 <= done <= total <= 100`. Publish the actual expected roster total through progress as soon as known; when a nonzero total exists, finish must match it. An unknown total starts at zero.
- Set `snapshot.id` to `runId`, `trigger` to claim attempt trigger, and **copy `claim.state.attempt.startedAt` verbatim into `queryStartedAt`**, including microseconds. Do not parse-and-reformat it through JavaScript Date. All other timestamps must be ISO strings with a timezone, within the run; completed time may not be in the future. The database stores the submitted JSONB snapshot without changing its timestamps.
- Complete success requires 1–100 unique checksum-valid seven-digit ship IMOs, nonblank names/operators, every `status:'ok'`, risk `HRS|SRS|LRS`, priority `Priority I|Priority II|No Priority`, company IMO `0882415` at snapshot level, exact documented keys/types, `sourceUpdatedAt:null`, and exact source URL `https://apcis.tmou.org/public/`. Row company IMOs can differ for outsourced operators but must remain seven-digit strings. `windowFrom`/`windowTo` are strings or null. Coverage requires no missing IMOs, unique added IMOs actually present in rows, and `count = referenceCount + addedReferenceImos.length`. No numeric normalization/repair of identifiers.
- A valid success atomically replaces the last-good snapshot and marks the attempt successful. Malformed/partial/stale finish returns `false` and changes nothing. If validation fails on a still-live run, explicitly finish failure rather than continuing to poll indefinitely.
- Failure: call finish with SQL NULL `p_snapshot` and a reason code. Supported sanitized codes: `timeout`, `upstream_unavailable`, `rate_limited`, `incomplete_snapshot`, `invalid_snapshot`, `cancelled`. Any other text becomes `Fleet risk refresh failed.`; raw errors/URLs/secrets are never echoed. Failure retains the old snapshot. An expired/stale worker returns `false`, including failure calls.
- Durable request-to-run mappings are retained inside the singleton row, not an extra history table. This is intentional to preserve idempotency after later runs. They are not exposed by the read RPC; no pruning policy is silently applied. Long-term map growth is an operational consideration, not a hosted capacity claim.
- Manual confirmation, public-source fetching, scheduling-token verification, HTTP method/action validation, immediate UI display, and frozen PDF are implemented in the UI/handler and locally verified; see `fleet-risk-handoff.md` for the real Deno source run. SQL alone cannot prove a fetched fleet was complete; the generator separately reconciles the authoritative reference roster before publishing.

## Operator-only deployment prerequisites (NOT performed)

The Edge handler is locally verified. Do not run the cron installer until deployment is explicitly authorized and the handler is actually deployed to the selected project.

1. Confirm the target project and apply the migration with a privileged migration owner. Existing Supabase roles `anon`, `authenticated`, and `service_role` must exist. Do not grant table access or browser writer execution.
2. Independently enable/verify `pg_cron`, `pg_net`, and `supabase_vault` in that project through the approved operator workflow. The installer does not install extensions. It checks exact prerequisite API signatures and refuses missing prerequisites. Both database session timezone and `cron.timezone` must explicitly be UTC/GMT/Etc/UTC. An older pg_cron without an observable timezone is rejected; do not remove the check to guess.
3. Parent Edge configuration checklist (placeholders, not commands or actual values):
   - `SUPABASE_URL=<the selected project URL>`
   - `SUPABASE_SERVICE_ROLE_KEY=<existing server-only role key, never frontend>`
   - `FLEET_RISK_SCHEDULER_TOKEN=<a privately provisioned random token>` (coordinate this environment name with the parent handler).
   The scheduled route must require an exact token match from `x-fleet-scheduler-token` before using `p_trigger:'scheduled'`; normal anonymous callers must not acquire scheduled runs merely by setting `action`.
4. Provision exactly one nonempty Vault entry for each name through the operator's private Vault workflow, without putting values in repository files or chat:
   - `ship_fleet_risk_url` → `https://<project-ref>.supabase.co/functions/v1/fleet-risk`
   - `ship_fleet_risk_anon_key` → the project's **anon JWT** used as `Authorization: Bearer ***` (not a service-role key or an incompatible publishable-key token)
   - `ship_fleet_risk_scheduler_token` → the exact same private scheduler token the Edge handler checks.
   The URL must have the exact HTTPS Supabase host and fixed path, no query, userinfo, port, or trailing slash. Key/token values must contain no whitespace. This candidate neither creates nor reads production secrets.
5. Run the separate cron installer only after these prerequisites. The named job uses `0 23 * * *` in UTC = Taipei 07:00, invokes the private wrapper, and POSTs `{"action":"scheduled"}` with explicit headers. The pg_net request timeout is 210000 ms; the worker still has its own fixed four-minute SQL lease. A network timeout does not imply that a worker did or did not finish: read the cache state before deciding next action.
6. Run the separate readback. After full install, expect the four cache RPCs plus one scheduler wrapper (five ACL rows), three valid Vault configuration rows, one active matching cron job, and all structural/ACL/schedule checks true. `has_last_good_snapshot` and `has_attempt` may be false initially. Before scheduler install, the first migration checks can be used independently; the full file intentionally stops at missing scheduler prerequisites. Do not treat a missing install as authorization to run SQL.
7. Hosted acceptance remains separate: observe the actual scheduled invocation and a complete successful snapshot through the real deployed handler, then verify UI/PDF snapshot identity. Redacted catalog readback, a queued request ID, local test GREEN, or local shims do not establish this. No production success is claimed.

API references consulted: Supabase pg_net documentation (`https://supabase.com/docs/guides/database/extensions/pg_net`) and pg_cron (`https://github.com/citusdata/pg_cron`). Installed extension versions/signatures are still checked at install rather than assumed.
