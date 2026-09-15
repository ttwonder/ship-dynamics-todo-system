# Records 增量資料庫更新包｜本機交付

## 結論與邊界

這次交付的是 **可執行、已在隔離 native PostgreSQL 演練的增量資料庫包**，不是重建資料庫。完整備份依使用者決定不再作為前置；已取得的首包和未提交備份草稿保留，不混入這次 commit。

**正式首次 05 已執行但失敗：`P0001 release-existing-business-rows-changed: ship_dynamics_edit_locks`。尚未 Push／merge／部署；修正版未執行，正式回滾狀態待 05a 唯讀核對。** 不要把本文件或本機 PASS 當成正式切換成功。原 App 本人試用已回報正常，本輪未重跑全站／手機／PDF。`src/`、`public/`、原入口、UI 和 Pages workflow 均未修改。

### 本次錯誤修正

舊安裝包 `77d9e0c` 不可重跑。非空編輯鎖表新增 `lease_version DEFAULT nextval(...)` 會重寫資料列，原先的 CTID/xmin 檢查將這個正常升級誤判成資料改動。先前 fixture 鎖表為空，未涵蓋此情境。已用有效及過期舊鎖重現相同錯誤，再修正為僅該表新增欄位時比較所有原有欄位，另驗新序號正值／唯一；沒有刪鎖、停用 RLS 或取消原資料保護。

目前先執行 **05a_failed_install_readback.sql**，取得新增物件是否存在、目前舊資料 revision/hash／數量及鎖數。`ADDON_MARKERS_ABSENT` 僅表示符合尚未安裝或已撤回狀態，不冒稱已逐筆證實失敗前後資料相等，也不自動授權重跑。核對後才交修正版 05。

目標線索：Supabase `ship-dynamics-todo-system` / `main PRODUCTION`，project ref `cyzpcvvhmoiihsqvjspp`，workspace `ship-dynamics-main`。正式 Run 前仍須核對當前 Dashboard；本包不接受或存放連線密碼。

## 檔案與順序

全部 SQL 在 `supabase/release/`。**不是把此目錄全部 Run。** 00–04 是此前盤點／備份歷史，尤其失敗的 02 不再使用。

| 檔案 | 實際效果 |
|---|---|
| `05_install_record_storage.sql` | 原有 17 個 addon 的有序增量安裝＋最小 browser 入口 ACL；單一交易，沒有 seed/import/切換 |
| `05a_failed_install_readback.sql` | 失敗後獨立唯讀核對；不改資料、不清鎖，不因標記不存在就宣稱完整資料恢復 |
| `06_verify_record_storage.sql` | 新查詢中的獨立唯讀 catalog／API／RLS／舊資料 revision/hash 核對 |
| `07_freeze_latest_legacy.sql` | 讀取執行當下最新 legacy revision/hash 後凍結舊來源保存 |
| `08_pause_business.sql` | 依現有機制排空業務保存，建立新 transition/watermark；已 paused 時拒絕重做 |
| `09_stage_first_records.sql` | 只接受首次尚無 records workspace；由當下凍結資料轉入，target revision/hash 均 NULL |
| `10_publish_records_paused.sql` | 讀回當前 transition 的 exact stage receipt，發布 records 來源，仍保持 paused |
| `11_resume_published_source.sql` | 只恢復当前 published-paused 的 exact publication；必須先核對網站版本／設定 |
| `12_control_readback.sql` | 獨立唯讀 current source/epoch/pause/freeze/revision/hash/stage receipt；不輸出 payload |
| `13_stage_latest_records_back.sql` | 在新 pause 下，把**切換後最新** records 帶回 legacy，不讀舊備份 |
| `14_publish_legacy_paused.sql` | 發布剛剛逆向 stage 的 legacy 來源，仍保持 paused |

生成器：`scripts/build-production-release.py`、`scripts/build-production-control.py`。源檔列表、UTF-8 LF hash、輸出 hash 與順序位於兩份 release manifest。來源 addon 的 development 歷史註解保留；正式交付入口是 **05 原子包**，不可改成逐一貼 addon。

