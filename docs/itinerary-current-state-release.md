# 船端目前狀態及下一港投影｜本機增量候選

此文件只交付需求 1、2；不含看板篩選或日曆入口。未執行正式 SQL、未 Push／部署。既有 release 05–14、manifest 與目前正式操作關卡不變，不能因本候選通過本機測試而恢復正式保存或重跑舊包。

## 資料與編輯邊界

- 正式 Itinerary 第一列新增 optional `currentVesselState`：`location?`、`navigationStatus?`、`loadStatus?`、`statusList?`。仍在 `rows_payload`，不新增 AppData 寫入或改版 document schema。
- object／個別 key 缺席沿用原船卡資料；`location: ""`、`statusList: []` 是明確清空。未選的 select 不存入虛構預設；其他欄位保存不會補空。
- 位置提示為「非經緯度，而是大致區域位置」；航行六選、載況三選及船舶狀態六項沿用原語意，畫面 `drydock/repair` 仍儲存 `drydock/repiar`。
- 只有船端編輯器提供上述 controls。岸端 quick／batch 唯讀，central equality／write mask 與 Smart Ship merge 都保護這四欄。岸端 Itinerary 儲存保留正式 metadata，不提供 controls。
- 刪除／重新排序首列、重新計算、Excel 替換及備選提升均保留正式 metadata；備選列不容許 metadata。
- SQL 的船端 actor 是既有 `public`，不是 office 使用者的業務角色 `vessel`。既有 shore 保存只能帶回不變 metadata；舊 client 省略 object 時保留既有值。驗證／lease／CAS／原 request replay signature 保持，metadata guard 在 replay 後、寫入前。

## 下一港與時點

按正式列 `sortOrder`／`rowId` 排序。僅當首列 `etdUtc` 為有效 instant 且 **嚴格早於** supplied now，才顯示第二列 `portDockName`；第二列缺席或空白即 `TBA`。相等、未來、缺失、無效 ETD 保持首列。不找第三列、不用備選；上一港、ETA／ETB／ETD、貨載仍取首列。

即時頁面以獨立 15 秒 timer／視窗 focus 重算投影，不依賴資料更改或成功的 cloud poll。historical snapshot 只用 `capturedAt` 算一次，後續顯示不重新推進。兩個既有 scheduled builders 使用同一 captured-time SQL helper；不存在的 scheduler 不會因此被安裝。

## SQL 交付

新增 forward migration：

`supabase/migrations/20260916090000_itinerary_current_vessel_state.sql`

前置是既有 Itinerary alternatives／rows validator。先保留舊 rows validator，再驗新增 optional keys；拒絕非法 enum、非首列及備選污染。對已安裝的 main／record／public source-authority copies 一併套用同一 metadata 寫入邊界。可重跑、不新增 browser grants；既有函式 OID／ACL 保留，新增純 helper 不開 browser EXECUTE。未知 predecessor body 會中止整筆交易。

本檔是獨立功能 delta，**不要重生／重跑 records 控制 release chain**。正式交付須先核對當下前置及部署時序，再由使用者自行 Run／讀回；本次僅本機隔離演練。未修改既有 document、history、lease 或 report rows。已存在的舊快照不補算、不回填。

## 可重現驗證

```sh
npm run test:itinerary
node scripts/verify-itinerary-current-state-db.mjs --native
npm run test:itinerary-record-write
npm run test:vessel-quick-update-scope
npm run test:batch-managed-vessel-updates
npm run test:vessel-status-officers
npm run test:vessel-detail-quick-layout
npm run test:vessel-workflow
npm run typecheck
npm run build
npm run verify:itinerary-build-output
```

Native 模式需提供本機 `SHIP_QA_PG_BIN`、`SHIP_QA_PG_MODULE`，可用 `QA_OUTPUT` 指向 repository 外 evidence cache。不接受正式連線 URL。

證據分層：domain/model/SSR、controlled mounted React、PGlite、隔離 native PostgreSQL 分開計算。browser probe 驗時鐘與真實 ship component controls、1440／390 寬度；不是原 App 登入到 SQL 的端到端验收。正式使用者試用／hosted pg_cron、PostgREST、Realtime 不在本次 PASS 範圍。詳列 receipts、原始 RED 及最新 GREEN 見外部 `req1-2-handback.json`。
