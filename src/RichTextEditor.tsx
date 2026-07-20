import { useLayoutEffect, useRef, useState } from 'react';
import { sanitizeRichTextHtml } from './richText';

type Props = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel: string;
  required?: boolean;
  readOnly?: boolean;
  minHeight?: number;
};

type ToolbarPosition = { left: number; top: number };

const colors = ['#51485d','#c2413a','#b45309','#15803d','#0369a1','#6d28d9'];
const symbols = ['•','✓','→','★','※','①','②','③','±','℃'];

export default function RichTextEditor({ id, value, onChange, placeholder = '', ariaLabel, required = false, readOnly = false, minHeight = 82 }: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const savedRangeRef = useRef<Range | null>(null);
  const [toolbar, setToolbar] = useState<ToolbarPosition | null>(null);

  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor || document.activeElement === editor) return;
    const safeValue = sanitizeRichTextHtml(value);
    if (editor.innerHTML !== safeValue) editor.innerHTML = safeValue;
  }, [value]);

  const emit = () => {
    if (editorRef.current) onChange(editorRef.current.innerHTML);
  };

  const captureSelection = () => {
    if (readOnly || !editorRef.current || !wrapperRef.current) return setToolbar(null);
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount || selection.isCollapsed) return setToolbar(null);
    const range = selection.getRangeAt(0);
    if (!editorRef.current.contains(range.commonAncestorContainer)) return setToolbar(null);
    savedRangeRef.current = range.cloneRange();
    const selectionRect = range.getBoundingClientRect();
    const wrapperRect = wrapperRef.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(selectionRect.left - wrapperRect.left, Math.max(8, wrapperRect.width - 330)));
    const above = selectionRect.top - wrapperRect.top - 48;
    setToolbar({ left, top: above >= 4 ? above : selectionRect.bottom - wrapperRect.top + 6 });
  };

  const restoreSelection = () => {
    const range = savedRangeRef.current;
    const selection = window.getSelection();
    if (!range || !selection) return false;
    editorRef.current?.focus({ preventScroll: true });
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  };

  const execCommand = (command: string, commandValue?: string) => {
    if (!restoreSelection()) return;
    document.execCommand(command, false, commandValue);
    emit();
    window.setTimeout(captureSelection, 0);
  };

  const finishEditing = () => {
    const editor = editorRef.current;
    if (!editor) return;
    const safeValue = sanitizeRichTextHtml(editor.innerHTML);
    if (editor.innerHTML !== safeValue) editor.innerHTML = safeValue;
    onChange(safeValue);
    window.setTimeout(() => {
      if (!wrapperRef.current?.contains(document.activeElement)) setToolbar(null);
    }, 0);
  };

  return <div ref={wrapperRef} className={`rich-text-editor${readOnly ? ' readonly' : ''}`} onBlur={event => {
    if (event.currentTarget.contains(event.relatedTarget as Node)) return;
    finishEditing();
  }}>
    {toolbar && !readOnly && <div className="rich-text-floating-toolbar" role="toolbar" aria-label={`${ariaLabel}文字格式`} style={{ left: toolbar.left, top: toolbar.top }} onMouseDown={event => {
      if ((event.target as HTMLElement).tagName !== 'SELECT') event.preventDefault();
    }}>
      <button type="button" title="加粗" aria-label="加粗" onClick={() => execCommand('bold')}><b>B</b></button>
      <button type="button" title="序号" aria-label="序号" onClick={() => execCommand('insertOrderedList')}>1.</button>
      <button type="button" title="列表符号" aria-label="列表符号" onClick={() => execCommand('insertUnorderedList')}>•</button>
      <select aria-label="字号" defaultValue="" onChange={event => { if (event.target.value) execCommand('fontSize', event.target.value); event.target.value=''; }}>
        <option value="" disabled>字号</option><option value="1">小</option><option value="2">稍小</option><option value="3">正常</option><option value="4">大</option><option value="5">较大</option><option value="6">特大</option>
      </select>
      <span className="rich-text-colors" aria-label="文字颜色">{colors.map(color => <button type="button" key={color} title={`颜色 ${color}`} aria-label={`颜色 ${color}`} style={{ background: color }} onClick={() => execCommand('foreColor', color)} />)}</span>
      <select aria-label="插入符号" defaultValue="" onChange={event => { if (event.target.value) execCommand('insertText', event.target.value); event.target.value=''; }}>
        <option value="" disabled>符号</option>{symbols.map(symbol => <option value={symbol} key={symbol}>{symbol}</option>)}
      </select>
    </div>}
    <div
      id={id}
      ref={editorRef}
      className="rich-text-editable"
      contentEditable={!readOnly}
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label={ariaLabel}
      aria-required={required || undefined}
      data-placeholder={placeholder}
      style={{ minHeight }}
      onInput={emit}
      onMouseUp={captureSelection}
      onKeyUp={captureSelection}
      onPaste={event => {
        if (readOnly) return;
        event.preventDefault();
        const text = event.clipboardData.getData('text/plain');
        document.execCommand('insertText', false, text);
        emit();
      }}
    />
  </div>;
}
