"""Prepare the fleet-brief PDF font from the pinned, OFL static TC derivative.
Usage: python scripts/verify-fleet-brief-pdf.font.py path/to/NotoSansTC-Regular.ttf output.ttf.gz
Use fontTools 4.60.1. This is an asset-maintenance tool, never called by the app.
"""
import gzip
import hashlib
import io
import sys
from pathlib import Path
from fontTools.ttLib import TTFont

source = Path(sys.argv[1]).read_bytes()
assert hashlib.sha256(source).hexdigest() == '1fb8c870b683c2a18bf0c0f593c766bfff99c588f4eb4325150a7fe3bdf1d8eb'
font = TTFont(io.BytesIO(source), recalcTimestamp=False)
# A PDF subset has one ToUnicode entry per glyph. Give each Unicode alias a
# distinct ID with precisely the existing outline and metrics, not a replacement.
order, seen = list(font.getGlyphOrder()), set()
for cp, glyph in sorted(font.getBestCmap().items()):
    if glyph in seen:
        name = 'fleetAlias%06X' % cp
        order.append(name)
        font['glyf'].glyphs[name] = font['glyf'][glyph]
        for metrics in ['hmtx', 'vmtx']:
            font[metrics][name] = font[metrics][glyph]
        for table in font['cmap'].tables:
            if table.isUnicode() and table.cmap.get(cp) == glyph:
                table.cmap[cp] = name
    seen.add(glyph)
font.setGlyphOrder(order)
font['glyf'].padding = 4
out = io.BytesIO()
font.save(out)
check = TTFont(io.BytesIO(out.getvalue()))
assert len(set(check.getBestCmap().values())) == len(check.getBestCmap())
assert all(i % 4 == 0 for i in check['loca'].locations)
packed = gzip.compress(out.getvalue(), compresslevel=9, mtime=0)
Path(sys.argv[2]).write_bytes(packed)
print('Static TTF:', hashlib.sha256(out.getvalue()).hexdigest(), 'Gzip:', hashlib.sha256(packed).hexdigest())
