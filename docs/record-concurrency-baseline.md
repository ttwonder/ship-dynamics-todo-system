# records-v1：隔離 native PostgreSQL 多連線基線

## 範圍與結論

本片基線 `b7a61b4698c127052532080442aca6443115bbed`，僅 QA／文件與共用 QA fixture 的預設關閉 database factory；**沒有修改 src、supabase、UI、業務 lease、完整 task CAS 或產品 SQL**。沿用 `docs/modular-storage-development.md` 的唯一 writer、本機驗證後 commit、不得 Push／正式 SQL 契約。

已在原生 PostgreSQL **17.11 Windows x64** 實際執行固定 **6 個 SQL 層 case IDs**；不是負載 benchmark、原 App 多瀏覽器／自動重試、PostgREST、hosted ACL、Realtime 或正式效能證據。使用原 `buildCloudBlockPatch`、`withAudit`、vessel operational draft、internal-control、notification、authorization、rebase helpers；沒有手造 workspace revision guard。fixture 實际入口名稱是 `createRecordStorageLocalQa`，repo 並不存在 `createRecordStorageFixture`。

核心觀察：**entity lease 可分船共存，但同 workspace 寫交易仍排隊；排隊與 CAS 衝突是兩件事。** 帶真 audit 的不同船更新，在前筆 commit 後第二筆因 `order:auditLogs` 拒絕；使用既有純 rebase helper，再建新 operation，兩筆意圖都能保存。這是既有共享集合順序 CAS 的行為，不把短暫序列化／有條件重試本身判成產品 bug，也不聲稱原 App 已自動完成這次重試。

## 六項結果（最新適用 run）

| Stable case ID | 實際觀察與斷言 |
|---|---|
| `N1-entity-leases` | 不同合法 actor 分持 qa-v2／qa-v1；A 的 claim 真 transaction 尚未 commit，B 的不同船 claim 已完成。A commit 後，同船第二 owner 的 claim 被拒絕。 |
| `N2-different-vessels-same-base` | 同 base revision 1、不同船、每船完整 audit。B 真 backend 等 A；A commit revision 2，B 回 `block-conflict / order:auditLogs`，拒絕後全表 ledger 僅有 A 的提交。手動呼叫原 rebase helper，B 新 operation 成功 revision 3，完整讀回保留兩船中文變更。 |
| `N3-task-and-case-create` | Owner 在 qa-v2 建普通要事，同時 operator 在其合法 qa-v1 建內控＋唯一雙向 linked task。B 等 A 後回 `block-conflict / order:tasks`（因內控也建立 task），純 helper rebase 後成功；核普通 task、case↔task IDs、完整資料、audit/order。 |
| `N4-stale-same-entity-CAS` | B 有效 lease 保存新版 → release → A 合法 claim → A 提交原 stale expected，回 `block-conflict / vessels:qa-v1`。所有 public 表的拒絕前後 ledger 相等，保存值未被覆蓋；另記之後的合法 lease handoff，避免把 lease 更新誤稱零變更。 |
| `N5-linked-close-late-rollback` | 原 helper 產生 case＋task 結案、通知、audit 同一 graph；私有 QA receipt `BEFORE INSERT` trigger 在最後寫入處故意拋錯。非交易 sequence 證明已到 receipt；所有 public business tables（含 records、orders、history、task-progress/history、versions、read-bases、receipts、legacy/formal）完整 rollback。移除私有故障後**完全相同 request** 成功，兩端 closed、完整讀回相等。sequence 僅作 entry counter，明列排除於 business ledger。 |
| `N6-lost-reply-replay-with-peer` | 實際 SQL commit 後 harness 不交付該結果；另一 peer 已執行新修改但 transaction 尚開啟時，原 operation replay／receipt status 可返回原 revision，無重複 audit／資料。peer commit 後再次 replay 仍為原 revision，完整 ledger 不變。這是 SQL reply discard，不是 HTTP/browser 故障注入。 |

