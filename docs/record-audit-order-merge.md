# records 單船 audit-order 有界合併（本機候選）

## 契約與實作

基準 `12dda66c8ab58a396ca06df164453ccc77468677`。只修改 development-only record store SQL；`src`、UI、文案、RPC 參數、原 builder／withAudit／rebase、角色政策、有效且精確對象的 lease、主船 entity CAS 與 workspace root lock 均不變。不是正式 migration，不在 manifest 新增項目，沒有新 browser grant、Push、部署或 production 存取。

原 `buildCloudBlockPatch` 在同一基準送出單船更新、相符新增 audit、audit order，以及 `withAudit(...).slice(0,500)` 必要的尾端刪除。500 是程式正常上限，不是推測正式 logs 筆數。舊 SQL 在滿額時可能先拒絕已由 peer 正常刪掉的尾端 entity，還未走到 order CAS。

新增私有 `ship_dynamics_record_merge_audit_v1`，仍由原 `apply_ship_dynamics_record_patch_v1` 在原 replay、actor/authorization、lease 驗證及 root 排隊後使用：

- 僅接受一個既有 vessel 更新、一個對應新增 audit、一個 audit order，以及滿 500 基準所需的唯一尾刪除；其他 graph 原樣走 strict CAS。
- 以同 workspace 的真正 `record_versions.orders` 找到基準 E，最多重建 E 的 500 筆 audit body intervals；不重建 AppData 或 task 歷史。缺基準／缺 interval 不猜測。
- caller order 必須精確等於 `take([new]+E,500)`；caller 尾刪除 expected 必須精確符合歷史 body。目前 order 必須精確等於 `take(P+E,500)`。
- E 中存活資料不得改寫／刪除重建；已截除尾筆要有真實歷史 interval。P 必須在基準後新增且沒有既往 body history。新 audit ID 不得使用已有／歷史 ID。
- 只對「新 audit＋P」按與原 JS 等價的不同 canonical UTC 毫秒時間降序排列，接回 E 原相對序，再截 500。不同時間的固定寬度數字字串使用 C collation；同時刻 ID 比較及非 canonical 時間未放寬，維持 strict CAS。
- 只改寫 audit 的等價新增／當前合法尾刪除／order；vessel operation 原物件不動。之後照常執行完整 entity CAS、audit 不可變、actor coupling、鎖與整筆預驗證、原 commit helper。
- receipt 保存的是**原 request signature**，不是 effective operations 的 signature。原 operation lost-response replay 仍在 lease/actor 檢查前，signature mismatch 仍拒絕。
- helper 撤銷 PUBLIC／anon／authenticated 執行權，沒有新增 grants。

## 相容與限制

舊 records client／原 request 可直接使用新 server；client bytes、RPC args、operation identity 均不改。舊 server 維持原衝突／rebase。legacy 寫入未改，不新增 records 降級路徑。

這不是完整全域並發解法：root lock 仍排隊；tasks／批量／notifications／任意 reorder 仍維持原契約。同時刻、非標準時間、無可靠基準、改写／重建或超過 499 peer prefix 不走合併。依原 `mergeImmutableAuditLogs`，未滿 500 的共同基準若已被 peer 截掉原基準資料亦不放寬；499 的 A 填滿、B 同基準合併已單獨驗證。沒有全面重排舊歷史，也沒有建立新的 server retention 政策。未查正式 audit 筆數；不宣稱 hosted QPS、正式可用率或任意五人保存都免重試。

## 初版 ff11c260 的真實驗證（保留歷史收據）

證據根：`C:/Users/tuotu/AppData/Local/hermes/cache/record-audit-merge-12dda66c`。

