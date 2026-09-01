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
- production entry 保留現行 `App.tsx`；Itinerary 的 Supabase Auth 只在其專用驗證入口建立，不切換整站 `NormalizedApp`，驗證失敗也不得阻止現有網站使用。
- 主站 Itinerary session 必須由 server rollout 回傳的 department／username label／display name／role 與目前 App 使用者完全相符；網站登出或切換為其他使用者時必須清除 Itinerary local session，任何錯配也必須 fail closed 並清除。
- Itinerary migration 以前置安裝的 normalized Auth orchestration（含 `sd_login_options`、site-unlock／login-directory）為 prerequisite；`must_change_password=true` 的 session 在 DB 層不得讀寫 office Itinerary。
- 初次 Owner 試行啟用必須先由 Owner 專用 bootstrap 入口完成雲端身份驗證，再使用 `sd_itinerary_owner_update_rollout` 的 CAS version 與 operation receipt；不得把直接 SQL `UPDATE` 當成正常啟用流程。
- Owner bootstrap 控制只可開啟／關閉主站試行，必須明確傳送 `ship_portal_enabled=false`，並維持 Admin／Operator／Vessel 權限全關閉；公開船端另行驗收後才可獨立啟用。
- Owner 驗證欄位使用目前網站的 Owner 個人登入密碼，不要求使用者記憶第二套密碼；原生 Supabase 登入失敗時，只可由受進站 gate、精確 identity link、Owner membership 與雙層 rate limit 約束的 `owner-password-session` 在伺服器端驗證現行 AppData hash，再更新該 Owner 的 Auth 密碼並建立 session。

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

| Excel | canonical 欄位 | 型別 | v2 規則 |
|---|---|---|---|
| A Voy No. | `voyageNumber` | string | 可空；trim；最多 120 字 |
| B Next Port & Dock Name | `portDockName` | string | 可空；最多 300 字 |
| C Purpose | `operation` | canonical ordered string | Web 多選：`To Load`、`To Unload`、`docking`、`waiting order`、`repair`、`inspection`；固定依此順序以 ` / ` 串接；舊 `Loading/Unloading` 匯入時轉換，未知／重複值拒絕 |
| D B/F or I/F Qty (MT/BBLS) | `cargoQuantityText` | string | 報告文字；最多 500 字 |
| E ETA (LT) | `etaUtc` | ISO instant/null | 使用 `etaTimeZone || portTimeZone` 顯示 LT |
| F ETB (LT) | `etbUtc` | ISO instant/null | 使用 `etbTimeZone || portTimeZone` 顯示 LT |
| G 預計 L/D rate (MT/h) | `ldRateText` | string | 船端修改時同步解析至 `operationRateMtPerHour`；無法解析則為 null |
| H ETC (LT) | `etcUtc` | ISO instant/null | 使用 `etcTimeZone || portTimeZone` 顯示 LT |
| I ETD (LT) | `etdUtc` | ISO instant/null | 使用 `etdTimeZone || portTimeZone` 顯示 LT |
| J Arr Draft | `arrivalDraftText` | string | 保留樣式文字／密度註記 |
| K Dep Draft | `departureDraftText` | string | 同上 |
| L Arr ROB | `arrivalRobText` | string | 人工輸入，不推測公式 |
| M Dep ROB | `departureRobText` | string | 人工輸入，不推測公式 |

### 4.2 N:AE 計算與 Offset 欄

| Excel | canonical 欄位 | 型別／單位 |
|---|---|---|
| N UTC Offset | `portTimeZone` | 港口預設固定 UTC Offset（UTC-12 至 UTC+14，含半／45 分鐘）；舊 IANA 僅讀取相容 |
| O DTG(NM) | `oceanDistanceNm` | number/null，NM，>= 0 |
| P 預估航速(kn) | `speedKnots` | number/null，knots，> 0 才可計算 |
| Q 剩餘航行時間(h) | `sailingHours` | `DTG / speed`，保留小數 |
| R 預估等待時間(靠泊前)(h) | `berthWaitHours` | number/null，hours，>= 0 |
| S 預計航道航行時間(h) | `channelSailingHours` | number/null，hours，>= 0 |
| T 作業艙號 | `tanksText` | string |
| U 裝卸貨量(MT) | `operationQuantityMt` | number/null，MT，>= 0 |
| V 預計 L/D rate (MT/h) | `operationRateMtPerHour` | number/null，MT/h，取自左側 G 欄 |
| W 預計作業時間(h) | `operationHours` | `quantity / rate`，derived number/null |
| X 預估等待/延誤時間(完貨前)(h) | `preCompletionDelayHours` | number/null，hours，>= 0 |
| Y 預估等待/延誤時間(完貨後)(h) | `postCompletionDelayHours` | number/null，hours，>= 0 |
| Z:AC 各 LT UTC Offset | `etaTimeZone/etbTimeZone/etcTimeZone/etdTimeZone` | 空字串代表跟隨 N；非空代表個別覆蓋 |
| AD 首列 ETA 起算時間(LT) | `calculationStartUtc` | Excel 顯示 LT，canonical 保存 UTC instant |
| AE 首列 ETA 起算 UTC Offset | `calculationStartTimeZone` | 固定 UTC Offset；起算時間存在時不可空 |

`departureBufferDays` 僅保留舊 v1 row／Excel 匯入相容；只有 v2 欄位不存在時才換算為 `postCompletionDelayHours = days * 24`。v2 明確空白代表 0，不可重新套回舊天數；新 UI 不再顯示或寫入天數。

