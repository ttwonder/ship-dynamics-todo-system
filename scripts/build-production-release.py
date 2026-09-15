"""Build the atomic additive installer; no database/network/credential access.
Sources remain the reviewed development files. Only their OUTER transactions are
removed. Extra release guards/ACL are explicit; no seed/import/cutover is run.
"""
from pathlib import Path
import argparse,hashlib,json,re,sys
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'supabase/release'
FILES=[
 'supabase/development/20260906_appdata_record_store.sql',
 'supabase/development/20260906_appdata_record_delta.sql',
 'supabase/development/20260909_task_member_protocol.sql',
 'supabase/development/20260911_vessel_manager_handover.sql',
 'supabase/development/20260908_appdata_record_scoped_read.sql',
 'supabase/development/20260906_itinerary_record_read.sql',
 'supabase/development/20260906_itinerary_record_write.sql',
 'supabase/development/20260906_itinerary_record_reports.sql',
 'supabase/development/20260906_appdata_record_data_management.sql',
 'supabase/development/20260906_record_daily_morning_scheduler.sql',
 'supabase/normalized-legacy-cutover.sql',
 'supabase/development/20260911_legacy_report_workspace_binding.sql',
 'supabase/development/20260911_business_quiescence.sql',
 'supabase/development/20260911_paused_record_legacy_transfer.sql',
 'supabase/development/20260911_source_authority_publication.sql',
 'supabase/development/20260912_browser_source_authority.sql',
 'supabase/development/20260914_source_authority_roundtrip.sql']
def digest(b):return hashlib.sha256(b).hexdigest()
def literal(s):return "'"+s.replace("'","''")+"'"
def signature(e):
 assert re.fullmatch(r'[a-z_0-9]+',e['name'])
 assert re.fullmatch(r'[a-z0-9_ ,\[\]]*',e['types'])
 return 'public.'+e['name']+'('+e['types']+')'
def unbox(text):
 # Standalone BEGIN;/COMMIT; only. PL/pgSQL BEGIN has no semicolon.
 a=list(re.finditer(r'^begin;[ \t]*$',text,re.I|re.M));b=list(re.finditer(r'^commit;[ \t]*$',text,re.I|re.M))
 assert len(a)==len(b) and len(a)<=1,'Unexpected component transaction layout'
 if a:
  assert a[0].start()<b[0].start()
  text=text[:b[0].start()]+text[b[0].end():]
  text=text[:a[0].start()]+text[a[0].end():]
 return text.strip()+'\n'
