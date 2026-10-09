# 每日早會保存修復：本機交付與正式核驗

## 本次交付：解除早會保存的不必要全量讀取依賴

**這一輪只有前端與測試修正，不需要新增 SQL，也不要重跑已 PASS 的 tracking／reader migration。本機通過仍不等於正式恢復。**

### 已確認的失敗與 9/30 對照

- 正式畫面已是第二版前置錯誤文案：`每日早會快照未建立（保存前讀取／同步準備失敗）`，錯誤為 `canceling statement due to statement timeout | code: 57014`。
- 使用者已確認第二版 reader SQL 核驗 PASS。安裝 PASS 只證明函式／權限，不證明 runtime 可在時限內完成。
- 暫停前的限定正式唯讀對照：authority／home 成功；相同 reader 的 home→full 與空 versions 冷 full 都為 HTTP 500／57014；相同 revision 的完整早會現況＋必要基準讀取為 HTTP 200。沒有正式寫入，沒有碰原瀏覽器或清草稿。
- 唯讀快照中 `daily-morning-2026-09-30` 為 manual，完整 frozen snapshot 存在，`capturedAt=2026-09-30T00:33:57.866Z`。其中 1,102 筆 tracking 的 createdAt 有 263 筆在 9/30 或以前、839 筆在其後；這是資料時間分布，不是單凭它證明正式唯一根因。
- 最後 9/30 前的本機版本 `17e32234abeb9e1a5edf8cf0050f4c2802c88f7a` 與修復前 `ba07a5a015a537355ed50437232feeba0ef1060e`，`src/cloud.ts`／`src/cloudRecordScopes.ts`／`src/morningHistory.ts` 的 Git blob SHA-256 相同；原 App 已在建立早會快照前要求 full。沒有證據把這次故障歸因於某個後續新增的 reader commit。資料增長暴露舊 full 瓶頸仍屬合理推論，沒有 hosted query plan 佐證。
- 旁邊手動 Itinerary 保存由 `ManualItineraryReportSaveButton` → authority capture → `saveManualItineraryDailyReport` → 專用 Itinerary report RPC 執行，不走這個早會 full prerequisite。因此 Itinerary 正常不等於早會 full 可用。

### 最小修正與保留契約

1. 原早會保存前置改用既有 reader 的 `{morning:true,targets:[],morningSaveAt:at}`。home 發現 IDs／選擇 metadata 後，仍取得全部完整 tasks／internalControlCases／meetings、必要關聯、同日既有報告與符合原 cutoff 的前一份 manual baseline；不是拿兩筆摘要當完整資料保存。
2. `dailyMorningSaveReadReports` 沿用原每日 upsert 的日期、manual cutoff、排除同日 report ID 和 previous-manual 規則；`morningSaveAt` 隨 scope union 保留。讀取需 home/detail revision 一致；原 bounded retry、完整 coverage／raw-cache guard、actor/session/config/authority fences 不變。
3. 原 `upsertDailyMorningReport`、正式 Itinerary refresh、writer／CAS／receipt、matching report ID＋capturedAt 的權威回讀與成功發布不變。同日更新沿用原凍結內容，不重定義每日規則，不刪舊快照、不裁切業務歷史或備選行程。
4. 前置失敗沿用既有 `clearStaleSaveSuccessToast`，只撤下上一次成功提醒；警告／錯誤不清除，stale action 不影響後任提示。避免新的紅色失败狀態與舊「已保存到雲端」同時呈現。
5. 沒有新 RPC／SQL／grant／timeout 變更，UI／角色／保存按鈕與使用方式不變。這不是全站 full reader 性能已恢復的聲明。

### 本次本機驗證（各層不加總成正式 E2E）

