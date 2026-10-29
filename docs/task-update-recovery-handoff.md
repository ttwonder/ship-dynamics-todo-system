# 既有要事更新失敗恢復：本機修正與正式交接

## 已證實的問題與邊界

- 基準前端：`943d785f1ceebddddc548ddeb87d672f133e021a`。
- 真實原 UI＋測試資料＋本機 PostgreSQL 基線：正常既有要事更新及 COMMIT 後 ACK 遺失均 PASS；注入 writer/receipt SQLSTATE `57014`，恢復 SQL 後讓原 task lease 過期，原「同步最新（安全合併）」在發出 receipt 查詢前拋 stale-generation，形成保存／恢復死路（2 PASS、1 行為 RED）。
- 這是**已證實的次生恢復缺陷**。受控 SQLSTATE 注入不是正式 Supabase 初次 statement timeout 的重現，不能宣稱已找到所有正式逾時的唯一根因。

## 正式唯讀結果（使用者提供 CSV）

使用者提供 `Supabase Snippet Untitled query.csv` 與 `Supabase Snippet Untitled query (1).csv`，結果分別為：

| 核對項目 | 結果 | 意義 |
|---|---|---|
| 要事 tracking validator | `NOT_INSTALLED` | 函式本文 MD5 `33cb06e2cd442c1ff80d5e0f75376287`，為 guarded forward migration 接受的合法前身；STABLE/invoker/search_path 仍符合預期 |
| scoped record reader | `PASS` | exact inline reader、執行模式及 anon/authenticated 讀取權限符合 verifier；不重跑 reader 安裝 |

此 CSV 是 hosted catalog 的使用者回傳證據，不是助手直接讀取正式 DB，也不證明原保存已提交。只缺既有 `supabase/migrations/20261013110000_task_unrelated_tracking_fast_path.sql`；本輪前端修改不另新增 migration。

## 最小前端修正

1. 保存開始時捕獲原 operation ID、完整 operations、guards、actor/authority、讀取 scope 與 visible snapshot，不建立替代提交。
2. 失鎖只撤銷寫入權，保留原表單及原提交。原「同步最新（安全合併）」先按原 envelope 查 receipt。
3. 已 COMMIT：只確認 receipt 及權威讀回，不再呼叫 writer。
4. receipt missing：必須重新取得全部原 guard 對應的 locks，再以同一 operation/envelope 重試；保留 SQL actor/lease/CAS 驗證，不能覆蓋他人版本。
5. 確認成功後原表單維持唯讀供核對，明確 Close 後再重開可繼續保存，避免就地更新 CAS 基線而誤認表單後續私有文字已保存。
6. 已證明拒絕的原提交可經使用者確認放棄，再載入最新權威內容；unknown outcome 不盲目捨棄或重送。

原 UI 排列、業務規則、角色、SQL 權限及 timeout 設定不變。

## 本機證據

`npm run test:task-save-recovery:browser`：真實 App entry＋兩個隔離 Chromium context＋本機原生 PostgreSQL，5 個情境 PASS：

1. 既有普通要事正常更新及精確 DB readback。
2. 真實 COMMIT 後 ACK 遺失，以原 receipt 恢復，writer 不重送。
3. writer/receipt 受控 `57014`、交易回滾、精確 lease 過期後，原 UI 同步只保存原提交一次。
4. 已 COMMIT 但 receipt 暫不可用，lease 過期後僅查 receipt，沒有第二次 writer。
5. 另一視窗持有鎖時零 writer；對方先保存後原 CAS 拒絕且無誤報成功；明確關閉／重新開啟可合法續存。

後三種情境均包含原視窗保稿、Close→reopen→後續成功保存。測試無外部連線，原生 PG／Chrome 已停止、port 已關閉；不是正式 Supabase 已修復證據。

本機 evidence（不含於 Git；可能隨 scratch 清理）：
- RED：`C:/Users/tuotu/AppData/Local/hermes/cache/scratch/ship-task-update-recovery-qa/ui-C9NThv/receipt.json`
- GREEN：`C:/Users/tuotu/AppData/Local/hermes/cache/scratch/ship-task-update-recovery-green/ui-9h5NI3/receipt.json`
- 既有 SQL migration 本輪 native 重驗：`C:/Users/tuotu/AppData/Local/hermes/cache/scratch/ship-task-update-validator-native/task-tracking-native-CyVkc5/receipt.json`，13 個情境 PASS，安裝後本文 MD5 `a4e8072efb82e2c64d87f8d664eb9f58`。

## 收尾驗證

- 有限獨立唯讀審查：本次限定範圍內未發現可證實阻擋；10 個 source-composed 控制案例通過（不是 browser/native SQL 證據）。審查前後及父代理讀回的 `src/App.tsx` raw SHA256 均為 `d4860cf86286e53bc9195efff41548dc7b9f9b7cc69227eeb6976295ac3568fa`。
- 原 UI native GREEN receipt 的全部 input hashes 與目前來源一致，沒有用過期產品 bytes 的 PASS 交付。
- `test:atomic-collaboration`、`test:internal-control-save-close`、`test:task-readonly-projection`、`test:task-save-recovery`、`test:task-save-repair`、typecheck／build 均通過。
- source-composed 舊測試需要補上新捕獲的 `originalAuthority` neutral ref，以及 receipt 模組既有 `cloudSyncError` import；僅修 fixture bindings，未降低任何原行為 assertion。相關失敗與修正後輸出保留在 session。
- 新增回歸已註冊於 `package.json`。無正式服務寫入，無 Push／部署。

## 正式 rollout checkpoints（尚未執行）

1. 有限 review、受影響 aggregate、typecheck/build 與 byte-bound evidence 完成後，由助手建立本機 commit；使用者自行 Push。
2. **另取得使用者對正式 SQL 的決定**。只交接缺少的 task validator guarded forward SQL，不重跑 reader 或其他舊安裝包。
3. 確認 `ship-dynamics-todo-system` / project ref `cyzpcvvhmoiihsqvjspp` / production main / Primary Database。Hermes Preview 展示 commit-blob 完整唯讀 textarea，使用者自行 Ctrl+C、貼新 query、Run 一次；助手不代貼、不動剪貼簿、不代 Run。
4. 成功後分開執行 `supabase/verification/task-unrelated-tracking-readback.sql`，要求 `PASS`；unknown outcome / mismatch / SQL error 均停止，不連按 Run。
5. 使用者 Push 後另外核對 live remote、Pages commit 與 fresh-context 正式保存／精確讀回；catalog PASS 不等於前端已部署或保存功能已恢復。
6. 不刷新有草稿的舊頁、不清 storage、不盲目重送舊 pending。若原逾時仍出現，按 failing RPC/stage/log 繼續定位，不提高 timeout、不放寬權限來掩蓋。
