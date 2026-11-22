"""Real browser Blob + independent PDF verification (no application or HTTP server).

Requires project node_modules, Chrome, Python playwright, PyMuPDF and fontTools.
Run: python scripts/verify-fleet-brief-pdf.py <absolute external evidence directory>
Only this test writes the synthetic artifact; it does not use the browser download API.
"""
import base64
import io
import gzip
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlsplit

import pymupdf
from fontTools.ttLib import TTFont
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ORIGIN = 'https://fleet-pdf.invalid'
PREFIX = '/test/subpath/'


def render(report, output, *, decoded_font=False):
    assert (ROOT / 'src/fleetBriefPdf.ts').is_file(), 'buildFleetBriefPdf is missing: cannot return a PDF Blob'
    bundle = output / 'bundle'
    if not bundle.exists():
        subprocess.run(['node', '--input-type=module', '-e', '''
      import {build} from 'vite';
      await build({ configFile:false, envDir:false, base:'/test/subpath/', publicDir:false,
        build:{outDir:process.argv[1], emptyOutDir:false, rollupOptions:{input:'src/fleetBriefPdf.ts',
          preserveEntrySignatures:'strict', output:{entryFileNames:'entry.js'}}}});
        ''', str(bundle)], cwd=ROOT, check=True, timeout=90)
    files = {PREFIX + p.relative_to(bundle).as_posix(): p for p in bundle.rglob('*') if p.is_file()}
    assets = ROOT / 'public' / 'fleet-brief-pdf'
    files.update({PREFIX + 'fleet-brief-pdf/' + p.name: p for p in assets.glob('*.ttf.gz')})
    violations = []
    with sync_playwright() as driver:
        browser = driver.chromium.launch(channel='chrome', args=['--disable-background-networking'])
        context = browser.new_context(service_workers='block', accept_downloads=False)
        page = context.new_page()
        page.on('pageerror', lambda e: violations.append(str(e)))
        page.on('download', lambda _: violations.append('download'))
        page.on('popup', lambda _: violations.append('popup'))

        def route_request(route):
            url = urlsplit(route.request.url)
            if (url.scheme + '://' + url.netloc == ORIGIN and not url.query and
                    route.request.method == 'GET' and route.request.post_data is None):
                if url.path == PREFIX:
                    return route.fulfill(content_type='text/html', body='<meta charset="utf-8"><title>TEST ONLY</title>')
                if url.path in files:
                    # Model the body a browser exposes after Content-Encoding: gzip.
                    if decoded_font and url.path.endswith('.ttf.gz'):
                        return route.fulfill(body=gzip.decompress(files[url.path].read_bytes()), content_type='font/ttf')
                    return route.fulfill(path=files[url.path], content_type='text/javascript' if url.path.endswith('.js') else 'application/octet-stream')
            violations.append((route.request.method, route.request.url))
            route.abort()

        context.route('**/*', route_request)
        page.goto(ORIGIN + PREFIX)
        encoded = page.evaluate('''async report => {
          const {buildFleetBriefPdf} = await import('./entry.js');
          const blob = await buildFleetBriefPdf(report);
          if (!(blob instanceof Blob) || blob.type !== 'application/pdf') throw Error('Expected application/pdf Blob');
          return new Promise((resolve,reject) => {const reader = new FileReader();
            reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = reject;
            reader.readAsDataURL(blob);});
        }''', report)
        browser.close()
    assert not violations, violations
    result = output / ('synthetic-short.pdf' if decoded_font else 'synthetic-fleet-brief.pdf')
    result.write_bytes(base64.b64decode(encoded, validate=True))
    return result


