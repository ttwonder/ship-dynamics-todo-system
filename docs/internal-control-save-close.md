# 內控保存與明確結案操作

## 已驗證修正

- 保存入口在第一次 `await` 前取得同步 admission，結束時以 `finally` 釋放。既有 durable handoff 保留原本的租約、草稿、未知 ACK 與確認語意，不以它替代準備階段防重入。
- 原編輯窗增加同步 ref 防重複提交；保存期間停用編輯、結案、撤回、刪除和關閉，等待原保存結果。真正的並發衝突規則未放寬。
- 直接修改「解決計劃／最新狀態」時，自動附上必要的狀態歷程；「加入狀態記錄」中尚未加入的輸入亦隨保存一併處理。可信的歷程 ID、作者、時間仍由原業務更新器產生。
- 原視窗底部增加高對比「結案並保存」；已結案顯示「重新開啟並保存」。沿用原權限、日期、關聯要事與保存確認；確認取消不寫入，雲端 ACK 前不關閉。
- 明確辨識 `canceling statement due to statement timeout`，不再把這類 57014 提示成單純網路中斷；其他 57014 取消原因不冒充查詢逾時。

## 事故判斷與未解範圍

兩張畫面屬不同案件，不合併成同一交易。

已在修正前的實際 App 保存函式、實際內控 updater 及 rebase 下，使用受控的記憶體 RPC／隊列重現：兩次保存同時通過準備入口，各自建立不同的歷程 ID，第一筆完成後，第二筆產生 `dependency:internal-control-status` 衝突。修正後只允許一次 apply／寫入；準備讀取失敗後可再次手動提交。

這是能觸發相同錯誤的已驗證程式缺口，但沒有事故當時的重複提交／B-L-R 快照證據，不能斷言就是該次正式事故根因，也不把它描述為使用者誤操作。

單次正常保存、同一份已接受更新的正規化回讀均不會自行產生此衝突；真正不同的業務更新仍被拒絕。沒有修改 rebase、CAS、資料庫權限或 SQL。

另一筆 statement timeout 的慢查詢、鎖等待或負載原因仍未確認。需要事故時段 Supabase Database/API 日誌，定位被取消的 RPC、耗時及等待；本次前端修正不代表資料庫逾時已根治。不要靠清除瀏覽器資料、刷新事故編輯窗或反覆保存診斷。

## 驗證

- `npm run test:internal-control-save-close`：實際保存入口的單次／重疊／準備失敗重試；正規化回讀與真正衝突；SSR 結案及權限；逾時分類。
- `npm run test:internal-control`、`npm run test:cloud-rebase`、`npm run test:related-durable-mutations`、`npm run test:work-center-direct-edit`、`npm run test:permissions`：通過。
- `node scripts/verify-related-draft-continuity.mjs`：16 個受控租約失效／編輯器保留情境及 2 個原 operation receipt 情境通過；不是 native UI／SQL 證據。更新舊 fixture 缺少的 memberEditor、有效船舶及 authority/config 參數，沒有改產品來迎合測試。
- `npm run test:work-center-direct-edit-browser`：8 組原 App／Chrome／本機 PostgreSQL 情境通過；含直接修改狀態首存、重複 Enter 不重複歷程、持有 ACK、不提前顯示成功、結案取消零寫入、帶未加入紀錄結案、重新開啟、桌面及手機畫面、全新文件讀回。
- `npm run typecheck`、`npm run build`、diff whitespace check：通過。

瀏覽器 QA 需本機 PostgreSQL runtime 與 pg module，可透過 `SHIP_QA_PG_BIN`、`SHIP_QA_PG_MODULE` 指定。測試僅 synthetic 資料，外部網路被封鎖；原始 receipt `ui-t7OfMH` 記錄 8/8 PASS、product input hashes、零 console error、未接觸正式服務、Chrome／fixture 停止與 port 關閉。

本次未做整站獨立審查，只有有界唯讀原因調查及實作者驗證。本機提交與正式部署分開；不代 Push、不執行正式 SQL。上述本機修正不需要新增 migration。
