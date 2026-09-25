# 主站／船端跟蹤欄位修訂

## 使用者可見改動

- 兩端共用表單／清單／欄位設定／搜尋／Excel、PDF、模板及匯入修訂。
- 全部欄位篩選只有下拉條件（多選值、空白／非空白）；文字搜尋沿用既有搜尋框。
- 新增／批量新增／編輯採三行，每行四等分：
  1. 申請單號(材料或工程)、請購案號(非必填)、原項次、申請/開單日期。
  2. 類型、內容摘要/工程內容(必填)、期望完成日期/DL、實際送達/完工日期。
  3. 普通、緊急、補充說明、最新進度。普通／緊急保留原勾選及急件子類；窄螢幕依序折行。
- 類型為維修工程、塢修工程、半年物料、臨時物料、備件；前兩類進工程清單，後三類進材料清單。新批次可同批新增不同類型；已存在項目沿用資料身份規則，只能在同一工程／材料大類內改類型。
- 工程是否完成依有效實際完工日期，不由結案狀態或日期推定；送達／完工、結案、重開分離。
- 多選後可批量更新欄位、送達／完工、結案及重開；每批沿用上限 100、全取／全退、精確確認。
- 取消時提供保留、取消離開、捨棄草稿並關閉。未知提交結果仍須先核對，不可當作未送出的草稿捨棄。
- 退役欄位不再出現在常規欄位設定、填寫模板或專用輸出欄；既有儲存值及舊 Excel 的原始追溯資料保留。來源追溯本身仍可顯示舊檔原值。

## 相容性／範圍

沿用 `referenceNo`、`purchaseNos`；僅新增可缺省的 `requestType`，不猜舊資料細分類、不在讀取時補寫。供料沿用 `actualDeliveryDate`，工程沿用 `completionDate`；不新增資料表或 enum、不改內控分類、不擴張讀取權限。編輯最新進度仍須非空，沿用有效來源→內控→要事同步及歷程規則；基本內控描述與 DL 不被後續來源編輯覆寫。

保留既有來源身份、完整關聯鎖、CAS、私有草稿、未知 ACK 原 operation/payload/signature 與 receipt-first 回復。舊待確認提交不補預設類型，既有完成日期不被結案／重開填寫或清除。

## 一次性正式交接（使用者自行操作）

前提是此專案原有船端跟蹤接口已安裝。本次不重跑舊安裝、08～12 或切換資料來源。

1. **第一步：更新函式。** 在原 Ship Dynamics Supabase 專案、新查詢執行 `supabase/migrations/20260925160000_tracking_field_revision.sql`。預期 `Success. No rows returned`。只更新四個現有函式，不改寫業務列。
2. **第二步：獨立唯讀核驗。** 另開新查詢執行 `supabase/verification/tracking-field-revision-readback.sql`。預期 `PASS / 8 / []`，涵蓋精確已安裝函式與原有 ACL；僅將 CRLF 正規化為 LF。
3. **第三步：Push 前端。** 前兩步均符合預期後，使用者從 GitHub Desktop Push 本次本機 commit。等待 Pages 完成，再由助手核對 remote、正式版本與兩個入口。

Hermes Preview 一次列出兩份完整唯讀 SQL，須比對本機 commit blob。使用者在 SQL 區 Ctrl+A／Ctrl+C，自行貼入 SQL Editor 並 Run；助手不代貼、不使用剪貼簿 API、不執行正式 SQL。錯誤、逾時、不明結果、專案不符或讀回 FAIL：停在該步，保留結果，不重試、不繼續 Push。

這份文件記錄交接程序；有 SQL 檔或本機測試通過，不代表正式 SQL 已執行或網站已部署。

## 可重跑驗證

- `npm run test:tracking:fields`：共用元件／domain、五類與欄位、真實 XLSX 往返及舊檔相容。
- `npm run test:tracking:fields:native`：原生 PostgreSQL 交易、類型白名單、舊提交跨升級精確重播、批量失敗零部分寫入、獨立狀態與 readback；加 `-- --crlf-install` 驗 Windows 換行。
- `npm run test:tracking:fields:browser`：主站及船端真實 UI＋測試資料，三行等寬／手機、五類、多選批量、篩選及捨棄。
- 相關既有 gates：`test:tracking`、`test:tracking:table`、`test:tracking:spreadsheets`、`test:tracking:browser`、`test:tracking:spreadsheet-browser`、`test:ship-tracking`、`test:ship-tracking:native`。
- `npm run typecheck`、一般 build、Pages 子路徑 build。

原生及 UI runner 使用 repo 外 `QA_EVIDENCE_ROOT` 和既有 `SHIP_QA_PG_BIN`／`SHIP_QA_PG_MODULE`；所有可寫測試連到本機合成資料，禁止以正式雲端作試寫環境。正式 Supabase／PostgREST／Pages 的驗收待使用者 Run 與 Push 後另做。
