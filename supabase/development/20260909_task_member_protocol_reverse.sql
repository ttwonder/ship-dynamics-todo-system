-- PRIVATE reverse at a quiescent boundary. Preserve all current/history bodies and receipts.
begin;
select pg_advisory_xact_lock(hashtext('record-maintenance-v1'),0);
drop function public.save_ship_dynamics_task_member_v1(text,text,text,text,jsonb,jsonb,text,jsonb,jsonb);
drop function public.read_ship_dynamics_task_member_v1(text,text,text,text);
-- Keep immutable status lookup available for pending upgraded-client receipts.
drop function public.ship_dynamics_member_source_v1(text,text);
drop function public.ship_dynamics_member_plain_text_v1(text);
drop function public.ship_dynamics_member_js_trim_v1(text);
drop trigger ship_dynamics_member_structure on public.ship_dynamics_records;
drop trigger ship_dynamics_member_progress on public.ship_dynamics_record_task_progress;
drop function public.ship_dynamics_member_track_v1();
drop table public.ship_dynamics_member_fences;
create or replace function public.claim_ship_dynamics_edit_lock(
  p_workspace_key text,
  p_section_key text,
  p_locked_by text,
  p_locked_by_name text,
  p_ttl_seconds integer default 75
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  existing public.ship_dynamics_edit_locks%rowtype;
  claimed public.ship_dynamics_edit_locks%rowtype;
begin
  select * into existing
  from public.ship_dynamics_edit_locks
  where workspace_key = p_workspace_key and section_key = p_section_key;

  if found and existing.expires_at > now() and existing.locked_by <> p_locked_by then
    return jsonb_build_object(
      'ok', false,
      'section_key', existing.section_key,
      'locked_by', existing.locked_by,
      'locked_by_name', existing.locked_by_name,
      'expires_at', existing.expires_at
    );
  end if;

  insert into public.ship_dynamics_edit_locks (workspace_key, section_key, locked_by, locked_by_name, locked_at, expires_at)
  values (p_workspace_key, p_section_key, p_locked_by, p_locked_by_name, now(), now() + make_interval(secs => least(greatest(p_ttl_seconds, 30), 120)))
  on conflict (workspace_key, section_key) do update
    set locked_by = excluded.locked_by,
        locked_by_name = excluded.locked_by_name,
        locked_at = now(),
        expires_at = excluded.expires_at
    where public.ship_dynamics_edit_locks.expires_at <= now()
       or public.ship_dynamics_edit_locks.locked_by = p_locked_by
  returning * into claimed;

  if claimed.workspace_key is null then
    select * into existing
    from public.ship_dynamics_edit_locks
    where workspace_key = p_workspace_key and section_key = p_section_key;
    return jsonb_build_object(
      'ok', false,
      'section_key', coalesce(existing.section_key, p_section_key),
      'locked_by', existing.locked_by,
      'locked_by_name', existing.locked_by_name,
      'expires_at', existing.expires_at
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'section_key', claimed.section_key,
    'locked_by', claimed.locked_by,
    'locked_by_name', claimed.locked_by_name,
    'expires_at', claimed.expires_at
  );
end;
$$;

create or replace function public.renew_ship_dynamics_edit_lock(
  p_workspace_key text,
  p_section_key text,
  p_locked_by text,
  p_ttl_seconds integer default 75
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  renewed public.ship_dynamics_edit_locks%rowtype;
  existing public.ship_dynamics_edit_locks%rowtype;
begin
  update public.ship_dynamics_edit_locks
  set expires_at = now() + make_interval(secs => least(greatest(p_ttl_seconds, 30), 120))
  where workspace_key = p_workspace_key
    and section_key = p_section_key
    and locked_by = p_locked_by
    and expires_at > now()
  returning * into renewed;

  if renewed.workspace_key is null then
    select * into existing
    from public.ship_dynamics_edit_locks
    where workspace_key = p_workspace_key and section_key = p_section_key;
    return jsonb_build_object(
      'ok', false,
      'section_key', coalesce(existing.section_key, p_section_key),
      'locked_by', existing.locked_by,
      'locked_by_name', existing.locked_by_name,
      'expires_at', existing.expires_at
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'section_key', renewed.section_key,
    'locked_by', renewed.locked_by,
    'locked_by_name', renewed.locked_by_name,
    'expires_at', renewed.expires_at
  );
end;
$$;

create or replace function public.release_ship_dynamics_edit_lock(
  p_workspace_key text,
  p_section_key text,
  p_locked_by text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.ship_dynamics_edit_locks
  where workspace_key = p_workspace_key
    and section_key = p_section_key
    and locked_by = p_locked_by;
  return true;
end;
$$;

drop function public.renew_ship_dynamics_task_member_lock_v1(text,text,text,text,integer);
drop function public.release_ship_dynamics_task_member_lock_v1(text,text,text,text);
drop function public.ship_dynamics_task_lease_gate_v1(text,text);
drop function public.ship_dynamics_task_lock_family_v1(text);
drop function public.ship_dynamics_task_member_key_v1(text,text);
alter table public.ship_dynamics_edit_locks drop column lease_version;
-- Keep monotonic sequence so a later reupgrade cannot resurrect a pre-reverse token.
commit;
