# 船舶分管表：年份／噸數與相鄰人員合併

## 使用方式

- 管理中心 → 船舶 → 選船，在「船舶資料」維護 **年份／噸數**，沿用原本「保存變更」與管理權限。
- 兩欄是顯示文字，例如 `2021.06`、`2.0萬`。不推算船齡，不擅自定義為建造／交付日或 DWT／GT。
- 已有資料優先；尚未保存的欄位，按精確船名從使用者提供的 `20260624船東督導(3).pdf` 預填。來源 42 筆及 PDF SHA-256 保存在 `src/data/vesselParticularsReference.json`。
- 預填只在編輯器，畫面標示來源日期及「核對後保存」。不自動上雲，也不提前進入匯出；不匹配或有歧義的船舶留空。
- SQL 只讓新欄位可保存，不會填入參考數值。若匯出仍空白，請先在船舶編輯器核對並「保存變更」，再重新匯出；只打開編輯器或舊 PDF 不會更新資料。
- 明確清空再保存是有效資料；重新載入不會再次填入舊 PDF 建議值。沒有回填歷史、修改已下載 PDF 或改動分管名單。

## 匯出

- PDF／Excel「船舶分管」末尾新增年份、噸數，督導相對欄寬由 30 減至 15。
- 所有已設定、帳戶啟用中的預設代管人員都以括號呈現；該船代管已激活者在人名後加 `*`，例如 `張三（李四、王五*）`。不改實際代管權限，也沒有虛構一對一職務代理關係。
- 督導欄自動換行；其他欄維持緊湊不換行。Excel 對垂直合併儲存格依整個 span 保留文字高度，避免只設 WrapText 卻截字。
- 同一部門欄內，相鄰且整組直接分管／代理 **人員 ID、直接／代管身分與激活狀態完全相同**時合併；同名不同人、代理不同、非相鄰及空白格不合併。保留原船舶排序。
- PDF 使用 rowspan；Excel 為真正的合併儲存格。維持 A4 直向單頁，過多資料會縮字；「人員分管」工作表仍保留原功能。

## 上線順序（正式操作仍需使用者執行）

這次換行、代管顯示與「年份」改名只改前端；已安裝且唯讀核對通過者不需再跑 SQL。以下僅供尚未安裝新欄位者使用：

1. 先確認目標 Supabase 專案，執行唯一增量：`supabase/migrations/20260918090000_vessel_assignment_particulars.sql`。**不要重跑 `supabase/schema.sql` 或舊 migration。**
2. 安裝回覆應為 `vessel-assignment-particulars-ready`、`particulars_ready=true`。
3. 另開查詢執行 `supabase/verification/vessel_assignment_particulars_readback.sql`，所有 `pass` 應為 `true`。
4. 核對後由使用者 Push／部署；再在船舶管理核對與保存資料。

增量只將兩個新欄位加入既有船舶基本資料清單，不增加資料表欄位，不改資料、ACL、其他欄位的協作鎖或 CAS。原函式若不符預期，整筆交易失敗；請保留錯誤，不手動移除檢查或重跑整份 schema。已安裝可重複執行；本機驗證不代表正式已執行。

## 本機驗證入口

- `node scripts/verify-vessel-particulars.mjs`：保存／清空／舊資料正規化、來源筆數、名稱歧義、管理權限與鎖分類。
- `npm run test:management`、`npm run test:cloud-authorization`、`npm run test:cloud-rebase`、`npm run test:vessel-workflow`、`npm run build`。
- `QA_EVIDENCE_ROOT` 設為絕對外部目錄，再跑 `npm run test:management-assignment-browser`；`QA_EXTRA_VESSELS=100` 可驗較多列縮放。輸出目錄交給 `scripts/verify-management-assignment-excel-native.py` 與 `scripts/verify-management-assignment-print.py`；分別需要 Microsoft Excel／pywin32，以及 pypdf／pypdfium2。
- 設 `SHIP_QA_PG_BIN`、`SHIP_QA_PG_MODULE` 與 `QA_EVIDENCE_ROOT`，執行 `node scripts/verify-vessel-particulars-sql.mjs`。使用一次性本機 PostgreSQL，驗真寫入／讀回、CAS、前版升級、重複執行、ACL 及唯讀 readback。
- 同樣環境執行 `node scripts/verify-vessel-particulars-browser.mjs`，使用原版 App／Management 與本機 SQL 驗預填、保存、清空、重新載入。另設 `QA_PARTICULARS_STORAGE=legacy` 可驗另一既有儲存路徑；預設為 `records-v1`。沒有正式資料或測試替身通過冒充真雲端。
