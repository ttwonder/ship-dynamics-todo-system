# Ship Dynamics Itinerary v1 實作契約

狀態：本機實作基線（2026-08-31）
來源：使用者需求、`每日 甲板 - Itinerary - 模板.xlsx`、現行 `Dashboard.tsx` 及既有權限／保存流程。

## 1. 隔離邊界

- Itinerary 是獨立模組，只共用既有不可變 `vessel.id` 與顯示船名。
- Itinerary current document、rows、revision、lease、operation receipt、history、draft 與 rollout 均不得寫入現有 `AppData`。
- 不復用早會 `agendaSelection`、批量船舶 `batchSelectedVesselIds`、現有 AppData revision 或 `vessel:*` edit-lock key。
- 現有 KPI、篩選列、船舶卡片、早會、PDF、待辦、會議、內控與全域保存行為保持不變。
- Itinerary 雲端物件一律使用 `sd_itinerary_` 前綴；瀏覽器草稿一律使用 `ship-dynamics-itinerary/` 前綴。

## 2. Rollout 與可見性

- 主網站初始只允許 `owner` 看見及使用 Itinerary。
- Owner-only 是試行設定，不是永久硬編碼；後續由 `sd_itinerary_role_permissions` 開放其他角色。
- 非允許角色：DOM 中沒有入口、面板或編輯器，也不得發出 Itinerary data RPC。
- 正式環境後端未安裝、rollout 不明或 RPC 失敗時 fail closed：主站入口隱藏。
- 本機可用明確 demo 模式顯示，畫面必須標示「真實 UI＋測試資料」。demo 模式只能在 loopback host 生效。
- 船端頁正式驗收前 `ship_portal_enabled=false`：只顯示「Itinerary 尚未開放」，不列船、不讀 document、不 claim lease。
- 正式啟用後船端頁依已確認決定採公開讀寫；這是產品取捨，不描述成身分驗證。

## 3. 主網站視圖

- 紅框位置新增 `切換 Itinerary 視圖`；切換後文字為 `返回船舶卡片`。
- KPI 與現有篩選列保持掛載；只替換篩選列下方的內容。
- 卡片與 Itinerary 使用同一個 `visible` 船舶集合。
- Itinerary 有獨立 `itinerarySelection`：船被篩掉時保留選取，並顯示 `已選 N／目前可見 M`。
- 一船一個緊湊 panel；預設最多顯示 7 列，超過時 panel 內捲動並可展開。
- 13 欄只允許 panel 內橫向捲動，整頁不得橫溢；港口欄 sticky。
- 相對更新時間只根據 server `updated_at` 顯示，不根據瀏覽器保存時間猜測。
- 辦公室只手動編輯 A:M；不在主網站自動重算公式。

## 4. Canonical document

```ts
interface ItineraryDocument {
  schemaVersion: 1;
  workspaceKey: string;
  vesselId: string;
  vesselName: string;
  revision: number;
  updatedAt: string | null; // server UTC ISO
  updatedActorKind: 'owner' | 'vessel' | 'demo';
  updatedActorLabel: string;
  rows: ItineraryRow[];
}
```

每個 row 有不可變 `rowId`、整數 `sortOrder`，以及下列欄位。

### 4.1 A:M 報告欄

| Excel | canonical 欄位 | 型別 | v1 規則 |
|---|---|---|---|
| A Voy No. | `voyageNumber` | string | 可空；trim；最多 80 字 |
| B Port & Dock Name | `portDockName` | string | 可空；最多 240 字 |
| C Loading / Unloading | `operation` | `Loading\|Unloading\|''` | 下拉；未知值拒絕匯入 |
| D B/F or I/F Qty | `cargoQuantityText` | string | 報告文字；最多 1,000 字；不從文字猜數值 |
| E ETA (LT) | `etaUtc` | ISO instant/null | 依本列 IANA zone 顯示 LT |
| F ETB (LT) | `etbUtc` | ISO instant/null | 同上 |
| G L/D rate | `ldRateText` | string | 報告文字；計算另用 U 欄數值 |
| H ETC (LT) | `etcUtc` | ISO instant/null | 同上 |
| I ETD (LT) | `etdUtc` | ISO instant/null | 同上 |
| J Arr Draft | `arrivalDraftText` | string | 保留樣式文字／密度註記 |
| K Dep Draft | `departureDraftText` | string | 同上 |
| L arr ROB | `arrivalRobText` | string | v1 人工輸入，不推測公式 |
| M dep ROB | `departureRobText` | string | v1 人工輸入，不推測公式 |

### 4.2 N:W 計算輔助欄

| Excel | canonical 欄位 | 型別／單位 |
|---|---|---|
| N 時區 | `portTimeZone` | IANA zone；固定 offset 只作舊檔匯入提示，不作 authority |
| O 大洋距離 | `oceanDistanceNm` | number/null，NM，>= 0 |
| P 速度 | `speedKnots` | number/null，knots，> 0 才可計算 |
| Q 航行時間 | `sailingHours` | derived number/null |
| R 到碼頭時間 | `berthWaitHours` | number/null，hours，>= 0 |
| S TANKS | `tanksText` | string |
| T QUANTITY | `operationQuantityMt` | number/null，MT，>= 0 |
| U 預計裝卸速度 | `operationRateMtPerHour` | number/null，MT/hr，> 0 才可計算 |
| V 裝卸時間 | `operationHours` | derived number/null |
| W 預加時間 | `departureBufferDays` | number/null，days，>= 0；沿用模板單位 |

時間欄另有 `etaMode/etbMode/etcMode/etdMode: 'auto' | 'manual'`。人工覆寫後上游變更不得覆蓋；只有按 `恢復自動計算` 才重新加入計算鏈。

