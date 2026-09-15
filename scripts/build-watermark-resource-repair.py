"""Build the one-function repair for installed 05; never connects to a DB.
Existing 05 stays immutable. Apply 08a only before ANY pause/cutover controls exist.
"""
from pathlib import Path
import hashlib,json,re,sys
ROOT=Path(__file__).resolve().parents[1]
BASE='supabase/development/20260911_business_quiescence.sql'
CONTROL_SOURCES=[BASE,'supabase/development/20260911_paused_record_legacy_transfer.sql','supabase/development/20260911_source_authority_publication.sql','supabase/development/20260914_source_authority_roundtrip.sql']
def sha(b):return hashlib.sha256(b).hexdigest()
sources={p:(ROOT/p).read_text(encoding='utf-8') for p in CONTROL_SOURCES}
match=re.search(r'create or replace function ship_dynamics_quiescence_private.watermark_v1\(p_workspace text,p_id uuid\).*?as \$\$(.*?)\$\$;',sources[BASE],re.S)
assert match
old=match.group(1)
old_line=next(s for s in old.splitlines() if 'execute format(' in s)
assert 'string_agg(to_jsonb(r)::text' in old_line and old.count(old_line)==1
new_line=r"""    -- compact_row_digest_v2: full row content, narrow deterministic sort.
    execute format('select count(*),md5(coalesce(string_agg(h,E''\n'' order by h collate "C"),'''')) from (select md5(to_jsonb(r)::text) h from public.%I r where %I::text=$1 offset 0) compact',t.table_name,t.key_column)"""
