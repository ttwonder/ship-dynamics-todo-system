# Task-member native protocol — local development slice

This is the native SQL foundation for existing meeting-derived per-vessel task
progress, not completed original-App integration. It follows the existing
`usesPerVesselProgress` domain: sourceMeetingId, distributeToVessels and multiple
distinct task-scope vessels. It does not generalize ordinary multi-vessel tasks.

## Contract

- Exact `(workspace, task, vessel)` member context with opaque server-provided
  section key, structural/member/source tokens and exact actor authority.
- Different members hold independent editing leases and use member CAS. Same
  member stale writes, structural/source ABA and valid wrong-target guards fail.
- Shared task/lifecycle operations retain parent protection. Source meeting,
  notification/audit order, retention, original completion metadata and atomic
  rollback/replay remain unchanged. Independent member edits do not change the
  business rules for closing/reopening a task or its linked meeting.
- Heartbeat and release include lease_version. Unfenced legacy cleanup rejects
  reserved member keys. A delayed old request cannot delete a new same-owner lease.
- Task-family claim/renew/release use one ordered gate. Opposite-family claims
  cannot cross a renewal at real expiry. Transaction follow-up inversions use
  40001 rather than waiting into 40P01; clients retry the entire transaction.
- The short workspace publication section remains serialized. No claim of zero
  shared waits, higher hosted throughput or automatically faster UI is made.
- Comparison trimming matches ECMAScript whitespace; raw text/history is not
  normalized. Notifications preserve original supervisor-first then owner order,
  stable dedupe and cap.

The development install and reverse scripts require a quiescent boundary.
Browser-role grants remain private. This is not a production migration handoff,
Supabase ACL acceptance, or concurrent old-client rollout approval.

## Evidence

Native runner: `node scripts/verify-task-member-native.mjs green-parent-final`.
Required per-command environment:
`SHIP_QA_PG_BIN`, `SHIP_QA_PG_MODULE`, `QA_EVIDENCE_ROOT`, `QA_VITE_CACHE_DIR`.
The Vite cache must be an isolated absolute path. The runner uses private native
PostgreSQL connections and original source helpers for expected business effects.

Original native baseline had 30 stable cases. The corrected native suite has 36;
the extra cases cover the three independently reported A1/C1/C2 findings and
necessary lock-order composition controls. Counts are native scenarios, not UI
or hosted E2Es. Original failing receipts and corrected receipts are retained.

Parent ran the corrected three files over base
`b2df978d7d1b0b7e65f88c6a84808e5aa1dfbb53`:

- `parent-member-fixed-b2df978/green-parent-final-fYP6fO/receipt.json`: PASS,
  36 unique cases; shutdown, port closure and owned data removal confirmed.
- The earlier `green-parent-raorHu` attempt preserved a true A1 PASS but stopped
  because the parent omitted QA_VITE_CACHE_DIR. It is not product-failure evidence
  and was not replaced or counted as a full PASS.
- `parent-case-b2df978/ui-PmRJBQ/receipt.json`: existing native-HTTP original-App
  read/write flow PASS (12 UI scenarios and 1 protocol scenario). This fixture
  does not yet mount the new member migration and is not member UI proof.

All paths above are under the repo-external evidence root
`C:/Users/tuotu/AppData/Local/hermes/cache/record-read-lock-6e300abf`.
The fixed native review findings/RED/GREEN, raw file hashes and merge provenance
are in `member-fix-delivery.json`, `parent-member-fixed-merge.json` and
`parent-current-acceptance.json`. Original independent review was changes-required;
finding-scoped closure is separate and must not be inferred from passing tests.

## Still required

Original App member reader/command adapter, exact scope selector handoff,
versioned heartbeat/release, durable operation envelope recovery, successful ACK
publication without clobbering sibling drafts, parent/child conflict UX through
existing controls, two original browser identities and native HTTP concurrency.
Then verify the affected local UI/data/draft/history/rollback boundaries. The
remaining precise report/create/overview readers and R3 cache/pending migration
are separate open work. No push, deployment or production write was performed.