## 安裝保證與限制

- 原有 58 張 app 表在短暫 DDL 維護交易內鎖定。其餘表維持 count＋ctid/xmin 小型向量；只有編輯鎖表原本沒有 lease_version 時，改核對所有原欄位的完整值與筆數，排除預期新增欄位並驗其正值／唯一。若欄位原已存在，仍保留原實體向量檢查。
- 不排序或匯出完整歷史 JSON，不放過刪除／覆寫鎖定者等真變動。任何例外整筆 rollback；末端注入錯誤驗證新表／schema 撤回、原紀錄完整。
- 已有 records 表、錯誤 workspace binding、不可信 public schema CREATE 權限、API 簽名不符等均中止。05 是首次安裝包，不是無限 rerun migration。
- 維持舊 27 個 browser RPC，新增 25 個明確入口；52 個名稱／型別／命名參數逐一核對。22 個原 INVOKER 入口不能只 grant EXECUTE，須限定入口 DEFINER＋固定 search_path，底層新資料表不開 browser CRUD，operator/private helpers 不開 browser。
- 原 custom login 使用 anon；authenticated 維持等價 capability。沒有改成 Supabase Auth 身份綁定，也沒有宣稱全包讀取已按 actor 分隔。
- 既有 `read_ship_dynamics_delta_v1(text, integer, text)` 不在正式 223 函式或這 17 檔；不盲授權或啟用 legacy delta 路徑。
- 正式鎖等待 5 秒、statement timeout 45 秒；超時就停，不能把本機耗時當正式保證。

## 先前已完成、此次沿用的兩項相容修正

native predecessor 首次安裝真實重現兩項中止：

1. `source-authority-wrapper-declaration-mismatch`：正式既有兩個 Itinerary wrapper 保留 CRLF，原 splice 只認 LF。現在只依實際 DECLARE 換行插入 guard，不整段正規化業務字串。
2. `ship_dynamics_run_daily_morning_snapshots()` 不存在：此前 QA fixture 裝有此 legacy scheduler，正式 catalog 沒有。現在不存在就不替它安裝／排程；存在仍須精確 splice，未知 body 仍中止。新 records scheduler 的既有 addon 不變。

只改 `20260911_source_authority_publication.sql` 的上述相容部分；沒有為了通過 fixture 重建正式前置或改業務函式 body。

## 本機證據（層次分開）

- **前置 metadata 對照**：58 表、521 columns、335 constraints、94 indexes、13 triggers、223 函式；函式本文綁定已知 Git 來源。空 schema fixture，不帶正式業務資料，records 表未安裝。
- **修正版首次增量／交付檔演練**：`verify-production-release-native.mjs` 12 個案例 PASS。有效及過期舊鎖非空起跑；真改鎖定者／錯誤新序號仍拒絕並撤回。實際執行 05、06、07–14；首次前以 anon 進行新的 legacy 保存，承接較新版本而非初始 fixture。實際 anon member 保存／receipt PASS，再逆向轉回並確認新修改保留。原正式 Itinerary、備選與已存報告歷史逐值保持。
- **失敗狀態唯讀核對**：`verify-release-failure-readback-native.mjs` 3 項 PASS，包含未安裝、部分新增物件、READ ONLY 拒絕注入修改；不回傳鎖持有人或業務本文。
- **相關既有往返回歸**：`verify-source-roundtrip-native.mjs` 15 個案例 PASS，包含安裝時有 legacy scheduler 的分支、舊目標已存在、角色／錯誤 proof／晚端 rollback／排空與 exact replay。
- **包裝檢查**：`verify-production-release-package.py` 11 項 PASS；control generator `--check` PASS。這不是 11 個 E2E。

私有證據存放 `ship-release-predecessor` cache，未提交 Git。本次同症狀 RED：`release-native-HcfRHp/receipt.json`；修正後 GREEN：`release-native-5SPApV/receipt.json`；唯讀核對：`failure-readback-4u8koo/receipt.json`。原有往返回歸 `legacy-roundtrip-regression/roundtrip-native-JWP3c3/receipt.json` 的 17 個 addon bytes 未改，未重跑；舊空鎖表通過收據 `release-native-VTG9Xb/receipt.json` 僅保留為歷史，不再作非空升級證據。所有此前 FAIL 都保留。

