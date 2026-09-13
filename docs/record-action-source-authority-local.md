# 原 App 操作前補讀：資料來源綁定（本機限定）

## 已重現的邊界

在原 `src/main.tsx → App`、有效 Owner、raw `records-v1/scoped-v1` 設定未改、已發布並恢復可寫的 legacy 來源下，報告中心「手動保存今日早會」會先取得 full coverage。

修正前此補讀直接呼叫 raw record RPC，實際 native PostgreSQL 回覆 HTTP 200／revision 1；已確認的 legacy durable floor 100 正確拒絕舊快照。因此早會沒有送出保存，也沒有資料被覆蓋。這不是早會共用保存佇列的路由問題：相同條件下 snapshot 模式已能經 legacy block RPC 保存並讀回。

## 最小修正

- 原 App 已有的 `fetchCloudData` 來源綁定 wrapper 增加可選 scope；未傳入時仍使用目前 coverage。
- `loadRecordActionScope` 使用此 wrapper，傳入本次要求的 scope，而不是直接呼叫 raw RPC。
- 排空既有保存佇列後才捕捉本次來源與本機資料；讀回後再次確認來源參照仍一致，才更新 coverage、confirmed snapshot、durable floor 與畫面資料。
- 原有 Owner／權限、actor／session／config／action generation、dirty queue、單筆 lease、批量編輯、資料版本及本機新稿檢查不變。

這個共用 helper 也服務其他使用者動作前的 coverage 擴展，故回歸包含 unmanaged record 的定向 scope、既有 early return、forceFresh、來源未解析與來源切換，不能只驗早會正常保存。

## 驗證分層

`npm run test:record-action-authority` 執行當前 App 的 scope loader、來源 wrapper、實際 bound-reader 與 durable-floor 函式；I/O、refs、保存佇列與 publication sinks 由測試控制。此層不代表 React 掛載、SQL、正式雲端或全角色驗收。

原 UI/native PostgreSQL 驗證沿用已固定的報告入口 QA：

- `MRN-CONTROL`：snapshot 模式原按鈕保存及新連線資料讀回。
- `MRN-SCOPED`：同原按鈕，full prerequisite 必須使用當前 legacy 來源，再完成同一原保存流程。

來源／測試 producer、原始 RED、命令收據、畫面及 cleanup 另存本機 QA artifact，不放入發布檔。成功提示不能代替實際 committed 回覆與資料讀回；本片也不以報告 hash 代替逐欄內容 oracle。

## 未改與未宣稱

沒有 JSX、版面、導航、登入、角色、早會內容、上傳格式、業務圖、SQL 或部署改動。未改保存 queue，未增加自動保存／刷新／清除草稿。Itinerary 報告刪除及歷史 unknown v2/v3 pending 的來源問題另案處理；不借此自動重新指定舊操作路由。本片不是完整切換／回退、hosted ACL／Realtime、手機／PDF 或全工程可發布的證明。
