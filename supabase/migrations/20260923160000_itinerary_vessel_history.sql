-- Additive, read-only history projection. Does not modify reports/documents/leases.
-- Install before the matching frontend; existing report RPCs remain unchanged.
begin;

create or replace function public.sd_itinerary_record_report_vessel_history_v1(
  p_workspace_key text,
  p_actor_user_id text,
  p_vessel_id text default null,
  p_page integer default 1,
  p_business_date date default null,
  p_report_id bigint default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor jsonb := public.sd_itinerary_record_actor_v1(p_workspace_key, p_actor_user_id);
  v_workspace uuid := nullif(v_actor ->> 'workspaceId', '')::uuid;
  v_options jsonb;
  v_needle jsonb;
  v_report public.sd_itinerary_daily_reports%rowtype;
  v_vessel jsonb;
  v_snapshot jsonb;
  v_rows integer;
  v_revision bigint;
  v_dates bigint;
  v_total bigint;
  v_page integer;
  v_page_count integer;
  v_found boolean;
  v_reports jsonb;
begin
  if v_workspace is null or coalesce(v_actor ->> 'role', '') not in ('owner','admin','operator','vessel') then
    return jsonb_build_object('ok',false,'error','FORBIDDEN');
  end if;
  if p_vessel_id is null then
    if p_business_date is not null or p_report_id is not null then
      return jsonb_build_object('ok',false,'error','INVALID_PAYLOAD');
    end if;
    -- Historical IDs/names, not today's active roster: renaming/deactivation must
    -- not make a retained snapshot disappear. Take each ID's latest saved name.
    with latest as (
      select distinct on (v.item ->> 'vesselId')
        v.item ->> 'vesselId' as vessel_id, v.item ->> 'vesselName' as vessel_name
      from public.sd_itinerary_daily_reports r
      cross join lateral jsonb_array_elements(r.snapshot -> 'vessels') as v(item)
      where r.workspace_id = v_workspace
      order by v.item ->> 'vesselId', r.business_date desc, r.generated_at desc, r.report_id desc
    )
    select coalesce(jsonb_agg(jsonb_build_object('vesselId',l.vessel_id,'vesselName',l.vessel_name)
      order by l.vessel_name,l.vessel_id),'[]'::jsonb) into v_options from latest l;
    return jsonb_build_object('ok',true,'vessels',v_options);
  end if;
  if btrim(p_vessel_id) = '' or p_page is null or p_page < 1
     or (p_report_id is not null and (p_report_id < 1 or p_business_date is not null)) then
    return jsonb_build_object('ok',false,'error','INVALID_PAYLOAD');
  end if;
  v_needle := jsonb_build_array(jsonb_build_object('vesselId',p_vessel_id));
  if p_report_id is not null then
    select r.* into v_report from public.sd_itinerary_daily_reports r
    where r.workspace_id=v_workspace and r.report_id=p_report_id
      and (r.snapshot -> 'vessels') @> v_needle;
    if not found then return jsonb_build_object('ok',false,'error','REPORT_NOT_FOUND'); end if;
    select v.item into strict v_vessel from jsonb_array_elements(v_report.snapshot -> 'vessels') v(item)
    where v.item ->> 'vesselId'=p_vessel_id;
    v_rows := jsonb_array_length(v_vessel -> 'rows');
    v_revision := coalesce((v_vessel ->> 'revision')::bigint,0);
    v_snapshot := jsonb_build_object('schemaVersion',1,'businessDate',v_report.business_date::text,
      'timezone',v_report.timezone,'generatedAt',v_report.generated_at,'vesselCount',1,
      'rowCount',v_rows,'sourceMaxRevision',v_revision,'vessels',jsonb_build_array(v_vessel));
    return jsonb_build_object('ok',true,'vesselId',p_vessel_id,'report',jsonb_build_object(
      'reportId',v_report.report_id::text,'businessDate',v_report.business_date::text,
      'timezone',v_report.timezone,'generatedAt',v_report.generated_at,'generatedBy',v_report.generated_by,
      'generatedByActorId',v_report.generated_by_actor_id,'vesselCount',1,'rowCount',v_rows,
      'sourceMaxRevision',v_revision,'logicalBytes',pg_column_size(v_snapshot),'snapshot',v_snapshot));
  end if;

  select count(distinct r.business_date),count(*) into v_dates,v_total
  from public.sd_itinerary_daily_reports r
  where r.workspace_id=v_workspace and (r.snapshot -> 'vessels') @> v_needle;
  v_page_count := greatest(1,ceil(v_dates::numeric/30)::integer);
  v_page := least(p_page,v_page_count);
  if p_business_date is not null then
    select exists(select 1 from public.sd_itinerary_daily_reports r
      where r.workspace_id=v_workspace and r.business_date=p_business_date
        and (r.snapshot -> 'vessels') @> v_needle) into v_found;
    if v_found then
      select (count(distinct r.business_date)/30)::integer+1 into v_page
      from public.sd_itinerary_daily_reports r
      where r.workspace_id=v_workspace and r.business_date>p_business_date
        and (r.snapshot -> 'vessels') @> v_needle;
    end if;
  end if;
  -- Select dates AFTER the vessel predicate, keeping all same-day snapshots.
  with page_dates as (
    select distinct r.business_date from public.sd_itinerary_daily_reports r
    where r.workspace_id=v_workspace and (r.snapshot -> 'vessels') @> v_needle
    order by r.business_date desc limit 30 offset (v_page-1)*30
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'reportId',r.report_id::text,'businessDate',r.business_date::text,'timezone',r.timezone,
    'generatedAt',r.generated_at,'generatedBy',r.generated_by,'generatedByActorId',r.generated_by_actor_id,
    'vesselCount',1,'vesselName',v.item ->> 'vesselName',
    'rowCount',jsonb_array_length(v.item -> 'rows'),
    'sourceMaxRevision',coalesce((v.item ->> 'revision')::bigint,0),
    'logicalBytes',pg_column_size(v.item)
  ) order by r.business_date desc,r.generated_at desc,r.report_id desc),'[]'::jsonb) into v_reports
  from public.sd_itinerary_daily_reports r join page_dates d on d.business_date=r.business_date
  cross join lateral jsonb_array_elements(r.snapshot -> 'vessels') v(item)
  where r.workspace_id=v_workspace and v.item ->> 'vesselId'=p_vessel_id;
  return jsonb_build_object('ok',true,'vesselId',p_vessel_id,'businessDate',p_business_date::text,
    'found',v_found,'page',v_page,'pageSize',30,'pageCount',v_page_count,'total',v_dates,
    'dateTotal',v_dates,'reportTotal',v_total,'reports',v_reports,
    'setToken',public.sd_itinerary_daily_report_set_token(v_workspace));
end;
$$;

revoke all on function public.sd_itinerary_record_report_vessel_history_v1(text,text,text,integer,date,bigint) from public;
grant execute on function public.sd_itinerary_record_report_vessel_history_v1(text,text,text,integer,date,bigint) to anon, authenticated;
notify pgrst, 'reload schema';
commit;
