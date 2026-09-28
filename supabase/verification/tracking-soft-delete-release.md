# 配件／物料／工程跟蹤：可逆刪除與自然月匯出

## 交付範圍

- 岸端有原編輯權的操作員，可在原可操作船舶範圍內批量刪除、還原、批准或駁回船端申請；不擴大船舶 scope，不額外要求 deleteTasks／closeTasks。
- 刪除是來源項目的獨立可逆狀態，非永久刪除，也不是重分類。獨立「已刪除清單」保留原 ID、分類、日期、歷程及關聯；可混合顯示供應與工程來源。還原已結案來源不重新開案。
- 船端只可申請刪除。岸端批准前，項目仍在正常清單、統計及匯出；駁回可保留結果並再申請。
- 已刪除來源不列入正常跟蹤清單、跟蹤統計或清單 Excel／PDF。關聯內控與要事保留各自業務流程及自身報表，只標示來源已刪除；不連帶刪除、結案或倒帶。
- Excel／PDF 先選開始與結束自然月，與目前船舶、原分頁、搜尋、欄位篩選及選取 IDs 取交集，保留排序及欄序。日期基準為 `applicationDate`（申請／開單日期），不是 DL、到期日、送船日或完工日；「自然月」本身不等於使用者指定了底層日期欄位，介面與報表因此明示本次採用的基準。
- 起訖完整月份、含邊界。預設台北當月；空白、無效、反向或零符合項目拒絕建立輸出，不回退匯出全部。兩個混合類型管理清單不提供清單匯出；原業務分頁仍可匯出待審項目。
- Excel／PDF 共用固定快照；月份、身份、workspace、篩選、選取及欄位變更會使快照失效。保留原報表、XLSM 模板及緊湊 UI。

## SQL 安裝與正式交接

追加 migration：`supabase/migrations/20260928220000_tracking_soft_delete.sql`。

前置鏈（已安裝的舊檔不要重跑）：

1. `20260924160000_tracking_records.sql`
2. `20260925080000_ship_tracking_public.sql`
3. `20260925160000_tracking_field_revision.sql`
4. `20260927130000_tracking_fleet_statistics.sql`
5. `20260928140000_tracking_annual_types.sql`
6. `20260928180000_tracking_reclassification.sql`
7. 本次新增 `20260928220000_tracking_soft_delete.sql`

保留既有 admission、scope、CAS／lease、receipt、SECURITY DEFINER／grants 與統計 v1/v2 協定。以 normalized-LF 函式本文辨認前置及已安裝版本；未知前置零副作用拒絕，不繞過 guard。migration 不重寫既有業務列、不硬刪資料。

操作順序：先安全保存舊編輯器 → 使用者在既有 Supabase 專案執行本次完整 migration → 在另一 query 執行 `supabase/verification/tracking-soft-delete-readback.sql` → 核驗通過再由使用者 Push main → Pages 更新後另行確認正式版本與雲端讀回。

唯讀核驗預期：

```text
status              PASS
checks              11
expected_functions  18
failures            []
```

若安裝錯誤、逾時、結果未知或核驗不符，停止；不要自行重試、刪 guard、Push、刷新或清理草稿。以 commit blob 產生完整 readonly textarea 的 Hermes Preview，使用者自行 Ctrl+C、貼入與 Run；助手不代貼、不用剪貼簿 API、不執行正式 SQL。

## 已執行的本機驗證

**證據層級：真實 UI＋合成測試資料／私有原生 PostgreSQL；不是 hosted Supabase／production 驗收。**

- 核心軟刪除 domain：13 組 PASS。
- 新 UI 行為 gate、既有欄位／分類／統計／表格／緊湊介面／船端／雲端授權／試算表回歸：PASS。
- 原生軟刪除 SQL：LF、CRLF 各 27 組 PASS（相同案例重跑，不合併宣稱 54 個獨立案例）；TS／SQL helper parity 各 36 組。
- 原生前置版本拒絕、重裝、作用域／普通編輯操作員、批次 stale／缺鎖原子性、metadata 偽造、來源與關聯列保留、舊 receipt replay、岸／船晚期 receipt rollback：PASS。
- 原生既有欄位、船隊統計、船端及真實 client 回歸：PASS。installed readback 為上述 PASS／11／18／[]。
- 兩端刪除／申請／駁回／再申請／批准、還原、關聯內控提示、桌面及 390px 手機：PASS；拒絕、失鎖、新理由遇舊 ACK、stale batch／身份 fencing 的組件回呼案例另列，不冒充 SQL。
- 自然月匯出單元／實際檔案 10 組、mounted browser 25 組：PASS。實際下載 5 份 XLSX，生成及解析 5 份 Chromium PDF；排除 markers 不存在。這不是原生 Excel 排版驗收。
- 原試算表瀏覽器與緊湊版面／重新載入歷程 gate：PASS。固定日期 fixture 明確選本身月份；修正兩項 QA 等待／導航前提，保留早期 FAIL，不改產品邏輯：切船須等狀態穩定；reload 須新文件且依既有統計首頁再進清單。
- TypeScript／Vite production build：PASS；保留原大型 chunk warning。`git diff --check`：PASS。
- 最終選定 26 項命令檢查（含 build／完整性檢查，非 26 個 E2E 案例）最新適用結果全部 exit 0。未另聲稱第三方獨立 review。

本機完整收據（含失敗到修復、命令、來源 SHA、原生交易及輸出檔）：

```text
C:/Users/tuotu/AppData/Local/hermes/reports/tracking-soft-delete/final/ACCEPTANCE.json
C:/Users/tuotu/AppData/Local/hermes/reports/tracking-soft-delete/final/1790598480202123300/
C:/Users/tuotu/AppData/Local/hermes/reports/tracking-soft-delete/final/1790598689658840200/
C:/Users/tuotu/AppData/Local/hermes/reports/tracking-soft-delete/final/1790599369539091800/
```

可重跑入口見 package.json：`test:tracking:soft-delete`、`test:tracking:soft-delete:ui`、`test:tracking:export-months`、`test:tracking:soft-delete:native`、`test:tracking:soft-delete:browser`（串行包含岸端與船端）、`test:tracking:soft-delete:component`、`test:tracking:export-months:browser`。原生 runner 需設定 `SHIP_QA_PG_BIN` 與 `SHIP_QA_PG_MODULE`；PDF parser 可用 `QA_PYTHON` 指定。

## 邊界

本機實作／驗證／commit 不代表正式環境已安裝或已發布。助手不代 Push、merge、部署或正式資料寫入；遠端及正式版本仍须分別核對。沒有增設持續試用站、快取架構或帳號綁定方案。
