"""Check final PDF colors with synthetic-only data. Uses verify-fleet-brief-pdf.py's browser harness."""
from pathlib import Path
import runpy
import sys
import tempfile
import pymupdf

base = runpy.run_path(str(Path(__file__).with_name('verify-fleet-brief-pdf.py')))
evidence = Path(sys.argv[1]).resolve()
assert not evidence.is_relative_to(base['ROOT'])
evidence.mkdir(parents=True, exist_ok=True)
out = Path(tempfile.mkdtemp(prefix='fleet-brief-colors-', dir=evidence))
sections = []
for theme, title, grade in [('gulf','波斯灣船舶','HRS'), ('australia','澳洲船舶','SRS'), ('china','中國船舶','LRS'), ('dock','塢修船舶','未知（未取得）')]:
    sections.append(dict(theme=theme,title=title, columns=[{'label':'船舶','kind':'vessel'},{'label':'備註','kind':'note'}],rows=[['示範輪','Tokyo MOU：'+grade+'\n一般備註：HRS 僅作引述。']]))
for theme,title,rows in [('control','未結內控',[['急','範例一'],['高','範例二']]),('task','未結要事',[['中','範例三']])]:
    sections.append(dict(theme=theme,title=title,columns=[{'label':'關注程度','kind':'level'},{'label':'事項內容','kind':'content'}],rows=rows))
sections.append(dict(theme='hrs',title='高風險船舶',columns=[{'label':'船舶','kind':'vessel'},{'label':'Tokyo MOU 風險','kind':'risk'},{'label':'備註','kind':'note'}],rows=[['示範甲','HRS｜取得：2031/04/05','Tokyo MOU：LRS（人員文字，不是本船等級）']]))
pdf = base['render'](dict(date='2031-04-05',notice='配色檢查｜示範資料',sections=sections),out)

def channel(c): return tuple(((c >> n) & 255)/255 for n in (16,8,0))
def lum(rgb): return sum(w*(c/12.92 if c <= .04045 else ((c+.055)/1.055)**2.4) for w,c in zip((.2126,.7152,.0722),rgb))

with pymupdf.open(pdf) as doc:
    def letters(page):
        return [(c['c'],s['color'],c['origin']) for b in page.get_text('rawdict')['blocks'] for l in b.get('lines',[]) for s in l['spans'] for c in s['chars']]
    pages=[letters(p) for p in doc]
    def locate(text):
        for pno,chars in enumerate(pages):
            idx=''.join(c[0] for c in chars).find(text)
            if idx>=0: return pno,chars[idx:idx+len(text)]
        raise AssertionError('Not found: '+text)
    def color(text):
        _,chars=locate(text)
        assert len({c[1] for c in chars})==1, text
        return chars[0][1]
    fills=[]
    for s in sections:
        pno, sequence=locate(s['title']+s['columns'][0]['label']);_,fg,(x,y)=sequence[len(s['title'])]
        d=next(d for d in doc[pno].get_drawings() if d.get('fill') and d['rect'].contains(pymupdf.Point(x+1,y-1)))
        fill=d['fill']; assert lum(fill)>.70 and (lum(fill)+.05)/(lum(channel(fg))+.05)>=4.5, ('light header with readable text',s['title'],fill)
        fills.append(tuple(round(c,3) for c in fill))
    assert len(set(fills))==len(sections),'all chapter headers must be distinguishable'
    def grade(g):
        _,v=locate('Tokyo MOU：'+g+'一般備註');return v[len('Tokyo MOU：')][1]
    assert len({grade(g) for g in ['HRS','SRS','LRS','未知（未取得）']})==4
    assert len({locate(s)[1][0][1] for s in ('急範例一','高範例二','中範例三')})==3
    assert locate('HRS｜取得')[1][0][1]==grade('HRS')
    assert color('一般備註：HRS 僅作引述。')==color('Tokyo MOU：LRS（人員文字，不是本船等級）')
    assert grade('HRS') != color('一般備註：HRS 僅作引述。')
    def light(before):
        pno,chars=locate(before); _,_,(x,y)=chars[0]
        disks=[d for d in doc[pno].get_drawings() if d.get('fill') and any(i[0]=='c' for i in d['items']) and 5<d['rect'].width<12 and x-20<d['rect'].x0<x and y-14<d['rect'].y0<y]
        assert len(disks)==1,('expected exactly one vector traffic light next to the label',before)
        return disks[0]['fill']
    red=light('Tokyo MOU：HRS'); yellow=light('Tokyo MOU：SRS'); green=light('Tokyo MOU：LRS'); gray=light('Tokyo MOU：未知');
    assert red[0]>2*red[1] and yellow[0]>yellow[1]>2*yellow[2] and green[1]>1.6*green[0] and max(gray)-min(gray)<.14
    assert light('高範例二')==red and light('中範例三')==yellow and light('HRS｜取得')==red
    assert light('急範例一')!=red
    print('PASS: seven pale section fills, contrasting header labels, four PSC grades, three priorities, neutral operator text.',pdf)
