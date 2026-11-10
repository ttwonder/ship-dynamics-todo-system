# 船隊 PSC 風險清單：本機實作／正式交接

## 已採用的操作規則

- 看板「顯示行事曆」左側加入「船隊風險清單」，不改船卡，也不改原保存、行程或會議功能。
- 開啟彈窗只讀取最近一次成功的共享快照。每天台北 07:00 **開始**伺服器排程，完成後才發布；不能承諾 07:00:00 已更新完成。
- 「強制更新」先顯示需等待、2～4 艘並行的說明。確認前取消不送更新請求；已確認開始的是共享雲端作業，關閉彈窗僅停止等候，不取消所有人的作業。
- 多人同時要求更新時共用有效作業。舊工作不可在被取代後覆寫新結果。讀取失敗、來源失敗或作業逾時保留原快照，明確標示未更新。
- 更新成功一次發布完整清單，不混合新舊船舶風險。PDF 凍結按下匯出時顯示的完整快照；沿既有瀏覽器列印／另存 PDF 方式，不宣稱為無需另存操作的直接下載。
- 已有手動成功更新時，之後開啟讀取最新成功版本，不倒退到當天 07:00 的舊版本。
- 目前只證實 Tokyo MOU 公開單船詳情提供現時風險。Paris MoU／USCG 欄明示「未取得現時等級」，不是低風險，不用歷史 PSC B、RO 表現或 QUALSHIP21 推算。

## 資料識別與可信度

- 公司 IMO 嚴格為 `0882415`，保留前導零；僅接受已從官方回應核實的兩個名稱 `FORMOSA PLASTICS MARINE CORPORATION`／`Formosa Plastics Marine Corp (FPMC)`。保留來源實際名稱，不以任意模糊名稱通過識別。
- 參考 PDF 為日期明確的名冊線索；實際風險每次更新都讀官網。公司查詢配合 FPMC 名冊、分頁總數及每船 IMO checksum／詳情身份核對，包含委外管理。
- 風險讀取單船詳情的目前 profile 頂部，不能使用搜尋清單「Ship Risk Profile at the time of inspection」。Priority 和 inspection window 分欄。
- 官網沒有提供整批更新／生效時間，儲存來源抓取區間和每船取得時間，不把取得時間稱為官方更新時間。
- 名冊缺項、身份不符、未知格式、HTTP／TLS 失敗都不得當低風險或假成功。只處理已確認的普通公開算式入口，不猜密碼、不使用替代授權路線、不關閉 TLS 驗證。

## 本機驗證與邊界

- `npm run test:fleet-risk`：原 Dashboard 入口 SSR、資料完整性與 transport 邊界；受控資料，非雲端驗收。
- `QA_EVIDENCE_ROOT=<repo 外絕對路徑> npm run test:fleet-risk:browser`：原 Dashboard／彈窗及 CSS，合成資料；確認取消零請求、整批替換、失敗保留、手機 390px、焦點恢復與 Chromium 實際 PDF。
- `npm run test:dashboard`、`npm run test:dashboard-calendar-entry`、`npm run typecheck`、`npm run build`：相關既有回歸及建置。
- `QA_EVIDENCE_ROOT=<repo 外絕對路徑> npm run test:fleet-risk:database`：11 項真實 embedded PostgreSQL 驗證通過，含 38 組不完整／非法快照拒絕、唯讀／writer ACL、舊版保留、固定租約與台北 07:00 邊界。cron/net/Vault 僅為明示的本機替身，未執行 hosted cron。
- `QA_EVIDENCE_ROOT=<repo 外絕對路徑> npm run test:fleet-risk:worker`：原 handler＋真 SQL，8 組整合情境通過；含立即回覆、多人 join、關窗不取消、部分結果拒絕、過期 worker、失敗保留、失去成功 ACK 不重複發布及 scheduler token。
- Deno source/parser 28 項及完整 collector 2 項相關驗證通過。包含已核實公司名稱寫法，以及錯誤 IMO／未知名稱／重複公司拒絕；collector 回歸覆蓋公開入口等待、跨會話請求錯開、最多 3 路並行、完整 39 船與單船失敗不發布。

