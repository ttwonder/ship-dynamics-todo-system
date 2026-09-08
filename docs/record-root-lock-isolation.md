# Records root-lock isolation (local development)

This is the database-lock slice after `694ddfa917ba7828bdda1ea4cdf3194b0adffc66`.
It does not claim that all on-demand readers or task-member leases are complete.
No production SQL, cloud mutation, Push or deployment was performed.

## Lock protocol

- The record RPC takes a shared maintenance gate, a workspace shared writer gate,
  its existing operation fence, then deterministic exact non-audit entity keys.
- Existing records are locked and hydrated **before** the workspace publication
  lock. Missing IDs have the same key fence; unrelated IDs can prepare/finish
  while another writer waits for its own entity.
- The workspace publication lock remains `FOR NO KEY UPDATE`. Foreign-key
  key-share checks remain compatible; revision/order/audit/history/delta/receipt
  publication stays serialized and atomic.
- Actor authority, expected entity/order contents and exact live lease ownership
  are still checked at the original authoritative boundary. Prepared values are
  not an authorization grant. Audit bodies are read in the publication section;
  existing conservative audit merging, retention and ABA checks remain intact.
- Import, pruning and the scheduler take an exclusive workspace writer gate
  before the root. Migration/backfill takes the exclusive maintenance gate first.
  Internal materializers reject calls outside the protocol.
- A contended shared-to-exclusive upgrade, workspace switch, or new exact-entity
  expansion after a publication inside one externally composed transaction fails
  with `40001` rather than taking locks in reverse order. Normal App RPCs remain
  independent transactions. No retry limit or business rule was increased.

## Decisive RED and GREEN

The original script on `6e300abf` proved that A waiting for a locked vessel also
blocked B's unrelated vessel through the root. The new native L1 barrier proves
B commits while A is still waiting, then A commits without losing B's content.
Both an empty audit list and the existing 500-row retention case pass. These are
variants of L1, not two unrelated end-to-end cases. This proves isolation of the
preparation wait; it is not a hosted throughput or universal latency claim.

Parent receipt root:
`C:/Users/tuotu/AppData/Local/hermes/cache/record-read-lock-6e300abf/parent-root-integrated-694ddfa/`

| Parent-run gate | Result / receipt directory |
| --- | --- |
| L1 empty / 500 | PASS; `root-isolation-8Kv8J5`, `root-isolation-zs5VWe` |
| Writer gate negatives/positive controls | 14 native cases PASS; `writer-gates-SYhbMQ` |
| Existing native concurrency | 6 cases PASS; current source-statement metadata in `native-sYkN6G` |
| Existing audit merge/ABA | 23 native cases PASS; `audit-native-AQ8U0O` |
| Original App scoped first slice | 5 runner cases PASS (one is a protocol case); `ui-nYXBDO` |
| Original App ordinary task / linked internal-control create and close | M1/M2 PASS; `mixed-DESjtJ` |
| Record store SQL + adapter | 16 SQL + 7 adapter cases PASS |
| Record delta SQL + adapter | 7 SQL + 9 adapter cases PASS |
| Typecheck, production build, diff check | exit 0; existing large-chunk warning unchanged in kind |

Do not add the rows into an E2E total. Original native N2/N3 use a manual pure
rebase harness, whereas mixed M1/M2 exercise the original App's actual retry.
Full requested graphs, immutable receipts, interval history, delta reconstruction,
and unrelated physical records are asserted by the respective runners.

## R1: explicit cross-workspace transaction closure

The parent reproduced R1 on the unchanged candidate: A published an empty patch
in X, B published one in Y, then both switched workspaces without committing.
The original result was `40P01` / successful peer result, not the required
`40001`. Both transactions were rolled back and both complete readers and the
receipt set returned to baseline. That real RED remains untouched at:
`C:/Users/tuotu/AppData/Local/hermes/cache/record-read-lock-6e300abf/root-review/cross-red/cross-workspace-5LkgUk/receipt.json`.

