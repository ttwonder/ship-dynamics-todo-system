# Normalized cutover and rollback runbook

This runbook deliberately avoids dual-writing the legacy JSON payload and normalized tables. Dual-write would create a second distributed consistency problem.

## 1. Environment separation

- Development: PGlite integration tests, no remote writes.
- Staging: a separate free Supabase project with Auth, PostgREST, Realtime, Edge Functions, and representative anonymized data.
- Production: existing Supabase project during an announced short maintenance window.
- `public/supabase-config.js` remains unchanged throughout development. Staging configuration is injected outside committed browser assets.
- Service-role keys, database passwords, activation codes, and user passwords are environment variables or secret-store values and must never enter git, logs, screenshots, fixtures, or generated reports.

## 2. Required artifacts

1. Ordered additive migrations for foundation, meeting, internal control, settings, Auth mapping, RLS, and command RPCs.
2. A dry-run legacy validator producing counts and invariant failures only, with no PII.
3. An Auth provisioning tool with `--dry-run` default and explicit `--apply`.
4. An idempotent data importer whose idempotency key is `(workspace_id, legacy_revision)`.
5. A post-import verifier comparing counts, stable IDs, canonical relationships, and authorized projections.
6. An encrypted offline legacy JSON backup plus a database-native Supabase backup.
7. A rollback script that re-enables the legacy client/table without deleting normalized evidence.

### Executable artifact gates

```bash
node scripts/verify-normalized-manifest.mjs
node scripts/verify-normalized-manifest-apply.mjs
node scripts/apply-normalized-manifest.mjs
node scripts/verify-legacy-auth-mapping.mjs
node scripts/verify-legacy-migration-cli.mjs
node scripts/verify-normalized-legacy-cutover-db.mjs
node scripts/verify-legacy-cutover-operations.mjs
node scripts/verify-normalized-legacy-import-db.mjs
```

The first `apply-normalized-manifest` invocation is a no-write dry run and prints only the manifest version, file count, and bundle SHA-256. A staging write additionally requires `NORMALIZED_TARGET=staging`, `NORMALIZED_DATABASE_URL=[REDACTED]`, `PSQL_PATH`, `--apply`, and the exact `--confirm staging:HOST:VERSION` string. The tool rejects the production project reference and sends database credentials only through child-process environment variables, never command arguments or logs.

Auth mapping apply requires `MIGRATION_SUPABASE_URL`, `MIGRATION_SUPABASE_SERVICE_ROLE_KEY`, `MIGRATION_ALIAS_HMAC_SECRET`, and `MIGRATION_PACKAGE_PASSPHRASE`, all supplied by the staging secret environment. Legacy import apply separately requires the reviewed mapping, exact source revision/counts, explicit staging confirmation, and a fresh empty target.

### Executable backup, freeze, restore, and write re-enable

`legacy-cutover-operations.mjs` is service-role tooling. It is default-deny for production, reads secrets only from `MIGRATION_*` environment variables, and never prints the service-role key or backup passphrase. The encrypted backup is created with exclusive-file semantics and mode `0600`; `verify` decrypts it and checks the SHA-256 of the exact PostgreSQL `jsonb::text` exported by the server.

Freeze must happen **before** backup. Compute and independently record the expected final revision and PostgreSQL `jsonb::text` SHA-256, then pass the same `(workspace, revision, payload hash)` to freeze and backup. The server refuses an unfrozen export or any source/control mismatch.

```bash
# Staging rehearsal. PAYLOAD_SHA256 is the expected hash of the final source row.
node scripts/legacy-cutover-operations.mjs freeze --workspace-key WORKSPACE --revision REV --payload-sha256 PAYLOAD_SHA256 --confirm staging:freeze:WORKSPACE:REV:PAYLOAD_SHA256
node scripts/legacy-cutover-operations.mjs backup --workspace-key WORKSPACE --revision REV --payload-sha256 PAYLOAD_SHA256 --output legacy-backup.enc.json --confirm staging:backup:WORKSPACE:REV:PAYLOAD_SHA256
node scripts/legacy-cutover-operations.mjs verify --input legacy-backup.enc.json
node scripts/migrate-legacy-to-normalized.mjs --backup legacy-backup.enc.json --mapping AUTH_MAPPING.json --workspace-id WORKSPACE_UUID --workspace-name NAME --apply --confirm staging:WORKSPACE_UUID:REV:PAYLOAD_SHA256
node scripts/legacy-cutover-operations.mjs restore --input legacy-backup.enc.json --confirm staging:restore:WORKSPACE:REV:PAYLOAD_SHA256
node scripts/legacy-cutover-operations.mjs reenable --input legacy-backup.enc.json --confirm staging:reenable:WORKSPACE:REV:PAYLOAD_SHA256
```

