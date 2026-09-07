# 原 App records-v1 四段本機效能基準

基準產品：`8becb4a4a521604ed35096e11963b510657a1965` / tree `d1d8f911530179aae32773e44f0e4cd968c61fd6`。**本片只有 QA/docs，沒有產品優化、SQL／鎖政策變更或正式環境操作。** 原入口仍為 `src/main.tsx → App`，不是未掛載的 NormalizedApp。

## 重跑與證據

在 repo 根目錄、既有 Node／Chrome／node_modules 下執行；不下載依賴：

```bash
QA_EVIDENCE_ROOT='C:/Users/tuotu/AppData/Local/hermes/cache/record-performance-8becb4a4' node scripts/verify-record-performance-browser.mjs --tracer-only
QA_EVIDENCE_ROOT='C:/Users/tuotu/AppData/Local/hermes/cache/record-performance-8becb4a4' node scripts/verify-record-performance-browser.mjs
node scripts/verify-record-performance-boundary.mjs
```

每次 `mkdtemp` 新建 evidence 子目錄，不覆蓋前次。使用獨立 Chrome profile、loopback-only HTTP、真 SupabaseJS → 私有 PGlite owner 交易；原進站及人員登入、原「快速更新」「保存並關閉」「同步最新（安全合併）」按鈕均由 native CDP 輸入觸發。頁面標示「真實 UI＋測試資料」。原 config 資產不會送入本機頁面；CSP + deny-by-default Fetch interception 只放行本次 origin，第二個 client 也只允許同 origin RPC。未開使用者 Chrome，未讀正式 credentials。

本次 cache 根：`C:/Users/tuotu/AppData/Local/hermes/cache/record-performance-8becb4a4/`。

- `01-tracer.json/.log`：原小 fixture 第一條完整流程成功。
- `02-baseline.json/.log`：small 三次完成；medium 第一輪於 QA 完整比對失敗。CDP JSON 傳輸省略 `undefined`，Node normalizer 保留這些欄位；沒有 SQL／保存／同步產品失敗。
- `03-baseline.json/.log`：一次定點 harness 修正後，最終兩種大小全部成功；只有這次納入下表。
- `record-performance-COEV23/evidence.json`：逐樣本／RPC／operation ID／revision／SQL window／UI 時點／lease 零列讀回／阻擋與清理紀錄。
- 同目錄 `samples.csv`（26 列）、`summary.json`（10 組）、各次 `*-saved.json` / `*-synced.json`、baseline 與截圖。完整讀回移除 credential/token 欄位值，另留完整 payload 的整體 SHA-256；不保存 RPC body。
- `analysis.json`、`05-analysis.log`：從已持久化 JSON 程式聚合 count / median / min / max、唯一成員／history ID、單獨 release RPC；不手算、不將失敗／tracer 混入 baseline。
- `04-default-regression.json/.log`：共享 QA **預設模式**原有 8 UI+SQL、4 hook controlled-I/O、4 mounted controlled-I/O 通過；兩種 controlled 層不算 SQL E2E，重复列印的 CORE/ITINERARY 結果不重計。

唯一語意 workflow：原單船 note 保存 → 原關閉／釋鎖 → 另一個合法 SupabaseJS client 真 claim/read/guarded CAS+audit/release → 先確認 server 新 revision → 原 UI 同步新值 → 完整 adapter readback。兩種大小各重複 3 次，合計 **6 次 workflow 執行 + 2 次首讀**；不是 6 個不同功能情境。10 個去重的 size/phase 組，26 筆 phase 樣本。每次都驗未選船 values／record revision/xmin/ctid、未參與 tasks、正式 Itinerary/history 不變，revision 依序 `[1,2,3] → [3,4,5] → [5,6,7]`（保存前／原 UI ACK／peer ACK）；最後 1,200ms 額外觀察零 trailing patch／新 revision／active lease。這個觀察不計入业务時間。

## 資料尺寸（程式產生、實際 SQL 回讀計數）

