begin;

create table if not exists public.sd_task_dismissals (
  workspace_id uuid not null references public.sd_workspaces(id) on delete cascade,
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  item_kind text not null check (item_kind in ('task','internal-control')),
  item_id text not null,
  dismissed_at timestamptz not null default clock_timestamp(),
  dismissed_by uuid not null references auth.users(id),
  version bigint not null default 1 check (version >= 1),
  primary key (workspace_id, user_id, item_kind, item_id),
  unique (workspace_id, id),
  constraint sd_task_dismissals_identity_not_blank check (
    btrim(id) <> '' and btrim(item_id) <> ''
  )
);

create index if not exists sd_task_dismissals_user_idx
  on public.sd_task_dismissals(workspace_id,user_id,dismissed_at desc);

alter table public.sd_task_dismissals enable row level security;
revoke all on table public.sd_task_dismissals from anon, authenticated;
grant select on table public.sd_task_dismissals to authenticated;

create or replace function public.sd_reset_task_dismissal_on_owner_assignment()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
begin
  delete from public.sd_task_dismissals d
  where d.workspace_id=new.workspace_id
    and d.user_id=new.user_id
    and d.item_kind='task'
    and d.item_id=new.task_id;
  return new;
end;
$$;

drop trigger if exists sd_task_owner_reset_personal_dismissal on public.sd_task_owners;
create trigger sd_task_owner_reset_personal_dismissal
after insert on public.sd_task_owners
for each row execute function public.sd_reset_task_dismissal_on_owner_assignment();

create or replace function public.sd_reset_dismissals_on_vessel_assignment()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
begin
  if not new.is_active then return new; end if;
  if TG_OP='UPDATE' and old.is_active then return new; end if;
  delete from public.sd_task_dismissals d
  where d.workspace_id=new.workspace_id
    and d.user_id=new.user_id
    and (
      (d.item_kind='task' and exists(
        select 1 from public.sd_task_vessels tv
        where tv.workspace_id=new.workspace_id
          and tv.vessel_id=new.vessel_id
          and tv.task_id=d.item_id
          and tv.is_active_scope
      ))
      or
      (d.item_kind='internal-control' and exists(
        select 1 from public.sd_internal_cases c
        where c.workspace_id=new.workspace_id
          and c.vessel_id=new.vessel_id
          and c.id=d.item_id
          and not c.is_deleted
      ))
    );
  return new;
end;
$$;

drop trigger if exists sd_vessel_assignment_reset_personal_dismissals on public.sd_vessel_assignments;
create trigger sd_vessel_assignment_reset_personal_dismissals
after insert or update of is_active,vessel_id,user_id on public.sd_vessel_assignments
for each row execute function public.sd_reset_dismissals_on_vessel_assignment();

create or replace function public.sd_reset_dismissals_on_task_vessel_assignment()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
begin
  if not new.is_active_scope then return new; end if;
  if TG_OP='UPDATE' and old.is_active_scope then return new; end if;
  delete from public.sd_task_dismissals d
  where d.workspace_id=new.workspace_id
    and d.item_kind='task'
    and d.item_id=new.task_id
    and exists(
      select 1 from public.sd_vessel_assignments a
      where a.workspace_id=new.workspace_id
        and a.vessel_id=new.vessel_id
        and a.user_id=d.user_id
        and a.assignment_kind in ('manager','delegate')
        and a.is_active
    );
  return new;
end;
$$;

drop trigger if exists sd_task_vessel_reset_personal_dismissals on public.sd_task_vessels;
create trigger sd_task_vessel_reset_personal_dismissals
after insert or update of is_active_scope on public.sd_task_vessels
for each row execute function public.sd_reset_dismissals_on_task_vessel_assignment();

drop policy if exists sd_task_dismissals_read_own on public.sd_task_dismissals;
create policy sd_task_dismissals_read_own on public.sd_task_dismissals
  for select to authenticated
  using (
    user_id=auth.uid()
    and public.sd_membership_role(workspace_id) is not null
  );

