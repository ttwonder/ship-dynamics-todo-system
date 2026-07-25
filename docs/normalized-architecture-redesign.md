# Ship Dynamics server-authoritative redesign packet

Status: architecture contract before production implementation
Immutable product base: `d7c65a6954dc196aad09eb9ca2ea98f11f02085d`
Rejected experiments are reference-only and must not be merged.

## 1. Authority boundary

1. Supabase Auth `auth.uid()` is the only actor identity accepted by database commands.
2. Browser role, `updatedBy`, display name, permission booleans and submitted audit fields are untrusted input.
3. RLS is the read/confidentiality boundary. UI filtering is a second fail-closed defence only.
4. Normal clients have `SELECT` only through RLS and `EXECUTE` on explicit commands. Direct table `INSERT/UPDATE/DELETE` is revoked.
5. Every mutating command validates membership, fixed role invariants, configurable permission, resource scope, lease/fencing token, base version and relationship invariants inside one PostgreSQL transaction.
6. Realtime is invalidation only. A notification causes an authorized refetch; event row data is never adopted as authority.
7. Local storage contains drafts and operation references, never shared-state authority.
8. A server operation ledger is the durable truth for lost-response classification and idempotent replay.
9. Security-definer functions use `SET search_path = pg_catalog, public`, reject null `auth.uid()`, are revoked from `public/anon`, and are granted only to the required authenticated role.
10. Production migration runs in one maintenance-window transaction after a backup and dry-run validation. No legacy/new dual writes.

## 2. Domain dimensions and aggregate boundaries

Do not split every scalar into a row. Split independent ownership, lifecycle, visibility and concurrency dimensions.

| Aggregate/entity | Stable identity | Independently editable | Version owner | Sensitive visibility |
|---|---|---:|---|---|
| workspace | UUID + legacy workspace key | settings sections only | settings-section version | membership only; public site gate is not data authorization |
| member/profile | Supabase Auth UUID | yes | membership version | workspace roster; credential data never readable |
| vessel | existing text vessel ID | yes | vessel version | member vessel scope |
| task | existing text task ID | yes | task version | ordinary/meeting/internal classification + complete resource scope |
| task member progress | task ID + vessel ID | yes when explicitly keyed | progress version | exact vessel scope |
| meeting | existing text meeting ID | yes | meeting version | non-internal visible scope; internal hidden from vessel accounts |
| meeting item | existing text item ID | via meeting command | meeting version | inherits meeting |
| internal-control case | existing text case ID | yes | case version | Owner/Admin/authorized human roles only; never vessel accounts |
| agenda report | existing text report ID | immutable snapshot metadata | report version | intersect authorized vessels |
| notification | existing text notification ID | read-state only | notification version | recipient only |
| audit/status event | existing text event ID | append-only | immutable | role/resource policy |
| settings section | section key | yes | section version | section policy |
| edit lease | workspace + lease key | lease RPC only | monotonically increasing fencing token | reveal only authorized labels; vessel accounts never learn hidden entity existence |
| operation | workspace + operation UUID | immutable request/final status | state machine | actor and Owner audit access |

### Canonical relationship ownership

- Vessel management/delegation/account scope is one relation table; do not duplicate `User.managedVesselIds` and `Vessel.assignedUserIds` as separate authorities.
- Task resource scope and member progress live in one `task_vessels` relation row per task/vessel. Aggregate task fields remain on `tasks`.
- Meeting vessel scope is canonical in `meeting_vessels`; type/all are mode metadata plus a resolved vessel set captured by the command.
- A meeting item owns at most one generated task. The canonical link is a unique FK from `tasks.source_meeting_item_id`; do not maintain a second mutable task ID on the item.
- Internal case↔task projection is canonical in `internal_case_task_links(case_id PK, task_id UNIQUE)`. Do not store two independently writable reciprocal IDs.
- Departments, owners, participants, trackers, responsible users and categories are set-valued relation tables with uniqueness constraints.
- Status/history/audit rows are append-only event tables. Canonical current status/closure remains on the aggregate and must agree with the newest server-stamped event.

## 3. Proposed tables

All durable rows include `workspace_id`, stable IDs, server timestamps and relevant foreign keys. Editable aggregate rows include `version bigint NOT NULL DEFAULT 1`, `updated_at`, `updated_by`.

### Identity and policy