| 層級 | 結果 | 範圍 |
|---|---|---|
| 原 App callbacks＋受控 queue I/O | 14/14 PASS | 前置不依賴 full、失敗零寫入、精確 retry、unknown／confirmed-result fence、撤舊 success 並保 warnings/errors/stale successor |
| 真實 client adapter＋本機隔離 SQL/HTTP | 9/9 PASS | 完整 current histories／raw fields、同日＋前基準、隔日基準、指定 cutoff 非 wall clock、summary write guard；v1 相同 9 案另作相容 control，不計為 18 個不同案例 |
| 原 UI＋本機原生 PostgreSQL＋測試資料 | 7/7 PASS | full 被設定逾時仍完整保存；BEFORE SQL 原完整 helper oracle 相同；3 份舊報告及原 value/revision/xmin/ctid 保留；正式 Itinerary revision 7＋legacy fallback、不投影備選；前置/寫入57014、header retry、重新開頁歷史 |

- UI 故障注入為 private PostgreSQL 真實 SQLSTATE 57014，受控交易回滾，不冒充正式負載自然 timeout。頁面均標「真實 UI＋測試資料」。
- 保留先前 callback／adapter RED、原 UI QA formal-document 預期錯誤的 FAIL，以及 success-toast overlap 的 RED；沒有放寬產品／資料 oracle 來獲得 PASS。
- `test:daily-morning-save` 的錯誤分類、snapshot privacy、台北 09:00 排程，以及 typecheck／production build／diff check 通過。大 chunk 警告是既有警告，未擴張重構。
- 收據 input hashes 已對執行 bytes 核對；原生 PG／HTTP／Chrome 及其 ports 停止。隔離 adapter 內含 SQL runtime，不能稱為 mounted UI／hosted 證據。
- 本輪未另開全量獨立 review；完成最小 diff 自審與受影響測試，不宣稱獨立整體批准。敏感雲端資料／credentials／QA 產物均不進 repo。

重跑（環境參數同本文件後段）：

```bash
npm run test:daily-morning-save
QA_EVIDENCE_ROOT=<repo外絕對路徑> node scripts/verify-record-scope-cache.mjs
QA_EVIDENCE_ROOT=<另一個repo外絕對路徑> node scripts/verify-record-scope-cache.mjs --v1
npm run test:daily-morning-save:browser
npm run typecheck
npm run build
```

### 這次的使用者交接：Push 前端，不重跑 SQL

1. 使用者自行 Push 本次已驗證本機 commit；助手未 Push／部署／正式 SQL，GitHub Pages 更新狀態與正式讀回另算。
2. **保留原可能未保存的頁籤與草稿，不清 storage、不盲目刷新／同步舊頁。** Pages 版本核對後，用不覆蓋原草稿的新頁驗證原手動早會保存一次；這是正式資料寫入，仍由使用者決定。
3. 當次成功須同時有當次 report ID／capturedAt 的權威回讀和原歷史頁確認，舊成功提醒、歷史總數或 SQL catalog PASS 不算。若錯誤或結果未知，保留訊息、版本與當次識別，先查結果，不連按重試。
4. **不要把 full RPC 能否恢復作為這次修正已發布的判斷**：本次就是解除早會對無關全量歷史／跟蹤讀取的依賴；其他需要 full 的功能未在這裡聲稱恢復。

---

## 第二版歷史：保存前完整讀取 SQL 改善（581f734）

以下為已交付第二版的歷史紀錄。其 reader SQL 已由使用者核驗 PASS，但正式 full runtime 仍逾時；**下面的安裝步驟已被本文件最上方「本次交付」取代，不能據此再跑 SQL。**

**本機修正與驗證不等於正式恢復。** 第一版 tracking validator 修正已由使用者在正式端安裝並得到 PASS；不重跑它。其後的限定唯讀採樣顯示 browser authority RPC 正常回應，而 `read_ship_dynamics_record_scopes_v2` 的 full read 回傳 HTTP 500／SQLSTATE `57014`。這證明 reader 仍有逾時，不證明正式 query plan、work_mem 或所有保存當下的 authority／先行 flush 狀態。

### 最小變更

