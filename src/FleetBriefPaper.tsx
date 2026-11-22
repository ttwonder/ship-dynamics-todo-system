import type {FleetBriefReport, FleetBriefSection} from './fleetBriefTypes';

function lamp(section:FleetBriefSection, col:number, line:string) {
  const kind=section.columns[col].kind;
  if ((section.theme==='control'||section.theme==='task') && kind==='level') {
    return line==='急'?'urgent':line==='高'?'high':line==='中'?'medium':null;
  }
  const isPrimary=['gulf','australia','china','dock'].includes(section.theme??'');
  const source=kind==='risk'?line:isPrimary&&kind==='note'&&line.startsWith('Tokyo MOU：')?line.slice('Tokyo MOU：'.length):'';
  const grade=source.split('｜',1)[0];
  return grade==='HRS'||grade==='SRS'||grade==='LRS'?grade:grade==='未知（未取得）'?'unknown':null;
}
function Cell({section,col,value}:{section:FleetBriefSection;col:number;value:string}) {
  const split=value.indexOf('\n'), first=split<0?value:value.slice(0,split), light=lamp(section,col,first);
  if(!light)return <td>{value}</td>;
  return <td><span className="brief-grade" data-lamp={light}><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    {light==='urgent'&&<circle cx="8" cy="8" r="7" fill="none" stroke="currentColor"/>}
    <circle cx="8" cy="8" r={light==='urgent'?4.5:6.5} fill="currentColor"/></svg>{first}</span>{split>=0&&value.slice(split)}</td>;
}

// Reserve the widest column for narratives. Within the metadata budget, short
// headings/dates surrender spare space to names and ports. No DOM/font measuring.
function widths(s:FleetBriefSection) {
  const weights=s.columns.map((c,i)=>{
    if(c.kind==='note'||c.kind==='content'||c.kind==='published')return 0;
    const max=c.label==='序'?3:c.kind==='level'?9:20;
    let w=Math.min(max,c.label.length+1);
    for(const row of s.rows){if(w>=max)break; for(const line of (row[i]??'').slice(0,80).split('\n'))w=Math.max(w,Math.min(max,Array.from(line).reduce((n,ch)=>n+(ch.charCodeAt(0)>255?1:.55),1)));}
    return w;
  });
  // Calculate the previous content-aware shares before assigning the new time
  // column: it takes only the released ship-name space, not narrative space.
  const published=s.columns.findIndex(c=>c.kind==='published');
  const count=s.columns.filter(c=>c.kind==='note'||c.kind==='content').length, total=weights.reduce((a,b)=>a+b,0);
  const reserved=count?(s.columns.length-Number(published>=0)<=3?66:38):0;
  const shares=weights.map((w,i)=>i===published?0:w?w/total*(100-reserved):reserved/count);
  const ship=s.columns.findIndex(c=>c.kind==='vessel');
  if(s.theme==='control' && published>=0 && ship>=0){
    shares[ship]/=3; shares[published]=shares[ship]*2;
  }
  const crew=s.columns.findIndex(c=>c.label==='主要船員'), port=s.columns.findIndex(c=>c.label==='港口／位置');
  const etd=s.columns.findIndex(c=>c.label.endsWith('ETD')), note=s.columns.findIndex(c=>c.kind==='note');
  if(crew>=0 && ship>=0 && port>=0 && etd>=0 && note>=0){
    let released=0;
    for(const i of [ship,port,etd]) {const give=shares[i]*.18; shares[i]-=give; released+=give;}
    // Double the crew column unless exceptionally long names would make the
    // remarks column narrower than crew. Keep the full table at 100%.
    const extra=Math.min(shares[crew],(shares[note]+released-shares[crew])/2);
    shares[crew]+=extra; shares[note]+=released-extra;
  }
  return shares.map(w=>`${w}%`);
}
export function FleetBriefPaper({report}:{report:FleetBriefReport}) {
  return <article className="fleet-brief-paper" lang="zh-Hant"><div className="brief-mast"><h2>船隊重點摘要</h2><time>{report.date}</time></div>
    <p className="brief-notice">{report.notice}</p>{report.sections.map(s=><section key={s.title} data-theme={s.theme}>
      <table><colgroup>{widths(s).map((w,i)=><col key={i} style={{width:w}}/>)}</colgroup>
        <thead><tr><th className="brief-section-name" colSpan={s.columns.length}>{s.title}</th></tr><tr>{s.columns.map((c,i)=><th scope="col" key={i} className={c.label==='ETD'?'brief-etd-heading':undefined}>{c.label}</th>)}</tr></thead>
        <tbody>{s.rows.length?s.rows.map((row,i)=><tr key={i}>{s.columns.map((_,j)=><Cell key={j} col={j} section={s} value={row[j]??''}/>)}</tr>):<tr><td colSpan={s.columns.length}>無符合項目</td></tr>}</tbody>
      </table></section>)}</article>;
}
