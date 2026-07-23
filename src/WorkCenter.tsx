import { useEffect, useState } from 'react';
import type { AppData, TaskItem, TaskPriority, UserAccount, Vessel } from './types';
import { taskHasVessel, taskVesselIds, taskVesselLabel } from './taskVesselScope';
import { taskSourceLabel } from './taskWorkflow';
import { vesselDisplayName } from './vesselDisplay';
import { paginateItems } from './pagination';
import PaginationControls from './PaginationControls';
import { richTextToPlainText } from './richText';
import { sanitizeTaskSelection } from './batchTaskActions';
import { taskVesselProgressSummary, usesPerVesselProgress } from './taskVesselProgress';
import { unreadTaskUpdateCounts } from './workCenterNotifications';
import { selectUserWorkCenterInternalCases, selectUserWorkCenterTasks } from './workCenterScope';

type TaskSort='priority'|'due-asc'|'due-desc'|'updated-desc'|'vessel';
const priorityRank:Record<TaskPriority,number>={'急':0,'高':1,'中':2,'低':3};
const compareOptionalDate=(left:string,right:string,direction:1|-1)=>!left&&!right?0:!left?1:!right?-1:left.localeCompare(right)*direction;

type Props={data:AppData;user:UserAccount;vessels:Vessel[];onOpenTask:(task:TaskItem)=>void;onOpenInternalControl:()=>void;onOpenVessel:(vesselId:string)=>void;markAllRead:()=>void;canComplete:boolean;canDelete:boolean;canPrint:boolean;onPrint:()=>void;onBatchComplete:(ids:string[])=>boolean;onBatchDelete:(ids:string[])=>boolean};

