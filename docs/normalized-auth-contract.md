# Normalized authentication and client contract

Status: production normalized client/Edge boundary with legacy sign-in compatibility.

## Authority and identity

Supabase Auth `auth.uid()` is the only actor identity. The browser may remember a Supabase session and the current UI selection, but a roster ID, display name, role, `currentUserId`, and localStorage value are never authority. Every database policy and command must derive the actor from the verified JWT.

The existing department → person UX remains. A gated directory response contains department, display name, user-facing `usernameLabel`, an opaque synthetic Auth alias, and one non-secret login mode. It never returns the Supabase Auth UUID, legacy hash, or other credential metadata. Owner and native-password accounts pass their alias and password directly to `supabase.auth.signInWithPassword`. Existing non-owner accounts explicitly classified as `legacy-password` or `passwordless` use the signed-gate `legacy-session` action: the Edge function rate-limits the network and exact identity, verifies the server-only legacy SHA-256 hash (or an exactly blank passwordless input), denies Owner and passwordless Admin access, derives a deterministic server-only bridge credential, and returns only the resulting Supabase access/refresh pair. The browser installs that real Supabase session; `auth.uid()` and RLS remain the sole authority.

Synthetic Auth aliases belong to `auth.users` and the service-only `sd_login_options` directory table. New accounts receive an immutable operation-correlated alias under `AUTH_SYNTHETIC_EMAIL_DOMAIN`; an HMAC of workspace and operation identity makes retries recover the same Auth user without exposing a human identifier. Public profile/roster rows store human labels but never the alias.

## Site gate

The site password is sent only to `site-unlock`. That Edge Function calls the server verifier RPC `verify_ship_dynamics_site_password`; neither the hash nor plaintext is returned to or persisted by the browser. A successful check returns a short-lived HMAC-signed gate token (60–600 seconds, five minutes by default). The token:

- is scoped to the stable workspace key;
- has a server expiry and nonce;
- is cached in sessionStorage, not localStorage;
- allows access to the login directory only;
- never authorizes normalized data reads or commands.

The signing secret is `SITE_GATE_JWT_SECRET` in Edge runtime environment variables. The service credential is also Edge-only. Browser source and public configuration contain only the anon/publishable credential.

## Sessions, requests, and stale results

`NormalizedRequestScope` owns a generation number for the active Supabase session actor and workspace UUID. Each repository method captures `{workspaceId, actorId, generation}`, pins `workspace_id` in its query or RPC, and validates the capture after the await. A sign-in, sign-out, token/session event, or workspace change advances the generation. A result from an older generation raises `StaleNormalizedResponseError` and must not enter UI state.

localStorage may contain the Supabase library's session cache, the current display selection, and normalized local draft envelopes. Those values do not grant access. On reload, the server revalidates the session and RLS revalidates every read.

## Password and account management

Existing non-owner accounts preserve the pre-cutover contract: a valid legacy hash remains usable through `legacy-password`, while an originally blank Operator/Vessel credential remains `passwordless`. Owner is always native Supabase password mode. A passwordless account promoted to Admin fails closed into native mode and must receive a manager reset before login.

An authenticated user changes only their own password through `supabase.auth.updateUser({ password })`. After Auth accepts the new credential, `complete_my_ship_dynamics_password_activation` atomically switches the login option to native `supabase`, clears the legacy hash, clears activation-required state, and records an audit event. Passwords are never written to profile or membership rows. A manager reset likewise switches to native mode and erases the former legacy hash.

`manage-user` handles actions needing Auth Admin:

- create or recover the same operation-correlated password-backed non-owner Auth user, then idempotently provision membership;
- disable a non-owner fail-closed: membership is revoked before the Auth ban and is not reactivated automatically if the ban needs recovery;
- reset credentials idempotently with the same operation/fingerprint;
- change a non-owner role;
- transfer the unique active Owner through one transactional RPC.

The function validates JSON shape/length, UUIDs, action, role, allowed Origin, bearer JWT, active workspace membership, and `role === "owner"` before any action. Admin, Operator, Vessel, inactive, and outsider sessions are denied. Because the endpoint itself is Owner-only, an Admin cannot inspect or mutate an Owner. The current Owner cannot be disabled or demoted; ownership must move through `transfer_ship_dynamics_owner`.