Production restore/re-enable is executable but intentionally harder than staging. Every invocation requires all of the following environment values: `MIGRATION_TARGET=production`, an exact `MIGRATION_SUPABASE_URL`, exact `MIGRATION_PRODUCTION_HOST`, exact `MIGRATION_PRODUCTION_PROJECT_REF`, `MIGRATION_ALLOW_PRODUCTION_ROLLBACK=I_UNDERSTAND_THIS_CHANGES_PRODUCTION`, and an action-bound approval `MIGRATION_PRODUCTION_APPROVAL=APPROVE-PRODUCTION-ROLLBACK:ACTION:WORKSPACE:REV:PAYLOAD_SHA256`. The command-line confirmation must separately be `production:ACTION:WORKSPACE:REV:PAYLOAD_SHA256`. Missing, staging, wrong-action, wrong-host/ref, wrong-revision, or wrong-hash confirmation fails before any RPC. Do not place these values in shell history or the run report; inject them from the approved secret environment.

The legacy-write trigger and every freeze, backup, restore, and re-enable RPC take the same workspace advisory transaction lock. A writer cannot pass the trigger immediately before freeze and commit after the frozen snapshot is recorded. The server trigger blocks `INSERT`, `UPDATE`, and `DELETE` on `public.ship_dynamics_app_state` while frozen, including callers that bypass browser UI. The importer independently requires the enabled trigger, a frozen control row, and an exact source revision/payload hash from the encrypted frozen backup; direct payload/live-read apply is rejected. A lost import response may be replayed only by the same service-authorized actor with identical payload, Auth mapping, counts, and quarantine count; the server returns the original hashes/counts with `replayed=true`. Any difference fails with `import-idempotency-mismatch`. Restore is the only guarded write path during freeze. Re-enable verifies the restored row revision and server hash before opening legacy writes. Normalized evidence is never reverse-dual-written or deleted.

## 3. Authentication activation

Legacy SHA-256 browser password hashes cannot be imported as Supabase Auth passwords. Passwordless identities cannot become trusted actors automatically.

- Provision one Supabase Auth identity for every active legacy user using an opaque deterministic alias derived with a migration-only HMAC secret from workspace and legacy user ID.
- Preserve display name, department, role, and vessel assignments only in normalized profile/membership tables.
- `scripts/prepare-legacy-auth-mapping.mjs` is dry-run by default. Its `--apply` mode refuses the production project, recovers interrupted runs by the deterministic alias, and resets a fresh temporary password on the same pre-created identity.
- Temporary passwords exist only inside an AES-256-GCM activation package protected by `MIGRATION_PACKAGE_PASSPHRASE`; the plaintext mapping contains Auth IDs and aliases but no credentials.
- The gated login directory may return opaque aliases to the browser only after a valid short-lived site-gate token. It never receives a login password and never returns an Auth access or refresh token.
- The browser signs in directly through Supabase Auth. A pre-created or administratively reset account remains `must_change_password=true` until the authenticated user changes the password and completes `complete_my_ship_dynamics_password_activation`.
- Owner must be activated and verified first; owner transfer remains a dedicated atomic command. Owner/admin may manage only non-owner accounts; only Owner may transfer ownership.
- No email confirmation is required for this internal workflow.

## 4. Staging rehearsal

1. Apply all migrations in one ordered deployment.
2. Run grants/RLS lint and confirm no command RPC is executable by `anon`.
3. Import an anonymized shape-equivalent legacy payload.
4. Provision test Owner, admin, operator, vessel, inactive, and outsider identities.
5. Run PostgREST/RLS tests using actual JWTs, including direct table probes and count/RPC probes.
6. Run two-browser concurrency scenarios: same entity exclusion, different entity parallel saves, lease expiry takeover, stale fencing rejection, stale version rejection, operation replay, and response loss.
7. Run Realtime invalidation tests and prove local drafts survive invalidation and session/workspace switches fail closed.
8. Run Edge Function CORS, JWT, Owner, input-validation, rate-limit, and secret scans.
9. Repeat the full import from a fresh staging database and compare the deterministic validation report.

No production migration may begin until the rehearsal has a recorded PASS.

## 5. Production preparation

