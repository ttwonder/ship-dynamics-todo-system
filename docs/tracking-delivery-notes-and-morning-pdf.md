# 送船備註與早會 PDF 入口

## 使用方式與範圍

- 岸端／船端「送船狀態」各選中項目都有自己的「送船備註」輸入框，可填已送與未送明細。與送船狀態同一批保存；以 `送船備註：…` 追加最新進度，不替換原進度，並沿既有關聯更新內控／要事進度歷程。留空不改進度。
- 部分送船不代填完整送達日期、不自動結案。已結案項目要新增備註，須先依原流程重開；原本允許的送達日期更正保留。單筆備註最多 2000 字，合併進度仍受既有 10000 字上限限制。
- 首頁「建立 PDF 報告」顯示準備狀態，確認雲端資料及正式 Itinerary 後，打開與報告中心相同的 A4 橫向早會報告並呼叫瀏覽器列印。使用者在瀏覽器選「另存為 PDF」保存；不是無提示寫入任意本機位置。
- 報告中心「開啟 PDF 預覽」仍先預覽，再按「導出／列印 PDF」。保存今日早會歷史是另一個原有按鈕，此次建立 PDF 不新增或覆蓋每日歷史。
- 捕捉已確認的資料版本、報告選船、時間與正式 Itinerary，不使用發起讀取前的舊 React 資料。角色／工作區切换、導航、取消及明確安全同步的原有失效規則保留；失效後需重新建立，不把新資料悄悄替換成舊報告的內容。

## PDF 逾時：已證實範圍與限制

原始錯誤為 `canceling statement due to statement timeout`。原入口用 `full` scope，會包含所有早會歷史快照等非本次報告需要的完整內容；此次改用已存在的 `morning` scope，保留 home 確認、完整相關 tasks/cases/meetings、必要比較基線及正式 Itinerary，不提高伺服器 timeout、不吞錯或退回舊資料。

本機目前 v2 SQL＋真實 App 已驗證：兩入口不走 full、未取入無關歷史快照，產出的 PDF 內容一致。用隔離 PostgreSQL 人為縮短 statement_timeout 取得實際 SQLSTATE `57014`，確認錯誤可見、沒有舊 PDF、只在使用者明確重試後恢復。這是失敗路徑驗證，不是正式逾時根因重現或正式效能保證；目前沒有正式失敗 RPC trace／SQL plan。部署後若仍逾時，應先核對失敗 endpoint、scope、耗時與版本，再決定是否需要 SQL 優化。

## SQL 與發布順序

**尚未執行正式 SQL，尚未 Push／部署。** 本次 PDF 修正不用新增 SQL；船端送船備註需要先更新原有私有 planner：

1. 使用者於正確 Supabase 專案，手動執行 `supabase/migrations/20260929090000_tracking_delivery_notes.sql`。
2. 另行執行只讀 `supabase/verification/tracking-delivery-notes-readback.sql`；應得到 `PASS / 4 / []`。未通過前不要發布新前端。
3. 再由使用者 Push 本機 commit。確認 GitHub Pages 部署版本後，以新頁面檢查兩個 PDF 入口及雙端備註保存。

Migration 在 transaction 內只替換原私有 `plan_v1` 函數，不修改既有業務資料／表格、不增加公開端點或權限。支援舊版省略 note 的指令与舊 operation receipt 重播；可重複執行。前置檢查要求已安裝相符的軟刪除版 planner；如出現 `tracking-delivery-notes-predecessor-mismatch`，保留錯誤，先核對原先 migration，勿移除檢查或強行改雜湊。

## 可重跑驗證

以下是原始 App／Chromium＋隔離 PostgreSQL 和合成測試資料，不是正式 Supabase／PostgREST／Realtime 驗收。PG runtime 由既有 `SHIP_QA_PG_BIN`、`SHIP_QA_PG_MODULE` 提供，輸出目錄用 `QA_EVIDENCE_ROOT` 指定。

```text
node scripts/verify-tracking-delivery-notes.mjs
node scripts/verify-tracking-delivery-notes-native.mjs
node scripts/verify-tracking-browser.mjs --delivery-notes
node scripts/verify-ship-tracking-browser.mjs --delivery-notes
node scripts/verify-morning-pdf-controls.mjs
node scripts/verify-morning-pdf-print.mjs
node scripts/verify-morning-pdf-browser.mjs
python3 scripts/verify-morning-pdf-artifacts.py <morning-pdf-run-directory>
node scripts/verify-record-action-authority.mjs
node scripts/verify-report-history-scoped-controls.mjs
node scripts/verify-morning-history.mjs
node scripts/verify-morning-cutoff-window.mjs
node scripts/verify-morning-agenda-classification.mjs
npm run typecheck
npm run build
```

PDF verifier 會觀察原按鈕到 `window.print` 的資料／樣式，再以 Chromium `Page.printToPDF` 實際產檔；不是自動按作業系統列印視窗。兩份測試 PDF 文字一致、A4 橫向、無空白頁；人工視讀首頁與末頁。備註測試包括逐項對應、手機滿寬、ACK 未到保留輸入、ACK 遺失精確重播不重複追加、同批拒絕不部分寫入、岸船關聯歷程與已結案限制。