Each request supplies an operation UUID. Server orchestration RPCs begin, record external effects, finalize, or mark recovery-required for an idempotent operation and write the server audit record. A committed replay returns its original result. Once any DB/Auth mutation may have happened, an error can never be recorded as definitive rejection; retry or a reconciler continues the same operation. The deterministic synthetic email closes the create-user crash window between Auth creation and DB effect recording.
Credential-bearing requests persist only an HMAC request fingerprint, never the submitted password, so operation reuse can be matched without creating an offline password oracle.

## Repository contract

`NormalizedRepository` provides typed, RLS-authorized projections for workspace, roster, vessels, tasks, and task progress. It has no `saveAppData`, whole-workspace upsert, direct table mutation, merge, or rebase API.

Mutations use only explicit `command_ship_dynamics_*` RPCs. Lease helpers call claim, renew, and release with the exact workspace, opaque owner session, and fencing token. A command adds the workspace and operation UUID itself; callers cannot use a browser-supplied actor.

After dispatch starts, a durable envelope may retain:

- draft fields;
- base entity versions;
- operation UUID, command, and target key.

The envelope key includes workspace UUID, authenticated actor UUID, and entity key. A transport failure leaves the pending operation reference intact. Recovery queries the RLS-protected `sd_operations` projection by exact workspace and operation UUID. Only a definitive `committed` or `rejected` status clears the pending reference. Clearing a pending operation does not delete a draft.

## Realtime

Realtime is invalidation only. Subscriptions are filtered by the captured workspace and generation. Payload content is never applied to an entity. The client extracts only stable identity fields and returns entity keys such as `task:{id}` or `task-progress:{taskId}:{vesselId}`. The consumer passes those keys to `refetchInvalidatedEntities`, which performs fresh, workspace-pinned, RLS-authorized keyed fetches. Invalidation never clears a draft or pending operation.

## Edge deployment requirements

The functions intentionally depend on server-authoritative RPCs that must land with the normalized server migration before UI wiring: `verify_ship_dynamics_site_password`; `consume_ship_dynamics_rate_limit`; `begin`, `mark effect`, `complete`, `reject`, and `mark recovery required` user-operation RPCs; `provision_ship_dynamics_user`; `disable_ship_dynamics_user`; `change_ship_dynamics_user_role`; and `transfer_ship_dynamics_owner`. Those RPCs own password verification, throttling, idempotency matching, recoverable external-effect state, membership invariants, unique Owner transfer, fail-closed disable state, and audit insertion. The Edge code must not fall back to direct browser-readable hashes or client-authored audit rows.

`supabase/config.toml` disables gateway JWT verification for these functions because `site-unlock` and `login-directory` are pre-authentication endpoints and `manage-user` independently validates the bearer token through Auth before checking live Owner/Admin membership. Exact-Origin checks remain mandatory; both login-directory actions also require the signed site-gate token.

Set these Edge runtime secrets:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ALLOWED_ORIGINS` as an exact comma-separated allowlist
- `SITE_GATE_JWT_SECRET`
- `SITE_GATE_TOKEN_TTL_SECONDS` (optional)
- `AUTH_SYNTHETIC_EMAIL_DOMAIN`
- `USER_OPERATION_HMAC_SECRET`
- `RATE_LIMIT_HMAC_SECRET`

`site-unlock`, the gated directory, compatibility login, and account management consume server-side rate-limit buckets before sensitive verification or mutation. Compatibility login has independent network and identity buckets. Bucket keys are HMAC fingerprints; raw network/account identifiers are not stored in the rate table. Native personal-password login still goes directly through Supabase Auth and retains its native rate-limit/CAPTCHA path.

No function uses wildcard CORS. Errors are generic, responses are `no-store`, and no password, token, synthetic email, or server credential may be logged. Production rollout still requires the architecture packet's staging tests for JWT → `auth.uid()`, RLS, Auth Admin, two-session concurrency, Realtime refetch, and migration rollback.
