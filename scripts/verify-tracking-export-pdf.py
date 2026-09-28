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
pdf = pypdfium2.PdfDocument(str(source))
for index in sorted({0, len(pdf) - 1}):
    page = pdf[index]
    image = page.render(scale=1.5).to_pil()
    target = source.with_name(f"{source.stem}-page-{index+1}.png")
    image.save(target)
    rasters.append(str(target))
    page.close()
pdf.close()
receipt = {"status": "PASS", "file": str(source), "pages": len(reader.pages), "expected": expected,
           "absent": json.loads(args.absent), "text": str(text_path), "rasters": rasters,
           "pageSizes": [[float(page.mediabox.width), float(page.mediabox.height)] for page in reader.pages]}
source.with_suffix(".readback.json").write_text(json.dumps(receipt, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(receipt))
