"""Read and rasterize actual Chromium PDFs from the isolated month-export runner."""
import argparse
import json
from pathlib import Path
import re
import unicodedata
from pypdf import PdfReader
import pypdfium2

parser = argparse.ArgumentParser()
parser.add_argument("pdf")
parser.add_argument("--expect", required=True, help="JSON expected marker array")
parser.add_argument("--absent", default='["EXCLUDE-", "MUTATED-AFTER-SNAPSHOT"]')
parser.add_argument("--grouped", action="store_true")
parser.add_argument("--long-markers", action="store_true")
parser.add_argument("--list-markers", action="store_true")
args = parser.parse_args()
source = Path(args.pdf)
reader = PdfReader(source)
assert not reader.is_encrypted
assert reader.pages, "Empty PDF"
raw = "\n".join(page.extract_text() or "" for page in reader.pages)
# Normalization is only for display prose, never for source IDs.
prose = re.sub(r"\s+", "", unicodedata.normalize("NFKC", raw))
assert "applicationDate" in prose and "自然月" in prose, "Month/date-basis provenance absent"
expected = json.loads(args.expect)
for marker in expected:
    assert marker in raw, f"Expected business marker absent: {marker}"
for marker in json.loads(args.absent):
    assert marker not in raw, f"Excluded marker leaked: {marker}"
for page in reader.pages:
    assert float(page.mediabox.width) > float(page.mediabox.height), "Landscape format lost"
text_path = source.with_suffix(".txt")
text_path.write_text(raw, encoding="utf-8")
rasters = []
geometry = []
if args.grouped:
    for page in reader.pages:
        page_prose = re.sub(r"\s+", "", unicodedata.normalize("NFKC", page.extract_text() or ""))
        for header in ["編號/類型/請購資訊", "申請/期望/實際日期", "補充說明/最新進度"]:
            assert header in page_prose, f"Grouped header absent on a continuation page: {header}"
if args.long_markers:
    for prefix, count in [("D", 180), ("N", 90), ("P", 90)]:
        tokens = re.findall(prefix + r"\d{4}", raw)
        assert tokens == [f"{prefix}{i:04d}" for i in range(count)], f"Missing, duplicate or out-of-order {prefix} content"
if args.list_markers:
    assert re.findall(r"DESC-\d{3}", raw) == [f"DESC-{i:03d}" for i in range(1, 73)], "Missing, duplicated or reordered list items"
pdf = pypdfium2.PdfDocument(str(source))
if args.list_markers or args.long_markers:
    markers = [f"DESC-{i:03d}" for i in range(1, 73)] if args.list_markers else ["DESC-001", "D0000", "D0179", "DESC-003"]
    for marker in markers:
        found = []
        for index, page in enumerate(pdf):
            textpage = page.get_textpage()
            search = textpage.search(marker, match_case=True)
            match = search.get_next()
            if match:
                box = textpage.get_charbox(match[0])
                found.append({"marker": marker, "page": index, "box": list(box)})
                assert box[0] >= 0 and box[2] <= page.get_width() and box[1] >= 0 and box[3] <= page.get_height(), "Marker outside physical page"
            search.close()
            textpage.close()
            page.close()
        assert len(found) == 1, f"Expected one marker: {marker}: {found}"
        geometry.extend(found)
    for previous, current in zip(geometry, geometry[1:]):
        assert current["page"] > previous["page"] or (current["page"] == previous["page"] and current["box"][3] < previous["box"][1]), "Rows overlap or are out of physical order"

for index in sorted({0, min(1, len(pdf) - 1), len(pdf) - 1}):
    page = pdf[index]
    image = page.render(scale=1.5).to_pil()
    target = source.with_name(f"{source.stem}-page-{index+1}.png")
    image.save(target)
    rasters.append(str(target))
    page.close()
pdf.close()
receipt = {"status": "PASS", "file": str(source), "pages": len(reader.pages), "expected": expected,
           "absent": json.loads(args.absent), "text": str(text_path), "rasters": rasters, "geometry": geometry,
           "pageSizes": [[float(page.mediabox.width), float(page.mediabox.height)] for page in reader.pages]}
source.with_suffix(".readback.json").write_text(json.dumps(receipt, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(receipt))
