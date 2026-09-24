# 跟蹤頁版面與進度歷程交接

## 本次範圍

- 主系統「配件/物料/工程跟蹤」：Excel、PDF、兩種模板移至「導入 Excel」後。
- 縮窄搜尋框，桌面與選取／批量操作同排；手機自動換行。
- 「全部欄位篩選」與「欄位設定」同排，展開面板使用緊湊欄位，不改篩選語義。
- 更新進度視窗的桌面最大寬度由 1100px 放大為 2200px；窄螢幕受視窗寬度限制。
- 更新進度時直接顯示已保存歷程：內容、更新人、年月日時分秒（UTC+8），最新在前。內容保持換行，較長歷程在區域內捲動。
- 限縮頁首的船舶 select 樣式，避免移入頁首的匯出視窗在手機繼承 `width:0`。

## 保留的語義與邊界

- `urgentSubtypes`「原急件類型」保留：F28 匯入時保存「檢查航行必須」及「其他」的原急件細分類，與普通／緊急 `urgency` 不同。待使用者決定去留，未刪除表單、列表、篩選、模板或匯入／匯出欄位。
- 進度原本已逐次追加 `statusLogs`；本次僅新增就地顯示。與上次相同的內容不製造重複歷程。時間沿用該次命令的 `at`，不是新增的伺服器收件時間。
- lease、CAS、exact ACK／unknown ACK、草稿、批量及有效關聯交易規則不變；無新增 RPC、migration、角色或權限。
- 後續船端頁名稱為 `packageorwork-tracking.html`，本次尚未建立，不能當成已可用網址。船端操作範圍仍需定案。
- 本次不 Push、不執行正式 SQL，不操作正式事故頁或正式資料。

## 驗證證據

環境為 **真實 UI＋測試資料**：既有 App、Chromium、本機原生 PostgreSQL；不是 hosted Supabase 或正式環境驗收。測試不連正式資料服務。

| 命令 | 結果／範圍 |
| --- | --- |
| `npm run test:tracking:layout` | PASS；桌面／390px 手機布局、移位後的搜尋／篩選／選取／匯出；連續兩次進度保存、時間顯示、重新讀回；手機匯出下拉可見 |
| `npm run test:tracking` | PASS；業務命令與有效關聯同步 |
| `npm run test:tracking:table` | PASS；排序、篩選、範圍與表格快照 |
| `npm run test:tracking:browser` | PASS；原 App 保存／草稿／ACK／關聯流程，及獨立元件交互回歸 |
| `npm run test:tracking:spreadsheet-browser` | PASS；真實檔案匯入、XLSX／PDF／模板下載、篩選／選取範圍、重新讀取 |
| `npm run test:tracking:edit-entry` | PASS；編輯排他、完整關聯、批量、失鎖留稿及未知 ACK |
| `npm run build` | PASS；包含 TypeScript 編譯。Vite 提示部分 bundle 大於建議大小，未擴大本次範圍處理 |
| `git diff --check` | PASS |

布局及進度歷程均先取得行為 RED 再轉 GREEN。手機匯出回歸先重現兩個 select 寬 16px，再以限定頁首樣式修正；最終均約 342px，頁面寬 390px，沒有全頁橫溢。

最後修正只限頁首 select CSS：重跑 layout、spreadsheet-browser 及 build；其餘未改業務路徑沿用前述通過結果，不重跑無關全量測試。

## 上線交接

本機驗證並 commit 後，由使用者在既有 GitHub Desktop 儲存庫 `E:\Projects\ship-dynamics-save-feedback-push` 的 `main` 按 **Push origin**。本次不需要 SQL。Push 與 Pages 發布尚未等同本機完成，發布後需另核對版本。
