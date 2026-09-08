# Case/meeting exact reads and task/bulk QA oracle repair

Development-only continuation of `record-precise-task-read-slice.md`. This is a usable **partial R1/R2/R3** slice, not closure of the six-item programme. The canonical entry remains `index.html -> main.tsx -> App`. No NormalizedApp, new UI, role-policy change, L2/member API, lease-key change, root writer change, migration change, push, hosted SQL or deployment.

## Task/bulk oracle correction

The preceding task oracle copied SQL AFTER's whole audit/notification arrays into expected; the bulk oracle checked only part of the graph. A real saved native SQL readback from the prior slice, with audit action and recipient tampered, passes that old oracle. The new regression requires rejection and is genuinely RED against immutable `eee31b6`; it is a **QA RED**, not evidence that the product wrote wrong side effects.

`record-scoped-business-oracle.mjs` now reconstructs the outgoing graph over raw BEFORE, validates every outgoing CAS, and compares it against explicit original fixture intents. The request is captured at Chrome Fetch Request stage and saved before `Fetch.continueRequest` permits SQL execution. Expected status, actor, closure, linked case changes, malformed/unknown raw history and order, vessel attention, complete audit/notification membership and order, recipient, original action names and bystanders are checked. `saveTask`'s original 維修 -> maintenance rule is explicit, including its additional vessel audit. Bulk checks both complete linked graphs and the entire workspace payload.

Only generated IDs and client timestamps come from the pre-SQL request; timestamps are separately bounded. SQL-owned root revision/time are separately checked; exact private adapter IP/country headers are expected only on newly inserted audits. No SQL AFTER array is copied into expected. Six real-readback mutations per task/bulk probe reject audit action tampering, audit omission/order changes, wrong/missing recipient notices, and unknown-history loss. These are QA integrity cases, not additional browser E2Es.

## Product read wiring

- Internal-control list/navigation is home metadata. Existing editor acquisition and post-lease freshness load the exact `internalControlCases:<id>` graph. Read-only opening has an invisible `loadCase` prop and uses the returned fresh target, not a captured summary.
- Meeting navigation loads metadata then the original automatically selected meeting graph before mounting, using the existing visibility and newest-created rules. This also closes an evidenced immediate-manual-sync race where the initial asynchronous detail load could otherwise be superseded by a home read.
- Explicit meeting selection and its full history draft are built from the returned fresh snapshot and necessary linked tasks. The child read effect is cancelled on selection/identity/epoch changes and does not overwrite the same editor's active draft. Original identity-reset behavior is retained; this is not acceptance of the remaining R3 ABA matrix.
- Existing meeting edit/delete/close/reopen and unlinked-decision paths use the same exact post-lease refresh. Linked decision transitions retain the original complete relation-lock/bulk coordinator and one SQL transaction. Creation sentinels retain the active metadata/target scope rather than falling back to full. New bodies remain subject to the existing raw coverage/write gate.
- Manual/background/save/rebase reads retain the active exact scope. Selected meeting PDF preparation requests the union of selected meeting IDs before print state publication. Register PDF and internal-control list/stat exports use metadata consumed by their unchanged original renderers; no history is silently required or fabricated.
- The fresh child snapshot preserves the original role-visible tasks/meetings/cases/dismissals projection. Mutating callbacks, labels, styles, relationship helpers and lifecycle rules are unchanged.

The existing SQL closure is reused without alteration: real `meetings`, bidirectional task/case links, source meeting and sibling task graph in one read snapshot. Raw own-key maps, known-field masks, ordered opaque unknown data and read-only SQL snapshots remain in the previous implementation.

## Evidence layers

Latest native original-App runner: `node scripts/verify-record-scoped-browser.mjs` (private PostgreSQL HTTP transactions, private Chrome profile, synthetic users and adapter headers).

| Stable case | Acceptance |
|---|---|
| CASE-LIST | Original navigation, metadata, no unrelated history/snapshot or full read |
| CASE-LIFECYCLE | Selected fresh history -> add status -> close -> closed-list reopen -> original Save/ACK/release/manual sync; linked task + case raw histories retained; both complete outgoing-request/SQL graphs and fresh SQL connection readback |
| MEETING-LIST | Metadata + exact original default selection; immediate original manual sync retains full selected history |
| MEETING-LIFECYCLE | Full selected history -> original edit/status save -> linked decision completion with requested closure status -> whole meeting close -> reopen; four original transactions, original audit actions/actor/recipient, complete outgoing-request/SQL graphs, old raw histories and fresh SQL connection readback |
| MEETING-SELECTED-READ | Register -> a different explicit meeting -> fresh complete history -> manual sync; no write RPC; independent unselected-meeting history facet deferred until selected |

Prior COLD, VESSEL-SCOPE, ACTION-DETAIL, TARGET-TASK, RELOAD-TARGET-TO-HOME, BULK-TARGET-UNION and READONLY-TARGET are rerun. SCOPE-PROTOCOL remains a protocol/SQL check, not a UI E2E. The case/meeting persistence oracle proves complete **request-to-SQL** equality plus named business/side-effect intent assertions; it is not presented as an independently reimplemented full lifecycle business engine.

`verify-record-case-meeting-ui-boundary.mjs` compares every complete JSX subtree against `eee31b6`, allowing only:

1. App -> InternalControlPage: `loadCase={loadInternalControlScope}`.
2. App -> TemporaryMeetingsPage: `loadMeetings={loadMeetingScope}` and `authorizationEpoch={authorizationEpoch}`.

Only CRLF/LF clean-filter differences are normalized. The native runner verifies these props do not leak into DOM attributes. The pre-existing internal-control QA source assertion was updated to the exact prop allowlist after proving the original `data={roleVisibleData}` boundary remains.

## Still REMAINING — not optional or completed

- Dedicated scoped original-UI acceptance of case create, withdrawal/re-sync/delete, read-only roles, requested-case cross-entry, bulk case-only, and create/recovery failures. Their shared exact-read callbacks are wired, not individually accepted by this slice.
- Dedicated meeting create/delete, linked decision reopen/repair, unlinked decisions, per-vessel progress, selected PDF union/print, role-specific viewing, child-draft and late identity/config negatives. Shared original callbacks are wired, not exhaustive class acceptance.
- Exact vessel detail, batch managed vessels plus task-create return, task creation/persisted creation intents, individual task close/delete, bulk deletion and remaining source-graph classes.
- Closed-task-list and WorkCenter-specific scoped tracers, personal dismissal across peer/fresh documents.
- Morning comparison/cutoff sources, report preview/save and immutable historical snapshot/revision pinning, stats and management overview scopes. Genuine whole-workspace backup/export may retain full; management overview is not thereby whole-export.
- Pre-fix dirty/pending storage and immutable lost-ACK original operation/signature reconciliation. Never project dirty to clean, replace the pending command, or clear storage.
- Actor/config/read-mode/generation/incarnation/scope ABA, stale ACK, task child draft/caret and late-response controls, inverse compatibility.

All unrelated previously closed root/audit/ABA/mixed/native protocol work stays closed. The other owner's three untracked native-subset files remain present and untouched; this work does not claim a globally clean worktree or independent review of those files.

Fixed complete external handoff: `C:/Users/tuotu/AppData/Local/hermes/cache/record-read-lock-6e300abf/case-meeting-read-delivery.json`. It records actual commit/tree, changed paths, protected hashes, raw RED/GREEN receipts, final byte checks, all remaining rows and owned cleanup. Production and independent release acceptance are not claimed.
