-- Forward-only display-metadata repair for the installed records-v1 lease RPC.
-- No business-row writes, source transition, permission change or reinstallation.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '25s';
DO $$
BEGIN
 IF to_regprocedure('public.ship_dynamics_task_lease_gate_v1(text,text)') IS NULL
 OR to_regprocedure('public.claim_ship_dynamics_edit_lock(text,text,text,text,integer)') IS NULL THEN
  RAISE EXCEPTION 'edit-lock-holder-prerequisite-missing';
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.claim_ship_dynamics_edit_lock(p_workspace_key text,p_section_key text,p_locked_by text,p_locked_by_name text,p_ttl_seconds integer DEFAULT 75)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
-- edit-lock-holder-v1: retain hierarchy, fencing, TTL and original owner semantics.
DECLARE family text; e public.ship_dynamics_edit_locks%rowtype; c public.ship_dynamics_edit_locks%rowtype;
BEGIN
 family:=public.ship_dynamics_task_lock_family_v1(p_section_key);
 IF family IS NOT NULL THEN
  PERFORM public.ship_dynamics_task_lease_gate_v1(p_workspace_key,p_section_key);
  SELECT * INTO e FROM public.ship_dynamics_edit_locks l WHERE l.workspace_key=p_workspace_key
   AND l.expires_at>clock_timestamp() AND l.section_key<>p_section_key
   AND public.ship_dynamics_task_lock_family_v1(l.section_key)=family
   AND (p_section_key='task:'||family OR l.section_key='task:'||family) ORDER BY l.section_key LIMIT 1;
  IF FOUND THEN RETURN jsonb_build_object('ok',false,'code','parent-child-lock-conflict','section_key',e.section_key,'locked_by',e.locked_by,'locked_by_name',e.locked_by_name,'expires_at',e.expires_at); END IF;
 END IF;
 INSERT INTO public.ship_dynamics_edit_locks(workspace_key,section_key,locked_by,locked_by_name,locked_at,expires_at)
 VALUES(p_workspace_key,p_section_key,p_locked_by,p_locked_by_name,clock_timestamp(),clock_timestamp()+make_interval(secs=>least(greatest(p_ttl_seconds,30),120)))
 ON CONFLICT(workspace_key,section_key) DO UPDATE SET locked_by=excluded.locked_by,locked_by_name=excluded.locked_by_name,locked_at=excluded.locked_at,expires_at=excluded.expires_at,
 lease_version=CASE WHEN ship_dynamics_edit_locks.expires_at<=clock_timestamp() OR ship_dynamics_edit_locks.locked_by<>excluded.locked_by THEN nextval('public.ship_dynamics_member_fence_seq') ELSE ship_dynamics_edit_locks.lease_version END
 WHERE ship_dynamics_edit_locks.expires_at<=clock_timestamp() OR ship_dynamics_edit_locks.locked_by=excluded.locked_by RETURNING * INTO c;
 IF NOT FOUND THEN
  SELECT * INTO e FROM public.ship_dynamics_edit_locks l WHERE l.workspace_key=p_workspace_key AND l.section_key=p_section_key;
  RETURN jsonb_build_object('ok',false,'code','lock-conflict','section_key',p_section_key,'locked_by',e.locked_by,'locked_by_name',e.locked_by_name,'expires_at',e.expires_at);
 END IF;
 RETURN jsonb_build_object('ok',true,'section_key',c.section_key,'locked_by',c.locked_by,'locked_by_name',c.locked_by_name,'expires_at',c.expires_at,'lease_version',c.lease_version::text);
END $$;
COMMIT;
