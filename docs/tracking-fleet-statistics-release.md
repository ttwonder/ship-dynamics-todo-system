# 雙端跟蹤：多船彙總與圖形總計

## 本次改動

- 主站及船端的統計範圍可選：全船隊、Bulker／散貨船、Tanker／油輪、名冊中的實際細分船種、單船。僅含啟用且目前可見的船舶；細分船種與物料／工程類型各自獨立。
- 統計下方逐項明細移除，以「完成狀態、類型件數、延遲狀態」三組緊湊圖形取代。摘要、分類表、圖形同一條件；零分母顯示 —，不平均各船百分比。
- 統計 Excel 僅有「統計摘要」「分類統計」兩頁；統計 PDF 包含摘要、分類和圖形，不含逐項內容。原單船業務清單、編輯及其 Excel／PDF 不變。
- 主站以已確認的完整授權範圍快照計算；船端新增獨立唯讀 summary-only RPC，不為跨船統計下載逐項內容。
- 沿用既有 admission。選船是範圍，不是身份驗證。不得擴張 general reader、writer、lease 或匿名寫入權限。
- 讀取失敗、不完整或過期時不顯示零筆／部分統計，匯出暫停；保留查詢條件，允許明確重讀。

## 不變的邊界

不改既有 writer、lease、CAS、歷史、私有草稿、精確保存確認、未知 ACK 回復。無業務資料遷移、不改既有資料列、不重跑正式 08～12、不切換／解凍舊 source。主站統計首位、船端統計末位及原先分頁保存習慣保持。

## 正式交接：一次列出完整順序

前提：在原 Ship Dynamics Supabase 專案操作，原船端跟蹤及欄位修訂接口已安裝。Hermes Preview 以本機 commit blob 核對兩份完整唯讀 SQL；點入 SQL 區，Ctrl+A、Ctrl+C，自行貼到 SQL Editor 並按 Run。助手不代貼、不使用剪貼簿 API、不執行正式 SQL。

1. **第一步：安裝新的唯讀彙總接口。** 新查詢執行 `supabase/migrations/20260927130000_tracking_fleet_statistics.sql`。預期 `Success. No rows returned`。只新增／更新這一個彙總函式及它的明確執行權限，不改舊函式、業務資料或原有寫入權限。
2. **第二步：獨立唯讀核驗。** 另開新查詢執行 `supabase/verification/tracking-fleet-statistics-readback.sql`。預期單列 `PASS / 6 / []`。核對精確函式內容（僅正規化 CRLF）、簽章、安全設定、瀏覽器執行權、原始表格仍不可直接存取、既有依賴存在。
3. **第三步：由使用者 Push。** 僅前兩步成功才從 GitHub Desktop Push 此次本機 commit。等 Pages 完成後再回報；助手接續核對 remote、正式版本及兩個入口。新接口尚未安裝時，船端統計會顯示未啟用提示，不改用逐項或部分資料兜底；原單船業務清單仍沿原路徑。

任何錯誤、逾時、結果不明、專案不符或 readback FAIL：停在該步，保留結果，不重試、不繼續 Push，不用正式資料修補統計核驗。兩份 SQL 及本機 PASS 不代表正式已執行／部署；catalog 核驗也不取代上線後實際 UI/API 驗收。事故頁不刷新、不清資料、不使用「修復此瀏覽器」。

## 已執行的本機驗證（真實 UI＋合成測試資料，非正式環境）

- `test:tracking:statistics`：計算口徑、範圍與空集合、摘要白名單、三圖分項對齊、統計 XLSX／框線。
- `test:tracking:statistics:native -- --crlf-install`：原生 PostgreSQL 首次安裝、重複安裝無額外影響、READ ONLY readback、anon 真角色、SQL／TypeScript 多範圍／條件 parity、無逐項內容、失效／停用／脫離集合與非法查詢。
- `test:tracking:statistics:browser`：主站及船端實際範圍切換、日期／類型／急件、零值、桌面／390px 圖形、真實 XLSX 下載及 Chromium PDF、草稿導航、舊回覆隔離、錯誤不冒充零、列印時範圍變更。
- `test:tracking:browser`（原 App＋SQL 與標明的 component callback 測試）、`test:ship-tracking:browser`：原有保存、內控關聯、關閉／重開、草稿、未知 ACK 及單船匯出。
- `verify-tracking-multiuser-browser.mjs` 一般、`--edit-entry`、`--ship-tracking`：多使用者、船岸競爭、失鎖保留與原有精確回復。
- 相關 domain、commands、同步、表格、匯入匯出及船端 client gates；TypeScript、一般 build、Pages 子路徑 build。

所有可寫驗證只連本機獨立 PostgreSQL。證據放 repo 外；本次非全站重新審計。既有大 chunk 與 classic runtime config script 的 build 警告保留，不為這次統計改架構。