| 層 | 指令／證據 | 結果 |
|---|---|---|
| 原生 RED | `node scripts/verify-record-audit-merge-native.mjs`；`audit-native-gywN1p/receipt.json`、`red.stdout.log` | 原 SQL，500 基準 A 真提交，B 原合法請求被 `auditLogs:legacy-499` CAS 拒絕；exit 1 |
| 新原生 graph | 同指令；`audit-native-sAaiX6/receipt.json`、`native-green-complete.stdout.log` | 22 個有穩定 ID 的 cases；500／499／7 正例，first request ACK，完整 payload、delta 重建、三個 revision history、server IP/country、原 signature replay/mismatch |
| 既有 native 並發 | `node scripts/verify-record-concurrency-native.mjs`；`native-3w2o11/receipt.json`、`baseline.stdout.log` | N1–N6 全過；真 root blocking、tasks-order 競爭、同實體 CAS、linked late rollback、peer 期間 replay 均保留；其中手動純 helper rebase 不是 App 自動重試證據 |
| 原 App 滿額五人 | `node scripts/verify-record-five-actor-browser.mjs --audit-merge-cap=500`；`five-hv4w0e/receipt.json`、`ui-500.stdout.log` | UM-500：5 個不同真人員登入 context、同基準 outgoing、真 pre-COMMIT blocker，5 first-request ACK，0 retry／0 manual recovery；old audit 精確剩前 495 筆，總数 500 |
| 原 App 未滿額五人 | 同指令 `--audit-merge-cap=7`；`five-Z4mKyI/receipt.json`、`ui-7.stdout.log` | UM-7：5 first-request ACK，0 retry／0 manual recovery；7 舊筆完整原序保留，总數 12 |
| 新文件讀回 | 上列 UR-500／UR-7 | 各 1 fresh SQL connection＋5 fresh document 原 cloud reader；不是額外五人保存 cases |
| 共用 SQL／adapter | `verify-cloud-record-store.mjs`、`verify-cloud-record-workflows.mjs`、`verify-cloud-record-delta.mjs` | 分別 23（16 SQL＋7 adapter）、23、16（7 SQL＋9 adapter）cases；本機 PGlite/loopback，非 hosted |

新 native 22 cases 的分層：3 cap 正例、17 原生拒絕負控、1 late rollback＋identical-request positive、1 private ACL。不要與其他 suite 或兩次 UI fixture 相加成 E2E 數字。直接負控包括 stale vessel、錯 actor guard／audit actor、有效錯對象 lease、過期 lease、錯 audit 對象、重複 IDs、任意 order、偽造 base/append/尾筆 expected、非尾刪除、不可變 audit、非標準／同刻時間、透過原 RPC 刪除再重建。

兩個 UI fixture 均經原 main.tsx→App、原進站／人員登入、原快速更新 textarea／保存操作，HTTP 每請求獨立交易，沒有寫 helper／React setter 代替保存。提交前已確認全部 outgoing audit expected 相同；首筆真 SQL 執行後、COMMIT 前觀察 follower `pg_blocking_pids`。pending 同一 editor DOM/draft 與 lease 保留；ACK 後原 editor 自動關閉。全部船 mask、旁觀船/task/case、formal/legacy、完整各版 history、最終 delta 重建、IP/country、receipt/audit 唯一性、fresh readback 期間零 trailing write 均核對。代表截圖 `UM-500-pending.png` 顯示正在確認及保留草稿；`UM-500-ACK.png` 顯示已保存到雲端、editor 關閉、卡片保留內容。

舊 U3 四輪「followers 必須衝突」只適用 `12dda66c` 歷史 baseline。新 runner 是 explicit mode，不刪舊驗證、不造衝突來迎合舊正例。新的 UI evidence 只計 UM-7／UM-500 兩個有界情境；UR 為獨立唯讀證據。

收據範圍澄清：每個歷史 revision 都核對完整 snapshot 與 audit 順序；delta RPC 則從共同基準重建最終 current payload，不是逐個歷史 revision 的 delta。原收據欄名 `fullDeltaEachHistory` 過廣，後續 runner 改為 `fullFinalDeltaReconstructed`；保留既有收據作歷史，不將重複讀取加算為新情境。

