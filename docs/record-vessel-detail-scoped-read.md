# 船舶詳細頁：原 App 有限定向讀取片

基線：`5dc6d9c8aad3db39db7e2edf662ed1c81bc30f85`。僅本機候選，不代表正式 SQL、Push、部署或全站驗收。

## 依當前 mounted consumer 決定 scope

原入口仍為 `main.tsx → App → DashboardView → VesselDetailPage`。

- `VesselDetailPage.tsx` 的基本資料、航行、貨載、動態、指派人員均取完整 vessel／users／settings；這些在既有 `home` response 已是完整 record。
- 單船列表、數量、排序、搜尋取 description、status、closure、category、department、owner、日期，以及指定 member 的目前進度。此頁**沒有歷程列表或歷程全文搜尋**。
- 未同步內控列表取同船且無 linkedTaskId 的 case；會議只供原有 abnormal predicate。既有 home summary 保留所有 ordered IDs、以上欄位及關係鍵，只省略歷程尾部與 agenda snapshot。
- 因此最短充分 scope 是既有 `home`，不是新建 vessel target。沒有新增或修改 reader SQL，也沒有假設 vessel target 會自帶關係圖。
- 原 task child 的 exact task target 仍由既有 reader 完成 task/case/meeting 的雙向遞迴 closure。原 member child 仍走既有 exact member protocol。原 vessel lease refresh 保留當前 read scope；同期 sync 不把已載入 child 歷程降回摘要。

## 最小產品差異

只改 `App.tsx` 兩個內部 handler：

1. `openVesselDetail` 從 `full` 改為 `home`。
2. 開啟 continuation 保留 scope generation、exact actor ID、session generation；即使 home 已載入而只跨一個 microtask，也不能讓舊 callback 選到後繼身份／導航。
3. `closeVesselDetail` 同步失效 pending scope generation。

`VesselDetailPage`、Dashboard、EditModals、所有 JSX、字樣、CSS、入口、權限、業務關係、member/writer SQL 均保持基線。原船舶帳戶仍可「新增待辦」，本片不改此政策；只讀既有 task 仍顯示完整請求歷程。手機／PDF 原碼未改，本片沒有另作全量手機或 PDF 矩陣驗收。

## 證據與接受範圍

外部證據根：`C:/Users/tuotu/AppData/Local/hermes/cache/record-read-lock-6e300abf/`；完整終態以 `vessel-detail-delivery.json` 為準。

- `vessel-detail-red-ui/`：原 UI＋native PostgreSQL，點船名進詳細頁即產生 full 讀取，行為 RED；不是 mock response。
- `vessel-detail-red-controls/`：原 handler execution 的 full expansion／close continuation RED。
- `vessel-detail-same-scope-red-controls/`：初始 home 最小修正後，same-scope actor/session continuation 的定點 RED；最終 exact identity fence 關閉。
- `vessel-detail-accept-ui/`：8 個本片原 UI/nativePG case：完整列表／數量／搜尋、快更保存、task/case 原子圖、dirty child sync/cancel 與不降級、member 保存返回、native SQL 完成後 held-read 導航、返回／換船／全新 document、原只讀 child。
- 同一 runner 的整頁 full-vs-summary rendered markup equality／部分 response 拒絕，單列為 component/protocol 層；獨立 fresh connection + fresh document 完整讀回也另列，不計入原 UI case 數。
- `vessel-detail-accept-controls/`：13 個 exact original-App callback 正負控，包含同 scope actor/session、晚回應、更新選擇、取消／導航、dirty／active child／null response、完整成功 response。
- 另跑原 member pair browser、scoped browser regression、兩個 source boundary、detail filter/layout、quick scope、typecheck、production build。不同 evidence layer 不相加成 E2E 總數。

所有合成 SQL 的 before/after、immutable outgoing、SQL 前 expected、完整 raw graph、未選中 value/revision/xmin/ctid/history、member sibling physical row、formal itinerary 不變及 fresh readback 均存於外部 JSON。業務 expected 不以 SQL AFTER 整段補造；member 的 server-generated ID/time 僅按原 oracle 的獨立格式／時間窗規則 bind。

產品讀取區間禁止 full／compatibility fallback，且不得傳送未選中 task/case/meeting 歷程 sentinel 或 agenda snapshot。獨立 QA 的最後完整讀回有單獨 case 標記，不是產品補載。

## 可重現命令

設定隔離的 `QA_EVIDENCE_ROOT`、`QA_VITE_CACHE_DIR`、`QA_HMR_PORT`，以及已驗證的 `SHIP_QA_PG_BIN` / `SHIP_QA_PG_MODULE`，串行執行 browser 批次：

```text
node scripts/verify-vessel-detail-scoped-browser.mjs
node scripts/verify-vessel-detail-scoped-controls.mjs
node scripts/verify-vessel-detail-scoped-boundary.mjs
node scripts/verify-task-member-ui-boundary.mjs
QA_MEMBER_UI_FOCUS=pair node scripts/verify-task-member-browser.mjs
node scripts/verify-record-scoped-browser.mjs
node scripts/verify-vessel-detail.mjs
node scripts/verify-vessel-detail-quick-layout.mjs
node scripts/verify-vessel-quick-update-scope.mjs
node node_modules/typescript/bin/tsc --noEmit
npm run build
```

browser receipt 的 inputs SHA 為 `SHA256(JSON.stringify(UTF8 text))`；command receipt 另存 raw-byte SHA。兩者不得混用。歷史失敗收據保留；權限負控曾誤禁止原 vessel `createTasks`，已確認原 source 後只修測試，處置見 `vessel-detail-attempt-dispositions.json`。

## 明確 OPEN／未做

- 獨立 batch/create、morning/report/stats/management 的剩餘 scope 片，以及 report preview／historical agenda full 入口仍 OPEN，沒有刪除或改列可選。
- 本片不宣稱全 R1–R3 完成，也沒有重開已閉合 homepage/task/case/meeting/member/root writer 或 legacy upgrade。
- 無全站 review、無新的 independent PASS。B01 沿用父代理既有定點 closure，不在此片重審。
- 無正式服務接觸、正式 SQL、Push、merge 或部署。私有 PG、Chrome、HTTP、profile/data 均由各 runner 精確清理，終態詳見 handback。
