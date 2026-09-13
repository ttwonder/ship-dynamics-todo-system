# 原報告中心：手動 Itinerary 報告來源接線（本機）

本片沿原 `main.tsx → App → 報告中心 → 手動保存目前 Itinerary`，不改版面、文案、角色、SQL、grants 或全域設定。不是完整切換回退、正式 Supabase 或全站驗收。

## 寫入與恢復

- 新的手動保存意圖先讀取既有窄版 BrowserAuthority，將來源／epoch 與原 operation、workspace、actor 一起寫入既有 v1 pending envelope。未准許新寫入時不建立 pending 或送出報告 RPC。
- 已送出的意圖及回覆遺失後的對帳，沿捕獲的來源與同一操作，不因目前來源變更而轉投新入口。資料庫已提交不等於前端已確認；成功訊息與清除 pending 仍須核對完整終態收據。
- 舊 v1 envelope 沒有來源欄位時保留原 raw-config 路由，不補寫成新操作。一般未知結果仍保留 pending，不擅自刪除或自動重新新增。
- 報告清單／日期定位／exact-ID 讀取跟隨當前來源，前後核對來源未變；保留報告 ID、page／setToken 與原 frozen snapshot 語意。

## 本機證據分層

| ID | 情境 | 證據層級 |
|---|---|---|
| MR-01 | 原按鈕保存後，獨立核對完整正式行程快照及唯一報告／操作；回覆前不能顯示成功 | 原 App＋native PostgreSQL＋loopback HTTP |
| MR-02 | 目標 legacy 已提交但回覆遺失；暫停寫入後以同一操作對帳，僅一份報告 | 原 App＋native PostgreSQL |
| MR-03 | records 來源先真提交／保留待確認，接著發布 legacy 並暫停；仍由原 records 操作查回，不重複新增 | 原 App＋native PostgreSQL |
| MR-04 | 使用基線 `49f954ef996c8d7c576b493bffcee4b40803b2a5` 的真實舊產品建立不含來源欄位的 pending；提交回覆遺失、來源發布後，換入候選並明確重開，原始 pending bytes 不變，原按鈕對帳成功 | 原 App 新舊版本＋native PostgreSQL；不是手工注入 pending |

MR-01／02／03 不藉刷新、改設定或清儲存取得成功。MR-04 的重開是明確測試「部署新程式後恢復」，不是替正常保存解套；只替換隔離副本中的已封存產品檔案，不改正式網站或 canonical 工作區。

快照 oracle 在命令前由正式 document 與有效船隊資料建立，核完整 rows、缺 document 的既有預設、server time／Taipei business date，並以篡改業務欄位確認 oracle 會失敗。每次真正的對帳後核對報告／operation、正式 document／history／lease 及 AppData；歷史來源對帳以發布完成後的新基線核對零額外資料改動。

受控 mounted 元件案例、受控 client-module 案例及 SSR／source wiring 檢查另列，不能加總冒充原 UI E2E。exact-ID／page／locate 的 client 呼叫接真本機 SQL，但不是逐一點擊所有清單／預覽控制。

## 可重跑的本機檢查

```text
node scripts/verify-manual-report-source-binding.mjs
node scripts/verify-itinerary-daily-reports-client.mjs
node scripts/verify-manual-itinerary-report-button.mjs
node scripts/verify-itinerary-daily-reports-ui.mjs
node scripts/verify-itinerary-daily-report-data-management.mjs
node scripts/verify-itinerary-record-reports.mjs
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vite/bin/vite.js build
```

Native 編排目前為外部封存的 runner／scenario／phase-plan；父驗收檔記錄完整程式输入、原始失敗、命令、收據、版本升級兩階段與資源清理。它不是 production 的 SQL 操作指南。

## 保留的其他工作

- 報告刪除的 source routing／原 pending namespace：本片不修改、不聲稱已支援切換後刪除。
- 行程編輯器／投影／船端入口、早會、完整正反切換與全域 unknown-command 恢復：另行整合。
- 非終態未知操作的人工處置／完整回復活性，不由已提交報告的成功重放推論。
- Hosted Supabase ACL／PostgREST／Realtime、全角色手機／PDF，以及使用者隔離試用、Push 和正式 SQL：仍是獨立門檻。
