# bunker 船舶狀態追加

## 範圍

- 目前船舶狀態多選清單末尾追加小寫 `bunker`；原六項、原次序與 `drydock/repiar` 儲存值不變。
- 船端保存、船卡投影及船端／岸端瀏覽摘要均保留此值；清除、多選、船端修改權限不變。
- 不改動既有資料、不回填、不改租約／CAS／保存／歷史流程，不重跑 normalized cutover。

## 正式交接（必須先試用；助手不代 Push／執行正式 SQL）

1. 使用者先確認同一正式專案與 SQL 目標，再執行新的小型追加：
   `supabase/migrations/20260917090000_itinerary_bunker_status.sql`。
   預期一列 `installation=bunker-option-ready`、`bunker_ready=true`。
   如 predecessor-missing／mismatch，停止，不重跑舊安裝或即席修改資料。
2. 新空白查詢執行 `supabase/verification/itinerary_current_state_readback.sql`。
   本版 readback id 為 `current-state-readback-v3-bunker`，包含 bunker 與原四欄 guard；預期 24 項、0 失敗。
   保留 Windows 換行對稱正規化與錯誤指紋／guard 的負向檢查。
   v2 核對針對增加 bunker 前的函式，升級後應改用本版，不混用舊預覽。
3. 正式讀回通過後，再由使用者 Push、確認 Pages 版本，重新開啟新版船端網頁使用 bunker。
   SQL 未更新時新選項會被後端拒絕，不能僅推網頁；舊網頁也沒有新選項。

SQL 只更新已知驗證函式的允許值。以不可變原 migration 推導前後 body 指紋，保留 OID／ACL，可重複執行；遇未知定義會停下而不覆寫。
