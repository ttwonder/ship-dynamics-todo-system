import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const meeting = fs.readFileSync(new URL('../src/TemporaryMeetings.tsx', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const detail = fs.readFileSync(new URL('../src/VesselDetailPage.tsx', import.meta.url), 'utf8');
const morning = fs.readFileSync(new URL('../src/MorningWorkspace.tsx', import.meta.url), 'utf8');
const rich = fs.readFileSync(new URL('../src/RichTextContent.tsx', import.meta.url), 'utf8');
const editor = fs.readFileSync(new URL('../src/RichTextEditor.tsx', import.meta.url), 'utf8');

assert.ok(meeting.includes('ariaLabel="召開緣由"') && meeting.includes('ariaLabel="決議／會議結論"') && meeting.includes('ariaLabel={`待辦事項 ${index+1}`}'), 'meeting reason, resolution and follow-ups must use rich-text editors');
assert.ok(meeting.includes('isRichTextEmpty(draft.reason)') && meeting.includes('!isRichTextEmpty(item.description)'), 'rich-text empty markup must not pass required meeting reason or follow-up validation');
assert.ok(meeting.includes('richTextToPlainText(meeting.reason)') && meeting.includes('richTextToPlainText(item.description)'), 'meeting search and compact exports must index plain text rather than markup');
assert.ok(meeting.includes('<RichTextContent value={meeting.reason}') && meeting.includes('<RichTextContent value={meeting.resolution}') && meeting.includes('<RichTextContent value={item.description}'), 'meeting detail PDF must preserve sanitized rich formatting');
assert.ok(app.includes('<RichTextContent compact value={t.description}') && app.includes('<RichTextContent compact className="task-list-status-text" value={projected.status}'), 'task list must render rich descriptions and clamp projected status safely');
const styles=fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
assert.ok(styles.includes('.batch-task-table .task-list-status-text') && styles.includes('-webkit-line-clamp:5') && styles.includes('max-height:6.8em'), 'task list status must remain visually clamped while allowing the widened status column to show more text');
assert.ok(detail.includes('<RichTextContent compact value={task.description}') && detail.includes('<RichTextContent compact value={progress.status}'), 'vessel detail must render vessel-scoped rich content safely');
assert.ok((morning.includes('<RichTextContent compact value={task.description}') || morning.includes('<RichTextContent compact value={t.description}')) && morning.includes('<RichTextContent compact value={displayStatus}'), 'morning agenda must render rich content safely');
assert.ok(rich.includes('sanitizeRichTextHtml(value)') && rich.includes('dangerouslySetInnerHTML'), 'rich-text display must sanitize before rendering HTML');
assert.ok(!editor.includes('dangerouslySetInnerHTML') && editor.includes('useLayoutEffect'), '富文本编辑器不得在每次受控重渲染时重写 innerHTML 与光标选区');
const server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
try{
  const helpers=await server.ssrLoadModule('/src/richText.ts');
  assert.equal(helpers.isRichTextEmpty('<p>\u200b\ufeff</p>'),true,'零宽字符不得绕过富文本必填验证');
  assert.doesNotThrow(()=>helpers.richTextToPlainText('&#9999999999;'),'非法数字实体不得使页面渲染抛错');
  assert.equal(helpers.richTextToPlainText('&#9999999999;'),'�','非法数字实体应安全替换');
} finally { await server.close(); }
console.log('Rich-text meeting, task display and PDF contracts passed.');
