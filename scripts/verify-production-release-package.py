"""Deterministic release packaging checks; never contacts a database."""
from pathlib import Path
import hashlib, json, re, subprocess, sys
ROOT=Path(__file__).resolve().parents[1]
checks=[]
def check(name, condition):
    if not condition: raise AssertionError(name)
    checks.append(name)
try:
    builder=ROOT/'scripts/build-production-release.py'
    check('release-builder-exists',builder.exists())
    result=subprocess.run([sys.executable,'-B',str(builder),'--check'],cwd=ROOT,capture_output=True,text=True,timeout=30)
    check('generated-artifacts-match-current-inputs',result.returncode==0)
    manifest=json.loads((ROOT/'supabase/release/record-release-manifest.json').read_text(encoding='utf-8'))
    install=(ROOT/'supabase/release/05_install_record_storage.sql').read_text(encoding='utf-8')
    readback=(ROOT/'supabase/release/06_verify_record_storage.sql').read_text(encoding='utf-8')
    check('exact-17-ordered-components',len(manifest['components'])==17 and len({x['path'] for x in manifest['components']})==17)
    check('one-explicit-atomic-install',len(re.findall(r'^BEGIN;$',install,re.M))==1 and len(re.findall(r'^COMMIT;$',install,re.M))==1)
    check('installation-does-not-invoke-import-or-cutover',not re.search(r'(?im)^\s*(?:select|perform)\s+(?:public\.)?(?:import_ship_dynamics_records_v1|freeze_ship_dynamics_legacy_writes|pause_ship_dynamics_business_v1|stage_ship_dynamics_paused_legacy_to_records_v1|publish_ship_dynamics_source_authority_v2|resume_ship_dynamics_source_authority_v2)\s*\(',install))
    check('known-workspace-and-first-install-guard',"release-records-already-present-use-readback" in install and "ship-dynamics-main" in install and "public.sd_workspaces" in install)
    check('browser-roles-have-no-direct-record-table-access','REVOKE ALL ON TABLE' in install and 'ENABLE ROW LEVEL SECURITY' in install)
    check('readback-is-separate-and-read-only','REPEATABLE READ READ ONLY' in readback and '\nROLLBACK;' in readback and not re.search(r'(?im)^\s*(?:insert|update|delete|create|alter|grant|revoke|truncate|drop)\s',readback))
    check('full-backup-is-not-a-release-prerequisite',manifest['full_backup_required'] is False)
    check('no-production-seed-or-old-revision-in-install',not re.search(r'\b(?:8818|4910)\b',install) and not any('/schema.sql' in x['path'] or 'normalized-schema.sql' in x['path'] for x in manifest['components']))
    check('component-hashes-match',all(hashlib.sha256((ROOT/x['path']).read_text(encoding='utf-8').encode('utf-8')).hexdigest()==x['sha256'] for x in manifest['components']))
    print(json.dumps({'status':'PASS','scope':'PACKAGING_ONLY_NOT_NATIVE_OR_HOSTED','checks':checks,'count':len(checks)}))
except Exception as exc:
    print(json.dumps({'status':'FAIL','checks':checks,'error':str(exc)}));sys.exit(1)
