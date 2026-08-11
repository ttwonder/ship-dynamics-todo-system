import type { TaskItem, UserAccount, Vessel } from './types';
import RichTextContent from './RichTextContent';
import { taskVesselLabel } from './taskVesselScope';
import { taskProjectedProgressForScope } from './taskVesselProgress';
import { taskSourceLabel } from './taskWorkflow';
import { formatTaipeiDateTime } from './taipeiTime';

export default function SelectedTaskPrintTable({
  title,
  tasks,
  vessels,
  users,
  exportedBy,
}: {
  title: string;
  tasks: TaskItem[];
  vessels: Vessel[];
  users: UserAccount[];
  exportedBy: string;
}) {
  const userNames = new Map(users.map(user => [user.id, user.name]));
  const visibleVesselIds = vessels.map(vessel => vessel.id);
  return <section className="selected-task-print print-only">
    <h1>{title}（所選項目）</h1>
    <p>匯出人：{exportedBy}｜匯出時間：{formatTaipeiDateTime(new Date())}｜所選 {tasks.length} 件</p>
    <table>
      <colgroup><col className="print-col-vessel"/><col className="print-col-attention"/><col className="print-col-source"/><col className="print-col-item"/><col className="print-col-department"/><col className="print-col-tracking"/><col className="print-col-deadline"/><col className="print-col-status"/><col className="print-col-closure"/></colgroup>
      <thead><tr><th>船舶</th><th>關注</th><th>來源</th><th>分類／事項</th><th>部門</th><th>追蹤窗口</th><th>期限</th><th>最新狀態</th><th>結案</th></tr></thead>
      <tbody>{tasks.map(task => { const projected=taskProjectedProgressForScope(task,visibleVesselIds); return <tr key={task.id}>
        <td>{taskVesselLabel(task, vessels)}</td>
        <td>{task.priority}</td>
        <td>{taskSourceLabel(task)}</td>
        <td>{task.categories.join('、') || '未分類'}<RichTextContent compact value={task.description} fallback="未命名事項"/></td>
        <td>{task.departments.join('、') || '未指定'}</td>
        <td>{task.ownerUserIds.map(id => userNames.get(id) || id).join('、') || '未指定'}</td>
        <td>{task.expectedDate || '未設定'}</td>
        <td><RichTextContent compact value={projected.status} fallback="尚未更新"/></td>
        <td>{projected.isClosed ? projected.closedDate || '已結案' : '未結'}</td>
      </tr>;})}</tbody>
    </table>
  </section>;
}
