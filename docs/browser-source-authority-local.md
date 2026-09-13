# 原 App 保存入口狀態：本機首片

本片不是部署操作，也不是完整切換／回退驗收。原 `main.tsx → App`、畫面、角色與業務合併規則保留。

## 實作邊界

- 新增 `read_ship_dynamics_browser_authority_v1`：沿既有網站存取模型，僅回傳指定工作區的 managed/source/epoch/pause/admitted 狀態。不回傳業務、名冊、憑證或維護請求，不賦予維護／寫入權限。
- 明確 unmanaged 與讀取失敗分開；RPC 缺失、格式錯誤、未知狀態不能降級為 unmanaged。
- 原手動管理保存可從已確認來源採用內容相同、已發布並恢復寫入的 staged target。設定身份不改；來源、讀取範圍、版本下限及歷史收據分開綁定。
- 已送出操作始終沿原來源及原參數查收據；不把尚未確認的操作換路重送，也不自動保存較新的草稿。
- 新目標遇到區塊衝突時，重讀同一命令已綁定的目標，不重新使用舊頁面來源。原授權／關聯衝突規則仍然可以拒絕自動合併。

## 可重跑的原畫面／原生資料庫檢查

前置：已安裝專案依賴及本機 PostgreSQL；設定 `SHIP_QA_PG_BIN`、`SHIP_QA_PG_MODULE`，另指定 repository 外的絕對 `QA_EVIDENCE_ROOT`。資料全為隔離測試資料，不連正式 Supabase。

```text
QA_BROWSER_AUTHORITY_MODE=direct
QA_BROWSER_AUTHORITY_MODE=lost-ack
QA_BROWSER_AUTHORITY_MODE=target-conflict
QA_BROWSER_AUTHORITY_MODE=target-auth-conflict
QA_BROWSER_AUTHORITY_MODE=lost-B-ack
```

每一模式分別執行 `node scripts/verify-browser-authority-original.mjs`，使用不同 evidence root。

共用流程：A 真正提交／回覆暫留 → 同一欄位較新 B → pause → 以最新 records staging → publish（仍 pause）→ 原頁面處理 A → 恢復 legacy 寫入 → 原按鈕保存 B。

| 模式 | 要求 |
| --- | --- |
| direct | 人員姓名 B 真正保存；完整業務圖與獨立資料表讀回，另驗預期值檢查能捕捉錯誤修改 |
| lost-ack | 發布仍暫停時丟失 A 回覆；原瀏覽器沿 A 完整原參數查到歷史收據；不重送或清 B |
| target-conflict | 船舶完整船名 B 與另一船的原生受保護更新相撞；原頁面重讀目標並安全合併；完整保留雙方結果 |
| target-auth-conflict | 人員名冊 B 與船舶業務更新相撞；沿原規則拒絕；保留 B、對方完整資料且不誤報成功 |
| lost-B-ack | B 真提交但回覆丟失；原瀏覽器查回 B 精確收據，不重複寫入 |

對方更新是另一原生 PostgreSQL 連線的受保護命令，明確標為 controlled native peer，不冒充第二個瀏覽器。完整 B 預期圖在允許 B SQL 前建立；伺服器時間格式依既有 SQL 的 UTC 毫秒表示核對。測試的初次失敗、夾具錯誤與有效回歸失敗分開保留。

## 仍在後续整合範圍內

- 重新開啟頁面／跨 reload 的來源接續、草稿及未知操作恢復。
- 首次採用之前目標已有新資料的連續性證據；本片不猜測或覆蓋。
- 獨立 Itinerary、報告、逐船要事及 linked handover 入口的切換接線。
- 完整正反切換、多人整合、Supabase PostgREST／Realtime／hosted 權限及使用者試用。

原生 PostgreSQL 及本機 HTTP adapter 結果不是 hosted Supabase 驗收。正式 SQL、Push、部署均需另行決定；不得直接照本文件對正式資料庫操作。