### 真實官網 → Deno → handler → 本機 SQL → 原畫面 → PDF

2026-11-10 本機真查完成，非舊 HTML replay、非正式雲端：

- 本機原 Dashboard 按「開始更新」→ 原背景 handler → 獨立 Deno 行程執行原 collector → 真實 Tokyo MOU → HTTP RPC bridge → 實際 migration 的 PGlite PostgreSQL → 另一個原彈窗。
- 查詢時間（台北）：20:39:49 ～ 20:41:12；Deno 來源階段 82.86 秒，UI 更新至完整發布 83.22 秒。48 個來源請求全數 HTTP 200，實測最大同時請求數 3。
- 39／39 艘、39 個唯一 IMO，包含 4 艘委外；高風險 5、標準風險 30、低風險 4。這是該次取得結果，不承諾日後等級不變。
- 快照 `b921be63-edf2-4365-a898-79ce9bc7f64e`。已確認取消更新零請求、更新中保留舊完整版本、關閉發起視窗不取消、另一視窗接收新版、失敗保留新版、重新開啟讀最新版本。
- 實際 Chromium PDF 5 頁；逐一比對 39 個船名及 IMO、每船 IMO 恰好一次、風險行數／圖例、完成時間與畫面／資料庫版本一致。第一頁、末頁及 390px 手機截圖已目視核對。
- 證據目錄：`C:/Users/tuotu/AppData/Local/hermes/artifacts/fleet-risk-20261110/`。`receipt.json`、`live-snapshot.json`、`pdf-verification.json`、`fleet-risk-complete.pdf`。原始官網資料／PDF 不納入 Git。
- 真查採 Deno 子行程只是本機測試接線；正式 `index.ts` 在 Edge 內直接呼叫相同 collector，不需要 Python、Node 子行程或本機常開。
- 本機 HTTP bridge／PGlite 並非真正 Supabase gateway、EdgeRuntime host 或多 backend contention 證據；正式部署／執行仍需下節驗收。

### 重跑方式（預設完全不連官網／正式雲端）

```bash
QA_EVIDENCE_ROOT='<repo 外絕對路徑>' \
FLEET_RISK_FIXTURE_ROOT='<既有官方 HTML fixtures 絕對目錄>' \
npm run test:fleet-risk:native
```

fixtures 是有日期的已保存 HTML，只供離線回歸；不隨產品部署。此次私人 fixtures 保存在 `C:/Users/tuotu/AppData/Local/hermes/artifacts/fleet-risk-20261110/private-source-fixtures/`，未加入 Git，也不是新查詢結果。真查必須額外指定 `-- --live`，同一輪最多一次全船查詢。Windows 原生 Node 若無法辨認 shell 的 `deno` shim，將 `deno eval 'console.log(Deno.execPath())'` 輸出設為 `QA_DENO`（完整 exe 路徑）。Chrome 使用獨立測試 profile，不關閉使用者瀏覽器。

來源回歸：

```bash
deno test --allow-read='<fixtures 絕對目錄>' scripts/verify-fleet-risk-collector.test.ts scripts/verify-fleet-risk-backend.test.ts -- 'file:///<fixtures 絕對目錄>/'
deno check supabase/functions/fleet-risk/index.ts
deno lint supabase/functions/fleet-risk/
```

### 官網相容性修正

實測原 300ms 間隔使公司／名冊查詢收到空本文 HTTP 500；增加間隔後能成功。同一 session 三筆同送也重現 2 筆 500，獨立 session 同時啟動仍會偶發 500。最終採最多 3 個獨立 session、每路 1300ms 等待，加上所有請求起點統一錯開 1300ms，仍允許網路讀取重疊。本輪完整真查 48／48 請求成功，並未靠重試、替換舊結果、弱化 TLS 或跳過來源核對通過；這不等於官網保證永久可用。

### 2026-11-11：部署核對與公司名稱相容性修正

