import assert from 'node:assert/strict';
import fs from 'node:fs';

const dashboard = fs.readFileSync('src/Dashboard.tsx', 'utf8');
const styles = fs.readFileSync('src/styles.css', 'utf8');

assert.doesNotMatch(dashboard, /<b>\{item\.name \|\| '未填貨名'\}<\/b>/, '貨名內容不得使用粗體標記');

for (const contract of [
  /<b className="ship-data-label">\{scheduleKind\}<\/b><span className="ship-data-value">\{scheduleValue\}<\/span>/,
  /<div className="ship-navigation"><small className="ship-data-label">航行狀態<\/small><b className="ship-data-value">/,
  /<div className="ship-status"><small className="ship-data-label">狀態補充<\/small><b className="ship-data-value">/,
  /<div className="ship-cargo"><small className="ship-data-label">貨名貨量：<\/small><div className="ship-cargo-items ship-data-value">/,
]) {
  assert.match(dashboard, contract, '指定船舶卡欄位必須使用可讀性字體標記');
}

const declarationsFor = selector => {
  const declarations = {};
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const match of styles.matchAll(new RegExp(`${escaped}\\s*\\{([^{}]*)\\}`, 'g'))) {
    for (const declaration of match[1].split(';')) {
      const separator = declaration.indexOf(':');
      if (separator < 0) continue;
      declarations[declaration.slice(0, separator).trim()] = declaration.slice(separator + 1).trim();
    }
  }
  return declarations;
};

const route = declarationsFor('.ship-route');
assert.equal(route['font-size'], '13px', '港口框高度必須以港名字級計算');
assert.equal(route.height, 'calc(3.75em + 16px)', '港口框必須固定為三行文字加上下內距');
assert.equal(route['grid-template-columns'], 'minmax(0,1fr) auto minmax(0,1fr)', '兩側港名不得以內容寬度撐開船卡');
const routeName = declarationsFor('.ship-route b');
assert.equal(routeName['line-height'], '1.25', '港名三行高度必須對應實際行高');
assert.equal(routeName['max-height'], '3.75em', '上一港與下一港各自最多顯示三行');
assert.equal(routeName['overflow-y'], 'auto', '長港名必須可獨立上下捲動查看完整內容');
assert.equal(routeName['overflow-x'], 'hidden', '港名不得產生橫向捲動');
assert.equal(routeName['min-width'], '0', '連續長港名必須可在欄內換行');
assert.equal(routeName['white-space'], 'normal', '短港名與長港名都必須保留正常換行');

const label = declarationsFor('.ship-operation-grid .ship-data-label');
assert.equal(label.color, '#000', '指定欄位標題必須是黑色');
assert.ok(Number.parseFloat(label['font-size']) >= 12, '指定欄位標題至少需要12px');

const scheduleLabel = declarationsFor('.ship-schedule .ship-data-label');
assert.ok(Number.parseFloat(scheduleLabel['font-size']) >= 15, 'ETA／ETB／ETD標題至少需要15px');

const scheduleValue = declarationsFor('.ship-schedule .ship-data-value');
assert.equal(scheduleValue['white-space'], 'normal', 'ETA／ETB／ETD值必須允許換行完整顯示');
assert.equal(scheduleValue.overflow, 'visible', 'ETA／ETB／ETD值不得以省略號裁切');
assert.equal(scheduleValue['text-overflow'], 'clip', 'ETA／ETB／ETD值不得顯示省略號');

const value = declarationsFor('.ship-operation-grid .ship-data-value');
assert.equal(value.color, '#000', '指定欄位數值必須是黑色');
assert.ok(Number.parseFloat(value['font-size']) >= 15, '指定欄位數值至少需要15px');

const cargo = declarationsFor('.ship-cargo');
assert.equal(cargo.height, '32px', '每張船舶卡的貨名貨量區塊必須縮為原高度一半');
assert.equal(cargo['min-height'], '32px', '短貨物內容也必須維持固定高度');
assert.equal(cargo['max-height'], '32px', '長貨物內容不得撐高卡片');
assert.equal(cargo['overflow-y'], 'auto', '超出固定高度的貨物內容必須在區塊內垂直捲動');
assert.equal(cargo['overflow-x'], 'hidden', '貨物內容不得產生橫向捲動');

const cargoItems = declarationsFor('.ship-cargo .ship-data-value>span');
assert.equal(cargoItems.color, '#000', '貨名貨量每筆內容必須是黑色');
assert.equal(cargoItems['font-size'], '14px', '貨名貨量內容必須稍微縮小為14px');
assert.equal(cargoItems['font-weight'], '400', '貨名貨量內容必須使用一般字重');

const manualRemark = declarationsFor('.ship-summary-content .manual-remark-summary');
assert.equal(manualRemark.color, '#111', '人工備註必須以接近純黑顯示，不得被摘要段落灰字覆蓋');
assert.equal(manualRemark['font-size'], '14px', '人工備註與其他摘要正文必須統一為14px中間值');
assert.equal(manualRemark['font-weight'], '900', '人工備註必須使用醒目粗體');

const summaryContent = declarationsFor('.ship-summary-content');
assert.equal(summaryContent['font-size'], '14px', '船隊看板的動態、要事、內控與空狀態正文必須統一放大為14px');

console.log('Dashboard card readability contracts passed.');
