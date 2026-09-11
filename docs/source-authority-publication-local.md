# Local source authority publication

Development-only backend seam. Install on an **idle, owned local database** after the existing original-App record/formal fixture, legacy report workspace binding, `20260911_business_quiescence.sql`, and `20260911_paused_record_legacy_transfer.sql`. This file is not a production migration or authorization to execute SQL remotely.

## Controls

All three new public functions retain service-only EXECUTE. Their bodies require real PostgreSQL role checks, not JWT/GUC role claims. Publication/resume additionally require an explicit `SET LOCAL ROLE service_role` in a fresh READ COMMITTED transaction.

```sql
publish_ship_dynamics_source_authority_v1(
  p_workspace text, p_workspace_id uuid, p_transition uuid,
  p_stage uuid, p_stage_result jsonb, p_request_id uuid
) returns jsonb

resume_ship_dynamics_legacy_authority_v1(
  p_workspace text, p_workspace_id uuid, p_transition uuid,
  p_publication uuid, p_publication_result jsonb, p_request_id uuid
) returns jsonb

read_ship_dynamics_source_authority_v1(p_workspace text) returns jsonb
```

1. Commit a legitimate records business result, freeze legacy using its original exact revision/hash control, then pause and stage through the existing service controls.
2. **Publish while paused.** Supply the exact stage result returned by the database. Publication binds workspace key/UUID, original transition/watermark, stage request/result/staged watermark, current source revision/hash and the complete frozen target control. It does not rewrite the original pause watermark or unfreeze legacy.
3. Read publication state separately from historical control receipts. A successful publication returns `state: published-paused`, `source: legacy`, `epoch: 1`, workspace/transition/publication/stage identities. The first explicit managed publication allocates epoch 1. This bounded one-way slice refuses another NEW publication on an already-managed workspace; neither replay, resume nor a later same-source pause advances or reduces that epoch. Forward migration/another authority transition needs separate scope.
4. **Resume target atomically.** Supply the exact publication result. Revalidate all proofs, then clear only the intended legacy freeze, change the existing pause transition to resumed, and mark current publication resumed in one transaction. A receipt-trigger fault or final readback mismatch rolls back every control, receipt and business effect. Never substitute separate old reenable/resume commits.
5. Exact original DB-session-actor/request-bound publication and resume replay returns only the stored result, even after target progress or a later pause. Replay cannot change current state. The state reader reports `managed`, selected `source`, independent `epoch`, `publicationPhase`, current `pauseState`, and `admitted`. An unmanaged workspace returns `managed: false`; it does not invent a source choice.

Use fresh transactions. Controls drain the existing exclusive global maintenance gate first, then TRY the legacy subsystem lock and NOWAIT target/control tuples **before** reading the proof. An older ungated tuple/control holder causes `40001`, not a reversed wait or lock upgrade. Shared business entries use the existing maintenance protocol; source-specific checks read control afresh under READ COMMITTED.

## Source admission, not client epoch fencing

| Actual family | Explicit admission |
|---|---|
| Ordinary record patch, record task-member save, record prune/scheduler/import | Existing record writer fan-in; retired `records-v1` new work rejected |
| Legacy block patch/v2 and configured direct legacy fallback | Existing aggregate writer and legacy-only physical backstop; old role/CAS/audit/receipt contracts unchanged |
| Shared formal record/main save | Installation-derived private copies of the **same original core** with literal record/legacy entry provenance; original wrappers select them |
| Manual report save and IDs/dates delete | Existing source-specific RPCs, admission after exact terminal branch and before any STARTED/REJECTED/COMMITTED ledger work |
| Legacy prune and morning scheduler | Explicit legacy admission before root/ledger or first shared report write |
| Public-vessel formal save | Explicit neutral formal entry; original portal/lease/validation guards remain |
| Auth-based `sd_itinerary_save_office` | Explicit neutral formal entry: auth/rollout/formal-store-only, not the legacy-main actor route |
| Formal Itinerary scheduled worker and top-level job | Source-independent UUID/formal snapshot writer; original pause row guards retained |

The shared core's unclassified direct NEW invocation fails closed on a managed workspace. The named public-vessel/Auth-office entries privately select neutral variants; a caller cannot pass a source parameter, set a GUC/JWT/header, or use an `office` actor label to select them. Private schema/functions have no browser/service grants. Record-only and legacy-only physical tables have source backstops; **shared tables never infer source**. Their normal entrypoints supply the distinction.

Existing public function OIDs, signatures, owners, security modes and ACLs are checked before/after installation. Source splices preserve original actor/role/CAS/lease/audit/business bodies. Record wrappers remain security-invoker with their pre-existing development ACLs; native owner execution does **not** prove hosted browser grants.

Actor helpers are not globally gated. Record report actor initialization retains its original policy; a maintenance read gate precedes it and NEW work refreshes the actor before original checks. Main report terminal lookup retains its earlier position before current actor validation. Formal status retains its narrower actor-key contract—not a fabricated full-envelope check. Exact report replay retains `created: false`; formal replay retains `replayed: true`; unknown receipt/status cannot authorize target work. Historical operation lookup creates no STARTED row.

Lease/read/cache operations remain separate. Reapplying the pause addon can derive its private lease-only gate from the current writer; this extension removes precisely its own source-business insertion from that copy. Install **base → pause → stage → authority** after base reapplication. A fresh old records→legacy stage is refused once legacy is managed, including after target progress and a later pause; exact historical stage replay keeps the original stricter staging constraints.

## Reproducible native verification

Set absolute local `SHIP_QA_PG_BIN`, `SHIP_QA_PG_MODULE`, `QA_EVIDENCE_ROOT` and an external `QA_VITE_CACHE_DIR`, then from the repository run:

```sh
node scripts/verify-source-authority-publication-native.mjs
node scripts/verify-source-authority-publication-native.mjs --regressions
node --check scripts/verify-source-authority-publication-native.mjs
npm run typecheck
npm run build
```

No installs, service changes, external database inputs, network credentials, production, browser profiles or UI edits are used. The native helper allocates a fresh loopback cluster, verifies backend IDs/data directory/port, closes clients, stops only its owned cluster, verifies port closure and removes owned data with retry. Credentials are never printed.

Every run writes an immutable input hash manifest and content-addressed raw source blobs outside the repository. The regression mode generates three external runners from the original pause, stage and provenance scripts. It changes only fixture composition, addon install hooks and import locations—not assertions—and records exact producer recipes/source/generated hashes and command exits. The original pause/stage/provenance scripts are not edited. The provenance runner uses the existing complete original-App fixture to install all required tables/functions, while retaining its original synthetic workspaces and assertions.

Native case IDs distinguish unmanaged controls, managed family positives/negatives, physical backstops, exact recovery, actual backend barriers, old operator NOWAIT, late fault/readback rollback and reapplication. Addon regressions remain separate layers; do not turn their sum into browser/E2E coverage. Current delivery JSON binds final commands to final raw and Git-clean identities. Failed inputs/receipts remain preserved: initial missing-publication `42883` is **capability-only**; later candidate behavioral failures and SQL implementation errors are separate evidence, not defects attributed to the previously closed pause/stage baseline.

## Explicit non-claims / handoff

No client transport/authority binding, client epoch adoption, min-version policy, cross-reload generic command journal, new save coordinator, forward legacy→records migration, original-App hot cutover acceptance, UI/copy/role redesign, production SQL, deployment, Push, staging, commit or independent review PASS is included. A server-published epoch alone is not end-to-end client fencing. Parent review and separately scoped client binding follow this local backend handback.
