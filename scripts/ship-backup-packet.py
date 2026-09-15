"""Validate and unpack a private SQL Editor seed CSV, using owned local PostgreSQL.
No network destination except 127.0.0.1. Never runs downloaded function definitions.
The public PGP wrapper is compression, NOT confidentiality encryption.
"""
from pathlib import Path
import argparse, base64, csv, hashlib, json, os, re, shutil, socket, subprocess, tempfile

WRAPPER = 'SHIP-DYNAMICS-PUBLIC-COMPRESSION-WRAPPER-V1-NOT-A-SECRET'
FORMAT = 'PUBLIC_PGP_ZIP_WRAPPER_V1_NOT_CONFIDENTIALITY_ENCRYPTION'
PROJECT = 'cyzpcvvhmoiihsqvjspp'
WORKSPACE = '2ae6e674-21ba-520c-93db-8cea28e84dd0'

def require(condition, code):
    if not condition:
        raise ValueError(code)

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def pg_metadata_json(value):
    """Canonical jsonb text for this metadata format (no floats/decimals)."""
    if isinstance(value, dict):
        return '{' + ', '.join(json.dumps(k, ensure_ascii=False) + ': ' + pg_metadata_json(value[k]) for k in sorted(value, key=lambda k: (len(k.encode('utf-8')), k.encode('utf-8')))) + '}'
    if isinstance(value, list):
        return '[' + ', '.join(pg_metadata_json(v) for v in value) + ']'
    require(value is None or isinstance(value, (str, bool, int)), 'UNSUPPORTED_METADATA_SCALAR')
    return json.dumps(value, ensure_ascii=False)

def parse_seed(text):
    envelope = json.loads(text)
    require(envelope['end_marker'] == 'SHIP_BACKUP_PACKET_END_V1', 'MISSING_END_MARKER')
    body = envelope['packet_json'].encode('utf-8')
    require(len(body) == envelope['packet_bytes'] <= 8388608, 'PACKET_SIZE_MISMATCH')
    require(sha(body) == envelope['packet_sha256'], 'PACKET_HASH_MISMATCH')
    packet = json.loads(body)
    require(packet['status'] == 'SEED_EXPORTED', 'SQL_RETURNED_STOP')
    require(packet['artifact'] == 'SHIP_DYNAMICS_BOUNDED_BACKUP_SEED_V1', 'WRONG_ARTIFACT')
    require(packet['intended_project_label'] == PROJECT and packet['workspace_id'] == WORKSPACE and packet['workspace_key'] == 'ship-dynamics-main', 'WRONG_TARGET_LABEL')
    require(packet['transaction_read_only'] == 'on' and packet['transaction_isolation'] == 'repeatable read' and packet['reader_context']['bypass_rls'] is True, 'WRONG_READER_CONTEXT')
    require(packet['compression_format'] == FORMAT, 'WRONG_COMPRESSION_FORMAT')
    require(packet['complete_application_backup'] is False and packet['frozen_cutover_checkpoint'] is False, 'SEED_CANNOT_CLAIM_COMPLETENESS')
    manifest = packet['manifest']
    require(sha(pg_metadata_json(manifest).encode('utf-8')) == packet['manifest_sha256'], 'MANIFEST_HASH_MISMATCH')
    require(manifest['table_count'] == len(manifest['tables']), 'TABLE_COUNT_MISMATCH')
    require(manifest['function_count'] == len(manifest['functions']), 'FUNCTION_COUNT_MISMATCH')
    table_keys = set(); total_rows = 0
    for table in manifest['tables']:
        key = (table['schema'], table['name'])
        require(key not in table_keys, 'DUPLICATE_TABLE'); table_keys.add(key)
        require(table['row_count'] == len(table['rows']) <= 20000, 'ROW_COUNT_MISMATCH')
        total_rows += table['row_count']
        require(sha(pg_metadata_json(table['rows']).encode('utf-8')) == table['row_versions_sha256'], 'ROW_VERSION_HASH_MISMATCH')
        tids = set()
        for row in table['rows']:
            require(re.fullmatch(r'\([0-9]+,[0-9]+\)', row['ctid']) is not None and re.fullmatch(r'[0-9]+', row['xmin']) is not None, 'MALFORMED_ROW_LOCATOR')
            require(row['ctid'] not in tids, 'DUPLICATE_ROW_LOCATOR'); tids.add(row['ctid'])
    require(total_rows == manifest['row_count'], 'TOTAL_ROWS_MISMATCH')
    fn_keys = set()
    for fn in manifest['functions']:
        key = (fn['schema'], fn['name'], fn['identity_arguments'])
        require(key not in fn_keys, 'DUPLICATE_FUNCTION'); fn_keys.add(key)
        require(sha(fn['definition'].encode('utf-8')) == fn['definition_sha256'], 'FUNCTION_HASH_MISMATCH')
    state = [t for t in manifest['tables'] if (t['schema'],t['name']) == ('public','ship_dynamics_app_state')]
    require(len(state) == 1, 'MISSING_CURRENT_STATE_TABLE')
    expected = {(r['ctid'],r['xmin']) for r in state[0]['rows']}
    actual = []
    for row in packet['core_rows']:
        require((row['schema'],row['name']) == ('public','ship_dynamics_app_state'), 'UNEXPECTED_CORE_TABLE')
        actual.append((row['ctid'],row['xmin']))
        base64.b64decode(row['encoded'], validate=True)
        require(0 < row['raw_bytes'] <= 8388608, 'CORE_ROW_SIZE_INVALID')
    require(len(actual) == len(set(actual)) and set(actual) == expected and 0 < len(actual) <= 2, 'CORE_COVERAGE_MISMATCH')
    require(sum(r['raw_bytes'] for r in packet['core_rows']) <= 8388608, 'CORE_TOTAL_SIZE_INVALID')
    return packet

