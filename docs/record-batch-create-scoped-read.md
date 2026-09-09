# 批量船舶／新增要事：有限 scoped-read 相連片

基線：`d1745dec677fb07d04a200d23ce3bc2326b1496d`。原 `main.tsx → App`；不是 NormalizedApp。僅本機驗證與本機 commit，無 Push、正式 SQL、部署或獨立 reviewer PASS。

## Consumer 與最小改動

- 原 `BatchManagedVesselModal` 只編輯完整船舶營運欄位；正式 Itinerary 投影仍沿原 reader，日期／貨載欄位仍唯讀。
- creating `TaskEditModal` 使用完整船舶、users/settings、目前關係及全新 task 草稿。它不消費其他既有 task/member/case/meeting 歷程尾部或 agenda snapshot。
- 既有 home 已含所需完整 records，故兩個入口沿 `recordReadScope.current`，不再擴張 `full`；已載入 target union 不降級。
- `refreshAfterItemLease` 以原 `isTaskCreationLockKey` 識別 creation key 並保留目前 scope。原 exact task/case/meeting graph 分支、durable floor、dirty 判斷與 required-response 拒絕不變。
- `refreshBatchAfterLeaseBundle` 本來就用帶目前 scope 的 App fetch wrapper；不修改這個函數，也不把 exact targetIds 縮成最後一把鎖或 teardown 後已清空的勾選。
- 新增要事跨 await 的同 scope continuation 補 exact actor、identity generation、cloud identity、authorization epoch 檢查；原 task request generation、batch session/context、授權重查與 default 值規則不變。

產品只動 `App.tsx` 三個 named handlers 的四個 exact spans。`record-batch-create-source-allowlist.json` 與對應 boundary gate 對 delegated base 套用唯一替換，凍結其他全部 src/public/SQL/root bytes；沒有 JSX、按鈕、字樣、樣式、權限或 SQL 變更。

## 行為與交易保證

原批量保存完成 ACK／釋放 bundle 後才新增 child。child 保存是另一筆原子交易；child 取消不撤銷已 ACK 的批量更新。保存或取消均透過舊 context 回到同一精確兩船集合，重新授權、完整 bundle acquisition 與 freshness。未選第三船與既有無關歷程保持 deferred 且不被覆寫。

原船端 `createTasks` 仍可為 true；本片實際從原登入、本船卡片新增、取消及保存。錯船／原禁權負控在 source-composed callback 層，不能混稱 native UI 負控。既有 task 可讀不等於可編輯。

新增要事與批量視窗在保存待 ACK 時原本禁止再修改提交欄位；保留這個政策及同一 modal／immutable operation。這不是 member 的可繼續輸入新稿流程。較新 task request／session 與 queued pending draft 的保護分別由本片 controlled callback 及既有 pending-creation queue gate 驗證，未杜撰舊持久化 request envelope。

## 分層證據

證據根：`C:/Users/tuotu/AppData/Local/hermes/cache/record-read-lock-6e300abf/`。精確最新結果、commit/tree、hash、完整 command receipts、失敗處置與 cleanup 以 `batch-create-scoped-delivery.json` 為準。

