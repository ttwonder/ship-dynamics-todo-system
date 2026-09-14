# 本人試用後：正式發布決策與停止點

**這是按現有證據整理的交接順序，不是可直接貼到正式資料庫執行的 SQL 包。** 本人未試用通過、目標環境未核定、正式 migration 未完成套用／readback 前，不進入 Push 或部署。

## 當前固定資料

- 產品候選：`6c57b5c42590a2c726e3386ddada5c133fa07035`；branch `development/normalized-storage`。
- [原 App 本機試用站](local-human-trial-handoff.md) 已交付；本人試用結果未取得。
- [雙向最新資料控制](source-authority-roundtrip-local.md)已本機驗證，`supabase/development/20260914_source_authority_roundtrip.sql` 仍是 development addon，不能單獨當正式 migration 執行。
- 本輪不查遠端 main／Pages／正式版本，不藉 branch 隔離之名連正式資料庫。正式目標的目前 schema、版本、權限及資料水位仍待下一次獲准後核對。

## 正式動作前的順序與停止點

| 順序 | 需要得到的結果 | 誰決定／操作 | 未滿足時 |
|---|---|---|---|
| 本人試用 | 原功能、畫面、角色、保存與聯動符合本人日常操作 | 本人操作隔離站 | 保留問題畫面及草稿，定點修正；不 Push |
| 真雲端目標 | 確认獨立 Supabase 測試環境或另行選定的實際路線、外部寫入範圍 | 使用者決定 | 不自建付費項目、不默認連正式資料庫 |
| 目標唯讀盤點 | 名冊、唯一 Owner、目前 source／epoch、安裝物件、版本、既有資料與未結操作可追溯 | 助手在獲准後核對 | 若身份／來源不明，fail closed，不要求登入者清 storage |
| 正式包固定 | 依真實 predecessor schema 合成必要 additive 安裝、授權、readback、切換、回退及失敗停止文件；固定 commit blob/hash | 助手準備、先隔離演練 | 不將測試 fixture 安裝 SQL 直接交付正式環境 |
| 維護時窗 | 所有人暫時不提交新保存，未提交草稿保留；區分 pause 與登出 | 使用者決定時間 | 不自行發通知、排 cron、啟動 pause |
| 安裝／切換 | exact target＋最新資料水位一致，分步 receipt 与讀回一致 | SQL 由使用者 Ctrl+C、貼到 SQL Editor、Run | 每一處不一致即停；不改 ID 盲重試 |
| 本人 Push／部署 | 本機 commit 正確、必要 backend 已到位，使用者明確批准上線 | 預設使用者 Push | 不以試用通过自動推送或合併 |
| 正式驗收 | 真網站載入相同版本、原登入、不同人保存、資料讀回與必要同步正常 | 助手核版本與真讀回；本人核業務 | 區分尚未部署、UI 誤報、舊快取、部分成功，不立即刷新／重試 |

雲端 Auth／ACL／PostgREST／Realtime／scheduler 與效能需要自己的真環境證據。本機試用站的8個 outcomes、船端 Excel、既有原 App native probes不能相加作為全站 hosted E2E。

## 已驗證的切換原則（不是即時操作授權）

本機安裝依賴以 [source-authority-roundtrip-local.md](source-authority-roundtrip-local.md) 及其實際 runner 為準：既有 schema／record／formal 前置 → legacy freeze/binding → business quiescence → paused stage → publication → browser authority → roundtrip addon。

每個正式步驟未來均需固定：目標 workspace key／UUID、source、epoch、當下 revisions／server hashes、transition/stage/publication／request IDs。不能用測試 workspace、硬編碼 fixture revision 或舊部署時的資料水位。

1. 先取得 exact 最新狀態，再 freeze／pause；pause 必須完成既有業務排空。
2. 在 paused 狀態由當下權威來源 materialize 目標，不接受任意外部 payload。
3. 對完整業務、順序、歷史、關聯及獨立正式 Itinerary 核對；發布來源後仍保持 pause。
4. 核對目前 publication/source/epoch 後才使用對應 resume。
5. 每次失敗保存當次收據；已 committed/lost-ACK 的操作用原 operation 對帳，不重做業務寫入。

## 回退必須保留切換期間的新資料

- **退回舊程式版本，不等於回退資料來源。** 哪一個來源有權保存取決於當下 source authority，不由畫面或舊收據推定。
- **把舊備份覆回去，不是無損回退。** 若切換後已產生新保存，回退要在新的 pause/watermark 下，把當時最新資料轉回目標，再 publish/resume；不能用 T0 覆蓋 T1。
- 來源、身份、完整圖或正式 Itinerary 任一不符時，保留 pause/草稿/收據與已提交資料，先查明再決定。不能以刷新、清除瀏覽器資料、重建 Owner、降低 guards 或另發新 request 掩蓋不一致。
- 保留 rollback-capable 程式與必要既有 RPC，直到新版本及正式讀回接受；是否移除旧路徑另外決定，不在本機試用收尾順手清理。

## SQL 交付方式固定

完整正式 migration 與唯讀 readback 分開。Hermes Preview 顯示經 immutable commit blob 核對的完整 readonly textarea；本人手動 Ctrl+A／Ctrl+C、貼到 SQL Editor、Run。助手不代貼、不操作剪貼簿 API、不代執行正式 SQL。`Success. No rows returned` 只算執行回覆，下一步仍是獨立唯讀讀回。

**剩餘不是已證實的產品缺碼，而是真雲端目標／證據、正式包編排及使用者控制的操作。正式包目前尚未生成為可執行交付物，不用這份順序文件冒充完成。**
