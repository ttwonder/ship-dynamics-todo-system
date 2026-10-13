# 新增要事保存與報錯修繕交接

## 已完成的本機修補

1. `src/cloudBlockReceipt.ts` 保留原保存錯誤與 receipt 查詢錯誤；未知結果依舊停止重送，不新增 operation、不冒充成功。
2. `src/App.tsx` 的持續提示區分「結果未知」「已確認但尚未讀回」和真正衝突，不再同時指示「勿重複」及「同步後重存」。關閉暫時提示後，頁首仍保留對應指導。未改 UI 排列、角色、保存規則或草稿內容。
3. `20261013110000_task_unrelated_tracking_fast_path.sql` 為原 tracking validator 增加內部短路：無 tracking/case 變更且所有 touched task ID 均不在現有來源→case 關聯中時，才略過無關的逐來源工作。懸空 linkedTaskId、closed/retained 來源及不合法 events 仍走原驗證。保留 OID、ACL、STABLE/invoker、authority、lease/CAS、receipt 和 8 秒 writer 設定；不重寫任何業務資料。

## 驗證與證據層

- 原 UI＋本機 PostgreSQL：9 情境 PASS；fixture 為 1,102 筆跨船跟蹤來源、1,000 筆通知、500 筆 audit。正常新增、跨船、失敗保稿、重讀、原 UI 版型，以及兩個 SQL 錯誤共同出現時的 same-node 草稿／停止重送已驗證。
- PostgreSQL 修補矩陣：13 個情境 PASS；前身與候選對照、缺 lock/CAS、dangling linkedTaskId、malformed/absent events、混合 case 及已保留來源、exact replay、未知前身拒絕、LF/CRLF 重跑和 OID/ACL/資料不變。
- 1,102 個無關來源上的 helper 調用：前身 2,204 次，候選 0 次。計數探針只在 owned fixture，恢復完整 helper 定義後才執行真正 writer；不是全表掃描次數或 hosted latency。
- 未改前身在本機約 0.4 秒正常完成；**沒有重現正式 8 秒 timeout**。原 UI 的 57014 為受控原生 SQLSTATE 注入，不是正式 timeout 重現。
- `test:task-save-repair`、完整 receipt 相容測試、TypeScript／production build PASS。既有大 bundle warning 不屬本次修補範圍。
- runner 初期環境／native-addon／失效 CDP interception 的失敗證據留在 repo 外；修復的是 QA 工具，不把它們算成產品故障或正式恢復。

## 正式狀態：尚未執行 SQL、Push 或部署

正式日誌已證實 `apply_ship_dynamics_record_patch_v1` 出現 statement timeout，唯讀 FULL scope 也有 57014。此候選縮小已證實的無關工作，**並未證明這是每筆原始失敗的唯一根因**。Itinerary 目前的健康讀取也不等於原截圖問題已修好。需要以下正式核對與 fresh-context smoke 後，才可宣稱正式新增恢復。

### 先唯讀核對，勿直接重跑舊安裝 SQL

在正確專案 `ship-dynamics-todo-system`、project ref `cyzpcvvhmoiihsqvjspp`、production main / Primary Database，分開執行：

1. `supabase/verification/task-unrelated-tracking-readback.sql`：
   - `PASS`：此修補已在正式安裝，不重跑。
   - `NOT_INSTALLED`：是已知合法前身；把 Results 回傳，確認後才執行本次新 forward SQL。
   - `MISSING` / `UNKNOWN_PREDECESSOR` / SQL error：停止，保留結果，不嘗試重裝。
2. `supabase/verification/record-reader-inline-readback.sql`：
   - `PASS`：既有 reader 效能修補已安裝，不重跑。
   - `REQUIRES_INSTALL`：已知舊 reader；把 Results 回傳，不自行重跑。
   - `REQUIRES_REVIEW` / error：停止，需確認正式函式與權限。

使用 Hermes Preview 的 commit-blob 完整唯讀 textarea；自行選取、Ctrl+C、貼到獨立的新 SQL query。助手不代貼、不用剪貼簿 API、不代按 Run。

### 有結果後的正式 rollout checkpoints

- 另取得正式寫入決定，才交接所需的新 migration；unknown outcome 時不連按 Run。
- SQL 成功後另執行只讀 readback；只有 PASS 才進下一步。
- 使用者自行從 `E:\Projects\ship-dynamics-save-feedback-push` 的 `main` Push；助手核對 live remote／Pages 版本，不能把本機 commit 當部署。
- 保留原事件草稿，不清 storage、不刷新帶草稿的原頁，不直接重送原未確認操作。可用獨立新分頁核對正常新增／跨船及 exact readback；真實未確認操作另按 ID/actor/time 確認，不以他人的 lock 推論。
- 如 writer／receipt／renew 或 Itinerary 仍錯誤，保留本次新增的分層原因，依實際 RPC 日誌定位；不可用提高 timeout 或放寬權限宣稱修好。
