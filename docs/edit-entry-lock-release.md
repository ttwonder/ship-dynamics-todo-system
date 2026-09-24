# v0.3 編輯期排他補修／本機驗收

## 使用者可見結果

- 開啟單筆來源、內控或 Task 編輯前，先取得該單筆及有效關聯項目的完整編輯鎖；第二人不能進場，提示持有人。第一人仍可正常保存。
- 批量先凍結明確選取 IDs，完整取得選取項目及有效關聯鎖才開放輸入；任一衝突即撤回本次取得的鎖。未選項目、無關項目仍可並行，不升級為整船長期編輯鎖。
- 編輯期間續期整組鎖。失鎖保留原表單與輸入、凍結修改／新提交；來源的「同步到內控」表單也適用。重新取得完整鎖並核對最新資料後才可繼續。
- 保存等待期间輸入的新內容，不因上一筆 ACK 而被清掉或提前釋鎖；正常已確認保存與明確取消仍沿原流程關閉／釋放。
- unknown ACK 保留原 operation ID、payload、signature；原鎖過期且 receipt missing 時仍不得換鎖重組為新提交。此情境的 PASS 是保稿／零誤寫／精確重試邊界，不是承諾所有未知結果都能自動恢復。
- 修補已安裝 lease RPC 在同鍵、Task 父子鎖衝突時的持有人姓名回傳，以及分船編輯拒絕提示；不改角色／ACL、不變更 Task leaf 並行規則。

## 驗證範圍與真實結果

全部為 **真實 UI＋測試資料、本機原生 PostgreSQL** 或明確標示的 component／source contract，非 hosted Supabase 驗收。

| 指令／層級 | 最新結果 |
|---|---|
| `npm run test:tracking:edit-entry` | E01–E10，10 項 PASS；兩登入者、獨立 browser context、原 UI、SQL readback |
| `npm run test:tracking:multiuser` | 完整串聯 exit 0：M01–M10 共 10 項、D1/D2/U1/D3/D4/U2 共 6 項、船端提報共 4 項 |
| `npm run test:tracking:browser` | 17 項原 App/native SQL＋7 項 component，分層記錄、不可合稱 24 項 E2E |
| `npm run test:edit-lock-holder:native` | H01–H05 共 5 項 PASS，含同鍵／父子／無關 leaf／過期重取及唯讀 readback、業務未改 |
| `node scripts/verify-task-member-lifecycle.mjs` | 12 項 PASS，含持有人拒絕、generation fence、missing receipt exact replay |
| `npm run test:atomic-collaboration` | 宣告的整體協作回歸 exit 0，含 lease、CAS、receipt、queue、actor、rebase、草稿及退出 |
| 跟蹤 domain/table/spreadsheets/native、XLSX 真瀏覽器回歸、batch/internal-control/edit-lock focused gates | 各自 exit 0；不把重複子 gate 加成新的獨立案例 |
| `npx tsc --noEmit`／`npm run build` | exit 0；build 仍有 chunk size 建議警告，沒有為此重整 bundle |
| `git diff --check` | PASS |

編輯入口矩陣詳見 `scripts/edit-entry-browser-checks.mjs`。本機原始紀錄保存於 repo 外 `tracking-edit-lock-20260925` 交接包；沒有在 Git 收入私有 config、正式 payload、憑證或測試瀏覽器資料。

### 回歸測試校正，不是修改保存規則

- 既有測試假定第二人可先進場輸入，再於保存時被拒；這與本次批准的編輯期排他相反。改以入口拒絕、取消保稿釋鎖後由另一人保存、恢復舊稿驗 CAS，保留零部分寫入及明確核對的驗收。
- 持有人訊息透過原生 alert 顯示；驗收讀取實際 dialog 事件，不把已消失的頁面文字當成必要 UI。
- 原 U2 測試要求 `order:auditLogs` 必須衝突後自動重試。已安裝 release05 在 CAS 前使用 `ship_dynamics_record_merge_audit_v1` 合併 append-only audit，實際兩次重疊保存均直接 SQL_OK。最新 U2 明確驗證真實 PG blocking、兩次 ACK、各一筆 audit、完整獨立 readback及無多送；**不再將此案例聲稱為 App 自動重試證據**。重試／receipt 與其他 order 衝突另由相應 gate 覆蓋。

## 正式 SQL 次序（使用者自行操作）

在同一個完整編號 Preview 提供以下五步，每份獨立 query，正常即按順序繼續，最後一次回報：

1. `supabase/migrations/20260924160000_tracking_records.sql`：安裝跟蹤能力。若這份已明確執行，不重跑，直接做第 2 步。
2. `supabase/verification/tracking-records-readback.sql`：`kind=tracking-records-readback-v1`，9 個布林值全部 true。
3. `supabase/migrations/20260925020000_edit_lock_holder.sql`：只補已安裝 lease RPC 的持有人顯示 metadata；不重裝 release05、不寫業務列。
4. `supabase/verification/edit-lock-holder-readback.sql`：`overall=PASS`、`checks=5`、`failed=[]`。
5. `supabase/verification/itinerary_destination_schedule_readback.sql`：補前批已安裝航期能力的獨立確認；`overall=PASS`、`checks=8`、`failed=[]`。只讀，不重跑航期安裝。

所有 SQL 由本次最終 commit raw blob 生成 readonly textarea，對實際 textarea 的 UTF-8 bytes／SHA-256 作 live 檢查；不使用 clipboard API。先核對正式專案 `cyzpcvvhmoiihsqvjspp`，再由使用者 Ctrl+C、貼進新的 SQL Editor query、按 Run。出錯／逾時／未知結果／警告／核驗 FAIL 立即停在該步，不重試、不繼續。

## 交付邊界

此補修由 parent 實作、逐項 diff 核對並執行本機驗收；先前診斷代理不等於本次最終候選的獨立 review PASS。未重新派遣無限 review。

本機 commit、正式 SQL 已執行、正式 readback 通過、使用者 Push、Pages 版本更新及正式 smoke 是不同狀態。此文件不宣稱正式 SQL 已執行或網站已上線。事故頁不刷新、不清理、不反覆保存；已封存草稿不動；08–12 不重跑、舊 source 不解凍。待正式 SQL 獨立核驗後，由使用者 Push 全部 local-ahead commits。