- `batch-create-red-linked-ready/`：當前基線原 UI／nativePG；冷首頁批量、新增要事入口與 lease 後 freshness 實際產生 `full`，兩個行為 RED。
- `batch-create-controls-red/`：當前原 handler 的讀取 scope RED。
- `batch-create-green-first/controls.json`：只換 scope 後，actor/session/config 與晚 refresh session 的 continuation 定點 RED；補 identity fence 後 GREEN。
- `verify-batch-create-scoped-browser.mjs`：原 UI／nativePG；兩船＋未選第三船、cancel 與 dirty child sync、批量與 task 的 lost ACK／exact receipt、same modal／leases、child save/cancel exact return、home/detail create save/cancel、船端本船 create save/cancel、native SQL response held 後導航、fresh original document 與無 trailing save。
- 同一 runner 的 fresh connection＋fresh document 完整讀回屬獨立 QA-readback 層，不是產品偷偷 full 補載，不與 UI case 相加。
- `verify-batch-create-scoped-controls.mjs`：20 個當前 App callback cases（11 creation／9 whole-bundle freshness），包含 missing first/last target、角色、dirty、rollback、null、session/config、successor。
- `verify-record-batch-task-session.mjs`：沿原 19 個 close／coordinator／exact-return matrix；僅补目前 mounted consumer 必需的空 member ref 與入口環境，不重寫舊行為。
- 既有 batch-vessel/task reject browser（PGlite、delta-v1）保留相容／rollback／retry 證據，與 native scoped 層分列。另跑 task-creation-lock、pending-task-creation-queue、batch-managed-vessel helper、scoped original browser、member UI boundary、typecheck/build。

完整 raw BEFORE、SQL 前 expected、outgoing request、AFTER、all-record metadata ledger、audit/notices/history、未選中 value/revision/xmin/ctid、formal itinerary snapshot、fresh readback 均在外部 JSON。expected 沿原 helper＋明確 UI intent 推導；只有 request 生成的 ID/time 依獨立新 ID／時間窗檢查綁定，SQL metadata 與 server audit IP 獨立約束，不由 SQL AFTER 整段回填 expected。browser inputs 使用 `SHA256(JSON.stringify(UTF8 text))`；command receipt raw-byte SHA 另列。

## 可重現

設定私有 `QA_EVIDENCE_ROOT`、`QA_VITE_CACHE_DIR`、`QA_HMR_PORT` 與本機 `SHIP_QA_PG_BIN`／`SHIP_QA_PG_MODULE`；browser 串行：

```text
node scripts/verify-batch-create-scoped-browser.mjs
node scripts/verify-batch-create-scoped-browser.mjs --create-red
node scripts/verify-batch-create-scoped-controls.mjs
node scripts/verify-batch-create-scoped-boundary.mjs
node scripts/verify-record-batch-task-session.mjs
node scripts/verify-record-batch-vessel-browser.mjs --reject
node scripts/verify-record-batch-task-browser.mjs --reject
node scripts/verify-batch-managed-vessel-updates.mjs
npm run test:task-creation-lock
npm run test:pending-task-creation-queue
node scripts/verify-record-scoped-browser.mjs
node scripts/verify-task-member-ui-boundary.mjs
npm run typecheck
npm run build
```

`--create-red` 是冷首頁單一 create regression 的歷史名稱；在修正後必須 GREEN，不是放寬 assertion。

## 失敗處置與 OPEN

所有 failed attempts 保留。初始 fixture 在 linked task/case 各自添加不同 history IDs，違反原 normalize 的相等契約，修正為同一歷程；屬 harness readiness。首版 batch oracle 未綁 UI 生成的 note/position timestamp，修 QA oracle（SQL 尚未執行）；不是產品 partial write。舊 session harness 缺 memberEditor/current entry refs、boundary 替換 span 不唯一、controlled type-only import 被 transpile 成 export marker，均只修 QA。Build 既有 >500kB chunk warning 仍有，未稱零 warning。

歷史 `verify-record-batch-vessel-boundary`／`verify-record-batch-task-boundary` 全 source equality 以更早 commit 為基線，不能直接批准後續已接受的產品片；本片改用新 exact delegated-base gate，沒有覆寫舊歷史 allowlist 或聲稱舊整樹 gate PASS。

本片外 morning/report/stats/management、report preview／`openHistoricalReport` history-snapshot consumer scope、全局 recovery/ABA 矩陣、performance、hosted、多角色手機/PDF、使用者試用、最新資料切換／回退均 OPEN。`record-vessel-detail-scoped-read.md` 僅修正歷史 agenda 錯指標；不由缺少 `openHistoricalAgenda` symbol 推定報告歷史已驗收。不重開 B01/A/C/D、member/root/writer SQL，也沒有新的獨立 review。