Native PG 17.11；正式先前盤點 PG 17.6。本機 provider 模擬含最小 auth.uid/users、角色、空 publication；**沒有真 hosted Auth/PostgREST/Realtime/pg_cron 證據**。未主張完整 ACL grantor/policy/sequence options 或 publication membership 等同正式。已驗新 API role 執行與禁止 browser control/table access，不等全部 hosted RPC 網路路徑通過。

重現命令（須先設好本機 `SHIP_QA_PG_BIN`、`SHIP_QA_PG_MODULE`、私有 `QA_PREDECESSOR_MODULE`；不接受 production URL）：

```sh
python -B scripts/build-production-release.py --check
python -B scripts/build-production-control.py --check
python -B scripts/verify-production-release-package.py
node scripts/verify-production-release-native.mjs
```

## 正式交接：一次只走眼前的關卡

1. 核對當前 Supabase 專案及角色，安排本次安裝的短暫停止保存。之前曾通知停錄，不等於現在仍停錄，也不是 server freeze 的證明。
   本次已有失敗回報，先由使用者在新查詢 Run 05a 並交原 CSV，核對當前狀態後才進修正版 05。
2. Hermes Preview 顯示經 commit blob 核對的 **05 全文 readonly textarea**。使用者 Ctrl+A／Ctrl+C，貼入新 SQL Editor query，自行 Run；助手不代貼、不用剪貼簿 API、不執行正式 SQL。
3. 不論畫面只有 Success 或空 Results，都不重 Run 05；改交 **06 獨立唯讀**並核原始回傳。若 05 明確失敗或 outcome 不明，先診斷當前物件，不能直接進切換。
4. 核對通過後才決定切換時窗，逐步 07 → 08 → 09 → 12。**07 之後 legacy 保存已凍結，08 之後業務保存 paused。** 每步使用新的交易，結果和當前状态分開。
5. 10 發布仍 paused；12 核對 source/epoch、stage binding。**網站版本／runtime 設定與新來源相容、使用者決定 Push／部署後，才另行執行 11 恢復。** 這是決策界線，不能把 manifest 次序當自動腳本。
6. 11 後再 12＋正式原網站登入／保存／重新讀回與同步驗收。readback 的 stage hash 是歷史證據，resume 後的新保存可以合法改變 current hash；不要為追求舊 hash 相等而覆回。

### 仍開放的前端啟用關卡

目前 `public/supabase-config.js` 未明設 storageMode/readMode；`src/cloudSourceAuthority.ts:authorityConfig` 對 managed binding 強制 snapshot。原試用站的 records/scoped 設定不能當成正式 asset 已啟用。**本資料庫包完成，不等於已宣告所有正式定向讀存路徑啟用。** 在正式 source publication／Push 前必須核對當前 client route/設定，必要時另作保持 UI 的最小接線及定點驗證；不得直接用這次 DB commit 宣稱可一口氣 Push。這不阻止先交付經驗證的 additive installer。

## 回退與錯誤停止

- 不做舊 snapshot 回灌。切換後若要回舊程式：08 新 pause → 13 最新 records 回轉 → 12 核對 → 14 發布 legacy 但 paused → 核對相容舊網站版本 → 11 → 12。Push／回退部署及 SQL 都另由使用者決定。
- 任一步 ERROR、timeout、未知 ACK：**停在當前狀態**，不改 request ID、不刷新清草稿、不盲 Run 後一步。12 用於安裝已確認後的 operator state 讀回；若 05 安裝失敗，先用 05a 核對，而非呼叫不存在的 controls。
- 只按 Git 回舊版本不會還原 DB；本機往返 PASS 不保證任意資料損壞都可復原。已接受不完整 backup 的風險保持可見，不重新強迫做數百次手動備份。
