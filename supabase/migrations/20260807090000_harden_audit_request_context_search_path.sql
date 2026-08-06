begin;

alter function public.ship_dynamics_request_client_ip()
  set search_path = pg_catalog, public;

alter function public.ship_dynamics_request_country_code()
  set search_path = pg_catalog, public;

alter function public.stamp_ship_dynamics_audit_network_context()
  set search_path = pg_catalog, public;

alter function public.sd_stamp_audit_request_context()
  set search_path = pg_catalog, public;

commit;
