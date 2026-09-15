# SQL Editor backup: verified seed handoff

## Current boundary

`supabase/release/04_bounded_backup_seed.sql` is a read-only **first backup packet**, not an installer, a completed application backup, or a future cutover checkpoint. Run it only in the intended Supabase project `cyzpcvvhmoiihsqvjspp`, verified independently in the dashboard. The workspace ID is `2ae6e674-21ba-520c-93db-8cea28e84dd0`; the source revision is read live, never pinned to an earlier inventory.

The user copies the complete commit-verified Preview textarea, pastes into a **new** SQL Editor query, presses Run, and downloads the original one-row CSV with column `backup_packet`. No clipboard API or agent-side production execution is used. Do not run the failed `02_preinstall_app_backup.sql` again. No database password, Connect dialog, IPv4 add-on, new extension, new role or provider change is required by this handoff.

## What the packet contains

- All current `public.ship_dynamics_app_state` rows, limited to two rows and 8 MiB total serialized raw bytes. The known predecessor contains the main workspace and an older QA workspace; neither is silently discarded.
- The complete discovered application-table row inventory: schema/name/OID/relfilenode, CTID/XMIN versions, row counts, and table/column/constraint/index/trigger/policy metadata.
- Discovered application function definitions, owners, ACLs and SHA-256 hashes.
- Explicit status, target labels, read-only repeatable-read context, packet byte count/SHA-256 and an end marker.

**It does not contain the bodies of the other application tables yet.** In particular, historical snapshot bodies, Itinerary documents, other permission/operation rows and quarantine bodies remain for later batches. Their presence in the inventory is not a claim that they have been backed up.

Exclusions are explicit in the packet: Supabase Auth, Storage files, provider-managed objects, roles, sequences, cron/scheduler state and a complete executable DDL restore script. This is not disaster recovery for the entire Supabase project.

## Resource and privacy boundaries

The seed reads only CTID/XMIN from the history tables; it does not sort or aggregate their large business payloads. Current rows are measured first and compressed individually before collection. Each application table inventory is limited to 20,000 rows; metadata is limited to 4 MiB and packet content to 8 MiB. Unexpected relation kinds/inheritance, reader/target/extension problems, and exceeded limits produce STOP or an SQL error, not a successful empty backup. Statement timeout is 20 seconds and lock timeout is one second.

`pgcrypto` must already be installed and callable. PGP ZIP compression uses a deliberately public, non-secret constant solely as a transport wrapper. **This offers no confidentiality protection and is not the database password.** Original CSV, decoded rows and function definitions remain confidential local files. Never upload them to GitHub or paste them into chat; do not resave the CSV in Excel.

These limits reduce the specific failed export's resource mechanism; they do not promise zero resource use, prove provider payload limits, or prove current production saves work. Do not retry an error automatically.

## Actual local verification

Run from this repository:

```text
python scripts/verify-bounded-backup-native.py
```

The final native PostgreSQL 17.11 run passed 14 checks using synthetic data. It included a 4 MB-class current JSON row and 138,215,424 bytes of physical history storage. With the same 16 MiB work_mem and a 1 MiB temporary-file cap, the old whole-history sort failed as expected; the new seed passed with zero additional reported temporary bytes. The exported envelope was 3,170,366 bytes in this fixture.

The original first seed attempt failed because a multi-row XML forest is not a single XML document. The corrected query uses `query_to_xml(..., false, false, ...)` and `/table/row`; the failed receipt is retained, not overwritten by later PASS claims.

Coverage includes original CSV quoting/roundtrip, byte/hash validation, truncated/tampered envelope rejection, exact current-row restore through native PostgreSQL, RLS-filtered reader refusal, wrong-workspace refusal, a non-superuser BYPASSRLS reader, pgcrypto in a provider-style `extensions` schema, excess current-row count, excessive raw size, and changed non-main row versions with an unchanged main revision. Owned test clusters and ports were stopped and owned database directories removed. The human trial site was not touched.

This is query/transport/local-current-row evidence, **not hosted backup success, all-table restoration, whole-App review, or deployment approval**. Independent design observations are not an exact-candidate independent PASS.

## Decode a real downloaded seed

After the user supplies the original CSV path, use a new private output directory:

```text
python scripts/ship-backup-packet.py --csv "<original-download.csv>" --out "<new-private-output-directory>"
```

The script validates the packet and complete inventory, starts an owned loopback-only native PostgreSQL decoder, decodes current rows, checks exact UTF-8 hashes/lengths and source revision, writes original row bytes without reserializing business JSON, and stops/removes the owned cluster. It does not execute downloaded definitions or contact Supabase. Existing output directories are refused rather than overwritten. Keep the CSV and receipt; a verified seed is still marked `completeApplicationBackup: false`.

## Remaining before a complete backup or installation

1. Verify a real provider CSV end-to-end; a local PASS cannot establish provider transport completeness.
2. Generate bounded data batches from the returned live manifest. Bind exact relation identity, row locator/version coverage, schema and column definitions in each batch's transaction. A plain CTID/XMIN comparison plus matching initial/final definitions is insufficient for a schema rename-and-restore (DDL ABA); acquire ordinary ACCESS SHARE protection before the relevant schema/snapshot checks. CTID/XMIN are short-lived physical export locators, not restored row identities.
3. Implement and verify full-batch aggregation, no missing/duplicate rows, and final fresh manifest comparison. Do not call separate SQL Editor runs a shared MVCC snapshot. Any changed table, schema or function blocks a coherent-complete claim and requires an explicit refreshed collection strategy, not blind retries.
4. Exercise all-table restoration, including the observed GENERATED ALWAYS `sd_itinerary_daily_reports.report_id`: explicit identity insertion and sequence handling are required. The first seed's current-state restore does not prove this path. Capture any additional sequence/scheduler/role dependencies required by the actual rollback scope instead of silently treating exclusions as included.
5. Complete the production-equivalent incremental install, first legacy-to-absent-records transition, separate readback and latest-data rollback package. Preserve later committed data; never overwrite T1 with this earlier seed T0.
6. Only then hand off the independently separated production installation/cutover SQL. Push remains separately controlled by the user.