def read_seed_csv(path):
    csv.field_size_limit(64000000)
    require(path.stat().st_size <= 64000000, 'CSV_TOO_LARGE')
    with path.open(encoding='utf-8-sig', newline='') as f:
        reader = csv.DictReader(f)
        require(reader.fieldnames == ['backup_packet'], 'WRONG_CSV_COLUMNS')
        rows = list(reader)
    require(len(rows) == 1 and None not in rows[0], 'WRONG_CSV_ROW_COUNT')
    return parse_seed(rows[0]['backup_packet'])

def unpack(source, out):
    packet = read_seed_csv(source)
    require(not out.exists(), 'OUTPUT_ALREADY_EXISTS')
    out.mkdir(parents=True, exist_ok=False)
    bin_dir = Path(os.environ['LOCALAPPDATA']) / 'hermes/cache/ship-pg-runtime-17.11-3/runtime/pgsql/bin'
    run = Path(tempfile.mkdtemp(prefix='local-decoder-', dir=out)); data = run / 'data'
    env = {k:v for k,v in os.environ.items() if not k.upper().startswith('PG')}
    env.update(PGCLIENTENCODING='UTF8', PGCONNECT_TIMEOUT='5')
    with socket.socket() as sock:
        sock.bind(('127.0.0.1',0)); port = sock.getsockname()[1]
    def native(name, argv):
        with (run / 'native.log').open('ab') as log:
            result = subprocess.run([str(bin_dir / (name+'.exe')), *argv], env=env, stdin=subprocess.DEVNULL, stdout=log, stderr=log, timeout=40)
        require(result.returncode == 0, 'LOCAL_POSTGRES_COMMAND_FAILED')
    def sql(text):
        result = subprocess.run([str(bin_dir/'psql.exe'),'-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',str(port),'-U','decode_qa','-d','postgres','-f','-'], input=text, encoding='utf-8', capture_output=True, env=env, timeout=40)
        if result.returncode:
            (run/'private-error.log').write_text(result.stderr,encoding='utf-8')
        require(result.returncode == 0,'LOCAL_DECODE_QUERY_FAILED')
        return result.stdout.strip()
    decoded=[]; failure=None
    try:
        native('initdb',['-D',str(data),'-U','decode_qa','-A','trust','--encoding=UTF8','--locale=C'])
        native('pg_ctl',['-D',str(data),'-l',str(run/'postgres.log'),'-o',f'-h 127.0.0.1 -p {port}','-w','-t','20','start'])
        identity=json.loads(sql("select json_build_object('data',current_setting('data_directory'),'host',host(inet_server_addr()),'port',inet_server_port())"))
        require(Path(identity['data']).resolve()==data.resolve() and identity['host']=='127.0.0.1' and identity['port']==port,'WRONG_LOCAL_DECODE_TARGET')
        sql('create extension pgcrypto with schema public')
        for ordinal,row in enumerate(packet['core_rows'],1):
            # The encoded value has already passed strict Base64 validation.
            encoded=sql("select encode(convert_to(public.pgp_sym_decrypt(decode('"+row['encoded']+"','base64'),'"+WRAPPER+"'),'UTF8'),'base64')")
            raw=base64.b64decode(encoded)
            require(len(raw)==row['raw_bytes'] and sha(raw)==row['row_json_sha256'],'DECODED_ROW_HASH_MISMATCH')
            value=json.loads(raw)
            if value.get('workspace_key')=='ship-dynamics-main':
                require(value.get('revision')==packet['source_revision'],'SOURCE_REVISION_MISMATCH')
            target=out/f'core-{ordinal:04d}.json'; target.write_bytes(raw)
            decoded.append({'file':target.name,'bytes':len(raw),'sha256':sha(raw),'ctid':row['ctid'],'xmin':row['xmin']})
        require(sum(json.loads((out/r['file']).read_bytes()).get('workspace_key')=='ship-dynamics-main' for r in decoded)==1,'MAIN_STATE_CARDINALITY')
        (out/'manifest.json').write_text(json.dumps(packet['manifest'],ensure_ascii=False,indent=2),encoding='utf-8')
        (out/'packet.json').write_text(json.dumps(packet,ensure_ascii=False),encoding='utf-8')
    except Exception as exc:
        failure=type(exc).__name__+': '+str(exc)[:160]
    finally:
        if (data/'postmaster.pid').exists():
            try:native('pg_ctl',['-D',str(data),'-m','fast','-w','-t','20','stop'])
            except Exception as exc:failure=(failure or '')+'; '+type(exc).__name__
        with socket.socket() as sock:
            sock.settimeout(1);closed=sock.connect_ex(('127.0.0.1',port))!=0
        stopped=closed and not (data/'postmaster.pid').exists()
        if stopped and data.exists():shutil.rmtree(data)
        receipt={'status':'SEED_DECODED_AND_VERIFIED' if failure is None and stopped else 'FAIL','sourceCsvSha256':sha(source.read_bytes()),'sourceRevision':packet['source_revision'],'manifestSha256':packet['manifest_sha256'],'tableCount':packet['manifest']['table_count'],'inventoryRows':packet['manifest']['row_count'],'functionCount':packet['manifest']['function_count'],'decodedCoreRows':decoded,'completeApplicationBackup':False,'productionWrite':False,'ownedPortClosed':closed,'ownedClusterStopped':stopped,'ownedDataRemoved':not data.exists(),'error':failure}
        (out/'receipt.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2),encoding='utf-8')
    require(receipt['status']=='SEED_DECODED_AND_VERIFIED','LOCAL_SEED_UNPACK_FAILED_SEE_PRIVATE_RECEIPT')
    return receipt

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--csv',type=Path,required=True)
    parser.add_argument('--out',type=Path,required=True)
    args=parser.parse_args()
    result=unpack(args.csv,args.out)
    print(json.dumps(result,ensure_ascii=False))
