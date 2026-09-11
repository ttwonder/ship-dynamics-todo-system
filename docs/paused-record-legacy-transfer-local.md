# Paused records → frozen legacy: local staging only

This development addon stages the current authoritative records payload into the frozen legacy row. It **does not resume business writes or publish an active route**. Do not install on a hosted database from this document. App/UI/roles/defaults are unchanged.

## Installation and operator contract

Use an idle, owned native PostgreSQL fixture. Install the existing schema/record fixture, compact ACK and both original prune migrations, `normalized-legacy-cutover.sql`, `20260911_legacy_report_workspace_binding.sql`, `20260911_business_quiescence.sql`, then `20260911_paused_record_legacy_transfer.sql`. Reapplying the base requires reapplying these extensions in order. The addon uses a source-checked insertion into the existing row guard; unknown source shapes abort. No trigger disable or general service-write exemption is installed.

The sole public operation is:

```sql
stage_ship_dynamics_paused_records_to_legacy_v1(
 p_workspace text, p_workspace_id uuid, p_transition uuid, p_watermark jsonb,
 p_source_revision integer, p_source_sha256 text, p_target_revision integer,
 p_target_sha256 text, p_frozen_at timestamptz, p_request_id uuid
) returns jsonb
```

Only an actual `service_role` session role may call it. JWT/GUC claims are not role authorization. Start a fresh READ COMMITTED transaction without advisory, subsystem, control or business locks. The operation acquires the existing **global exclusive maintenance gate first**. Legacy advisory acquisition is nonblocking and target/control row acquisition uses NOWAIT; `40001` requires a new transaction. Unsupported isolation/prior locks reject with `25001`.

Supply the exact workspace UUID/key binding, current paused transition and **original** pause watermark, current source revision/server hash, current frozen target revision/server hash and frozen timestamp, plus a stable request UUID. The hash is PostgreSQL `SHA256(UTF8(jsonb::text))`, not JSON.stringify. No caller payload is accepted. Malformed identities reject with `22023`; stale/binding/readback/replay mismatches reject with `55000`; role denial is `42501`.

## Metadata and trusted content

Original `src/cloud.ts` reads `payload,revision,updated_at,updated_by` and applies the row revision to both normalized and raw payloads. The existing row/history revision columns are integer counters. Consequently the destination revision is `max(source revision, current destination revision)+1`, rejecting integer exhaustion and history collisions. Source and destination counters are recorded separately; the destination is never assigned a smaller source counter.

Only root `revision` and root `updatedAt` are mapped. The timestamp is server UTC milliseconds and is identical in destination payload, row and history. The source's ordinary `updated_by` is preserved. Record commits already store the source row timestamp at microsecond precision but publish root/ACK text at milliseconds (`record_store.sql:484–491`); source validation honors that original precision contract. Every other payload field and array position—including task/control/meeting links and audit provenance—is copied from the in-transaction records full read without client normalization.

An inaccessible context row binds backend, transaction, session actor, exact old/new row hashes and exact history hash. It permits one intended UPDATE and one history INSERT only. Existing audit restoration remains tied to service role and frozen private restore state. The normal row guard, actor/authorization/CAS rules and audit stamping remain on every ordinary path.

The operation independently prepares expected row/history content, reads both after triggers and verifies complete equality and server hash. It then clears private context and atomically records the exact request/result and staged business watermark. Receipt readback and freeze-control readback are verified too. Failure rolls back target, history, restore controls and receipt together.

## Result and replay

Success returns `state: staged-paused`, request/workspace/transition IDs, a server request hash, separate source/previous-target/new-target revision and payload hashes, source/new-target timestamps and the metadata mapping description. The stored result contains no business payload. Repeating the exact request from the same database session actor, in a fresh transaction, returns that stored result without row updates or receipt replacement. It also verifies the source, target/freeze identity and staged watermark. Another request, actor, transition or changed identity is rejected. This is database operator identity, **not** a new end-user authentication scheme.

The original pause watermark is never replaced. Its readback intentionally reports `unchanged: false` after staging. The old resume operation therefore rejects with `business-pause-state-mismatch`; both business write paths stay paused. There is deliberately no new resume/route publication API in this slice. A future controlled cutover/resume workflow remains separate work, not an undocumented way to bypass this pause.

## Native verification and scope

```bash
# Both native runtime/module paths and an external evidence root are mandatory.
node scripts/verify-paused-record-legacy-transfer-native.mjs
```

The runner uses the real original cloud block builder, a real linked synthetic fixture and owned loopback PostgreSQL only. Stable ST cases cover a real later source commit while the frozen target has a higher revision; role/binding/malformed/stale negatives; unsupported transaction order/isolation; faults after target write and receipt insertion; active same-workspace context actor mismatch; corrupted stored receipt readback; exact target/history equality; exact readonly replay; changed actor/request denial; continued legacy/records pause; real backend waiting during actual staging and replay; base-then-addon/repeated installation.

The original pause and provenance regressions are also run through repository-external derivatives that install this addon on the effective native fixture. Keep their case counts separate from ST cases. All earlier failed receipts/inputs remain evidence, not acceptance. No browser, hosted SQL/ACL, production, full rollback, durable client envelope, old-client retirement or end-to-end route-cutover acceptance is claimed. Independent formal Itinerary/report stores stay where they were and their existing business watermark entries must remain equal.
