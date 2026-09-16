"""Check the scoped manual-resume timeout. No database or network access."""
from pathlib import Path
import hashlib
import json
import runpy

ROOT = Path(__file__).resolve().parents[1]
package = runpy.run_path(str(ROOT / 'scripts/build-production-control.py'))['build']()
checks = []
for name, sql in package.items():
    if not name.endswith('.sql'):
        continue
    expected = '8min' if name == '11_resume_published_source.sql' else ('15s' if name == '12_control_readback.sql' else '45s')
    assert f"SET LOCAL statement_timeout='{expected}';" in sql, f'{name}: expected transaction-local timeout {expected}'
    assert 'ALTER ROLE' not in sql and 'ALTER DATABASE' not in sql
    if name != '12_control_readback.sql':
        assert "SET LOCAL lock_timeout='5s';" in sql
    assert (ROOT / 'supabase/release' / name).read_bytes() == sql.encode(), f'{name}: generated-file drift'
    checks.append(name)
manifest = json.loads(package['control-release-manifest.json'])
assert all(hashlib.sha256(package[name].encode()).hexdigest() == digest for name, digest in manifest['outputs'].items())
print(json.dumps({'status': 'PASS', 'scope': 'PACKAGING_ONLY_NOT_HOSTED', 'count': len(checks), 'checks': checks}))
