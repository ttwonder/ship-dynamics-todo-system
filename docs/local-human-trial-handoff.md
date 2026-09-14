# 本機隔離試用交付（原 App）

## 交付狀態

產品候選固定於 `6c57b5c42590a2c726e3386ddada5c133fa07035`，tree `4052d8893830059cd1506fae94f76e40eb852cd7`。本頁交付的是**可供本人操作的本機試用站，不是正式發布批准**。

- 原 `src/main.tsx → App` 與 `ship-itinerary.html`，使用實際 Vite production build，不是另做一套示意畫面。
- 本次沒有修改產品 TS/TSX、CSS、角色政策、Excel 模板或 SQL；試用伺服器、啟停工具、資料與測試收據均留在 repo 外。
- 原畫面僅由試用伺服器附加右下角「真實 UI＋測試資料」標識。試用說明是獨立入口頁，不放進產品導航。
- 本機 native PostgreSQL、原 SupabaseJS 呼叫經 loopback HTTP 轉接到實際 SQL；使用獨立合成資料。不是正式 Supabase、PostgREST 或 Realtime 服務。

## 試用入口與資料

本機入口：`http://127.0.0.1:14695/trial/`。只在這台電腦可用；不開防火牆、不開 LAN/公網、不使用正式設定。電腦及本機服務須持續運行。

入口頁提供岸端、免登入船端、初始測試帳號與手動複製密碼欄。不將密碼放在聊天或 Git；不要輸入正式憑證或敏感資料。

合成資料包含四種原角色、三艘船、一般要事、雙向內控關聯、專題會議及每船正式 Itinerary／備選。岸端船卡名稱與船端既有 fixture 顯示名稱不同，但同一 `qa-v1`～`qa-v3` 身份相連；不把測試命名差異當產品資料錯亂。登入時岸端選「督導」，船舶帳號選「船舶帳戶」。

兩人測試可用一般視窗＋無痕視窗，避免共用 localStorage 登入身份。保持原同步、確認、保存與取消操作，不注入 React state。

## 本輪實際驗證

父層 `acceptance.json` 將八個 stable outcomes 去重核對，沒有把重跑累加：

1. Owner 原流程登入。
2. 管理員原流程登入。
3. 操作員原流程登入。
4. Vessel 帳號經原「船舶帳戶」部門登入。
5. Owner／管理員同時保存不同船，實際 SQL ACK／另一身份與新 browser context 讀回；未選第三船及要事／內控／會議集合未變。
6. 免登入船端入口成功讀取實際三船 IDs；不是僅截到 HTML shell。
7. 17 個靜態產物逐一 HTTP／SHA-256核對；runtime config 另核 exact loopback workspace；served app-version 對上候選，實際 UI 呼叫沒有外部網站請求或未捕捉 JS 例外。
8. 正常停止、重新啟動同一 PostgreSQL 後，61 張 public tables、98 列含 xmin／ctid 全相等；來源 epoch 2、records-v1 維持有效。

650 個原 Windows checkout 檔案及試用來源副本逐一核對；`tsc --noEmit`、實際 production build exit 0。新增文件不影響本次已驗產品 bytes。不同角色登入不等於完整角色操作權限矩陣通過；本機並發結果不作雲端 QPS 宣稱。

實際失敗與修正記錄均保留：瀏覽器工具420秒啟動逾時、登入部門／資料欄位／取消按鈕／顯示名的測試假設、動態 config 與靜態 asset 的核對邊界，以及 app-version 欄位名稱。這些沒有轉成產品修改，也沒有將原失敗收據改成 PASS；最終以已通過的精確分項與補完收據閉合。

## 給本人試用的有限清單

- 分別修改不同船舶，保存後由另一視窗同步、核對。
- 新增／更新／結案一般要事，重開後確認。
- 內控與要事、專題會議的關聯新增／進度／結案，在另一入口核對。
- 岸端查看 Itinerary，船端保存正式與備選；確認正式投影不混入備選。
- Excel 匯入先預覽並試取消；選擇性匯出 Excel／PDF。只對實際需要的流程操作，不要求本人代跑整個工程測試。

遇到保存失敗，保留當時畫面與草稿，記錄角色、入口、操作與提示；不要先清 storage、換 operation ID 或盲重送。

## 保留與啟停

私有根目錄：`C:/Users/tuotu/AppData/Local/hermes/cache/ship-human-trial-6c57b5c/`。

- `control.py status`：唯讀狀態。
- `control.py start`：已有正確服務時不重開；否則啟動同一資料庫，不重建 fixture。
- `control.py stop`：以本機擁有者 stop file 正常停止並保留資料；不廣泛 kill、不刪資料。
- `start-trial.cmd`／`stop-trial.cmd` 是這台電腦的便利入口，不是可跨電腦攜帶的部署包。
- 突然斷電／強制結束若留下 postmaster.pid，啟動會 fail closed；需先核對實際程序，不直接刪 PID 檔或重新初始化。正常停止／重啟已驗，意外斷電恢復沒有冒充通過。

本機試用服務是刻意保留運行的交付物，不按一次性 QA 服務刪除。其他原生 QA browser／臨時資料庫有各自停止收據。

## 尚未完成／未執行

- 本人實際試用尚未開始；此站不能代替本人驗收。
- 真 Supabase Auth／ACL／PostgREST／Realtime／scheduler 與正式效能未由此站证明。未知 RPC 明確拒絕，不偽造成功。
- 會議 PDF 原有7.5pt標籤保持原样，嚴格全字形8pt FAIL 原紀錄保留。
- 沒有本次 Push、merge、fetch、部署、正式 SQL、正式資料讀寫或 cron。
- 本人試用之後仍需[正式發布決策與停止點](pre-push-release-checkpoints.md)。開發 SQL 不是已交付的正式可執行 migration。

## 收據索引

上述私有根目錄的 `source-identity.json`、`build-receipt.json`、`build-assets.json`、`acceptance.json`、`restart-before-receipt.json`、`restart-after-receipt.json`、`ready.json`／`launcher-receipt.json`。

原 UI 分項收據：`smoke-2026-09-14T12-13-51-868Z/receipt.json` 與 `smoke-completion-2026-09-14T12-16-58-821Z/receipt.json`；其中整體 harness failure 保留，已通過的分項由父核對加上獨立靜態檔案／restart gates 形成 trial acceptance。完整資料 ledger／憑證均為 private，不提交 Git。
