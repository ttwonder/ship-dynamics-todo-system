# 每日早會保存修復：本機交付與正式核驗

## 最新修正：手動早會已提交後的完整讀回與成功提示

**本次只改前端確認流程，無新 SQL。沿既有本機資料夾、`main`，驗證後建立本機 commit，由使用者 Push；正式部署與真實保存驗收另核。下面自動內容修正的 SQL／正常 10:00 驗收仍是獨立 checkpoint，不因本次前端修復而視為完成。**

### 原因與最小改動

- 先前正式唯讀已核實兩個不同手動報告：保存 revision 10164／10165，台北時間 2026-10-11 14:04:15／14:05:51，各含 23 要事＋152 內控。不是未寫入，無需補按保存。
- 正式 cold／空 version-vector 支援路徑的 HOME 5.595 秒＋TARGETS 8.870 秒，整段 14.47 秒超過共用 12 秒期限。這是可支持的逾時風險，不能倒推原瀏覽器當次唯一 cause；舊包裝已丟棄原例外。
- 本機原 UI＋真 PostgreSQL behavioral RED：writer 已 COMMITTED；HOME、TARGETS 每段延遲 7 秒且各自 SQL 成功，整段仍被 12 秒 client deadline 截斷，誤顯「每日早會快照未保存」。
- 僅 `scoped-v1`＋`isMorningRecordScope(commandReadScope)` 的 post-ACK **完整串行讀回**使用有界 30 秒預算。非 morning 讀回 12 秒、writer 12 秒、receipt 查詢 8 秒及全域 SQL timeout 不變。仍讀完整必要內容，不改 exact report、capturedAt、durable history、revision／authority、角色或 scope 驗證，不發布局部未確認資料。
- `CloudBlockPatchConfirmedRefreshError` 保留同一 committed receipt 與原 cause，提示保留原訊息／錯誤碼。手動 callback 對 committed-refresh failure 明示「已保存，但畫面同步未完成」，不能稱未保存、盲重送或顯示綠色成功。
- 正常確認完成沿原對話框「今日早會快照已完成保存。」及共用綠色「已保存到雲端」提示／已安全保存列；不重設計 UI／按鈕／歷史，不改自動排程、Itinerary 或資料。30 秒是最大等待預算，不代表每次必須等 30 秒，也不是 SQL／整按鈕提速保證。

### 本機驗證與重跑

- 原 UI＋本機測試資料／真 native PostgreSQL：原 8＋新增 3，去重後 **11/11 PASS**。新增模式兩段各 7 秒，整段 14.291 秒正常完成完整讀回、一次 writer、一份精確新報告、成功對話與綠色保存；也驗真 SQL 57014 的已提交警告／無綠色誤報／不重送，以及唯讀安全同步零 writer 恢復既有報告後新的獨立手動保存一次。
- 15/15 原 callback 執行契約、早會 helper／分類／privacy／保存規則 aggregate PASS。lost-ACK client、adapter、App wiring、實際 App deadline selector＋真正 scope helper、共用 save feedback、typecheck 及正式 Pages subpath build PASS。writer／receipt 舊期限與非 morning 範圍均有契約檢查。
- 收據綁定當次產品／QA raw-byte input hashes；合成來源／旧凍結報告／Itinerary 值、revision、xmin、ctid 保留。owned HTTP／Chrome／PostgreSQL 全部停止，ports 已閉；保留 repo 外 RED、harness 失敗及 GREEN 收據。不接觸正式 DB、不操作使用者瀏覽器／草稿，不啟動新獨立全量 review。
- 設定原有 loopback native QA 環境後執行 `npm run test:daily-morning-save:confirmation-browser`；原 UI 回歸沿 `npm run test:daily-morning-save:browser`。測試資料不等於正式業務數量或 hosted 保存 PASS。
- 本次前端修復不要求重跑任何舊 SQL、不補存那兩個已提交報告。使用者 Push 後，另核 remote／Pages exact version，再於安全的正式操作時驗當次新 report ID／capturedAt、完整內容、畫面整合及成功提示；不可為核版本刷新有草稿的原頁籤。

