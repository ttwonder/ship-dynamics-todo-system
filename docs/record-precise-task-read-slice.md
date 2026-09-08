# Precise task/linked-graph read slice (development only)

This is a usable **partial R1/R2/R3 delivery**, not completion of all on-demand reads.
The canonical original entry remains `index.html -> src/main.tsx -> App`.
No L2 member API/token/lease, root writer protocol, production SQL, push or deployment is changed.

## Protocol and writable baseline

`RecordReadScope` is `home | full | { targets: RecordTarget[] }`. Targets use the
real `tasks`, `internalControlCases`, `meetings`, `agendaReports` collections.
The development RPC retains text `p_scope` and adds a defaulted JSON `p_targets`;
the obsolete three-argument SQL overload is explicitly dropped. Existing home/full
three-argument SQL callers still resolve the defaulted function. No ACL is granted.

Every response carries all collection IDs in authoritative order. Per-row versions
include detail coverage. SQL closes both directions of task/case and meeting/task
links; sibling meeting tasks are included where that relationship requires them.
The client verifies workspace, scope, collection completeness, ordered membership,
versions, row identities, detail coverage, and the cache base before publication.
Literal `constructor` / `__proto__` record IDs use own-key-safe row maps.

Summaries choose the first two **normalizer-valid** history entries, not the first
two arbitrary raw values. They are not complete writable task bodies. Updates are
applied as normalized deltas over the separately retained raw server originals;
unchanged raw object fields, keyed-array entries, unknown history properties and
malformed entries excluded by normalization survive. Array order is preserved.

Task opening hydrates an exact target graph before the existing editor/lease path.
The original post-lease freshness check remains. Read-only opening uses the newly
published live snapshot rather than the prior summary render closure. The existing
batch command coordinator reads the entire selected union once for planning and
again after its complete lock bundle; save/rebase/readback retain that same scope.
It does not sequentially evict earlier selected targets or secretly request full.

## Fixed consumer/command coverage table

PASS means the named original UI/native-SQL behavior was exercised, not all variants.
WIRED means source wiring exists but no claim of complete behavioral acceptance.
REMAINING means still inherited full or missing the required acceptance.

| Class / entry | Current read | Evidence / remaining |
|---|---|---|
| Default dashboard bootstrap | home summaries | PASS COLD |
| Dashboard vessel quick editor/save | home | PASS VESSEL-SCOPE: lost ACK, peer child draft, raw vessel equality |
| Vessel detail `openVesselDetail` | full | REMAINING exact vessel-related summaries/details |
| Total task list `navigateToTab(total)` | home | PASS ACTION-DETAIL; no unrelated history/snapshot transfer |
| Closed task list | home | WIRED; original closed-list-specific tracer remains |
| WorkCenter list | home | WIRED; dismissal-specific scoped tracer remains |
| Existing task editor + full history | exact task graph | PASS TARGET-TASK, including linked case and complete raw SQL graph |
| Existing task read-only viewer | exact task graph | PASS READONLY-TARGET through real vessel login; no write RPC |
| Task save / ACK / manual sync | active exact graph | PASS TARGET-TASK; unknown fields and malformed/ordered logs survive |
| Task creation / addTaskForVessel | full | REMAINING creation and persisted creation-intent scopes |
| Individual task close/delete | action-specific existing paths | REMAINING dedicated scoped class tracers |
| Bulk task completion | selected target union | PASS BULK-TARGET-UNION; two linked graphs with deep histories, one revision, complete release |
| Bulk task deletion / meeting-task transition | shared selected-union coordinator | WIRED; dedicated delete/transition/scoped source-graph tracers remain |
| Bulk internal-control-only selection | selected case keys through extra locks | WIRED; dedicated original-UI tracer remains |
| WorkCenter personal dismiss | home metadata; dismissal records are complete | WIRED; peer/fresh-document scoped dismissal tracer remains |
| InternalControlPage navigation/editor/create/withdraw/delete | home list; exact selected case graph; creation keeps active metadata/targets | PASS list/history/close/reopen; shared create/withdraw/delete wiring, dedicated scoped tracers REMAINING; see case/meeting slice |
| TemporaryMeetingsPage overview/editor/create/close/task decisions | home list + exact default/selected meeting graph | PASS original history/edit-save/linked decision complete/meeting close/reopen/explicit selection; other command and export tracers REMAINING; see case/meeting slice |
| Morning workspace / comparison | full | REMAINING previous snapshot and cutoff consumers |
| Report preview / historical report / report save | full or inherited nav-full | REMAINING explicit selected-source/pinned-snapshot reads; no live substitution for history |
| Stats navigation | full | REMAINING determine exact consumer needs |
| Batch managed vessels | full | REMAINING exact operational scope plus task-create return context |
| Management / backup / export | full | Only genuinely whole-workspace operations may retain full at final closure |
| Background/manual synchronization | current active scope | PASS scoped vessel and target manual sync; task child draft/ABA/late-config matrix remains |
| Persisted clean coverage collapse | target -> home | PASS RELOAD-TARGET-TO-HOME; prior full -> home slice remains separate historical evidence |
| Pre-fix dirty/pending / immutable lost ACK | not migrated here | REMAINING old envelope must reconcile unchanged; never project dirty local to fake clean |
| Cache authority isolation | config/workspace/read-mode + scope/base checks | REMAINING actor/generation/incarnation ABA and all late-response controls |
| Scope protocol malformed responses | fail-closed | PASS SCOPE-PROTOCOL (protocol/SQL layer, not an E2E scenario) |

## Evidence and bounded gates

Raw receipts are retained, including all failed harness and product attempts, under:
`C:/Users/tuotu/AppData/Local/hermes/cache/record-read-lock-6e300abf/precise-runs/`.
The fixed external `precise-read-delivery.json` identifies the final commit/tree,
latest native receipt, raw SQL readbacks, all RED/GREEN attempts and gate logs.

Original behavioral REDs established: list nav downloaded unrelated detail; exact
task open downloaded unrelated detail; task save dropped an unknown raw history
property; batch home save rejected unloaded detail; raw-first-two summary disagreed
with normalized preview; missing collection did not reject; read-only opening used
stale summary history. Each was exercised GREEN after its corresponding change.

The batch source gate was migrated from the old `fetchCloudData` call spelling to
`fetchMutationScope`, retaining before-claim ordering, complete relation-lock closure,
after-claim freshness and lock-set equality assertions, plus explicit union checks.

Affected gates: record delta/workflows, block patch, rebase, read-only projection,
normalizer, batch tasks, batch internal control, physical task-progress SQL verifier,
typecheck, build, diff check. Exact JSX subtree equality against c448836 is recorded
externally; no visible JSX, CSS, labels, props, navigation order or business rules
were rewritten. Original task category -> vessel attention side effects are retained.

The follow-up `record-case-meeting-read-slice.md` replaces the task/bulk SQL oracle: old task checks copied entire SQL audit/notification arrays into expected and bulk checked a subset. Historical receipts therefore did not prove independent complete business expectations. The new oracle captures outgoing requests before SQL, derives task/bulk business graphs from raw BEFORE plus explicit original intent, and mutation-tests audit/recipient/history omissions and tampering.

Independent review is a parent reconciliation step, not claimed by this child.
Do not call R1/R2/R3 complete or enable this development mode in production yet.