def main():
    evidence = Path(sys.argv[1])
    assert evidence.is_absolute() and not evidence.resolve().is_relative_to(ROOT)
    evidence.mkdir(parents=True, exist_ok=True)
    output = Path(tempfile.mkdtemp(prefix='fleet-brief-', dir=evidence))
    report = {'date': '2031-04-05', 'notice': '合成測試：非正式報告。', 'sections': [
        {'title': '塢修船舶', 'columns': [{'label': '船舶', 'kind': 'vessel'}, {'label': '備註', 'kind': 'note'}],
         'rows': [['測試輪 QA ONE', '核對臺灣繁體備註：甲·乙•丙‧丁。']]},
    ]}
    pdf = render(report, output, decoded_font=True)
    with pymupdf.open(pdf) as doc:
        assert doc.is_pdf and len(doc) == 1
        page = doc[0]
        assert page.rect.width > page.rect.height
        text = page.get_text()
        for field in ['船隊重點摘要', report['date'], report['notice'], '塢修船舶', '船舶', '備註', *report['sections'][0]['rows'][0]]:
            assert field in text, field
        for font in page.get_fonts():
            data = doc.extract_font(font[0])[-1]
            assert data, 'font not embedded'
            with TTFont(io.BytesIO(data)) as tt:
                for glyph in tt.getGlyphOrder():
                    tt['glyf'][glyph].getCoordinates(tt['glyf'])
    # Synthetic Word-style layout plus a compact content section. Names and prose
    # are invented; no reference document, application state or private data is read.
    cols = list(zip(['番號','船名','船長/大副','輪機長/大管輪','港口/目的港','ETA/ETB','ETD','備註'],
                    ['level','vessel','vessel','vessel','port','port','port','note']))
    remarks = '最新風險：HRS（合成測試）\n' + ''.join(f'第{i:03}段：核對船況與交接紀錄。' for i in range(96)) + '備註結束'
    content = '無空格長字串：' + 'ABCDEFGH01234567' * 156 + '\n最後一行。'
    section = lambda title, cols, rows: {'title': title, 'columns': [{'label': label,'kind': kind} for label,kind in cols], 'rows':rows}
    cases = [section('測試區域', cols, [['01','測試輪','測試甲\n測試乙','測試丙\n測試丁','測試港口','04/05','04/06',remarks]]),
             section('測試要事', [('船名','vessel'),('程度','level'),('事項內容','content')], [['測試乙輪','高',content]]),
             section('測試空節', [('船舶','vessel')], [])]
    pdf = render({**report, 'sections':cases}, output)
    with pymupdf.open(pdf) as doc:
        assert len(doc) >= 4, 'long cells must span landscape pages, never leave the page'
        joined = ['', '']
        widths = []
        for page in doc:
            assert abs(page.rect.width-841.89)<0.1 and abs(page.rect.height-595.28)<0.1
            spans = [s for b in page.get_text('dict')['blocks'] for line in b.get('lines',[]) for s in line['spans']]
            for s in spans:
                assert page.rect.contains(pymupdf.Rect(s['bbox'])), (page.number, s)
            assert '船隊重點摘要' in page.get_text()
            # Collect body text from actual drawn cells rather than page reading order:
            # repeated headings/other columns must not mask omissions or duplication.
            boxes = [pymupdf.Rect(d['rect']) for d in page.get_drawings() if d['rect'].height > 10]
            for i, title in enumerate(['測試區域','測試要事']):
                label = ['備註','事項內容'][i]
                headings = [s for s in spans if s['text'] == label]
                for h in headings:
                    assert title in page.get_text()
                    def inside(s, b):
                        x,y=s['origin']; return b.x0<x<b.x1 and b.y0<y<b.y1
                    header = next(b for b in boxes if inside(h,b))
                    if i==0:
                        siblings = sorted((b for b in boxes if abs(b.y0-header.y0)<0.1 and abs(b.y1-header.y1)<0.1),key=lambda b:b.x0)
                        assert len(siblings)==8
                        w = [round(b.width,1) for b in siblings]; widths.append(w)
                        assert w[-1]>max(w[:-1]) and w[-1]/sum(w)>0.30 and min(w[2:4])>w[0]
                    stop = min([s['bbox'][1] for s in spans if s['text'] in ['測試要事','測試空節'] and s['bbox'][1]>header.y1]+[page.rect.height-30])
                    for b in sorted(boxes, key=lambda b:b.y0):
                        if abs(b.x0-header.x0)<0.1 and abs(b.x1-header.x1)<0.1 and header.y1-0.1<=b.y0<stop:
                            for s in spans:
                                if inside(s,b):
                                    assert s['bbox'][2] < b.x1+0.1 and s['size'] >= 14
                                    joined[i]+=s['text']
        assert joined==[remarks.replace('\n',''),content.replace('\n','')], 'incomplete or duplicated narrative body'
        assert '無符合項目' in doc[-1].get_text()
        for i in {0,1,len(doc)-1}:
            doc[i].get_pixmap().save(output / f'page-{i+1}.png')
        print('PASS:', pdf, 'pages:',len(doc), '8-column widths (pt):', widths[0])


if __name__ == '__main__':
    main()
