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
node scripts/verify-normalized-legacy-import-db.mjs
```

The first `apply-normalized-manifest` invocation is a no-write dry run and prints only the manifest version, file count, and bundle SHA-256. A staging write additionally requires `NORMALIZED_TARGET=staging`, `NORMALIZED_DATABASE_URL=[REDACTED]`, `PSQL_PATH`, `--apply`, and the exact `--confirm staging:HOST:VERSION` string. The tool rejects the production project reference and sends database credentials only through child-process environment variables, never command arguments or logs.

Auth mapping apply requires `MIGRATION_SUPABASE_URL`, `MIGRATION_SUPABASE_SERVICE_ROLE_KEY`, `MIGRATION_ALIAS_HMAC_SECRET`, and `MIGRATION_PACKAGE_PASSPHRASE`, all supplied by the staging secret environment. Legacy import apply separately requires the reviewed mapping, exact source revision/counts, explicit staging confirmation, and a fresh empty target.

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
- Confirm the exact deployed legacy revision and exact frontend commit/tree.
- Verify the active Owner can authenticate in the new Auth flow.
- Provision all pending accounts before cutover; do not expose them to the legacy client.
- Take a Supabase-native database backup.
- Export the exact legacy row to an encrypted offline file and record only its checksum, revision, row count, and storage location in the run report.
- Verify the restore procedure against staging.
- Build the new client from the exact reviewed tree and retain the previous deploy artifact.

## 6. Maintenance-window transaction

1. Enable a server-enforced workspace maintenance flag; legacy writes must fail on the server, not just hide buttons.
2. Wait for in-flight requests to finish and verify no active leases or pending legacy writes remain.
3. Re-read the legacy row and assert its revision is the expected final revision.
4. Run the normalized import in one PostgreSQL transaction. Any invalid ID, duplicate, missing relationship, role violation, or count mismatch aborts the entire transaction.
5. Run the post-import validator before the transaction/cutover is accepted.
6. Verify Owner, admin, operator, and vessel RLS probes using real Auth JWTs.
7. Deploy the reviewed client.
8. Run the critical browser smoke suite.
9. Disable maintenance only after all gates pass.
10. Keep the legacy row read-only; do not delete it.

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

1. Re-enable maintenance.
2. Re-deploy the previous known-good frontend artifact.
3. Re-enable legacy table writes only after confirming the legacy revision has not diverged during cutover.
4. Keep normalized tables and operation/audit evidence read-only for diagnosis; do not attempt reverse dual-write.
5. If a post-cutover normalized write occurred, record it separately and reconcile deliberately before any future migration attempt.
6. Restore from the encrypted legacy export/database backup only if the legacy row itself was damaged.

## 9. Production approval boundary

Development may prepare and test every artifact. Applying migrations, provisioning production Auth users, enabling maintenance, importing production data, deploying, or changing production grants requires a separate explicit production approval with staging PASS evidence attached.
