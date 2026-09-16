"""Generate small manual operator steps. No DB/network, no snapshot input.
Each SQL file is a fresh transaction; actual tuples/proofs come from that DB.
Do not run steps automatically on production. Error/unknown ACK => readback.
"""
from pathlib import Path
import argparse,json,hashlib
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'supabase/release'
HEADER="""-- MANUAL OPERATOR STEP. Target ship-dynamics-main. NOT A BACKUP RESTORE.
-- Run only this step when requested. ERROR/unknown result: STOP, then 12 readback.
BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL statement_timeout='45s';
SET LOCAL lock_timeout='5s';
CREATE TEMP TABLE release_step_result(result jsonb) ON COMMIT DROP;
DO $release_step$
DECLARE w constant text:='ship-dynamics-main';wid uuid; q record; f record; l record;
 r jsonb; h text; source_hash text; sid uuid; proof jsonb; op uuid:=gen_random_uuid(); actor name:=current_user;
BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname=current_user AND rolbypassrls) THEN RAISE EXCEPTION 'release-admin-required';END IF;
 SELECT id INTO STRICT wid FROM public.sd_workspaces WHERE legacy_key=w;
"""
TAIL="""
 EXECUTE format('SET LOCAL ROLE %I',actor);
 INSERT INTO pg_temp.release_step_result VALUES(r);
END $release_step$;
SELECT result AS control_receipt FROM pg_temp.release_step_result;
COMMIT;
"""
FROZEN="""
 SELECT * INTO STRICT f FROM public.sd_legacy_write_controls WHERE workspace_key=w;
 IF NOT f.writes_frozen OR f.restore_in_progress THEN RAISE EXCEPTION 'release-frozen-source-required';END IF;
 SELECT * INTO STRICT l FROM public.ship_dynamics_app_state WHERE workspace_key=w;
"""
PAUSED="""
 SELECT x.transition_id,t.watermark,t.state INTO STRICT q FROM ship_dynamics_quiescence_private.workspaces x
 JOIN ship_dynamics_quiescence_private.transitions t USING(workspace_key,transition_id)
 WHERE x.workspace_key=w AND x.workspace_id=wid;
 IF q.state<>'paused' THEN RAISE EXCEPTION 'release-exact-pause-required';END IF;
"""
FREEZE="""
 IF EXISTS(SELECT FROM ship_dynamics_authority_private.current_v1 WHERE workspace_key=w AND source<>'legacy')
 OR EXISTS(SELECT FROM public.sd_legacy_write_controls WHERE workspace_key=w AND writes_frozen) THEN
  RAISE EXCEPTION 'release-freeze-state-unexpected-use-readback';END IF;
 SELECT * INTO STRICT l FROM public.ship_dynamics_app_state WHERE workspace_key=w;
 h:=public.sd_legacy_jsonb_sha256(l.payload);
 SET LOCAL ROLE service_role;
 r:=public.freeze_ship_dynamics_legacy_writes(w,l.revision,h,'freeze:'||w||':'||l.revision||':'||h);
"""
PAUSE=FROZEN+"""
 IF EXISTS(SELECT FROM ship_dynamics_quiescence_private.workspaces x JOIN ship_dynamics_quiescence_private.transitions t USING(workspace_key,transition_id) WHERE x.workspace_key=w AND t.state='paused') THEN RAISE EXCEPTION 'release-already-paused-use-readback';END IF;
 SET LOCAL ROLE service_role;
 r:=public.pause_ship_dynamics_business_v1(w,op);
"""
FORWARD=FROZEN+PAUSED+"""
 IF EXISTS(SELECT FROM public.ship_dynamics_record_workspaces WHERE workspace_key=w) THEN RAISE EXCEPTION 'release-first-target-already-exists-use-readback';END IF;
 h:=public.sd_legacy_jsonb_sha256(l.payload);
 SET LOCAL ROLE service_role;
 r:=public.stage_ship_dynamics_paused_legacy_to_records_v1(w,wid,q.transition_id,q.watermark,l.revision,h,NULL,NULL,f.frozen_at,op);
"""
BACKWARD=FROZEN+PAUSED+"""
 IF NOT EXISTS(SELECT FROM ship_dynamics_authority_private.current_v1 WHERE workspace_key=w AND source='records-v1' AND phase='resumed') THEN RAISE EXCEPTION 'release-record-authority-required';END IF;
 IF EXISTS(SELECT FROM ship_dynamics_quiescence_private.stages_v1 WHERE workspace_key=w AND transition_id=q.transition_id) THEN RAISE EXCEPTION 'release-reverse-already-staged-use-readback';END IF;
 proof:=public.read_ship_dynamics_records_v1(w);
 IF proof->>'status' IS DISTINCT FROM 'snapshot' THEN RAISE EXCEPTION 'release-current-records-required';END IF;
 h:=public.sd_legacy_jsonb_sha256(l.payload);
 source_hash:=public.sd_legacy_jsonb_sha256(proof->'payload');
 SET LOCAL ROLE service_role;
 r:=public.stage_ship_dynamics_paused_records_to_legacy_v1(w,wid,q.transition_id,q.watermark,(proof->>'revision')::integer,source_hash,l.revision,h,f.frozen_at,op);
"""
def publish(target,table):return PAUSED+f"""
 IF EXISTS(SELECT FROM ship_dynamics_authority_private.current_v1 WHERE workspace_key=w AND transition_id=q.transition_id AND phase='published-paused') THEN RAISE EXCEPTION 'release-already-published-use-readback';END IF;
 SELECT request_id,result INTO STRICT sid,proof FROM {table} WHERE workspace_key=w AND transition_id=q.transition_id;
 SET LOCAL ROLE service_role;
 r:=public.publish_ship_dynamics_source_authority_v2(w,wid,q.transition_id,sid,proof,'{target}',op);
"""
RESUME=PAUSED+"""
 SELECT publication_id INTO STRICT sid FROM ship_dynamics_authority_private.current_v1
 WHERE workspace_key=w AND workspace_id=wid AND transition_id=q.transition_id AND phase='published-paused';
 SELECT s.result INTO STRICT proof FROM ship_dynamics_authority_private.receipts_v1 s WHERE s.request_id=sid AND s.action='publish-v2' AND s.actor=session_user;
 SET LOCAL ROLE service_role;
 r:=public.resume_ship_dynamics_source_authority_v2(w,wid,q.transition_id,sid,proof,op);
"""
READBACK="""-- Independent READ ONLY operator state. No payload, credential or backup data.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='15s';
SELECT jsonb_build_object(
 'kind','ship-release-control-readback-v1','workspace','ship-dynamics-main',
 'authority',(SELECT to_jsonb(c) FROM ship_dynamics_authority_private.current_v1 c WHERE workspace_key='ship-dynamics-main'),
 'pause',(SELECT jsonb_build_object('transition_id',x.transition_id,'state',t.state) FROM ship_dynamics_quiescence_private.workspaces x JOIN ship_dynamics_quiescence_private.transitions t USING(workspace_key,transition_id) WHERE workspace_key='ship-dynamics-main'),
 'freeze',(SELECT to_jsonb(f) FROM public.sd_legacy_write_controls f WHERE workspace_key='ship-dynamics-main'),
 'legacy',(SELECT jsonb_build_object('revision',revision,'hash',public.sd_legacy_jsonb_sha256(payload)) FROM public.ship_dynamics_app_state WHERE workspace_key='ship-dynamics-main'),
 'records',(SELECT jsonb_build_object('revision',revision,'hash',public.sd_legacy_jsonb_sha256(public.read_ship_dynamics_records_v1(workspace_key)->'payload')) FROM public.ship_dynamics_record_workspaces WHERE workspace_key='ship-dynamics-main'),
 'forward_stage',(SELECT jsonb_build_object('request_id',s.request_id,'result',s.result) FROM ship_dynamics_authority_private.forward_stages_v1 s JOIN ship_dynamics_quiescence_private.workspaces x USING(workspace_key,transition_id) WHERE s.workspace_key='ship-dynamics-main'),
 'reverse_stage',(SELECT jsonb_build_object('request_id',s.request_id,'result',s.result) FROM ship_dynamics_quiescence_private.stages_v1 s JOIN ship_dynamics_quiescence_private.workspaces x USING(workspace_key,transition_id) WHERE s.workspace_key='ship-dynamics-main'),
 'browser',public.read_ship_dynamics_browser_authority_v1('ship-dynamics-main'),
 'production_write',false
) AS control_readback;
ROLLBACK;
"""
def build():
 steps={'07_freeze_latest_legacy.sql':FREEZE,'08_pause_business.sql':PAUSE,'09_stage_first_records.sql':FORWARD,'10_publish_records_paused.sql':publish('records-v1','ship_dynamics_authority_private.forward_stages_v1'),'11_resume_published_source.sql':RESUME,'13_stage_latest_records_back.sql':BACKWARD,'14_publish_legacy_paused.sql':publish('legacy','ship_dynamics_quiescence_private.stages_v1')}
 result={name:(HEADER.replace("SET LOCAL statement_timeout='45s';", "SET LOCAL statement_timeout='8min';") if name=='11_resume_published_source.sql' else HEADER)+body+TAIL for name,body in steps.items()};result['12_control_readback.sql']=READBACK
 result['control-release-manifest.json']=json.dumps({'kind':'ship-manual-control-package-v1','source':'current database only; no seed/snapshot input','outputs':{k:hashlib.sha256(v.encode()).hexdigest() for k,v in result.items()},'forward':['07_freeze_latest_legacy.sql','08_pause_business.sql','09_stage_first_records.sql','12_control_readback.sql','10_publish_records_paused.sql','12_control_readback.sql','11_resume_published_source.sql','12_control_readback.sql'],'reverse':['08_pause_business.sql','13_stage_latest_records_back.sql','12_control_readback.sql','14_publish_legacy_paused.sql','12_control_readback.sql','11_resume_published_source.sql','12_control_readback.sql'],'warning':'Each phase needs its own operator/readback/client-version decision; never auto-run the list.'},indent=2)+'\n'
 return result
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--check',action='store_true');args=parser.parse_args();bad=[]
 for name,body in build().items():
  p=OUT/name
  if args.check:
   if not p.exists() or p.read_bytes()!=body.encode():bad.append(name)
  else:p.write_bytes(body.encode())
 print(json.dumps({'status':'FAIL' if bad else 'PASS','mismatches':bad,'count':len(build())}));raise SystemExit(bool(bad))