- `sd_workspaces(id uuid, legacy_key text unique, name, is_active, created_at)`
- `sd_profiles(id uuid PK references auth.users, display_name, username_label, created_at)`
- `sd_memberships(workspace_id, user_id, department, role, is_active, version, ...)`
- partial unique index: one active Owner per workspace
- `sd_role_permissions(workspace_id, role, permission_key, enabled, version, ...)`
- `sd_vessel_assignments(workspace_id, vessel_id, user_id, assignment_kind manager|delegate|vessel_account, is_active, ...)`

### Business aggregates

- `sd_vessels(... identity fields, position jsonb, cargo jsonb, note jsonb, weekly_attention text[], manual_attention_level, is_active, version, ...)`
- `sd_tasks(... priority, attention_dimension, abnormal/internal flags, category-independent fields, status, closure, source_kind, source_meeting_item_id, version, ...)`
- `sd_task_vessels(task_id, vessel_id, is_active_scope, status, is_closed, closed_date, closed_by, version, ...)`
- `sd_task_categories`, `sd_task_departments`, `sd_task_owners`
- `sd_meetings(... scope_mode, subject, dates, reason, resolution, priority, status, include_in_morning, internal flag, version, ...)`
- `sd_meeting_vessels`, `sd_meeting_type_scopes`, `sd_meeting_departments`
- `sd_meeting_participants(kind participant|tracking|responsible)`
- `sd_meeting_items(meeting_id, item_id, description, distribute_to_vessels, ordinal, ...)`
- `sd_meeting_item_categories`
- `sd_internal_cases(... vessel_id, report fields, status, closure, origin, version, ...)`
- `sd_internal_case_departments`
- `sd_internal_case_task_links(case_id PK, task_id UNIQUE)`
- `sd_agenda_reports`, `sd_agenda_report_vessels`

### Evidence, collaboration and settings

- `sd_task_status_events`, `sd_task_vessel_status_events`, `sd_meeting_status_events`, `sd_internal_case_status_events`
- `sd_notifications(... recipient_id, vessel_id nullable, task_id nullable, meeting_id nullable, read_at, version)`
- `sd_audit_events(... actor_id, command, entity_type, entity_id, detail jsonb, created_at)` append-only
- `sd_settings(workspace_id, section_key, value jsonb, version, updated_by, updated_at)`
- `sd_public_site_gate(workspace_id, password_hash, version, ...)`; anon may read only the hash/version needed by the cosmetic gate. It grants no database access.
- `sd_edit_leases(workspace_id, lease_key, entity_type, entity_id, owner_id nullable, owner_session uuid nullable, fencing_token bigint, expires_at, updated_at)`; rows persist after release so fencing tokens never reset.
- `sd_operations(workspace_id, operation_id uuid, actor_id, command, target_key, request_payload jsonb, request_hash bytea, status prepared|committed|rejected, base_versions jsonb, result jsonb, error_code, created_at, completed_at)`

## 4. Security and visibility invariants

### Fixed role invariants

- Owner has all permissions and is the only role that can change role-permission policy, site/system settings, Owner identity or transfer ownership.
- Admin may manage only non-Owner users; cannot create, modify, delete or transfer an Owner.
- Operator cannot enter management or manage users/vessels/permissions/settings.
- Vessel account can create ordinary work for its exact vessel only and cannot delete, close, manage meetings or enter management.
- Configurable permission rows may narrow/enable product permissions only within these fixed ceilings/floors.

### Vessel scope

For a human member, accessible vessel IDs are the distinct union of active direct management, active delegation and an explicitly authorized manual target. `viewAllVessels` may broaden read scope but never silently broaden mutation scope.

For a vessel account, exactly one active `vessel_account` assignment is required. Zero, duplicate or cross-workspace assignments fail closed.

### Confidentiality

A vessel account may see only:

- its own vessel;
- ordinary single-vessel tasks for that vessel;
- valid non-internal meeting-generated member work explicitly distributed to that vessel;
- its own keyed member progress and authorized notification text.

It must not learn content or existence signals for internal control, cross-vessel aggregate meetings/tasks, orphan/ambiguous relationships, hidden labels, lock holders, drafts, counts, badges, reports or notifications. RLS/view functions must return zero rows before UI projection.

### Scope-changing mutation

Authorization covers `old_scope ∪ new_scope`. Shrinking submitted scope cannot be used to mutate a formerly broader entity.

### Histories

Existing status/audit events are immutable and cannot be supplied by the client. The server stamps event ID, actor and timestamp. A status transition and its event are one transaction.

## 5. Lease and concurrency model

### Lease keys

