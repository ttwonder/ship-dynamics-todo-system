create table if not exists public.ship_dynamics_app_state (
  workspace_key text primary key,
  payload jsonb not null,
  revision integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by text
);

alter table public.ship_dynamics_app_state add column if not exists updated_by text;
alter table public.ship_dynamics_app_state enable row level security;

drop policy if exists "ship dynamics public read workspace" on public.ship_dynamics_app_state;
create policy "ship dynamics public read workspace"
  on public.ship_dynamics_app_state for select
  using (true);

drop policy if exists "ship dynamics public upsert workspace" on public.ship_dynamics_app_state;
create policy "ship dynamics public upsert workspace"
  on public.ship_dynamics_app_state for insert
  with check (true);

drop policy if exists "ship dynamics public update workspace" on public.ship_dynamics_app_state;
create policy "ship dynamics public update workspace"
  on public.ship_dynamics_app_state for update
  using (true)
  with check (true);

create table if not exists public.ship_dynamics_app_revisions (
  workspace_key text not null,
  revision integer not null,
  payload jsonb not null,
  saved_by text,
  saved_at timestamptz not null default now(),
  primary key (workspace_key, revision)
);

alter table public.ship_dynamics_app_revisions enable row level security;

drop policy if exists "ship dynamics public read revisions" on public.ship_dynamics_app_revisions;
create policy "ship dynamics public read revisions"
  on public.ship_dynamics_app_revisions for select
  using (true);

drop policy if exists "ship dynamics public insert revisions" on public.ship_dynamics_app_revisions;
create policy "ship dynamics public insert revisions"
  on public.ship_dynamics_app_revisions for insert
  with check (true);

create or replace function public.record_ship_dynamics_revision_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.ship_dynamics_app_revisions (workspace_key, revision, payload, saved_by, saved_at)
  values (new.workspace_key, new.revision, new.payload, new.updated_by, coalesce(new.updated_at, now()))
  on conflict (workspace_key, revision) do update
    set payload = excluded.payload,
        saved_by = excluded.saved_by,
        saved_at = excluded.saved_at;
  return new;
end;
$$;

drop trigger if exists ship_dynamics_revision_history_trigger on public.ship_dynamics_app_state;
create trigger ship_dynamics_revision_history_trigger
after insert or update on public.ship_dynamics_app_state
for each row execute function public.record_ship_dynamics_revision_history();

create table if not exists public.ship_dynamics_edit_locks (
  workspace_key text not null,
  section_key text not null,
  locked_by text not null,
  locked_by_name text not null,
  locked_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (workspace_key, section_key)
);

alter table public.ship_dynamics_edit_locks enable row level security;

drop policy if exists "ship dynamics public read edit locks" on public.ship_dynamics_edit_locks;
create policy "ship dynamics public read edit locks"
  on public.ship_dynamics_edit_locks for select
  using (true);

drop policy if exists "ship dynamics public insert edit locks" on public.ship_dynamics_edit_locks;
create policy "ship dynamics public insert edit locks"
  on public.ship_dynamics_edit_locks for insert
  with check (true);

drop policy if exists "ship dynamics public update edit locks" on public.ship_dynamics_edit_locks;
create policy "ship dynamics public update edit locks"
  on public.ship_dynamics_edit_locks for update
  using (true)
  with check (true);

drop policy if exists "ship dynamics public delete edit locks" on public.ship_dynamics_edit_locks;
create policy "ship dynamics public delete edit locks"
  on public.ship_dynamics_edit_locks for delete
  using (true);

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
  values (p_workspace_key, p_section_key, p_locked_by, p_locked_by_name, now(), now() + make_interval(secs => greatest(p_ttl_seconds, 30)))
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

-- 說明：
-- 這是 GitHub Pages 靜態前端的輕量共享 payload 模式。
-- 產品級強權限仍在前端 Owner/Admin/Operator 與操作紀錄中執行；
-- 多人協作依靠 revision CAS + revision history + section soft lock 避免靜默覆蓋。
-- 若日後要改成 Supabase Auth + 嚴格 RLS，可將 payload 拆分為 users/vessels/tasks/audit_logs 多表。
