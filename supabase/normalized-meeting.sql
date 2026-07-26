begin;

-- Additive meeting aggregate slice. This migration is applied after
-- normalized-schema.sql and deliberately leaves the legacy payload untouched.

create table if not exists public.sd_meetings (
  workspace_id uuid not null references public.sd_workspaces(id) on delete cascade,
  id text not null,
  scope_mode text not null check (scope_mode in ('all', 'types', 'vessels')),
  subject text not null,
  status text not null check (status in ('待召開', '追蹤中', '已完成')),
  meeting_date date not null,
  reason text not null,
  resolution text not null default '',
  expected_date date,
  completed_date date,
  completed_by uuid references auth.users(id),
  priority text not null check (priority in ('急', '高', '中', '低')),
  is_abnormal boolean not null default false,
  is_internal_control boolean not null default false,
  include_in_morning boolean not null default false,
  latest_status text not null default '',
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid not null references auth.users(id),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid not null references auth.users(id),
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id),
  primary key (workspace_id, id),
  constraint sd_meetings_id_not_blank check (btrim(id) <> ''),
  constraint sd_meetings_subject_not_blank check (btrim(subject) <> ''),
  constraint sd_meetings_reason_not_blank check (btrim(reason) <> ''),
  constraint sd_meetings_completion_consistent check (
    (status = '已完成' and completed_date is not null and completed_by is not null)
    or (status <> '已完成' and completed_date is null and completed_by is null)
  ),
  constraint sd_meetings_deletion_consistent check (
    (deleted_at is null and deleted_by is null)
    or (deleted_at is not null and deleted_by is not null)
  )
);

create table if not exists public.sd_meeting_vessels (
  workspace_id uuid not null,
  meeting_id text not null,
  vessel_id text not null,
  primary key (workspace_id, meeting_id, vessel_id),
  foreign key (workspace_id, meeting_id)
    references public.sd_meetings(workspace_id, id) on delete restrict,
  foreign key (workspace_id, vessel_id)
    references public.sd_vessels(workspace_id, id) on delete restrict
);

create table if not exists public.sd_meeting_type_scopes (
  workspace_id uuid not null,
  meeting_id text not null,
  ship_type text not null,
  primary key (workspace_id, meeting_id, ship_type),
  foreign key (workspace_id, meeting_id)
    references public.sd_meetings(workspace_id, id) on delete restrict,
  constraint sd_meeting_type_scopes_not_blank check (btrim(ship_type) <> '')
);

create table if not exists public.sd_meeting_departments (
  workspace_id uuid not null,
  meeting_id text not null,
  department text not null,
  primary key (workspace_id, meeting_id, department),
  foreign key (workspace_id, meeting_id)
    references public.sd_meetings(workspace_id, id) on delete restrict,
  constraint sd_meeting_departments_not_blank check (btrim(department) <> '')
);

create table if not exists public.sd_meeting_participants (
  workspace_id uuid not null,
  meeting_id text not null,
  user_id uuid not null,
  participant_kind text not null
    check (participant_kind in ('participant', 'tracking', 'responsible')),
  primary key (workspace_id, meeting_id, user_id, participant_kind),
  foreign key (workspace_id, meeting_id)
    references public.sd_meetings(workspace_id, id) on delete restrict,
  foreign key (workspace_id, user_id)
    references public.sd_memberships(workspace_id, user_id) on delete restrict
);

create table if not exists public.sd_meeting_items (
  workspace_id uuid not null,
  id text not null,
  meeting_id text not null,
  description text not null,
  distribute_to_vessels boolean not null default false,
  ordinal integer not null check (ordinal > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid not null references auth.users(id),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid not null references auth.users(id),
  primary key (workspace_id, id),
  foreign key (workspace_id, meeting_id)
    references public.sd_meetings(workspace_id, id) on delete restrict,
  constraint sd_meeting_items_id_not_blank check (btrim(id) <> ''),
  constraint sd_meeting_items_description_not_blank check (btrim(description) <> '')
);

create unique index if not exists sd_meeting_items_active_ordinal_unique
  on public.sd_meeting_items(workspace_id, meeting_id, ordinal)
  where is_active;

create index if not exists sd_meeting_items_meeting_lookup
  on public.sd_meeting_items(workspace_id, meeting_id, is_active, ordinal);

create table if not exists public.sd_meeting_item_categories (
  workspace_id uuid not null,
  meeting_item_id text not null,
  category text not null,
  primary key (workspace_id, meeting_item_id, category),
  foreign key (workspace_id, meeting_item_id)
    references public.sd_meeting_items(workspace_id, id) on delete restrict,
  constraint sd_meeting_item_categories_not_blank check (btrim(category) <> '')
);

create table if not exists public.sd_meeting_status_events (
  workspace_id uuid not null references public.sd_workspaces(id) on delete restrict,
  id uuid not null,
  meeting_id text not null,
  status text not null,
  actor_id uuid not null references auth.users(id),
  created_at timestamptz not null default clock_timestamp(),
  primary key (workspace_id, id),
  constraint sd_meeting_status_events_status_not_blank check (btrim(status) <> '')
);

create index if not exists sd_meeting_status_events_meeting_created
  on public.sd_meeting_status_events(workspace_id, meeting_id, created_at, id);

-- Task categories, departments, and owners are owned by normalized-core-domain.sql.
-- This aggregate only updates those shared relations inside meeting commands.

alter table public.sd_tasks
  add column if not exists source_meeting_item_id text;

create unique index if not exists sd_tasks_one_per_meeting_item
  on public.sd_tasks(workspace_id, source_meeting_item_id)
  where source_meeting_item_id is not null;

do $migration$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.sd_tasks'::regclass
      and conname = 'sd_tasks_meeting_provenance_consistent'
  ) then
    alter table public.sd_tasks
      add constraint sd_tasks_meeting_provenance_consistent check (
        (source_kind = 'ordinary' and source_meeting_item_id is null)
        or (source_kind = 'meeting' and source_meeting_item_id is not null)
      ) not valid;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.sd_tasks'::regclass
      and conname = 'sd_tasks_source_meeting_item_fk'
  ) then
    alter table public.sd_tasks
      add constraint sd_tasks_source_meeting_item_fk
      foreign key (workspace_id, source_meeting_item_id)
      references public.sd_meeting_items(workspace_id, id)
      on delete restrict
      not valid;
  end if;
end;
$migration$;

create or replace function public.sd_reject_immutable_history_change()
returns trigger
language plpgsql
volatile
set search_path = pg_catalog, public
as $$
begin
  raise exception using errcode = 'P0001', message = 'immutable-history';
end;
$$;

do $triggers$
begin
  if not exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.sd_task_status_events'::regclass
      and tgname = 'sd_task_status_events_immutable'
      and not tgisinternal
  ) then
    create trigger sd_task_status_events_immutable
      before update or delete on public.sd_task_status_events
      for each row execute function public.sd_reject_immutable_history_change();
  end if;

  if not exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.sd_meeting_status_events'::regclass
      and tgname = 'sd_meeting_status_events_immutable'
      and not tgisinternal
  ) then
    create trigger sd_meeting_status_events_immutable
      before update or delete on public.sd_meeting_status_events
      for each row execute function public.sd_reject_immutable_history_change();
  end if;

  if not exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.sd_audit_events'::regclass
      and tgname = 'sd_audit_events_immutable'
      and not tgisinternal
  ) then
    create trigger sd_audit_events_immutable
      before update or delete on public.sd_audit_events
      for each row execute function public.sd_reject_immutable_history_change();
  end if;
end;
$triggers$;

alter table public.sd_meetings enable row level security;
alter table public.sd_meeting_vessels enable row level security;
alter table public.sd_meeting_type_scopes enable row level security;
alter table public.sd_meeting_departments enable row level security;
alter table public.sd_meeting_participants enable row level security;
alter table public.sd_meeting_items enable row level security;
alter table public.sd_meeting_item_categories enable row level security;
alter table public.sd_meeting_status_events enable row level security;

revoke all on table public.sd_meetings from anon, authenticated;
revoke all on table public.sd_meeting_vessels from anon, authenticated;
revoke all on table public.sd_meeting_type_scopes from anon, authenticated;
revoke all on table public.sd_meeting_departments from anon, authenticated;
revoke all on table public.sd_meeting_participants from anon, authenticated;
revoke all on table public.sd_meeting_items from anon, authenticated;
revoke all on table public.sd_meeting_item_categories from anon, authenticated;
revoke all on table public.sd_meeting_status_events from anon, authenticated;

grant select on table public.sd_meetings to authenticated;
grant select on table public.sd_meeting_vessels to authenticated;
grant select on table public.sd_meeting_type_scopes to authenticated;
grant select on table public.sd_meeting_departments to authenticated;
grant select on table public.sd_meeting_participants to authenticated;
grant select on table public.sd_meeting_items to authenticated;
grant select on table public.sd_meeting_item_categories to authenticated;
grant select on table public.sd_meeting_status_events to authenticated;

