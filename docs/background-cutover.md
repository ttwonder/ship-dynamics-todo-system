# Browser-disconnection-tolerant initial record cutover

This is an operator-only alternative after the original step 08 reached its explicit 45-second statement timeout. It does not change installed business RPCs, hash algorithms, existing data, role policy, credentials, or frontend UI.

## Operator workflow

1. In Supabase project `cyzpcvvhmoiihsqvjspp`, database `postgres`, use the existing privileged SQL Editor role. Existing `pg_cron` and the frozen `ship-dynamics-main` source are prerequisites; the script fails before scheduling when they are absent. No extension is installed automatically.
2. Manually run the complete `08c_start_background_cutover.sql` once. It creates a private operator-only job ledger and schedules phase 08. Each successful phase atomically schedules its successor: **08 pause → 09 first record stage → 10 publish records while paused**. Do not separately run the old 08/09/10 scripts during this chain.
3. `background_cutover_queue` is only a scheduling acknowledgement, **not completion**. Once that transaction commits, losing the browser connection does not itself terminate the separately launched database worker. If the start acknowledgement is lost, use the readback; do not launch again.
4. Separately run `08d_background_cutover_readback.sql`. All three states must be `succeeded`; the final result must be `published-paused` / `records-v1`. Existing step 12 remains available for an independent control readback when needed. `failed`, `interrupted`, waiting without a predecessor job, or missing status is not permission to retry or resume automatically.
5. Frontend trial, user-controlled Push/deployment and existing step 11 resume remain separate. This package does **not** open business writes.

## Execution and failure boundaries

- Job names and release ID are fixed for this first cutover. A duplicate start cannot replace a job or start another business attempt.
- A short transaction persists the running claim and exact backend PID/start time before the business transaction. A live claim is not interrupted by another invocation; a disappeared worker becomes `interrupted`, never a retried business attempt.
- No extra advisory lock is held: installed source-authority operators require a fresh transaction with no prior advisory locks.
- Each job has its own `READ COMMITTED` business transaction, `statement_timeout = 8min`, and unchanged `lock_timeout = 5s`. No role/database/global timeout is changed. Schedule ticks are once per minute, so transitions need not start immediately.
- Existing operator bodies, service-role entry/exit, complete data hashes and stage/publication preconditions are retained. Successful business changes, result ledger and scheduling of the next phase commit together.
- Ordinary SQL failure or statement timeout rolls back that phase, records only its SQLSTATE, and does not schedule the next phase. A crash between the claim and result leaves a durable unknown/interrupted attempt rather than silently retrying.
- The job is unscheduled **only after its result transaction commits**. A cron log may report cancellation of final cleanup after that commit; the private ledger plus current control readback, not the cron status label alone, determine completion.
- Metadata and SQL commands are restricted to the operator; `anon`, `authenticated`, `service_role` and PUBLIC receive no schema/table access. No browser-readable capability is added.

## Verification scope

The exact released SQL was exercised with native PostgreSQL 17.11, the actual installed release RPCs, a synthetic nonempty legacy workspace at revision 8818, linked task data and formal Itinerary/history fixtures. Thirteen cases passed: duplicate launch, live-claim exclusion, a real statement timeout, post-claim disconnection, successor-scheduling failure rollback, all three actual worker bodies, repeated worker invocation, exact payload/history preservation, final paused authority, private ACLs and readback. The test found and removed an incompatible extra advisory lock; installed business guards were not weakened.

The Windows runtime does not supply pg_cron. Only the scheduler/catalog boundary was controlled; business SQL, transaction commits/rollback, timeout, connections and data readback were real native PostgreSQL. This is **not hosted pg_cron acceptance or production success**. Formal scheduling and results require the operator's actual run and separate readback.
