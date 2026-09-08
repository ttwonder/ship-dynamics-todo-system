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

## Explicitly OPEN

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
- Overall parent claim/refresh barriers beyond the proved stale overall read;
  complete lease renewal/release schedule permutations.
- Full shared transition graph: failed parent acquisition/handoff, concurrent final
  closures, reopen/closed-source permissions; original member-delete → parent handoff.
- Same-member stale CAS after another editor changes the member.
- Broad global dirty queue coexistence/automatic reconciliation. Member publication
  still refuses an unsafe unrelated local delta and retains request/draft; no
  overwrite or false automatic recovery claim. Overall-only unsent fields are not
  added to member draft persistence. Header feedback for component-only edits is
  not claimed globally resolved.
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

`QA_MEMBER_UI_FOCUS=scope|recovery|lifecycle|pair` selects bounded tracers;
default runs the original 8 scenarios. Recovery and lifecycle run in separate fresh
fixtures: the original PAIR oracle assumes no prior actor notifications, so the
matrices are not concatenated into one mutated database. Do not add rerun counts together.
Frozen JSX gate permits only exact named internal TaskEditModal prop values and the
original selector callback; all other roots, CSS, entry and native files are frozen.
External `member-recovery-delivery.json` indexes final command receipts, old failed
attempts, exact input hashes, cleanup, local commit and ownership handback.
Independent review is reserved to the parent and was not requested by this writer.
