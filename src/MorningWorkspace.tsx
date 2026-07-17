
import type { AppData, TaskItem, UserAccount, Vessel } from './types';
import { daysDiff, nowIso, uid, yesterdayDate } from './utils';

type Props = {
  data: AppData;
  user: UserAccount;
  visibleVessels: Vessel[];
  selected: string[];
  setSelected: (ids:string[]) => void;
  onEditTask: (task:TaskItem) => void;
  onOpenVessel: (id:string) => void;
  onOpenTemporaryMeeting: () => void;
  onOpenReport: () => void;
  commit: (mutate:(draft:AppData)=>void, action:string, entityType:string, entityId:string, detail:string)=>void;
};

const priorityOrder = { 高:0, 中:1, 低:2 } as const;

export default function MorningWorkspaceView({ data, user, visibleVessels, selected, setSelected, onEditTask, onOpenVessel, onOpenTemporaryMeeting, onOpenReport, commit }:Props) {
  const allIds = visibleVessels.map(v => v.id);
  const showAll = selected.length === 0 || selected.length === visibleVessels.length;
  const scopeIds = showAll ? allIds : selected.filter(id => allIds.includes(id));
  const scopeSet = new Set(scopeIds);
  const discussionVessels = visibleVessels.filter(v => scopeSet.has(v.id));
  const discussionTasks = data.tasks.filter(t => scopeSet.has(t.vesselId) && !t.isClosed).sort((a,b) => {
    const vesselDiff = scopeIds.indexOf(a.vesselId) - scopeIds.indexOf(b.vesselId);
    return vesselDiff || priorityOrder[a.priority] - priorityOrder[b.priority] || (daysDiff(a.expectedDate) ?? 999) - (daysDiff(b.expectedDate) ?? 999);
  });
  const allScopeTasks = data.tasks.filter(t => scopeSet.has(t.vesselId));
  const yesterdayOpen = discussionTasks.filter(t => (t.updatedAt || t.createdAt).slice(0,10) <= yesterdayDate()).length;
  const high = discussionTasks.filter(t => t.priority === '高').length;
  const completed = allScopeTasks.filter(t => t.isClosed).length;
  const completion = allScopeTasks.length ? Math.round(completed / allScopeTasks.length * 100) : 0;
  const toggle = (id:string) => setSelected(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);
  const saveAgenda = () => {
    if (!scopeIds.length) return alert('目前沒有可加入早會的船舶');
    const id = uid('agenda');
    commit(d => { d.agendaReports.unshift({ id, title:'船舶早會動態暨待辦報告', vesselIds:scopeIds, createdBy:user.id, createdAt:nowIso(), taskCount:discussionTasks.length }); }, '保存早會報告紀錄', 'agenda', id, `${scopeIds.length} 艘船、${discussionTasks.length} 件事項`);
    alert('早會報告紀錄已保存；日後檢視會使用當時選船範圍與目前最新資料。');
  };
  const openReport = () => { if (showAll) setSelected(allIds); onOpenReport(); };

  return <section><div className="page-heading"><div><h1>今日早會工作台</h1><p>左側勾選討論範圍；未選或全選時，中間顯示全部內容。</p></div><div className="heading-actions no-print"><button className="btn ghost" onClick={onOpenTemporaryMeeting}>＋ 臨時會議</button><button className="btn green" onClick={saveAgenda}>保存早會</button><button className="btn primary" onClick={openReport}>預覽 PDF</button></div></div>
    {!visibleVessels.length ? <div className="empty-state"><h3>目前沒有可見船舶</h3></div> : <div className="morning-workspace">
      <aside className="meeting-column vessel-rail"><div className="column-title"><div><h2>今日討論船舶</h2><span>{showAll ? `全部 ${visibleVessels.length} 艘` : `已選 ${selected.length} 艘`}</span></div><button className="btn small ghost" aria-label="全選討論船舶" onClick={() => setSelected(allIds)}>全選</button></div><div className="vessel-rail-tools no-print"><button className="btn small ghost" onClick={() => setSelected([])}>清空（顯示全部）</button></div><div className="column-scroll">{visibleVessels.map(v => { const vt=data.tasks.filter(t=>t.vesselId===v.id&&!t.isClosed); const hi=vt.filter(t=>t.priority==='高').length; return <button key={v.id} className={`mini-ship-card ${selected.includes(v.id)?'active':''}`} onClick={() => toggle(v.id)}><span className="mini-ship-head"><span className={`meeting-check ${selected.includes(v.id)?'on':''}`}>{selected.includes(v.id)?'✓':''}</span><b>{v.shortName||v.name}</b>{hi>0&&<i>高 {hi}</i>}</span><span>{v.position.lastPort||v.position.location} → {v.position.nextPort||'未設定'}</span><small>{v.position.speedKnots||0} kn｜{v.cargo.name||'未填貨名'}</small></button>})}</div></aside>
      <section className="meeting-column agenda-column"><div className="column-title"><div><h2>逐項討論與決議</h2><span>{showAll ? '顯示全部內容' : `${discussionVessels.length} 艘船`}</span></div></div><div className="column-scroll"><div className="meeting-vessel-summary"><div><h2>{discussionVessels.length===1 ? (discussionVessels[0].shortName||discussionVessels[0].name) : '全部討論內容'}</h2><p>{discussionVessels.length} 艘船｜{discussionTasks.length} 件未結事項｜高關注 {high} 件</p></div><span>早會進行中</span></div>{discussionTasks.length ? discussionTasks.map((t,index) => { const vessel=visibleVessels.find(v=>v.id===t.vesselId); return <article className={`meeting-agenda-card priority-${t.priority}`} key={t.id}><div className="agenda-number">{String(index+1).padStart(2,'0')}</div><div className="agenda-content"><div className="agenda-vessel-label">{vessel?.shortName||vessel?.name||'未明船舶'}</div><h3>{t.description||'尚未輸入事項內容'}</h3><p>{t.priority}關注｜{t.category}｜{t.departments.join('、')||'未指定部門'}｜期限 {t.expectedDate||'未設定'}</p><div className="agenda-status"><b>目前狀態：</b>{t.status||'尚未更新狀態'}</div><div className="agenda-actions no-print"><button className="btn small primary" onClick={()=>onEditTask(t)}>更新狀態／決議</button><button className="btn small ghost" onClick={()=>vessel&&onOpenVessel(vessel.id)}>更新船舶</button></div></div></article>}) : <div className="empty-state compact">目前討論範圍沒有未結事項</div>}</div></section>
      <aside className="meeting-column summary-column"><div className="column-title"><h2>早會即時摘要</h2></div><div className="column-scroll"><div className="summary-card pink"><h3>昨日未結</h3><b>{yesterdayOpen}</b><span> 件</span><small>高關注 {high} 件</small></div><div className="summary-card blue"><h3>本次早會</h3><div className="summary-line"><span>討論船舶</span><b>{scopeIds.length}</b></div><div className="summary-line"><span>未結議題</span><b>{discussionTasks.length}</b></div><div className="summary-line"><span>高關注</span><b>{high}</b></div></div><div className="summary-card mint"><h3>討論範圍完成率</h3><b>{completion}%</b><div className="progress"><span style={{width:`${completion}%`}}/></div></div><div className="summary-card"><h3>報告內容</h3>{discussionVessels.map(v=><div className="summary-line" key={v.id}><span>{v.shortName}</span><b>{data.tasks.filter(t=>t.vesselId===v.id&&!t.isClosed).length} 項</b></div>)}<button className="btn primary full" onClick={openReport}>預覽美觀 PDF</button></div></div></aside>
    </div>}
  </section>;
}
