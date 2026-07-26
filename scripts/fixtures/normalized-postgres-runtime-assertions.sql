\set ON_ERROR_STOP on

do $runtime_assertions$
declare
  v_tables integer;
  v_publication_tables integer;
  v_unsafe_definers text[];
  v_anon_definer_execute text[];
  v_direct_dml jsonb;
  v_sensitive_grants jsonb;
  v_hash text;
begin
  select count(*) into v_tables
  from pg_catalog.pg_tables
  where schemaname = 'public' and tablename like 'sd\_%' escape '\';
  if v_tables <> 45 then
    raise exception 'public-table-count-invalid:%', v_tables;
  end if;

  select count(*) into v_publication_tables
  from pg_catalog.pg_publication_tables
  where pubname = 'supabase_realtime';
  if v_publication_tables <> 34 then
    raise exception 'publication-table-count-invalid:%', v_publication_tables;
  end if;

  select array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text)
  into v_unsafe_definers
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
    and not ('search_path=pg_catalog, public' = any(coalesce(p.proconfig, '{}'::text[])));
  if coalesce(cardinality(v_unsafe_definers), 0) <> 0 then
    raise exception 'security-definer-search-path-unpinned:%', v_unsafe_definers;
  end if;

  select array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text)
  into v_anon_definer_execute
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
    and pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE');
  if coalesce(cardinality(v_anon_definer_execute), 0) <> 0 then
    raise exception 'security-definer-execute-exposed:%', v_anon_definer_execute;
  end if;

  select coalesce(jsonb_agg(to_jsonb(g) order by g.grantee, g.table_name, g.privilege_type), '[]'::jsonb)
  into v_direct_dml
  from (
    select grantee, table_name, privilege_type
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name like 'sd\_%' escape '\'
      and grantee in ('anon', 'authenticated')
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
  ) g;
  if v_direct_dml <> '[]'::jsonb then
    raise exception 'browser-direct-dml-grants:%', v_direct_dml;
  end if;

  select coalesce(jsonb_agg(to_jsonb(g) order by g.grantee, g.table_name, g.privilege_type), '[]'::jsonb)
  into v_sensitive_grants
  from (
    select grantee, table_name, privilege_type
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in (
        'sd_public_site_gate', 'sd_login_options', 'sd_rate_limit_buckets',
        'sd_edit_leases', 'sd_operations', 'sd_operation_reservations',
        'sd_audit_events', 'sd_legacy_imports', 'sd_legacy_write_controls',
        'sd_migration_quarantine'
      )
      and grantee in ('PUBLIC', 'anon', 'authenticated')
  ) g;
  if v_sensitive_grants <> '[
    {"grantee":"authenticated","table_name":"sd_audit_events","privilege_type":"SELECT"},
    {"grantee":"authenticated","table_name":"sd_legacy_imports","privilege_type":"SELECT"},
    {"grantee":"authenticated","table_name":"sd_migration_quarantine","privilege_type":"SELECT"}
  ]'::jsonb then
    raise exception 'unexpected-sensitive-direct-grants:%', v_sensitive_grants;
  end if;

  v_hash := extensions.crypt('runtime-secret', extensions.gen_salt('bf', 4));
  if left(v_hash, 7) not in ('$2a$04$', '$2b$04$', '$2y$04$')
     or extensions.crypt('runtime-secret', v_hash) is distinct from v_hash
     or extensions.crypt('wrong-secret', v_hash) = v_hash then
    raise exception 'pgcrypto-bcrypt-runtime-invalid';
  end if;
end
$runtime_assertions$;

select 'pgcrypto=PASS extension_schema=extensions';
select 'public_table_count=' || count(*)
from pg_catalog.pg_tables
where schemaname = 'public' and tablename like 'sd\_%' escape '\';
select 'publication_table_count=' || count(*)
from pg_catalog.pg_publication_tables
where pubname = 'supabase_realtime';
select 'security_definer_search_path=PASS count=' || count(*)
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef;
select 'sensitive_direct_grants=' || coalesce(jsonb_agg(to_jsonb(g) order by g.grantee, g.table_name, g.privilege_type), '[]'::jsonb)::text
from (
  select grantee, table_name, privilege_type
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name in (
      'sd_public_site_gate', 'sd_login_options', 'sd_rate_limit_buckets',
      'sd_edit_leases', 'sd_operations', 'sd_operation_reservations',
      'sd_audit_events', 'sd_legacy_imports', 'sd_legacy_write_controls',
      'sd_migration_quarantine'
    )
    and grantee in ('PUBLIC', 'anon', 'authenticated')
) g;
