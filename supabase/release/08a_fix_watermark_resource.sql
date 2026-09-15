-- Scoped hotfix for the installed 05 package, NOT a rerun of 05.
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
 SELECT f.* INTO STRICT p FROM pg_proc f WHERE f.oid='ship_dynamics_quiescence_private.watermark_v1(text,uuid)'::regprocedure;
 actual:=encode(sha256(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8')),'hex');
 IF actual='ceca3c40bef08143552d168b3df5cdd947903eabee75841f1458dbfb692f95a7' THEN RAISE EXCEPTION 'watermark-repair-already-installed-use-readback';END IF;
 IF actual<>'4f938cef3106561703bd6bb0b09553a0b0459c6222c20fe423b0962f0ba9aff2' THEN RAISE EXCEPTION 'watermark-repair-source-mismatch';END IF;
 IF NOT p.prosecdef OR p.provolatile<>'v' OR p.prorettype<>'jsonb'::regtype
 OR p.proargnames IS DISTINCT FROM ARRAY['p_workspace','p_id']::text[]
 OR NOT coalesce(p.proconfig @> ARRAY['search_path=pg_catalog, public'],false)
 OR p.proowner<>current_user::regrole
 OR has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE') THEN
  RAISE EXCEPTION 'watermark-repair-metadata-mismatch';
 END IF;
 IF (SELECT encode(sha256(convert_to(replace(prosrc,E'\r\n',E'\n'),'UTF8')),'hex') FROM pg_proc WHERE oid='ship_dynamics_quiescence_private.tables_v1()'::regprocedure)<>'49b4c41955be879d3c1df20a7f34965cbd7dee36d421dcfde20ae199dddff4af' THEN
  RAISE EXCEPTION 'watermark-repair-table-contract-mismatch';
 END IF;
 IF NOT (NOT EXISTS(SELECT FROM ship_dynamics_authority_private.current_v1) AND
 NOT EXISTS(SELECT FROM ship_dynamics_authority_private.forward_row_context_v1) AND
 NOT EXISTS(SELECT FROM ship_dynamics_authority_private.forward_stages_v1) AND
 NOT EXISTS(SELECT FROM ship_dynamics_authority_private.receipts_v1) AND
 NOT EXISTS(SELECT FROM ship_dynamics_quiescence_private.stage_context_v1) AND
 NOT EXISTS(SELECT FROM ship_dynamics_quiescence_private.stages_v1) AND
 NOT EXISTS(SELECT FROM ship_dynamics_quiescence_private.transitions) AND
 NOT EXISTS(SELECT FROM ship_dynamics_quiescence_private.workspaces)) THEN
  RAISE EXCEPTION 'watermark-repair-unused-controls-required';
 END IF;
 SELECT to_jsonb(f)-'prosrc' INTO before_meta FROM pg_proc f WHERE oid=p.oid;
 def:=pg_get_functiondef(p.oid);
 IF (length(def)-length(replace(def,$old_line$   execute format('select count(*),md5(coalesce(string_agg(to_jsonb(r)::text,E''\n'' order by to_jsonb(r)::text),'''')) from public.%I r where %I::text=$1',t.table_name,t.key_column)$old_line$,'')))/length($old_line$   execute format('select count(*),md5(coalesce(string_agg(to_jsonb(r)::text,E''\n'' order by to_jsonb(r)::text),'''')) from public.%I r where %I::text=$1',t.table_name,t.key_column)$old_line$)<>1 THEN
  RAISE EXCEPTION 'watermark-repair-source-shape-mismatch';
 END IF;
 -- Preserve the original OID, owner, grants, settings and all other body bytes.
 EXECUTE replace(def,$old_line$   execute format('select count(*),md5(coalesce(string_agg(to_jsonb(r)::text,E''\n'' order by to_jsonb(r)::text),'''')) from public.%I r where %I::text=$1',t.table_name,t.key_column)$old_line$,$new_line$    -- compact_row_digest_v2: full row content, narrow deterministic sort.
    execute format('select count(*),md5(coalesce(string_agg(h,E''\n'' order by h collate "C"),'''')) from (select md5(to_jsonb(r)::text) h from public.%I r where %I::text=$1 offset 0) compact',t.table_name,t.key_column)$new_line$);
 SELECT to_jsonb(f)-'prosrc' INTO after_meta FROM pg_proc f WHERE oid=p.oid;
 IF before_meta IS DISTINCT FROM after_meta THEN RAISE EXCEPTION 'watermark-repair-metadata-changed';END IF;
 SELECT f.* INTO STRICT p FROM pg_proc f WHERE oid=p.oid;
 IF encode(sha256(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')<>'ceca3c40bef08143552d168b3df5cdd947903eabee75841f1458dbfb692f95a7' THEN RAISE EXCEPTION 'watermark-repair-result-mismatch';END IF;
END $watermark_repair$;
SELECT jsonb_build_object('kind','ship-watermark-repair-receipt-v1','status','helper-updated',
 'algorithm','md5-row-md5-list-v2','business_rows_written',false,'permissions_changed',false,
 'next','NEW_QUERY_08b_READBACK_BEFORE_RETRY_08') AS repair_receipt;
COMMIT;