create or replace function public.command_ship_dynamics_dismiss_work_center_items(
  p_operation_id uuid,
  p_workspace_id uuid,
  p_items jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path=pg_catalog,public
as $$
declare
  v_actor uuid:=auth.uid();
  v_item jsonb;
  v_kind text;
  v_item_id text;
  v_request jsonb;
  v_target_key text;
  v_replay jsonb;
  v_result jsonb;
begin
  if v_actor is null
     or public.sd_membership_role(p_workspace_id) is null
     or p_items is null
     or jsonb_typeof(p_items)<>'array'
     or jsonb_array_length(p_items)=0 then
    raise exception using errcode='P0001',message='not-authorized';
  end if;

  if (select count(*) from jsonb_array_elements(p_items))
     <> (select count(distinct (item->>'itemKind')||':'||(item->>'itemId')) from jsonb_array_elements(p_items) item) then
    raise exception using errcode='P0001',message='duplicate-dismissal-item';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    perform public.sd_core_assert_json_keys(
      v_item,
      array['itemKind','itemId'],
      'invalid-dismissal-item'
    );
    v_kind:=v_item->>'itemKind';
    v_item_id:=btrim(coalesce(v_item->>'itemId',''));
    if v_kind not in ('task','internal-control') or v_item_id='' then
      raise exception using errcode='P0001',message='invalid-dismissal-item';
    end if;
    if v_kind='task' and not public.sd_can_read_task(p_workspace_id,v_item_id) then
      raise exception using errcode='P0001',message='dismissal-target-unavailable';
    end if;
    if v_kind='internal-control' and not public.sd_can_read_internal_case(p_workspace_id,v_item_id) then
      raise exception using errcode='P0001',message='dismissal-target-unavailable';
    end if;
  end loop;

  v_request:=jsonb_build_object('items',p_items);
  v_target_key:='task-dismissals:'||v_actor::text||':'||md5(p_items::text);
  v_replay:=public.sd_core_operation_replay(
    p_operation_id,p_workspace_id,v_actor,
    'dismiss_work_center_items',v_target_key,v_request
  );
  if v_replay is not null then return v_replay; end if;

  for v_item in
    select value from jsonb_array_elements(p_items)
    order by value->>'itemKind',value->>'itemId'
  loop
    v_kind:=v_item->>'itemKind';
    v_item_id:=btrim(v_item->>'itemId');
    insert into public.sd_task_dismissals(
      workspace_id,id,user_id,item_kind,item_id,dismissed_at,dismissed_by,version
    ) values (
      p_workspace_id,
      'work-dismissal:'||v_actor::text||':'||v_kind||':'||md5(v_item_id),
      v_actor,v_kind,v_item_id,clock_timestamp(),v_actor,1
    )
    on conflict (workspace_id,user_id,item_kind,item_id) do nothing;
  end loop;

  v_result:=jsonb_build_object(
    'status','committed','replayed',false,
    'entityType','task-dismissals','count',jsonb_array_length(p_items)
  );
  perform public.sd_core_commit_operation(
    p_operation_id,p_workspace_id,v_actor,
    'dismiss_work_center_items',v_target_key,v_request,
    '{}'::jsonb,'{}'::jsonb,v_result
  );
  insert into public.sd_audit_events(
    workspace_id,id,actor_id,command,entity_type,entity_id,detail
  ) values (
    p_workspace_id,public.sd_core_event_id(p_operation_id,'audit'),
    v_actor,'dismiss_work_center_items','user',v_actor::text,
    jsonb_build_object('count',jsonb_array_length(p_items),'sharedDataDeleted',false)
  );
  return v_result;
end;
$$;

revoke all on function public.command_ship_dynamics_dismiss_work_center_items(uuid,uuid,jsonb) from public,anon;
grant execute on function public.command_ship_dynamics_dismiss_work_center_items(uuid,uuid,jsonb) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.sd_task_dismissals;
exception when duplicate_object then null;
end;
$$;

commit;
