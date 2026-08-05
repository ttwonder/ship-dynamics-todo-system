import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';

const server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
try{
  const selection=await server.ssrLoadModule('/src/selectedListExport.ts');
  const rows=[{id:'a',label:'A'},{id:'b',label:'B'},{id:'c',label:'C'}];
  assert.deepEqual(selection.selectedListRecords(rows,[]),[],'zero selection must export nothing rather than fall back to the whole list');
  assert.deepEqual(selection.selectedListRecords(rows,['c','a']).map(item=>item.id),['a','c'],'selected export must retain current list ordering');
  assert.deepEqual(selection.selectedListRecords(rows,['hidden','b']).map(item=>item.id),['b'],'stale or hidden ids must not leak into an export');

  const workCenter=await readFile(new URL('../src/WorkCenter.tsx',import.meta.url),'utf8');
  const app=await readFile(new URL('../src/App.tsx',import.meta.url),'utf8');
  const internal=await readFile(new URL('../src/InternalControlPage.tsx',import.meta.url),'utf8');
  const normalized=await readFile(new URL('../src/NormalizedApp.tsx',import.meta.url),'utf8');
  const selectedTaskPrint=await readFile(new URL('../src/SelectedTaskPrintTable.tsx',import.meta.url),'utf8');
  const styles=await readFile(new URL('../src/styles.css',import.meta.url),'utf8');

  assert.ok(workCenter.includes('const printTasks=selectedListRecords(filteredTasks,selectedIds);')
    && workCenter.includes('const printInternalCases=selectedListRecords(filteredInternalCases,selectedInternalCaseIds);')
    && workCenter.includes('disabled={!selectionCount}')
    && workCenter.includes('導出 PDF（{selectionCount}）')
    && workCenter.includes('printInternalCases.map(')
    && workCenter.includes('printTasks.map('),'work center PDF must contain only explicitly selected ordinary and internal-control items');
  assert.ok(workCenter.includes('const selectableTasks=filteredTasks.filter(task=>canPrint||canDelete||(canComplete&&!usesPerVesselProgress(task)));')
    && workCenter.includes('const completableSelectedTasks=selectedTasks.filter(task=>!usesPerVesselProgress(task));')
    && workCenter.includes('onBatchComplete(completableSelectedTasks.map(task=>task.id),selectedInternalCases.map(item=>item.id))')
    && workCenter.includes('taskSelectable&&<label className="work-task-select"')
    && workCenter.includes('const projected=taskProjectedProgressForScope(task,scopedIds);')
    && workCenter.includes("richTextToPlainText(projected.status)||'尚未更新'"),'distributed meeting tasks must remain selectable with scoped PDF status while batch completion receives only completable rows');

  assert.ok(app.includes('<SelectedTaskPrintTable title={title} tasks={selectedTasks}')
    && app.includes('disabled={!selectedTasks.length}')
    && app.includes('導出 PDF（{selectedTasks.length}）'),'legacy total and closed task lists must print only their explicit selection');

  assert.ok(internal.includes("const printCases=subpage==='stats'?filtered:selectedCases;")
    && internal.includes("disabled={subpage==='stats'?!filtered.length:!selectedCases.length}")
    && internal.includes("subpage==='stats'?'導出 PDF':`導出所選 PDF（${selectedCases.length}）`")
    && internal.includes('printCases.map(item =>')
    && internal.includes("const selectableCaseIdsKey=selectableCases.map(item=>item.id).join('\\u0000');")
    && internal.includes('},[selectableCaseIdsKey]);'),'internal-control selection cleanup must follow the selectable id set while open and closed PDF prints only selection');

  assert.ok(normalized.includes('<SelectedTaskPrintTable title={closed ? \'已結案清單\' : \'待辦總表\'} tasks={selectedTasks}')
    && normalized.includes('disabled={!selectedTasks.length}')
    && normalized.includes('導出 PDF（{selectedTasks.length}）')
    && normalized.includes('onBatchComplete: (ids: string[]) => boolean | Promise<boolean>;')
    && normalized.includes('onBatchDelete: (ids: string[]) => boolean | Promise<boolean>;')
    && normalized.includes('批量完成（{completableSelectedIds.length}）')
    && normalized.includes('批量刪除（{selectedTasks.length}）')
    && normalized.includes('},[data.tasks,closed,vesselMode,selectedVesselIds,vessels,user.id,canComplete,canDelete,canPrint]);'),'normalized lists must expose the same selected-only actions and clear selection when capabilities shrink');

  assert.ok(styles.includes('.selected-task-print{display:none}')
    && styles.includes('.selected-task-print{display:block!important;'),'selected task print artifact must remain screen-hidden and print-visible');
  assert.ok(selectedTaskPrint.includes('taskProjectedProgressForScope(task,visibleVesselIds)')
    && selectedTaskPrint.includes('value={projected.status}')
    && selectedTaskPrint.includes("projected.isClosed ? projected.closedDate || '已結案' : '未結'"),'selected task PDF must use the same visible-vessel progress projection as the list instead of raw cross-vessel task status');
  console.log('Selected-only list PDF contracts passed.');
}finally{
  await server.close();
}