- vessel content: `vessel:{vesselId}`
- existing task aggregate: `task:{taskId}`
- exact task member progress: `task-progress:{taskId}:{vesselId}`
- task creation semantic scope: `task-create:{vesselId}`
- meeting aggregate/items/scope: `meeting:{meetingId}`
- internal case: `internal-case:{caseId}`
- user membership: `user:{userId}`
- settings: `settings:{sectionKey}`
- batch vessel editing: the sorted exact set of individual `vessel:{id}` leases, acquired all-or-nothing in deterministic order

A vessel aggregate, different tasks on that vessel, a meeting and an internal case remain independent unless a command has a declared cross-entity invariant.

### Claim

1. Verify actor may know and edit the target.
2. Lock the lease row.
3. If active lease belongs to another owner session, return blocked with only authorized display metadata.
4. Otherwise increment fencing token, set owner/session and `expires_at = clock_timestamp() + TTL`.
5. Return `{leaseKey, ownerSession, fencingToken, expiresAt}`.

### Renew/release

Renew and release compare exact actor, opaque owner session and fencing token. Release clears owner/session/expiry but does not delete the row or reduce token.

### Command validation

A command requiring a lease must verify exact key, actor, owner session, token and live expiry using `clock_timestamp()`. It then checks row version(s), locks affected rows in deterministic order and applies one transaction. Lease does not replace version/CAS.

## 6. Operation state machine

| State | Durable meaning | Allowed transition |
|---|---|---|
| absent | no server fact | command inserts prepared record after authorization and semantic identity validation |
| prepared | command owns idempotency key inside current DB transaction | committed or rejected in same transaction/exception policy |
| committed | immutable request identity and authoritative result | replay only |
| rejected | definitive business/auth/version rejection | replay same rejection only |

A client retry with the same operation ID must match actor, command, target, request and base/lease provenance byte-for-byte (canonical JSON/hash). Different reuse fails closed. A replay returns the original command result/status, never an unrelated latest whole-workspace snapshot.

The operation row and business mutation commit atomically. The browser never records a pre-dispatch marker as shared authority. Pending local references are recoverable by querying `get_operation_status(operationId)`.

## 7. Command transition matrix

| Command | Aggregate/rows | Lease | Base version(s) | Atomic invariants/result |
|---|---|---|---|---|
| `claim_entity_lease` | lease | n/a | n/a | authorization before existence/holder disclosure; increment token |
| `renew_entity_lease` / `release_entity_lease` | lease | exact provenance | n/a | compare owner/session/token |
| `update_vessel_content` | vessel | `vessel:id` | vessel | canonical position/cargo/note; one audit event |
| `create_task` | task + scope/sets/events | `task-create:vessel` for ordinary create | referenced vessel versions where needed | no duplicate operation/entity; canonical provenance; event+notifications |
| `update_task` | task + set relations | `task:id` | task + changed relationship versions | authorize old∪new scope; meeting/internal provenance cannot be forged |
| `update_task_progress` | one task_vessel row + event | `task-progress:task:vessel` | task + progress | cannot mutate aggregate or siblings; aggregate roll-up server-derived |
| `close/reopen_task` | task or exact progress + events | matching task/progress | entity | permission conjunction and closure semantics |
| `delete_task` | task + canonical links/events/notices | `task:id` | task + parent/link versions | meeting/internal link transition atomic; no orphan/resurrection |
| `batch_task_command` | exact tasks/progress/events | exact sorted leases | version map | prevalidate all, all-or-nothing, per-entity audit |
| `create/update/delete_meeting` | meeting/items/scopes + generated tasks/progress | `meeting:id` after client-generated stable ID | meeting + affected task versions | one item→at most one task; scope/mode/internal consistency; removed children closed/unlinked per policy |
| `create/update/cancel/delete_internal_case` | case + optional task link/task/events | `internal-case:id` | case + linked task | canonical one-to-one link; internal transition and notifications atomic |
| `batch_update_vessels` | exact vessels | all exact vessel leases | vessel version map | target = activeVisible ∩ (managed ∪ delegated ∪ manuallySelected); empty rejects; all-or-nothing |
| `mark_notifications_read` | recipient notifications | none | notification versions | recipient only |
| `update_settings_section` | one settings row | `settings:section` | section | Owner/fixed permission rules |
| `update_role_permissions` | role permission set | `settings:role-permissions` | section | Owner only; fixed invariants re-applied |
| `update_membership` / `transfer_owner` | memberships/assignments | `user:id` plus workspace ownership lock | membership versions | owner uniqueness; Admin cannot affect Owner |