`record-performance-fixture.mjs` 固定合成業務 ID／時間。small 沿用既有兩船 fixture 並 normalize；medium 擴為 12 船、80 筆 task，每 task 8 船進度，每進度 6 筆合成 history。沒有巨量壓測、legacy 大 JSON stats script 或正式資料。驗證登入用隨機合成 credential 不輸出；執行期 audit ID／timestamp 會變，不能把每次 payload 說成 bit-identical。

| 起始資料 | small | medium |
|---|---:|---:|
| users / vessels / tasks | 1 / 2 / 0 | 1 / 12 / 80 |
| 唯一 task-member pairs / member history IDs | 0 / 0 | 640 / 3,840 |
| tasks JSON UTF-8 bytes | 2 | 1,421,871 |
| 扁平 member entries JSON bytes | 2 | 1,366,609 |
| 完整 AppData JSON bytes | 5,110 | 1,437,281 |

其餘 meetings、internalControlCases、agendaReports、taskDismissals、notifications、auditLogs 起始皆 0。每個集合的 cardinality、unique IDs、JSON bytes 另列 `evidence.fixtures`；formal Itinerary fixture 是獨立資料，不包含於上述 AppData。member bytes 與 tasks bytes 重疊，不能相加。

## 量尺：可觀測 window，不冒充 profiler

- **cold-bootstrap**：新 profile 的第一次 Page.navigate → 原權威進站密碼畫面可見；包含 Vite dev HTTP／瀏覽器模組載入與原 React bootstrap，但不含 fixture 安裝、Chrome 啟動或輸入登入所花時間。每尺寸只有 1 次，與登入後 editor 樣本分開；不是 production bundle 冷啟動估值。
- **editor-open**：已登入／同步 ready，原「快速更新」native click dispatch → 原 note textarea 真可編輯；先取得 SQL lease。三次都是已 bootstrap 的文件，iteration 1 是首次開 editor，後兩次是 reopen。
- **save-ack-visible**：原「保存並關閉」click dispatch → `.save-status-strip` 由非 saved 變回 saved；以實際 patch operationId 的 HTTP 200／完整 body received、SQL committed revision 與 payload 讀回綁定，不只等待 SQL 成功或 dialog 消失。
- **committed-ack-to-release-readback**：同 operation HTTP committed ACK body received → 原 close 完成且 SQL active lease 查回 0。原 App 的 release request 會早於「已安全保存」的 DOM 發布；所以此 window 與 save-ack-visible **重疊且不能相加**。另外保存 `releaseRpc.httpWallMs/sqlMs`，不把 ACK 可見後已無 RPC 誤報成「釋鎖零成本」。其兩筆 RPC 是 committed 後的 delta read + release。
- **sync-visible**：peer 的 SQL 新 revision／新值已讀回後，原同步按鈕 click → 新 note 值及 saved indicator 可見。原 confirmation 由明確 allowlist 接受，含本機處理 dialog 的開銷，不含人的思考時間。隨後另走一次真 `fetchCloudData()`，把完整 model 與 SQL payload 的 production normalize 結果作 JSON-domain 等值比對；這次 QA-only verification 的 window 單列，**不混入 UI 同步數字**。

UI 時點由只讀 DOM MutationObserver + capture click listener 記 `performance.timeOrigin + performance.now()`，不改 UI callback／fetch response／timers，不注入 delay。Node SQL 時間同為單調 epoch，CDP Network timestamps 依 request wallTime 校準；逐筆驗 committed → ACK → release 次序。觀察器／CDP／Fetch interception 本身仍有 overhead。

`sqlMs` 是進入 PGlite transaction callback（owner queue 之後）到實際 headers SQL + RPC statement 回傳的 window，含參數 JSON 編碼、WASM/PGlite 回傳解碼；不是 PostgreSQL EXPLAIN CPU 時間。`requestStartedMs → sqlStartedMs → sqlEndedMs → transactionEndedMs` 全部保留，queue／commit 可另查。每個 phase 按 request start 歸屬，SQL 為該些 RPC window 合計；重疊 phase 不作总成本相加。

