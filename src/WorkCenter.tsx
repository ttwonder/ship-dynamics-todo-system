import { useEffect, useState } from 'react';
import type { AppData, TaskItem, TaskPriority, UserAccount, Vessel } from './types';
import { taskHasVessel, taskVesselIds, taskVesselLabel } from './taskVesselScope';
import { taskSourceLabel } from './taskWorkflow';
import { vesselDisplayName } from './vesselDisplay';
import { paginateItems } from './pagination';
import PaginationControls from './PaginationControls';
import { richTextToPlainText } from './richText';
import { sanitizeTaskSelection } from './batchTaskActions';
import { taskProjectedProgressForScope, taskVesselProgressSummary, usesPerVesselProgress } from './taskVesselProgress';
import { unreadTaskUpdateCounts } from './workCenterNotifications';
import { selectUserWorkCenterInternalCases, selectUserWorkCenterTasks } from './workCenterScope';
import { compareCreatedNewestFirst } from './recordSorting';
import VesselListFilter from './VesselListFilter';
import { selectedListRecords } from './selectedListExport';
import {
  compareOptionalListDate,
  managedListVesselIds,
  matchesListVesselSelection,
  sanitizeListVesselIds,
  type VesselListFilterMode,
} from './listVesselControls';

type TaskSort='created-desc'|'priority'|'due-asc'|'due-desc'|'updated-desc'|'vessel-asc'|'vessel-desc';
const priorityRank:Record<TaskPriority,number>={'急':0,'高':1,'中':2,'低':3};

type Props={data:AppData;user:UserAccount;vessels:Vessel[];onOpenTask:(task:TaskItem)=>void;onOpenInternalControl:()=>void;onOpenVessel:(vesselId:string)=>void;markAllRead:()=>void|Promise<void>;canComplete:boolean;canDelete:boolean;canPrint:boolean;onPrint:()=>void;onBatchComplete:(taskIds:string[],internalControlCaseIds?:string[])=>boolean|Promise<boolean>;onBatchDelete:(taskIds:string[],internalControlCaseIds?:string[])=>boolean|Promise<boolean>};

