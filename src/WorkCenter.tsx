import { useState } from 'react';
import { taskSourceLabel } from './taskWorkflow';
import type { AppData, TaskItem, TaskPriority, UserAccount, Vessel } from './types';
import { vesselDisplayName } from './vesselDisplay';

type TaskSort = 'priority' | 'due-asc' | 'due-desc' | 'updated-desc' | 'vessel';
const priorityRank: Record<TaskPriority, number> = { '急': 0, '高': 1, '中': 2, '低': 3 };
const compareOptionalDate = (left: string, right: string, direction: 1 | -1) => {
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return left.localeCompare(right) * direction;
};

export default function WorkCenter({ data, user, vessels, onOpenTask, markAllRead }: { data: AppData; user: UserAccount; vessels: Vessel[]; onOpenTask: (task: TaskItem) => void; markAllRead: () => void }) {
  const [taskQuery, setTaskQuery] = useState('');
  const [taskVessel, setTaskVessel] = useState('all');
  const [taskPriority, setTaskPriority] = useState<'all' | TaskPriority>('all');
  const [taskSource, setTaskSource] = useState<'all' | 'morning' | 'temporary'>('all');
  const [taskSort, setTaskSort] = useState<TaskSort>('priority');
  const vesselIds = new Set(vessels.filter(vessel => vessel.assignedUserIds.includes(user.id) || user.managedVesselIds.includes(vessel.id)).map(vessel => vessel.id));
  const allTasks = data.tasks.filter(task => !task.isClosed && (vesselIds.has(task.vesselId) || task.ownerUserIds.includes(user.id)));
  const changes = data.notifications.filter(item => item.userId === user.id).sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  const unread = changes.filter(item => !item.readAt);
  const vesselName = (id: string) => vesselDisplayName(data.vessels.find(item=>item.id===id));
  const taskVessels = data.vessels.filter(vessel => allTasks.some(task => task.vesselId === vessel.id));
  const query = taskQuery.trim().toLowerCase();
  const filteredTasks = allTasks.filter(task => {
    if (taskVessel !== 'all' && task.vesselId !== taskVessel) return false;
    if (taskPriority !== 'all' && task.priority !== taskPriority) return false;
    const source = task.sourceType === 'temporary' || task.sourceMeetingId ? 'temporary' : 'morning';
    if (taskSource !== 'all' && source !== taskSource) return false;
    if (!query) return true;
    return [vesselName(task.vesselId), task.description, task.status, task.expectedDate, taskSourceLabel(task), ...(task.categories || []), ...task.departments]
      .join(' ').toLowerCase().includes(query);
  }).sort((left, right) => {
    if (taskSort === 'priority') return priorityRank[left.priority] - priorityRank[right.priority] || compareOptionalDate(left.expectedDate, right.expectedDate, 1) || right.updatedAt.localeCompare(left.updatedAt);
    if (taskSort === 'due-asc') return compareOptionalDate(left.expectedDate, right.expectedDate, 1) || priorityRank[left.priority] - priorityRank[right.priority];
    if (taskSort === 'due-desc') return compareOptionalDate(left.expectedDate, right.expectedDate, -1) || priorityRank[left.priority] - priorityRank[right.priority];
    if (taskSort === 'vessel') return vesselName(left.vesselId).localeCompare(vesselName(right.vesselId), 'zh-TW') || priorityRank[left.priority] - priorityRank[right.priority];
    return right.updatedAt.localeCompare(left.updatedAt);
  });
  const hasTaskFilters = Boolean(taskQuery.trim() || taskVessel !== 'all' || taskPriority !== 'all' || taskSource !== 'all' || taskSort !== 'priority');
  const resetTaskFilters = () => { setTaskQuery(''); setTaskVessel('all'); setTaskPriority('all'); setTaskSource('all'); setTaskSort('priority'); };
  return <div className="work-center">
    <div className="page-heading"><div><h1>我的待辦與通知</h1><p>彙集您負責的待辦、分管船舶事項和變動。</p></div>{unread.length>0&&<button className="btn primary" onClick={markAllRead}>全部標記已讀（{unread.length}）</button>}</div>
    <section className="panel"><div className="panel-title"><h2>我的待辦清單 <span className="muted">({filteredTasks.length}/{allTasks.length})</span></h2>{hasTaskFilters&&<button className="btn small ghost no-print" onClick={resetTaskFilters}>清除篩選</button>}</div>
      <div className="work-task-filters no-print">
        <input aria-label="我的待辦關鍵字" value={taskQuery} onChange={event=>setTaskQuery(event.target.value)} placeholder="搜尋船舶、內容、狀態、部門…" />
        <select aria-label="我的待辦船舶篩選" value={taskVessel} onChange={event=>setTaskVessel(event.target.value)}><option value="all">全部船舶</option>{taskVessels.map(vessel=><option key={vessel.id} value={vessel.id}>{vesselDisplayName(vessel)}</option>)}</select>
        <select aria-label="我的待辦關注程度篩選" value={taskPriority} onChange={event=>setTaskPriority(event.target.value as typeof taskPriority)}><option value="all">全部關注程度</option>{data.settings.priorities.map(priority=><option key={priority}>{priority}</option>)}</select>
        <select aria-label="我的待辦來源篩選" value={taskSource} onChange={event=>setTaskSource(event.target.value as typeof taskSource)}><option value="all">全部來源</option><option value="morning">早會</option><option value="temporary">臨會/專題</option></select>
        <select aria-label="我的待辦排序" value={taskSort} onChange={event=>setTaskSort(event.target.value as TaskSort)}><option value="priority">關注程度：急到低</option><option value="due-asc">期限：近到遠</option><option value="due-desc">期限：遠到近</option><option value="updated-desc">最近更新</option><option value="vessel">船舶名稱</option></select>
      </div>
      {filteredTasks.length?<div className="work-task-list">{filteredTasks.map(task=><button key={task.id} className="work-task-row" onClick={()=>onOpenTask(task)}><span><b>{vesselName(task.vesselId)}</b>{task.isInternalControl&&<em className="internal-control-tag">內部管控</em>}{task.isAbnormal&&<em className="inline-abnormal">異常</em>}</span><strong>{task.description}</strong><small><span className="task-source-badge">{taskSourceLabel(task)}</span>｜{task.priority}｜期限 {task.expectedDate||'未設定'}｜{task.status||'尚未更新'}</small></button>)}</div>:<div className="empty-state compact">{allTasks.length ? '沒有符合目前條件的待辦' : '目前沒有分管船舶未結待辦'}</div>}
    </section>
    <div className="work-columns">
      <section className="panel"><div className="panel-title"><h2>通知 <span className="muted">({unread.length} 未讀)</span></h2></div>{unread.length?<div className="notice-list">{unread.map(item=><article key={item.id} className="notice-item unread"><b>{item.title}</b><p>{item.message}</p><small>{vesselName(item.vesselId)}｜{new Date(item.createdAt).toLocaleString('zh-TW')}</small></article>)}</div>:<div className="empty-state compact">目前沒有未讀通知</div>}</section>
      <section className="panel"><div className="panel-title"><h2>變動清單</h2></div>{changes.length?<div className="notice-list">{changes.map(item=><article key={item.id} className={`notice-item ${item.readAt?'':'unread'}`}><b>{item.title}</b><p>{item.message}</p><small>{vesselName(item.vesselId)}｜{new Date(item.createdAt).toLocaleString('zh-TW')}</small></article>)}</div>:<div className="empty-state compact">目前沒有變動紀錄</div>}</section>
    </div>
  </div>;
}
