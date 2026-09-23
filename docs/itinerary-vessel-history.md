# 報告中心：單船歷程

## 使用方式與範圍

- 「每日 Itinerary 記錄」的刷新左側新增「單船歷程」，只切換原區塊；「返回全船記錄」恢復原全船列表，旁邊每日早會歷史不重建。
- 選船後，依保存日期倒序列出快照；同日多份全部保留，每頁最多 **30 個有記錄的日期**，不是只保留最近 30 天。日期定位切至包含該日期的頁面。
- 每筆保留保存時間、手動標示、當時船名、行程列數及版本；不再重複顯示「09:00 自動快照」標題。下方直接顯示當時基本資訊，「檢視行程」仍可開啟完整凍結行程／PDF。自動保存排程不變。
- 選船清單以仍存在的歷史快照為準，顯示每個船舶 ID 最近一次保存的名稱。改名、停用或從現役名冊移除不會讓既有快照失去入口。
- 這是每日 09:00 與手動快照的單船視圖，**不是船端每次保存的完整修改日誌**。不補造缺失／已刪快照、不納入備選方案、不拿今日行程覆蓋歷史。
- 手機沿用原 A4 橫向 PDF 預覽的局部橫向捲動；單船列表不撐破頁面。

## 每日卡片基本資訊

- **第一行**：上一港、目前位置、目前航行狀態、目前船舶狀態、Voy No.、Next Port & Dock Name、ETA、ETB、ETD。
- **第二行**：分開顯示「後續港」與「後續港 ETA」。沒有第二行時兩者均為 `TBA`；第二行只有個別欄位未填時，該欄顯示 `TBA`，不掃第三行補值。
- 行序採該快照的 `sortOrder`，相同值以 `rowId` 排序；永遠使用保存的首／次行，不依現在時間或首行 ETD 跳行。
- 時間沿快照各自 ETA／ETB／ETD 的時區顯示 LT 與 UTC offset；不一律轉成台北時間。保存時間仍為台北時間。
- 舊快照沒有保存的首行欄位顯示 `—`；不查當前船舶／文件補值。多選船舶狀態完整呈現，既有 `drydock/repiar` 只在畫面顯示為 `drydock/repair`。
- 列表只附帶所選船每份快照前兩行的必要欄位，不下載全船快照、不為每張卡額外請求明細。若查詢尚未升級，明確提示摘要尚未部署，仍可檢視行程；不可冒充空資料或 TBA。

## 變更邊界

`sd_itinerary_record_report_vessel_history_v1(text,text,text,integer,date,bigint)` 為既有唯讀查詢，分別提供船舶清單、單船日期分頁、單船單筆明細；摘要更新只擴充列表輸出，函式簽名及原有客戶端相容性不變。

- `STABLE / SECURITY DEFINER`、固定 `search_path`，使用原 `sd_itinerary_record_actor_v1` 權限判斷；沿用原可讀角色，不新增身份或寫入權限。
- 客戶端沿原來源權威讀取與前後比對，不回退舊來源。尚未部署或來源不支援時顯示錯誤，不把錯誤當成「沒有歷史」。
- 按船過濾後才以日期分頁；清單不下載全船行程內容，明細僅回傳精確船舶／快照。
- 沒有新增表、索引或資料回填；不改現存報表保存、刪除、回執、行程文件、備選、歷史、lease、CAS、草稿或未知 ACK 機制。
- 切船、換頁、返回全船及身份／配置變化保留異步結果隔離，避免舊結果覆蓋新畫面。

## 本機驗證

已執行以下有界驗證（非正式 Supabase）：

- `npm run test:itinerary-vessel-history`：原 6 組 SQL／client／核驗檔檢查，加 5 組摘要／升級／核驗檔檢查及真實 React 元件靜態呈現檢查。
- `QA_EVIDENCE_ROOT=<repo 外的證據目錄> npm run test:itinerary-vessel-history-browser`：10 組原始 App 操作；隔離 Chrome、測試資料、本機 PGlite，禁止外部網路。
- 摘要涵蓋亂序保存但按行序呈現、首行 ETD 已過仍不跳行、各事件不同 UTC offset、長港名、多選船況、缺第二行、舊快照缺船況、空行程；確認查單船頁時不逐卡下載明細。
- 35 個日期、同日 3 份快照、稀疏船舶、改名／停用／今日文件變更、空正式行程、日期缺失、錯船／錯 ID、四種原有讀取角色及無權身份。
- 原始進站／登入 → 報告中心 → 切換／原生選船／原生日期輸入 → 分頁／明細；延遲查詢、A→B→A 換頁、延遲明細、返回全船及全船明細晚到均已驗。
- 桌面與 390px 手機截圖、頁面寬度檢查；實際 Chromium PDF 已產出，測試快照為 1 頁 A4 橫向，包含該船凍結港口、不含其他船或今日新值。
- 本機各讀取及重複安裝後，快照／文件／歷史／lease／record payload 讀回相同。
- `npm run test:itinerary-daily-reports`、`npm run test:itinerary-record-reports`、`node scripts/verify-itinerary-record-reports-browser.mjs --lifecycle-only` 均通過。最後一項為掛載真實元件＋受控延遲 transport，不冒充 SQL E2E。
- `npm run typecheck`、`npm run build`、`npm run verify:itinerary-build-output`、`git diff --check` 通過；建置仍有既有大於 500kB 的 chunk 提示，本次不擴展成拆包工程。

驗證界線：沒有宣稱 production／PostgREST／多連線壓力測試通過；沒有另啟獨立 review，不把本機驗證當作正式部署。

## 部署順序（使用者操作 SQL 與 Push）

已安裝基本版的站點不重跑 `20260923160000_itinerary_vessel_history.sql`，也不重跑它的舊函式指紋核驗。新站才需先安裝基本版，再安裝摘要更新。

1. 在正式 Ship Dynamics 專案執行 **本次唯一增量 SQL**：
   `supabase/migrations/20260923170000_itinerary_vessel_history_summary.sql`
2. 安裝回報後，新查詢執行獨立唯讀檢查：
   `supabase/verification/itinerary_vessel_history_summary_readback.sql`
   預期 `result=PASS`、`checks=12`、`failed_checks=[]`。只核對 catalog／函式內容指紋／權限，不輸出業務資料。
3. 通過後由使用者 Push 本機 commit；核對 GitHub remote／Pages `/app-version.json` 後才視為前端部署完成。
4. 正式畫面唯讀驗收：切到單船、選已存在歷史的船、比對卡片基本資訊與完整行程首／次行、返回全船。不要為測試新增或重複保存正式快照。

交接採 Hermes Preview：從本機 commit 的原始 Git blob 產生完整唯讀 textarea，檢查實際 textarea 的 bytes／SHA-256；使用者自行 Ctrl+C、貼入新的 SQL Editor 查詢並 Run。安裝與核驗分開，不代貼、不操作 OS 剪貼簿，不重跑舊 08～12 SQL。

基本版已完成正式 SQL／前端部署；本次卡片摘要在新版 SQL 核驗及前端部署前，仍僅為本機已驗證候選。若 SQL 報錯，不盲目重跑或改正式資料，先核對錯誤與唯讀結果。
