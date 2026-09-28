# 跟蹤新類型與年檢到期日：發布交接

## 範圍與日期語意

- 岸端及船端增加「年檢工程」「塢修備件」「塢修物料」。年檢屬工程，其餘兩者屬供應；塢修物料納入物料聚合。
- 日期欄統一為「期望完成日/DL/到期日」，仍保存於 `expectedDate`。年檢將此日期視為到期日，沿用原先實際完工日期／未完成逾期判斷；到期當日不算逾期。
- 年檢獨立分類、到期狀態圖表及統計 Excel「年檢到期」工作表；PDF 同步帶入分類與圖表。年檢已包含於總計，獨立呈現不重複加總。
- 不回填或猜測舊未分類資料，不新增日期欄位，不改登入／角色、草稿、保存協調與快取行為。

## SQL 分類及影響

1. `supabase/migrations/20260928140000_tracking_annual_types.sql`：**相容式功能擴充**。更新共用類型 validator、另增 statistics v2，保留 statistics v1 原樣。不更新／刪除業務資料，不變更既有表結構。
2. `supabase/verification/tracking-annual-types-readback.sql`：**唯讀核驗**。僅檢查函式本體、簽名、權限及必要物件，不傳回業務資料或憑證。

新前端船端需要 v2，不能先部署前端再補 SQL。舊前端可繼續使用 v1；在重新開啟新版前，舊前端會把新增類型歸入舊資料未分類，舊版物料聚合也不包含新增塢修物料。這是相容窗口，不是舊前端已支援新功能。

## 使用者操作順序

1. **先不 Push。** 確認 Supabase SQL Editor 是現行 Ship Dynamics 正式專案。此次核對的公開配置 host 為 `cyzpcvvhmoiihsqvjspp.supabase.co`；確認專案 ref、正式環境／分支、Primary Database 及執行角色 `postgres`。
2. 從已核對 commit blob 的 Hermes Preview 第 1 個唯讀文字框，點「選取全部」，自行 Ctrl+C；貼入一個新的 SQL Editor query，完整執行一次 migration。助手不操作剪貼簿、不代貼或代按 Run。
3. 若明確顯示成功，可直接開另一個新 query，自行複製 Preview 第 2 個文字框的唯讀 readback 並執行。不需要在正常成功步驟之間逐次回覆。
4. 核驗預期：`status = PASS`、`checks = 6`、`failures = []`。保留結果並回傳此最終核驗結果；之後由使用者在既有 GitHub Desktop 專案 Push 本機 commit。
5. Push 後另核對 GitHub Pages 的 commit／版本；雙端重新開啟新版，做必要正式驗收。本機 UI＋合成資料／本機 PostgreSQL PASS 不代表正式 Supabase 或 Pages 已完成。

### 停止條件

- 專案不符、前置版本不符（`tracking-annual-types-predecessor-mismatch`）、任何 SQL 錯誤、逾時／結果不明或 readback FAIL：停止，不盲目重跑、不 Push，保留畫面交回核對。
- migration 在同一交易中執行，會先檢查既有函式版本；可接受已核對的前一版本或同一新版本，但不覆寫不明版本。已在本機驗證重複安裝與 LF／Windows CRLF 均可。
- 如出現無法判斷的破壞性警告，不自行略過；這份擴充 SQL 預期不刪除／改寫業務列。
- 不以清除瀏覽器儲存空間、清草稿、回復舊 SQL 或重設正式資料作為發布步驟。

## 已執行的本機驗證

- `npm run test:tracking:fields`：共用欄位、流程、八類型 Excel 往返、舊格式與獨立日期。
- `npm run test:tracking:statistics`：新類型、年檢獨立日期邊界、分類／總計分解、報告及統計 Excel。
- `npm run test:tracking:fields:browser`：岸端及船端真實 UI＋測試資料，新增保存／讀回、批量編輯、篩選、桌面及手機。
- `npm run test:tracking:statistics:browser`：岸端及船端原 UI、統計範圍、年檢圖表、新供應類型、真實下載 Excel／PDF、過期回應／失敗不冒充零筆。
- `npm run test:ship-tracking`、`npm run test:ship-tracking:native`：船端 client 與原生 SQL 回歸。
- `npm run test:tracking:table`、`npm run test:tracking`、`npm run test:tracking:spreadsheets`：相關既有表格、流程、試算表回歸。
- `node scripts/verify-tracking-field-native.mjs` 及 `--crlf-install`：真實 PostgreSQL，八類型保存讀回、未知前置版本拒絕、重複安裝、舊資料與權限保持。
- `node scripts/verify-tracking-fleet-native.mjs` 及 `--crlf-install`：SQL／TypeScript 聚合一致、v1 保留、年檢子集、唯讀核驗及權限。
- `npm run build`（含 TypeScript）與 `git diff --check`。

本輪未另外啟動獨立程式碼審查；完成的是定點自審及上述實測。正式 SQL、Push、部署與正式保存驗收各自獨立，未由助手代執行。