The private gate helper now detects this backend's already-granted writer gates
for other workspaces in the same database. A subsequent shared or exclusive gate
uses try-lock. Normal patch follow-ups use nonblocking operation/entity/row locks
and root `FOR NO KEY UPDATE NOWAIT`; root `55P03` becomes `40001`. No global
exclusive writer marker was added. Uncontended switches still succeed, and the
new helper is denied to `public`, `anon` and `authenticated` like the other
private protocol helpers. Actor/CAS/lease/audit/replay/retry policy is unchanged.

Focused canonical GREEN evidence root:
`C:/Users/tuotu/AppData/Local/hermes/cache/record-read-lock-6e300abf/root-review/cross-green/`.
Each command below exited 0; full stdout and command/environment records are
preserved in that root's logs and `commands.json`.

| Focused gate | Result / receipt directory |
| --- | --- |
| `node scripts/verify-record-cross-workspace-native.mjs` | X1/X2/X3 PASS; `cross-workspace-8DYX9c` |
| `node scripts/verify-record-writer-gates-native.mjs` | 14 PASS; `writer-gates-MnaqRT` |
| `node scripts/verify-record-root-isolation-native.mjs` | L1 empty PASS; `root-isolation-ljrfuJ` |
| Same L1 command with `QA_ROOT_AUDIT_CAP=500` | L1 500 PASS; `root-isolation-Mtw9j7` |
| `node scripts/verify-record-concurrency-native.mjs` | N1–N6 PASS; `native-ji26eR` |
| `node scripts/verify-record-mixed-workflows-browser.mjs` | Original App M1/M2 PASS; `mixed-OxtSZd` |

X1 returned `40001` immediately for A, while B completed its second RPC; no
`40P01` or `57014` occurred. Both explicit transactions were then rolled back
and complete reader/receipt baselines checked. X2 committed both uncontended
cross-workspace RPCs with exactly two receipts. X3 exercises both normal/coarse
gate directions, retaining uncontended success and private-helper role denial.
N2's diagnostic source line now selects the ordinary blocking root statement,
not the new NOWAIT branch; its runtime oracle was not changed. All six runs
stopped their owned PostgreSQL clusters, closed their ports and removed owned
data. The mixed run also stopped HTTP/Chrome and removed its isolated profile.
The existing audit/store/delta/type/build evidence above is retained, not
presented as newly rerun evidence. Only this finding's affected gates were run.

## Evidence-preserving harness corrections

- `root-isolation-xXw5fu` passed the business assertions but failed with Windows
  EBUSY during teardown. It remains a FAIL receipt. The owned cluster was stopped,
  port/PID/marker verified, and its remaining private data removed separately.
  Native teardown now awaits asynchronous filesystem removal with bounded retries;
  the affected L1 variants and subsequent native/browser runs completed cleanup.
- `mixed-nJFxTh` reached both SQL ACKs in M2 and correctly returned the task editor
  to its original source-vessel editor. The old page-wide “no dialog” predicate
  misclassified that return. Only the harness terminal predicate changed: real
  command ACK, detached original draft, saved strip, and only the exact expected
  source editor. Pre-ACK same-node draft checks, complete graph/audit oracles,
  source-editor cancel with zero writes, and fresh-document checks remain.
- Outside-repo helper extraction accepts an explicit fixed input head and isolated
  Vite cache. The canonical parent runs use the real current repository head.
  Recorded root SQL source metadata is now read from the current source, not a
  hard-coded historical statement/line number.

## Remaining boundaries

The root publication phase is intentionally shared; this is not lock removal.
Whole-task progress lease/CAS has not been split by this change. Selective task,
case, meeting and report readers, old pending/draft upgrades, cloud ACL/PostgREST/
Realtime validation and human pre-Push trial remain separate work. SQL files here
are development artifacts, not an approved production cutover script.