- `20261009060000_record_reader_inline_bodies.sql` 僅將有效 v2 函式的 `with bodies as (` 改成 `with bodies as not materialized (`。不縮減 full scope、完整 IDs、版本比較、tracking membership、現況或凍結歷史；不改 writer、timeout、資料或 grant。
- 已在原生 PostgreSQL 的中性資料、低 `work_mem` 探針中定位寬 CTE 暫存／重掃成本：`bodies` CTE scan 由 2 個變成 0 個。這是可重現的 excess-work RED→GREEN，不是本機自然逾時或 hosted 根因完全證實；本機正常 full read 本來就能完成。
- 僅允許已知 predecessor 的正規化 prosrc MD5 `29a16b82cf452a72736a10448182e607`；安裝後須為 `ff3316f9b90469a0f41cad81082f531f`。CRLF 正規化、同版 rerun、OID／ACL／security／settings 保留及未知來源拒絕均有原生驗證。
- 前置準備失敗改用明確訊息「每日早會快照未建立（保存前讀取／同步準備失敗）」並將頁首保存條設為失敗。此階段可能先 flush，所以不直接把所有失敗說成只有讀取 RPC。
- 若前置準備明確取消且沒有 unknown／confirmed-refresh outcome，保留重新準備 intent。頁首「重新保存」會重新取得 full scope 並建立新的當次快照；尚未建立快照時不得重送不存在的候選、或僅比較舊資料報「已是最新」。既有 writer 明確取消仍精確重送原 report、原合併基線；身份／scope fence、unknown outcome 與權威回讀規則不變。

### 本次驗證與限制

| 層級 | 結果 | 本次涵蓋 |
|---|---|---|
| 原 App callbacks＋受控 queue I/O | 12/12 PASS | 原 9 案、前置階段訊息／零寫入、重新準備、unknown／confirmed flush 不盲重試 |
| 原生 PostgreSQL＋中性完整讀取資料 | 5/5 PASS | 移除寬 CTE 暫存、完整冷／暖讀回與歷史語意、home／targets／版本型態 parity、原物理 rows／ACL／OID 不變、rerun 與未知 predecessor 拒絕 |
| 原 UI＋原生 PostgreSQL＋測試資料 | 6/6 PASS | 原早會工作台「保存今日早會」的前置逾時與零 report writer、頁首重新準備後權威確認、報告中心原手動保存、writer 取消／精確重試、重新開頁歷史 |

- UI 故障注入使用本機 PostgreSQL 產生的真實 `57014`，透過 HTTP／SQL error channel 在受控交易邊界回滾；不是正式負載自然逾時重現。所有畫面均標示「真實 UI＋測試資料」。
- 沿用 private bridge 的執行者為 `ship_qa`；原生 catalog 中 anon／authenticated 未授權，因此 local readback 的整體狀態為 `REQUIRES_REVIEW`，但精確函式與 security mode 正確。**沒有為了顯示 PASS 增加 grant。** RSP04 檢查原 ACL 完全未變；正式瀏覽器 role 的安裝核驗仍由正式唯讀查詢判定。
- 正式 readback 要求目前 browser 使用的 anon 可執行；authenticated 權限另列資訊，不強制補齊。v2 原本獨立繼承各角色的 v1 grant，缺少 authenticated 不是需增加權限的證據。
- `test:daily-morning-save` 的錯誤分類、privacy／09:00 排程及 typecheck／production build 通過。既有大 chunk 警告保留，不擴大架構改動。
- 本次沒有另開全量獨立 review；先前子代理為有效來源鏈的唯讀分析，不冒稱獨立整體批准。證據、錯誤嘗試與 input hashes 存在 repo 外；不提交真實 payload、認證資訊或 QA 產物。

新增重跑命令（使用下方同樣的三個原生 QA 環境參數）：

```bash
npm run test:daily-morning-save:preflight-native
# 只重現舊版暫存成本，RSP01 應 FAIL；不更動 canonical 檔案。
npm run test:daily-morning-save:preflight-native -- --before-upgrade
npm run test:daily-morning-save
npm run test:daily-morning-save:browser
npm run typecheck
npm run build
```

### 正式交接：這次是新 reader 修正，與舊 tracking PASS 分開

**先保留可能未保存的原頁籤／草稿。** 不清 storage，不刷新／同步舊頁，也不要在結果未知时連續重試。SQL 不包含業務資料修補或權限啟用／切換。

