-- DEVELOPMENT ONLY. Not part of an automatic migration manifest.
-- Additive read protocol; the existing AppData JSON remains authoritative in this stage.
-- No data migration, write RPC replacement, trigger changes, or new table grants.
begin;

create or replace function public.read_ship_dynamics_delta_v1(
  p_workspace_key text,
  p_base_revision integer default null,
  p_base_token text default null
) returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_current public.ship_dynamics_app_state%rowtype;
  v_base jsonb;
  v_token text;
  v_envelope jsonb;
  v_set jsonb := '{}'::jsonb;
  v_deleted jsonb := '[]'::jsonb;
  v_collections jsonb := '[]'::jsonb;
  v_key text;
  v_old jsonb;
  v_new jsonb;
  v_old_map jsonb;
  v_new_map jsonb;
  v_old_ids jsonb;
  v_new_ids jsonb;
  v_upserts jsonb;
  v_removed jsonb;
  v_change jsonb;
  v_record_arrays boolean;
  v_supported constant text[] := array[
    'users','vessels','tasks','internalControlCases','meetings',
    'agendaReports','taskDismissals','notifications','auditLogs'
  ];
begin
  -- STABLE reads use one statement snapshot: the response never mixes commits.
  select s.* into v_current
  from public.ship_dynamics_app_state as s
  where s.workspace_key = p_workspace_key;
  if not found then
    return jsonb_build_object('protocol','ship-dynamics-delta-v1','workspace_key',p_workspace_key,'status','missing');
  end if;
  v_token := md5(v_current.payload::text);
  v_envelope := jsonb_build_object(
    'protocol','ship-dynamics-delta-v1','workspace_key',p_workspace_key,
    'revision',v_current.revision,'payload_token',v_token
  );

  -- Identical confirmed read: return no data, even if the current revision history
  -- was pruned. The opaque token also fences legacy same-revision content changes.
  if p_base_revision = v_current.revision and p_base_token = v_token then
    return v_envelope || jsonb_build_object(
      'status','delta','base_revision',p_base_revision,'base_token',p_base_token,
      'root',jsonb_build_object('set','{}'::jsonb,'deleted','[]'::jsonb),'collections','[]'::jsonb
    );
  end if;
  if p_base_revision is not null and p_base_revision < v_current.revision then
    select r.payload into v_base
    from public.ship_dynamics_app_revisions as r
    where r.workspace_key = p_workspace_key and r.revision = p_base_revision;
  end if;
  if v_base is null or p_base_token is null or md5(v_base::text) <> p_base_token
     or jsonb_typeof(v_base) <> 'object' or jsonb_typeof(v_current.payload) <> 'object' then
    return v_envelope || jsonb_build_object('status','snapshot','payload',v_current.payload);
  end if;

  for v_key in
    select key from jsonb_object_keys(v_base) as old_keys(key)
    union
    select key from jsonb_object_keys(v_current.payload) as new_keys(key)
  loop
    v_old := v_base -> v_key;
    v_new := v_current.payload -> v_key;
    if v_old is not distinct from v_new then continue; end if;
    if not (v_current.payload ? v_key) then
      v_deleted := v_deleted || jsonb_build_array(v_key);
      continue;
    end if;
    v_record_arrays := false;
    if v_key = any(v_supported)
       and jsonb_typeof(v_old) = 'array' and jsonb_typeof(v_new) = 'array' then
      -- Legacy malformed/non-unique collections are retained exactly as whole
      -- values, never silently repaired or collapsed into a guessed ID map.
      select not exists (
        select 1 from (
          select e.value from jsonb_array_elements(v_old) as e(value)
          union all
          select e.value from jsonb_array_elements(v_new) as e(value)
        ) as rows
        where jsonb_typeof(rows.value) is distinct from 'object'
          or jsonb_typeof(rows.value -> 'id') is distinct from 'string'
          or rows.value ->> 'id' = ''
      ) and (
        select count(*) = count(distinct e.value ->> 'id') from jsonb_array_elements(v_old) as e(value)
      ) and (
        select count(*) = count(distinct e.value ->> 'id') from jsonb_array_elements(v_new) as e(value)
      ) into v_record_arrays;
    end if;
    if not v_record_arrays then
      v_set := v_set || jsonb_build_object(v_key,v_new);
      continue;
    end if;

    select coalesce(jsonb_object_agg(e.value ->> 'id',e.value),'{}'::jsonb),
           coalesce(jsonb_agg(e.value ->> 'id' order by e.ordinality),'[]'::jsonb)
      into v_old_map,v_old_ids from jsonb_array_elements(v_old) with ordinality as e(value,ordinality);
    select coalesce(jsonb_object_agg(e.value ->> 'id',e.value),'{}'::jsonb),
           coalesce(jsonb_agg(e.value ->> 'id' order by e.ordinality),'[]'::jsonb)
      into v_new_map,v_new_ids from jsonb_array_elements(v_new) with ordinality as e(value,ordinality);
    select coalesce(jsonb_agg(e.value order by e.key),'[]'::jsonb)
      into v_upserts from jsonb_each(v_new_map) as e(key,value)
      where v_old_map -> e.key is distinct from e.value;
    select coalesce(jsonb_agg(e.key order by e.key),'[]'::jsonb)
      into v_removed from jsonb_each(v_old_map) as e(key,value)
      where not (v_new_map ? e.key);
    v_change := jsonb_build_object('collection',v_key,'upserts',v_upserts,'deleted',v_removed);
    if v_old_ids is distinct from v_new_ids then
      v_change := v_change || jsonb_build_object('order',v_new_ids);
    end if;
    v_collections := v_collections || jsonb_build_array(v_change);
  end loop;
  return v_envelope || jsonb_build_object(
    'status','delta','base_revision',p_base_revision,'base_token',p_base_token,
    'root',jsonb_build_object('set',v_set,'deleted',v_deleted),'collections',v_collections
  );
end;
$$;

-- Reads retain existing table ACL/RLS. This routine does not elevate privileges.
revoke all on function public.read_ship_dynamics_delta_v1(text,integer,text) from public;
grant execute on function public.read_ship_dynamics_delta_v1(text,integer,text) to anon,authenticated;

commit;
