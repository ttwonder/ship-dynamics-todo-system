import { useEffect, useState } from 'react';
import { taskSourceLabel } from './taskWorkflow';
import type { AppData, TaskItem, TaskPriority, UserAccount, Vessel } from './types';
import { vesselDisplayName } from './vesselDisplay';
import { taskHasVessel, taskVesselLabel } from './taskVesselScope';
import { sanitizeTaskSelection } from './batchTaskActions';

type TaskSort = 'priority' | 'due-asc' | 'due-desc' | 'updated-desc' | 'vessel';
const priorityRank: Record<TaskPriority, number> = { '急': 0, '高': 1, '中': 2, '低': 3 };
const compareOptionalDate = (left: string, right: string, direction: 1 | -1) => {
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return left.localeCompare(right) * direction;
};

export default function WorkCenter({ data, user, vessels, onOpenTask, onBatchComplete, onBatchDelete, canComplete, canDelete, markAllRead }: { data: AppData; user: UserAccount; vessels: Vessel[]; onOpenTask: (task: TaskItem) => void; onBatchComplete: (ids:string[])=>boolean; onBatchDelete: (ids:string[])=>boolean; canComplete:boolean; canDelete:boolean; markAllRead: () => void }) {
  const [taskQuery, setTaskQuery] = useState('');
  const [taskVessel, setTaskVessel] = useState('all');
  const [taskPriority, setTaskPriority] = useState<'all' | TaskPriority>('all');
  const [taskSource, setTaskSource] = useState<'all' | 'morning' | 'temporary'>('all');
  const [taskSort, setTaskSort] = useState<TaskSort>('priority');
  const [selectedIds,setSelectedIds]=useState<string[]>([]);
  const vesselIds = new Set(vessels.filter(vessel => vessel.assignedUserIds.includes(user.id) || user.managedVesselIds.includes(vessel.id)).map(vessel => vessel.id));
  const allTasks = data.tasks.filter(task => !task.isClosed && ([...vesselIds].some(id => taskHasVessel(task, id)) || task.ownerUserIds.includes(user.id)));
  const changes = data.notifications.filter(item => item.userId === user.id).sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  const unread = changes.filter(item => !item.readAt);
  const vesselName = (id: string) => {
    const vessel = vessels.find(item=>item.id===id);
    return vessel ? vesselDisplayName(vessel) : '受限船舶';
  };
  const taskVessels = vessels.filter(vessel => allTasks.some(task => taskHasVessel(task, vessel.id)));
  const query = taskQuery.trim().toLowerCase();
  const filteredTasks = allTasks.filter(task => {
    if (taskVessel !== 'all' && !taskHasVessel(task, taskVessel)) return false;
    if (taskPriority !== 'all' && task.priority !== taskPriority) return false;
    const source = task.sourceType === 'temporary' || task.sourceMeetingId ? 'temporary' : 'morning';
    if (taskSource !== 'all' && source !== taskSource) return false;
    if (!query) return true;
    return [taskVesselLabel(task, vessels), task.description, task.status, task.expectedDate, taskSourceLabel(task), ...(task.categories || []), ...task.departments]
      .join(' ').toLowerCase().includes(query);
  }).sort((left, right) => {
    if (taskSort === 'priority') return priorityRank[left.priority] - priorityRank[right.priority] || compareOptionalDate(left.expectedDate, right.expectedDate, 1) || right.updatedAt.localeCompare(left.updatedAt);
    if (taskSort === 'due-asc') return compareOptionalDate(left.expectedDate, right.expectedDate, 1) || priorityRank[left.priority] - priorityRank[right.priority];
    if (taskSort === 'due-desc') return compareOptionalDate(left.expectedDate, right.expectedDate, -1) || priorityRank[left.priority] - priorityRank[right.priority];
    if (taskSort === 'vessel') return taskVesselLabel(left, vessels).localeCompare(taskVesselLabel(right, vessels), 'zh-TW') || priorityRank[left.priority] - priorityRank[right.priority];
    return right.updatedAt.localeCompare(left.updatedAt);
  });
  useEffect(()=>{setSelectedIds(previous=>{const next=sanitizeTaskSelection(previous,filteredTasks);return next.length===previous.length&&next.every((id,index)=>id===previous[index])?previous:next;});},[data.tasks,taskQuery,taskVessel,taskPriority,taskSource,taskSort,user.id,vessels]);
  const selectedSet=new Set(selectedIds);
  const selectedTasks=filteredTasks.filter(task=>selectedSet.has(task.id));
  const allSelected=filteredTasks.length>0&&filteredTasks.every(task=>selectedSet.has(task.id));
  const toggleAll=()=>setSelectedIds(allSelected?[]:filteredTasks.map(task=>task.id));
  const toggleOne=(id:string)=>setSelectedIds(previous=>previous.includes(id)?previous.filter(item=>item!==id):[...previous,id]);
  const completeSelected=()=>{if(onBatchComplete(selectedTasks.map(task=>task.id)))setSelectedIds([]);};
  const deleteSelected=()=>{if(onBatchDelete(selectedTasks.map(task=>task.id)))setSelectedIds([]);};
  const hasTaskFilters = Boolean(taskQuery.trim() || taskVessel !== 'all' || taskPriority !== 'all' || taskSource !== 'all' || taskSort !== 'priority');
  const resetTaskFilters = () => { setTaskQuery(''); setTaskVessel('all'); setTaskPriority('all'); setTaskSource('all'); setTaskSort('priority'); };
  return <div className="work-center">
    <div className="page-heading"><div><h1>我的待辦與通知</h1><p>彙集您負責的待辦、分管船舶事項和變動。</p></div>{unread.length>0&&<button className="btn primary" onClick={markAllRead}>全部標記已讀（{unread.length}）</button>}</div>
    <section className="panel"><div className="panel-title"><h2>我的待辦清單 <span className="muted">({filteredTasks.length}/{allTasks.length})</span></h2><div className="heading-actions no-print">{hasTaskFilters&&<button className="btn small ghost" onClick={resetTaskFilters}>清除篩選</button>}<button className="btn small ghost" onClick={toggleAll} disabled={!filteredTasks.length}>{allSelected?'取消全選':'全選目前結果'}</button><span className="batch-selection-count">已選 {selectedTasks.length}</span><button className="btn small green" onClick={completeSelected} disabled={!canComplete||!selectedTasks.length} title={!canComplete?'目前角色未獲授權批量完成':''}>批量完成（{selectedTasks.length}）</button><button className="btn small red" onClick={deleteSelected} disabled={!canDelete||!selectedTasks.length} title={!canDelete?'只有 Owner／管理員可以批量刪除':''}>批量刪除（{selectedTasks.length}）</button></div></div>
      <div className="work-task-filters no-print">
        <input aria-label="我的待辦關鍵字" value={taskQuery} onChange={event=>setTaskQuery(event.target.value)} placeholder="搜尋船舶、內容、狀態、部門…" />
        <select aria-label="我的待辦船舶篩選" value={taskVessel} onChange={event=>setTaskVessel(event.target.value)}><option value="all">全部船舶</option>{taskVessels.map(vessel=><option key={vessel.id} value={vessel.id}>{vesselDisplayName(vessel)}</option>)}</select>
        <select aria-label="我的待辦關注程度篩選" value={taskPriority} onChange={event=>setTaskPriority(event.target.value as typeof taskPriority)}><option value="all">全部關注程度</option>{data.settings.priorities.map(priority=><option key={priority}>{priority}</option>)}</select>
        <select aria-label="我的待辦來源篩選" value={taskSource} onChange={event=>setTaskSource(event.target.value as typeof taskSource)}><option value="all">全部來源</option><option value="morning">早會</option><option value="temporary">臨會/專題</option></select>
        <select aria-label="我的待辦排序" value={taskSort} onChange={event=>setTaskSort(event.target.value as TaskSort)}><option value="priority">關注程度：急到低</option><option value="due-asc">期限：近到遠</option><option value="due-desc">期限：遠到近</option><option value="updated-desc">最近更新</option><option value="vessel">船舶名稱</option></select>
      </div>
      {filteredTasks.length?<div className="work-task-list">{filteredTasks.map(task=><article key={task.id} className={`work-task-row ${selectedSet.has(task.id)?'batch-selected-row':''}`}><label className="work-task-select"><input type="checkbox" aria-label={`選取待辦 ${task.description||task.id}`} checked={selectedSet.has(task.id)} onChange={()=>toggleOne(task.id)}/></label><button className="work-task-open" onClick={()=>onOpenTask(task)}><span><b>{taskVesselLabel(task,vessels)}</b>{task.isInternalControl&&<em className="internal-control-tag">內部管控</em>}{task.isAbnormal&&<em className="inline-abnormal">異常</em>}</span><strong>{task.description}</strong><small><span className="task-source-badge">{taskSourceLabel(task)}</span>｜{task.priority}｜期限 {task.expectedDate||'未設定'}｜{task.status||'尚未更新'}</small></button></article>)}</div>:<div className="empty-state compact">{allTasks.length ? '沒有符合目前條件的待辦' : '目前沒有分管船舶未結待辦'}</div>}
    </section>
    <div className="work-columns">
      <section className="panel"><div className="panel-title"><h2>通知 <span className="muted">({unread.length} 未讀)</span></h2></div>{unread.length?<div className="notice-list">{unread.map(item=><article key={item.id} className="notice-item unread"><b>{item.title}</b><p>{item.message}</p><small>{vesselName(item.vesselId)}｜{new Date(item.createdAt).toLocaleString('zh-TW')}</small></article>)}</div>:<div className="empty-state compact">目前沒有未讀通知</div>}</section>
      <section className="panel"><div className="panel-title"><h2>變動清單</h2></div>{changes.length?<div className="notice-list">{changes.map(item=><article key={item.id} className={`notice-item ${item.readAt?'':'unread'}`}><b>{item.title}</b><p>{item.message}</p><small>{vesselName(item.vesselId)}｜{new Date(item.createdAt).toLocaleString('zh-TW')}</small></article>)}</div>:<div className="empty-state compact">目前沒有變動紀錄</div>}</section>
    </div>
  </div>;
}
