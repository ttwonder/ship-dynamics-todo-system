# Tracking UI slice — local implementation

## Scope and mounted entry

`src/main.tsx → App.tsx → tracking/TrackingPage.tsx` is the real application path. The shore-only navigation entry `配件/物料/工程跟蹤` follows `內控異常`; existing navigation relative order is retained. No tracking entry or important-task controls/copy are added to the ship portal.

The five literal tabs are `未送船清單`, `已送船清單`, `配件物料總清單`, `未完成工程單`, `已完成工程單`. Selection is a single currently authorized active vessel, displayed with `vesselSelectionDisplayName`. Previously selected vessels are revalidated before reuse.

Implemented: complete applicable F28/F34 source fields, independent original remarks/progress/supplemental notes, optional DL, mutually exclusive ordinary/urgent editing, urgent reference text, complete filters and sorting, 30-row paging/jump, page versus all-filtered selection, personal column display/order/resize/reset, single/batch create, edit, changed-only progress, independent partial/full/corrected delivery, close/date correction/reopen, and explicit one-source/one-case synchronization. Create fixes the vessel and offers an explicit supply/engineering selector. Engineering cancellation is archived with `取消（非完工）`, not counted as completion.

At this slice's original commit, Excel template/import/export/PDF (R11–R12/R21–R23) remained for the next slice and no placeholder buttons were shipped. The completed integration and release evidence are now documented in `tracking-spreadsheets-release.md`. No historical attachment data is automatically imported.

## Business/save boundary

- `runTrackingCommand` remains the Phase 2 all-or-none domain command. It produces an AppData delta, **not** a saved result.
- `TrackingUiCallbacks.submit` is implemented by App's `submitTracking`: current identity/permissions → explicit absent-source creation admission → existing exclusive/related lease coordinator → domain command → truthful `withAudit` → existing durable save queue → server receipt/readback. Source/case/existing task are not three separately saved mutations.
- Source leases remain `tracking:<stable-id>`. Reserved creation IDs are admitted explicitly rather than treated as existing records. Related locks are renewed through the existing coordinator.
- `loadTrackingScope` unions explicit source targets and `trackingVesselIds` with the previously loaded scope; clean reload recovery also retains standalone tracking vessel coverage.
- Only matching confirmed/read-back saves clear the submitted draft/selection. Newer typing remains locally dirty on the same editor; an already-created sync case is updated through `runTrackingUiCommand`'s `sync-edit`, using the original internal-control updater, not created twice.
- Unknown ACK stores the exact record RPC request before dispatch, under original identity and source operation ID. Reconciliation uses its original operation, operations, guards, authority and read scope. It does not regenerate a payload from new versions. Without an exact request or under successor identity it stops rather than guessing.
- Proven rejection can be explicitly reconciled against fresh versions while preserving input. Unknown results cannot be discarded as rejected. Batch progress lets the user explicitly remove conflicting rows before a new submission.
- Draft, column preferences, and remembered vessel have different local-storage keys. Drafts are workspace/actor/vessel scoped; column preferences additionally include tab and schema. Save/keep/cancel navigation is based on actual dirty edits.

## Existing internal-control form and lifecycle

`InternalControlModals.tsx` extends `BatchCreateModal` with optional `sourceForm` metadata: stable per-row source/case identity and report date/source. Ordinary internal-control and ship consumers retain their default form. Required validation and shore-only task projection controls are reused. Existing linked sources show a view link; mixed selections require exact eligible-subset confirmation. Missing default departments warn without creating a department or matching arbitrary people.

A matching sync ACK displays the dismissible literal:

> 已在這邊輸入項目，不要再在內控重複輸入！

`TrackingLifecycleHint` supplies the exact existing source/case/task group to the original shore case/task editors and their confirmation. No new ship-side close/reopen authority is introduced. Delivery, DL, original completion dates and unrelated same-reference engineering subitems are not rewritten by lifecycle actions.

## Parent reconciliation

The parent matched all 31 returned file hashes and 26 latest gate-command receipts to the worker handback, then inspected the actual App integration and representative desktop/mobile screenshots. Three bounded corrections were added with real mounted regressions:

- Follow the existing App theme tokens instead of making only this module dark when the OS prefers dark mode.
- Source synchronization explains per-source dates and provenance; the ordinary batch form retains its original shared-field caption.
- Explicit rejected-submit reconciliation is busy until the fresh authoritative source read settles. The native read-barrier case proves the Save control stays disabled, no partial SQL changes occur, and typing during that read survives into the next confirmed save. Unknown ACK remains non-discardable.

The last correction exposed a separate test-only readiness assumption on return from the original case editor; that probe now waits for its exact source row, not just an empty table shell. The controlled read hook is opt-in and only in the local QA fixture.