- 已部署的原版 Edge 下載內容與原單檔交接逐位元相同；必要 Edge 密鑰保存後，GET 從缺設定的 503 轉為 405 方法閘門。這只證明程式與必要設定可達，不代表來源更新成功。
- 授權的首次 hosted 更新 `c1c07f92-4b3c-4738-8037-f12106dd1134` 接受啟動後，16.438 秒讀回失敗，進度 0／0、`Public PSC source is unavailable`，未產生成功快照。未盲重試或先開排程。
- 有界本機入口／公司查詢取得 HTTP 200，實際公司名稱為 `Formosa Plastics Marine Corp (FPMC)`、IMO 仍為 `0882415`；原程式拒絕此名稱。先重現實際 handler 回 502 的回歸，再僅擴充這個已核實的精確名稱；原 IMO、唯一公司結果、完整船隊及詳情身份檢查不變。
- 修正後本機原 collector 真查取得 39／39 個唯一 IMO，與參考名冊集合完全相同，包含 4 艘委外；本次 HRS 5／SRS 30／LRS 4，48 個來源請求、最多 3 路、85.4 秒，台北完成時間 `2026-11-11 00:50:19.561`。新證據在私人 artifacts 的 `alias-repair-live/` 與 `alias-repair-validation/`，未上傳正式快照。
- source/parser 28 項、collector 2 項、Deno check、異動來源 lint 通過。首次離線組合執行另遇兩份私人 fixture 缺檔及一次 collector `SOURCE_TIMEOUT`；補齊原始檔逐位元複本後 source/parser 全過，collector 獨立執行全過。該次 timeout 的環境原因未證實；未因此延長 deadline 或修改請求節奏。
- **尚未證實公司名稱就是那次 hosted 失敗的唯一原因。** 修正版尚需使用者確認後替換既有 Edge、下載核對並執行一次新的正式更新；不重做已完成的密鑰或安裝 SQL，不把本機真查當成 hosted 恢復。

### 部署檔案與 runtime 邊界

- Entry：`supabase/functions/fleet-risk/index.ts`；共享 handler：`handler.ts`；`EdgeRuntime.waitUntil` 維持背景工作，發起 HTTP 不等候全船查詢。
- `supabase/config.toml` 明確 `functions.fleet-risk.verify_jwt = true`。瀏覽器及 cron 使用既有 anon JWT；service-role key 只在 Edge 自動提供的環境中使用。
- 另需私下設定 `FLEET_RISK_SCHEDULER_TOKEN`，並與 Vault scheduler token 相同。可選 `FLEET_RISK_ALLOWED_ORIGINS`，預設只有 `https://ttwonder.github.io`。
- collector 120 秒、worker 125 秒截止，SQL 固定租約 4 分鐘。任何超時保留舊清單，無自動換成部分結果。
- Supabase 官方限制列 Free worker wall clock 150 秒、Paid 400 秒、CPU 2 秒（不含 async I/O）：`https://supabase.com/docs/guides/functions/limits`。本機 83.22 秒不是 hosted wall-clock／CPU 驗收；部署後必須確認實際 log 與完整讀回。
- migration、cron installer、唯讀 readback 的完整次序／Vault 名稱見 `docs/fleet-risk-database-handoff.md`。未對既有業務表、行程排程或早會排程作修改。

## 正式發布前仍需使用者決定／操作

1. Tokyo MOU 對商業使用／在其他網站及出版物重製有事先許可條款。技術可讀不代表已取得再利用許可；須由公司確認網站展示與 PDF 使用許可。未取得許可不能宣稱已合法核准。
2. SQL 安裝、排程安裝、唯讀核驗分開；保持使用者手動 SQL 及 Push 流程。
3. Edge Function 和排程部署、必要的 Vault／環境設定另行確認；Secrets 不貼聊天、不放前端、不寫入 Git。
4. 部署後須核對真正作業完成、完整快照讀回、手動更新及下一次台北 07:00 cron 執行紀錄。本機時間換算或 cron 設定檢查不等於真排程已跑過。

目前已完成原版 Edge 部署、必要 Edge 密鑰及下載程式比對；安裝 SQL 已有 RPC／ACL 讀回證據。首次 hosted 更新失敗，公司名稱相容性修正版僅完成本機驗證。修正版部署與正式成功快照、Vault／cron、使用者 Push 仍待完成，不以本機 PASS 冒充正式上線。
