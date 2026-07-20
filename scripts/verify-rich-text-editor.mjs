import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const editor=fs.readFileSync('src/RichTextEditor.tsx','utf8');
const content=fs.readFileSync('src/RichTextContent.tsx','utf8');
const editModals=fs.readFileSync('src/EditModals.tsx','utf8');
const meetings=fs.readFileSync('src/TemporaryMeetings.tsx','utf8');
const styles=fs.readFileSync('src/styles.css','utf8');

assert.match(editor,/contentEditable/,'富文本编辑器必须使用可编辑内容区');
assert.match(editor,/window\.getSelection\(\)/,'必须读取用户选中文字');
assert.match(editor,/selection\.isCollapsed/,'工具条只能在有文字选区时浮出');
assert.match(editor,/execCommand\('bold'/,'必须支持加粗');
assert.match(editor,/execCommand\('insertOrderedList'/,'必须支持序号');
assert.match(editor,/execCommand\('insertUnorderedList'/,'必须支持列表符号');
assert.match(editor,/execCommand\('fontSize'/,'必须支持字号');
assert.match(editor,/execCommand\('foreColor'/,'必须支持颜色');
assert.match(editor,/insertText/,'必须支持基础符号插入');
assert.match(editor,/onPaste/,'必须接管粘贴事件');
assert.match(editor,/text\/plain/,'粘贴必须降为纯文字，避免外部危险 HTML');
assert.match(editor,/event\.currentTarget\.contains\(event\.relatedTarget as Node\)/,'焦点移到浮动工具栏时不得净化重写编辑 DOM 使保存选区失效');
assert.match(editor,/return <div ref=\{wrapperRef\}[^>]*onBlur=\{event =>/,'整个富文本 wrapper 必须作为 blur 边界，覆盖编辑区→下拉→组件外的完整焦点链');
assert.doesNotMatch(editor,/className="rich-text-editable"[\s\S]*?onBlur=/,'编辑区不得独占 blur 处理，否则下拉离开组件时不会完成净化');
assert.match(content,/sanitizeRichTextHtml/,'富文本显示前必须经过白名单净化');
assert.ok((editModals.match(/<RichTextEditor/g)||[]).length>=2,'事项内容和目前状态／决议必须使用富文本编辑器');
assert.ok((meetings.match(/<RichTextEditor/g)||[]).length>=3&&meetings.includes('ariaLabel={`待辦事項 ${index+1}`}'),'召開緣由、會議結論及映射的每笔待办必须使用富文本编辑器');
assert.ok((meetings.match(/<RichTextContent/g)||[]).length>=3,'会议详情/PDF 必须按富文本格式显示而不是输出 HTML 字符');
assert.match(styles,/\.rich-text-editor\{position:relative/,'富文本编辑器 wrapper 必须提供浮动工具条定位上下文');
assert.match(styles,/\.rich-text-floating-toolbar\{position:absolute/,'浮动工具条必须绝对定位，避免插入普通文流造成跳动');
assert.match(styles,/\.rich-text-editable:empty::before\{content:attr\(data-placeholder\)/,'空编辑区必须显示 placeholder');
assert.match(styles,/\.rich-text-content\.compact/,'紧凑表格/PDF 富文本内容必须有 compact 样式');

const server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
try {
  const { richTextToPlainText, isRichTextEmpty }=await server.ssrLoadModule('/src/richText.ts');
  assert.equal(richTextToPlainText('<p><strong>重点</strong></p><ul><li>甲</li><li>乙</li></ul>'),'重点\n甲\n乙','搜索/摘要必须可提取纯文字');
  assert.equal(isRichTextEmpty('<p><br></p>'),true,'只有空标签不得通过必填验证');
  assert.equal(isRichTextEmpty('<p>内容</p>'),false,'有实际文字必须通过必填验证');
  assert.equal(isRichTextEmpty('<p>\u200b</p>'),true,'零宽字符不得绕过必填验证');
} finally { await server.close(); }

console.log('Rich text editor safety, toolbar and field integration contracts passed.');
