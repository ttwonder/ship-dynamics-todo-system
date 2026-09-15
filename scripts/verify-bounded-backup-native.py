"""Native, loopback-only backup export checks. Never connects to Supabase."""
from pathlib import Path
import argparse, base64, csv, hashlib, io, json, os, shutil, socket, subprocess, sys, tempfile

ROOT = Path(__file__).resolve().parents[1]
CACHE = Path(os.environ['LOCALAPPDATA']) / 'hermes/cache/ship-production-release-7f44748'
BIN = Path(os.environ['LOCALAPPDATA']) / 'hermes/cache/ship-pg-runtime-17.11-3/runtime/pgsql/bin'
SQL = ROOT / 'supabase/release/04_bounded_backup_seed.sql'
PUBLIC_WRAPPER = 'SHIP-DYNAMICS-PUBLIC-COMPRESSION-WRAPPER-V1-NOT-A-SECRET'
parser = argparse.ArgumentParser()
parser.add_argument('--red-only', action='store_true')
args = parser.parse_args()
RUN = Path(tempfile.mkdtemp(prefix='bounded-backup-native-', dir=CACHE))
DATA = RUN / 'data'
env = {k: v for k, v in os.environ.items() if not k.upper().startswith('PG')}
env.update(PGCLIENTENCODING='UTF8', PGCONNECT_TIMEOUT='5')
with socket.socket() as s:
    s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]
(RUN / 'owner.json').write_text(json.dumps({'data': str(DATA), 'port': port, 'scope': 'LOCAL_ONLY'}), encoding='utf-8')

def native(name, argv):
    with (RUN / 'native.log').open('ab') as log:
        subprocess.run([str(BIN / (name + '.exe')), *argv], env=env, stdin=subprocess.DEVNULL, stdout=log, stderr=log, timeout=40, check=True)

def query(text, expect_error=False, timeout=80):
    result = subprocess.run([str(BIN / 'psql.exe'), '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-h', '127.0.0.1', '-p', str(port), '-U', 'backup_qa', '-d', 'postgres', '-f', '-'], input=text, encoding='utf-8', capture_output=True, env=env, timeout=timeout)
    if expect_error:
        return result
    if result.returncode:
        raise RuntimeError(result.stderr[:4000])
    return result.stdout.strip()

def unwrap(value):
    envlp = json.loads(value)
    text = envlp['packet_json']
    assert len(text.encode('utf-8')) == envlp['packet_bytes']
    assert hashlib.sha256(text.encode('utf-8')).hexdigest() == envlp['packet_sha256']
    assert envlp['end_marker'] == 'SHIP_BACKUP_PACKET_END_V1'
    return json.loads(text)

def decrypt(row):
    encoded = row['encoded']
    base64.b64decode(encoded, validate=True)
    # Public wrapper string is deliberately NOT a confidentiality password.
    result = query("select encode(convert_to(public.pgp_sym_decrypt(decode('" + encoded + "','base64'),'" + PUBLIC_WRAPPER + "'),'UTF8'),'base64')")
    raw = base64.b64decode(result)
    assert len(raw) == row['raw_bytes']
    assert hashlib.sha256(raw).hexdigest() == row['row_json_sha256']
    return raw

