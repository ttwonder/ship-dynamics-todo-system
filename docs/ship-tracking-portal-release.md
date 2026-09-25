# 船端配件／物料／工程跟蹤分頁

## 本次交付

- 正式獨立入口：`packageorwork-tracking.html`；免登入選擇有效船舶，船名採中文＋英文，無中文則只顯示英文。
- 船岸共用原有 records 資料，不另存第二套清單；保留岸端主頁入口。
- 支援新增／批量新增、編輯、逐筆／批量進度與歷程、送船確認／更正、結案、重開、結案日期更正、同步內控、Excel 導入／模板及 Excel、PDF 匯出。
- 船端不顯示要事或岸端管理操作。同步內控必填「報告人姓名＋職務」，附在每筆內文；既有有效關聯由後端同步，送船與結案仍是不同狀態。
- 先取得整組編輯權再編輯；每批最多 100 項，全取或全退。失鎖留稿；未收到可靠確認時，保留原提交並精確核對，不另建重複資料。
- 原急件類型、岸端操作、既有船端內控的只新增規則均保留。

選船只是操作範圍，不是身分驗證；能取得此網址的人可選擇有效船舶並操作其跟蹤資料。後端只回傳該船跟蹤及直接有效關聯的內控資料，不回傳完整工作區、帳戶／密碼、要事或會議。

## 正式上線順序（使用者執行）

分頁上線後網址：
`https://ttwonder.github.io/ship-dynamics-todo-system/packageorwork-tracking.html`

1. **安裝新增接口**：在原主頁使用的 Supabase 專案執行 `supabase/migrations/20260925080000_ship_tracking_public.sql`。只新增專用接口及私有編輯鎖組，不搬移既有業務資料、不修改一般 records RPC 權限、不切換資料來源。
2. **獨立唯讀核驗**：另開查詢執行 `supabase/verification/ship-tracking-public-readback.sql`。預期唯一結果為 `status=PASS`、`checks=8`、`failures=[]`；核對實際安裝函式定義與權限。
3. **Push**：前兩步均符合預期後，使用者從 GitHub Desktop Push 此次本機 commit。等待 Pages 部署完成，再比對遠端 SHA、正式版本及新網址；本機 build 或 SQL 成功均不等於已上線。

Hermes Preview 會一次提供前兩步完整唯讀 SQL，從本機 commit blob 提取並核對。使用者自行 Ctrl+A／Ctrl+C、貼入全新 SQL Editor 查詢、按 Run；助手不操作剪貼簿、不代貼或代 Run。

若錯誤、逾時、讀回 FAIL 或專案不符，停在該步並保留結果，不重試、不重跑以前的 08～12，不刷新／清除歷史事故頁或草稿。這次不需停用正式資料來源，也不提供預設的隔離試用網站。

## 已完成的本機驗證

所有可寫測試使用 **真實 UI＋合成資料＋本機原生 PostgreSQL**，未操作正式業務資料。

| 層級 | 結果 |
|---|---|
| 新船端原生 SQL | 11 個命名案例 PASS；含安裝重入且舊函式／權限／資料不變、唯讀核驗、單船範圍、合法／非法命令、來源／內控／既有關聯同步、批量原子性、編輯鎖與重播 |
| 新 client＋HTTP＋原生 SQL | 5 個命名案例 PASS；含精確確認、重新開頁核對、不完整回覆、未執行且鎖過期、設定切換及本機儲存失敗 |
| 新船端瀏覽器 | 8 個案例 PASS；含獨立免登入入口、實際保存／刷新恢復、必填報告人、被拒新增恢復、真實模板下載再導入、XLSX／PDF 內容及手機排版 |
| 船岸多瀏覽器 | 3 個案例 PASS；真實岸端 App 可讀回船端新增、互相阻擋編輯、真實續租失敗後同一編輯節點保留輸入並重新核對 |
| 原岸端 UI／元件 | 24 個既有案例 PASS（包括原生 SQL 流程及元件測試，非全部為 E2E） |
| 原岸端完整編輯鎖入口 | 10 個既有案例 PASS |
| 其他受影響回歸 | 跟蹤 workflow／commands／內控同步、表格、Excel、原船端內控 client、revision polling、船岸呈現區分均 PASS |
| TypeScript＋build | 一般路徑及 `/ship-dynamics-todo-system/` 子路徑 build PASS；新 HTML 及其全部引用資源本機 HTTP 200 |

瀏覽器與資料庫測試均保留原始日誌和具名案例；測試程序已停止。這是有限範圍本機驗收，不宣稱已完成正式 Supabase、PostgREST 快取、Pages 或真實船員使用驗收，也不宣稱取得新獨立代理審查通過。

可重跑入口：`npm run test:ship-tracking`、`npm run test:ship-tracking:native`、`npm run test:ship-tracking:browser`、`npm run test:ship-tracking:multiuser`。原生及瀏覽器 runner 需要既有本機 QA 工具與 repo 外的 `QA_EVIDENCE_ROOT`；PDF 內容核驗使用 `python3` 的 `pypdf`。不以 production 作測試環境。
