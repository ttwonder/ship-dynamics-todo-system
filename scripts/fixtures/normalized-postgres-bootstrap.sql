\set ON_ERROR_STOP on

-- Local-only Supabase compatibility bootstrap. These objects are platform-owned
-- in hosted Supabase and deliberately do not belong in the product manifest.
do $bootstrap$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'anon') then
    create role anon nologin noinherit nobypassrls;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit nobypassrls;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$bootstrap$;

alter role anon nologin noinherit nobypassrls;
alter role authenticated nologin noinherit nobypassrls;
alter role service_role nologin noinherit bypassrls;

create schema if not exists auth;
create schema if not exists extensions;

grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema extensions to anon, authenticated, service_role;

create table if not exists auth.users (
  id uuid primary key,
  email text unique
);

create or replace function auth.uid()
returns uuid
language sql
stable
set search_path = pg_catalog
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant execute on function auth.uid() to anon, authenticated, service_role;
create extension if not exists pgcrypto with schema extensions;
create publication supabase_realtime;

do $preflight$
declare
  v_wal_level text;
begin
  select setting into v_wal_level
  from pg_catalog.pg_settings
  where name = 'wal_level';

  if v_wal_level is distinct from 'logical' then
    raise exception 'preflight-wal-level-not-logical:%', coalesce(v_wal_level, '<missing>');
  end if;
  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'anon' and not rolinherit and not rolbypassrls
  ) then raise exception 'preflight-anon-role-invalid'; end if;
  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'authenticated' and not rolinherit and not rolbypassrls
  ) then raise exception 'preflight-authenticated-role-invalid'; end if;
  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'service_role' and not rolinherit and rolbypassrls
  ) then raise exception 'preflight-service-role-invalid'; end if;
  if to_regclass('auth.users') is null then
    raise exception 'preflight-auth-users-missing';
  end if;
  if to_regprocedure('auth.uid()') is null then
    raise exception 'preflight-auth-uid-missing';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_extension e
    join pg_catalog.pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'pgcrypto' and n.nspname = 'extensions'
  ) then raise exception 'preflight-pgcrypto-schema-invalid'; end if;
  if to_regprocedure('extensions.crypt(text,text)') is null
     or to_regprocedure('extensions.gen_salt(text,integer)') is null then
    raise exception 'preflight-pgcrypto-functions-missing';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime'
  ) then raise exception 'preflight-realtime-publication-missing'; end if;
end
$preflight$;

select 'supabase_preflight=PASS wal_level=' || current_setting('wal_level');