Request bytes 為收到 HTTP body 的 UTF-8 bytes；response bytes 為真 SQL 回傳 JSON 的 UTF-8 logical bytes，不含 header／gzip／TLS／TCP，亦不計 Vite JS/assets。client JSON.parse、raw clone、normalize、React render、storage 寫入和 GC **未分離**，不得把 wall 減 SQL 說成其中任何一項。除 release 讀回外，poll 只是取回已記錄時點，不進業務 wall；release 是保守觀察上界，含 nominal 25ms poll + CDP roundtrips／調度＋一次 SQL lease verification，25ms 不是誤差上限。Raw `ackVisibleMs/closeObservedMs/leaseReadback` 可區分觀察尾段。

## 本機 baseline 結果

時間 ms；三次列為中位數 `[min–max]`；SQL／bytes 亦列中位數。cold 單樣本不報分位数。

| 大小／階段 | n | UI/觀察 wall | SQL window | RPC | Request / response bytes |
|---|---:|---:|---:|---:|---:|
| small cold-bootstrap | 1 | 1241.32 | 4.29 | 2 | 172 / 10,564 |
| small editor-open | 3 | 66.20 [60.10–89.10] | 3.02 | 2 | 298 / 445 |
| small save-ack-visible | 3 | 103.40 [97.40–118.20] | 11.83 | 5 | 4,534 / 2,629 |
| small committed ACK→release readback | 3 | 53.85 [30.89–57.42] | 2.29 | 2 | 249 / 1,990 |
| small sync-visible | 3 | 67.60 [22.20–67.90] | 5.25 | 2 | 218 / 4,245 |
| medium cold-bootstrap | 1 | 902.06 | 125.94 | 2 | 172 / 2,874,906 |
| medium editor-open | 3 | 282.10 [279.00–314.00] | 2.74 | 2 | 298 / 445 |
| medium save-ack-visible | 3 | 377.60 [344.60–549.00] | 10.42 | 5 | 4,619 / 2,630 |
| medium committed ACK→release readback | 3 | 191.17 [186.19–222.24] | 2.50 | 2 | 249 / 1,991 |
| medium sync-visible | 3 | 316.20 [284.10–371.50] | 3.83 | 2 | 301 / 4,902 |

單獨 release RPC：small HTTP 4.50ms / SQL 0.81ms；medium HTTP 4.15ms / SQL 0.92ms（各 n=3 median）。因此 191ms 的 ACK→可見 close／lease 查回不能解讀成 SQL 解鎖用了 191ms。QA-only 完整 adapter 再讀回中位數 small 8.22ms、medium 184.85ms，包含 CDP 完整 JSON 回傳，不當作原同步的必要 RPC。

可觀測結論：

1. medium 首次 bootstrap 發出兩筆 full snapshot，合計 2,874,906 bytes；原 cold hydration 尚未按需。small 冷 wall 反而較大，單次 dev startup 明顯不足以排序容量與冷啟動快慢。
2. 登入後 editor-open 在两种大小都是 claim + **272-byte 空 delta**（合计445 bytes），SQL window 约数 ms；medium wall 仍約282ms。傳輸已小，剩餘完整 AppData 重組／驗證／UI 工作不能靠換更小網路 payload 就宣稱解決。
3. 此批 warm 中位數最大是保存 ACK 可見段（medium 377.60ms），不是 release SQL。保存／同步部分範圍重疊；未分離 JS/React，不能穩定指認 normalize、GC 或某條 SQL 是全流程唯一瓶頸。只建立 baseline，沒有 p95、改善百分比或「提高速度」宣告。

## 下一個最小讀取接線：先限定單船開啟的空 delta freshness

