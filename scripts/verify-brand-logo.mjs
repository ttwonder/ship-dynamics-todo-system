import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const logoUrl = new URL('../src/assets/fpmc-logo.png', import.meta.url);

assert.ok(existsSync(logoUrl), '台塑 LOGO 资源必须纳入 src/assets');
const png = readFileSync(logoUrl);
assert.equal(png.toString('ascii', 1, 4), 'PNG', '品牌图标必须保留为 PNG');
assert.ok(png.readUInt32BE(16) >= 200 && png.readUInt32BE(20) >= 160, '品牌 LOGO 不得使用低解析度替代图');
assert.match(app, /import fpmcLogo from ['"]\.\/assets\/fpmc-logo\.png['"]/);
assert.match(app, /<img className="brand-icon" src=\{fpmcLogo\} alt="台塑 LOGO"\s*\/>/);
assert.doesNotMatch(app, /className="brand-icon">🚢/);
assert.match(css, /\.brand-icon\{[^}]*object-fit:contain[^}]*\}/);

console.log('FPMC brand logo contract passed.');