---

## 前輪修正：自動早會快照完整內容與件數

**本機修正已驗證；正式 SQL、下一次正常 10:00 tick／完整 report 權威回讀仍待使用者套用後核驗。原 10:00／Owner-only wrapper 安裝的 15 true 與 5777297 Pages 交付已完成，不重跑舊 SQL、不要求重新發布舊版本。**

### 實際缺漏與修正邊界

- 正式唯讀證據：10/11 scheduled 的 `taskCount=23`、`snapshot.tasks` 23 筆，`internalControlCases` 整個欄位缺失；10/9 manual 196＝32 要事＋164 內控；9/30 manual 167＝27＋140。10/9 的 164 個內控 ID 仍在目前來源集合，沒有這批原始資料被刪的證據。不同日期的已結案／window 差異不能當作精確漏失數或今天應有數。
- 自動舊 SQL builder 沒收內控且 runner 只計要事。前版 MSPN01 與同一 builder 自比，只證 caller 沒再改資料，不證 builder 完整；本次由實際 `src/morningHistory.ts` 獨立比對每個集合、完整欄位及順序。
- 新 forward 只改 **已存在**的 builder 內容與 runner 件數：有效船舶、早會可見要事、完整內控、實際納入要事相關會議；相同最新 eligible manual cutoff／結案變動規則。scheduled 不推進 manual cutoff；技術時間、revision 或 status-log id／at 變動不冒充業務變動。
- 完整 hydration 的逐船／父項狀態歷史、已移出範圍的結案成員、內控／會議歷史、明示 null、字串編碼與 opaque 欄位保留。正式 Itinerary 的現行 helper／revision／rowId／fallback 投影保持原樣，備選不投影。
- 原 UI／按鈕／角色、每天 10:00 與 Itinerary 09:00 不變；沒有新 function／RPC／grant／helper、cron 寫入、來源切換或 pause bypass。
- **10/11 不完整凍結歷史原樣保留**：不以現在資料回填成當時 10:00 的內容，不刪除／重跑 wrapper。若使用者要當下完整內容，沿原手動保存新增一份，時間明示當下，不能冒充舊快照修復。

### 本機驗證與限制

- `verify-morning-content-native.mjs`：13/13 PASS；先有原 missing-collection behavioral RED，再有修正 GREEN。
- 用真實 PostgreSQL＋合成資料及有效 predecessor／pause／authority migration chain。實際 TS helper 與自動 SQL 比對 tasks／internalControlCases／meetings／vessels 全內容、順序與總件數；manual cutoff、結案業務變動／純技術改動、逐船 missing progress／scope、完整歷史、formal 投影、舊凍結／receipt、同日新 freeze/replay、ACL/wrapper、pause/retired、未知 body、晚 receipt 全回滾、兩個 backend 並發均通過。
- 200 個合成內控，每個 12 筆狀態歷史全部保留，無 truncation；這是本機完整性驗證，不是正式預期件數／負載保證。
- 新升級保留完整 pg_proc metadata（含 OID／Owner／ACL／config）及既有依賴；LF/CRLF 升級、同版 no-write rerun、先改 builder 後 runner 拒絕的 DDL atomic rollback 均實際驗證。
- 新唯讀 readback 的 17 checks 用 native 空 cron catalog 驗證查詢及真正 body drift 負例；**沒有偽造 pg_cron extension/jobs/daemon**，本機 aggregate 正確返回 `REQUIRES_INSTALL_OR_REVIEW`。不能把 wrapper fragment／metadata 測試稱 hosted 安裝或真 tick PASS。
- `npm run test:daily-morning-save`（14 callbacks、5 helpers及原分類／privacy契約）、cutoff-window、typecheck、production build PASS；原 UI/TypeScript 沒改，本輪不重跑 mounted UI。既有 large-chunk 警告不擴張重構；未另啟動獨立全量 review。
- 收據及 baseline RED／fixture importer拒絕／JS replacement dollar-token harness 失敗保留 repo 外。fixture 修正只使用 owned native admin seed／真 progress materializer，不改產品 importer或放寬 guard。所有 owned PG/HTTP ports 已停止；不碰原瀏覽器／草稿。

