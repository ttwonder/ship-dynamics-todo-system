import assert from 'node:assert/strict';
import fs from 'node:fs';

const app=fs.readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
const meetings=fs.readFileSync(new URL('../src/TemporaryMeetings.tsx',import.meta.url),'utf8');
const modals=fs.readFileSync(new URL('../src/EditModals.tsx',import.meta.url),'utf8');
const dashboard=fs.readFileSync(new URL('../src/Dashboard.tsx',import.meta.url),'utf8');

assert.match(app,/TemporaryMeetingsPage[^>]*canExportReports=\{canExportReports\}/,'会议页必须接收导出权限');
assert.match(meetings,/if \(!canExportReports\) return alert\('目前角色未获授权导出会议资料'\)/,'会议列印执行函数必须重验权限');
assert.match(meetings,/canExportReports&&/,'会议导出控件必须依权限显示');
assert.match(meetings,/canExportReports&&<th className="no-print">選取<\/th>/,'无导出权限时必须隐藏选择栏');
assert.match(meetings,/canExportReports&&<td className="no-print"><input aria-label=\{`選取會議/,'无导出权限时必须隐藏每列选择框');
assert.match(app,/const reportVessels = activeVessels/,'报告中心只能接收当前用户授权船舶');
assert.match(app,/const selectedIds=_selected\.filter\(id=>allowedIds\.has\(id\)\)[\s\S]*const reportVesselIds=new Set\(vessels\.map/,'报告选择必须先与授权范围取交集，并同步限制待办');
assert.match(app,/const vessels=_selected\.length\?visibleVessels\.filter/,'非空选择与授权交集为空时不得回退全部授权船舶');
assert.match(app,/const reportHistory=data\.agendaReports\.filter[\s\S]*report\.vesselIds\.every\(id=>allowedIds\.has\(id\)\)/,'历史报告元数据需按完整授权范围过滤');
assert.match(app,/disabled=\{!vessels\.length\}/,'空授权交集时必须禁用 PDF 输出');
assert.match(app,/role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="report-preview-title"/,'报告预览必须有 dialog 语义与名称');
assert.match(app,/event\.key==='Escape'/,'报告预览必须支援 Escape');
assert.match(app,/event\.key!==['"]Tab['"]/,'报告预览必须限制 Tab 焦点');
assert.match(app,/const closeRef=useRef\(close\);[\s\S]*closeRef\.current=close/,'报告预览必须通过 ref 使用最新关闭 callback');
assert.match(app,/previousFocusRef\.current\?\.focus\(\);\};[\s\S]{0,40}\},\[\]\);/,'报告预览焦点监听只可随 modal mount／unmount 安装');
assert.match(app,/previousFocusRef\.current\?\.focus/,'报告预览关闭后必须恢复焦点');
assert.match(modals,/triggerRef\.current\?\.focus/,'owner picker Escape 后必须恢复 trigger 焦点');
assert.match(dashboard,/aria-pressed=\{fleetFilter === key\}/,'Dashboard toggle 必须公开选取状态');
assert.match(app,/selectAllRef\.current\.indeterminate/,'批量表头必须公开部分选取状态');
console.log('Export permission and accessibility contracts passed.');