Parent final run: `test:tracking:browser` PASS (17 real-App scenarios in native PostgreSQL, 7 component-only scenarios), `typecheck` PASS, `build` PASS. Earlier RED/failure receipts are retained; they are not counted as new independent cases. Browser errors were empty and the owned browser, HTTP service, database port and disposable database data were cleaned up. Final parent receipts are `parent-ui-final.json`, `parent-typecheck.json`, and `parent-build.json` under the existing repo-external evidence directory. Unchanged-layer gates retain their original evidence; no second independent reviewer or production validation is claimed.

## Phase 4 integration contracts

Use these exports; do not duplicate field mappings, filtering, domain validation or persistence:

| Module | Export / intended use |
|---|---|
| `trackingColumns.ts` | `TRACKING_COLUMNS`, `TrackingColumn`, `TrackingColumnType`, `trackingColumnsFor(kind)`: labels, value getters, type, default width, applicability and original-field editing metadata. |
| `trackingFilters.ts` | `TRACKING_TABS`, `TrackingTab`, `TrackingFilter`, `TrackingQuery`, `trackingInTab`, `trackingTabKind`, `filterIsActive`, `selectTrackingRows`: full filtered/sorted set before pagination, nulls-last and stable-ID ties. Caller must supply already-authorized vessel scope. |
| `trackingFilters.ts` | `trackingRowSnapshot(rows, columns)`: immutable cloned items plus exact IDs, per-column values, labels/types/widths. Pass all intended filtered/selected rows, **not** the current 30-row slice and never unsent drafts. |
| `trackingTablePreferences.ts` | `TrackingPreferences`, `TRACKING_COLUMN_SCHEMA`, key/read/write/default helpers. Column order/display is presentation, not permission or deletion. Hidden active filters remain effective. |
| `trackingUiTypes.ts` | `TrackingSubmission`, `TrackingUiCallbacks`: `load`, `submit`, `release`, optional `discardRejected`, `openCase`, `registerNavigationGuard`. Reuse App callbacks for any future confirmed import. `submit` only returns true after authoritative acknowledgement/readback. |
| `TrackingModals.tsx` | `newTrackingItem`, `makeTrackingDraft`, `commandForTrackingDraft`, `trackingAffectedLabels`, `TrackingDraft`. Preserve stable IDs/context on retry. |
| `trackingUiCommands.ts` | `runTrackingUiCommand`, `TrackingUiCommand`: existing tracking commands plus only the saved-sync-form continuation. |

At the future export action inside `TrackingPage`, construct the snapshot from its `rows` (already filtered/sorted), explicit selected IDs when requested, and the chosen ordered column metadata. Freeze that snapshot before asynchronous file work and recheck original actor/workspace/generation. There is deliberately no disconnected no-op export callback/button in this slice.

## Executable verification

- `npm run test:tracking` — existing Phase 2 domain/command/linkage suite.
- `npm run test:tracking:native` — 19 real native PostgreSQL cases, including the parent's combined morning/tracking scope regression.
- `npm run test:tracking:table` — 9 named table/scope helper contracts.
- `npm run test:tracking:browser` — 17 real mounted App + private native PostgreSQL scenarios and 7 separately labelled component-only scenarios. Core paths include create/ACK/reload, reused sync form, lifecycle from source/case/task, delivery independence, exact unknown-ACK retry, stale batch and lease rejection, held-ACK latest typing, current operator scope, selection, 65-row paging/sorting, personal preferences, pointer/keyboard sizing and 390px light/dark checks.
- Affected original case/batch browser gates also execute after updating their obsolete fixture prerequisites and close-checkbox selectors. The batch mounted-only callback probe remains separately labelled. The complete schema is installed **before** baseline storage is captured.
- Existing ship browser gate: 13 native cases. Existing original authority browser gate: 26 native cases. Other affected record/save/permission/internal-control gates, typecheck and production build are recorded in the repo-external gate receipts.

Native/browser gates need the existing local QA environment (`SHIP_QA_PG_BIN`, `SHIP_QA_PG_MODULE`, `QA_PREDECESSOR_MODULE`, `QA_EVIDENCE_ROOT`). The implementation used the parent's verified values via a separate wrapper/evidence directory; it did not overwrite Phase 2 evidence. All browser pages are labelled **真實UI＋測試資料** (fixtures may space the words), use disposable profiles and owned loopback databases, and shut down after execution.

Evidence is local implementation proof, not hosted Supabase/PostgREST/Realtime or production acceptance. No remote migration, deployment, Push or production data action was performed. Full final receipts, screenshots, raw-byte hashes, historical REDs and scoped limitations are in `C:/Users/tuotu/AppData/Local/hermes/cache/scratch/tracking-ui-implementation/handback.md` and its companion JSON files.
