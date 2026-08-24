import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const styles = fs.readFileSync('src/styles.css', 'utf8');
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const { default: VesselImportantSummary } = await server.ssrLoadModule('/src/VesselImportantSummary.tsx');
  const { createInitialData } = await server.ssrLoadModule('/src/data/seed.ts');
  const data = createInitialData();
  const vessel = structuredClone(data.vessels[0]);
  const baseCase = data.internalControlCases[0] || {};
  const standaloneCases = ['一', '二'].map((suffix, index) => ({
    ...baseCase,
    id: `unlinked-internal-${index}`,
    vesselId: vessel.id,
    description: `未同步內控測試${suffix}`,
    priority: index === 0 ? '高' : '中',
    isClosed: false,
    linkedTaskId: undefined,
  }));

  const markup = renderToStaticMarkup(React.createElement(VesselImportantSummary, {
    vessel,
    tasks: [],
    internalControlCases: standaloneCases,
    meetings: [],
    canDiscloseMeetingSubjects: true,
    compact: false,
  }));

  assert.ok(markup.includes('<strong class="internal-control-warning">未同步為要事的內控異常</strong>2 件'), '船隊看板必須以精確新文案標示未同步成要事的內控異常');
  assert.ok(!markup.includes('>未同步內控</strong>'), '船隊看板不得保留舊文案「未同步內控」');
  assert.match(styles, /\.ship-summary-content>p strong\.internal-control-warning\{[^}]*color:#c52d45/, '未同步為要事的內控異常必須以足夠 specificity 覆蓋摘要既有紫色 strong 規則');
} finally {
  await server.close();
}
console.log('PASS dashboard unlinked internal-control warning contract');