1. 在已確認的正式 Supabase 專案（目前 Dashboard 為 `ship-dynamics-todo-system`、`main`／`PRODUCTION`；若不同即停）建立全新 query。從本次 commit 的 Preview 唯讀 textarea 用手動 Ctrl+A／Ctrl+C 複製 `supabase/verification/record-reader-inline-readback.sql`，單獨執行。
2. 結果處理：
   - `PASS`：精確 inline reader＋原預期 execution mode＋anon 可讀；跳過 install。
   - `REQUIRES_INSTALL`：精確已知 predecessor 與正常 anon 讀取能力，才符合下個步驟的本機測試前提。
   - `REQUIRES_REVIEW`、SQL 錯誤、目標不符或結果未知：立即停止；保留 Results，不重跑／補 grant／調高 timeout。
3. **只有使用者決定安裝，且第 2 步是 REQUIRES_INSTALL**，才在另一全新 query 執行完整 `supabase/migrations/20261009060000_record_reader_inline_bodies.sql` 一次。這是 guarded `CREATE OR REPLACE` 既有讀取函式，不含資料 DML、刪除、authority 切換、grant 或參數變更。執行仍是正式 schema 寫入；助手不代貼、不用 clipboard API、不代 Run。
4. 確定沒有執行錯誤後，在獨立 query 重跑第 1 步的唯讀 SQL；必須 `PASS`。安裝結果未知或錯誤时先停止，不能盲重跑。正常三步可連續操作，不需要每步回 chat；請保留各步 Results 並回傳最後結果一次。
5. 使用者 Push 本次本機 commit；Pages 的 commit／assets 必須對應新版本。新 SQL 不依賴前端 deployment，可先安裝並核验，再 Push。新前端也維持相同 RPC signature，但單獨 Push 不會解決尚未安裝的 reader 成本。
6. 正式恢復驗證另做：先用不覆蓋原草稿的新頁核對目前版本與 full read；只有讀取與部署核對正常、且使用者決定重試後，才走原 UI 保存一次。以本次 report ID／capturedAt 的權威回讀和歷史確認為準，不能用舊「已保存」或 catalog PASS 當成本次保存成功。

交付終點是**已驗證的本機 commit，可供使用者 Push**；助手未 Push、未部署、未執行正式 SQL。正式 reader 安裝、runtime 效果及本次早會保存恢復仍待上述操作與回讀。

---

## 第一版歷史：tracking writer fast path（3ee0fe1）

以下為第一版原始驗證與交接紀錄；目前 reader 修復及 12／5／6 個案例以本文件上半部為準。第一版正式安裝已被使用者的 PASS 確認，**不再次執行下面的舊 migration**。

## 範圍

保持原 UI、歷史凍結快照與每日保存規則；不刪歷史、不調高全域 statement timeout、不增加資料庫權限。正式資料、Push、部署與 SQL 執行仍由使用者決定。

- 錯誤提示沿用 canonical `cloudErrorMessage`，保留 SQLSTATE／真正訊息，不再顯示 `[object Object]`。
- 明確資料庫取消（57014）後，在原頁面記憶體保留未呈現的早會候選、原合併基線及 authority。原手動按鈕／頁首重新保存可重送；身份、工作區或頁面範圍失效不得沿用。這不是跨重新載入的 durable pending store。
- 已確認提交但回讀未完成、或提交结果仍未知，不當成明確取消而建立上述 retry。
- 僅通過原 coordinator 且讀回含本次 report ID／capturedAt 才發布成功。不存在新快照時，不得只比較舊可見資料而顯示「已是最新」。
- SQL fast path 只對不含 trackingItems／internalControlCases／tasks entity 變更的 patch，跳過無關 tracking 驗證。涉及其中任一 collection 仍完整執行既有 validator；其餘 writer 的 actor、CAS、audit、receipt 與歷史規則未改。

## 資料大小與證據界線

本次唯讀雲端資料的未壓縮 JSON：32 份含 snapshot 的 report 約 67.6–260.3 KB，中位數 138.9 KB；資料檔整包約 7.49 MB，包含全部集合和歷史，而非單份早會。報告快照須保留當時內容，未因此裁切歷史。

