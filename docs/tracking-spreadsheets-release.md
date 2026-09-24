# 配件／物料／工程跟蹤：Excel、PDF 與發布交接

## 本次成品與界線

接續儲存切片 `8c756eb`、五清單 UI 切片 `766a7af`，正式入口仍是 `src/main.tsx → App.tsx → TrackingPage`。本次完成真 XLSX 導入預覽、模板、匯出與 PDF；不新增另一套網站，不改既有首頁／船卡／早會布局。模板由目前版本的同一 ExcelJS builder 按需下載，不維護容易漂移的靜態副本。

- 原始 F28／F34 唯讀解析；保留隱藏欄、工程分項、空項次、原值、排除列、來源工作表／行號／指紋。附件沒有自動匯入正式資料。
- 解析後先核對船舶、欄位、日期、異常、重複及所選集合，才保存。可編輯預覽，不按單號覆寫或合併既有項目。
- 每批明確選擇 1–100 項，一批一個原子交易。超過 100 項不自動截斷；保存各批有各自結果，不宣稱跨批原子性。
- 已有系統 ID／相同來源指紋必須排除；疑似重複須明確確認。合法同單分項各自保留。
- 完工日期、交船、DL、結案互不推定；明確匯入結案走既有 lifecycle planner，與新增在同一個 delta／RPC 提交。取消標示「取消（非完工）」；不自動建立內控或要事。
- 匯入草稿與原提交保存在 workspace／actor／vessel 命名空間。未知 ACK 保留原 ID、payload 和 operation；只確認原提交，不另建下一筆。精確 receipt 加權威讀回成功後，只清除同一個、未被新提示替換的過時警告。
- XLSX／PDF 共用已確認資料快照；可选全部篩後結果或所選項目，沿用排序，不受目前 30 項分頁限制。匯出前後檢查原身份、船舶範圍及已保存狀態，草稿或未知結果不能冒充正式資料。
- 可見欄／完整欄／明確精簡 7 欄可選。XLSX 保留文字型編號、前導零、日期、換行，公式前綴當文字。資料表供編輯／匯入，寬表用「列印明細」；不縮整張寬表至無法閱讀。
- PDF 預設 A4 橫向，可選 A3。超過 8 欄改完整逐欄明細；長文明確續行、每頁船名／表頭／頁碼。所有欄位版包含來源追溯原值，所以描述在來源原值中重現是有意保留，不是業務項目重複。

## 有限驗收：本機，不是正式雲端

全程標示「真實 UI＋測試資料」，使用正式 App、隔離 profile、本機 HTTP 及專有原生 PostgreSQL；沒有拿正式資料測試。沒有另開新一輪獨立 reviewer，以下為 parent 的實際驗證，不冒充獨立審查或 hosted Supabase 通過。

| 證據層 | 最後結果 |
|---|---|
| 解析／匯出／選取規則 | 9 個具名案例 PASS（含兩份原附件唯讀對照） |
| 真實 App＋原生 SQL 的匯入／匯出流程 | 15 個具名情境 PASS |
| 五清單／既有關聯流程回歸 | 17 個真實 App＋SQL 情境 PASS；另列 7 個 component-only 情境 PASS |
| 原生 SQL 的保存／授權／CAS／相容性 | 19 個具名案例 PASS |
| Microsoft Excel | 5 個實際瀏覽器下載 XLSX 原生唯讀開啟、無修復模式、列印成功，原 XLSX hash 不變 |
| 真正 PDF | 3 個 Chromium PDF＋5 個 Excel 原生 PDF：集合、長文、每頁表頭／船名／頁碼及頁邊界核對 PASS；檢視代表頁和尾頁 |
| TypeScript／production build | `typecheck`、`build` exit 0；保留既有 chunk-size warning，沒有藉此重構打包 |

原附件核對：F28 67 筆主資料及 13 原欄；F34 139 工程內容行、133 工委單號，`9EX240310` 的七分項不合併；8 個尾端非空列留在人工排除／處理區。這些筆數來自原附件，不是匯入正式系統的筆數。

匯入流程覆蓋取消零寫入、選定保存及讀回、101 項分成 100＋1 兩個明確交易、無效日期／疑重複零寫入、已提交後遺失 ACK、精確重試不重複、來源指紋二次匯入拒絕、全新 document 重讀、明確取消結案單次交易。匯出驗證涵蓋 101 項全篩選排序、個人欄位順序、2 項所選完整欄位、A4／A3、模板及 ID 重匯入攔截。

保留了中途失敗證據及分類：CDP 同名下載覆寫改成每次下載獨立目錄；新檔解析等待改為本次解析完成；測試操作折疊欄前先展開。唯一額外產品修正是 exact receipt 讀回後的過時警告清理，有修正前 RED／修正後 GREEN。PDF 的全文計數須分開業務描述與來源原值，並排除續列標籤，不能把這種測試分母錯誤當成產品漏字。

## 可重跑指令

- `npm run test:tracking:spreadsheets`；加 `TRACKING_REFERENCE_DIR` 可跑原附件 hash／行數對照，不把原件放入 Git。
- `npm run test:tracking:spreadsheet-browser`
- `npm run test:tracking`、`test:tracking:table`、`test:tracking:native`、`test:tracking:browser`
- 本次亦通過 `test:internal-control`、`test:internal-control-projection`、`test:internal-control-save-close`、`test:internal-control-dates`、`test:batch-internal-control`、`test:meeting-morning-inclusion`、`test:work-center-updates`、`test:ship-internal-control`、`test:cloud-record-store`、`test:cloud-record-workflows`、`test:save-queue-feedback`。
- `npm run typecheck`、`npm run build`。

原生 browser／SQL 指令需要先前已驗證的本機 runtime prerequisites，見 `tracking-ui-slice.md`；不可改指向正式 DB。原始 logs、screenshots、XLSX／PDF 與 cleanup receipt 在 repo 外 `C:/Users/tuotu/AppData/Local/hermes/cache/scratch/tracking-spreadsheet-implementation/`，最終摘要另保存於交接證據包；不把它們或私有 configuration 加入 Git。

## 正式上線仍須依序完成

1. 只安裝 `supabase/migrations/20260924160000_tracking_records.sql`，從已提交的完整原始 blob 建立唯讀 Preview。使用者自行 Ctrl+C、貼入正確 Supabase 專案的新 query、Run。**不重跑 08–12、不解除舊 source freeze、不執行任何重新匯入。**
2. 執行結果不明或有錯誤即停，不重送；使用另一個新 query 執行 `supabase/verification/tracking-records-readback.sql`。預期 kind=`tracking-records-readback-v1`，9 個安裝／權限布林值全為 true。這不等於正式保存流程已驗收。
3. 新 migration 是 forward extension：擴充 installed records writer/import、保留 v1 九集合、增加 v2 scope 與私有 linked validator；不修改現有業務列、不導入附件、不更換 authority／epoch 或切換人員身份。舊 frontend 可繼續使用原 v1；不以刪 SQL 物件作回滾。
4. 安裝及獨立讀回確認後，才由使用者 Push `main`。Push 包含本分支所有本機領先 commits，而不是只這一個檔案／功能。助理不代 Push。
5. 再核對 remote exact SHA、Pages served version，以及新瀏覽情境的正常登入／讀取。正式寫入測試另取得明確授權，不刷新事故頁、不清本機草稿／pending。

**本機驗收不代表已上線。** 此交接不宣稱正式 SQL 已 Run、已讀回、已 Push 或已部署。前批 Itinerary 航期安裝的獨立 readback 另列待確認，不能用本次 tracking readback 取代。