export default function WorkCenter({data,user,vessels,onOpenTask,onOpenInternalControl,onOpenVessel,markAllRead,canComplete,canDelete,canPrint,onPrint,onBatchComplete,onBatchDelete}:Props){
  const [taskQuery,setTaskQuery]=useState('');
  const [taskVesselMode,setTaskVesselMode]=useState<VesselListFilterMode>('all');
  const [selectedTaskVesselIds,setSelectedTaskVesselIds]=useState<string[]>([]);
  const [taskPriority,setTaskPriority]=useState<'all'|TaskPriority>('all');
  const [taskSource,setTaskSource]=useState<'all'|'morning'|'temporary'|'internal'>('all');
  const [taskSort,setTaskSort]=useState<TaskSort>('created-desc');
  const [selectedIds,setSelectedIds]=useState<string[]>([]);
  const [selectedInternalCaseIds,setSelectedInternalCaseIds]=useState<string[]>([]);
  const [page,setPage]=useState(1);
  // `vessels` is already permission-filtered by App. Owner/admin users can see all
  // authorized vessels even when their personal managedVesselIds list is empty.
  const visibleVesselIds=new Set(vessels.map(vessel=>vessel.id));
  const allTasks=selectUserWorkCenterTasks(data,user,vessels);
  const allInternalCases=selectUserWorkCenterInternalCases(data,user,vessels);
  const managedVesselIds=managedListVesselIds(user,vessels);
  const vesselSelection={mode:taskVesselMode,vesselIds:selectedTaskVesselIds};
  const query=taskQuery.trim().toLowerCase();
  const filteredTasks=allTasks.filter(task=>{
    if(taskSource==='internal')return false;
    const scopedVesselIds=taskVesselIds(task).filter(id=>visibleVesselIds.has(id));
    if(!matchesListVesselSelection(scopedVesselIds,vesselSelection,managedVesselIds,user.id,task.ownerUserIds))return false;
    if(taskPriority!=='all'&&task.priority!==taskPriority)return false;
    const source=task.sourceType==='temporary'||task.sourceMeetingId?'temporary':'morning';
    if(taskSource!=='all'&&source!==taskSource)return false;
    if(!query)return true;
    return [taskVesselLabel(task,vessels),richTextToPlainText(task.description),richTextToPlainText(task.status),task.expectedDate,taskSourceLabel(task),...(task.categories||[]),...task.departments].join(' ').toLowerCase().includes(query);
  });
  const filteredInternalCases=allInternalCases.filter(item=>{
    if(taskSource!=='all'&&taskSource!=='internal')return false;
    if(!matchesListVesselSelection([item.vesselId],vesselSelection,managedVesselIds,user.id))return false;
    if(taskPriority!=='all'&&item.priority!==taskPriority)return false;
    if(!query)return true;
    const vessel=vessels.find(entry=>entry.id===item.vesselId);
    return [vessel?vesselDisplayName(vessel):item.vesselId,richTextToPlainText(item.description),richTextToPlainText(item.status),item.category,item.reportSource,...item.departments].join(' ').toLowerCase().includes(query);
  });
  const internalVesselLabel=(vesselId:string)=>{const vessel=vessels.find(entry=>entry.id===vesselId);return vessel?vesselDisplayName(vessel):vesselId;};
  const workRows=[
    ...filteredInternalCases.map(item=>({kind:'internal' as const,item})),
    ...filteredTasks.map(task=>({kind:'task' as const,task})),
  ].sort((left,right)=>{
    const leftItem=left.kind==='internal'?left.item:left.task;
    const rightItem=right.kind==='internal'?right.item:right.task;
    if(taskSort==='created-desc')return compareCreatedNewestFirst(leftItem,rightItem);
    if(taskSort==='priority')return priorityRank[leftItem.priority]-priorityRank[rightItem.priority]||compareCreatedNewestFirst(leftItem,rightItem);
    if(taskSort==='due-asc'||taskSort==='due-desc'){
      const leftDate=left.kind==='task'?left.task.expectedDate:'';
      const rightDate=right.kind==='task'?right.task.expectedDate:'';
      return compareOptionalListDate(leftDate,rightDate,taskSort==='due-asc'?1:-1)||priorityRank[leftItem.priority]-priorityRank[rightItem.priority]||compareCreatedNewestFirst(leftItem,rightItem);
    }
    if(taskSort==='vessel-asc'||taskSort==='vessel-desc'){
      const leftLabel=left.kind==='task'?taskVesselLabel(left.task,vessels):internalVesselLabel(left.item.vesselId);
      const rightLabel=right.kind==='task'?taskVesselLabel(right.task,vessels):internalVesselLabel(right.item.vesselId);
      return leftLabel.localeCompare(rightLabel,'zh-TW')*(taskSort==='vessel-asc'?1:-1)||compareCreatedNewestFirst(leftItem,rightItem);
    }
    return rightItem.updatedAt.localeCompare(leftItem.updatedAt)||compareCreatedNewestFirst(leftItem,rightItem);
  });
  const selectableTasks=filteredTasks.filter(task=>canPrint||canDelete||(canComplete&&!usesPerVesselProgress(task)));
  const selectableTaskIds=new Set(selectableTasks.map(task=>task.id));
  const selectableInternalCases=(canComplete||canDelete||canPrint)?filteredInternalCases:[];
  useEffect(()=>{
    const next=sanitizeListVesselIds(selectedTaskVesselIds,vessels);
    if(next.length!==selectedTaskVesselIds.length||next.some((id,index)=>id!==selectedTaskVesselIds[index]))setSelectedTaskVesselIds(next);
  },[user.id,vessels,selectedTaskVesselIds]);
  useEffect(()=>{
    setSelectedIds(previous=>{const next=sanitizeTaskSelection(previous,selectableTasks);return next.length===previous.length&&next.every((id,index)=>id===previous[index])?previous:next;});
    setSelectedInternalCaseIds(previous=>{const visibleIds=new Set(selectableInternalCases.map(item=>item.id));const next=previous.filter(id=>visibleIds.has(id));return next.length===previous.length&&next.every((id,index)=>id===previous[index])?previous:next;});
    setPage(1);
  },[data.tasks,data.internalControlCases,taskQuery,taskVesselMode,selectedTaskVesselIds,taskPriority,taskSource,taskSort,user.id,vessels,canComplete,canDelete,canPrint]);
  const paged=paginateItems(workRows,page,10);

  const selectedSet=new Set(selectedIds);
  const selectedTasks=selectedListRecords(selectableTasks,selectedIds);
  const completableSelectedTasks=selectedTasks.filter(task=>!usesPerVesselProgress(task));
  const selectedInternalSet=new Set(selectedInternalCaseIds);
  const selectedInternalCases=selectableInternalCases.filter(item=>selectedInternalSet.has(item.id));
  const printTasks=selectedListRecords(filteredTasks,selectedIds);
  const printInternalCases=selectedListRecords(filteredInternalCases,selectedInternalCaseIds);
  const selectionCount=selectedTasks.length+selectedInternalCases.length;
  const completeSelectionCount=completableSelectedTasks.length+selectedInternalCases.length;
  const selectableCount=selectableTasks.length+selectableInternalCases.length;
  const allSelected=selectableCount>0&&selectableTasks.every(task=>selectedSet.has(task.id))&&selectableInternalCases.every(item=>selectedInternalSet.has(item.id));
  const toggleAll=()=>{setSelectedIds(allSelected?[]:selectableTasks.map(task=>task.id));setSelectedInternalCaseIds(allSelected?[]:selectableInternalCases.map(item=>item.id));};
  const toggleOne=(id:string)=>setSelectedIds(previous=>previous.includes(id)?previous.filter(item=>item!==id):[...previous,id]);
  const toggleInternalCase=(id:string)=>setSelectedInternalCaseIds(previous=>previous.includes(id)?previous.filter(item=>item!==id):[...previous,id]);
  const completeSelected=async()=>{if(await onBatchComplete(completableSelectedTasks.map(task=>task.id),selectedInternalCases.map(item=>item.id))){setSelectedIds([]);setSelectedInternalCaseIds([]);}};
  const deleteSelected=async()=>{if(await onBatchDelete(selectedTasks.map(task=>task.id),selectedInternalCases.map(item=>item.id))){setSelectedIds([]);setSelectedInternalCaseIds([]);}};
  const visibleTaskIds=new Set(allTasks.map(task=>task.id));
  const unreadByTask=unreadTaskUpdateCounts(data.notifications.filter(notice=>Boolean(notice.taskId&&visibleTaskIds.has(notice.taskId))),user.id);
  const unreadTaskCount=Object.keys(unreadByTask).length;
  const hasTaskFilters=Boolean(taskQuery.trim()||taskVesselMode!=='all'||taskPriority!=='all'||taskSource!=='all'||taskSort!=='created-desc');
  const resetTaskFilters=()=>{setTaskQuery('');setTaskVesselMode('all');setSelectedTaskVesselIds([]);setTaskPriority('all');setTaskSource('all');setTaskSort('created-desc');};
  return <section className="work-center">
    <div className="page-heading"><div><h1>我的待辦</h1><p>會議待辦與普通要事以不同顏色區分；他人更新以藍色標誌顯示在待辦列上。</p></div><div className="heading-actions">{unreadTaskCount>0&&<><span className="unread-count" aria-label={`${unreadTaskCount} 筆待辦有未讀變動`}>{unreadTaskCount} 筆更新</span><button className="btn ghost" onClick={markAllRead}>全部標記已讀</button></>}</div></div>
    <section className="panel work-task-panel"><div className="panel-title"><h2>我的待辦清單 <span className="muted">({filteredTasks.length+filteredInternalCases.length}/{allTasks.length+allInternalCases.length})</span></h2><div className="heading-actions no-print">{hasTaskFilters&&<button className="btn small ghost" onClick={resetTaskFilters}>清除篩選</button>}<button className="btn small ghost" onClick={toggleAll} disabled={!selectableCount}>{allSelected?'取消全選':'全選目前結果'}</button><span className="batch-selection-count">已選 {selectionCount}</span><button className="btn small green" onClick={completeSelected} disabled={!canComplete||!completeSelectionCount} title={!canComplete?'目前角色未獲授權批量完成':!completeSelectionCount&&selectionCount?'分派到多船的會議待辦請逐船完成':''}>批量完成（{completeSelectionCount}）</button><button className="btn small red" onClick={deleteSelected} disabled={!canDelete||!selectionCount} title={!canDelete?'只有 Owner／管理員可以批量刪除':''}>批量刪除（{selectionCount}）</button>{canPrint&&<button className="btn small primary" onClick={onPrint} disabled={!selectionCount} title={!selectionCount?'請先勾選要輸出的項目':''}>導出 PDF（{selectionCount}）</button>}</div></div>
      <div className="work-task-filters no-print"><input aria-label="我的待辦關鍵字" value={taskQuery} onChange={event=>setTaskQuery(event.target.value)} placeholder="搜尋船舶、內容、狀態、部門…"/><VesselListFilter vessels={vessels} mode={taskVesselMode} selectedVesselIds={selectedTaskVesselIds} onChange={selection=>{setTaskVesselMode(selection.mode);setSelectedTaskVesselIds(selection.vesselIds);}} ariaLabel="我的待辦船舶篩選"/><select aria-label="我的待辦關注程度篩選" value={taskPriority} onChange={event=>setTaskPriority(event.target.value as typeof taskPriority)}><option value="all">全部關注程度</option>{data.settings.priorities.map(priority=><option key={priority}>{priority}</option>)}</select><select aria-label="我的待辦來源篩選" value={taskSource} onChange={event=>setTaskSource(event.target.value as typeof taskSource)}><option value="all">全部來源</option><option value="morning">早會</option><option value="temporary">臨會/專題</option><option value="internal">未同步內控</option></select><select aria-label="我的待辦排序" value={taskSort} onChange={event=>setTaskSort(event.target.value as TaskSort)}><option value="created-desc">建立時間：最新到最舊</option><option value="priority">關注程度：急到低</option><option value="due-asc">期限：近到遠</option><option value="due-desc">期限：遠到近</option><option value="updated-desc">最近更新</option><option value="vessel-asc">船舶名稱：正序</option><option value="vessel-desc">船舶名稱：反序</option></select></div>
      {paged.items.length>0&&<div className="work-task-list">{paged.items.map(row=>{if(row.kind==='internal'){const item=row.item;const vessel=vessels.find(entry=>entry.id===item.vesselId);const selectable=selectableInternalCases.some(candidate=>candidate.id===item.id);return <article key={item.id} className={`work-task-row internal-control-work-row ${selectable?'':'no-selection-row'} ${selectedInternalSet.has(item.id)?'batch-selected-row':''}`}>{selectable&&<label className="work-task-select"><input type="checkbox" aria-label={`選取內控 ${richTextToPlainText(item.description)||item.id}`} checked={selectedInternalSet.has(item.id)} onChange={()=>toggleInternalCase(item.id)}/></label>}<div className="work-task-main"><div className="work-task-meta"><span className="task-source-badge source-internal">未同步內控</span><b>{vessel?vesselDisplayName(vessel):item.vesselId}</b><span>{item.priority}關注</span><span>{item.category}</span></div><button className="task-link" onClick={onOpenInternalControl}>{richTextToPlainText(item.description)||'未命名內控事項'}</button><small>{richTextToPlainText(item.status)||'尚未更新狀態'}｜{item.departments.join('、')||'未指定部門'}</small></div><div className="work-task-actions"><button className="btn ghost small" onClick={()=>onOpenVessel(item.vesselId)}>船舶</button><button className="btn primary small" onClick={onOpenInternalControl}>前往內控</button></div></article>}const task=row.task;const meeting=Boolean(task.sourceMeetingId||task.sourceType==='temporary');const updateCount=unreadByTask[task.id]||0;const scopedIds=taskVesselIds(task).filter(id=>visibleVesselIds.has(id));const summary=taskVesselProgressSummary(task,scopedIds);const multiMeeting=usesPerVesselProgress(task);const taskSelectable=selectableTaskIds.has(task.id);return <article key={task.id} className={`work-task-row ${meeting?'meeting-task-row source-temporary':'ordinary-task-row source-morning'} ${multiMeeting&&!taskSelectable?'multi-vessel-task-row':''} ${taskSelectable?'':'no-selection-row'} ${updateCount?'has-unread-update':''} ${selectedSet.has(task.id)?'batch-selected-row':''}`}>{taskSelectable&&<label className="work-task-select"><input type="checkbox" aria-label={`選取待辦 ${richTextToPlainText(task.description)||task.id}`} checked={selectedSet.has(task.id)} onChange={()=>toggleOne(task.id)}/></label>}<div className="work-task-main"><div className="work-task-meta"><span className={`task-source-badge ${meeting?'source-temporary':'source-morning'}`} title={taskSourceLabel(task)}>{meeting?'會議待辦':'普通要事'}</span>{updateCount>0&&<span className="task-update-marker" aria-label="此待辦有未讀變動">● 更新</span>}{multiMeeting&&<span className="task-progress-marker">單船 {summary.completed}/{summary.total} 已結</span>}<b>{taskVesselLabel(task,vessels)}</b><span>{task.priority}關注</span><span>期限 {task.expectedDate||'未設定'}</span></div><button className="task-link" onClick={()=>onOpenTask(task)}>{richTextToPlainText(task.description)||'未命名事項'}</button><small>{task.status?'總體狀態已更新':'尚未更新總體狀態'}｜{task.departments.join('、')||'未指定部門'}</small></div><div className="work-task-actions">{taskVesselIds(task).length===1&&taskHasVessel(task,task.vesselId)&&<button className="btn ghost small" onClick={()=>onOpenVessel(task.vesselId)}>船舶</button>}<button className="btn primary small" onClick={()=>onOpenTask(task)}>{multiMeeting?'查看／更新進度':'更新'}</button></div></article>})}</div>}
      {paged.total>0?<PaginationControls page={paged.page} pageCount={paged.pageCount} total={paged.total} from={paged.from} to={paged.to} onPageChange={setPage} ariaLabel="我的待辦分頁"/>:<div className="empty-state">目前沒有符合條件的待辦</div>}
      <section className="work-print-list print-only"><h1>我的待辦清單（所選項目）</h1><p>匯出人：{user.name}｜匯出時間：{new Date().toLocaleString('zh-TW')}｜所選 {printTasks.length+printInternalCases.length} 件</p><table><thead><tr><th>來源</th><th>船舶</th><th>關注</th><th>事項</th><th>部門</th><th>期限</th><th>狀態</th></tr></thead><tbody>{printInternalCases.map(item=>{const vessel=vessels.find(entry=>entry.id===item.vesselId);return <tr key={`internal-${item.id}`}><td>未同步內控</td><td>{vessel?vesselDisplayName(vessel):item.vesselId}</td><td>{item.priority}</td><td>{richTextToPlainText(item.description)||'未命名內控事項'}</td><td>{item.departments.join('、')||'未指定'}</td><td>—</td><td>{richTextToPlainText(item.status)||'尚未更新'}</td></tr>;})}{printTasks.map(task=>{const meeting=Boolean(task.sourceMeetingId||task.sourceType==='temporary');const scopedIds=taskVesselIds(task).filter(id=>visibleVesselIds.has(id));const summary=taskVesselProgressSummary(task,scopedIds);const projected=taskProjectedProgressForScope(task,scopedIds);return <tr key={task.id}><td>{meeting?'會議待辦':'普通要事'}{usesPerVesselProgress(task)?`｜單船 ${summary.completed}/${summary.total}`:''}</td><td>{taskVesselLabel(task,vessels)}</td><td>{task.priority}</td><td>{richTextToPlainText(task.description)||'未命名事項'}</td><td>{task.departments.join('、')||'未指定'}</td><td>{task.expectedDate||'未設定'}</td><td>{richTextToPlainText(projected.status)||'尚未更新'}</td></tr>;})}</tbody></table></section>
    </section>
  </section>;
}