Account creation, disable/delete and password reset that require Supabase Auth Admin run through an authenticated Edge Function. The function verifies Owner/Admin policy server-side, uses the service-role key only in Supabase runtime, records an idempotent orchestration operation, performs compensating cleanup on partial failure and writes a DB audit event. Owner-affecting actions are Owner-only.

## 8. Client entry-point contract

Every mutable UI entry point maps to exactly one command or explicit command sequence. Components may edit local drafts but may not directly mutate authoritative `AppData`.

- Vessel quick/edit/detail/batch forms → vessel commands.
- New/ordinary/meeting/internal task forms, work-center single/batch actions and vessel progress forms → task commands.
- Meeting form item/scope/status/delete actions → one meeting aggregate command.
- Internal-control single/batch/projection/cancel/delete → internal-case commands.
- Management person/vessel/assignment/category/settings/password/role controls → membership/settings/Edge Function commands.
- Import is a privileged explicit migration, never an ordinary save.
- Export/report generation reads an RLS-authorized projection and cannot widen visibility.

The compatibility adapter may assemble authorized normalized rows into the existing `AppData` shape for views while migration proceeds, but there is no `saveAppData` API and no whole-workspace write/rebase path. Mutation code calls typed command methods directly; it must not infer commands from localized action labels or a generic before/after JSON diff.

## 9. Client state and Realtime

Local durable envelope is keyed by stable workspace + authenticated actor + entity key and contains only:

- draft fields;
- base entity version(s);
- pending operation ID after actual dispatch;
- command/target identity needed to query status.

Offline creates/edits are drafts only. Reconnection requires authentication, authorized refetch, a fresh lease and base-version validation. Same-version divergent content is a conflict; no unconditional merge.

Realtime payload is treated as `{table, workspace, entity identity, event hint}` only. After validating current workspace/auth generation, refetch the authoritative entity/projection. An invalidation cannot clear or overwrite a draft/pending operation.

Command success replaces or refetches only affected entities. Sign-out, role change, workspace change, and vessel-account change close writable editors and clear authority caches; unsent drafts remain quarantined under the original actor/workspace identity. No generic `saveCloudData(AppData)` or action-label compatibility writer may remain in the cutover build.

## 10. Migration and cutover invariants

1. Preserve the legacy JSON row and revision history as read-only backup.
2. Import IDs and content without generating replacement identity unless malformed/duplicate data is quarantined.
3. Validate owner uniqueness, user/vessel assignment equivalence, task scope, meeting item links, internal case links, event order/immutability and record counts.
4. Explicit empty values remain empty; only absent legacy fields receive documented defaults.
5. Migration produces a machine-readable reconciliation report and aborts on ambiguity.
6. Cutover uses a short write freeze: backup → final import transaction → validation → deploy normalized client → smoke → reopen.
7. Rollback restores the legacy client and untouched legacy row; no normalized writes are copied back automatically.
8. `public/supabase-config.js` remains unchanged until an explicitly verified staging/production deployment step.

## 11. Required executable evidence

### Local PostgreSQL/PGlite

- schema parses and migrates atomically from empty and representative legacy fixtures;
- RLS role/resource/confidentiality matrix with `SET ROLE authenticated` and mocked `auth.uid()`;
- anon and authenticated direct DML denied;
- lease claim/renew/release, expiry takeover and monotonic fencing;
- stale lease and stale version command rejection;
- disjoint entity commits both succeed;
- operation replay, mismatched reuse and lost-response query;
- meeting/internal cross-row rollback on any invalid precondition;
- append-only events and audit provenance;
- migration counts, links and explicit-empty rules.

### Real staging Supabase (mandatory before delivery)

- real Auth JWT→`auth.uid()`;
- PostgREST grants/RLS and security-definer RPC behavior;
- two independent browser sessions and concurrent requests;
- Auth Admin Edge Function provisioning/reset/disable;
- Realtime invalidation followed by authorized refetch;
- migration dry run and rollback rehearsal.

Local SQL tests do not substitute for this staging gate.

## 12. Definition of done

- Every production mutation entry point appears in the command matrix and no whole-snapshot write remains.
- Database authorization and visibility tests pass for Owner/Admin/Operator/Vessel and identity/role transitions.
- All legacy project regression scripts, typecheck, production build, audit, secret scan and diff checks pass.
- Production-like browser QA covers role switching, simultaneous editing, lost response, lease expiry, relationship commands, offline drafts and confidentiality existence signals.
- Two fresh independent reviews pass the same immutable final tree.
- One local commit is created on `architecture/normalized-v1`; worktree clean; no push.