- Announce the maintenance window and ask editors to close forms.
- Confirm the exact deployed legacy revision, expected PostgreSQL `jsonb::text` payload hash, and exact frontend commit/tree.
- Verify the active Owner can authenticate in the new Auth flow.
- Provision all pending accounts before cutover; do not expose them to the legacy client.
- Take a Supabase-native database backup before the maintenance window.
- Prepare the encrypted-backup output location and verify the full freeze → backup → verify → staging restore procedure. Do **not** export the final legacy row before writes are frozen.
- Build the new client from the exact reviewed tree and retain the previous deploy artifact.
- Have a separate approver supply the exact production host/ref and action-bound approval values only when the maintenance window begins.

## 6. Maintenance-window transaction

1. Freeze the legacy source with `freeze_ship_dynamics_legacy_writes`, supplying the exact expected revision and payload hash. The trigger and control RPC share the workspace advisory lock, so no pre-freeze writer can commit afterward.
2. Export the encrypted legacy backup from that frozen source and verify the file. Record only its location, revision, payload hash, and encrypted-file checksum in the run report.
3. Confirm no active normalized leases or unresolved operations remain.
4. Import **that encrypted frozen backup** into normalized tables in one PostgreSQL transaction. Any invalid ID, duplicate, missing relationship, role violation, source/control hash mismatch, or count mismatch aborts the entire transaction.
5. Run the post-import validator before the transaction/cutover is accepted.
6. Verify Owner, admin, operator, and vessel RLS probes using real Auth JWTs.
7. Deploy the reviewed client.
8. Run the critical browser smoke suite.
9. Keep legacy writes frozen after successful cutover; keep the legacy row as the rollback source and do not delete it.
10. If any gate fails, execute the approved restore/re-enable sequence below rather than manually editing the control row.

## 7. Import invariants

- Exactly one active Owner per workspace.
- Stable legacy entity IDs remain unchanged.
- Every active membership references one Auth profile.
- Every vessel account has exactly one active `vessel_account` assignment.
- Canonical assignments replace duplicate `managedVesselIds` / `assignedUserIds` claims.
- Every task vessel row references an existing vessel.
- Every meeting item has at most one canonical linked task.
- A task carrying meeting semantics without one exact parent meeting and item is never guessed into place. It is imported only into an Owner-visible migration quarantine with its reason code and legacy revision; all other roles receive no row, count, or error existence signal.
- Enabling quarantine requires an explicit cutover flag plus exact expected legacy revision and expected quarantine count. A mismatch aborts the import.
- Quarantined rows can leave quarantine only through an Owner-only resolution command that explicitly binds one valid meeting item or converts the row to an ordinary task.
- Every internal case has at most one canonical linked task and vice versa.
- Append-only status/audit timestamps and actors are preserved as imported evidence and clearly marked `legacy-import`.
- Internal, orphan, ambiguous, and unauthorized cross-vessel rows have no vessel-account projection.
- Site-gate secret is migrated as a hash; plaintext is never accepted by the importer.
- Notification retention limits and unread state are preserved or explicitly archived by documented policy.

## 8. Rollback

Rollback is required if any authorization, data-count, relationship, command, or browser critical-path gate fails.

1. Keep the normalized client in maintenance and re-deploy the previous known-good frontend artifact.
2. Confirm the approved encrypted backup's workspace, revision, and payload hash against the frozen control row.
3. If the legacy row was damaged, run the production `restore` command with the exact production target/ref/host, enable phrase, action-bound approval phrase, and command-line confirmation. Otherwise do not rewrite an intact source row.
4. Run production `reenable` with a **separate** action-bound approval and confirmation. The server rechecks the restored/current row revision and hash under the same workspace advisory lock before reopening writes.
5. Verify the previous frontend can read and write one approved non-sensitive fixture, then end maintenance.
6. Keep normalized tables and operation/audit evidence read-only for diagnosis; do not attempt reverse dual-write or delete evidence.
7. If a post-cutover normalized write occurred, record it separately and reconcile deliberately before any future migration attempt.

A production rollback is never authorized by this runbook text, a staging confirmation, or possession of a service-role key alone. It requires the explicit per-action approvals enforced by `legacy-cutover-operations.mjs` and the organization's separate production change approval.

## 9. Production approval boundary

Development may prepare and test every artifact. Applying migrations, provisioning production Auth users, enabling maintenance, importing production data, deploying, or changing production grants requires a separate explicit production approval with staging PASS evidence attached.
