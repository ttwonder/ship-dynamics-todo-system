import type { AppData, TaskItem, UserAccount, Vessel } from './types';

export default function WorkCenter({ data, user, vessels, onOpenTask, markAllRead }: { data: AppData; user: UserAccount; vessels: Vessel[]; onOpenTask: (task: TaskItem) => void; markAllRead: () => void }) {
  const vesselIds = new Set(vessels.filter(vessel => vessel.assignedUserIds.includes(user.id) || user.managedVesselIds.includes(vessel.id)).map(vessel => vessel.id));
  const tasks = data.tasks.filter(task => !task.isClosed && (vesselIds.has(task.vesselId) || task.ownerUserIds.includes(user.id)));
  const changes = data.notifications.filter(item => item.userId === user.id).sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  const unread = changes.filter(item => !item.readAt);
  const vesselName = (id: string) => { const vessel=data.vessels.find(item=>item.id===id); return vessel?.shortName||vessel?.name||id; };
  return <div className="work-center">
    <div className="page-heading"><div><h1>我的待辦與通知</h1><p>只彙集您分管船舶的未結事項和變動。</p></div>{unread.length>0&&<button className="btn primary" onClick={markAllRead}>全部標記已讀（{unread.length}）</button>}</div>
    <section className="panel"><div className="panel-title"><h2>分管船舶待辦清單 <span className="muted">({tasks.length})</span></h2></div>
      {tasks.length?<div className="work-task-list">{tasks.map(task=><button key={task.id} className="work-task-row" onClick={()=>onOpenTask(task)}><span><b>{vesselName(task.vesselId)}</b>{task.isInternalControl&&<em className="internal-control-tag">內部管控</em>}{task.isAbnormal&&<em className="inline-abnormal">異常</em>}</span><strong>{task.description}</strong><small>{task.priority}｜期限 {task.expectedDate||'未設定'}｜{task.status||'尚未更新'}</small></button>)}</div>:<div className="empty-state compact">目前沒有分管船舶未結待辦</div>}
    </section>
    <div className="work-columns">
      <section className="panel"><div className="panel-title"><h2>通知 <span className="muted">({unread.length} 未讀)</span></h2></div>{unread.length?<div className="notice-list">{unread.map(item=><article key={item.id} className="notice-item unread"><b>{item.title}</b><p>{item.message}</p><small>{vesselName(item.vesselId)}｜{new Date(item.createdAt).toLocaleString('zh-TW')}</small></article>)}</div>:<div className="empty-state compact">目前沒有未讀通知</div>}</section>
      <section className="panel"><div className="panel-title"><h2>變動清單</h2></div>{changes.length?<div className="notice-list">{changes.map(item=><article key={item.id} className={`notice-item ${item.readAt?'':'unread'}`}><b>{item.title}</b><p>{item.message}</p><small>{vesselName(item.vesselId)}｜{new Date(item.createdAt).toLocaleString('zh-TW')}</small></article>)}</div>:<div className="empty-state compact">目前沒有變動紀錄</div>}</section>
    </div>
  </div>;
}