最終 root revision **9**。第五條 fresh backend connection 的完整 AppData 與 observer 一致；正式 Itinerary、history、leases、其他 sd 表與矛盾 legacy snapshot 保持不變。全資料只作記憶體中比對，收據保存 SHA-256／counts／safe operation metadata，不輸出合成密碼、actor guard、完整 SQL payload。

## 共同 root 鎖的具體證據

最新 receipt `native-mluwwp/receipt.json`：writer A PID **3600**，B PID **42428**，observer **14836**，setup **29020**，fresh readback **43196**，均是同一 owned `data_directory`／`127.0.0.1:10420` 下的不同 backend。

- N2／N3：`pg_stat_activity` 為 `active / Lock / transactionid`；`pg_blocking_pids(42428) = [3600]`。
- N2：B 未獲准的 `transactionid ShareLock` 對 transaction **774**；另有 `ship_dynamics_record_workspaces` tuple `(0,1)` 的 granted `AccessExclusiveLock`。
- N3：同型未獲准鎖對 transaction **779**；workspace tuple `(0,3)`。
- 產品阻塞點：`supabase/development/20260906_appdata_record_store.sql:447`：
  `select * into workspace from public.ship_dynamics_record_workspaces where workspace_key=p_workspace_key for update;`
- operation advisory lock 在同檔 **444**，以不同 operation ID 分開；不是此次兩筆排隊的共同 advisory key。
- 真 CAS 在同檔 **489–490**（collection `expectedIds`）及 **501–504**（entity expected）；RPC **沒有 expected workspace revision 參數**。本片 same-base revision 僅為觀察 metadata。
- `src/cloudBlockPatch.ts:104–134` 目前 producer 會為帶新增 entity 的 auditLogs／notifications 送順序 operation。N2 最先碰到 `order:auditLogs`，N3 因 linked task 新增最先碰到 `order:tasks`；不推論未到達的後續 CAS 都成功。

barrier 以 A 真 `BEGIN`→執行 RPC→保持未 commit、B RPC pending→observer 實讀 locks→A `COMMIT` 控制；10 ms polling 只是等待觀測成立，不以 sleep 或耗時閾值宣稱並發性能。

## 隔離與可重跑命令

先使用已驗證、repo 外的 runtime 與 node-postgres；**不安裝服務、不改 PATH／防火牆、不新增 repo package dependencies、不讀 .env／憑證、禁止使用失效舊 normalized runtime verifier**。

在 canonical repo 的 Git Bash：

```bash
export SHIP_QA_PG_BIN="$LOCALAPPDATA/hermes/cache/ship-pg-runtime-17.11-3/runtime/pgsql/bin"
export SHIP_QA_PG_MODULE="$LOCALAPPDATA/hermes/cache/ship-pg-runtime-17.11-3/client/node_modules/pg"
export QA_EVIDENCE_ROOT="$LOCALAPPDATA/hermes/cache/record-native-concurrency-b7a61b4"
node scripts/verify-record-concurrency-native.mjs
node scripts/verify-cloud-record-store.mjs
node scripts/verify-cloud-record-workflows.mjs
```

上述兩個 runtime/client 變數必須是**明示絕對路徑**；未提供即 fail closed。不提供 host／database／connection string 選项；環境中的 PG* 被清除、child env 移除 DATABASE_URL，Client 明確 `127.0.0.1`、動態 port、`ship_qa`、`postgres`、空 password、`ssl:false` 與 3/8/10 秒 connection/statement/query limits。每次 `mkdtemp` 建新 private data directory 及 `OWNED-QA.json`，以 `initdb -U ship_qa --encoding=UTF8 --locale=C --auth-local=trust --auth-host=trust` 初始化，再 localhost-only start；每一 connection 都 SQL readback exact data directory／host／port／DB actor，不把 `productionContacted:false` 當唯一防護。

native adapter 在完成上述身份驗證後才注入既有 fixture；完整沿用現行 schema/store/delta、Itinerary migration/seed、record read/write/report/data-management 與內控 seed。沿用 fixture 的 cron-registration omission，不安裝／啟動 cron。共用 fixture 仍開本機 loopback HTTP/Vite 供原 helpers，這次不開 browser、不發 HTTP 測試。預設 `databaseFactory=null` 仍為 PGlite。