在原生本機 PostgreSQL、1,102 筆 tracking fixture 中，舊 validator 對 report＋audit 仍作 2,204 次無關 prospective lookup；前向修正後為 0。這是已重現的額外成本，不等於正式 Supabase 已恢復或 hosted 57014 只有這一原因。

## 已通過的本機驗證

各層分開計數，不加總成正式 E2E：

| 層級 | 結果 | 覆蓋 |
|---|---|---|
| 原 App callbacks＋受控 queue I/O | 9/9 PASS | 真實錯誤字串、ACK 回讀、原基線重試、身份過期及 unknown／confirmed-result 排除 |
| 原生 PostgreSQL＋測試資料 | 8/8 PASS | 無關 lookup 為 0、真實保存／回讀／replay、歷史／CAS、三個相關 collection 不跳驗、未知 predecessor fail closed |
| 原 UI＋原生 PostgreSQL＋測試資料 | 4/4 PASS | 手動保存、真實 SQLSTATE 57014 全交易回滾、不誤報、頁首重試精確原候選、重開頁讀回歷史 |
| 既有完工結案 contracts | 7/7 PASS | 保留原相關規則與 payload |

`test:daily-morning-save`（含錯誤分類與早會 privacy／排程 contracts）、typecheck、production build、diff check 通過。Build 原有大 chunk 警告仍存在，不是本次架構調整範圍。未要求新一輪独立全量審查。瀏覽器 QA 的產品與 harness 7 個輸入 hashes 已與目前檔案核對；本機 Chrome／HTTP／PostgreSQL ports 均已停止。證據與失敗嘗試保留於 repository 外，不提交真實資料或憑證。

## 重跑命令

```bash
npm run test:daily-morning-save
npm run test:tracking:completion-close
npm run typecheck
npm run build
```

原生與瀏覽器測試要求三個顯式環境參數；不能指向正式資料庫：

- `QA_EVIDENCE_ROOT`：repository 外的絕對 scratch 路徑。
- `SHIP_QA_PG_BIN`：已驗證本機 PostgreSQL bin 的絕對路徑。
- `SHIP_QA_PG_MODULE`：實際 pg Node client module 的絕對路徑。

```bash
npm run test:daily-morning-save:native
npm run test:daily-morning-save:browser
```

缺參數只代表 harness 前置条件未滿足，不是產品回歸。runner 建立全新 loopback cluster、拒絕 connection string，並驗證自己建立的 data directory／ports；不重用正式資料。

## 正式雲端：先唯讀，後決定

1. 使用對應正式 Supabase 專案的 SQL Editor，先手動複製完整 `supabase/verification/tracking-unrelated-patch-readback.sql`。它只讀 catalog，不含工作區內容／憑證，不改資料。
2. 只執行這一份唯讀核驗，核對 Results：
   - `PASS`：已是精確修正版，毋須重跑 migration。
   - `REQUIRES_INSTALL`：精確符合已測的舊 validator，才具備套用前提；先確認再執行修正。
   - `REQUIRES_REVIEW` 或查詢錯誤：停止，核對雲端實際版本，不嘗試強制套用或提高 timeout。
3. 條件修正為 `supabase/migrations/20261008090000_tracking_unrelated_patch_fast_path.sql`。它有完整交易、精確 predecessor body MD5、精確安裝後校驗與同版 rerun guard；不覆寫未知新版 validator。維持 signature／OID／ACL／security mode／search_path，沒有業務資料 DML。
4. 若使用者決定套用，執行後另跑唯讀核驗；看到 `PASS` 才算正式 backend 安裝核對完成。助手不代貼、不呼叫 clipboard API、不代執行。
5. 前端本機 commit 由使用者 Push。核对 Pages 的新 commit／assets 後，原正式 UI 手動保存、回讀當日歷史與失敗重試仍須做一次 production smoke。其間不要為了修復而清 storage／草稿。

本機 PASS 與本機 commit 不代表已 Push、部署、執行正式 SQL 或完成 production acceptance。
