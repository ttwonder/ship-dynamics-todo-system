# Mixed original-App / native PostgreSQL QA

Input HEAD: `e62081880343f53f5cb1e20aa2e7f49e0f1bf92d`.
Scope: QA/docs only; original `src/main.tsx → App`, synthetic Operator A on `qa-v1` and sole Owner B on `qa-v2`, separate Chrome contexts, original login/navigation/native input. No product or shared QA changes, push, deploy, production SQL, hosted queries, real credentials, or user Chrome profile.

## Acceptance result

**2/2 complete: M1 and M2 PASS on the final parent-run candidate.** The initial partial handback and all failed attempts remain historical evidence, not product REDs.

| Case | Observed original client / real SQL | Complete acceptance |
| --- | --- | --- |
| M1 ordinary task creation versus internal-control case plus linked task creation | A one request/ACK; B `order:tasks` conflict then original App read/rebase/new-operation retry/ACK; no manual recovery | PASS: complete per-revision expected payload, reciprocal links, derived vessel attention, exact outgoing audit bodies except server IP/country, notifications/dismissals, fresh SQL connection and two fresh-document original readers, unrelated record/formal/legacy/history preservation, zero trailing writes and zero active leases |
| M2 update the M1 ordinary task versus close the M1 case and existing linked task | A one request/ACK; B conflict then original App read/rebase/new-operation retry/ACK. Same drafts and close selection retained during pre-COMMIT hold. | PASS: original close-helper oracle, complete per-revision graph, immutable history, reciprocal links, fresh SQL connection and two fresh-document original readers, unrelated/formal/legacy preservation, final reload and zero trailing writes/active leases. |

The final parent-run terminal runner exits **0**. The two scenario IDs contain four actor-stages: all four complete automatically, with one initial conflict/retry for B in each stage. Manual recovery was not triggered or validated; its branch remains unexercised. Do not add actor-stages, retries or oracle probes to the two-case E2E count. No capacity, ordinary failure-rate or production-concurrency claim.

## Real concurrency and fixture

- Existing default-off `createNativeRecordQa(..., {httpTransactions:true})` with independent verified pooled HTTP connections, maximum 10. The shared adapter is unchanged. Original SupabaseJS transport executes each RPC on a real native PostgreSQL transaction.
- Both stages rendezvous at their actual outgoing requests on the same audit base. A is held after real successful SQL and **before COMMIT**. B reaches a distinct PID and `pg_blocking_pids(B)` includes A; native transaction receipts map B to its actual outgoing operation.
- Final-run M1 blocking leader/peer PIDs are 33796/41660; M2 PIDs are 41660/10756. Both are real `Lock/transactionid` waits. Exact base revisions, operation identities and input hashes are in the receipt; concurrency is not inferred from HTTP overlap.
- 500-entry noncanonical historical audit fixture; nonempty tasks/cases/notifications/dismissals, unrelated third vessel, formal documents/history and conflicting legacy revision 99. All owner setup precedes HTTP/UI startup. Login initialization settled before business-base capture (this run emitted zero initialization writes).
- Business expectations derive from the original outgoing operations plus read-only original patch/rebase/command helpers. No helper emits a browser write or retry; no SQL success/ACK is fabricated. Entire audit detail/name/role bodies come from outgoing requests, not actual SQL audit values. Only explicit server-owned IP/country and root revision/time are adopted as server metadata.

## Bounded harness failures retained

1. `mixed-KAMJFu`: wrong QA expectation that task-from-quick-vessel entry leaves no parent lease; original App legitimately returns to the vessel editor and reacquires its lock. Original abnormal-choice confirmation was missing from dialog allowlist. No product RED established.
2. `mixed-XniJp9`: QA incorrectly rebased the winning request, changing order of two equal-timestamp audits. Only `auditLogs` differed. Corrected to preserve the first actual outgoing order and apply rebase only to the concurrent losing intent.
3. `mixed-zYZe1t`: M1 fully passes; M2 stops in the **QA-side** rebase oracle after both App saves ACK. Read-only diagnostic shows unchanged status-log values but JSONB key order versus outgoing JS key order differs for the ordinary task (`at,by,id,text,byUserId` versus `id,at,by,byUserId,text`). The original helper uses `JSON.stringify` equality. This is a candidate explanation for the oracle conflict, not a reproduced product defect or an approved fix. Two repair rounds exhausted; no third repair or suite expansion.

### Parent resolution of the QA boundary

An initial parent attempt to normalize the whole raw model was rejected by its losslessness assertion: normalization adds defaults to a newly generated linked task. That failure remains under `parent-run/`; it was not treated as a product defect or bypassed.

The final oracle only canonicalizes **object key order** recursively before calling the unchanged rebase helper. Every property/value is retained, arrays are mapped without sorting or filtering, and each input is deep-equal to its unmodified raw value. First-writer audit order is still taken from the original outgoing operations; first outgoing audit bodies are retained rather than replaced by later retry captures. Full persisted payload comparisons remain intact.

The repo-external `oracle-key-order-probe.mjs` uses saved failing raw snapshots and the original helper through the existing Vite middleware loader. Its observed exit 0 proves the raw-order false conflict, exact semantic equality after canonicalization (accounting for the helper's documented next-revision result), and continued rejection when a real existing status-log text is altered. Its stdout is in parent tool history; `parent-frozen.json` indexes that execution with source/fixture hashes, rather than pretending a separate original stdout JSON was saved. The final original-App/native runner then passes both M1 and M2; this does not claim a production-code fix.

## Reproduction and evidence

```bash
SHIP_QA_PG_BIN='C:/Users/tuotu/AppData/Local/hermes/cache/ship-pg-runtime-17.11-3/runtime/pgsql/bin' \
SHIP_QA_PG_MODULE='C:/Users/tuotu/AppData/Local/hermes/cache/ship-pg-runtime-17.11-3/client/node_modules/pg/lib/index.js' \
QA_EVIDENCE_ROOT='C:/Users/tuotu/AppData/Local/hermes/cache/record-mixed-workflows-e620818' \
node scripts/verify-record-mixed-workflows-browser.mjs
```

Evidence root: `C:/Users/tuotu/AppData/Local/hermes/cache/record-mixed-workflows-e620818/`.
Final receipt: `parent-final/mixed-9HMG0d/receipt.json`. Initial partial receipt: `mixed-zYZe1t/receipt.json`; all three worker `attempt-N.command.json`, stdout logs and byte-exact runner copies remain. `partial-summary.json`, `oracle-diagnostic.json`, per-revision oracle snapshots, `M1-readback.json`, diagnostic `failure-readback.json`, pending/ACK/failure screenshots and owned-PG logs remain. Receipt input hashes use SHA256 of `JSON.stringify(exact UTF-8 text)`, preserving CRLF.

Representative initial M2 screenshots show the pending original case modal and selected closure checkbox, then the ACK state. The pending image alone does not prove offscreen values; same-node/exact drafts are separately asserted. The final runner additionally reloads both original documents and verifies the updated ordinary task, the closed-case list and no new business writes. This is a post-ACK reload check, not unsaved-draft refresh persistence.

Final-run cleanup confirms owned HTTP/Chrome/PG stopped, ports closed, profile and owned PG data removed. Only the new runner and this documentation are repository additions. Type/build and unrelated suites are intentionally not rerun: product/SQL/package/shared QA are frozen. Exact staged-tree/review/commit status belongs to the final delivery receipt rather than the earlier partial handback. No push/merge/deploy/production action performed.
