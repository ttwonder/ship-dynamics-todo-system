# 跟蹤模板的離線月曆

主站與船端共用 `.xlsm` 模板；適用電腦版 Microsoft Excel。一般報表匯出仍是 `.xlsx`。

## 使用
- 只在確認檔案來源後，允許**此模板**的巨集；不需要開啟 VBA 專案存取，也不要允許所有巨集。
- 若 Windows 標示網際網路檔案而封鎖巨集，關閉檔案後可由使用者在此檔案的「內容」確認來源並解除封鎖，再開啟；若公司政策不允許，不要更改政策，可改為手填日期。
- 選取或雙擊日期格開啟月曆；空格預選電腦當天，已有日期則優先選取原日期。
- 選日、今天、切換月份都不寫入。按「確認」才寫入，取消不改值；「清空」也要確認。
- 完工、實際送船、結案與 DL 各自獨立；不因開啟月曆自動填入尚未發生的日期。
- 月曆按可見工作區縮放，不列印；保存、換工作表或關檔會關閉未確認的月曆。
- 網頁匯入只解析儲存格，不執行 VBA；仍接受舊 `.xlsx`。

## 可核對來源
`TrackingCalendar.bas` 與 `ThisWorkbook.cls` 為自製 VBA，無網路、外部程式、ActiveX 安裝或檔案系統操作。`project.json` 保存原生 Excel 編譯的 VBA binary（base64）、SHA-256 與工作表 codeName。由 `trackingCalendarWorkbook.ts` 加入最終 XLSM 封裝；不把範本的使用者資料一起嵌入。

若修改 VBA，須在獲授權的 Windows Excel 中重新編譯：三張工作表依序為「填寫資料」「列印明細」「_tracking_schema」，codeName 為 Sheet1、Sheet2、Sheet3；匯入標準模組，並把 `ThisWorkbook.cls` 自 `Option Explicit` 起的程式放入工作簿事件模組，勿另建同名一般類別。以 XLSM 保存，擷取 `xl/vbaProject.bin` 後更新 `project.json` 的 base64 與 SHA-256。須重新驗證原生點擊、保存重開與兩端匯入。

封裝將**本檔案**的 `filterPrivacy` 設為 0，以免 ExcelJS 預設值與 VBA 組合觸發每次保存的 Document Inspector 警告。下載檔案的建立者仍為 Ship Dynamics；這不是巨集安全或全域信任設定的變更。

契約檢查：`node scripts/verify-tracking-calendar-transport.mjs`、`npm run test:tracking:fields`、`npm run test:tracking:spreadsheets`。原生 Excel／指標點擊驗證與網頁／SQL 驗證是不同證據，不可互相代替。
