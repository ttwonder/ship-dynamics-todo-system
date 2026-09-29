"""Verify real Chromium report files; this is artifact QA, not hosted acceptance."""
import json, pathlib, sys, unicodedata
from pypdf import PdfReader
import pypdfium2 as pdfium
root = pathlib.Path(sys.argv[1])
texts, results = [], []
for name in ('homepage-morning', 'center-morning'):
    source = root / (name + '.pdf')
    reader = PdfReader(source)
    pages = [unicodedata.normalize('NFKC', page.extract_text() or '') for page in reader.pages]
    assert pages and all(text.strip() for text in pages), 'blank or missing PDF page'
    assert all(float(p.mediabox.width) > float(p.mediabox.height) for p in reader.pages), 'A4 landscape required'
    text = '\n'.join(pages)
    # Chromium glyph positions may produce extraction-only spaces (Q A / T ASK).
    # This normalizes displayed prose only, never a stored business identifier.
    semantic = ''.join(text.split())
    for expected in ('船舶早會動態暨待辦報告', 'QA VESSEL 1', 'QA VESSEL 2', 'MW HISTORY TASK 03'):
        assert ''.join(expected.split()) in semantic, expected
    for forbidden in ('MW HISTORY TASK 05', 'QA_UNLOADED_DETAIL_SENTINEL', '船隊看板'):
        assert ''.join(forbidden.split()) not in semantic, forbidden
    texts.append(text)
    doc = pdfium.PdfDocument(str(source))
    for index in sorted({0, len(doc) - 1}):
        doc[index].render(scale=1.2).to_pil().save(root / f'{name}-page-{index + 1}.png')
    results.append({'file': source.name, 'pages': len(pages), 'bytes': source.stat().st_size})
assert texts[0] == texts[1], 'home and center must produce identical report text'
receipt = {'status': 'PASS', 'layer': 'real-Chromium-PDF-files', 'files': results, 'same_report_text': True}
(root / 'pdf-artifact-results.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(receipt, ensure_ascii=False))
