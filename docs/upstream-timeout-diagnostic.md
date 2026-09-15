# Upstream timeout 的唯讀執行狀態核對

`supabase/release/12a_upstream_timeout_diagnostic.sql` 是單一 metadata SELECT，不是重試 pause、恢復保存或資料修補。

## 操作與邊界

- 同一已確認專案、SQL Editor 的新 query，原稿完整執行一次，匯出 `upstream_timeout_diagnostic` 原始 CSV。
- 不掃业务/history，不呼叫 watermark，不改設定、schema、ACL 或業務資料，也不取消/終止其他連線。
- 先核 reader visibility、text_unavailable、截斷旗標，再看 active / idle in transaction / aborted / idle、等待種類及直接 blocker。
- 最多輸出 64 筆同資料庫 session、每筆 8 個直接 blocker；計數涵蓋整個可見集合。它限制輸出/阻塞查询次數，不保證固定執行時間。
- 不輸出 query 原文、application name、角色名稱、client IP 或任意設定。query_class 只是 DB 內文字分類，不是業務身份或精確執行位置。
- 無候選不等於交易已回滾/提交，亦不能單獨授權重跑；顶層 query 可被截短、包裝或已離開。pg_stat_activity 與 blocker 採樣不是跨時間原子 trace。
- 舊 12 的 `pause=null` 不排除前次 pause 尚在 watermark 之中。12a 的 reader timeout 也不是前次 backend 的 timeout，更不是網關期限。

## 已取得的本機證據

Exact SQL SHA-256：`c808be21d24bdfeab897ab8fcd4596aac3c8686752db134b3047e1bd741f3354`。

隔離 PostgreSQL 17.11、多連線 metadata fixture：12 cases PASS，11 次 diagnostic execution。包含 active、完成後 idle、真實 advisory lock wait、未提交/aborted transaction、連線結束、低權限/pg_read_all_stats、輸出截斷、query-text 截短及無業務 schema。所有執行在 READ ONLY 內，無新 xid/reader advisory lock，reader 設定不變；owned cluster/port/data 已清理。

上限 probe 只將同一 SQL 的 64 改成 2 以少量連線驗證計數，不冒稱建立了 65 個 backend。業務 pause 沒有在這個 fixture 內執行，不能把這份 PASS 當成 hosted 根因、資源容量或 pause 成功證明。私有 native receipt / runner 保留在本機 release evidence cache；未上傳任何正式資料。
