begin;

-- Compact ACK + durable operation receipt for aggregate AppData block patches.
-- The existing v1 RPC remains available for already-open/older clients.
create table if not exists public.ship_dynamics_block_operations (
  workspace_key text not null references public.ship_dynamics_app_state(workspace_key) on delete cascade,
  operation_id text not null,
  actor_user_id text not null,
  request_hash text not null,
  request_payload jsonb not null,
  result jsonb not null,
  revision integer not null,
  updated_at timestamptz not null,
  committed_at timestamptz not null default clock_timestamp(),
  primary key (workspace_key, operation_id),
  constraint ship_dynamics_block_patch_receipt_operation_id_valid
    check (char_length(btrim(operation_id)) between 1 and 200)
);

create index if not exists ship_dynamics_block_operations_committed_idx
  on public.ship_dynamics_block_operations(workspace_key, committed_at desc);

alter table public.ship_dynamics_block_operations enable row level security;
revoke all on table public.ship_dynamics_block_operations from public;

-- Give the existing block writer enough room for row-lock wait, JSONB rewrite,
-- trigger work, and response handling without widening every anon request.
alter function public.apply_ship_dynamics_block_patch(text,jsonb,text,text,jsonb,jsonb,jsonb)
  set statement_timeout = '8s';

create or replace function public.apply_ship_dynamics_block_patch_v2(
  p_workspace_key text,
  p_operation_id text,
  p_operations jsonb,
  p_saved_by text,
  p_actor_user_id text,
  p_actor_guard jsonb,
  p_authorization_guard jsonb,
  p_lock_guards jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
set statement_timeout = '8s'
as $$
declare
  existing_receipt public.ship_dynamics_block_operations%rowtype;
  canonical_request jsonb;
  write_result jsonb;
  compact_result jsonb;
begin
  if p_operation_id is null
     or char_length(btrim(p_operation_id)) < 1
     or char_length(p_operation_id) > 200
  then
    return jsonb_build_object('ok',false,'code','invalid-operation-id');
  end if;

  canonical_request := jsonb_build_object(
    'operations', p_operations,
    'savedBy', p_saved_by,
    'actorUserId', p_actor_user_id,
    'actorGuard', p_actor_guard,
    'authorizationGuard', p_authorization_guard,
    'lockGuards', p_lock_guards
  );

  -- Different operation IDs can still contend only on the existing aggregate row;
  -- this lock serializes exact-operation replay without widening that contention.
  perform pg_advisory_xact_lock(hashtext(p_workspace_key), hashtext(p_operation_id));

  select * into existing_receipt
  from public.ship_dynamics_block_operations
  where workspace_key = p_workspace_key
    and operation_id = p_operation_id;

  if found then
    if existing_receipt.actor_user_id is distinct from p_actor_user_id
       or existing_receipt.request_payload is distinct from canonical_request
    then
      return jsonb_build_object(
        'ok', false,
        'code', 'operation-mismatch',
        'operation_id', p_operation_id
      );
    end if;

    return existing_receipt.result || jsonb_build_object('replayed', true);
  end if;

  write_result := public.apply_ship_dynamics_block_patch(
    p_workspace_key,
    p_operations,
    p_saved_by,
    p_actor_user_id,
    p_actor_guard,
    p_authorization_guard,
    p_lock_guards
  );

  if not coalesce((write_result ->> 'ok')::boolean, false) then
    return (write_result - 'payload') || jsonb_build_object(
      'operation_id', p_operation_id,
      'replayed', false
    );
  end if;

  compact_result := (write_result - 'payload') || jsonb_build_object(
    'status', 'committed',
    'operation_id', p_operation_id,
    'replayed', false
  );

  insert into public.ship_dynamics_block_operations (
    workspace_key,
    operation_id,
    actor_user_id,
    request_hash,
    request_payload,
    result,
    revision,
    updated_at
  ) values (
    p_workspace_key,
    p_operation_id,
    p_actor_user_id,
    md5(canonical_request::text),
    canonical_request,
    compact_result,
    (write_result ->> 'revision')::integer,
    (write_result ->> 'updated_at')::timestamptz
  );

  return compact_result;
end;
$$;

create or replace function public.get_ship_dynamics_block_patch_receipt(
  p_workspace_key text,
  p_operation_id text,
  p_operations jsonb,
  p_saved_by text,
  p_actor_user_id text,
  p_actor_guard jsonb,
  p_authorization_guard jsonb,
  p_lock_guards jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  existing_receipt public.ship_dynamics_block_operations%rowtype;
  canonical_request jsonb;
begin
  if p_operation_id is null
     or char_length(btrim(p_operation_id)) < 1
     or char_length(p_operation_id) > 200
  then
    return jsonb_build_object('status','missing');
  end if;

  select * into existing_receipt
  from public.ship_dynamics_block_operations
  where workspace_key = p_workspace_key
    and operation_id = p_operation_id;

  if not found or existing_receipt.actor_user_id is distinct from p_actor_user_id then
    return jsonb_build_object('status','missing');
  end if;

  canonical_request := jsonb_build_object(
    'operations', p_operations,
    'savedBy', p_saved_by,
    'actorUserId', p_actor_user_id,
    'actorGuard', p_actor_guard,
    'authorizationGuard', p_authorization_guard,
    'lockGuards', p_lock_guards
  );

  if existing_receipt.request_payload is distinct from canonical_request then
    return jsonb_build_object('status','mismatch','code','operation-mismatch');
  end if;

  return existing_receipt.result || jsonb_build_object('replayed', true);
end;
$$;

alter function public.get_ship_dynamics_block_patch_receipt(text,text,jsonb,text,text,jsonb,jsonb,jsonb)
  reset statement_timeout;

revoke all on function public.apply_ship_dynamics_block_patch_v2(text,text,jsonb,text,text,jsonb,jsonb,jsonb) from public;
revoke all on function public.get_ship_dynamics_block_patch_receipt(text,text,jsonb,text,text,jsonb,jsonb,jsonb) from public;
revoke all on table public.ship_dynamics_block_operations from public;

do $roles$
begin
  if to_regrole('anon') is not null then
    revoke all on table public.ship_dynamics_block_operations from anon;
    grant execute on function public.apply_ship_dynamics_block_patch_v2(text,text,jsonb,text,text,jsonb,jsonb,jsonb) to anon;
    grant execute on function public.get_ship_dynamics_block_patch_receipt(text,text,jsonb,text,text,jsonb,jsonb,jsonb) to anon;
  end if;
  if to_regrole('authenticated') is not null then
    revoke all on table public.ship_dynamics_block_operations from authenticated;
    grant execute on function public.apply_ship_dynamics_block_patch_v2(text,text,jsonb,text,text,jsonb,jsonb,jsonb) to authenticated;
    grant execute on function public.get_ship_dynamics_block_patch_receipt(text,text,jsonb,text,text,jsonb,jsonb,jsonb) to authenticated;
  end if;
end;
$roles$;

comment on table public.ship_dynamics_block_operations is
  'Durable compact receipts for exact AppData block-patch replay; stores request patches, never the aggregate AppData payload.';
comment on function public.apply_ship_dynamics_block_patch_v2(text,text,jsonb,text,text,jsonb,jsonb,jsonb) is
  'Applies the existing aggregate block patch transaction and returns only a compact, actor-bound durable operation receipt.';
comment on function public.get_ship_dynamics_block_patch_receipt(text,text,jsonb,text,text,jsonb,jsonb,jsonb) is
  'Returns compact committed/missing/mismatch status only for the same actor and canonical block-patch request, without exposing the receipt table.';

commit;
