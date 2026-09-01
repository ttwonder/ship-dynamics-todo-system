begin;

create or replace function public.sd_itinerary_public_list_vessels(p_workspace_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_workspace uuid;
  v_result jsonb;
begin
  v_workspace := public.sd_itinerary_workspace_id(p_workspace_key);
  if v_workspace is null
     or not coalesce((select ship_portal_enabled from public.sd_itinerary_rollout where workspace_id = v_workspace), false)
  then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', v.id,
    'name', v.name,
    'shortName', v.short_name,
    'fullName', v.full_name
  ) order by v.name), '[]'::jsonb)
  into v_result
  from public.sd_vessels v
  where v.workspace_id = v_workspace and v.is_active;

  return v_result;
end;
$$;

revoke all on function public.sd_itinerary_public_list_vessels(text) from public;
grant execute on function public.sd_itinerary_public_list_vessels(text) to anon, authenticated;

comment on function public.sd_itinerary_public_list_vessels(text) is 'Returns all active vessels with the same name fields used by the main dashboard when the public Itinerary portal is enabled.';

commit;
