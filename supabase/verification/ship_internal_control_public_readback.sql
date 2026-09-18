-- READ ONLY: ship-side internal-control additive API installation checks.
-- No business payload, roster, password, workspace key or credentials are returned.
-- Expected body fingerprints come from the committed migration, not this database.
begin transaction read only;
with expected(signature,body_md5,is_definer,volatility,path_setting,is_public_api) as (values
 ('ship_dynamics_internal_control_private.admit_v1(text)','29affefd46366b584083f74a6f6ad3e4',true,'v','search_path=pg_catalog, public',false),
 ('ship_dynamics_internal_control_private.request_v1(text,text,uuid,uuid,jsonb)','e24c4bb3944f6346570f4461d1bd9318',false,'i','search_path=pg_catalog',false),
 ('public.read_ship_dynamics_internal_control_public_v1(text,text)','83d7d7edcf77147763e68f2b61dc200e',true,'v','search_path=pg_catalog, public',true),
 ('public.read_ship_dynamics_internal_control_public_revision_v1(text)','4fb5d6b04e5ba3cebff006c8c0d0f9ce',true,'v','search_path=pg_catalog, public',true),
 ('public.get_ship_dynamics_internal_control_public_receipt_v1(text,text,uuid,uuid,jsonb)','affa5237278a50c2b7bbdc5725fd47b6',true,'v','search_path=pg_catalog, public',true),
 ('public.submit_ship_dynamics_internal_control_public_v1(text,text,uuid,uuid,jsonb)','2c38db83e9c8f967a4a3cfc77eeeb9e7',true,'v','search_path=pg_catalog, public',true)
), installed as (
 select e.*,p.oid,p.prosrc,p.prosecdef,p.provolatile,p.proconfig
 from expected e left join pg_proc p on p.oid=to_regprocedure(e.signature)
), checks(name,ok) as (
 select signature||': exact body, security and path',
  oid is not null and md5(replace(replace(prosrc,E'\r\n',E'\n'),E'\r',E'\n'))=body_md5
  and prosecdef=is_definer and provolatile::text=volatility and path_setting=any(proconfig)
 from installed
 union all
 select signature||': browser execute boundary',oid is not null
  and has_function_privilege('anon',oid,'EXECUTE')=is_public_api
  and has_function_privilege('authenticated',oid,'EXECUTE')=is_public_api
 from installed
 union all
 select 'private schema denied to browser roles',
  not has_schema_privilege('anon','ship_dynamics_internal_control_private','USAGE')
  and not has_schema_privilege('authenticated','ship_dynamics_internal_control_private','USAGE')
 union all
 select role_name||':'||table_name||':'||privilege||': direct access denied',
  not has_table_privilege(role_name,'public.'||table_name,privilege)
 from (values('anon'),('authenticated')) roles(role_name)
 cross join (values('ship_dynamics_records'),('ship_dynamics_record_workspaces'),('ship_dynamics_record_receipts')) tables(table_name)
 cross join (values('SELECT'),('INSERT'),('UPDATE'),('DELETE')) privileges(privilege)
 union all
 select 'private materializer remains private',
  not has_function_privilege('anon','public.ship_dynamics_record_commit_validated_v1(text,jsonb,jsonb,jsonb,text,text,jsonb)','EXECUTE')
  and not has_function_privilege('authenticated','public.ship_dynamics_record_commit_validated_v1(text,jsonb,jsonb,jsonb,text,text,jsonb)','EXECUTE')
)
select case when bool_and(ok is true) then 'PASS' else 'FAIL' end as result,
 count(*) as checks,
 coalesce(jsonb_agg(name order by name) filter(where ok is not true),'[]'::jsonb) as failed_checks
from checks;
commit;
