# Original task-member editor — bounded local slices

Entry remains `src/main.tsx → App`. Native protocol base is
436f9cd3a3146e51c7c6d9e61cb069279e13f035; recovery slice continues
parent-verified e35b9e4977cfa2d82a73a383d0b2715b5e0828ca.
**Usable local integration, not full R3 / member-program closure.**
No push, production SQL, deployment, user browser, role redesign, or native SQL edits.

## Recovery/lifecycle slice

Original UI and private native PostgreSQL acceptance (unique scenario IDs):
- MEMBER-UI-SCOPE-GENERATION: held overall native scope read → successor B;
  stale read makes zero parent claims/publication, A draft returns without autosave.
  Same-node assertion is B before/after the late result; overall and member already
  render different fields and are not falsely claimed to share one DOM node.
- MEMBER-UI-LATE-CLAIM-ABA: native committed B claim response held, A selected,
  old B lease expired in synthetic SQL, new B version acquired. Old exact release
  cannot delete/replace the successor lease or draft.
- MEMBER-UI-FRESH-PENDING: real new original browser document over existing origin
  storage restores newer unsent rich text. Original pending envelope remains byte
  identical; exact operation/payload receipt adoption commits no replacement;
  newer text saves separately. Unselected members, unknown raw task fields and
  original raw history tail are checked independently.
- MEMBER-UI-FRESH-UNSENT-PRIVATE: unsent-only progress and not-yet-added quick input
  survive a new document. Another original actor cannot see/adopt the private draft.
  Recovery makes zero business writes; explicit original Cancel discards it.
- MEMBER-UI-NAV-CONTINUITY: original navigation cannot invalidate/orphan an open
  member editor. Same node and writable draft remain until explicit close.
- MEMBER-UI-CONFIG-ABA: actual config observer freezes the same draft node;
  restoring A after B does not reauthorize its predecessor.
- MEMBER-UI-ACK-LEASE-EXPIRY: legal native command commits, response is held near
  the actual 25-second heartbeat. SQL lease expiry triggers real client read-only
  mode; the legal committed ACK still succeeds, with one command and no replay.

Separate controlled production-code tests cover stale pre-dispatch renewal,
current renewal, actual App busy-unmount cleanup, four independent pending identity
mismatches (zero dispatch and unchanged envelope), missing receipt / original
replay without new CAS, identity-versus-config continuity, and both config-write
entry/race guards. These are **not** additional UI/native cases.

Durable drafts reuse `NormalizedDurableStateStore` with exact URL/workspace,
actor, task/member keys. They keep old member/structure/source CAS and baseline,
not a new CAS from a refreshed document. Pending commands remain in the existing
member pending key; unknown outcome does not authorize deletion. Only the exact
selected confirmation merges acknowledged history. No new workspace store,
whole-task conversion, browser-storage clearing, or global dirty overwrite exists.
Unmount invalidates even a busy editor but does not discard its durable artifacts.
Explicit close removes visited unsent drafts only when no matching pending exists.

## Preserved first-slice scenarios

PAIR, SWITCH, OUTCOME, OVERALL, SAME, LEASE-LOSS, SWITCH-LATE, TRANSITION remain
in the final default runner (8 unique original scenarios, not 8 acceptance classes).
PAIR uses original pure business helpers and pre-SQL outgoing intent for the full
expected task/source/notices/audit/history/unknown-field graph. Native definitions,
reverse SQL and native verifier remain unchanged; the prior 36 native baseline and
bounded native review are not repeated or counted as new evidence.

## Parent/shared completion slice (base 159fcd3)

This slice preserves original markup, labels, roles, helpers and native SQL.
Only `App` feedback enrollment and explicit member retry acquisition change.

- **Feedback RED→GREEN:** actual original quick-input and frozen CONFIG DRAFT
  RETAIN scenarios asserted the false saved strip / safe-to-leave assurance.
  Member-local capture and recovery now join the existing page feedback boundary.
  Typed-only quick input, added notes, other visited dirty members, unknown ACK
  with newer typing and config-frozen drafts are covered. Confirmed B saves and
  legal ACK after real lease expiry still succeed; ordinary Close/discard and
  clean no-editor Sync restore the existing saved feedback. Local durability is
  never advertised as cloud confirmation.
- **Failed shared handoff RED→GREEN:** after native zero-write `transition-required`,
  a controlled competing exact task claim denies acquisition after the source
  lease was acquired. Full raw record/history ledger stays identical, only owned
  source leases release, and the original draft remains. Once the blocker closes,
  the original Save action reacquires the child with the OLD member/source CAS.
  It does not reinterpret unknown outcome as permission for a new operation.
