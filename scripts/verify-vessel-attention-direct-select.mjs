import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const server = await createServer({ server:{ middlewareMode:true }, appType:'custom', logLevel:'silent' });
try {
  const attention = await server.ssrLoadModule('/src/vesselAttention.ts');
  assert.equal(attention.manualVesselAttentionAllowed('', '高'), true, '自動判定永遠可選');
  assert.equal(attention.manualVesselAttentionAllowed('中', '高'), false, '手動值不得低於自動下限');
  assert.equal(attention.manualVesselAttentionAllowed('高', '高'), true, '可直接選擇自動下限');
  assert.equal(attention.manualVesselAttentionAllowed('特別關注', '高'), true, '可直接選擇更高關注度');

  const { default: Dashboard } = await server.ssrLoadModule('/src/Dashboard.tsx');
  const user = { id:'u1', name:'督導', role:'admin', department:'船務', passwordHash:'', isActive:true, managedVesselIds:['v1'], createdAt:'', updatedAt:'' };
  const vessel = { id:'v1', name:'測試輪', shortName:'測試輪', fullName:'TEST', shipType:'散裝船', fleetCategory:'bulk fleet', fleetTags:[], assignedUserIds:['u1'], delegateManagers:[], isActive:true, manualAttentionLevel:'', position:{ source:'manual', location:'', speedKnots:0, navigationStatus:'航行', lastPort:'A', nextPort:'B', eta:'', etb:'', etd:'', updatedAt:'', manualRemark:'' }, cargo:{ source:'manual', loadStatus:'空載', name:'', quantity:'', items:[], updatedAt:'' }, note:{ statusList:[], statusSupplement:'', captain:'', chiefOfficer:'', chiefEngineer:'', firstEngineer:'', recentDynamics:'', subsequentDynamics:'', updatedAt:'' }, weeklyAttention:[], createdAt:'', updatedAt:'' };
  const task = { id:'t1', vesselId:'v1', vesselIds:['v1'], vesselScopeMode:'vessels', vesselTypeScopes:[], priority:'低', attentionDimension:'task', isAware:false, isAbnormal:true, isInternalControl:false, category:'其他', categories:['其他'], description:'異常', status:'', expectedDate:'', reportDate:'', departments:[], ownerUserIds:[], isClosed:false, sourceType:'morning', createdBy:'u1', updatedBy:'u1', createdAt:'', updatedAt:'', statusLogs:[], vesselProgress:[] };
  const markup = renderToStaticMarkup(React.createElement(Dashboard,{ user, users:[user], vessels:[vessel], tasks:[task], internalControlCases:[], meetings:[], selected:[], setSelected(){}, batchSelected:[], setBatchSelected(){}, onOpenVessel(){}, onEdit(){}, onAddTask(){}, onToggleAttention(){}, onAdjustAttention(){}, onStartMeeting(){}, onOpenReport(){}, onTaskMetric(){}, onOpenBatchManagedVessels(){}, canEdit:true, canCreateTasks:true, canUseMeetings:true, canUseReports:true }));
  assert.match(markup, /<select[^>]*aria-label="TEST 關注程度"/, '狀態膠囊須改為直接選擇的下拉選單');
  assert.match(markup, /<select[^>]*class="[^"]*attention-adjust-select high[^"]*"/, '自動高關注時，下拉本體必須套用高關注色階');
  assert.match(markup, /<option class="attention-option high" value="" selected="">自動：高關注<\/option>/, '非 PSC 來源的自動高關注仍只顯示一般自動狀態');
  const pscMarkup = renderToStaticMarkup(React.createElement(Dashboard,{ user, users:[user], vessels:[{ ...vessel, weeklyAttention:['psc-window'] }], tasks:[], internalControlCases:[], meetings:[], selected:[], setSelected(){}, batchSelected:[], setBatchSelected(){}, onOpenVessel(){}, onEdit(){}, onAddTask(){}, onToggleAttention(){}, onAdjustAttention(){}, onStartMeeting(){}, onOpenReport(){}, onTaskMetric(){}, onOpenBatchManagedVessels(){}, canEdit:true, canCreateTasks:true, canUseMeetings:true, canUseReports:true }));
  assert.match(pscMarkup, /<option class="attention-option high" value="" selected="">自動：高關注-PSC<\/option>/, 'PSC 窗口開啟且自動等級為高時必須顯示 PSC 來源');
  assert.doesNotMatch(markup, /自動判定（|（目前：/, '關注下拉不得再顯示「自動判定」或括號說明');
  assert.doesNotMatch(markup, /attention-current-label/, '卡片頭部不得在下拉旁重複顯示另一份狀態文字');
  assert.match(markup, /<option class="attention-option low" value="低" disabled="">手動：低關注<\/option>/, '低於自動下限的手動選項須停用並保留低關注色階');
  assert.match(markup, /<option class="attention-option mid" value="中" disabled="">手動：中關注<\/option>/, '中關注低於高關注自動下限時須停用並保留中關注色階');
  assert.match(markup, /<option class="attention-option special" value="特別關注">手動：特別關注<\/option>/, '須可一次直接選擇有獨立色階的手動特別關注');

  const manualMarkup = renderToStaticMarkup(React.createElement(Dashboard,{ user, users:[user], vessels:[{ ...vessel, manualAttentionLevel:'特別關注' }], tasks:[task], internalControlCases:[], meetings:[], selected:[], setSelected(){}, batchSelected:[], setBatchSelected(){}, onOpenVessel(){}, onEdit(){}, onAddTask(){}, onToggleAttention(){}, onAdjustAttention(){}, onStartMeeting(){}, onOpenReport(){}, onTaskMetric(){}, onOpenBatchManagedVessels(){}, canEdit:true, canCreateTasks:true, canUseMeetings:true, canUseReports:true }));
  assert.match(manualMarkup, /<select[^>]*class="[^"]*attention-adjust-select special[^"]*"/, '手動改為特別關注後，下拉本體色階必須跟著切換');
  assert.match(manualMarkup, /<option class="attention-option special" value="特別關注" selected="">手動：特別關注<\/option>/, '手動狀態必須顯示「手動：狀態」');

  const styles = fs.readFileSync('src/styles.css','utf8');
  for (const level of ['low','mid','high','urgent','special']) {
    assert.match(styles, new RegExp(`\\.attention-adjust-select option\\.attention-option\\.${level}\\{[^}]*background:[^;}]+;[^}]*color:`), `${level} 下拉選項必須有獨立背景與文字色`);
  }

  const app = fs.readFileSync('src/App.tsx','utf8');
  const normalized = fs.readFileSync('src/NormalizedApp.tsx','utf8');
  assert.match(app, /adjustDashboardVesselAttention=\(vesselId:string,manualAttentionLevel:VesselAttentionLevel\|''\)/, '舊資料路徑須接收直接目標值');
  assert.doesNotMatch(app, /nextManualVesselAttention/, '不得再以循環方式計算下一關注度');
  assert.match(app, /if\(!manualVesselAttentionAllowed\(manualAttentionLevel,automatic\)\)return `自動判定已更新/, 'lease 後自動下限升高時必須拒絕而非默默改寫選擇');
  assert.match(app, /vessel\.manualAttentionLevel=manualAttentionLevel;/, '通過最新自動下限後必須保存使用者直接選定的值');
  assert.match(normalized, /onAdjustAttention=\{\(vesselId, manualAttentionLevel\) =>/, '正規化路徑也須直接接收目標值');
} finally { await server.close(); }

console.log('Direct vessel-attention selection and automatic-floor contracts passed.');