每次 run 均保存 receipt 與 pg_ctl/initdb command start/end/exit、postgres log、輸入源碼 SHA-256。Windows pg_ctl stdout/stderr 必須接實際檔案 fd，不能 pipe；finally 即使 start 拋錯也依 owned `postmaster.pid` 決定 fast stop。正常結束查 pid file 消失、PG 與 fixture ports 已关闭，才依 exact marker 移除本次 data directory；runtime 及小型 receipts 保留，無正式資料清理。

## 收據、回歸與限制

本片 evidence root：`C:/Users/tuotu/AppData/Local/hermes/cache/record-native-concurrency-b7a61b4/`。

- `03-native-final.log`／`03-native-final-command.json`、`native-mluwwp/receipt.json`：最新六項全部 PASS，五個不同 backend，owned PG stopped、port closed、fixture closed。
- `05-store.log`：既有 PGlite store **16 SQL＋7 adapter** PASS。
- `06-workflows.log`：既有 PGlite／legacy oracle workflow **23** PASS。
- `07-default-fixture-final.log`：共用 fixture **1** decisive default probe PASS（以真 PGlite class `instanceof`，原 seed／readback／formal snapshot）。cache 下 `default-fixture.mjs` 保留精確重跑程式。
- `verification.json`、`boundary.json`、`commit-receipt.json`：機械去重、src/supabase frozen blobs、tested input bytes、exact staged tree／local commit／clean 與 process cleanup 身份。

不把上列不同層的 checks 相加稱為新增 E2E，也不把 native 重跑算成 12 個 unique cases。product bytes 未改，本片 **沒有新跑 typecheck/build/browser**；過往 build 僅歷史證據，不冒稱本片新 PASS。未要求獨立 review，未另派審查。

歷史失敗不覆寫：`01-native.log` 是 adapter 物件少一個結尾 brace 的 JS syntax harness failure（DB 尚未啟動）；`04-default-fixture.log` 是誤用 minified constructor 名稱 `O` 判斷 PGlite 的 harness failure，改用真 class instanceof 後通過。`02-native.log`／`native-ZXP1k6` 已執行六條，但 N6 的 operation status 遮蔽 case status、N4 收據 after 混入後續 lease handoff，屬收據欄位缺陷；保留舊 run、修正欄位並加 A-only reject ledger 後，以 `03` 取代，不捏造產品 FAIL 或修改舊收據。

另 `08-reconcile.log` 保留一次 integrity runner 失敗：native inputs 原本依 `fs.readFileSync(path,'utf8')` 計算字串 digest，reconciler 卻把 PNG 當 raw digest 比對。改為一致的 UTF-8 input digest 核對，並**另對全部 237 個 src/supabase 路徑（含 binary assets）使用 Git clean-filter blob 與基線逐一相等**，`09-reconcile-final.log` 通過；不把 UTF-8 replacement 解碼當 binary byte 證明，也沒有改測試過的產品／native script。三類 QA harness 修正與這次額外 bookkeeping 編碼修正均保留原失敗。

## 後續改善候選（本片不實作）

1. 先以原 App 多 client 證明真正 conflict→既有最多三次 rebase 重試→完整 confirmed publication／draft 保留；目前只證原純 helper＋真 SQL，沒有驗重試耗盡的 UI。
2. 針對 derived audit/notification ordering 的 shared CAS 評估 server-authoritative merge／順序處理；必須保留 append-only audit、retention、receipt signature、完整讀回與相容性，不直接刪 order operation。
3. workspace root 的 revision／history／collection order／receipt 提交仍需原子一致。可先量測 lock-held 工作量、分離可安全預計算步驟，再討論有界 internal 改善；**不直接移除 FOR UPDATE、operation lock、entity lease 或整體 task CAS**。

本片提供上述候選的 exact reproducer，不聲稱多人保存已「零衝突」或已完成 hosted 協作驗收。Push、部署、正式 SQL、使用者試用均未執行。
