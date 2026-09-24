# 下一港與 ETA／ETB／ETD 同列修正

## 本次行為

- 按正式 `sortOrder`／`rowId` 排序。首列 ETD 有效且嚴格早於投影時間，下一港與 ETA／ETB／ETD 一起取第二列；相等、未來、缺失或無效 ETD 都取首列。
- 每個時間使用所選列該欄自己的時區；個別時區空白仍沿用既有 `portTimeZone` 規則，不改 UTC 儲存或 LT 顯示方式。
- 沒有第二列：下一港與三個時間在船卡顯示 `TBA`。個別時間空白：該欄 `TBA`，不借用首列或舊船卡時間。
- 第二列存在但港名空白：港名 `TBA`，保留第二列本身的時間。不掃第三列、不使用備選。
- 上一港、貨物與目前船況仍取首列；投影 metadata 的 `rowId` 仍標示首列，document revision 不變。這是唯讀投影，沒有修改行程列。
- 船卡仍僅輪換 ETA／ETB／ETD，不新增 ETC，不改版面。快速／批量更新仍鎖定相關欄位，說明文字同步更正。
- 既有 15 秒／focus 投影時鐘保留，待處理中的雲端讀取不妨礙時間推進。已保存快照不重算、不回填。

## 未來自動快照

新增 migration 只更新 `sd_itinerary_operational_values_v1(jsonb,timestamptz)` 純讀 helper，讓既有 legacy／records 自動早會 builder 的未來快照採相同行為。

不建立或改排程、不改其他函式／OID／ACL，不更動 document、history、lease 或 report 資料。不重跑任何舊 release／migration，不變更來源 authority、登入或保存協定。

遷移前檢查已安裝 helper 的已知 body fingerprint；只接受前版或本版。未知版本會中止整筆交易，不能以重跑舊 migration 處理。LF／CRLF 與同一新 migration 重跑已在隔離資料庫演練。

## 人工上線順序

本機驗證與 commit 不等於正式部署，正式 SQL 和 Push 均由使用者執行。

1. 由本提交的 raw Git blob 在 Hermes Preview 提供完整唯讀 textarea；使用者自行選取／Ctrl+C。
2. 在既有 Ship Dynamics 專案的 Supabase SQL Editor 執行：
   `supabase/migrations/20260924093000_itinerary_destination_schedule.sql`
3. 成功後另開空白查詢，執行：
   `supabase/verification/itinerary_destination_schedule_readback.sql`
4. 獨立 readback 應為 `overall=PASS`、`checks=8`、`failed=[]`。若中止、逾時或 FAIL，保留結果先核對，不重跑、不修正式資料。
5. SQL 核驗通過後，由使用者在原專案 GitHub Desktop Push 本提交。再唯讀核對遠端 main 與正式 `/app-version.json`。

兩份 SQL 必須分開執行；Preview 不使用剪貼簿 API，不代貼或代 Run。既有快照內容不受新 helper 影響。正式資料庫安裝及部署狀態須另取證，不能用本機 PASS 代替。

## 可重現驗證

```sh
npm run test:itinerary
npm run test:itinerary-destination-schedule-browser
# 隔離 PostgreSQL；先提供本機 SHIP_QA_PG_BIN / SHIP_QA_PG_MODULE
node scripts/verify-itinerary-destination-schedule-db.mjs --native
npm run test:vessel-quick-update-scope
npm run test:batch-managed-vessel-updates
npm run test:vessel-workflow
npm run typecheck
npm run build
npm run verify:itinerary-build-output
```

- 前端與 SQL 原缺陷皆有行為 RED：港名第二列、ETA 仍首列。修正後同一回歸轉 GREEN。
- domain／snapshot：ETD 前／相等／後、無第二列、空時間、正式排序、既有快照原值回放及不改來源。
- SQL：PGlite 與隔離 native PostgreSQL，直接 helper 與兩個真實已安裝 builder 都和 TypeScript 投影比對。驗升級不改既有文件／其他函式／權限，未知 predecessor 拒絕，readback 錯 fingerprint 必須 FAIL。
- Browser：真正 Dashboard、正式 feed／投影與 CSS，讀取接頭使用合成資料，不連正式系統；以實際點擊輪換三個時間，驗 live-clock／pending-read、缺值、第三列排除與 1280／390px 畫面。這不是正式環境或 App 到正式 SQL 的端到端驗收。
- 不擴大為保存、lease／CAS、未知 ACK 或事故恢復改造；它們的實作未改。驗證服務僅本機短暫啟動，結束後關閉，不建立使用者試用站。