## 5. v1 計算決定

本輪開始實作時採以下可驗證預設；它們不改變 A:M 儲存格式，日後可調整 domain 規則而不遷移文件。

```text
sailing_hours = ceil(ocean_distance_nm / speed_knots)
next_eta_utc = previous_etd_utc + sailing_hours
etb_utc = eta_utc + berth_wait_hours
operation_hours = operation_quantity_mt / operation_rate_mt_per_hour
etc_utc = etb_utc + operation_hours
etd_utc = etc_utc + departure_buffer_days
```

- 航行時間採模板的向上取整到整小時。
- UTC instant 是 authority；IANA zone 只用於 LT 輸入／顯示及 Excel 轉換，不再做 Excel 的 `-前港 offset +本港 offset` 牆鐘算法。
- 本列 ETA 通常由前列 ETD 推導；第一列 ETA 必須人工輸入。
- 缺少必要上游值、speed/rate <= 0、IANA zone 無效或 DST wall time 不存在／有歧義時停止該欄及下游自動計算，顯示原因，不生成猜測時間。
- ROB v1 維持人工輸入。
- 港口距離 v1 由船端輸入 NM；可建議已確認航線值，但不以一般地圖直線距離代替海上里程。

## 6. 協作與保存

- 同一 workspace + vessel 只有一個有效可寫 lease；不同船可同時編輯。
- 每個 mutation 必須帶 `lease_id/token`、monotonic `fence`、`expected_revision` 及穩定 `operation_id`。
- server transaction 同時更新 current rows、document revision、immutable history 及 terminal operation receipt。
- 成功只以 server ACK 或相同 operation 的 terminal COMMITTED receipt 判定；Realtime/poll/local state 都不是 ACK。
- 保存／取消明確 release；編輯時 heartbeat；8 分鐘無活動警告，10 分鐘退出可寫狀態。
- 關閉分頁只作 best-effort release；server expiry 才是最終保護。
- 失鎖、stale revision、斷線或未知結果：編輯器保留、轉唯讀、保留本機草稿，不自動清除或靜默覆寫。
- 船端編輯期間若 poll 發現較新 revision：凍結提交，先同步／比較最新內容。

## 7. Excel 契約

### 7.1 已驗證模板

- `無公式版本`：A1:W13，print area A1:M10，4 個 merge。
- `有公式版本`：A1:W30，print area A1:M27，231 個 merge。
- 全 workbook：160 個公式、31 個資料驗證。
- ExcelJS 4.4.0 critical round-trip PASS：公式與 cached result、驗證、merge、列高、A:M 欄寬及列印範圍均保留。
- 已知非關鍵序列化預設：W 欄顯式寬 9 會省略為預設；未設定首頁碼時 `useFirstPageNumber` 布林預設改變。兩者不影響 A:M 報告，但測試中保留紀錄。

### 7.2 Export

- 一船一 worksheet；多選時一個 workbook 多分頁。
- worksheet 名稱依船名清理非法字元、限制 31 字並做碰撞尾碼。
- very-hidden `_manifest` 保存 schema version、workspace、vessel ID、顯示名、document revision、exported_at；不得只靠 sheet 名映射。
- A:M 對標模板；N:W 可保留計算欄，預設不進列印區。
- 文字以 `= + - @` 起首時強制文字輸出，避免 formula injection。

### 7.3 Import

- 只接受 `.xlsx`；拒絕 `.xls/.xlsm`、未知 schema、缺 header、超限檔案／sheet／row、重複 vessel ID。
- 有 `_manifest` 依不可變 vessel ID；舊模板依 Vsl name 產生人工 mapping，禁止默猜。
- 寫入前顯示目標船、目前／檔案 revision、列數及新增／刪除／變更摘要。
- 多船 workbook 採 all-or-none；任一船被鎖、stale 或 mapping 不唯一時 0 writes。
- 匯入公式本身不是 authority；讀 cached result或由 canonical domain 重算。無 cached value 時要求補值／確認。

## 8. 船端頁

- 獨立 HTML entry，不 import `App.tsx`、AppData、會議、任務或管理模組。
- 選船後可 `從空白開始` 或 `載入最新版本`。
- 桌面使用緊湊 spreadsheet table；手機每個港口一張表單卡。
- 可新增、複製、排序、刪除列；至少保留一列。
- 日期與時間分開選；以 IANA zone 轉為 UTC，DST 不合法時拒絕。
- IndexedDB／namespaced storage 保存草稿；`保存並同步` 與 `取消編輯` 語意分離。
- 報告動作：產生並下載 Excel，再開啟預填 mailto；瀏覽器無法可靠自動附檔，UI 必須提示手動附上剛下載的檔案。

## 9. Calendar

- 一船一橫列，日期／時間為欄。
- 可選 7/14/30/60/90 日或自訂起訖；每日欄寬有最小／最大限制。
- 可勾選船名、航次、港口、作業、貨量、ETA/ETB/ETC/ETD、吃水、ROB。
- 空白／無效時間列入 `未排入行事曆`，不可靜默消失。
- 顯示偏好只存本機，不改 document。

## 10. 本機與正式證據邊界

- 本機 demo 只能證明 UI、domain、Excel、草稿及 fake lease/CAS 行為。
- 正式完成仍需 additive SQL、真 Supabase runtime、匿名／Owner RPC negative matrix、雙瀏覽器 lease/CAS/lost-ACK、hosted readback 及 Pages smoke。
- 未經使用者另行確認：不得 Push、部署、執行正式 SQL、開啟 `main_enabled` 或 `ship_portal_enabled`。
