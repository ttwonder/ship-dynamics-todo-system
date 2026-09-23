# 內控：期望完成日期/DL 與結案日期

## 本次行為

- 岸端批量新增、船端新增統一使用「期望完成日期/DL」；填 DL 不會自動結案。
- 內控更新窗可編輯 DL；未完成清單顯示 DL。
- 內控與其關聯要事共用 DL，修改任一邊均經原關聯保存流程同步；清空日期也會同步。
- 單筆內控及內控清單批量結案：先開啟必填日期窗、選實際結案日期、確認後才保存。取消不寫入；結案日期不得早於報告日期。
- 已結案內控可「改為未結案」；保留 DL、事項與歷程，清除實際結案資料，關聯要事同步。
- 舊已保存結案日期不改成 DL，不批量回填舊資料。其他頁面的既有批量完成流程不在本次日期選擇範圍。

## 保存與相容邊界

原有角色、關聯鎖、CAS、狀態歷程、草稿與 exact ACK 路徑保留。船端仍只新增未結案內控，不建立要事、不修改已提交案件。

新船端本機 pending 為 v3；v1/v2 以原 codec／operation ID／items 讀回及重試，不補日期或改簽名。凍結的 v2 測試 codec 取自已保存的舊來源，僅用於相容性驗證。新的 SQL 欄位為 optional，不改 RPC 簽名、權限或既有 records/history。

## 已執行本機驗證（非正式環境）

- `npm run test:internal-control-dates`：日期獨立、舊資料、共用 DL、reopen、SSR 各畫面。
- `npm run test:work-center-direct-edit-browser`：10 組原 App UI＋native PostgreSQL；涵蓋 DL 雙向保存、取消零寫入、held ACK、重新開啟、批量日期、未選案件不變與重新載入。
- `npm run verify:ship-internal-control-browser`：13 組船端／岸端原 UI＋native PostgreSQL；DL 提交、保留草稿、遺失 ACK、斷線、舊 pending、權限及岸端同步。
- `npm run verify:ship-internal-control-dates-sql`：6 組原 SQL 升級／舊 receipt、DL 保存、非法日期、篡改綁定、replay、唯讀部署指紋；新 readback 共 14 項 PASS。
- `npm run verify:ship-internal-control-sql`：13 組既有船端 SQL 回歸。
- 保存防重入、內控 runtime/version/analytics、批量操作、關聯要事 projection、船端 codec、我的待辦、角色、rebase、draft continuity、列表呈現均通過相應既有腳本。
- typecheck、production build、差異空白檢查通過。桌面／390px 截圖已檢查；日期窗的手機右側截斷已用幾何 RED→GREEN 修正。build 僅有既有大 chunk 提示。
- 測試 Chrome 與私人 PostgreSQL 均由 runner 關閉；未建立額外供人工試用的網站，未接觸正式資料。

## 上線順序（尚未執行）

1. 使用者手動執行 `supabase/migrations/20260923120000_ship_internal_control_due_date.sql`。這是既有船端 endpoint 的增量更新，不重跑 08～12、也不重跑原船端安裝 SQL。
2. 另行執行唯讀 `supabase/verification/ship_internal_control_due_date_readback.sql`，確認 14 項 PASS。它僅檢查函式與權限，不代表前端已部署。
3. 再由使用者 Push 前端、確認 Pages 部署與正式畫面。

本機驗證不等於正式 Supabase／Pages 已更新。本次未 Push、未執行正式 SQL，未宣稱前次正式 `57014`／保存事故已全部歸因或根治。