### 新的完整兩步 SQL（使用者自行 Run；不重跑下方舊版四步）

1. **第一步／修正**：`supabase/migrations/20261011130000_morning_snapshot_content.sql`。已安裝 freeze-once runner及現行 Itinerary helper 才接受；未知 predecessor／Owner／config／grant 會拒絕並整交易回滾。只改函式，不寫來源資料或凍結歷史，不動 cron。無 error／timeout 才繼續；頂層 advisory lock 的 void result 不是內容或安裝成功證據。
2. **第二步／獨立唯讀回讀**：`supabase/verification/morning-content-readback.sql`。與已確認 runtime workspace 綁定；最後單列 `PASS_INSTALL_ONLY`，**17 checks 全部 true**。回讀只查安裝、權限、精確 wrapper/target及原兩個 job；不執行 builder／runner、不暴露業務 payload、函式 body 或任意 GUC。
3. Preview 必須由新的 commit blobs 生成／核 bytes，兩個 SQL 為各自 fresh query 的獨立提交。使用者 Ctrl+A／Ctrl+C 手動複製，助手不操作 clipboard、不代貼／Run。任何錯誤、逾時、結果不明或 unexpected warning 都停在該步，不盲重試、不繼續。
4. 安裝成功後，讀下一次正常 10:00 scheduled 的精確 ID／capturedAt／完整內容，才關閉正式自動完整性 gate。不要手動 Run wrapper 提前製造自動報告。新本機 commit 可由使用者 Push 留存源碼；本次不是前端功能更動，Push 不能替代正式 SQL，也不用刷新有草稿的舊頁。

重跑：設定原生 QA 的三個 repo 外／loopback 環境參數後，執行 `npm run test:daily-morning-save:content-native`；`-- --before-content-upgrade` 為原 missing-collection RED（預期 FAIL）。不得傳正式 connection string／host。

---

## 前版歷史：手動每次獨立保存、每天 10:00 自動凍結一份

下列為前版交付紀錄。正式安裝的第四步已經由原 CSV 全部通過，舊安裝與 Push 步驟不再作為本次操作；本次僅沿上方新的兩步 forward content 修正。

**本機實作與驗證完成；尚未 Push、部署或執行正式 SQL。這次是新的保存規則，需新的 forward SQL；已 PASS 的 tracking／reader SQL 不重跑。正式排程及當次保存讀回仍待部署後核驗。**

### 新規則

- 手動不限星期或時段；每次新 report ID、當次時間／完整資料的獨立快照。原 writer 明確取消後重送仍沿用同一候選／ID／capturedAt／基線；未知或已提交結果不盲重試。
- 自動每天台北 10:00（含六日），新 ID 為 `daily-morning-YYYY-MM-DD-scheduled`。同日已有 scheduled 凍結資料（包含舊 unsuffixed ID）時，只記新 operation receipt，不重建、改時間／排序／audit／business revision，不覆寫手動。
- 原歷史顯示「自動保存／手動保存」、同日多份、保存時間；分頁以「份」計算，日期定位及凍結開啟沿原入口。Itinerary 每天 09:00 作業、資料、UI 不變。
- 保留所有舊報告、source、opaque 欄位、完整必要 current histories、cutoff baseline、formal Itinerary、角色／scope／authority、CAS、ACK 和 matching ID＋capturedAt 回讀；不裁切業務資料／歷史、不加 grants 或全域 timeout。
- 自動沿 records server runner，不借 normalized 排程或 Owner 瀏覽器身份，不需瀏覽器常開。每天一份以仍存在的 scheduled current row 為判斷；若使用者明確刪除此 row，之後新操作可以再生成，本輪不加 deletion-proof day ledger。

### 安裝前補查與既有後端權限決定

