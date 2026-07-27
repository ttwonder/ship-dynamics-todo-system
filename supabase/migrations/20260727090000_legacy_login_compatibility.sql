begin;

-- Preserve the pre-cutover sign-in contract for existing non-owner users while
-- retaining Supabase Auth sessions as the sole database authority. Credential
-- hashes remain server-only and are never returned by SQL/RLS projections.
alter table public.sd_login_options
  add column if not exists login_mode text not null default 'supabase',
  add column if not exists legacy_password_hash text;

alter table public.sd_login_options
  drop constraint if exists sd_login_mode_check,
  drop constraint if exists sd_login_legacy_hash_check;
alter table public.sd_login_options
  add constraint sd_login_mode_check check (
    login_mode in ('supabase', 'legacy-password', 'passwordless')
  ),
  add constraint sd_login_legacy_hash_check check (
    (legacy_password_hash is null or legacy_password_hash ~ '^[0-9a-f]{64}$')
    and (login_mode <> 'legacy-password' or legacy_password_hash is not null)
    and (login_mode <> 'passwordless' or legacy_password_hash is null)
  );

revoke all on table public.sd_login_options from public, anon, authenticated;
grant select on table public.sd_login_options to service_role;

with legacy_credentials as (
  select
    w.id as workspace_id,
    btrim(legacy_user ->> 'id') as legacy_user_id,
    lower(btrim(coalesce(legacy_user ->> 'passwordHash', ''))) as password_hash
  from public.sd_workspaces w
  join public.ship_dynamics_app_state state
    on state.workspace_key = w.legacy_key
  cross join lateral jsonb_array_elements(
    case
      when jsonb_typeof(state.payload -> 'users') = 'array'
        then state.payload -> 'users'
      else '[]'::jsonb
    end
  ) legacy_user
  where btrim(coalesce(legacy_user ->> 'id', '')) <> ''
), classified as (
  select
    membership.workspace_id,
    membership.user_id,
    membership.role,
    case
      when credential.password_hash ~ '^[0-9a-f]{64}$'
        then credential.password_hash
      else null
    end as password_hash,
    coalesce(credential.password_hash, '') = '' as password_was_blank
  from public.sd_memberships membership
  left join legacy_credentials credential
    on credential.workspace_id = membership.workspace_id
   and credential.legacy_user_id = membership.legacy_user_id
  where membership.legacy_user_id is not null
)
update public.sd_login_options login
set
  legacy_password_hash = classified.password_hash,
  login_mode = case
    when classified.role = 'owner' then 'supabase'
    when classified.password_hash is not null then 'legacy-password'
    when classified.role in ('operator', 'vessel') and classified.password_was_blank
      then 'passwordless'
    else 'supabase'
  end,
  must_change_password = case
    when classified.role = 'owner' then true
    when classified.password_hash is not null then false
    when classified.role in ('operator', 'vessel') and classified.password_was_blank
      then false
    else true
  end,
  updated_at = clock_timestamp()
from classified
where login.workspace_id = classified.workspace_id
  and login.user_id = classified.user_id;