PREFIX="""-- SHIP DYNAMICS: ADDITIVE INSTALL ONLY. NOT CUTOVER / NOT A BACKUP.
-- Target workspace: ship-dynamics-main. Operator manually runs this exact file.
-- Brief schema maintenance: existing business rows are locked, not copied.
-- On any ERROR/timeout: STOP; use separate readback. Do not blindly retry.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='45s';
SET LOCAL work_mem='16MB';
SET LOCAL search_path=pg_catalog,public;
SELECT pg_advisory_xact_lock(hashtext('record-maintenance-v1'),0);
DO $release_preflight$
BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname=current_user AND rolbypassrls) THEN
  RAISE EXCEPTION 'release-admin-bypassrls-required';
 END IF;
 IF to_regclass('public.ship_dynamics_record_workspaces') IS NOT NULL THEN
  RAISE EXCEPTION 'release-records-already-present-use-readback';
 END IF;
 IF to_regclass('public.ship_dynamics_app_state') IS NULL OR to_regclass('public.sd_workspaces') IS NULL THEN
  RAISE EXCEPTION 'release-required-predecessor-missing';
 END IF;
 IF (SELECT count(*) FROM public.ship_dynamics_app_state WHERE workspace_key='ship-dynamics-main')<>1
 OR (SELECT count(*) FROM public.sd_workspaces WHERE legacy_key='ship-dynamics-main')<>1 THEN
  RAISE EXCEPTION 'release-exact-workspace-binding-required';
 END IF;
 IF has_schema_privilege('anon','public','CREATE') OR has_schema_privilege('authenticated','public','CREATE') THEN
  RAISE EXCEPTION 'release-public-schema-not-trusted';
 END IF;
END $release_preflight$;
CREATE TEMP TABLE release_existing_rows(relation regclass PRIMARY KEY,n bigint,stamp text) ON COMMIT DROP;
CREATE TEMP TABLE release_existing_functions ON COMMIT DROP AS
 SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public';
DO $release_pin$
DECLARE t record; n bigint; stamp text;
BEGIN
 FOR t IN SELECT c.oid,c.oid::regclass AS relation FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
 WHERE ns.nspname='public' AND c.relkind='r' AND c.relname ~ '^(ship_dynamics_|sd_)' ORDER BY c.oid LOOP
  EXECUTE format('LOCK TABLE %s IN SHARE ROW EXCLUSIVE MODE',t.relation);
  -- Physical row identities only: never sort/aggregate historical JSON payloads.
  EXECUTE format('SELECT count(*),md5(coalesce(string_agg(ctid::text||'':''||xmin::text,'','' ORDER BY ctid),'''')) FROM %s',t.relation) INTO n,stamp;
  INSERT INTO pg_temp.release_existing_rows VALUES(t.relation,n,stamp);
 END LOOP;
 IF (SELECT count(*) FROM pg_temp.release_existing_rows)<>58 THEN RAISE EXCEPTION 'release-predecessor-table-set-drift';END IF;
END $release_pin$;
"""
SUFFIX="""
-- Keep new implementation functions and data private. Original 27 browser APIs
-- retain their predecessor grants. Only the explicit new entrypoints below open.
DO $release_private$
DECLARE f record;t record;
BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname ~ '^(ship_dynamics_|sd_|read_ship_|get_ship_|apply_ship_|save_ship_|renew_ship_|release_ship_|prune_ship_|import_ship_|pause_ship_|resume_ship_|stage_ship_|publish_ship_)'
  AND NOT EXISTS(SELECT FROM pg_temp.release_existing_functions old WHERE old.oid=p.oid) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
 END LOOP;
 FOR t IN SELECT c.oid::regclass AS relation FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind='r' AND c.relname ~ '^(ship_dynamics_|sd_)'
  AND NOT EXISTS(SELECT FROM pg_temp.release_existing_rows old WHERE old.relation=c.oid) LOOP
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY',t.relation);
  EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC,anon,authenticated',t.relation);
 END LOOP;
END $release_private$;
"""
END="""
DO $release_unchanged$
DECLARE t record;n bigint;stamp text;
BEGIN
 FOR t IN SELECT * FROM pg_temp.release_existing_rows LOOP
  EXECUTE format('SELECT count(*),md5(coalesce(string_agg(ctid::text||'':''||xmin::text,'','' ORDER BY ctid),'''')) FROM %s',t.relation) INTO n,stamp;
  IF n IS DISTINCT FROM t.n OR stamp IS DISTINCT FROM t.stamp THEN
   RAISE EXCEPTION 'release-existing-business-rows-changed: %',t.relation;
  END IF;
 END LOOP;
 IF EXISTS(SELECT FROM public.ship_dynamics_record_workspaces) THEN RAISE EXCEPTION 'release-unexpected-record-import';END IF;
END $release_unchanged$;
NOTIFY pgrst,'reload schema';
COMMIT;
"""
def build():
 entries=json.loads((OUT/'record-release-api.json').read_text(encoding='utf-8'))
 assert len(entries)==52 and len({signature(e) for e in entries})==52
 new=[e for e in entries if not e['existing']];assert len(new)==25
 components=[];parts=[PREFIX]
 for name in FILES:
  raw=(ROOT/name).read_bytes();text=raw.decode('utf-8').replace('\r\n','\n')
  components.append({'path':name,'sha256':digest(text.encode('utf-8')),'representation':'UTF-8 LF (same bytes used by composer)'})
  parts.append('\n-- BEGIN COMPONENT: '+name+'\n'+unbox(text)+'-- END COMPONENT: '+name+'\n')
 parts.append(SUFFIX)
 for e in new:
  sig=signature(e)
  parts.append(f'ALTER FUNCTION {sig} SECURITY DEFINER;\nALTER FUNCTION {sig} SET search_path=pg_catalog,public,pg_temp;\nREVOKE ALL ON FUNCTION {sig} FROM PUBLIC;\nGRANT EXECUTE ON FUNCTION {sig} TO anon,authenticated;\n')
 # Verify exact name/type AND argument names: PostgREST named JSON routing matters.
 values=',\n'.join('('+literal(signature(e))+','+literal(e['args'])+')' for e in entries)
 parts.append("DO $release_api$ DECLARE e record; actual text; BEGIN FOR e IN SELECT * FROM (VALUES "+values+") v(sig,args) LOOP SELECT pg_get_function_identity_arguments(to_regprocedure(e.sig)) INTO actual; IF actual IS DISTINCT FROM e.args THEN RAISE EXCEPTION 'release-api-signature-drift: %',e.sig; END IF; IF NOT has_function_privilege('anon',e.sig,'EXECUTE') OR NOT has_function_privilege('authenticated',e.sig,'EXECUTE') THEN RAISE EXCEPTION 'release-api-grant-missing: %',e.sig;END IF;END LOOP;END $release_api$;\n")
 parts.append(END)
 install=''.join(parts)
 verify="""-- INDEPENDENT READBACK. Run in a NEW SQL Editor query after 05.
-- Read-only metadata and the current legacy revision/hash; never returns payload.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='3s';
WITH expected(signature,args) AS (VALUES
"""+values+"""
), apis AS (
 SELECT e.signature,to_regprocedure(e.signature) IS NOT NULL AS present,
 pg_get_function_identity_arguments(to_regprocedure(e.signature))=e.args AS argument_names_match,
 has_function_privilege('anon',to_regprocedure(e.signature),'EXECUTE') AS anon_execute,
 has_function_privilege('authenticated',to_regprocedure(e.signature),'EXECUTE') AS authenticated_execute,
 p.prosecdef AS security_definer,p.proconfig
 FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
), data_privileges AS (
 SELECT c.relname,c.relrowsecurity AS rls,
 has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') OR
 has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS browser_direct
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind='r' AND c.relname ~ '^ship_dynamics_record'
)
SELECT jsonb_build_object(
 'kind','ship-record-install-readback-v1',
 'api_count',(SELECT count(*) FROM apis),
 'api_missing_or_invalid',(SELECT coalesce(jsonb_agg(signature),'[]'::jsonb) FROM apis WHERE NOT coalesce(present AND argument_names_match AND anon_execute AND authenticated_execute,true)),
 'api_details',(SELECT jsonb_agg(to_jsonb(a) ORDER BY signature) FROM apis a),
 'record_tables',(SELECT jsonb_agg(to_jsonb(t) ORDER BY relname) FROM data_privileges t),
 'record_tables_private',(SELECT count(*)>0 AND bool_and(rls AND NOT browser_direct) FROM data_privileges),
 'legacy_current',(SELECT jsonb_build_object('revision',revision,'payload_sha256',encode(sha256(convert_to(payload::text,'UTF8')),'hex')) FROM public.ship_dynamics_app_state WHERE workspace_key='ship-dynamics-main'),
 'workspace_binding',(SELECT jsonb_build_object('id',id,'legacy_key',legacy_key) FROM public.sd_workspaces WHERE legacy_key='ship-dynamics-main'),
 'production_write',false,
 'next','INSTALL_READBACK_ONLY_NOT_CUTOVER_APPROVAL'
) AS install_readback;
ROLLBACK;
"""
 manifest={'kind':'ship-record-additive-release-v1','full_backup_required':False,'components':components,'api_contract_sha256':digest((OUT/'record-release-api.json').read_bytes()),'outputs':{'05_install_record_storage.sql':digest(install.encode()),'06_verify_record_storage.sql':digest(verify.encode())},'boundaries':['No seed, no import, no cutover, no deployment.','58 old table physical row vectors unchanged inside the atomic install.','Native provider emulation is not hosted PostgREST/Auth/Realtime proof.']}
 return {'05_install_record_storage.sql':install,'06_verify_record_storage.sql':verify,'record-release-manifest.json':json.dumps(manifest,indent=2)+'\n'}
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--check',action='store_true');args=p.parse_args()
 outputs=build();bad=[]
 for name,text in outputs.items():
  file=OUT/name
  if args.check:
   if not file.exists() or file.read_bytes()!=text.encode('utf-8'):bad.append(name)
  else:file.write_bytes(text.encode('utf-8'))
 print(json.dumps({'status':'FAIL' if bad else 'PASS','mismatches':bad,'outputs':{k:len(v.encode()) for k,v in outputs.items()}}))
 sys.exit(bool(bad))