`src`／package bytes 未改，因此沒有把舊 typecheck/build 重跑當本片 gate；當前 affected 原 App 實際在 Vite 中執行。實作者交回此初版時尚無獨立 review PASS 聲稱；其後的差異檢查與修正另列於下。

## 異常與交付紀律

失敗 stdout/receipts 保留，不當作 PASS：首次輸出目錄尚未建立的 launch 並非 RED；真正 RED 如上。初次 SQL 在 IF 中的 CASE 少了括號，安裝出現 42601，修正後 native 正例通過。新 harness 曾把 mismatch sentinel 寫成 `operation-id-reused`（實際為 `operation-id-mismatch`）、誤認 full records envelope 帶 delta token（改讀真 read-base token）、以及重建 fixture 的 audit/vessel 對象不相符（以真正 coupled 原 RPC 重建修正）。這些不是產品安全條件被放寬。

這次實際時程／harness 修理次數超過原預定有界預算，不宣稱符合該程序限制；沒有以少於 500 的片段或未驗證輸出冒充完成。最終產品／原 UI 與 SQL gates 的 PASS 限上述真實輸出。

所有測試只在已驗證 portable PostgreSQL runtime 的新 owned loopback cluster；每次 exact data_directory、user、host/port 核對後才安裝 development SQL。HTTP／owned Chrome／PG／ports 已關閉、private profile/data 已移除；runtime 本體保留。最終 hash manifest、完整 staged Git patch、exact staged tree／commit tree 與 clean receipt 位於同證據根。沒有 Push、merge、production SQL、部署或使用者 Chrome 操作。

## 獨立檢查後：重現並修正 order 再現的 ABA 缺口

獨立檢查發現，同一 audit ID 集合 E 可在合法刪除／重建後再次出現，不能只用最新相同 order 的 revision 當作 caller 基準。父以原 RPC 重現：先保留 B 舊請求，刪除／以不同 detail 重建 `legacy-0` 並恢復 E，再提交 A 的新 audit；原 JS rebase 拒絕 B，但初版 SQL 卻 ACK 並寫入。這是產品 RED，不是測試工具錯誤。

修正只增加一項保守條件：E 中任何 ID 若存在 `valid_to_revision <= base_revision` 的更早 body interval，即退出快速合併、沿原 strict CAS。保留既有「基準後被改寫」檢查與完整預驗證；正常 peer 在基準之後造成的 cap 尾端歸檔不受此條件影響。這不把重建後的 E 偷換成舊 caller 的基準，也不新增權限、RPC 參數或重試政策。

- `G-reappearing-order-ABA` 真 native RED→GREEN：修正後拒絕舊請求，所有 business ledger 零寫入；原 rebase 衝突、重現 E 的 revisions 與前後 ledger hash 均留存。
- 原生 suite 加入此負控後為 23 cases；500／499／7 正例、既有拒絕條件、late rollback、signature replay 與 ACL 仍通過。
- 修正後 UM-500／UM-7 再以原 App 跑過，各 5 first-request ACK、零 retry／manual；UI oracle 現在直接對照記憶體中捕捉的原 outgoing audit body，只替換 IP／country 等 server-owned metadata，不再用回讀內容推導自己的 body 期望。原 request／guards 不寫入檔案。
- 首次修正後 UM-500 已通過 UI／資料斷言，但 owned data 清理遇 Windows `EBUSY` 而 exit 1；原 FAIL 收據保留。父核專屬 PID／ports 均停後只刪該次 data／chrome 目錄，再跑 UM-500 與尚未跑的 UM-7，兩個命令均 exit 0。

此閉合證據根為 `C:/Users/tuotu/AppData/Local/hermes/cache/record-audit-aba-ff11c260`；`closure-receipt.json` 聚合精確 run 路徑、當前 inputs／候選 tree、RED／GREEN 及清理分類。初版收據與超時紀錄不覆寫；本節不代表 hosted、production、任意時序或抗刷新持久化已驗。