cases = []
error = None
identity = {}
try:
    native('initdb', ['-D', str(DATA), '-U', 'backup_qa', '-A', 'trust', '--encoding=UTF8', '--locale=C'])
    native('pg_ctl', ['-D', str(DATA), '-l', str(RUN / 'postgres.log'), '-o', f'-h 127.0.0.1 -p {port}', '-w', '-t', '20', 'start'])
    identity = json.loads(query("select json_build_object('data',current_setting('data_directory'),'host',host(inet_server_addr()),'port',inet_server_port(),'version',current_setting('server_version'))"))
    assert Path(identity['data']).resolve() == DATA.resolve() and identity['host'] == '127.0.0.1' and identity['port'] == port
    query("""
create extension pgcrypto with schema public;
create role anon;
create table public.sd_workspaces(id uuid primary key,legacy_key text,is_active boolean);
insert into public.sd_workspaces values('2ae6e674-21ba-520c-93db-8cea28e84dd0','ship-dynamics-main',true);
create table public.ship_dynamics_app_state(workspace_key text primary key,payload jsonb not null,revision integer not null,updated_at timestamptz not null,updated_by text);
insert into public.ship_dynamics_app_state
select 'ship-dynamics-main',jsonb_build_object('text',string_agg(md5(g::text),''),'unicode','船 & < > 🌊','order',jsonb_build_array('second','first'),'decimal',1.00),9,'2026-01-01T00:00:00Z',null from generate_series(1,130000) g;
insert into public.ship_dynamics_app_state values('retained-other-workspace','{"original":"keep","users":[{"passwordHash":"SYNTHETIC_PRIVATE_HASH"}]}',8,'2026-01-01T00:00:00Z','qa');
create table public.ship_dynamics_app_revisions(id integer primary key,body jsonb not null);
insert into public.ship_dynamics_app_revisions select g,payload from public.ship_dynamics_app_state cross join generate_series(1,32) g where workspace_key='ship-dynamics-main';
create table public.sd_migration_quarantine(id integer primary key,body jsonb);
insert into public.sd_migration_quarantine values(1,'{"keep":"original unresolved input"}');
create table public.unrelated_do_not_export(id integer);
insert into public.unrelated_do_not_export values(123);
create function public.sd_backup_never_invoke() returns integer language plpgsql as $$begin insert into public.sd_migration_quarantine values(999,'{}');return 1;end$$;
alter table public.ship_dynamics_app_revisions enable row level security;
alter table public.ship_dynamics_app_revisions force row level security;
grant usage on schema public to anon;
grant select on all tables in schema public to anon;
""")
    history_bytes = int(query('select pg_total_relation_size(\'public.ship_dynamics_app_revisions\')'))
    old = (ROOT / 'supabase/release/02_preinstall_app_backup.sql').read_text(encoding='utf-8')
    red = query("set temp_file_limit='1MB';set work_mem='16MB';" + old, expect_error=True)
    assert red.returncode != 0 and ('53400' in red.stderr or '53100' in red.stderr) and 'temporary file' in red.stderr.lower(), red.stderr[:1000]
    (RUN / 'old-query-red.txt').write_text(red.stderr, encoding='utf-8')
    cases.append('old-wide-history-sort-exceeds-bounded-local-temp-budget')
    if not args.red_only:
        sql = SQL.read_text(encoding='utf-8')
        before = query("select jsonb_build_object('rows',(select jsonb_agg(jsonb_build_array(ctid::text,xmin::text,revision,encode(sha256(convert_to(payload::text,'UTF8')),'hex')) order by workspace_key) from public.ship_dynamics_app_state),'quarantine',(select count(*) from public.sd_migration_quarantine),'tables',(select count(*) from pg_class),'functions',(select count(*) from pg_proc))")
        temp_before = int(query("select temp_bytes from pg_stat_database where datname=current_database()"))
        raw = query("set temp_file_limit='1MB';" + sql)
        temp_after = int(query("select temp_bytes from pg_stat_database where datname=current_database()"))
        packet = unwrap(raw)
        assert packet['status'] == 'SEED_EXPORTED', packet['status']
        assert packet['transaction_read_only'] == 'on' and packet['transaction_isolation'] == 'repeatable read'
        manifest = packet['manifest']
        assert manifest['table_count'] == len(manifest['tables']) == 4
        assert manifest['row_count'] == sum(t['row_count'] for t in manifest['tables']) == 36
        assert all(t['row_count'] == len(t['rows']) for t in manifest['tables'])
        assert not any(t['name'] == 'unrelated_do_not_export' for t in manifest['tables'])
        assert next(t for t in manifest['tables'] if t['name'] == 'ship_dynamics_app_revisions')['row_count'] == 32
        assert next(t for t in manifest['tables'] if t['name'] == 'sd_migration_quarantine')['row_count'] == 1
        cases.append('complete-row-locator-inventory-without-exporting-history-bodies')
        assert len(packet['core_rows']) == 2
        query('create schema restore_qa;create table restore_qa.state (like public.ship_dynamics_app_state including all)')
        for row in packet['core_rows']:
            plain = decrypt(row)
            text = plain.decode('utf-8')
            # Fixture contains no production secrets. Use stdin, not CLI arguments.
            literal = "'" + text.replace("'", "''") + "'"
            query('insert into restore_qa.state select * from jsonb_populate_record(null::restore_qa.state,' + literal + '::jsonb)')
        assert query("select count(*) from ((select * from public.ship_dynamics_app_state except select * from restore_qa.state) union all (select * from restore_qa.state except select * from public.ship_dynamics_app_state)) q") == '0'
        query('drop schema restore_qa cascade')
        cases.append('public-compression-wrapper-decodes-and-restores-exact-row-values')
        # A 4MB-class current row plus wide history succeeds under the same temp cap.
        assert temp_after == temp_before
        cases.append('wide-history-seed-export-zero-temp-bytes-under-1MiB-temp-limit')
        after = query("select jsonb_build_object('rows',(select jsonb_agg(jsonb_build_array(ctid::text,xmin::text,revision,encode(sha256(convert_to(payload::text,'UTF8')),'hex')) order by workspace_key) from public.ship_dynamics_app_state),'quarantine',(select count(*) from public.sd_migration_quarantine),'tables',(select count(*) from pg_class),'functions',(select count(*) from pg_proc))")
        assert before == after
        cases.append('read-only-source-physical-rows-and-schema-unchanged')
        # CSV cell quoting / JSON envelope and corruption controls.
        f = io.StringIO(newline=''); writer = csv.writer(f); writer.writerow(['backup_packet']); writer.writerow([raw])
        csv.field_size_limit(64000000)
        f.seek(0); restored = list(csv.DictReader(f))[0]['backup_packet']; assert unwrap(restored) == packet
        corrupt = json.loads(raw); corrupt['packet_json'] += ' '
        try: unwrap(json.dumps(corrupt)); raise RuntimeError('corruption accepted')
        except AssertionError: pass
        try: unwrap(raw[:-1]); raise RuntimeError('truncation accepted')
        except json.JSONDecodeError: pass
        cases.append('original-csv-roundtrip-and-truncation-or-tamper-rejection')
        denied = unwrap(query('set role anon;' + sql))
        assert denied['status'].startswith('STOP') and not denied['core_rows'] and denied['manifest'] is None
        cases.append('RLS-filtered-reader-rejected-before-data-export')
        query("update public.sd_workspaces set legacy_key='wrong-workspace'")
        wrong = unwrap(query(sql)); assert wrong['status'].startswith('STOP') and not wrong['core_rows']
        query("update public.sd_workspaces set legacy_key='ship-dynamics-main'")
        cases.append('wrong-workspace-rejected')
        changed = unwrap(query(sql))
        assert changed['manifest_sha256'] != packet['manifest_sha256']
        # Revision did not change; unrelated table tuple churn is still detected.
        assert changed['source_revision'] == packet['source_revision']
        cases.append('non-main-row-version-change-detected-with-unchanged-main-revision')
        (RUN / 'synthetic-seed-packet.json').write_text(raw, encoding='utf-8')
        import importlib.util
        spec = importlib.util.spec_from_file_location('ship_backup_packet', ROOT / 'scripts/ship-backup-packet.py')
        packet_module = importlib.util.module_from_spec(spec); spec.loader.exec_module(packet_module)
        assert packet_module.parse_seed(raw) == packet
        csv_path = RUN / 'synthetic-seed.csv'
        with csv_path.open('w', encoding='utf-8', newline='') as cf:
            cw = csv.writer(cf); cw.writerow(['backup_packet']); cw.writerow([raw])
        local_receipt = packet_module.unpack(csv_path, RUN / 'decoded-seed')
        assert local_receipt['status'] == 'SEED_DECODED_AND_VERIFIED' and local_receipt['ownedClusterStopped'] and local_receipt['ownedDataRemoved']
        cases.append('delivered-CSV-validator-and-owned-native-decoder-exercised')
        query("create role backup_reader bypassrls;grant usage on schema public to backup_reader;grant select on all tables in schema public to backup_reader")
        reader_packet = packet_module.parse_seed(query('set role backup_reader;' + sql))
        assert reader_packet['reader_context'] == {'current_role':'backup_reader','bypass_rls':True}
        cases.append('non-superuser-BYPASSRLS-reader-supported')
        query('create schema extensions;alter extension pgcrypto set schema extensions;grant usage on schema extensions to backup_reader')
        relocated = packet_module.parse_seed(query('set role backup_reader;' + sql))
        assert relocated['status'] == 'SEED_EXPORTED'
        query('alter extension pgcrypto set schema public;drop schema extensions')
        cases.append('provider-style-pgcrypto-extension-schema-supported')
        query("insert into public.ship_dynamics_app_state values('third-workspace','{}',1,now(),null)")
        capped = unwrap(query(sql)); assert capped['status'].startswith('STOP') and not capped['core_rows']
        query("delete from public.ship_dynamics_app_state where workspace_key='third-workspace'")
        cases.append('excess-core-row-count-refused-before-export')
        query("update public.ship_dynamics_app_state set payload=jsonb_build_object('large',repeat('X',9000000)) where workspace_key='ship-dynamics-main'")
        oversized = unwrap(query(sql)); assert oversized['status'].startswith('STOP') and not oversized['core_rows']
        cases.append('oversized-current-row-refused-with-no-body-export')
        manifest_rows = manifest['row_count']; encoded_bytes = len(raw.encode('utf-8'))
