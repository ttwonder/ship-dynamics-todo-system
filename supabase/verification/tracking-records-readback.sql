-- Read-only installation check. No business values, actor names or credentials.
-- Run separately after 20260924160000_tracking_records.sql; inspect every boolean.
begin read only;
select jsonb_build_object(
 'kind','tracking-records-readback-v1',
 'writer_has_collection',position('''trackingItems''' in pg_get_functiondef('public.apply_ship_dynamics_record_patch_v1(text,text,jsonb,text,text,jsonb,jsonb,jsonb)'::regprocedure))>0,
 'writer_has_validator',position('-- tracking_validate_v1' in pg_get_functiondef('public.apply_ship_dynamics_record_patch_v1(text,text,jsonb,text,text,jsonb,jsonb,jsonb)'::regprocedure))>0,
 'v1_shape_preserved',position('-- tracking_v1_shape' in pg_get_functiondef('public.read_ship_dynamics_record_scopes_v1(text,text,jsonb,jsonb)'::regprocedure))>0,
 'v2_present',to_regprocedure('public.read_ship_dynamics_record_scopes_v2(text,text,jsonb,jsonb,jsonb)') is not null,
 'v2_anon_matches_v1',has_function_privilege('anon','public.read_ship_dynamics_record_scopes_v2(text,text,jsonb,jsonb,jsonb)','EXECUTE')=has_function_privilege('anon','public.read_ship_dynamics_record_scopes_v1(text,text,jsonb,jsonb)','EXECUTE'),
 'v2_authenticated_matches_v1',has_function_privilege('authenticated','public.read_ship_dynamics_record_scopes_v2(text,text,jsonb,jsonb,jsonb)','EXECUTE')=has_function_privilege('authenticated','public.read_ship_dynamics_record_scopes_v1(text,text,jsonb,jsonb)','EXECUTE'),
 'validator_private',not has_function_privilege('anon','public.ship_dynamics_tracking_validate_v1(text,jsonb,text,jsonb,jsonb)','EXECUTE') and not has_function_privilege('authenticated','public.ship_dynamics_tracking_validate_v1(text,jsonb,text,jsonb,jsonb)','EXECUTE'),
 'lookup_private',not has_function_privilege('anon','public.ship_dynamics_tracking_after_v1(text,text,text,jsonb)','EXECUTE') and not has_function_privilege('authenticated','public.ship_dynamics_tracking_after_v1(text,text,text,jsonb)','EXECUTE'),
 'records_tables_private',not has_table_privilege('anon','public.ship_dynamics_records','SELECT,INSERT,UPDATE,DELETE') and not has_table_privilege('authenticated','public.ship_dynamics_records','SELECT,INSERT,UPDATE,DELETE')
) as tracking_readback;
commit;
