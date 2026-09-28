# 跟蹤項目「修正分類」上線交付

## 功能與保留邊界

- 岸端／船端清單勾選 1–100 筆後，可用「修正分類」一次指定一個目標類型，跨工程與配件／物料就地更正，不刪除重建。
- 普通編輯／批量更新仍只修改目前大類內的細分類。結案項目先重開；既有建立、編輯、結案權限不變。
- 保留原 ID、建立資料、原類別日期、進度與歷程。目標實際日期預填目標類別原有日期，不把完工日期自動轉為送達日期；日期仍按既有有效日期規則核對，不另加申請日期先後限制。
- 更正來源類型標示與相關歷程，清單、統計、年檢到期圖表、Excel／PDF 使用已確認的新分類。內控／要事的人工文字、獨立分類、獨立期限及原關係保留；僅精確更新來源生成的類型／日期行。
- 原子保存涵蓋來源及其既有關聯；任何一筆版本、鎖、權限或資料不符，整批拒絕。未知結果以原提交重試，不生成重複歷程；重試前後新輸入仍保留為未提交草稿。
- 船端不新增要事操作或暴露岸端專用控制。

## 安装類型與前置版本

此為既有 records / public tracking 的 forward migration；不批量重寫業務資料、不建立替代資料庫、不改匿名船端模式。

必須已安裝上一版 `20260928140000_tracking_annual_types.sql` 及其前置链。本次會核對 validator、plan、submit 的已知函數版本；未知或欠缺版本會在同一交易內拒絕，不能靠刪掉 guard 強行安裝。

SQL 安裝先於前端 Push。新版岸端的分類編輯會提交分類事件，因此安裝與前端更新應在同一上線窗口完成；舊岸端頁在此期間修改細分類可能被拒絕。先完成原有保存，再關閉舊頁；不要清除含未保存草稿或未知提交的瀏覽器儲存。

## 使用者一次完成的順序

目標：目前專案 runtime config 所指的 Supabase `cyzpcvvhmoiihsqvjspp`；確認 Dashboard 專案、正式環境、Primary Database、SQL Editor 執行角色為 postgres。

1. 從 Hermes Preview 第 1 個唯讀文字框全選並自行 Ctrl+C，貼到一個新的 SQL Editor query。檔案：
   `supabase/migrations/20260928180000_tracking_reclassification.sql`
   只按一次 Run。正常結果為 Success / no rows returned。若出現 prerequisite / predecessor mismatch、錯誤、逾時或結果未知，停止，不重跑、不 Push，保留 Results。
2. 成功後直接開另一個空白 query，使用 Preview 第 2 個文字框的完整核驗 SQL：
   `supabase/verification/tracking-reclassification-readback.sql`
   這是唯讀，不更改業務資料。期望一列：`status = PASS`、`checks = 9`、`failures = []`。不需在正常兩步之間等待聊天批准；最後保留或回傳核驗結果即可。
3. 僅在上述核驗符合後，從 GitHub Desktop 的既有專案資料夾 `E:\Projects\ship-dynamics-save-feedback-push` Push `main`。不要另 clone 或切換到同名副本。
4. 等待 GitHub Pages 的本次 commit 部署成功，再於已安全保存／關閉舊編輯器後開啟新版。以 `app-version.json` 對照 commit；正式站的保存／讀回尚需真實操作驗收，不能以本機 PASS 替代。

若上版年檢 SQL 是否已安裝不確定，不要任意重新執行舊 migration：本次 predecessor guard 出錯時應先檢視結果，而不是修改 SQL 或降級函數。若需要退回前端，保留 additive SQL，先停止分類修改；不要用舊函數定義覆蓋已產生分類歷程的新資料。

## 本機實際驗證

所有 QA 均為 **真實程式／原 UI＋測試資料＋本機 PostgreSQL**，不是正式 Supabase。

- `npm run test:tracking:reclassification`：domain 8 組、UI/command 7 組、client serialization 2 組。
- `npm run test:tracking:reclassification:native`：22 組；含已知版本前置 guard、重複安裝、LF／CRLF、TS／SQL 描述同步、三方原子保存、CAS／鎖／權限拒絕、回滾、重播及讀回。
- `npm run test:tracking:fields:native`、`npm run test:tracking:statistics:native`、`npm run test:ship-tracking:native`：均已接上最新 migration 並通過。
- 岸端、船端 `--reclassify` 真實 browser 各 8 個場景（含各自 3 個共用入口／建立前置場景，不與其他模式重複相加）；desktop / 390px mobile、選取原子性、日期核對、結案重開、lost-ACK 重播。
- 岸端、船端 `--fields` browser 回歸通過；船端同一模式也驗證下載模板、實際匯入及真實 XLSX／PDF 輸出。
- 既有 `test:tracking`、`test:tracking:fields`、`test:tracking:statistics`、`test:tracking:table`、`test:ship-tracking`、production build、diff check 通過。
- Build 僅保留既有的大 chunk 警告，無編譯錯誤。

收尾修復僅涉及原日期規則對齊及 QA：分類 UI 不新增日期先後規則；內控歷程須從完整權威讀回驗證而非船端精簡投影；並行 QA 使用獨立 HMR port，避免相互干擾。所有業務拒絕、console error、外部請求與 atomicity 斷言保留。

## 證據邊界

本機測試、畫面檢視與 commit 可完成推送準備；未代為執行正式 SQL、Push 或部署。此次採主代理整合核對與實際回歸，未另啟全量獨立 review。正式 SQL 核驗與部署 SHA 是後續獨立證據，不宣稱已完成。