new=old.replace(old_line,new_line)
old_hash=sha(old.encode());new_hash=sha(new.encode())
tables=sorted(set(re.findall(r'create table if not exists (ship_dynamics_(?:quiescence|authority)_private\.[a-z0-9_]+)', '\n'.join(sources.values()))))
assert tables
empty=' AND\n '.join('NOT EXISTS(SELECT FROM '+t+')' for t in tables)
tables_body=re.search(r'create or replace function ship_dynamics_quiescence_private.tables_v1\(\).*?as \$\$(.*?)\$\$;',sources[BASE],re.S).group(1)
tables_hash=sha(tables_body.encode())
fn="'ship_dynamics_quiescence_private.watermark_v1(text,uuid)'::regprocedure"
normalized="replace(p.prosrc,E'\\r\\n',E'\\n')"
bodyhash="encode(sha256(convert_to("+normalized+",'UTF8')),'hex')"
installer=f'''-- Scoped hotfix for the installed 05 package, NOT a rerun of 05.
-- Changes one private helper only. No business row/permission/source changes.
-- Requires all pause/publication control tables empty across ALL workspaces.
-- If any prior transition exists, STOP; never rewrite its historical watermark.
BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL statement_timeout='45s';
SET LOCAL lock_timeout='5s';
DO $watermark_repair$
DECLARE p record; before_meta jsonb; after_meta jsonb; def text; actual text;
BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN
  RAISE EXCEPTION 'watermark-repair-admin-required';
 END IF;
 -- Same global ordering as pause and source operators; no business tuple locks.
 PERFORM pg_advisory_xact_lock(hashtext('record-maintenance-v1'),0);
 SELECT f.* INTO STRICT p FROM pg_proc f WHERE f.oid={fn};
 actual:={bodyhash};
 IF actual='{new_hash}' THEN RAISE EXCEPTION 'watermark-repair-already-installed-use-readback';END IF;
 IF actual<>'{old_hash}' THEN RAISE EXCEPTION 'watermark-repair-source-mismatch';END IF;
 IF NOT p.prosecdef OR p.provolatile<>'v' OR p.prorettype<>'jsonb'::regtype
 OR p.proargnames IS DISTINCT FROM ARRAY['p_workspace','p_id']::text[]
 OR NOT coalesce(p.proconfig @> ARRAY['search_path=pg_catalog, public'],false)
 OR p.proowner<>current_user::regrole
 OR has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE') THEN
  RAISE EXCEPTION 'watermark-repair-metadata-mismatch';
 END IF;
 IF (SELECT encode(sha256(convert_to(replace(prosrc,E'\\r\\n',E'\\n'),'UTF8')),'hex') FROM pg_proc WHERE oid='ship_dynamics_quiescence_private.tables_v1()'::regprocedure)<>'{tables_hash}' THEN
  RAISE EXCEPTION 'watermark-repair-table-contract-mismatch';
 END IF;
 IF NOT ({empty}) THEN
  RAISE EXCEPTION 'watermark-repair-unused-controls-required';
 END IF;
 SELECT to_jsonb(f)-'prosrc' INTO before_meta FROM pg_proc f WHERE oid=p.oid;
 def:=pg_get_functiondef(p.oid);
 IF (length(def)-length(replace(def,$old_line${old_line}$old_line$,'')))/length($old_line${old_line}$old_line$)<>1 THEN
  RAISE EXCEPTION 'watermark-repair-source-shape-mismatch';
 END IF;
 -- Preserve the original OID, owner, grants, settings and all other body bytes.
 EXECUTE replace(def,$old_line${old_line}$old_line$,$new_line${new_line}$new_line$);
 SELECT to_jsonb(f)-'prosrc' INTO after_meta FROM pg_proc f WHERE oid=p.oid;
 IF before_meta IS DISTINCT FROM after_meta THEN RAISE EXCEPTION 'watermark-repair-metadata-changed';END IF;
 SELECT f.* INTO STRICT p FROM pg_proc f WHERE oid=p.oid;
 IF {bodyhash}<>'{new_hash}' THEN RAISE EXCEPTION 'watermark-repair-result-mismatch';END IF;
END $watermark_repair$;
SELECT jsonb_build_object('kind','ship-watermark-repair-receipt-v1','status','helper-updated',
 'algorithm','md5-row-md5-list-v2','business_rows_written',false,'permissions_changed',false,
 'next','NEW_QUERY_08b_READBACK_BEFORE_RETRY_08') AS repair_receipt;
COMMIT;
'''
readback=f'''-- Independent READ ONLY check; never invokes watermark or sorts history.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='3s';
SELECT jsonb_build_object(
 'kind','ship-watermark-repair-readback-v1',
 'function_present',p.oid IS NOT NULL,
 'body_matches',coalesce({bodyhash}='{new_hash}',false),
 'body_sha256',{bodyhash},
 'security_definer',p.prosecdef,
 'argument_names_match',p.proargnames=ARRAY['p_workspace','p_id']::text[],
 'search_path',ARRAY(SELECT s FROM unnest(coalesce(p.proconfig,'{{}}'::text[])) s WHERE s LIKE 'search_path=%'),
 'browser_execute',has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE'),
 'service_role_execute',has_function_privilege('service_role',p.oid,'EXECUTE'),
 'controls_empty',({empty}),
 'legacy_frozen',(SELECT writes_frozen FROM public.sd_legacy_write_controls WHERE workspace_key='ship-dynamics-main'),
 'legacy',(SELECT jsonb_build_object('revision',revision,'hash',public.sd_legacy_jsonb_sha256(payload)) FROM public.ship_dynamics_app_state WHERE workspace_key='ship-dynamics-main'),
 'production_write',false,
 'next','VERIFY_RESULT_BEFORE_RETRY_08'
) AS watermark_readback
FROM (SELECT to_regprocedure('ship_dynamics_quiescence_private.watermark_v1(text,uuid)') oid) wanted
LEFT JOIN pg_proc p ON p.oid=wanted.oid;
ROLLBACK;
'''
outputs={'supabase/release/08a_fix_watermark_resource.sql':installer,'supabase/release/08b_verify_watermark_resource.sql':readback}
manifest={'kind':'ship-watermark-resource-repair-v1','predecessor_body_sha256':old_hash,'target_body_sha256':new_hash,'table_contract_sha256':tables_hash,'control_tables':tables,'sources':{p:sha(s.encode()) for p,s in sources.items()},'outputs':{p:sha(s.encode()) for p,s in outputs.items()},'production_write_executed':False}
outputs['supabase/release/watermark-repair-manifest.json']=json.dumps(manifest,indent=2)+'\n'
for p,s in outputs.items():
 if '--check' in sys.argv:assert (ROOT/p).read_bytes()==s.encode(),p
 else:(ROOT/p).write_bytes(s.encode())
print(json.dumps({'status':'PASS','check_only':'--check' in sys.argv,'old_body_sha256':old_hash,'new_body_sha256':new_hash,'control_tables':len(tables),'outputs':manifest['outputs']}))
