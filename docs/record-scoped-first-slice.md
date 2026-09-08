# Original App scoped-read first slice (local development only)

Opt in with `storageMode: 'records-v1', readMode: 'scoped-v1'` and install `supabase/development/20260908_appdata_record_scoped_read.sql` only in the private development fixture. No production config, automatic migration manifest, grants, root locks or per-task-vessel leases changed.

## Delivered path

Original `main.tsx -> App`: cold dashboard -> original Quick Update -> exact vessel lease -> existing compact transactional patch/receipt -> authoritative scoped readback -> existing confirmed-state merge -> safe release. Peer saves remain visible after sync without replacing an open child draft. Lost ACK is recovered from the real stored receipt. No alternate application or visible markup/style changes.

The server returns ordered lists for all existing search/filter/count semantics, but task/case/meeting histories are bounded to the two existing preview entries and agenda snapshots are absent from the home read. No client-side page slicing or hidden full hydration. Subsequent reads send cached row versions and receive only changed row bodies; root/order metadata remains complete. Raw cache bodies are detached from editable normalized objects. Home summaries cannot produce task/case/meeting/report mutations. Vessel writes overlay actual normalized changes on the exact raw expected record, retaining unknown and unchanged fields (including the original two-lane dynamics replacement rule).

Explicit navigation to non-dashboard consumers, vessel detail, task opening/creation, report preview and batch editing requests a compatibility full action scope before consuming histories. Full action state is not advertised as a complete all-screen on-demand implementation. Clean persisted full-action state may collapse to home only when local equals its trusted confirmed base and the projected base equals the authoritative home result; dirty state does not pass this shortcut.

## Evidence

External root: `C:/Users/tuotu/AppData/Local/hermes/cache/record-scoped-slice-20260908-2236`.

- Behavioral REDs: cold full-history download `ui-jbASRp/receipt.json`; missing action detail `ui-0HhgRV/receipt.json`; clean full-to-home reload blocked `ui-KmYaxi/receipt.json`; unknown raw vessel field loss `ui-Cjschg/receipt.json`.
- Final scoped native original-UI GREEN: `ui-l2qzOK/receipt.json`: COLD, SCOPE-PROTOCOL, VESSEL-SCOPE, ACTION-DETAIL, RELOAD-FULL-TO-HOME. Native independent HTTP transactions, real receipt loss/recovery, complete raw SQL payload equality, unchanged unrelated row value/revision/xmin/ctid, unchanged Itinerary authority and new-document readback.
- Existing delta-mode original-UI/native concurrency controls: `ui-kQp07x/receipt.json`.
- Command receipts: `gates.json`, `native-scoped-green-command.json`, `legacy-record-mode-ui-command.json`. Setup failures remain retained and are not RED evidence.
- UI is labelled **真實 UI＋測試資料**. This is not hosted Supabase, production ACL/Realtime acceptance or a user trial.

## Exact unfinished coverage / constraints

1. R1 is NOT globally complete. Home still retains complete vessel/authority rows and the existing audit/notification/dismissal collections needed by existing authorization, retention and patch logic. It is not yet a minimal scalar summary schema. SQL summary projection still hydrates each changed task row before trimming histories; server-side history processing is not eliminated.
2. Non-dashboard tabs (MorningWorkspace cutoff comparisons, task lists/editors, internal-control, meetings, reports/PDF, stats, management), vessel details and batch/creation transitions use explicit full action scope. Replace these with their own loaded/version scopes without changing original graph or report rules. Only task-table navigation was browser-exercised as an expansion consumer in this slice; the other action wiring needs its own regression cases.
3. Task/case/meeting linked transactions, report snapshots and last-member completion -> meeting synchronization are unchanged and not converted to scoped saves here. Quick Update opened while a full-data consumer is visible retains that full scope rather than replacing its history with summaries.
4. Original-browser persisted **dirty** full/legacy cache -> scoped mode migration and pending-operation recovery are NOT verified; only the pure clean-cache guard rejects dirty data. A coverage-bearing persisted envelope and matching recovery matrix remain. Clean full-action -> home reload is verified.
5. Scope-specific held-response actor/config/navigation ABA, reconnect/deletion/recreation, workspace import incarnation binding and complete fresh-reader convergence matrices remain. Home peer draft continuity and actual saved receipt/readback are verified, not the entire R3 matrix.
6. Unknown fields on unchanged/scalar-edited vessel objects are verified. Unknown nested fields inside user-replaced arrays and all other operation families still require their own lossless oracles.
7. Database-root isolation and per-vessel task-progress lease/CAS changes (L1/L2) are not included. Existing last-vessel completion permission and linked meeting lifecycle code is untouched.

Do not deploy this as complete R1-R3 closure. No push, merge, deployment or production SQL was performed. Independent review was not performed by this sole-writer slice; parent owns reconciliation.