export default function WorkCenter({data,user,vessels,onOpenTask,onOpenInternalControl,onOpenVessel,markAllRead,canComplete,canDelete,canPrint,onPrint,onBatchComplete,onBatchDelete}:Props){
  const [taskQuery,setTaskQuery]=useState('');
  const [taskVessel,setTaskVessel]=useState('all');
  const [taskPriority,setTaskPriority]=useState<'all'|TaskPriority>('all');
  const [taskSource,setTaskSource]=useState<'all'|'morning'|'temporary'|'internal'>('all');
  const [taskSort,setTaskSort]=useState<TaskSort>('priority');
  const [selectedIds,setSelectedIds]=useState<string[]>([]);
  const [page,setPage]=useState(1);
  // `vessels` is already permission-filtered by App. Owner/admin users can see all
  // authorized vessels even when their personal managedVesselIds list is empty.
  const visibleVesselIds=new Set(vessels.map(vessel=>vessel.id));
  const allTasks=selectUserWorkCenterTasks(data,user,vessels);
  const allInternalCases=selectUserWorkCenterInternalCases(data,user,vessels);
  const taskVessels=vessels.filter(vessel=>allTasks.some(task=>taskHasVessel(task,vessel.id))||allInternalCases.some(item=>item.vesselId===vessel.id));
  const query=taskQuery.trim().toLowerCase();
  const filteredTasks=allTasks.filter(task=>{
    if(taskSource==='internal')return false;
    if(taskVessel!=='all'&&!taskHasVessel(task,taskVessel))return false;
    if(taskPriority!=='all'&&task.priority!==taskPriority)return false;
    const source=task.sourceType==='temporary'||task.sourceMeetingId?'temporary':'morning';
    if(taskSource!=='all'&&source!==taskSource)return false;
    if(!query)return true;
    return [taskVesselLabel(task,vessels),richTextToPlainText(task.description),richTextToPlainText(task.status),task.expectedDate,taskSourceLabel(task),...(task.categories||[]),...task.departments].join(' ').toLowerCase().includes(query);
  }).sort((left,right)=>{
    if(taskSort==='priority')return priorityRank[left.priority]-priorityRank[right.priority]||compareOptionalDate(left.expectedDate,right.expectedDate,1)||right.updatedAt.localeCompare(left.updatedAt);
    if(taskSort==='due-asc')return compareOptionalDate(left.expectedDate,right.expectedDate,1)||priorityRank[left.priority]-priorityRank[right.priority];
    if(taskSort==='due-desc')return compareOptionalDate(left.expectedDate,right.expectedDate,-1)||priorityRank[left.priority]-priorityRank[right.priority];
    if(taskSort==='vessel')return taskVesselLabel(left,vessels).localeCompare(taskVesselLabel(right,vessels),'zh-TW')||priorityRank[left.priority]-priorityRank[right.priority];
    return right.updatedAt.localeCompare(left.updatedAt);
  });
  const filteredInternalCases=allInternalCases.filter(item=>{
    if(taskSource!=='all'&&taskSource!=='internal')return false;
    if(taskVessel!=='all'&&item.vesselId!==taskVessel)return false;
    if(taskPriority!=='all'&&item.priority!==taskPriority)return false;
    if(!query)return true;
    const vessel=vessels.find(entry=>entry.id===item.vesselId);
    return [vessel?vesselDisplayName(vessel):item.vesselId,richTextToPlainText(item.description),richTextToPlainText(item.status),item.category,item.reportSource,...item.departments].join(' ').toLowerCase().includes(query);
  }).sort((left,right)=>priorityRank[left.priority]-priorityRank[right.priority]||right.updatedAt.localeCompare(left.updatedAt));
  const actionableTasks=filteredTasks.filter(task=>!usesPerVesselProgress(task));
  useEffect(()=>{setSelectedIds(previous=>{const next=sanitizeTaskSelection(previous,actionableTasks);return next.length===previous.length&&next.every((id,index)=>id===previous[index])?previous:next;});setPage(1);},[data.tasks,taskQuery,taskVessel,taskPriority,taskSource,taskSort,user.id,vessels]);
  const paged=paginateItems([
    ...filteredInternalCases.map(item=>({kind:'internal' as const,item})),
    ...filteredTasks.map(task=>({kind:'task' as const,task})),
  ],page,10);
  const pagedInternalCases=paged.items.flatMap(row=>row.kind==='internal'?[row.item]:[]);
  const pagedTasks=paged.items.flatMap(row=>row.kind==='task'?[row.task]:[]);
  const selectedSet=new Set(selectedIds);
  const selectedTasks=actionableTasks.filter(task=>selectedSet.has(task.id));
  const allSelected=actionableTasks.length>0&&actionableTasks.every(task=>selectedSet.has(task.id));
  const toggleAll=()=>setSelectedIds(allSelected?[]:actionableTasks.map(task=>task.id));
  const toggleOne=(id:string)=>setSelectedIds(previous=>previous.includes(id)?previous.filter(item=>item!==id):[...previous,id]);
  const completeSelected=()=>{if(onBatchComplete(selectedTasks.map(task=>task.id)))setSelectedIds([]);};
  const deleteSelected=()=>{if(onBatchDelete(selectedTasks.map(task=>task.id)))setSelectedIds([]);};
  const visibleTaskIds=new Set(allTasks.map(task=>task.id));
  const unreadByTask=unreadTaskUpdateCounts(data.notifications.filter(notice=>Boolean(notice.taskId&&visibleTaskIds.has(notice.taskId))),user.id);
  const unreadTaskCount=Object.keys(unreadByTask).length;
  const hasTaskFilters=Boolean(taskQuery.trim()||taskVessel!=='all'||taskPriority!=='all'||taskSource!=='all'||taskSort!=='priority');
  const resetTaskFilters=()=>{setTaskQuery('');setTaskVessel('all');setTaskPriority('all');setTaskSource('all');setTaskSort('priority');};
  return <section className="work-center">
    <div className="page-heading"><div><h1>我的待辦</h1><p>會議待辦與普通要事以不同顏色區分；他人更新以藍色標誌顯示在待辦列上。</p></div><div className="heading-actions">{unreadTaskCount>0&&<><span className="unread-count" aria-label={`${unreadTaskCount} 筆待辦有未讀變動`}>{unreadTaskCount} 筆更新</span><button className="btn ghost" onClick={markAllRead}>全部標記已讀</button></>}</div></div>
    <section className="panel work-task-panel"><div className="panel-title"><h2>我的待辦清單 <span className="muted">({filteredTasks.length+filteredInternalCases.length}/{allTasks.length+allInternalCases.length})</span></h2><div className="heading-actions no-print">{hasTaskFilters&&<button className="btn small ghost" onClick={resetTaskFilters}>清除篩選</button>}<button className="btn small ghost" onClick={toggleAll} disabled={!actionableTasks.length}>{allSelected?'取消全選':'全選目前結果'}</button><span className="batch-selection-count">已選 {selectedTasks.length}</span><button className="btn small green" onClick={completeSelected} disabled={!canComplete||!selectedTasks.length} title={!canComplete?'目前角色未獲授權批量完成':''}>批量完成（{selectedTasks.length}）</button><button className="btn small red" onClick={deleteSelected} disabled={!canDelete||!selectedTasks.length} title={!canDelete?'只有 Owner／管理員可以批量刪除':''}>批量刪除（{selectedTasks.length}）</button>{canPrint&&<button className="btn small primary" onClick={onPrint}>導出 PDF</button>}</div></div>
      <div className="work-task-filters no-print"><input aria-label="我的待辦關鍵字" value={taskQuery} onChange={event=>setTaskQuery(event.target.value)} placeholder="搜尋船舶、內容、狀態、部門…"/><select aria-label="我的待辦船舶篩選" value={taskVessel} onChange={event=>setTaskVessel(event.target.value)}><option value="all">全部船舶</option>{taskVessels.map(vessel=><option key={vessel.id} value={vessel.id}>{vesselDisplayName(vessel)}</option>)}</select><select aria-label="我的待辦關注程度篩選" value={taskPriority} onChange={event=>setTaskPriority(event.target.value as typeof taskPriority)}><option value="all">全部關注程度</option>{data.settings.priorities.map(priority=><option key={priority}>{priority}</option>)}</select><select aria-label="我的待辦來源篩選" value={taskSource} onChange={event=>setTaskSource(event.target.value as typeof taskSource)}><option value="all">全部來源</option><option value="morning">早會</option><option value="temporary">臨會/專題</option><option value="internal">未同步內控</option></select><select aria-label="我的待辦排序" value={taskSort} onChange={event=>setTaskSort(event.target.value as TaskSort)}><option value="priority">關注程度：急到低</option><option value="due-asc">期限：近到遠</option><option value="due-desc">期限：遠到近</option><option value="updated-desc">最近更新</option><option value="vessel">船舶名稱</option></select></div>
      {pagedInternalCases.length>0&&<div className="work-task-list internal-control-work-list">{pagedInternalCases.map(item=>{const vessel=vessels.find(entry=>entry.id===item.vesselId);return <article key={item.id} className="work-task-row internal-control-work-row"><div className="work-task-main"><div className="work-task-meta"><span className="task-source-badge source-internal">未同步內控</span><b>{vessel?vesselDisplayName(vessel):item.vesselId}</b><span>{item.priority}關注</span><span>{item.category}</span></div><button className="task-link" onClick={onOpenInternalControl}>{richTextToPlainText(item.description)||'未命名內控事項'}</button><small>{richTextToPlainText(item.status)||'尚未更新狀態'}｜{item.departments.join('、')||'未指定部門'}</small></div><div className="work-task-actions"><button className="btn ghost small" onClick={()=>onOpenVessel(item.vesselId)}>船舶</button><button className="btn primary small" onClick={onOpenInternalControl}>前往內控</button></div></article>;})}</div>}
      {pagedTasks.length>0&&<div className="work-task-list">{pagedTasks.map(task=>{const meeting=Boolean(task.sourceMeetingId||task.sourceType==='temporary');const updateCount=unreadByTask[task.id]||0;const scopedIds=taskVesselIds(task).filter(id=>visibleVesselIds.has(id));const summary=taskVesselProgressSummary(task,scopedIds);const multiMeeting=usesPerVesselProgress(task);return <article key={task.id} className={`work-task-row ${meeting?'meeting-task-row source-temporary':'ordinary-task-row source-morning'} ${multiMeeting?'multi-vessel-task-row':''} ${updateCount?'has-unread-update':''} ${selectedSet.has(task.id)?'batch-selected-row':''}`}>{!multiMeeting&&<label className="work-task-select"><input type="checkbox" aria-label={`選取待辦 ${richTextToPlainText(task.description)||task.id}`} checked={selectedSet.has(task.id)} onChange={()=>toggleOne(task.id)}/></label>}<div className="work-task-main"><div className="work-task-meta"><span className={`task-source-badge ${meeting?'source-temporary':'source-morning'}`} title={taskSourceLabel(task)}>{meeting?'會議待辦':'普通要事'}</span>{updateCount>0&&<span className="task-update-marker" aria-label="此待辦有未讀變動">● 更新</span>}{multiMeeting&&<span className="task-progress-marker">單船 {summary.completed}/{summary.total} 已結</span>}<b>{taskVesselLabel(task,vessels)}</b><span>{task.priority}關注</span><span>期限 {task.expectedDate||'未設定'}</span></div><button className="task-link" onClick={()=>onOpenTask(task)}>{richTextToPlainText(task.description)||'未命名事項'}</button><small>{task.status?'總體狀態已更新':'尚未更新總體狀態'}｜{task.departments.join('、')||'未指定部門'}</small></div><div className="work-task-actions">{taskVesselIds(task).length===1&&taskHasVessel(task,task.vesselId)&&<button className="btn ghost small" onClick={()=>onOpenVessel(task.vesselId)}>船舶</button>}<button className="btn primary small" onClick={()=>onOpenTask(task)}>{multiMeeting?'查看／更新進度':'更新'}</button></div></article>})}</div>}
      {paged.total>0?<PaginationControls page={paged.page} pageCount={paged.pageCount} total={paged.total} from={paged.from} to={paged.to} onPageChange={setPage} ariaLabel="我的待辦分頁"/>:<div className="empty-state">目前沒有符合條件的待辦</div>}
      <section className="work-print-list print-only"><h1>我的待辦清單</h1><p>匯出人：{user.name}｜匯出時間：{new Date().toLocaleString('zh-TW')}｜目前篩選 {filteredTasks.length+filteredInternalCases.length} / 全部 {allTasks.length+allInternalCases.length} 件</p><table><thead><tr><th>來源</th><th>船舶</th><th>關注</th><th>事項</th><th>部門</th><th>期限</th><th>狀態</th></tr></thead><tbody>{filteredInternalCases.map(item=>{const vessel=vessels.find(entry=>entry.id===item.vesselId);return <tr key={`internal-${item.id}`}><td>未同步內控</td><td>{vessel?vesselDisplayName(vessel):item.vesselId}</td><td>{item.priority}</td><td>{richTextToPlainText(item.description)||'未命名內控事項'}</td><td>{item.departments.join('、')||'未指定'}</td><td>—</td><td>{richTextToPlainText(item.status)||'尚未更新'}</td></tr>;})}{filteredTasks.map(task=>{const meeting=Boolean(task.sourceMeetingId||task.sourceType==='temporary');const scopedIds=taskVesselIds(task).filter(id=>visibleVesselIds.has(id));const summary=taskVesselProgressSummary(task,scopedIds);return <tr key={task.id}><td>{meeting?'會議待辦':'普通要事'}{usesPerVesselProgress(task)?`｜單船 ${summary.completed}/${summary.total}`:''}</td><td>{taskVesselLabel(task,vessels)}</td><td>{task.priority}</td><td>{richTextToPlainText(task.description)||'未命名事項'}</td><td>{task.departments.join('、')||'未指定'}</td><td>{task.expectedDate||'未設定'}</td><td>{richTextToPlainText(task.status)||'尚未更新'}</td></tr>;})}</tbody></table></section>
    </section>
  </section>;
}
