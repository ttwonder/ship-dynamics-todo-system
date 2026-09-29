# 雙端批量辨識、狀態紀錄及送達同時結案

## 操作變更

- 批量修正、分類修正、進度、送達／完工、結案／重開／日期更正、同步內控、刪除／申請／駁回／還原，以及所選紀錄，均以「申請單號｜內容」辨識來源。有原項次或子項次時保留補充；同單號不同項目不合併。未填資料用明確空值提示，不回退顯示內部 ID。
- 「批量更新」改為「批量修正」。另有的「批量更新進度」仍維持原用途。
- 「查看所選狀態更新紀錄」優先展開各選取項目的已保存進度文字、送船／完工、結案／重開與結案日期更正。時間、更新人和事件前後值保留；分類、刪除、同步等其他事件置於「其他操作紀錄」收合區，沒有刪掉歷史。
- 紀錄視窗只讀目前清單已取得的保存資料，不取得編輯鎖、不保存，也不冒充所有欄位的完整修改審計。

## 送達與結案

- 送達確認／更正中新增醒目的「同時結案」，**預設不勾選**。
- 僅「已送船（全部實際交到船）」、整批均未結案，且原身份具有結案權限時可用。切到部分送船／未送船即清除並停用勾選。
- 勾選後，送達資料、逐項備註及結案以同一操作原子保存；結案日期使用本次實際送達日期，提交鈕顯示「確認送達並結案 N 項」。任何一筆錯誤均不部分保存。
- 沿用原結案規則：同步有效關聯內控與既有要事，不新建關聯、不以相同申請單號擴張選取。船端不提供要事操作控制。
- 備註逐項追加最新進度，不覆蓋原文；留空不改。保留逐項進度歷程及獨立 delivery／close 事件。
- 未勾選仍只變更送達；已結案項目仍可更正送達日期，但不因此重新結案或改結案日期。若含已結案項目，「同時結案」停用，須先另選未結案項目。
- 等待確認時保留輸入；未知結果使用原 operation 重試，不重複追加備註或结案事件。原有範圍、鎖、版本及身份規則不放寬。

## SQL 與上線順序

先由使用者手動執行：

1. `supabase/migrations/20260929120000_tracking_delivery_close.sql`
2. 另行執行唯讀 `supabase/verification/tracking-delivery-close-readback.sql`，預期 `PASS / 6 / []`。
3. 核驗通過後再由使用者 Push，部署後核對版本與正式雙端操作。

新版 SQL 包含上一版送船備註 planner，兼容「soft-delete 已安裝、notes 未安裝」及「notes 已安裝」兩個已知前置版本；可重複執行。**不必先補跑舊 notes SQL，也不要在新版之後再跑舊 notes SQL。** 舊 notes readback 的 body hash 已被新版取代，請用本輪核驗。

SQL 只更新命名函數，不回填／刪除業務資料，不新增公開授權；保留既有公開 RPC、鎖／CAS 及原提交收據。若出現 `tracking-delivery-close-predecessor-mismatch`，表示正式函數不是已知前置版本：停止，不移除保護或自行覆寫。

## 驗證入口及限制

- `npm run test:tracking:batch-usability`：原元件渲染、所有批量顯示、只讀紀錄與 domain／表單行為。
- `npm run test:tracking:delivery-close:native`：本機 PostgreSQL、兩端寫入路徑、關聯三者一致、整批回滾、相同提交重播、權限／資料保留與 SQL readback；加 `-- --without-notes` 驗證跳過前批 notes 升級。
- `npm run test:tracking:batch-usability:browser`：原始雙端入口＋原生本機 SQL＋測試資料，桌面／390px，同號不同內容、未選資料不變、全部可用視窗、狀態紀錄、held/lost ACK。
- 舊瀏覽器回歸可加 `--current-tracking-sql`，讓備註／compact／component 測試安装本輪 SQL。QA 環境需設定既有 `QA_EVIDENCE_ROOT`、`SHIP_QA_PG_BIN`、`SHIP_QA_PG_MODULE`，不是正式憑證。
- 測試使用隔離原生 PostgreSQL 與原始 App；不等於 hosted Supabase／正式資料验收。正式 SQL、Push、部署及正式驗收由各自關卡確認。
