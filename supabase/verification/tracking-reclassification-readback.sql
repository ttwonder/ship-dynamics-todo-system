-- Read-only AFTER 20260928180000_tracking_reclassification.sql.
-- Expected hashes are derived from immutable migration SOURCE, not the target DB.
-- Normalize CRLF only. Catalog/ACL checks read no business data and mutate nothing.
begin read only;
with expected(signature,body_hash) as (values
 ('public.ship_dynamics_tracking_validate_v1(text,jsonb,text,jsonb,jsonb)','a9e4ddcf3e24ecd3b39181bec343f70f'),
 ('ship_dynamics_tracking_private.plan_v1(text,text,jsonb,jsonb,text,text,text,text)','6acaf632e93142adc7d5137341352ac1'),
 ('ship_dynamics_tracking_private.submit_v1(text,text,uuid,uuid,jsonb,boolean)','9b1efe1e226db0fe596be32a3221bab8'),
 ('ship_dynamics_tracking_private.request_kind_v1(text)','db224d273d95acd55dc14284ae1b2af5'),
 ('ship_dynamics_tracking_private.request_label_v1(text)','551f268ac78ec0ffe3e5d4b194a1b59d'),
 ('ship_dynamics_tracking_private.classification_value_v1(jsonb)','9d158b013a3a2804f72a3fce9e372987'),
 ('ship_dynamics_tracking_private.type_description_v1(text,jsonb,jsonb)','3830bb5ab2d9456e519a8f9988dcde4f'),
 ('ship_dynamics_tracking_private.reclassify_event_v1(jsonb,jsonb,text,text,text)','400bbf1fd76a331167d5065b2d7b82b0'),
 ('ship_dynamics_tracking_private.reclassify_link_v1(jsonb,jsonb,jsonb,jsonb)','6c7bfe2b15644896d338d83e7e43d57c'),
 ('ship_dynamics_tracking_private.read_v1(text,text)','ee5722007c0fcfb1dcb0e2fc9a837f2d'),
 ('ship_dynamics_tracking_private.groups_v1(text,text,jsonb,boolean)','e0193cc06b0882794e08b86e55c1bb0c'),
 ('ship_dynamics_tracking_private.lease_v1(text,text,uuid,uuid,text,jsonb)','bd9382e95dd5ee0768d14805bc06575a'),
 ('public.ship_dynamics_tracking_public_v1(text,text,uuid,uuid,text,jsonb)','d6f7b0a4c775198cef8d0e7f59492097'),
 ('public.read_ship_dynamics_tracking_statistics_public_v2(text,jsonb,jsonb)','5899b3d72fac5f013cefca5acf3c6563')
), installed as (
 select e.*,p.* from expected e left join pg_proc p on p.oid=to_regprocedure(e.signature)
), checks as (
 select 'exact-functions-and-preserved-read-lease-statistics' name,
 not exists(select 1 from installed where oid is null or md5(replace(prosrc,chr(13)||chr(10),chr(10)))<>body_hash) ok
 union all select 'private-functions-remain-invoker-and-denied',not exists(
  select 1 from installed p where (signature like 'ship_dynamics_tracking_private.%' or proname='ship_dynamics_tracking_validate_v1')
  and (oid is null or prosecdef or has_function_privilege('anon',oid,'EXECUTE') or has_function_privilege('authenticated',oid,'EXECUTE')
   or exists(select 1 from aclexplode(coalesce(proacl,acldefault('f',proowner))) a where a.privilege_type='EXECUTE' and a.grantee=0)))
 union all select 'private-schema-denied-to-browser',not has_schema_privilege('anon','ship_dynamics_tracking_private','USAGE')
  and not has_schema_privilege('authenticated','ship_dynamics_tracking_private','USAGE')
 union all select 'validator-stable-canonical-search-path',coalesce((select not prosecdef and provolatile='s'
  and proconfig=array['search_path=pg_catalog, public']::text[] and prorettype='text'::regtype
  from installed where proname='ship_dynamics_tracking_validate_v1'),false)
 union all select 'planners-volatile-and-canonical-search-path',not exists(select 1 from installed where proname in ('plan_v1','submit_v1')
  and (provolatile<>'v' or proconfig is distinct from array['search_path=pg_catalog, public']::text[] or prorettype<>'jsonb'::regtype))
 union all select 'pure-helpers-immutable-canonical-search-path',not exists(select 1 from installed where proname in ('request_kind_v1','request_label_v1','classification_value_v1','type_description_v1','reclassify_event_v1','reclassify_link_v1')
  and (provolatile<>'i' or proconfig is distinct from array['search_path=pg_catalog']::text[]))
 union all select 'public-endpoint-preserves-definer-and-browser-grants',coalesce((select prosecdef and provolatile='v'
  and proargnames=array['p_workspace_key','p_vessel_id','p_actor_key','p_holder','p_action','p_payload']::text[]
  and proconfig=array['search_path=pg_catalog, public']::text[] and prorettype='jsonb'::regtype
  and has_function_privilege('anon',oid,'EXECUTE') and has_function_privilege('authenticated',oid,'EXECUTE')
  and not exists(select 1 from aclexplode(coalesce(proacl,acldefault('f',proowner))) a where a.privilege_type='EXECUTE' and a.grantee not in (proowner,'anon'::regrole,'authenticated'::regrole))
  from installed where proname='ship_dynamics_tracking_public_v1'),false)
 union all select 'authority-and-bundle-tables-remain-private',not exists(
  select 1 from (values('public.ship_dynamics_records'),('public.ship_dynamics_record_collections'),('public.ship_dynamics_record_workspaces'),('ship_dynamics_tracking_private.bundles')) t(table_name)
  cross join (values('anon'),('authenticated')) r(role_name)
  where to_regclass(t.table_name) is null or has_table_privilege(r.role_name,to_regclass(t.table_name),'SELECT,INSERT,UPDATE,DELETE'))
 union all select 'existing-authority-prerequisites-present',
  to_regprocedure('public.ship_dynamics_record_commit_validated_v1(text,jsonb,jsonb,jsonb,text,text,jsonb)') is not null
  and to_regprocedure('public.apply_ship_dynamics_record_patch_v1(text,text,jsonb,text,text,jsonb,jsonb,jsonb)') is not null
  and to_regprocedure('ship_dynamics_internal_control_private.admit_v1(text)') is not null
  and to_regprocedure('public.ship_dynamics_tracking_date_v1(text)') is not null
)
select case when bool_and(coalesce(ok,false)) then 'PASS' else 'FAIL' end status,
 count(*) checks,coalesce(jsonb_agg(name order by name) filter(where not coalesce(ok,false)),'[]'::jsonb) failures
from checks;
commit;
