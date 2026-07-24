import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const types = fs.readFileSync('src/types.ts', 'utf8');
const management = fs.readFileSync('src/Management.tsx', 'utf8');
const app = fs.readFileSync('src/App.tsx', 'utf8');
const delegationSource = fs.readFileSync('src/vesselDelegation.ts', 'utf8');
const workCenter = fs.readFileSync('src/workCenterScope.ts', 'utf8');
const styles = fs.readFileSync('src/styles.css', 'utf8');

assert.ok(types.includes('VesselDelegateAssignment'), 'Vessel 需有代管人員資料型別');
assert.ok(types.includes('delegateManagers: VesselDelegateAssignment[]'), '每艘船需保存代管人員與激活狀態');
assert.ok(management.includes('代管') && management.includes('delegateManagers'), '管理頁船舶編輯需新增代管模組');
assert.ok(management.includes('toggleDelegateActive') && management.includes('delegate-manager-toggle'), '代管人員需可個別切換激活／未激活');
assert.ok(management.includes('delegateVessels') && management.includes('togglePersonDelegateVessel') && management.includes('togglePersonDelegateVesselActive'), '管理頁人員編輯需在經管船舶下方提供代管船舶模組並可個別切換激活');
assert.ok((management.match(/isActive: false/g) || []).length >= 2, '人員頁與船舶頁新增代管時預設都必須為未激活');
assert.ok(styles.includes('.delegate-manager-toggle.active') && styles.includes('.delegate-manager-toggle.inactive'), '代管激活狀態需有綠色／灰色樣式');
assert.ok(management.includes('delegate-state-dot'), '代管狀態需使用不遮擋內容的小圓點按鈕');
assert.ok(!management.includes(">{delegate.isActive ? '激活' : '未激活'}</button>"), '代管狀態按鈕不得再顯示會擋住選項的文字');
const cssDeclarations = (css, selector) => {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const body = css.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`))?.[1];
  assert.ok(body, `需存在 ${selector} 樣式`);
  return Object.fromEntries(body.split(';').map(part => part.split(':').map(value => value.trim())).filter(parts => parts.length === 2 && parts[0]));
};
const toggleStyle = cssDeclarations(styles, '.delegate-manager-toggle');
assert.deepEqual([toggleStyle.width, toggleStyle.height, toggleStyle.padding], ['24px', '24px', '0'], '代管狀態點擊區需固定為不遮擋內容的小尺寸');
const stateDotStyle = cssDeclarations(styles, '.delegate-state-dot');
assert.deepEqual([stateDotStyle.width, stateDotStyle.height], ['10px', '10px'], '代管狀態視覺需為小圓點');
assert.ok(app.includes('vesselMatchesUser') && app.includes('hasActiveVesselDelegation'), '可見船舶範圍需包含激活代管船舶');
assert.ok(workCenter.includes('hasActiveVesselDelegation'), '我的待辦需把激活代管船舶視為本人相關船舶');
assert.ok(app.includes('batchTargetVesselsFor') && app.includes('userCanManageVesselByAssignmentOrDelegation(vessel,user)') && delegationSource.includes('hasActiveVesselDelegation(vessel, user.id)'), 'App批量目標解析需透過共用範圍函式包含激活代管船舶');

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const delegation = await server.ssrLoadModule('/src/vesselDelegation.ts');
  const { normalizeAppData } = await server.ssrLoadModule('/src/normalize.ts');
  const { PersonEditor } = await server.ssrLoadModule('/src/Management.tsx');
  const activeShipName = 'QA <SHIP> & "ACTIVE"';
  const inactiveShipName = 'QA_SHIP_INACTIVE';
  const unselectedShipName = 'QA_SHIP_UNSELECTED';
  const forbiddenMetadata = [
    'FORBIDDEN_SHIP_TYPE_ACTIVE', 'FORBIDDEN_POSITION_ACTIVE', 'FORBIDDEN_ASSIGNEE_ACTIVE',
    'FORBIDDEN_SHIP_TYPE_INACTIVE', 'FORBIDDEN_POSITION_INACTIVE', 'FORBIDDEN_ASSIGNEE_INACTIVE',
    'FORBIDDEN_SHIP_TYPE_UNSELECTED', 'FORBIDDEN_POSITION_UNSELECTED', 'FORBIDDEN_ASSIGNEE_UNSELECTED',
  ];
  const personEditorHtml = renderToStaticMarkup(React.createElement(PersonEditor, {
    draft: { department:'航運處', name:'測試人員', username:'qa-user', role:'operator', isActive:true, managedVesselIds:[], password:'', delegateVessels:[{ vesselId:'v-active', isActive:true }, { vesselId:'v-inactive', isActive:false }] },
    setDraft: () => {}, creating:false, owner:true, manager:true,
    currentUser: { id:'owner', department:'管理部', name:'Owner', username:'owner', role:'owner', passwordHash:'', isActive:true, managedVesselIds:[], createdAt:'2026-07-21T00:00:00.000Z', updatedAt:'2026-07-21T00:00:00.000Z' },
    selectedUserId:'qa-user', departments:['航運處'], assignmentQuery:'', setAssignmentQuery:() => {}, onSave:() => {}, onDisable:() => {}, onClearPassword:() => {},
    vessels: [
      { id:'v-active', name:activeShipName, shortName:activeShipName, fullName:activeShipName, shipType:'FORBIDDEN_SHIP_TYPE_ACTIVE', assignedUserIds:['FORBIDDEN_ASSIGNEE_ACTIVE'], position:{ location:'FORBIDDEN_POSITION_ACTIVE' }, isActive:true },
      { id:'v-inactive', name:inactiveShipName, shortName:inactiveShipName, fullName:inactiveShipName, shipType:'FORBIDDEN_SHIP_TYPE_INACTIVE', assignedUserIds:['FORBIDDEN_ASSIGNEE_INACTIVE'], position:{ location:'FORBIDDEN_POSITION_INACTIVE' }, isActive:true },
      { id:'v-unselected', name:unselectedShipName, shortName:unselectedShipName, fullName:unselectedShipName, shipType:'FORBIDDEN_SHIP_TYPE_UNSELECTED', assignedUserIds:['FORBIDDEN_ASSIGNEE_UNSELECTED'], position:{ location:'FORBIDDEN_POSITION_UNSELECTED' }, isActive:true },
    ],
  }));
  const renderedElementsByClass = (html, className) => {
    const rows = [];
    const stack = [];
    const divTag = /<\/?div\b[^>]*>/g;
    for (const match of html.matchAll(divTag)) {
      if (!match[0].startsWith('</')) {
        const classes = match[0].match(/\bclass="([^"]*)"/)?.[1].split(/\s+/) || [];
        stack.push({ start:match.index, target:classes.includes(className) });
        continue;
      }
      const opened = stack.pop();
      if (opened?.target) rows.push(html.slice(opened.start, match.index + match[0].length));
    }
    assert.equal(stack.length, 0, '渲染 HTML 的 div 結構需完整閉合');
    return rows;
  };
  const decodeHtml = value => value.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const openingTagsByClass = (html, tagName, className) => Array.from(html.matchAll(new RegExp(`<${tagName}\\b[^>]*>`, 'g')), match => match[0]).filter(tag => (tag.match(/\bclass="([^"]*)"/)?.[1].split(/\s+/) || []).includes(className));
  const decodedAttribute = (tag, name) => decodeHtml(tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] || '');
  assert.equal((personEditorHtml.match(/<h3>代管船舶<\/h3>/g) || []).length, 1, '人員頁只能有一個實際渲染的代管船舶區段');
  const delegateHeadingIndex = personEditorHtml.indexOf('<h3>代管船舶</h3>');
  const delegateSectionStart = personEditorHtml.lastIndexOf('<section', delegateHeadingIndex);
  const delegateSectionEnd = personEditorHtml.indexOf('</section>', delegateHeadingIndex);
  assert.ok(delegateSectionStart >= 0 && delegateSectionEnd > delegateHeadingIndex, '需定位唯一代管船舶渲染區段');
  const delegateSectionHtml = personEditorHtml.slice(delegateSectionStart, delegateSectionEnd + '</section>'.length);
  const delegateRows = renderedElementsByClass(delegateSectionHtml, 'delegate-manager-option');
  assert.equal(delegateRows.length, 3, '人員頁代管船舶需涵蓋已激活、未激活與未選取船舶列');
  assert.equal(renderedElementsByClass(personEditorHtml, 'delegate-manager-option').length, 3, '代管船舶列不得由同名或區段外 decoy 取代');
  const visibleRowText = html => decodeHtml(html.replace(/<[^>]*>/g, '')).trim();
  assert.deepEqual(delegateRows.map(visibleRowText), [activeShipName, inactiveShipName, unselectedShipName], '每列實際可見文字只能是船名，不得洩漏船型、位置、指派／經管人員或其他次要資訊');
  const decodedDelegateSectionHtml = decodeHtml(delegateSectionHtml);
  for (const forbidden of forbiddenMetadata) assert.ok(!decodedDelegateSectionHtml.includes(forbidden), `代管船舶中繼資料不得出現在文字、tooltip、aria-* 或 data-*：${forbidden}`);
  const activeToggles = openingTagsByClass(delegateRows[0], 'button', 'delegate-manager-toggle');
  const inactiveToggles = openingTagsByClass(delegateRows[1], 'button', 'delegate-manager-toggle');
  const unselectedToggles = openingTagsByClass(delegateRows[2], 'button', 'delegate-manager-toggle');
  assert.equal(activeToggles.length, 1, '已激活列需有唯一狀態按鈕');
  assert.equal(inactiveToggles.length, 1, '未激活列需有唯一狀態按鈕');
  assert.equal(unselectedToggles.length, 0, '未選取列不得顯示狀態按鈕');
  assert.equal(decodedAttribute(activeToggles[0], 'aria-label'), `${activeShipName}｜已激活；點擊切換為未激活`, '已激活狀態按鈕本身需包含船名脈絡');
  assert.equal(decodedAttribute(inactiveToggles[0], 'aria-label'), `${inactiveShipName}｜未激活；點擊切換為激活`, '未激活狀態按鈕本身需包含船名脈絡');
  assert.equal(decodedAttribute(activeToggles[0], 'title'), `${activeShipName}｜已激活；點擊切換為未激活`, '已激活狀態 tooltip 需與按鈕無障礙名稱一致');
  assert.equal(decodedAttribute(inactiveToggles[0], 'title'), `${inactiveShipName}｜未激活；點擊切換為激活`, '未激活狀態 tooltip 需與按鈕無障礙名稱一致');
  const base = {
    revision: 1,
    updatedAt: '2026-07-21T00:00:00.000Z',
    settings: { systemTitle: 'QA', departments: [], rolePermissions: undefined },
    users: [
      { id:'u1', department:'航運處', name:'代管甲', username:'u1', role:'operator', passwordHash:'', isActive:true, managedVesselIds:[], createdAt:'2026-07-21T00:00:00.000Z', updatedAt:'2026-07-21T00:00:00.000Z' },
      { id:'u2', department:'航運處', name:'代管乙', username:'u2', role:'operator', passwordHash:'', isActive:true, managedVesselIds:[], createdAt:'2026-07-21T00:00:00.000Z', updatedAt:'2026-07-21T00:00:00.000Z' },
    ],
    vessels: [{ id:'v1', name:'船一', shortName:'船一', fullName:'船一', shipType:'', fleetCategory:'', fleetTags:[], assignedUserIds:[], delegateManagers:[{ userId:'u1', isActive:true }, { userId:'u2', isActive:false }, { userId:'', isActive:true }, { userId:'u1', isActive:false }], isActive:true, position:{}, cargo:{}, note:{}, weeklyAttention:[], createdAt:'2026-07-21T00:00:00.000Z', updatedAt:'2026-07-21T00:00:00.000Z' }],
    tasks: [], meetings: [], reports: [], notifications: [], auditLogs: [],
  };
  const normalized = normalizeAppData(base);
  assert.deepEqual(normalized.vessels[0].delegateManagers, [{ userId:'u1', isActive:true }, { userId:'u2', isActive:false }], '代管名單需去重、去空值並保留個別激活狀態');
  assert.equal(delegation.hasActiveVesselDelegation(normalized.vessels[0], 'u1'), true, '激活代管人員應取得代管關係');
  assert.equal(delegation.hasActiveVesselDelegation(normalized.vessels[0], 'u2'), false, '未激活代管人員不得取得代管關係');
} finally {
  await server.close();
}

console.log('Delegate vessel management contracts passed.');
