import assert from 'node:assert/strict';

// Evaluate readItineraryHeaderLayout.toString() in the real mounted browser.
// Keep this read-only probe independent of fixture credentials and the runner.
export function readItineraryHeaderLayout(selector) {
  const header = document.querySelector(selector);
  if (!header) throw new Error('Mounted Itinerary header required');
  const summary = header.querySelector('.itinerary-current-state-summary');
  const box = node => {
    const r = node.getBoundingClientRect ? node.getBoundingClientRect() : node;
    return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  };
  const pairs = [...summary.querySelectorAll('[data-current-state-field]')].map(field => {
    const label = field.querySelector('dt'), value = field.querySelector('dd');
    const first = document.createRange();
    first.setStart(value.firstChild, 0);
    first.setEnd(value.firstChild, 1);
    const all = document.createRange();
    all.selectNodeContents(value);
    const fragments = [...all.getClientRects()].map(box);
    const bounds = box(field);
    return {
      field: field.dataset.currentStateField, label: box(label), first: box(first), bounds,
      text: value.textContent, lineCount: new Set(fragments.map(r => Math.round(r.y))).size,
      contained: fragments.every(r => r.x >= bounds.x - 1 && r.right <= bounds.right + 1),
    };
  });
  const group = header.querySelector('.itinerary-panel-meta') || header.lastElementChild;
  const actions = [...group.querySelectorAll(':scope > button')].map(button => ({
    text: button.textContent, ...box(button),
    textFits: button.scrollWidth <= button.clientWidth + 1,
  }));
  return {
    viewport: innerWidth, documentWidth: document.documentElement.scrollWidth,
    header: box(header), summary: box(summary), actionsBounds: box(group), pairs, actions,
  };
}

export function verifyItineraryHeaderLayout(result, side) {
  assert.ok(result.documentWidth <= result.viewport + 1, 'document does not overflow');
  assert.equal(result.pairs.length, 4, 'all four state fields remain visible');
  for (const pair of result.pairs) {
    assert.ok(Math.abs(pair.label.y - pair.first.y) <= 3, `${side}: ${pair.field} starts on its label line`);
    assert.ok(pair.first.x >= pair.label.right - 1, `${side}: ${pair.field} follows its label`);
    assert.ok(pair.contained, `${side}: complete ${pair.field} text wraps inside its field`);
  }
  const rowCounts = new Map();
  for (const action of result.actions) {
    const y = Math.round(action.y);
    rowCounts.set(y, (rowCounts.get(y) || 0) + 1);
    assert.ok(action.textFits, `${side}: ${action.text} is not clipped`);
    assert.ok(action.x >= result.header.x - 1 && action.right <= result.header.right + 1, 'actions stay inside header');
  }
  const rows = [...rowCounts].sort(([a], [b]) => a - b).map(([, count]) => count);
  const expected = side === 'office'
    ? (result.actions.length === 2 ? [1, 1] : [1, 2])
    : (result.actions.length === 7 ? [4, 3] : [3, 3]);
  assert.deepEqual(rows, expected, `${side}: original actions occupy exactly two rows`);
  return { rows, pairs: result.pairs.length, allTextContained: true };
}