-- An explicit reset is an intentional opt-in to native Supabase password mode.
create or replace function public.mark_ship_dynamics_password_reset_required(
  p_workspace_id uuid,
  p_user_id uuid,
  p_operation_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
begin
  if public.sd_membership_role(p_workspace_id) not in ('owner','admin')
     or exists(
       select 1 from public.sd_memberships m
       where m.workspace_id=p_workspace_id and m.user_id=p_user_id and m.role='owner'
     )
     or not exists(
       select 1 from public.sd_operations o
       where o.workspace_id=p_workspace_id and o.operation_id=p_operation_id
         and o.actor_id=auth.uid() and o.command='manage_user:reset-password'
         and o.status in ('prepared','recovery_required')
     ) then
    raise exception using errcode='P0001', message='not-authorized';
  end if;
  update public.sd_login_options l
  set login_mode='supabase',legacy_password_hash=null,
      must_change_password=true,updated_at=clock_timestamp()
  where l.workspace_id=p_workspace_id and l.user_id=p_user_id and l.is_active;
  if not found then raise exception using errcode='P0001', message='not-authorized'; end if;
  return true;
end;
$$;

-- A successful native password change permanently leaves compatibility mode.
-- The legacy hash is erased so a former credential cannot silently return.
create or replace function public.complete_my_ship_dynamics_password_activation(
  p_workspace_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or public.sd_membership_role(p_workspace_id) is null then
    raise exception using errcode='P0001', message='not-authorized';
  end if;
  update public.sd_login_options l
  set login_mode='supabase',legacy_password_hash=null,
      must_change_password=false,updated_at=clock_timestamp()
  where l.workspace_id=p_workspace_id and l.user_id=auth.uid() and l.is_active;
  if not found then raise exception using errcode='P0001', message='not-authorized'; end if;
  insert into public.sd_audit_events(workspace_id,id,actor_id,command,entity_type,entity_id,detail)
  values(
    p_workspace_id,
    public.sd_core_event_id(auth.uid(),clock_timestamp()::text),
    auth.uid(),'complete_password_activation','user',auth.uid()::text,
    jsonb_build_object('loginMode','supabase')
  );
  return true;
end;
$$;

revoke all on function public.complete_my_ship_dynamics_password_activation(uuid) from public, anon;
grant execute on function public.complete_my_ship_dynamics_password_activation(uuid) to authenticated;

-- Promoting a passwordless account to admin fails closed into native password
-- mode. The Owner must then issue a password through the existing reset flow.
create or replace function public.change_ship_dynamics_user_role(
  p_workspace_id uuid,
  p_user_id uuid,
  p_role text,
  p_operation_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
begin
  if public.sd_membership_role(p_workspace_id) <> 'owner'
     or p_role not in ('admin','operator','vessel')
     or exists(select 1 from public.sd_memberships m where m.workspace_id=p_workspace_id and m.user_id=p_user_id and m.role='owner')
     or not exists(select 1 from public.sd_operations o where o.workspace_id=p_workspace_id and o.operation_id=p_operation_id and o.actor_id=auth.uid() and o.command='manage_user:change-role' and o.status in ('prepared','recovery_required')) then
    raise exception using errcode='P0001', message='not-authorized';
  end if;
  update public.sd_memberships m
  set role=p_role,version=m.version+1,updated_at=clock_timestamp(),updated_by=auth.uid()
  where m.workspace_id=p_workspace_id and m.user_id=p_user_id and m.is_active;
  if not found then raise exception using errcode='P0001', message='target-inactive'; end if;
  if p_role='admin' then
    update public.sd_login_options l
    set login_mode=case when l.login_mode='passwordless' then 'supabase' else l.login_mode end,
        must_change_password=case when l.login_mode='passwordless' then true else l.must_change_password end,
        updated_at=clock_timestamp()
    where l.workspace_id=p_workspace_id and l.user_id=p_user_id and l.is_active;
  end if;
  return true;
end;
$$;

-- A target must already have a known native password before becoming Owner.
-- The previous Owner returns to their original legacy password when available.
create or replace function public.transfer_ship_dynamics_owner(
  p_workspace_id uuid,
  p_user_id uuid,
  p_operation_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid:=auth.uid();
  v_operation public.sd_operations%rowtype;
  v_actor_role text;
  v_target_role text;
  v_target_login_mode text;
begin
  select * into v_operation from public.sd_operations o
  where o.workspace_id=p_workspace_id and o.operation_id=p_operation_id
    and o.actor_id=v_actor and o.command='manage_user:transfer-owner'
    and o.status in ('prepared','recovery_required') for update;
  if not found then raise exception using errcode='P0001', message='not-authorized'; end if;
  select role into v_actor_role from public.sd_memberships where workspace_id=p_workspace_id and user_id=v_actor and is_active for update;
  select m.role,l.login_mode into v_target_role,v_target_login_mode
  from public.sd_memberships m
  join public.sd_login_options l using(workspace_id,user_id)
  where m.workspace_id=p_workspace_id and m.user_id=p_user_id and m.is_active and l.is_active
  for update of m,l;
  if v_target_role is null then raise exception using errcode='P0001', message='target-inactive'; end if;
  if v_actor_role='owner' then
    if v_target_login_mode <> 'supabase' then
      raise exception using errcode='P0001', message='target-password-required';
    end if;
    update public.sd_memberships set role='admin',version=version+1,updated_at=clock_timestamp(),updated_by=v_actor
      where workspace_id=p_workspace_id and user_id=v_actor;
    update public.sd_memberships set role='owner',version=version+1,updated_at=clock_timestamp(),updated_by=v_actor
      where workspace_id=p_workspace_id and user_id=p_user_id;
    update public.sd_login_options
    set login_mode=case when legacy_password_hash is not null then 'legacy-password' else 'supabase' end,
        must_change_password=false,
        updated_at=clock_timestamp()
    where workspace_id=p_workspace_id and user_id=v_actor;
    update public.sd_login_options
    set login_mode='supabase',updated_at=clock_timestamp()
    where workspace_id=p_workspace_id and user_id=p_user_id;
  elsif not (v_actor_role='admin' and v_target_role='owner') then
    raise exception using errcode='P0001', message='not-authorized';
  end if;
  return jsonb_build_object('previousOwnerId',v_actor,'ownerId',p_user_id);
end;
$$;

commit;
