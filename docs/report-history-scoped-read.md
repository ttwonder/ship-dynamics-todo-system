# Report history scoped reads — local delivery

Base: `7bc51d3a1fdb416c1aa9d99d00fe6f1900c47afb`. No production configuration, ACL, locks, CAS policy, UI copy or layout changes.

## Internal contract

- Report navigation uses the existing `home` scoped read. SQL emits `__recordSnapshotAvailable: true` only for an object snapshot with vessels/tasks/meetings arrays. Normalization preserves this read-only marker; the list keeps the original businessDate/updatedAt ordering and filters. Missing/malformed snapshots remain unavailable.
- The marker is not a fake snapshot. Block/CAS request bodies reject it; legacy whole-data cloud writes reject summaries. Full writable/capture reads contain the actual snapshot, not metadata. Clean-cache projection matches the SQL summary.
- Opening a history row requests its exact agendaReports ID (including reopening the same target), rechecks the fresh row and existing role/scope policy, and uses the full frozen snapshot in the unchanged preview.
- Report actions capture actor, identity-session generation, authorization epoch, configuration coordinator epoch and report-action generation. Close/navigation invalidate the continuation.
- Original manual daily save expands complete coverage before Itinerary refresh and before upsertDailyMorningReport. Existing helper, audit, queue, snapshot ACK and confirmed merge remain. Live PDF preview still expands full coverage. Current-page printing keeps its original data needs (no invented capture or full barrier).

## Local verification

Run `node scripts/verify-report-history-scoped-browser.mjs` with explicit external QA_EVIDENCE_ROOT, QA_VITE_CACHE_DIR, QA_HMR_PORT, SHIP_QA_PG_BIN and SHIP_QA_PG_MODULE. It mounts main.tsx -> App against private native PostgreSQL, restricts requests to the fixture origin/data/blob, uses isolated Chrome profiles, and retains receipts/screenshots/actual response bodies outside this repository. No production credentials or services.

Additional gates: `verify-report-history-scoped-controls.mjs` (controlled production callbacks, not UI/SQL), `verify-report-history-scoped-boundary.mjs` (exact source substitutions and frozen UI), adjacent `verify-stats-scoped-browser.mjs`, original morning-history/cutoff/daily-history-pagination tests, typecheck and build. Native list fixture has two valid rows plus absent/malformed controls; the original pagination helper separately exercises 65 dates.

Save expected is fixed before SQL from raw BEFORE plus the original upsert helper and explicit fixture Itinerary projection. Generated IDs/client timestamps come from the outgoing request and are checked; only revision/root timestamp and known server-added IP fields are treated as server metadata. The complete frozen tasks/cases/meetings/member-history graph, all original physical rows, audit and notifications are checked. Eight oracle mutations must be rejected.

## Retained limitations and existing differences

- `verify-morning-history-pagination.mjs` still expects `historicalDiscussionTasks` in unchanged MorningWorkspace; the current original consumer uses `historicalEntries`. This legacy harness mismatch predates this slice.
- `verify-morning-report-window-content.mjs` expects an explicit `<h2>內控議題</h2>` section in the PDF body. The pinned original App and this candidate both lack it; the original KPI counts are unchanged. This pre-existing rendering/content gap is NOT fixed by this storage/read slice.
- No fresh independent review, full root/member audit, hosted SQL, production smoke, remote query/fetch/push or deployment. No mobile/PDF layout redesign or separate server pagination. Native window-print/download and mobile visual smoke are not claimed; current-page print is checked at the production callback/source layer, live preview at real UI/native SQL.

Exact local evidence/commands/input hashes and cleanup receipts are delivered in the external report-history-scoped-delivery-v2.json handback.
