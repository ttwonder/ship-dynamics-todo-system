import assert from 'node:assert/strict';
import fs from 'node:fs';

const dashboard = fs.readFileSync('src/Dashboard.tsx', 'utf8');
const styles = fs.readFileSync('src/styles.css', 'utf8');

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

const cargoItems = declarationsFor('.ship-cargo .ship-data-value>span');
assert.equal(cargoItems.color, '#000', '貨名貨量每筆內容必須是黑色');
assert.ok(Number.parseFloat(cargoItems['font-size']) >= 15, '貨名貨量每筆內容至少需要15px');

console.log('Dashboard card readability contracts passed.');
