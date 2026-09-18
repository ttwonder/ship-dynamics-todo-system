/** Read-only DOM probe, serialized into the real Chromium report page. */
export function assignmentReportLayoutProbe() {
  const paper = document.querySelector('.management-assignment-paper');
  const nodes = [...paper.querySelectorAll('.assignment-cell-text')];
  const rows = [...paper.querySelectorAll('tbody tr')];
  const columnCount = paper.querySelectorAll('colgroup col').length;
  // Reconstruct logical columns: covered fleet/type/person cells are absent in DOM rows.
  const grid = rows.map(() => []);
  rows.forEach((row, rowIndex) => {
    let column = 0;
    for (const cell of row.cells) {
      while (grid[rowIndex][column]) column++;
      for (let down = 0; down < cell.rowSpan; down++) for (let across = 0; across < cell.colSpan; across++) (grid[rowIndex + down] ||= [])[column + across] = cell;
      column += cell.colSpan;
    }
  });
  const logicalFields = grid.flatMap(cells => [cells[0], cells[1], cells[3], cells[columnCount - 2], cells[columnCount - 1]]).map(cell => cell?.querySelector('.assignment-cell-text'));
  const expected = [...new Set(logicalFields)];
  const groupSpans = [0, 1].flatMap(column => grid.flatMap((cells, row) => !row || cells[column] !== grid[row - 1][column] ? [{ column, row, rows: cells[column]?.rowSpan, text: cells[column]?.textContent }] : []));
  const shrink = nodes.filter(node => node.classList.contains('assignment-shrink-text'));
  const wrapped = nodes.filter(node => !node.classList.contains('assignment-shrink-text'));
  const departments = [...paper.querySelectorAll('.assignment-department-cell .assignment-cell-text')];
  const box = node => { const range = document.createRange(); range.selectNodeContents(node); return range.getBoundingClientRect(); };
  const notes = [...paper.querySelectorAll('footer > div')];
  const pageBox = paper.getBoundingClientRect(), tableBottom = paper.querySelector('table').getBoundingClientRect().bottom;
  const delegates = departments.filter(node => node.textContent.includes('\n('));
  const lineBreaks = delegates.map(node => {
    const range = document.createRange();
    range.setStart(node.firstChild, 0); range.setEnd(node.firstChild, 1);
    const directTop = range.getBoundingClientRect().top;
    const start = node.textContent.indexOf('\n(') + 1;
    range.setStart(node.firstChild, start); range.setEnd(node.firstChild, start + 1);
    return range.getBoundingClientRect().top - directTop;
  });
  return {
    rows: rows.length,
    gridComplete: grid.length === rows.length && grid.every(cells => cells.length === columnCount && Array.from({ length: columnCount }, (_, column) => Boolean(cells[column])).every(Boolean)),
    logicalShrinkCount: logicalFields.filter(node => node?.classList.contains('assignment-shrink-text')).length,
    groupSpans,
    notes: notes.map(node => node.textContent),
    notesBelowTable: notes.length === 2 && notes.every((node, index) => node.getBoundingClientRect().top >= (index ? notes[index - 1].getBoundingClientRect().bottom : tableBottom) - 1),
    notesContained: notes.length === 2 && notes.every(node => { const r = box(node); return r.left >= pageBox.left - 1 && r.right <= pageBox.right + 1 && r.bottom <= pageBox.bottom + 1; }),
    notesLast: paper.lastElementChild?.tagName === 'FOOTER' && paper.lastElementChild.lastElementChild === notes[1],
    shrinkCount: shrink.length,
    exactShrinkColumns: expected.length === shrink.length && expected.every(node => shrink.includes(node)),
    noWrap: shrink.every(node => getComputedStyle(node).whiteSpace === 'nowrap'),
    singleLine: shrink.every(node => box(node).height <= parseFloat(getComputedStyle(node).lineHeight) + 1),
    shrunk: shrink.filter(node => node.style.fontSize).map(node => node.textContent),
    otherWrap: wrapped.every(node => getComputedStyle(node).whiteSpace !== 'nowrap'),
    otherNoShrink: wrapped.every(node => !node.style.fontSize),
    departmentCount: departments.length,
    centered: departments.every(node => getComputedStyle(node.closest('td')).textAlign === 'center'),
    preserveNewline: departments.every(node => getComputedStyle(node).whiteSpace === 'pre-line'),
    departmentFonts: [...new Set(departments.map(node => getComputedStyle(node).fontSize))],
    delegateLineCount: lineBreaks.length,
    delegatesBelow: lineBreaks.every(delta => delta > 0.5),
    contained: nodes.every(node => { const r = box(node), cell = node.closest('td,th').getBoundingClientRect(); return r.left >= cell.left - 1 && r.right <= cell.right + 1 && r.top >= cell.top - 1 && r.bottom <= cell.bottom + 1; }),
  };
}
