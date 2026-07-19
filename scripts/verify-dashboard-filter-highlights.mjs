import assert from 'node:assert/strict';
import fs from 'node:fs';

const dashboard = fs.readFileSync(new URL('../src/Dashboard.tsx', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

assert.ok(dashboard.includes("key === 'mine' ? 'filter-pill-mine'"), '自管船舶筛选必须有专用语义 class');
assert.ok(dashboard.includes("key === 'high' ? 'filter-pill-high'"), '急／高关注筛选必须有专用语义 class');
for (const selector of [
  '.filter-pill-mine{', '.filter-pill-mine:hover', '.filter-pill-mine.active',
  '.filter-pill-high{', '.filter-pill-high:hover', '.filter-pill-high.active',
  '.filter-pill-mine:focus-visible', '.filter-pill-high:focus-visible',
]) assert.ok(styles.includes(selector), `缺少重要筛选样式：${selector}`);
assert.match(styles, /\.filter-pill-mine\{[^}]*color:/, '自管船舶未选中状态必须有明确文字颜色');
assert.match(styles, /\.filter-pill-high\{[^}]*color:/, '急／高关注未选中状态必须有明确文字颜色');

assert.match(styles, /\.filter-pill-high\.active\{[^}]*background:#c44720/, '急／高关注 active 需使用对白字达到 WCAG AA 的深橙红');

console.log('Important dashboard filter color contracts passed.');