使用者原始唯讀 CSV 已確認舊 runner 為已知含 pause predecessor、security invoker、由目前 SQL reader／資料庫 Owner 持有；PUBLIC／anon／authenticated 無執行權，而 runner／builder／writer gate／materializer 保留既有 `service_role` 權限。新 wrapper 尚缺屬安裝前預期，不代表舊函式漏裝。

- 使用者明確選擇：**保留既有 service_role，不改原 grant；新增 10:00 入口仍僅限資料庫 Owner。** 原安裝前核驗和 catalog 補查已完成，不為取得新版標籤重跑第一步。
- 修正只涉及 cron installer 與 readback 的既有 runner ACL 前提：允許 Owner 與既有 service_role；不增加／撤除 runner 或共享依賴權限。PUBLIC、anon／authenticated 的有效權限（含繼承）及其他直接 grantees 仍拒絕。新 wrapper 的 Owner-only ACL、current_user guard 及 service_role 拒絕不變。
- 原 installer 在真實 native metadata 上重現 `morning-private-runner-prerequisite-failed: service_role`；修正後新增 MSPN14／15 GREEN。四個依賴的 OID／Owner／ACL／security/config 均精確保留，Owner-only 的舊環境也接受，但不為它製造 service_role grant。
- 核驗欄位改為 `runner_invoker_existing_server_acl`；catalog 的 `acl_owner_only=false` 可以是原後端 grant 的資訊，不再把它獨立當失敗。新 wrapper 仍須 `wrapper_owner_only_acl=true`。設定輸出僅限 search_path，不能輸出任意 GUC。
- 核心 migration、App／UI／手動保存與 Itinerary 檔案未變；不重跑已完成且輸入未變的 UI／build，只重跑受影響 native SQL policy 全組及 MJS syntax／diff gates。以前各層證據保留，不能稱這次重新執行了所有 UI／build。

### 本機證據（不同層不加總成正式 E2E）

| 層級 | 結果 | 範圍 |
|---|---|---|
| 真實 helpers／Vite SSR | 5/5 PASS | 週末多次 append、角色／形狀 guards、最新 eligible baseline、自動 immutable、来源與份數 |
| 原 App callback／受控 queue I/O | 14/14 PASS | scope、前置失敗、exact retry、unknown/confirmed fence、matching ACK 回讀及提示 |
| 原 UI＋native PostgreSQL＋測試資料 | 8/8 PASS | 正式按鈕與讀回、57014 回滾／重試、同日來源／多份定位／凍結預覽、舊值／物理 tuples 保留 |
| 真實 adapter＋隔離 SQL/HTTP | 9/9 PASS | 完整 histories／raw fields與基準；v1 相同 9 案另作相容 control，不計為 18 個不同案例 |
| native PostgreSQL policy／SQL gates | 15/15 PASS | 原 13 案加既有 server grant 精確保留／接受、未加新 grant、PUBLIC／browser／其他 grantee／繼承拒絕；六日、凍結、並發、pause/retired replay、晚 receipt 回滾、ID conflict、無 Owner、未知 body及LF/CRLF 升級／冪等 |

- Core 升級保留 OID／ACL／security/config、exact paused receipt replay、writer authority guard、builder 與後續 Itinerary splice，不改業務 rows。
- 舊 policy native RED 實際得到週末 not-business-day、同日 auto/manual 覆寫及兩個 revision；negative/control 仍 PASS。SQL 草稿 LF/CRLF 的兩次 FAIL 收據保留，修正後才 GREEN，沒有放寬 oracle／grants。
- MSPN12 只執行安裝 SQL 的真實私有 wrapper fragment及records writer，不註冊 cron；MSPN13 驗本機實際缺 pg_cron 時零寫入拒絕。完整 readback 負例只用空 catalog relation 供查詢規劃，沒有假 extension/job/成功 scheduler 回應，須回 REQUIRES_INSTALL_OR_REVIEW。
- **本機沒有真 pg_cron daemon。** 正向 cron registration、其他 workspace 的 hosted scope、正式 timezone／角色／實際每日 tick 未驗證，不能用上述 PASS 取代正式讀回。
- 先前 c6e0f79 的 Aggregate、cutoff、privacy、pagination、typecheck、production build PASS 保留；這次對應 App／helpers／核心 migration bytes 未變，沒有再執行 UI／build。當次 native SQL 15/15、MJS syntax及diff check PASS；各 receipt 綁定其實際輸入 bytes，QA 停止自己的 PG／HTTP 及 ports；沒有另外啟動全量獨立 review。