- **Complete shared graphs:** concurrent last-two member closes, shared last-close
  retry and shared reopen derive expected business values before SQL from the
  original workflow helpers and outgoing command. Only generated IDs and bounded
  server timestamps come from results. Task/source/decision/notices/audit/history,
  unknown raw fields, unselected members and fresh SQL/browser readers are checked.
- **Concurrent reopen loser:** two original outgoing intents overlap; A cannot
  claim the parent while B still owns its child. B wins after A releases its child.
  A's explicit retry preserves its old source CAS and is rejected with zero partial
  writes. B's full graph survives a fresh-reader check.
- **Original deletion policy:** the original JSX explicitly excludes the Delete
  button in single-member scope (`!editingSingleVessel`). It is not added here.
  The original selector → Overall → Delete confirmation already performs the exact
  parent handoff. Cancellation, blocked source with draft retention and original
  retry, complete allowed deletion and real valid wrong-task/wrong-meeting guards
  are verified. Alias substitution is a labelled controlled transport fault over
  real native SQL; it is not an ordinary user action. Full BEFORE ledgers reject
  partial record/history writes. The delete oracle separately checks the original
  helper-derived business graph against outgoing intent before SQL.
- **Direct neighbors:** same-member stale CAS after an intervening original editor
  rejects without overwrite; independent held native parent CLAIM and REFRESH
  responses cannot hijack or release the successor's exact parent lease. Existing
  canClose hiding, meeting-management denial and completed-meeting reopen prohibition
  remain unchanged and are directly verified.

Fixture role/closure setup and SQL lease-expiry/competing-claim hooks are controlled
QA setup. Saves, selectors, confirmations, logins and reads use the original App;
no production setter or fabricated SQL success is substituted.

## Explicitly OPEN (outside this finite slice)

- **MEMBER-UI-UPGRADE:** exact persisted pre-fix whole-task envelope, original
  coordinator/RPC/signature/CAS reconciliation and original-UI upgrade proof.
  No migration or claim of compatibility was added. The inspected original App
  whole-task path constructs an operation ID inside its in-memory cloud queue
  (`App.tsx` / `cloudBlockReceipt.ts`); this is not proof of a durable old envelope.
  The exact predecessor artifact/route still must be identified and exercised,
  not fabricated or converted into a member request.
- Forced mounted actor/config callback ABA at every await boundary, full production
  bootstrap/auth/render-gate matrix. Config-observer native proof and controlled
  identity predicate are scoped evidence, not full production-mode render proof.
- Complete lease renewal/release schedule permutations beyond the separately proved
  representative parent CLAIM and REFRESH generation barriers.
- Broad global dirty queue coexistence/automatic reconciliation. Member publication
  still refuses an unsafe unrelated local delta and retains request/draft; no
  overwrite or false automatic recovery claim. Overall-only unsent fields are not
  added to member draft persistence. The bounded member feedback defect above is
  closed; this does not claim a global dirty-queue redesign.
- Remaining R1–R3 entry inventory, hosted/QPS/mobile/PDF/cutover, and the prior
  six-item program are unchanged OPEN. This is not production acceptance.

## Reproduce locally

Use explicit approved `SHIP_QA_PG_BIN`, `SHIP_QA_PG_MODULE`, external
`QA_EVIDENCE_ROOT` and dedicated `QA_VITE_CACHE_DIR`.

```
node scripts/verify-task-member-browser.mjs
QA_MEMBER_UI_FOCUS=recovery node scripts/verify-task-member-browser.mjs
QA_MEMBER_UI_FOCUS=lifecycle node scripts/verify-task-member-browser.mjs
node scripts/verify-task-member-lifecycle.mjs
node scripts/verify-task-member-ui-boundary.mjs
node scripts/verify-record-scoped-browser.mjs
npm run test:meeting-vessel-progress
npm run test:meeting-reconcile
npm run test:workflow
npm run test:related-durable-mutations
npm run test:session-exit-durability
npm run test:task-readonly-projection
npm run test:cloud-record-workflows
npm run typecheck
npm run build
```

`QA_MEMBER_UI_FOCUS=scope|recovery|lifecycle|pair|feedback|shared|concurrent|concurrent-reopen|stale|parent|delete|delete-blocked|delete-wrong-task|delete-wrong-source|permission|closed-source|close-policy` selects bounded tracers;
default runs the original 8 scenarios. Recovery and lifecycle run in separate fresh
fixtures: the original PAIR oracle assumes no prior actor notifications, so the
matrices are not concatenated into one mutated database. Do not add rerun counts together.
Frozen JSX gate permits only exact named internal TaskEditModal prop values and the
original selector callback; all other roots, CSS, entry and native files are frozen.
External `member-recovery-delivery.json` indexes final command receipts, old failed
attempts, exact input hashes, cleanup, local commit and ownership handback.
Independent review is reserved to the parent and was not requested by this writer.