create or replace function public.sd_can_manage_meetings(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(
    public.sd_membership_role(p_workspace_id) <> 'vessel'
    and public.sd_has_permission(p_workspace_id, 'manageMeetings')
    and public.sd_has_permission(p_workspace_id, 'viewAllVessels'),
    false
  )
$$;

create or replace function public.sd_meeting_scope_is_valid(
  p_workspace_id uuid,
  p_meeting_id text
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_mode text;
  v_vessel_count integer;
  v_type_count integer;
begin
  select m.scope_mode into v_mode
  from public.sd_meetings m
  where m.workspace_id = p_workspace_id
    and m.id = p_meeting_id
    and m.deleted_at is null;
  if not found then return false; end if;

  select count(*) into v_vessel_count
  from public.sd_meeting_vessels mv
  join public.sd_vessels v
    on v.workspace_id = mv.workspace_id
   and v.id = mv.vessel_id
   and v.is_active
  where mv.workspace_id = p_workspace_id
    and mv.meeting_id = p_meeting_id;
  if v_vessel_count = 0 then return false; end if;

  select count(*) into v_type_count
  from public.sd_meeting_type_scopes mts
  where mts.workspace_id = p_workspace_id
    and mts.meeting_id = p_meeting_id;

  if v_mode = 'types' then
    if v_type_count = 0 then return false; end if;
    if exists (
      select 1
      from public.sd_meeting_vessels mv
      join public.sd_vessels v
        on v.workspace_id = mv.workspace_id
       and v.id = mv.vessel_id
      where mv.workspace_id = p_workspace_id
        and mv.meeting_id = p_meeting_id
        and not exists (
          select 1
          from public.sd_meeting_type_scopes mts
          where mts.workspace_id = mv.workspace_id
            and mts.meeting_id = mv.meeting_id
            and mts.ship_type = v.ship_type
        )
    ) then return false; end if;
    return not exists (
      select 1
      from public.sd_meeting_type_scopes mts
      where mts.workspace_id = p_workspace_id
        and mts.meeting_id = p_meeting_id
        and not exists (
          select 1
          from public.sd_meeting_vessels mv
          join public.sd_vessels v
            on v.workspace_id = mv.workspace_id
           and v.id = mv.vessel_id
          where mv.workspace_id = mts.workspace_id
            and mv.meeting_id = mts.meeting_id
            and v.ship_type = mts.ship_type
        )
    );
  end if;

  return v_type_count = 0 and v_mode in ('all', 'vessels');
end;
$$;

create or replace function public.sd_can_read_meeting(
  p_workspace_id uuid,
  p_meeting_id text
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_role text;
begin
  v_role := public.sd_membership_role(p_workspace_id);
  if v_role is null or v_role = 'vessel' then return false; end if;
  if not public.sd_meeting_scope_is_valid(p_workspace_id, p_meeting_id) then return false; end if;

  if v_role in ('owner', 'admin')
     or public.sd_has_permission(p_workspace_id, 'viewAllVessels') then
    return true;
  end if;

  if exists (
    select 1
    from public.sd_meeting_participants mp
    where mp.workspace_id = p_workspace_id
      and mp.meeting_id = p_meeting_id
      and mp.user_id = auth.uid()
  ) then return true; end if;

  return not exists (
    select 1
    from public.sd_meeting_vessels mv
    where mv.workspace_id = p_workspace_id
      and mv.meeting_id = p_meeting_id
      and not public.sd_can_read_vessel(p_workspace_id, mv.vessel_id)
  );
end;
$$;

create or replace function public.sd_can_edit_meeting(
  p_workspace_id uuid,
  p_meeting_id text
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select public.sd_can_manage_meetings(p_workspace_id)
    and exists (
      select 1
      from public.sd_meetings m
      where m.workspace_id = p_workspace_id
        and m.id = p_meeting_id
        and m.deleted_at is null
    )
$$;

-- Replace the task read predicate so a vessel account can see only its own
-- projection of a structurally valid, distributed, non-internal meeting task.
create or replace function public.sd_can_read_task(p_workspace_id uuid, p_task_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_role text;
  v_task public.sd_tasks%rowtype;
  v_scope_count integer;
  v_account_count integer;
  v_account_vessel text;
begin
  v_role := public.sd_membership_role(p_workspace_id);
  if v_role is null then return false; end if;

  select * into v_task
  from public.sd_tasks t
  where t.workspace_id = p_workspace_id and t.id = p_task_id;
  if not found then return false; end if;
  if v_task.is_deleted then return false; end if;

  if v_role = 'vessel' then
    if v_task.is_internal_control then return false; end if;

    select count(*), min(a.vessel_id)
      into v_account_count, v_account_vessel
    from public.sd_vessel_assignments a
    where a.workspace_id = p_workspace_id
      and a.user_id = auth.uid()
      and a.assignment_kind = 'vessel_account'
      and a.is_active;
    if v_account_count <> 1 then return false; end if;

    select count(*) into v_scope_count
    from public.sd_task_vessels tv
    where tv.workspace_id = p_workspace_id
      and tv.task_id = p_task_id
      and tv.is_active_scope;

    if v_task.source_kind = 'ordinary' then
      if v_task.source_meeting_item_id is not null or v_scope_count <> 1 then
        return false;
      end if;
      return exists (
        select 1
        from public.sd_task_vessels tv
        where tv.workspace_id = p_workspace_id
          and tv.task_id = p_task_id
          and tv.vessel_id = v_account_vessel
          and tv.is_active_scope
      );
    end if;

    if v_task.source_kind <> 'meeting'
       or v_task.source_meeting_item_id is null then
      return false;
    end if;

    return exists (
      select 1
      from public.sd_meeting_items mi
      join public.sd_meetings m
        on m.workspace_id = mi.workspace_id
       and m.id = mi.meeting_id
       and m.deleted_at is null
       and not m.is_internal_control
      join public.sd_meeting_vessels mv
        on mv.workspace_id = mi.workspace_id
       and mv.meeting_id = mi.meeting_id
       and mv.vessel_id = v_account_vessel
      join public.sd_task_vessels own_progress
        on own_progress.workspace_id = mi.workspace_id
       and own_progress.task_id = v_task.id
       and own_progress.vessel_id = v_account_vessel
       and own_progress.is_active_scope
      where mi.workspace_id = p_workspace_id
        and mi.id = v_task.source_meeting_item_id
        and mi.is_active
        and mi.distribute_to_vessels
        and public.sd_meeting_scope_is_valid(mi.workspace_id, mi.meeting_id)
        and not exists (
          select 1
          from public.sd_task_vessels tv
          where tv.workspace_id = p_workspace_id
            and tv.task_id = p_task_id
            and tv.is_active_scope
            and not exists (
              select 1
              from public.sd_meeting_vessels expected
              where expected.workspace_id = mi.workspace_id
                and expected.meeting_id = mi.meeting_id
                and expected.vessel_id = tv.vessel_id
            )
        )
        and not exists (
          select 1
          from public.sd_meeting_vessels expected
          where expected.workspace_id = mi.workspace_id
            and expected.meeting_id = mi.meeting_id
            and not exists (
              select 1
              from public.sd_task_vessels tv
              where tv.workspace_id = expected.workspace_id
                and tv.task_id = p_task_id
                and tv.vessel_id = expected.vessel_id
                and tv.is_active_scope
            )
        )
    );
  end if;

  if v_role in ('owner', 'admin')
     or public.sd_has_permission(p_workspace_id, 'viewAllVessels') then
    return true;
  end if;

  return exists (
    select 1
    from public.sd_task_vessels tv
    where tv.workspace_id = p_workspace_id
      and tv.task_id = p_task_id
      and tv.is_active_scope
  ) and not exists (
    select 1
    from public.sd_task_vessels tv
    where tv.workspace_id = p_workspace_id
      and tv.task_id = p_task_id
      and tv.is_active_scope
      and not public.sd_can_read_vessel(p_workspace_id, tv.vessel_id)
  );
end;
$$;

create policy sd_meetings_read on public.sd_meetings
  for select to authenticated
  using (public.sd_can_read_meeting(workspace_id, id));

create policy sd_meeting_vessels_read on public.sd_meeting_vessels
  for select to authenticated
  using (public.sd_can_read_meeting(workspace_id, meeting_id));

create policy sd_meeting_type_scopes_read on public.sd_meeting_type_scopes
  for select to authenticated
  using (public.sd_can_read_meeting(workspace_id, meeting_id));

create policy sd_meeting_departments_read on public.sd_meeting_departments
  for select to authenticated
  using (public.sd_can_read_meeting(workspace_id, meeting_id));

create policy sd_meeting_participants_read on public.sd_meeting_participants
  for select to authenticated
  using (public.sd_can_read_meeting(workspace_id, meeting_id));

create policy sd_meeting_items_read on public.sd_meeting_items
  for select to authenticated
  using (public.sd_can_read_meeting(workspace_id, meeting_id));

create policy sd_meeting_item_categories_read on public.sd_meeting_item_categories
  for select to authenticated
  using (
    exists (
      select 1
      from public.sd_meeting_items mi
      where mi.workspace_id = sd_meeting_item_categories.workspace_id
        and mi.id = sd_meeting_item_categories.meeting_item_id
        and public.sd_can_read_meeting(mi.workspace_id, mi.meeting_id)
    )
  );

create policy sd_meeting_status_events_read on public.sd_meeting_status_events
  for select to authenticated
  using (public.sd_can_read_meeting(workspace_id, meeting_id));

create or replace function public.sd_validate_meeting_payload(
  p_workspace_id uuid,
  p_scope_mode text,
  p_subject text,
  p_status text,
  p_meeting_date date,
  p_vessel_ids text[],
  p_vessel_type_scopes text[],
  p_departments text[],
  p_participant_user_ids uuid[],
  p_tracking_user_ids uuid[],
  p_responsible_user_ids uuid[],
  p_reason text,
  p_completed_date date,
  p_priority text,
  p_items jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_expected_vessels text[];
  v_item jsonb;
begin
  if p_scope_mode not in ('all', 'types', 'vessels')
     or btrim(coalesce(p_subject, '')) = ''
     or p_status not in ('待召開', '追蹤中', '已完成')
     or p_meeting_date is null
     or btrim(coalesce(p_reason, '')) = ''
     or p_priority not in ('急', '高', '中', '低') then
    raise exception using errcode = 'P0001', message = 'invalid-meeting';
  end if;

  if (p_status = '已完成') is distinct from (p_completed_date is not null) then
    raise exception using errcode = 'P0001', message = 'invalid-completion';
  end if;

  if coalesce(cardinality(p_departments), 0) = 0
     or coalesce(cardinality(p_participant_user_ids), 0) = 0
     or coalesce(cardinality(p_tracking_user_ids), 0) = 0 then
    raise exception using errcode = 'P0001', message = 'invalid-meeting-people';
  end if;

  if exists (select 1 from unnest(coalesce(p_vessel_ids, '{}'::text[])) value where btrim(value) = '')
     or exists (select 1 from unnest(coalesce(p_vessel_type_scopes, '{}'::text[])) value where btrim(value) = '')
     or exists (select 1 from unnest(coalesce(p_departments, '{}'::text[])) value where btrim(value) = '')
     or cardinality(coalesce(p_vessel_ids, '{}'::text[])) <>
        (select count(distinct value) from unnest(coalesce(p_vessel_ids, '{}'::text[])) value)
     or cardinality(coalesce(p_vessel_type_scopes, '{}'::text[])) <>
        (select count(distinct value) from unnest(coalesce(p_vessel_type_scopes, '{}'::text[])) value)
     or cardinality(coalesce(p_departments, '{}'::text[])) <>
        (select count(distinct value) from unnest(coalesce(p_departments, '{}'::text[])) value)
     or cardinality(coalesce(p_participant_user_ids, '{}'::uuid[])) <>
        (select count(distinct value) from unnest(coalesce(p_participant_user_ids, '{}'::uuid[])) value)
     or cardinality(coalesce(p_tracking_user_ids, '{}'::uuid[])) <>
        (select count(distinct value) from unnest(coalesce(p_tracking_user_ids, '{}'::uuid[])) value)
     or cardinality(coalesce(p_responsible_user_ids, '{}'::uuid[])) <>
        (select count(distinct value) from unnest(coalesce(p_responsible_user_ids, '{}'::uuid[])) value) then
    raise exception using errcode = 'P0001', message = 'duplicate-or-blank-relation';
  end if;

  if exists (
    select 1
    from unnest(
      coalesce(p_participant_user_ids, '{}'::uuid[])
      || coalesce(p_tracking_user_ids, '{}'::uuid[])
      || coalesce(p_responsible_user_ids, '{}'::uuid[])
    ) requested(user_id)
    where not exists (
      select 1
      from public.sd_memberships m
      where m.workspace_id = p_workspace_id
        and m.user_id = requested.user_id
        and m.is_active
        and m.role <> 'vessel'
    )
  ) then
    raise exception using errcode = 'P0001', message = 'invalid-meeting-person';
  end if;

  if p_scope_mode = 'all' then
    if coalesce(cardinality(p_vessel_type_scopes), 0) <> 0 then
      raise exception using errcode = 'P0001', message = 'invalid-meeting-scope';
    end if;
    select coalesce(array_agg(v.id order by v.id), '{}'::text[])
      into v_expected_vessels
    from public.sd_vessels v
    where v.workspace_id = p_workspace_id and v.is_active;
  elsif p_scope_mode = 'types' then
    if coalesce(cardinality(p_vessel_type_scopes), 0) = 0 then
      raise exception using errcode = 'P0001', message = 'invalid-meeting-scope';
    end if;
    select coalesce(array_agg(v.id order by v.id), '{}'::text[])
      into v_expected_vessels
    from public.sd_vessels v
    where v.workspace_id = p_workspace_id
      and v.is_active
      and v.ship_type = any(p_vessel_type_scopes);
  else
    if coalesce(cardinality(p_vessel_type_scopes), 0) <> 0 then
      raise exception using errcode = 'P0001', message = 'invalid-meeting-scope';
    end if;
    select coalesce(array_agg(v.id order by v.id), '{}'::text[])
      into v_expected_vessels
    from public.sd_vessels v
    where v.workspace_id = p_workspace_id
      and v.is_active
      and v.id = any(coalesce(p_vessel_ids, '{}'::text[]));
  end if;

  if coalesce(cardinality(v_expected_vessels), 0) = 0
     or v_expected_vessels is distinct from (
       select coalesce(array_agg(value order by value), '{}'::text[])
       from unnest(coalesce(p_vessel_ids, '{}'::text[])) value
     ) then
    raise exception using errcode = 'P0001', message = 'invalid-meeting-scope';
  end if;

  if p_scope_mode = 'types' and exists (
    select 1
    from unnest(p_vessel_type_scopes) requested(ship_type)
    where not exists (
      select 1
      from public.sd_vessels v
      where v.workspace_id = p_workspace_id
        and v.is_active
        and v.ship_type = requested.ship_type
    )
  ) then
    raise exception using errcode = 'P0001', message = 'invalid-meeting-type-scope';
  end if;

  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception using errcode = 'P0001', message = 'invalid-meeting-items';
  end if;

  if (
    select count(*)
    from jsonb_array_elements(p_items) item
  ) <> (
    select count(distinct item ->> 'id')
    from jsonb_array_elements(p_items) item
  ) then
    raise exception using errcode = 'P0001', message = 'duplicate-meeting-item';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) <> 'object'
       or (v_item - array['id', 'description', 'categories', 'distributeToVessels']) <> '{}'::jsonb
       or btrim(coalesce(v_item ->> 'id', '')) = ''
       or btrim(coalesce(v_item ->> 'description', '')) = ''
       or jsonb_typeof(v_item -> 'categories') <> 'array'
       or jsonb_typeof(v_item -> 'distributeToVessels') <> 'boolean'
       or exists (
         select 1
         from jsonb_array_elements(v_item -> 'categories') category
         where jsonb_typeof(category) <> 'string'
            or btrim(category #>> '{}') = ''
       )
       or (
         select count(*) from jsonb_array_elements(v_item -> 'categories')
       ) <> (
         select count(distinct category #>> '{}')
         from jsonb_array_elements(v_item -> 'categories') category
       ) then
      raise exception using errcode = 'P0001', message = 'invalid-meeting-item';
    end if;
  end loop;
end;
$$;

create or replace function public.sd_assert_meeting_task_guards(
  p_workspace_id uuid,
  p_meeting_id text,
  p_task_guards jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_task record;
  v_guard jsonb;
  v_guard_count integer;
  v_task_count integer;
  v_version bigint;
begin
  if p_task_guards is null or jsonb_typeof(p_task_guards) <> 'array' then
    raise exception using errcode = 'P0001', message = 'invalid-task-guards';
  end if;

  select count(*) into v_task_count
  from public.sd_tasks t
  join public.sd_meeting_items mi
    on mi.workspace_id = t.workspace_id
   and mi.id = t.source_meeting_item_id
  where t.workspace_id = p_workspace_id
    and mi.meeting_id = p_meeting_id;

  if jsonb_array_length(p_task_guards) <> v_task_count then
    raise exception using errcode = 'P0001', message = 'incomplete-task-guards';
  end if;

  for v_task in
    select t.id
    from public.sd_tasks t
    join public.sd_meeting_items mi
      on mi.workspace_id = t.workspace_id
     and mi.id = t.source_meeting_item_id
    where t.workspace_id = p_workspace_id
      and mi.meeting_id = p_meeting_id
    order by t.id
  loop
    select count(*) into v_guard_count
    from jsonb_array_elements(p_task_guards) guard(value)
    where guard.value ->> 'taskId' = v_task.id;
    select guard.value into v_guard
    from jsonb_array_elements(p_task_guards) guard(value)
    where guard.value ->> 'taskId' = v_task.id
    limit 1;

    if v_guard_count <> 1
       or jsonb_typeof(v_guard) <> 'object'
       or (v_guard - array[
         'taskId', 'baseVersion', 'leaseKey', 'ownerSession', 'fencingToken'
       ]) <> '{}'::jsonb
       or jsonb_typeof(v_guard -> 'taskId') <> 'string'
       or jsonb_typeof(v_guard -> 'baseVersion') <> 'number'
       or jsonb_typeof(v_guard -> 'leaseKey') <> 'string'
       or jsonb_typeof(v_guard -> 'ownerSession') <> 'string'
       or jsonb_typeof(v_guard -> 'fencingToken') <> 'number'
       or v_guard ->> 'leaseKey' <> 'task:' || v_task.id then
      raise exception using errcode = 'P0001', message = 'invalid-task-guard';
    end if;

    perform public.sd_assert_live_lease(
      p_workspace_id,
      v_guard ->> 'leaseKey',
      (v_guard ->> 'ownerSession')::uuid,
      (v_guard ->> 'fencingToken')::bigint
    );

    select t.version into v_version
    from public.sd_tasks t
    where t.workspace_id = p_workspace_id
      and t.id = v_task.id
    for update;

    if v_version <> (v_guard ->> 'baseVersion')::bigint then
      raise exception using errcode = 'P0001', message = 'task-version-conflict';
    end if;
  end loop;
end;
$$;

-- Extend the existing lease command with the exact meeting aggregate key.
create or replace function public.claim_ship_dynamics_entity_lease(
  p_workspace_id uuid,
  p_lease_key text,
  p_entity_type text,
  p_entity_id text,
  p_owner_session uuid,
  p_ttl_seconds integer default 75
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_lease public.sd_edit_leases%rowtype;
begin
  if v_actor is null or public.sd_membership_role(p_workspace_id) is null then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  if p_owner_session is null then
    raise exception using errcode = 'P0001', message = 'invalid-owner-session';
  end if;

  if p_entity_type = 'task' then
    if p_lease_key <> 'task:' || p_entity_id
       or not public.sd_can_edit_task(p_workspace_id, p_entity_id) then
      raise exception using errcode = 'P0001', message = 'not-authorized';
    end if;
  elsif p_entity_type = 'task-create' then
    if p_lease_key <> 'task-create:' || p_entity_id
       or not public.sd_can_create_task_for_vessel(p_workspace_id, p_entity_id) then
      raise exception using errcode = 'P0001', message = 'not-authorized';
    end if;
  elsif p_entity_type = 'vessel' then
    if p_lease_key <> 'vessel:' || p_entity_id
       or not public.sd_can_edit_vessel(p_workspace_id, p_entity_id) then
      raise exception using errcode = 'P0001', message = 'not-authorized';
    end if;
  elsif p_entity_type = 'meeting' then
    if p_lease_key <> 'meeting:' || p_entity_id
       or not public.sd_can_manage_meetings(p_workspace_id) then
      raise exception using errcode = 'P0001', message = 'not-authorized';
    end if;
  else
    raise exception using errcode = 'P0001', message = 'unsupported-entity-type';
  end if;

  insert into public.sd_edit_leases(
    workspace_id, lease_key, entity_type, entity_id,
    owner_id, owner_session, fencing_token, expires_at, updated_at
  ) values (
    p_workspace_id, p_lease_key, p_entity_type, p_entity_id,
    v_actor, p_owner_session, 1,
    v_now + make_interval(secs => least(greatest(p_ttl_seconds, 30), 300)), v_now
  )
  on conflict (workspace_id, lease_key) do update
    set entity_type = excluded.entity_type,
        entity_id = excluded.entity_id,
        owner_id = excluded.owner_id,
        owner_session = excluded.owner_session,
        fencing_token = case
          when public.sd_edit_leases.owner_id = excluded.owner_id
           and public.sd_edit_leases.owner_session = excluded.owner_session
           and public.sd_edit_leases.expires_at > v_now
          then public.sd_edit_leases.fencing_token
          else public.sd_edit_leases.fencing_token + 1
        end,
        expires_at = excluded.expires_at,
        updated_at = v_now
    where public.sd_edit_leases.expires_at is null
       or public.sd_edit_leases.expires_at <= v_now
       or (
         public.sd_edit_leases.owner_id = excluded.owner_id
         and public.sd_edit_leases.owner_session = excluded.owner_session
       )
  returning * into v_lease;

  if v_lease.workspace_id is null then
    select * into v_lease
    from public.sd_edit_leases l
    where l.workspace_id = p_workspace_id and l.lease_key = p_lease_key;
    return jsonb_build_object(
      'ok', false,
      'leaseKey', p_lease_key,
      'expiresAt', v_lease.expires_at
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'leaseKey', v_lease.lease_key,
    'ownerSession', v_lease.owner_session,
    'fencingToken', v_lease.fencing_token,
    'expiresAt', v_lease.expires_at
  );
end;
$$;

create or replace function public.command_ship_dynamics_create_meeting(
  p_operation_id uuid,
  p_workspace_id uuid,
  p_meeting_id text,
  p_fencing_token bigint,
  p_lease_key text,
  p_owner_session uuid,
  p_scope_mode text,
  p_subject text,
  p_status text,
  p_meeting_date date,
  p_vessel_ids text[],
  p_vessel_type_scopes text[],
  p_departments text[],
  p_participant_user_ids uuid[],
  p_tracking_user_ids uuid[],
  p_responsible_user_ids uuid[],
  p_reason text,
  p_resolution text,
  p_expected_date date,
  p_completed_date date,
  p_priority text,
  p_is_abnormal boolean,
  p_is_internal_control boolean,
  p_include_in_morning boolean,
  p_items jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_request jsonb;
  v_result jsonb;
  v_operation public.sd_operations%rowtype;
  v_item record;
  v_category text;
  v_task_id text;
  v_task_versions jsonb := '{}'::jsonb;
  v_error text;
begin
  if v_actor is null or not public.sd_can_manage_meetings(p_workspace_id) then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  if p_operation_id is null
     or btrim(coalesce(p_meeting_id, '')) = ''
     or p_lease_key <> 'meeting:' || p_meeting_id then
    raise exception using errcode = 'P0001', message = 'invalid-command-identity';
  end if;

  v_request := jsonb_build_object(
    'meetingId', p_meeting_id,
    'leaseKey', p_lease_key,
    'ownerSession', p_owner_session,
    'fencingToken', p_fencing_token,
    'scopeMode', p_scope_mode,
    'subject', p_subject,
    'status', p_status,
    'meetingDate', p_meeting_date,
    'vesselIds', p_vessel_ids,
    'vesselTypeScopes', p_vessel_type_scopes,
    'departments', p_departments,
    'participantUserIds', p_participant_user_ids,
    'trackingUserIds', p_tracking_user_ids,
    'responsibleUserIds', p_responsible_user_ids,
    'reason', p_reason,
    'resolution', p_resolution,
    'expectedDate', p_expected_date,
    'completedDate', p_completed_date,
    'priority', p_priority,
    'isAbnormal', p_is_abnormal,
    'isInternalControl', p_is_internal_control,
    'includeInMorning', p_include_in_morning,
    'items', p_items
  );

  perform pg_advisory_xact_lock(
    hashtextextended(p_workspace_id::text || ':' || p_operation_id::text, 0)
  );
  select * into v_operation
  from public.sd_operations o
  where o.workspace_id = p_workspace_id
    and o.operation_id = p_operation_id
  for update;
  if found then
    if v_operation.actor_id <> v_actor
       or v_operation.command <> 'create_meeting'
       or v_operation.target_key <> 'meeting:' || p_meeting_id
       or v_operation.request_payload <> v_request then
      raise exception using errcode = 'P0001', message = 'operation-mismatch';
    end if;
    if v_operation.status = 'committed' then
      return v_operation.result || jsonb_build_object('replayed', true);
    end if;
    return jsonb_build_object(
      'status', 'rejected',
      'replayed', true,
      'errorCode', v_operation.error_code
    );
  end if;

  begin
    perform public.sd_validate_meeting_payload(
      p_workspace_id, p_scope_mode, p_subject, p_status, p_meeting_date,
      p_vessel_ids, p_vessel_type_scopes, p_departments,
      p_participant_user_ids, p_tracking_user_ids, p_responsible_user_ids,
      p_reason, p_completed_date, p_priority, p_items
    );
    perform public.sd_assert_live_lease(
      p_workspace_id, p_lease_key, p_owner_session, p_fencing_token
    );

    if exists (
      select 1
      from public.sd_meetings m
      where m.workspace_id = p_workspace_id and m.id = p_meeting_id
    ) then
      raise exception using errcode = 'P0001', message = 'entity-exists';
    end if;

    perform 1
    from public.sd_vessels v
    where v.workspace_id = p_workspace_id
      and v.id = any(p_vessel_ids)
    order by v.id
    for share;

    insert into public.sd_meetings(
      workspace_id, id, scope_mode, subject, status, meeting_date,
      reason, resolution, expected_date, completed_date, completed_by,
      priority, is_abnormal, is_internal_control, include_in_morning,
      latest_status, version, created_by, updated_by
    ) values (
      p_workspace_id, p_meeting_id, p_scope_mode, btrim(p_subject), p_status,
      p_meeting_date, p_reason, coalesce(p_resolution, ''), p_expected_date,
      p_completed_date, case when p_completed_date is null then null else v_actor end,
      p_priority, coalesce(p_is_abnormal, false) or coalesce(p_is_internal_control, false),
      coalesce(p_is_internal_control, false), coalesce(p_include_in_morning, false),
      p_status, 1, v_actor, v_actor
    );

    insert into public.sd_meeting_vessels(workspace_id, meeting_id, vessel_id)
    select p_workspace_id, p_meeting_id, value
    from unnest(p_vessel_ids) value;

    insert into public.sd_meeting_type_scopes(workspace_id, meeting_id, ship_type)
    select p_workspace_id, p_meeting_id, value
    from unnest(coalesce(p_vessel_type_scopes, '{}'::text[])) value;

    insert into public.sd_meeting_departments(workspace_id, meeting_id, department)
    select p_workspace_id, p_meeting_id, value
    from unnest(p_departments) value;

    insert into public.sd_meeting_participants(
      workspace_id, meeting_id, user_id, participant_kind
    )
    select p_workspace_id, p_meeting_id, value, 'participant'
    from unnest(p_participant_user_ids) value
    union all
    select p_workspace_id, p_meeting_id, value, 'tracking'
    from unnest(p_tracking_user_ids) value
    union all
    select p_workspace_id, p_meeting_id, value, 'responsible'
    from unnest(coalesce(p_responsible_user_ids, '{}'::uuid[])) value;

    for v_item in
      select value as item, ordinality::integer as ordinal
      from jsonb_array_elements(p_items) with ordinality
      order by ordinality
    loop
      insert into public.sd_meeting_items(
        workspace_id, id, meeting_id, description, distribute_to_vessels,
        ordinal, is_active, created_by, updated_by
      ) values (
        p_workspace_id, v_item.item ->> 'id', p_meeting_id,
        btrim(v_item.item ->> 'description'),
        (v_item.item ->> 'distributeToVessels')::boolean,
        v_item.ordinal, true, v_actor, v_actor
      );

      for v_category in
        select category #>> '{}'
        from jsonb_array_elements(v_item.item -> 'categories') category
      loop
        insert into public.sd_meeting_item_categories(
          workspace_id, meeting_item_id, category
        ) values (p_workspace_id, v_item.item ->> 'id', v_category);
      end loop;

      v_task_id := 'meeting-task:' || p_meeting_id || ':' || (v_item.item ->> 'id');
      if exists (
        select 1 from public.sd_tasks t
        where t.workspace_id = p_workspace_id and t.id = v_task_id
      ) then
        raise exception using errcode = 'P0001', message = 'generated-task-id-conflict';
      end if;

      insert into public.sd_tasks(
        workspace_id, id, description, status, priority, source_kind,
        attention_dimension, source_meeting_item_id, is_internal_control,
        is_abnormal, is_aware, is_closed, expected_date, report_date,
        version, created_by, updated_by
      ) values (
        p_workspace_id, v_task_id, btrim(v_item.item ->> 'description'),
        coalesce(nullif(btrim(p_resolution), ''), 'Pending execution'),
        p_priority, 'meeting', 'meeting', v_item.item ->> 'id',
        coalesce(p_is_internal_control, false),
        coalesce(p_is_abnormal, false) or coalesce(p_is_internal_control, false),
        true, false, p_expected_date, current_date, 1, v_actor, v_actor
      );

      insert into public.sd_task_vessels(
        workspace_id, task_id, vessel_id, is_active_scope,
        status, is_closed, version, updated_by
      )
      select
        p_workspace_id, v_task_id, vessel_id, true,
        coalesce(nullif(btrim(p_resolution), ''), 'Pending execution'),
        false, 1, v_actor
      from unnest(p_vessel_ids) vessel_id;

      insert into public.sd_task_categories(workspace_id, task_id, category, ordinal)
      select p_workspace_id, v_task_id, value #>> '{}', ordinal - 1
      from jsonb_array_elements(v_item.item -> 'categories')
        with ordinality as category(value, ordinal);

      insert into public.sd_task_departments(workspace_id, task_id, department, ordinal)
      select p_workspace_id, v_task_id, department, ordinal - 1
      from unnest(p_departments) with ordinality as departments(department, ordinal);

      insert into public.sd_task_owners(workspace_id, task_id, owner_id, ordinal)
      select p_workspace_id, v_task_id, user_id, ordinal - 1
      from unnest(p_tracking_user_ids) with ordinality as owners(user_id, ordinal);

      insert into public.sd_task_status_events(
        workspace_id, id, task_id, status, actor_id
      ) values (
        p_workspace_id, gen_random_uuid(), v_task_id,
        coalesce(nullif(btrim(p_resolution), ''), 'Pending execution'), v_actor
      );

      v_task_versions := v_task_versions
        || jsonb_build_object(v_task_id, 1);
    end loop;

    insert into public.sd_meeting_status_events(
      workspace_id, id, meeting_id, status, actor_id
    ) values (p_workspace_id, gen_random_uuid(), p_meeting_id, p_status, v_actor);

    v_result := jsonb_build_object(
      'status', 'committed',
      'replayed', false,
      'entityType', 'meeting',
      'entityId', p_meeting_id,
      'version', 1,
      'taskVersions', v_task_versions
    );

    insert into public.sd_operations(
      workspace_id, operation_id, actor_id, command, target_key,
      request_payload, request_hash, base_versions, lease_provenance,
      status, result
    ) values (
      p_workspace_id, p_operation_id, v_actor, 'create_meeting',
      'meeting:' || p_meeting_id, v_request, md5(v_request::text),
      '{}'::jsonb,
      jsonb_build_object(
        'leaseKey', p_lease_key,
        'ownerSession', p_owner_session,
        'fencingToken', p_fencing_token
      ),
      'committed', v_result
    );

    insert into public.sd_audit_events(
      workspace_id, id, actor_id, command, entity_type, entity_id, detail
    ) values (
      p_workspace_id, p_operation_id, v_actor, 'create_meeting',
      'meeting', p_meeting_id,
      jsonb_build_object(
        'version', 1,
        'itemCount', jsonb_array_length(p_items),
        'taskIds', (
          select coalesce(jsonb_agg(key order by key), '[]'::jsonb)
          from jsonb_object_keys(v_task_versions) key
        )
      )
    );
  exception when others then
    v_error := sqlerrm;
    if sqlstate not in ('P0001', '23503', '23505', '23514', '22P02') then
      raise;
    end if;
    if sqlstate = '23503' then v_error := 'invalid-reference'; end if;
    if sqlstate = '23505' then v_error := 'entity-conflict'; end if;
    if sqlstate = '23514' then v_error := 'invalid-meeting'; end if;
    if sqlstate = '22P02' then v_error := 'invalid-command-value'; end if;

    insert into public.sd_operations(
      workspace_id, operation_id, actor_id, command, target_key,
      request_payload, request_hash, base_versions, lease_provenance,
      status, error_code
    ) values (
      p_workspace_id, p_operation_id, v_actor, 'create_meeting',
      'meeting:' || p_meeting_id, v_request, md5(v_request::text),
      '{}'::jsonb,
      jsonb_build_object(
        'leaseKey', p_lease_key,
        'ownerSession', p_owner_session,
        'fencingToken', p_fencing_token
      ),
      'rejected', v_error
    );
    return jsonb_build_object(
      'status', 'rejected',
      'replayed', false,
      'errorCode', v_error
    );
  end;

  return v_result;
end;
$$;

create or replace function public.command_ship_dynamics_update_meeting(
  p_operation_id uuid,
  p_workspace_id uuid,
  p_meeting_id text,
  p_base_version bigint,
  p_fencing_token bigint,
  p_lease_key text,
  p_owner_session uuid,
  p_scope_mode text,
  p_subject text,
  p_status text,
  p_meeting_date date,
  p_vessel_ids text[],
  p_vessel_type_scopes text[],
  p_departments text[],
  p_participant_user_ids uuid[],
  p_tracking_user_ids uuid[],
  p_responsible_user_ids uuid[],
  p_reason text,
  p_resolution text,
  p_expected_date date,
  p_completed_date date,
  p_priority text,
  p_is_abnormal boolean,
  p_is_internal_control boolean,
  p_include_in_morning boolean,
  p_items jsonb,
  p_task_guards jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_request jsonb;
  v_result jsonb;
  v_operation public.sd_operations%rowtype;
  v_meeting public.sd_meetings%rowtype;
  v_task public.sd_tasks%rowtype;
  v_item record;
  v_item_json jsonb;
  v_category text;
  v_task_id text;
  v_task_versions jsonb := '{}'::jsonb;
  v_changed boolean;
  v_closed boolean;
  v_previous_status text;
  v_error text;
begin
  if v_actor is null or not public.sd_can_manage_meetings(p_workspace_id) then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  if p_operation_id is null
     or btrim(coalesce(p_meeting_id, '')) = ''
     or p_lease_key <> 'meeting:' || p_meeting_id then
    raise exception using errcode = 'P0001', message = 'invalid-command-identity';
  end if;

  v_request := jsonb_build_object(
    'meetingId', p_meeting_id,
    'baseVersion', p_base_version,
    'leaseKey', p_lease_key,
    'ownerSession', p_owner_session,
    'fencingToken', p_fencing_token,
    'scopeMode', p_scope_mode,
    'subject', p_subject,
    'status', p_status,
    'meetingDate', p_meeting_date,
    'vesselIds', p_vessel_ids,
    'vesselTypeScopes', p_vessel_type_scopes,
    'departments', p_departments,
    'participantUserIds', p_participant_user_ids,
    'trackingUserIds', p_tracking_user_ids,
    'responsibleUserIds', p_responsible_user_ids,
    'reason', p_reason,
    'resolution', p_resolution,
    'expectedDate', p_expected_date,
    'completedDate', p_completed_date,
    'priority', p_priority,
    'isAbnormal', p_is_abnormal,
    'isInternalControl', p_is_internal_control,
    'includeInMorning', p_include_in_morning,
    'items', p_items,
    'taskGuards', p_task_guards
  );

  perform pg_advisory_xact_lock(
    hashtextextended(p_workspace_id::text || ':' || p_operation_id::text, 0)
  );
  select * into v_operation
  from public.sd_operations o
  where o.workspace_id = p_workspace_id
    and o.operation_id = p_operation_id
  for update;
  if found then
    if v_operation.actor_id <> v_actor
       or v_operation.command <> 'update_meeting'
       or v_operation.target_key <> 'meeting:' || p_meeting_id
       or v_operation.request_payload <> v_request then
      raise exception using errcode = 'P0001', message = 'operation-mismatch';
    end if;
    if v_operation.status = 'committed' then
      return v_operation.result || jsonb_build_object('replayed', true);
    end if;
    return jsonb_build_object(
      'status', 'rejected',
      'replayed', true,
      'errorCode', v_operation.error_code
    );
  end if;

  begin
    perform public.sd_validate_meeting_payload(
      p_workspace_id, p_scope_mode, p_subject, p_status, p_meeting_date,
      p_vessel_ids, p_vessel_type_scopes, p_departments,
      p_participant_user_ids, p_tracking_user_ids, p_responsible_user_ids,
      p_reason, p_completed_date, p_priority, p_items
    );
    perform public.sd_assert_live_lease(
      p_workspace_id, p_lease_key, p_owner_session, p_fencing_token
    );

    select * into v_meeting
    from public.sd_meetings m
    where m.workspace_id = p_workspace_id
      and m.id = p_meeting_id
      and m.deleted_at is null
    for update;
    if not found or v_meeting.version <> p_base_version then
      raise exception using errcode = 'P0001', message = 'version-conflict';
    end if;
    v_previous_status := v_meeting.status;

    perform public.sd_assert_meeting_task_guards(
      p_workspace_id, p_meeting_id, p_task_guards
    );

    if exists (
      select 1
      from public.sd_tasks t
      join public.sd_meeting_items mi
        on mi.workspace_id = t.workspace_id
       and mi.id = t.source_meeting_item_id
      where t.workspace_id = p_workspace_id
        and mi.meeting_id = p_meeting_id
      group by t.source_meeting_item_id
      having count(*) <> 1
    ) then
      raise exception using errcode = 'P0001', message = 'ambiguous-meeting-task-link';
    end if;

    if exists (
      select 1
      from jsonb_array_elements(p_items) requested(item)
      join public.sd_meeting_items existing
        on existing.workspace_id = p_workspace_id
       and existing.id = requested.item ->> 'id'
      where existing.meeting_id <> p_meeting_id
         or not existing.is_active
    ) then
      raise exception using errcode = 'P0001', message = 'meeting-item-id-retired-or-conflicting';
    end if;

    perform 1
    from public.sd_vessels v
    where v.workspace_id = p_workspace_id
      and v.id = any(p_vessel_ids)
    order by v.id
    for share;

    for v_task in
      select t.*
      from public.sd_tasks t
      join public.sd_meeting_items mi
        on mi.workspace_id = t.workspace_id
       and mi.id = t.source_meeting_item_id
      where t.workspace_id = p_workspace_id
        and mi.meeting_id = p_meeting_id
      order by t.id
    loop
      select requested.item into v_item_json
      from jsonb_array_elements(p_items) requested(item)
      where requested.item ->> 'id' = v_task.source_meeting_item_id;

      if v_item_json is null then
        if not v_task.is_closed then
          update public.sd_tasks t
          set status = 'Archived: meeting item removed',
              is_closed = true,
              closed_date = current_date,
              closed_by = v_actor,
              version = t.version + 1,
              updated_at = clock_timestamp(),
              updated_by = v_actor
          where t.workspace_id = p_workspace_id and t.id = v_task.id
          returning t.version into v_task.version;

          insert into public.sd_task_status_events(
            workspace_id, id, task_id, status, actor_id
          ) values (
            p_workspace_id, gen_random_uuid(), v_task.id,
            'Archived: meeting item removed', v_actor
          );
        else
          insert into public.sd_task_status_events(
            workspace_id, id, task_id, status, actor_id
          ) values (
            p_workspace_id, gen_random_uuid(), v_task.id, v_task.status, v_actor
          );
        end if;

        update public.sd_task_vessels tv
        set is_active_scope = false,
            version = tv.version + 1,
            updated_at = clock_timestamp(),
            updated_by = v_actor
        where tv.workspace_id = p_workspace_id
          and tv.task_id = v_task.id
          and tv.is_active_scope;

        v_task_versions := v_task_versions
          || jsonb_build_object(v_task.id, v_task.version);
        continue;
      end if;

      select v_task.is_closed or exists (
        select 1
        from public.sd_task_vessels tv
        where tv.workspace_id = p_workspace_id
          and tv.task_id = v_task.id
          and tv.is_active_scope
          and tv.is_closed
      ) into v_closed;

      select
        v_task.description is distinct from btrim(v_item_json ->> 'description')
        or v_task.priority is distinct from p_priority
        or v_task.is_internal_control is distinct from coalesce(p_is_internal_control, false)
        or v_task.is_abnormal is distinct from (
          coalesce(p_is_abnormal, false) or coalesce(p_is_internal_control, false)
        )
        or v_task.expected_date is distinct from p_expected_date
        or exists (
          select 1
          from public.sd_meeting_items mi
          where mi.workspace_id = p_workspace_id
            and mi.id = v_task.source_meeting_item_id
            and mi.distribute_to_vessels is distinct from
              (v_item_json ->> 'distributeToVessels')::boolean
        )
        or exists (
          select category
          from public.sd_task_categories tc
          where tc.workspace_id = p_workspace_id and tc.task_id = v_task.id
          except
          select category #>> '{}'
          from jsonb_array_elements(v_item_json -> 'categories') category
        )
        or exists (
          select category #>> '{}'
          from jsonb_array_elements(v_item_json -> 'categories') category
          except
          select category
          from public.sd_task_categories tc
          where tc.workspace_id = p_workspace_id and tc.task_id = v_task.id
        )
        or exists (
          select department
          from public.sd_task_departments td
          where td.workspace_id = p_workspace_id and td.task_id = v_task.id
          except
          select value from unnest(p_departments) value
        )
        or exists (
          select value from unnest(p_departments) value
          except
          select department
          from public.sd_task_departments td
          where td.workspace_id = p_workspace_id and td.task_id = v_task.id
        )
        or exists (
          select owner_id
          from public.sd_task_owners owner_row
          where owner_row.workspace_id = p_workspace_id
            and owner_row.task_id = v_task.id
          except
          select value from unnest(p_tracking_user_ids) value
        )
        or exists (
          select value from unnest(p_tracking_user_ids) value
          except
          select owner_id
          from public.sd_task_owners owner_row
          where owner_row.workspace_id = p_workspace_id
            and owner_row.task_id = v_task.id
        )
        or exists (
          select vessel_id
          from public.sd_task_vessels tv
          where tv.workspace_id = p_workspace_id
            and tv.task_id = v_task.id
            and tv.is_active_scope
          except
          select value from unnest(p_vessel_ids) value
        )
        or exists (
          select value from unnest(p_vessel_ids) value
          except
          select vessel_id
          from public.sd_task_vessels tv
          where tv.workspace_id = p_workspace_id
            and tv.task_id = v_task.id
            and tv.is_active_scope
        )
      into v_changed;

      if v_closed and v_changed then
        raise exception using errcode = 'P0001', message = 'closed-linked-task-conflict';
      end if;

      if not v_closed and v_changed then
        update public.sd_tasks t
        set description = btrim(v_item_json ->> 'description'),
            priority = p_priority,
            is_internal_control = coalesce(p_is_internal_control, false),
            is_abnormal = coalesce(p_is_abnormal, false)
              or coalesce(p_is_internal_control, false),
            expected_date = p_expected_date,
            version = t.version + 1,
            updated_at = clock_timestamp(),
            updated_by = v_actor
        where t.workspace_id = p_workspace_id and t.id = v_task.id
        returning t.version into v_task.version;

        update public.sd_task_vessels tv
        set is_active_scope = false,
            version = tv.version + 1,
            updated_at = clock_timestamp(),
            updated_by = v_actor
        where tv.workspace_id = p_workspace_id
          and tv.task_id = v_task.id
          and tv.is_active_scope
          and tv.vessel_id <> all(p_vessel_ids);

        if exists (
          select 1
          from public.sd_task_vessels tv
          where tv.workspace_id = p_workspace_id
            and tv.task_id = v_task.id
            and tv.vessel_id = any(p_vessel_ids)
            and not tv.is_active_scope
            and tv.is_closed
        ) then
          raise exception using errcode = 'P0001', message = 'closed-linked-task-conflict';
        end if;

        insert into public.sd_task_vessels(
          workspace_id, task_id, vessel_id, is_active_scope,
          status, is_closed, version, updated_by
        )
        select
          p_workspace_id, v_task.id, vessel_id, true,
          v_task.status, false, 1, v_actor
        from unnest(p_vessel_ids) vessel_id
        on conflict (workspace_id, task_id, vessel_id) do update
          set is_active_scope = true,
              version = public.sd_task_vessels.version + 1,
              updated_at = clock_timestamp(),
              updated_by = v_actor
          where not public.sd_task_vessels.is_active_scope;

        delete from public.sd_task_categories tc
        where tc.workspace_id = p_workspace_id and tc.task_id = v_task.id;
        insert into public.sd_task_categories(workspace_id, task_id, category, ordinal)
        select p_workspace_id, v_task.id, value #>> '{}', ordinal - 1
        from jsonb_array_elements(v_item_json -> 'categories')
          with ordinality as category(value, ordinal);

        delete from public.sd_task_departments td
        where td.workspace_id = p_workspace_id and td.task_id = v_task.id;
        insert into public.sd_task_departments(workspace_id, task_id, department, ordinal)
        select p_workspace_id, v_task.id, department, ordinal - 1
        from unnest(p_departments) with ordinality as departments(department, ordinal);

        delete from public.sd_task_owners owner_row
        where owner_row.workspace_id = p_workspace_id
          and owner_row.task_id = v_task.id;
        insert into public.sd_task_owners(workspace_id, task_id, owner_id, ordinal)
        select p_workspace_id, v_task.id, user_id, ordinal - 1
        from unnest(p_tracking_user_ids) with ordinality as owners(user_id, ordinal);
      end if;

      v_task_versions := v_task_versions
        || jsonb_build_object(v_task.id, v_task.version);
    end loop;

    update public.sd_meeting_items mi
    set is_active = false,
        updated_at = clock_timestamp(),
        updated_by = v_actor
    where mi.workspace_id = p_workspace_id
      and mi.meeting_id = p_meeting_id
      and mi.is_active;

    for v_item in
      select value as item, ordinality::integer as ordinal
      from jsonb_array_elements(p_items) with ordinality
      order by ordinality
    loop
      insert into public.sd_meeting_items(
        workspace_id, id, meeting_id, description, distribute_to_vessels,
        ordinal, is_active, created_by, updated_by
      ) values (
        p_workspace_id, v_item.item ->> 'id', p_meeting_id,
        btrim(v_item.item ->> 'description'),
        (v_item.item ->> 'distributeToVessels')::boolean,
        v_item.ordinal, true, v_actor, v_actor
      )
      on conflict (workspace_id, id) do update
        set description = excluded.description,
            distribute_to_vessels = excluded.distribute_to_vessels,
            ordinal = excluded.ordinal,
            is_active = true,
            updated_at = clock_timestamp(),
            updated_by = v_actor
        where public.sd_meeting_items.meeting_id = p_meeting_id;

      delete from public.sd_meeting_item_categories mic
      where mic.workspace_id = p_workspace_id
        and mic.meeting_item_id = v_item.item ->> 'id';
      for v_category in
        select category #>> '{}'
        from jsonb_array_elements(v_item.item -> 'categories') category
      loop
        insert into public.sd_meeting_item_categories(
          workspace_id, meeting_item_id, category
        ) values (p_workspace_id, v_item.item ->> 'id', v_category);
      end loop;

      if not exists (
        select 1
        from public.sd_tasks t
        where t.workspace_id = p_workspace_id
          and t.source_meeting_item_id = v_item.item ->> 'id'
      ) then
        v_task_id := 'meeting-task:' || p_meeting_id || ':' || (v_item.item ->> 'id');
        if exists (
          select 1 from public.sd_tasks t
          where t.workspace_id = p_workspace_id and t.id = v_task_id
        ) then
          raise exception using errcode = 'P0001', message = 'generated-task-id-conflict';
        end if;

        insert into public.sd_tasks(
          workspace_id, id, description, status, priority, source_kind,
          attention_dimension, source_meeting_item_id, is_internal_control,
          is_abnormal, is_aware, is_closed, expected_date, report_date,
          version, created_by, updated_by
        ) values (
          p_workspace_id, v_task_id, btrim(v_item.item ->> 'description'),
          coalesce(nullif(btrim(p_resolution), ''), 'Pending execution'),
          p_priority, 'meeting', 'meeting', v_item.item ->> 'id',
          coalesce(p_is_internal_control, false),
          coalesce(p_is_abnormal, false) or coalesce(p_is_internal_control, false),
          true, false, p_expected_date, current_date, 1, v_actor, v_actor
        );

        insert into public.sd_task_vessels(
          workspace_id, task_id, vessel_id, is_active_scope,
          status, is_closed, version, updated_by
        )
        select
          p_workspace_id, v_task_id, vessel_id, true,
          coalesce(nullif(btrim(p_resolution), ''), 'Pending execution'),
          false, 1, v_actor
        from unnest(p_vessel_ids) vessel_id;

        insert into public.sd_task_categories(workspace_id, task_id, category, ordinal)
        select p_workspace_id, v_task_id, value #>> '{}', ordinal - 1
        from jsonb_array_elements(v_item.item -> 'categories')
          with ordinality as category(value, ordinal);
        insert into public.sd_task_departments(workspace_id, task_id, department, ordinal)
        select p_workspace_id, v_task_id, department, ordinal - 1
        from unnest(p_departments) with ordinality as departments(department, ordinal);
        insert into public.sd_task_owners(workspace_id, task_id, owner_id, ordinal)
        select p_workspace_id, v_task_id, user_id, ordinal - 1
        from unnest(p_tracking_user_ids) with ordinality as owners(user_id, ordinal);
        insert into public.sd_task_status_events(
          workspace_id, id, task_id, status, actor_id
        ) values (
          p_workspace_id, gen_random_uuid(), v_task_id,
          coalesce(nullif(btrim(p_resolution), ''), 'Pending execution'), v_actor
        );

        v_task_versions := v_task_versions
          || jsonb_build_object(v_task_id, 1);
      end if;
    end loop;

    delete from public.sd_meeting_vessels mv
    where mv.workspace_id = p_workspace_id and mv.meeting_id = p_meeting_id;
    insert into public.sd_meeting_vessels(workspace_id, meeting_id, vessel_id)
    select p_workspace_id, p_meeting_id, value
    from unnest(p_vessel_ids) value;

    delete from public.sd_meeting_type_scopes mts
    where mts.workspace_id = p_workspace_id and mts.meeting_id = p_meeting_id;
    insert into public.sd_meeting_type_scopes(workspace_id, meeting_id, ship_type)
    select p_workspace_id, p_meeting_id, value
    from unnest(coalesce(p_vessel_type_scopes, '{}'::text[])) value;

    delete from public.sd_meeting_departments md
    where md.workspace_id = p_workspace_id and md.meeting_id = p_meeting_id;
    insert into public.sd_meeting_departments(workspace_id, meeting_id, department)
    select p_workspace_id, p_meeting_id, value
    from unnest(p_departments) value;

    delete from public.sd_meeting_participants mp
    where mp.workspace_id = p_workspace_id and mp.meeting_id = p_meeting_id;
    insert into public.sd_meeting_participants(
      workspace_id, meeting_id, user_id, participant_kind
    )
    select p_workspace_id, p_meeting_id, value, 'participant'
    from unnest(p_participant_user_ids) value
    union all
    select p_workspace_id, p_meeting_id, value, 'tracking'
    from unnest(p_tracking_user_ids) value
    union all
    select p_workspace_id, p_meeting_id, value, 'responsible'
    from unnest(coalesce(p_responsible_user_ids, '{}'::uuid[])) value;

    update public.sd_meetings m
    set scope_mode = p_scope_mode,
        subject = btrim(p_subject),
        status = p_status,
        meeting_date = p_meeting_date,
        reason = p_reason,
        resolution = coalesce(p_resolution, ''),
        expected_date = p_expected_date,
        completed_date = p_completed_date,
        completed_by = case when p_completed_date is null then null else v_actor end,
        priority = p_priority,
        is_abnormal = coalesce(p_is_abnormal, false)
          or coalesce(p_is_internal_control, false),
        is_internal_control = coalesce(p_is_internal_control, false),
        include_in_morning = coalesce(p_include_in_morning, false),
        latest_status = p_status,
        version = m.version + 1,
        updated_at = clock_timestamp(),
        updated_by = v_actor
    where m.workspace_id = p_workspace_id
      and m.id = p_meeting_id
      and m.version = p_base_version
    returning * into v_meeting;
    if not found then
      raise exception using errcode = 'P0001', message = 'version-conflict';
    end if;

    if v_previous_status is distinct from p_status then
      insert into public.sd_meeting_status_events(
        workspace_id, id, meeting_id, status, actor_id
      ) values (p_workspace_id, gen_random_uuid(), p_meeting_id, p_status, v_actor);
    end if;

    v_result := jsonb_build_object(
      'status', 'committed',
      'replayed', false,
      'entityType', 'meeting',
      'entityId', p_meeting_id,
      'version', v_meeting.version,
      'taskVersions', v_task_versions
    );

    insert into public.sd_operations(
      workspace_id, operation_id, actor_id, command, target_key,
      request_payload, request_hash, base_versions, lease_provenance,
      status, result
    ) values (
      p_workspace_id, p_operation_id, v_actor, 'update_meeting',
      'meeting:' || p_meeting_id, v_request, md5(v_request::text),
      jsonb_build_object('meeting', p_base_version, 'taskGuards', p_task_guards),
      jsonb_build_object(
        'meeting', jsonb_build_object(
          'leaseKey', p_lease_key,
          'ownerSession', p_owner_session,
          'fencingToken', p_fencing_token
        ),
        'tasks', p_task_guards
      ),
      'committed', v_result
    );

    insert into public.sd_audit_events(
      workspace_id, id, actor_id, command, entity_type, entity_id, detail
    ) values (
      p_workspace_id, p_operation_id, v_actor, 'update_meeting',
      'meeting', p_meeting_id,
      jsonb_build_object(
        'version', v_meeting.version,
        'taskVersions', v_task_versions,
        'activeItemCount', jsonb_array_length(p_items)
      )
    );
  exception when others then
    v_error := sqlerrm;
    if sqlstate not in ('P0001', '23503', '23505', '23514', '22P02') then
      raise;
    end if;
    if sqlstate = '23503' then v_error := 'invalid-reference'; end if;
    if sqlstate = '23505' then v_error := 'entity-conflict'; end if;
    if sqlstate = '23514' then v_error := 'invalid-meeting'; end if;
    if sqlstate = '22P02' then v_error := 'invalid-command-value'; end if;

    insert into public.sd_operations(
      workspace_id, operation_id, actor_id, command, target_key,
      request_payload, request_hash, base_versions, lease_provenance,
      status, error_code
    ) values (
      p_workspace_id, p_operation_id, v_actor, 'update_meeting',
      'meeting:' || p_meeting_id, v_request, md5(v_request::text),
      jsonb_build_object('meeting', p_base_version, 'taskGuards', p_task_guards),
      jsonb_build_object(
        'meeting', jsonb_build_object(
          'leaseKey', p_lease_key,
          'ownerSession', p_owner_session,
          'fencingToken', p_fencing_token
        ),
        'tasks', p_task_guards
      ),
      'rejected', v_error
    );
    return jsonb_build_object(
      'status', 'rejected',
      'replayed', false,
      'errorCode', v_error
    );
  end;

  return v_result;
end;
$$;

create or replace function public.command_ship_dynamics_delete_meeting(
  p_operation_id uuid,
  p_workspace_id uuid,
  p_meeting_id text,
  p_base_version bigint,
  p_fencing_token bigint,
  p_lease_key text,
  p_owner_session uuid,
  p_task_guards jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_request jsonb;
  v_result jsonb;
  v_operation public.sd_operations%rowtype;
  v_meeting public.sd_meetings%rowtype;
  v_task public.sd_tasks%rowtype;
  v_archived_count integer := 0;
  v_error text;
begin
  v_role := public.sd_membership_role(p_workspace_id);
  if v_actor is null
     or v_role not in ('owner', 'admin')
     or not public.sd_can_manage_meetings(p_workspace_id) then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  if p_operation_id is null
     or btrim(coalesce(p_meeting_id, '')) = ''
     or p_lease_key <> 'meeting:' || p_meeting_id then
    raise exception using errcode = 'P0001', message = 'invalid-command-identity';
  end if;

  v_request := jsonb_build_object(
    'meetingId', p_meeting_id,
    'baseVersion', p_base_version,
    'leaseKey', p_lease_key,
    'ownerSession', p_owner_session,
    'fencingToken', p_fencing_token,
    'taskGuards', p_task_guards
  );

  perform pg_advisory_xact_lock(
    hashtextextended(p_workspace_id::text || ':' || p_operation_id::text, 0)
  );
  select * into v_operation
  from public.sd_operations o
  where o.workspace_id = p_workspace_id
    and o.operation_id = p_operation_id
  for update;
  if found then
    if v_operation.actor_id <> v_actor
       or v_operation.command <> 'delete_meeting'
       or v_operation.target_key <> 'meeting:' || p_meeting_id
       or v_operation.request_payload <> v_request then
      raise exception using errcode = 'P0001', message = 'operation-mismatch';
    end if;
    if v_operation.status = 'committed' then
      return v_operation.result || jsonb_build_object('replayed', true);
    end if;
    return jsonb_build_object(
      'status', 'rejected',
      'replayed', true,
      'errorCode', v_operation.error_code
    );
  end if;

  begin
    perform public.sd_assert_live_lease(
      p_workspace_id, p_lease_key, p_owner_session, p_fencing_token
    );

    select * into v_meeting
    from public.sd_meetings m
    where m.workspace_id = p_workspace_id
      and m.id = p_meeting_id
      and m.deleted_at is null
    for update;
    if not found or v_meeting.version <> p_base_version then
      raise exception using errcode = 'P0001', message = 'version-conflict';
    end if;

    perform public.sd_assert_meeting_task_guards(
      p_workspace_id, p_meeting_id, p_task_guards
    );

    for v_task in
      select t.*
      from public.sd_tasks t
      join public.sd_meeting_items mi
        on mi.workspace_id = t.workspace_id
       and mi.id = t.source_meeting_item_id
      where t.workspace_id = p_workspace_id
        and mi.meeting_id = p_meeting_id
      order by t.id
    loop
      v_archived_count := v_archived_count + 1;
      if not v_task.is_closed then
        update public.sd_tasks t
        set status = 'Archived: meeting deleted',
            is_closed = true,
            closed_date = current_date,
            closed_by = v_actor,
            version = t.version + 1,
            updated_at = clock_timestamp(),
            updated_by = v_actor
        where t.workspace_id = p_workspace_id and t.id = v_task.id;

        insert into public.sd_task_status_events(
          workspace_id, id, task_id, status, actor_id
        ) values (
          p_workspace_id, gen_random_uuid(), v_task.id,
          'Archived: meeting deleted', v_actor
        );
      end if;

      update public.sd_task_vessels tv
      set is_active_scope = false,
          version = tv.version + 1,
          updated_at = clock_timestamp(),
          updated_by = v_actor
      where tv.workspace_id = p_workspace_id
        and tv.task_id = v_task.id
        and tv.is_active_scope;
    end loop;

    update public.sd_meeting_items mi
    set is_active = false,
        updated_at = clock_timestamp(),
        updated_by = v_actor
    where mi.workspace_id = p_workspace_id
      and mi.meeting_id = p_meeting_id
      and mi.is_active;

    update public.sd_meetings m
    set deleted_at = clock_timestamp(),
        deleted_by = v_actor,
        version = m.version + 1,
        updated_at = clock_timestamp(),
        updated_by = v_actor
    where m.workspace_id = p_workspace_id
      and m.id = p_meeting_id
      and m.version = p_base_version
      and m.deleted_at is null
    returning * into v_meeting;
    if not found then
      raise exception using errcode = 'P0001', message = 'version-conflict';
    end if;

    v_result := jsonb_build_object(
      'status', 'committed',
      'replayed', false,
      'entityType', 'meeting',
      'entityId', p_meeting_id,
      'version', v_meeting.version,
      'archivedTaskCount', v_archived_count
    );

    insert into public.sd_operations(
      workspace_id, operation_id, actor_id, command, target_key,
      request_payload, request_hash, base_versions, lease_provenance,
      status, result
    ) values (
      p_workspace_id, p_operation_id, v_actor, 'delete_meeting',
      'meeting:' || p_meeting_id, v_request, md5(v_request::text),
      jsonb_build_object('meeting', p_base_version, 'taskGuards', p_task_guards),
      jsonb_build_object(
        'meeting', jsonb_build_object(
          'leaseKey', p_lease_key,
          'ownerSession', p_owner_session,
          'fencingToken', p_fencing_token
        ),
        'tasks', p_task_guards
      ),
      'committed', v_result
    );

    insert into public.sd_audit_events(
      workspace_id, id, actor_id, command, entity_type, entity_id, detail
    ) values (
      p_workspace_id, p_operation_id, v_actor, 'delete_meeting',
      'meeting', p_meeting_id,
      jsonb_build_object(
        'version', v_meeting.version,
        'archivedTaskCount', v_archived_count
      )
    );
  exception when others then
    v_error := sqlerrm;
    if sqlstate not in ('P0001', '23503', '23505', '23514', '22P02') then
      raise;
    end if;
    if sqlstate = '23503' then v_error := 'invalid-reference'; end if;
    if sqlstate = '23505' then v_error := 'entity-conflict'; end if;
    if sqlstate = '23514' then v_error := 'invalid-meeting'; end if;
    if sqlstate = '22P02' then v_error := 'invalid-command-value'; end if;

    insert into public.sd_operations(
      workspace_id, operation_id, actor_id, command, target_key,
      request_payload, request_hash, base_versions, lease_provenance,
      status, error_code
    ) values (
      p_workspace_id, p_operation_id, v_actor, 'delete_meeting',
      'meeting:' || p_meeting_id, v_request, md5(v_request::text),
      jsonb_build_object('meeting', p_base_version, 'taskGuards', p_task_guards),
      jsonb_build_object(
        'meeting', jsonb_build_object(
          'leaseKey', p_lease_key,
          'ownerSession', p_owner_session,
          'fencingToken', p_fencing_token
        ),
        'tasks', p_task_guards
      ),
      'rejected', v_error
    );
    return jsonb_build_object(
      'status', 'rejected',
      'replayed', false,
      'errorCode', v_error
    );
  end;

  return v_result;
end;
$$;

revoke all on function public.sd_reject_immutable_history_change() from public;
revoke all on function public.sd_can_manage_meetings(uuid) from public;
revoke all on function public.sd_meeting_scope_is_valid(uuid, text) from public;
revoke all on function public.sd_can_read_meeting(uuid, text) from public;
revoke all on function public.sd_can_edit_meeting(uuid, text) from public;
revoke all on function public.sd_validate_meeting_payload(
  uuid, text, text, text, date, text[], text[], text[],
  uuid[], uuid[], uuid[], text, date, text, jsonb
) from public;
revoke all on function public.sd_assert_meeting_task_guards(
  uuid, text, jsonb
) from public;
revoke all on function public.command_ship_dynamics_create_meeting(
  uuid, uuid, text, bigint, text, uuid, text, text, text, date,
  text[], text[], text[], uuid[], uuid[], uuid[], text, text, date, date,
  text, boolean, boolean, boolean, jsonb
) from public;
revoke all on function public.command_ship_dynamics_update_meeting(
  uuid, uuid, text, bigint, bigint, text, uuid, text, text, text, date,
  text[], text[], text[], uuid[], uuid[], uuid[], text, text, date, date,
  text, boolean, boolean, boolean, jsonb, jsonb
) from public;
revoke all on function public.command_ship_dynamics_delete_meeting(
  uuid, uuid, text, bigint, bigint, text, uuid, jsonb
) from public;

grant execute on function public.sd_can_manage_meetings(uuid) to authenticated;
grant execute on function public.sd_can_read_meeting(uuid, text) to authenticated;
grant execute on function public.sd_can_edit_meeting(uuid, text) to authenticated;
grant execute on function public.sd_can_read_task(uuid, text) to authenticated;
grant execute on function public.claim_ship_dynamics_entity_lease(
  uuid, text, text, text, uuid, integer
) to authenticated;
grant execute on function public.command_ship_dynamics_create_meeting(
  uuid, uuid, text, bigint, text, uuid, text, text, text, date,
  text[], text[], text[], uuid[], uuid[], uuid[], text, text, date, date,
  text, boolean, boolean, boolean, jsonb
) to authenticated;
grant execute on function public.command_ship_dynamics_update_meeting(
  uuid, uuid, text, bigint, bigint, text, uuid, text, text, text, date,
  text[], text[], text[], uuid[], uuid[], uuid[], text, text, date, date,
  text, boolean, boolean, boolean, jsonb, jsonb
) to authenticated;
grant execute on function public.command_ship_dynamics_delete_meeting(
  uuid, uuid, text, bigint, bigint, text, uuid, jsonb
) to authenticated;

commit;