### 速度：先保留確認流程

已部署 e520c96 的正式 HTTP 唯讀採樣：authority 約 0.99 秒；home 冷讀 4.74 秒／1.76 MB，detail 首次 4.56 秒／0.998 MB；三組暖讀 home 1.55–2.92 秒、detail 1.74–3.64 秒，每組合計 4.61–6.01 秒，同 revision、全部成功。沒有按正式保存或碰原草稿頁；不是完整按鈕／writer 時間，不把成本全歸因 DB 或電腦。本輪不做效能重構、不裁切完整快照或省略權威確認。

### 正式交接（使用者自行决定／執行）

1. 確認正式專案仍是 ship-dynamics-todo-system production。Preview 的全文經 commit blob 核對；cron/readback 僅以當前公開 runtime 的精確 workspace key 取代 placeholder，不含憑證、不自動執行、不用 clipboard API。
2. 原安裝前唯讀核驗與補查已完成，直接沿新版 Preview 第二步開始，不重跑第一步。對全新或改變的環境仍須先做 `supabase/verification/morning-1000-readback.sql`：新 wrapper／job／exact forward 未安裝時 false 可預期，但原 runner predecessor、原排程、UTC/GMT、角色／workspace 未知或不符仍需停。既有 service_role 是使用者明確保留的後端權限，不以此放行 PUBLIC／browser 或其他 grantee；REQUIRES_INSTALL_OR_REVIEW 不是安裝成功。
3. 使用者確認安裝後，分開執行兩份正式寫入，每份確定無錯誤才繼續：`supabase/migrations/20261010100000_morning_snapshot_policy.sql` 是 guarded core（不註冊 cron）；`supabase/deployment/morning-1000-cron-install.sql` 是 owner-only wrapper及每天 `0 2 * * *` 新 job。只移除精確已知舊 morning job；未知 scope／其他 eligible workspace／job／timezone／Itinerary 不符會全交易 rollback，需另作決定。Itinerary `0 1 * * *` 不動。
4. 再獨立做唯讀 readback，最後須 `PASS_INSTALL_ONLY` 且 checks 全 true；它只證安裝，不代表排程已跑或手動成功。錯誤或不明結果停止，不強制重放。
5. 使用者 Push 本機 commit 並核對 Pages 版本。保存原草稿頁、不清 storage、不盲目刷新／同步；切換期間先不使用仍為舊版的頁籤保存早會。另開新頁驗明版本，再由使用者決定手動保存一次。
6. 正式驗收分兩件：手動當次 ID／capturedAt 權威讀回及歷史一致；下一次正常 10:00 job 的 scheduled ID、實際 capturedAt及凍結內容讀回。不要直接 Run wrapper 製造非 10:00 自動報告；unknown 不連按重試。

本次重跑（native/browser 使用下方三個顯式 QA 參數）：

```bash
npm run test:daily-morning-save
npm run test:daily-morning-save:policy-native
npm run test:daily-morning-save:policy-native -- --before-upgrade # 預期 policy RED
npm run test:daily-morning-save:browser
QA_EVIDENCE_ROOT=<repo外絕對路徑> node scripts/verify-record-scope-cache.mjs
QA_EVIDENCE_ROOT=<另一repo外絕對路徑> node scripts/verify-record-scope-cache.mjs --v1
node scripts/verify-morning-cutoff-window.mjs
node scripts/verify-morning-history-pagination.mjs
npm run typecheck
npm run build
```

---

## 第三版歷史：解除早會保存的不必要全量讀取依賴（e520c96）

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
