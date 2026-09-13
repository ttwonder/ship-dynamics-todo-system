-- DEVELOPMENT ONLY. Install after source authority publication, before client.
-- Website-readable projection, NOT the privileged operator getter. No writes,
-- locks, initialization, payloads, operator identities or control receipts.
begin;
create or replace function public.read_ship_dynamics_browser_authority_v1(p_workspace_key text)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare a ship_dynamics_authority_private.current_v1%rowtype;
 q ship_dynamics_quiescence_private.workspaces%rowtype;
 pause_state text; managed boolean;
begin
 if p_workspace_key is null or p_workspace_key='' or p_workspace_key<>btrim(p_workspace_key) then
  raise exception 'browser-authority-invalid-workspace' using errcode='22023';
 end if;
 -- Same website read boundary as existing workspace readers; exact key only.
 if not exists(select 1 from public.ship_dynamics_app_state where workspace_key=p_workspace_key)
  and not exists(select 1 from public.ship_dynamics_record_workspaces where workspace_key=p_workspace_key) then
  raise exception 'browser-authority-workspace-unavailable' using errcode='55000';
 end if;
 select * into a from ship_dynamics_authority_private.current_v1 where workspace_key=p_workspace_key;
 managed:=found;
 select * into q from ship_dynamics_quiescence_private.workspaces where workspace_key=p_workspace_key;
 if found then
  select state into pause_state from ship_dynamics_quiescence_private.transitions where workspace_key=p_workspace_key and transition_id=q.transition_id;
  if pause_state is null then raise exception 'browser-authority-invalid-control' using errcode='55000';end if;
 elsif exists(select 1 from ship_dynamics_quiescence_private.transitions where workspace_key=p_workspace_key) then
  raise exception 'browser-authority-invalid-control' using errcode='55000';
 else pause_state:='unmanaged';end if;
 if managed and (a.epoch<>1 or a.source<>'legacy' or q.workspace_id is distinct from a.workspace_id
  or not exists(select 1 from public.sd_workspaces where id=a.workspace_id and legacy_key=p_workspace_key)
  or (a.phase='published-paused' and pause_state<>'paused')) then
  raise exception 'browser-authority-invalid-binding' using errcode='55000';
 end if;
 return jsonb_build_object('workspace',p_workspace_key,'managed',managed,
  'source',case when managed then a.source else null end,'epoch',case when managed then a.epoch else 0 end,
  'pauseState',pause_state,'admitted',pause_state<>'paused' and (not managed or a.phase='resumed'));
end $$;
revoke all on function public.read_ship_dynamics_browser_authority_v1(text) from public;
grant execute on function public.read_ship_dynamics_browser_authority_v1(text) to anon,authenticated,service_role;
commit;