**選擇較小的讀取切片，不先改 workspace lock，也不直接從完整 AppData 刪掉 task history。** 精確入口是 `src/App.tsx::openVesselEditor → refreshAfterItemLease`（2186/2193、1844/1858），後端讀取縫是 `src/cloud.ts::fetchCloudData → fetchCloudDeltaData`（175、131），重組在 `src/cloudDelta.ts::consumeCloudDeltaResponse`（35；目前即使空 delta 也 clone base），完整 normalize 在 `src/cloud.ts::normalizedCloudRead`（119）。

下一片只考慮此已量測的「已有完整權威基線，開啟單船前檢查新鮮度」：將 exact-base、同 revision/token 的空 delta 視為只讀 freshness 結果，**按需要才重組／normalize 完整快照**；有實際變更、cold/missing base 或不確定狀态仍走原完整 delta/snapshot 路徑。可以新增僅此 caller opt-in 的 freshness helper，但不是現在已存在的產品能力，也不能以此宣稱初始按需已完成。

必須維持：

- UI 繼續獲得完整 AppData；private raw／confirmed baseline 不得是可編輯的 liveData／草稿，不可把部分 vessel 回覆貼成更高版本的「完整」cache。空 delta 短路也必須有 exact base identity，不得僅比 revision 數字。
- `refreshAfterItemLease` 原 dirty drain、完整 confirmed baseline、`assertRemoteExtendsDurableHistory`、`resolveItemEditSession` 的存在／actor 授權檢查及 lease/config/generation fencing 保留；未改變 fresh 結果也不能略過授權或本機修改檢查。
- `fetchCloudDeltaData` 的 workspace/key/storage mode、sequence/publishedSequence、late response、missing、abort fence 保留。未知／錯 protocol、wrong base、新 revision、有刪除／order／通知／audit 等變更不得走空結果分支；仍發布完整 server change set。
- 先以本 harness 的同一原船舶閉環，加 exact-base no-change / changed / stale-config 的定點測試驗證，才比較新 baseline。此建議沒有測出預期收益，實作若仍需完整複製也需如實量測。

真正 cold on-demand 的候選大資料是 task 的 `vesselProgress[].statusLogs`，但先要把 `TaskEditModal` 的詳情 read projection 與完整 task CAS／raw write baseline 明確分開；本次只保存 vessel，**沒有量測 task 保存**，不能拿這個 baseline 批准跳過完整 task CAS 或把 member-specific read/write／鎖改造一起帶入下一個最小片。

## 鎖與尚未覆蓋

最後實際載入的 `supabase/development/20260906_appdata_record_store.sql::apply_ship_dynamics_record_patch_v1` 仍有 operation advisory xact lock（444）及共同 `ship_dynamics_record_workspaces ... FOR UPDATE`（447），entity CAS `FOR UPDATE` 在502；task expected/value 經 `ship_dynamics_record_hydrate_v1` 做完整 CAS。物理分船 leaf 已在 8bec 完成，見 [task-progress-physical-storage.md](task-progress-physical-storage.md)，**完整 task transport、workspace shared row lock 尚未拆**。

PGlite owner 是單一 serialized executor；另一個合法 client 是順序執行真 RPC，不是獨立 PostgreSQL 連線競爭。沒有真 lock wait、hosted PostgREST/ACL/Realtime、production network、手機/PDF/Excel 或全站效能證據。沒有 Push／merge／部署／正式 SQL、正式 config/storage、cron 或新 review；此片完成後交回唯一 writer，不啟動下一片。

驗證：新 script 真 run／syntax、共享 QA default 回歸、完整 protected source/build-input boundary、diff／raw-blob archive extraction、explicit stage／本機 commit。src/build inputs 沒變，沿用 8bec 的 `task-progress-partition-ece55206/11-type-build.log`（tsc --noEmit、tsc+Vite build 成功，既有 >500kB chunk 提示保留）與該片 parent `receipt.json` 的 commit/tree 綁定；沒有重跑全產品套件或把 reuse 寫成新執行。
