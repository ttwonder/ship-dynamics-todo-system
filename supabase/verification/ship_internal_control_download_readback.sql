-- READ ONLY. Exact installed body/ACL/column checks; no workspace data or secrets returned.
begin transaction read only;
with expected(signature,body_md5,is_public_api,volatility) as (values
 ('ship_dynamics_internal_control_private.note_download_v1(text,text,text,text,text,text,integer)','bda9570b4b09be03437f871ba21b1eb4',false,'v'),
 ('ship_dynamics_internal_control_private.attempts_limited_v1(text,text,text)','5bd8a6101eaf5ef8d33a2cc0d4745a22',false,'v'),
 ('ship_dynamics_internal_control_private.attempt_result_v1(text,text,text,boolean)','706db743cae2d8a19da3b39429db691e',false,'v'),
 ('ship_dynamics_internal_control_private.admin_user_v1(text,text)','898c14d579bdd32b720d705df18ff179',false,'v'),
 ('ship_dynamics_internal_control_private.admin_actor_v1(text,text,text)','ec5e41bb8b95fabc5d2d13c6fb16cf83',false,'v'),
 ('ship_dynamics_internal_control_private.active_vessel_v1(text,text)','d11c6995a576e97e034b9d9fc5e77fa4',false,'v'),
 ('public.issue_ship_dynamics_internal_control_admin_session_v1(text,text,text)','ad4fc61c1573def22395614ee7cc3b32',true,'v'),
 ('public.manage_ship_dynamics_internal_control_download_v1(text,text,text,text)','132c435d09574e5a14dd36596765ed0b',true,'v'),
 ('public.download_ship_dynamics_internal_control_v1(text,text,text)','c04257e46048b43b4bd658083c14c3de',true,'v')
), installed as (
 select e.*,p.oid,p.prosrc,p.prosecdef,p.provolatile,p.proconfig
 from expected e left join pg_proc p on p.oid=to_regprocedure(e.signature)
), checks(name,ok) as (
 select signature||': exact body, definer, volatility and path',
  oid is not null and md5(replace(replace(prosrc,E'\r\n',E'\n'),E'\r',E'\n'))=body_md5
  and prosecdef and provolatile::text=volatility and 'search_path=pg_catalog, public'=any(proconfig)
 from installed
 union all
 select signature||': exact browser execution',oid is not null
  and has_function_privilege('anon',oid,'EXECUTE')=is_public_api
  and has_function_privilege('authenticated',oid,'EXECUTE')=is_public_api
  and not has_function_privilege('service_role',oid,'EXECUTE')
 from installed
 union all
 select role_name||': private schema inaccessible',
  not has_schema_privilege(role_name,to_regnamespace('ship_dynamics_internal_control_private'),'USAGE')
 from (values('anon'),('authenticated'),('service_role')) roles(role_name)
 union all
 select role_name||': '||table_name||': '||privilege||' denied',
  to_regclass('ship_dynamics_internal_control_private.'||table_name) is not null
  and not has_table_privilege(role_name,to_regclass('ship_dynamics_internal_control_private.'||table_name),privilege)
 from (values('anon'),('authenticated'),('service_role')) roles(role_name)
 cross join (values('vessel_credentials'),('admin_sessions'),('access_logs'),('auth_attempts')) tables(table_name)
 cross join (values('SELECT'),('INSERT'),('UPDATE'),('DELETE')) privileges(privilege)
 union all
 select 'vessel_credentials: exact private columns',
  (select jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod)) order by a.attnum)
   from pg_attribute a where a.attrelid=to_regclass('ship_dynamics_internal_control_private.vessel_credentials')
    and a.attnum>0 and not a.attisdropped)=
   '[ ["workspace_key","text"],["vessel_id","text"],["secret_hash","text"],["changed_at","timestamp with time zone"],["changed_by","text"] ]'::jsonb
 union all
 select 'record source stays private / existing anonymous public projection remains callable',
  has_function_privilege('anon','public.read_ship_dynamics_internal_control_public_v1(text,text)','EXECUTE')
  and not has_table_privilege('anon','public.ship_dynamics_records','SELECT')
)
select case when bool_and(ok is true) then 'PASS' else 'FAIL' end result,
 count(*) checks,coalesce(jsonb_agg(name order by name) filter(where ok is not true),'[]'::jsonb) failed_checks
from checks;
commit;
