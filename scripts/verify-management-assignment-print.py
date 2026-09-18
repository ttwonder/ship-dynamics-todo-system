"""Verify actual Chromium / native-Excel A4 portrait PDFs and render for review.
Run: python3 scripts/verify-management-assignment-print.py <browser-evidence-dir>
Requires pypdf and pypdfium2; run the browser and native-Excel checks first.
"""
from pathlib import Path
import json
import re
import sys
import unicodedata
from pypdf import PdfReader
import pypdfium2 as pdfium

root = Path(sys.argv[1]).resolve()
evidence = json.loads((root / 'evidence.json').read_text(encoding='utf-8'))
assert evidence['status'] == 'PASS'
assert len(evidence['expectedNames']) == evidence['rowCount']

def normalized(value):
    return re.sub(r'\s+', '', unicodedata.normalize('NFKC', value))

names = [name for vessel in evidence['expectedNames'] for name in [vessel['english'], vessel['chinese'] if re.search('[\u3400-\u9fff]', vessel['chinese']) else ''] if name]
required = names + evidence['departments'] + ['年份', '噸數', '2021.06', '2.0萬', '2021.06.30', '20,000 DWT'] + ['測試督導甲', '林督乙', '測試代理丙*', '未激活代理丁', '林管甲', '陳資乙', '王營丙', '李航丁', '黃員戊', '吳技己']
required += ['油輪船隊', '散貨船隊', '油輪', '化學船']
required += ['註：()為職務代理人', '註2：船隊加油業務(燃油/潤滑油)改為資材組-王梓名負責。']
receipts = []
for name in ['management-assignments.pdf', 'excel-ships.pdf', 'excel-ships-vessel-entry.pdf']:
    source = root / name
    reader = PdfReader(source)
    assert len(reader.pages) == 1, (name, 'must be one complete page', len(reader.pages))
    page = reader.pages[0]
    width, height = float(page.mediabox.width), float(page.mediabox.height)
    assert abs(width - 595.28) < 2 and abs(height - 841.89) < 2, (name, width, height)
    text = normalized(page.extract_text())
    for value in required:
        assert normalized(value) in text, (name, 'missing printed text', value)
    for value in ['來源版本', 'Rev.', 'PRIVATE_', 'QA UNSAVED NAME', 'INACTIVE SHIP', '停用人員戊', '未激活代理丁*', '年分']:
        assert normalized(value) not in text, (name, 'forbidden text', value)
    with pdfium.PdfDocument(source) as document:
        rendered = document[0]
        textpage = rendered.get_textpage()
        boxes = [textpage.get_charbox(i) for i in range(textpage.count_chars()) if textpage.get_text_range(i, 1).strip()]
        assert boxes and all(10 <= left <= right <= width - 10 and 10 <= bottom <= top <= height - 10 for left, bottom, right, top in boxes), (name, 'text outside printable page')
        rendered.render(scale=2).to_pil().save(root / (source.stem + '.png'))
        textpage.close()
        rendered.close()
    receipts.append({'file': name, 'pages': len(reader.pages), 'width_pt': width, 'height_pt': height,
                     'all_ship_names_present': True, 'both_notes_present': True, 'ship_rows': evidence['rowCount'], 'text_within_page': True})
(root / 'print-verification.json').write_text(json.dumps(receipts, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'status': 'PASS', 'portrait_single_page_pdfs': len(receipts), 'ship_rows_per_pdf': evidence['rowCount']}))