時間欄另有 `etaMode/etbMode/etcMode/etdMode: 'auto' | 'manual'`。人工覆寫後上游變更不得覆蓋；切回 auto 才重新加入計算鏈。

## 5. v2 計算決定

```text
remaining_sailing_hours = DTG_nm / estimated_speed_kn
first_eta_utc = calculation_start_utc + remaining_sailing_hours
later_eta_utc = previous_etd_utc + current_row_remaining_sailing_hours
etb_utc = eta_utc + pre_berth_wait_hours + channel_sailing_hours
operation_hours = operation_quantity_mt / expected_ld_rate_mt_per_hour
etc_utc = etb_utc + pre_completion_delay_hours + operation_hours
etd_utc = etc_utc + post_completion_delay_hours
```

- 未填的時長參數按 `0` 參與可用的自動計算；DTG／航速或數量／rate 任一不全時，對應 derived duration 為 null、在公式中按 0，不阻止其他已有參數計算。
- UTC instant 是 authority；四個 LT 各自使用顯式 Offset，空值則跟隨港口 Offset。修改 Offset 時保留使用者看到的 LT 鐘面時間，再重算 UTC instant。
- 第一列 ETA 可手動，也可由明確輸入的起算時間＋起算 Offset 自動計算；anchor 只可存在第一列，刪除第一列時轉移給新的第一列；後續 ETA 使用前列 ETD 加本列剩餘航行時間。
- `speed/rate <= 0`、Offset 無效或 auto 鏈缺少必要基準 instant 時顯示原因，不生成偽造時間。
- ROB 維持人工輸入；DTG 由船端輸入海上剩餘里程，不以一般地圖直線距離代替。

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

- 原始模板仍為 A:W；v2 匯出延伸至 AJ，其中 AF:AJ 為隱藏 Offset helper，print area 仍只含 A:M。Offset 下拉使用 very-hidden 命名範圍；helper 以可見 Offset 儲存格的 `VLOOKUP` 公式即時重算，而非匯出時常數。
- 主時間公式、Offset helper 公式與下拉驗證均納入 round-trip contract。
- ExcelJS 4.4.0 critical round-trip PASS：公式與 cached result、驗證、merge、列高、A:M 欄寬及列印範圍均保留。
- 已知非關鍵序列化預設：W 欄顯式寬 9 會省略為預設；未設定首頁碼時 `useFirstPageNumber` 布林預設改變。兩者不影響 A:M 報告，但測試中保留紀錄。

### 7.2 Export

- 一船一 worksheet；多選時一個 workbook 多分頁。
- worksheet 名稱依船名清理非法字元、限制 31 字並做碰撞尾碼。
- very-hidden `_Itinerary_Meta` 保存 sheet、vessel ID／名稱、schema、revision、updatedAt、`excelLayoutVersion=2` 及固定 UTC Offset lookup；不得只靠 sheet 名映射。
- A:M 對標報告模板；N:AE 保存 v2 計算、Offset 與起算欄，預設不進列印區。
- 文字以 `= + - @` 起首時強制文字輸出，避免 formula injection。

### 7.3 Import

- 只接受 `.xlsx`；拒絕 `.xls/.xlsm`、未知 schema、缺 header、超限檔案／sheet／row、重複 vessel ID。
- 有 `_Itinerary_Meta` 依不可變 vessel ID；舊模板依 Vsl name 產生人工 mapping，禁止默猜。
- v2 依 `excelLayoutVersion=2` 解讀 S:AE；舊 layout 繼續按原 S:W 解讀，`departureBufferDays` 乘 24 轉為完貨後小時；非首列的起算時間／Offset 以 `first-row-only` 拒絕。
- 寫入前顯示目標船、目前／檔案 revision、列數及新增／刪除／變更摘要。
- 多船 workbook 採 all-or-none；任一船被鎖、stale 或 mapping 不唯一時 0 writes。
- 匯入公式本身不是 authority；讀 cached result或由 canonical domain 重算。無 cached value 時要求補值／確認。

## 8. 船端頁

- 獨立 HTML entry，不 import `App.tsx`、AppData、會議、任務或管理模組。
- 選船後可 `從空白開始` 或 `載入最新版本`。
- 船名清單及標題使用與主站船舶卡片相同的 `中文名 + fullName` 顯示規則；所有 active 船舶皆可選。
- 桌面使用緊湊 spreadsheet table；手機每個港口一張表單卡。
- 非編輯與編輯狀態的主資料區均使用主站 A:M 相同欄名、順序與內容，不顯示 Excel A–W 字母前綴。
- 編輯器分為 `輸入／計算區` 與 `自動計算用變化參數區`，兩區各自水平捲動；桌面分隔條可用滑鼠／鍵盤調整寬度，手機回到單欄。
- 可新增、複製、排序、刪除列；至少保留一列。
- 日期可用文字手動輸入／貼上（`YYYY-MM-DD`、`YYYY/MM/DD`、`YYYYMMDD`）或原生 picker；時間另行輸入。
- 港口 Offset 為預設；ETA／ETB／ETC／ETD 各有「跟隨港口」或獨立 Offset。所有轉換先經 UTC instant，不直接相加不同牆鐘。
- `全部手動輸入` 須先警告並保留目前值；`一鍵自動計算` 會把第一列 ETA 在內的四個時間欄切為 auto。
- 首列 auto ETA 需要明確起算時間／Offset；未填的可選時長按 0，補填任何參數後所有 auto 欄位立即重算，個別時間欄仍可切回手動。
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