except Exception as exc:
    error = str(exc)
finally:
    if (DATA / 'postmaster.pid').exists():
        try: native('pg_ctl', ['-D', str(DATA), '-m', 'fast', '-w', '-t', '20', 'stop'])
        except Exception as exc: error = (error or '') + ' cleanup: ' + str(exc)
    with socket.socket() as sock:
        sock.settimeout(1); closed = sock.connect_ex(('127.0.0.1', port)) != 0
    stopped = closed and not (DATA / 'postmaster.pid').exists()
    if stopped and DATA.exists() and (RUN / 'owner.json').exists(): shutil.rmtree(DATA)
    receipt = {'status': 'PASS' if error is None and stopped else 'FAIL', 'mode': 'old-red' if args.red_only else 'seed-verification', 'scope': 'LOCAL_NATIVE_SYNTHETIC_NOT_PRODUCTION_BACKUP', 'cases': cases, 'caseCount': len(cases), 'historyPhysicalBytes': locals().get('history_bytes'), 'manifestRows': locals().get('manifest_rows'), 'seedEnvelopeBytes': locals().get('encoded_bytes'), 'tempBytesDelta': locals().get('temp_after')-locals().get('temp_before') if 'temp_after' in locals() and 'temp_before' in locals() else None, 'serverVersion': identity.get('version'), 'sqlSha256': hashlib.sha256(SQL.read_bytes()).hexdigest() if SQL.exists() else None, 'ownedPort': port, 'ownedPortClosed': closed, 'ownedClusterStopped': stopped, 'ownedDataRemoved': not DATA.exists(), 'productionWrites': False, 'artifact': str(RUN), 'error': error}
    (RUN / 'verification.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2), encoding='utf-8')
    (CACHE / ('latest-bounded-red.json' if args.red_only else 'latest-bounded-verification.json')).write_text(json.dumps(receipt, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(receipt, ensure_ascii=False)); sys.exit(0 if receipt['status'] == 'PASS' else 1)
