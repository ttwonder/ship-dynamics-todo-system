# 原 App＋真 PostgreSQL 雙人協作 QA

## 本片契約與結果

沿 `modular-storage-development.md`，輸入基準 `027a48b60db7d3adf0c54524ea62066884b7cdcf`。QA/docs-only；原 `main.tsx → App`、版面、操作、權限、產品 SQL、package 全部不變。本片未接 hosted Supabase／PostgREST／Realtime，沒有 Push、部署、正式 SQL、正式設定或使用者 Chrome profile。無獨立 review；不重跑不受影響的 typecheck/build，也不援引舊結果冒充本次執行。

事先界定核心 U1/U2、最多兩輪 harness 修理；U3 五人受控交錯僅餘額允許才做。本次一輪修理後 U1/U2 PASS，完成受影響基線即收尾；U3 **未執行**，不宣稱五人全部保存、三次 rebase 上限足夠、吞吐量或正式失敗率。

## 真實邊界

- 原 App 兩個獨立 Chrome browser contexts：Owner `qa-owner` 管 qa-v2；原有分船 operator `qa-operator` 管 qa-v1。兩人都從原進站密碼、人員 select、個人密碼登入，原船卡「快速更新」及「保存並關閉」送出保存。
- 使用既有 native PG 17.11／pg 8.23.0 runtime；每次新建 owned、loopback、隨機 port cluster。既有 private fixture 同時有非空 tasks、cases、notification、正式 Itinerary 與矛盾 legacy。
- `createNativeRecordQa(...,{httpTransactions:true})` 明確 opt-in；預設仍是舊單 setup client，不改 PGlite 預設。HTTP pool 上限 10，opt-in PG max_connections=24（預設仍 12），setup／observer／direct baseline clients 不服務 HTTP。
- 每個 pooled client 在首用前核對 exact data_directory、127.0.0.1、port、user、PID。每個 RPC 的 BEGIN、LOCAL role（適用時）、request.headers、實際 SQL、COMMIT／ROLLBACK 必須在同一 client；不同請求可獨立進行。
- 私有 `beforeCommit` 只在真 RPC 已執行、COMMIT 尚未完成時排程；沒有取代回傳值。共享 `setRecordFault.after` 是 COMMIT **後** hook，本片不以其冒充 PG 阻塞。
- 所有瀏覽器 request 限 qa.origin；CSP／Fetch guard 禁外連。只記 operation ID、payload 安全 hash、結果／conflict key、PID，不落 request body／guard／密碼。

## 分層 case

| ID／層級 | 實測結果 |
|---|---|
| U1／原 UI＋native SQL | 兩人分船 lease 同時有效。B 子元件內輸入未保存草稿；A 原 UI 保存 ACK／關閉／釋放自身 lease。B 原「同步最新（安全合併）」收到新 revision，畫面通知編輯中稍後刷新；同一 textarea DOM node 與草稿完整保留，B lease 仍有效。B 再原 UI 保存成功，兩筆唯一 audit。 |
| U2／原 UI＋native SQL，受控時序 | 兩個真 outgoing save request rendezvous，audit expectedIds 相同。A 真 RPC 後 COMMIT 前短 hold；放 B 後 observer 實測 `pg_blocking_pids(B)` 含 A。等待中兩 lease 保留、B 同 DOM 草稿仍在、未發生提前 close。放 A 後 B 實際 HTTP 200 內回 `block-conflict / order:auditLogs`；原 App 自行 fetch／rebase／新 operation 再送、HTTP SQL_OK／revision 5，原 UI ACK／關閉／釋鎖。沒有使用手動 write/rebase helper。 |
| N1–N6／native SQL＋原 pure helpers | 既有六 case 全部 PASS。包括真阻塞、order/entity CAS、聯動回滾、同 operation replay；其手動 rebase **不是** App 自動重試證據。 |
| Default fixture／PGlite | 1 case PASS，仍為 PGlite、兩船 Owner fixture、正式旁觀資料不变。 |
| 舊 batch-vessel browser tracer／原 UI＋PGlite | 4 case PASS：開兩船／完整 lease bundle、cancel 零寫入、單交易批量保存／audit、new-document reopen／no trailing save。 |

U1/U2 各自比對完整 before/after payload（只有原 operational mask、server revision／timestamp、兩筆合法 audit 改變），每 case 另以一條新 SQL connection＋兩份新 document 的原 cloud reader 完整讀回。新 document reader 是唯讀 helper 層，不冒稱新 UI 登入或另一套保存 UI。其他 records 的 value/revision/xmin/ctid，以及正式 Itinerary／history／矛盾 legacy 維持不變。

## 實際證據

Artifact root：`C:/Users/tuotu/AppData/Local/hermes/cache/record-ui-concurrency-027a48b6/`

- 原 UI PASS：`ui-Eks8kn/receipt.json`，U1/U2 個別 scrubbed 完整讀回與截圖同目錄。
- U2 真 backend：A **9256**；B **13248**；B `state=active, wait_event_type=Lock, wait_event=transactionid, blockers=[9256]`。
- B 原 HTTP operation 鏈：
  - `cloud-block-operation_1788829531207_8_f21f9240-1ec7-4a1e-8b9b-af88519d802e` → `block-conflict / order:auditLogs`
  - `cloud-block-operation_1788829531773_9_d9cec192-fad3-4ffa-85e4-905b19410c76` → `SQL_OK / revision 5`
  - 安全 payload hashes、兩次 HTTP 200、其間實際 read RPC、native transaction rows 均在 receipt；HTTP 200 本身不被當成保存成功。
- native baseline：`native-USgk3k/receipt.json`；舊 browser：`record-batch-vessel-5409aC/evidence.json`。
- `native-baseline-command.json`、`default-fixture-command.json`、`default-browser-sibling-command.json` 保存命令／exit；三命令均 exit 0。native stdout 若被工具縮短，完整 terminal log 的 path 已保留在命令 receipt。
- `verification-summary.json`：以程式彙整層級 case、237 個 src/supabase blobs＋2 package blobs 与基準無差異、UI runner input hashes 對應 PASS bytes。
- 代表截圖已親看：`U1-peer-ACK-draft-retained.png`、`U2-native-wait-draft.png`。後者可見「正在確認雲端…」且草稿仍在；圖片本身不拿來證明 SQL 阻塞。

### 一輪 harness 修理與可見觀察

首跑 `ui-JGS2k5` exit 1 卡在錯誤的「B 頁面應顯示 A 船 marker」oracle。operator 本來只看自己船，且原 App 在編輯中延後套用新雲端模型；實際回覆已是新 revision，草稿未失。修為 assert 原新雲端提示＋真 HTTP 新 revision＋同 DOM 草稿；另將 fresh reader 改成已存在的 `fetchCloudData(explicitQaConfig)` 唯讀 API。未改產品。

U1 截圖另可見原同步 toast「本頁沒有未保存修改，現在可以安全關閉或重新整理」，同時 child-only 草稿還在。此為本次可見的既有文案／草稿狀態落差，**未修復、未測試真的關頁或重新整理會否遺失**；不要把本片 PASS 解讀為此提示已正確或 child draft 可抗刷新。核心草稿持續／真保存契約有實測，不擴大成新的 UI 改造。

## 最小重跑（Git Bash，在 canonical repo）

```bash
export SHIP_QA_PG_BIN='C:/Users/tuotu/AppData/Local/hermes/cache/ship-pg-runtime-17.11-3/runtime/pgsql/bin'
export SHIP_QA_PG_MODULE='C:/Users/tuotu/AppData/Local/hermes/cache/ship-pg-runtime-17.11-3/client/node_modules/pg'
export QA_EVIDENCE_ROOT='C:/Users/tuotu/AppData/Local/hermes/cache/record-ui-concurrency-027a48b6/parent-run'
node scripts/verify-record-concurrency-browser.mjs
```

每次建立新 owned 目錄／port；不下載或安装 runtime，不接受 DATABASE_URL／host。改 native/shared 才需重跑 `node scripts/verify-record-concurrency-native.mjs`；預設相容性用既有 `default-fixture.mjs` 與 `node scripts/verify-record-batch-vessel-browser.mjs --tracer-only`。本片每命令均有 180 秒外部上限。

成功與首跑失敗都已停止 owned Chrome、HTTP/Vite、PG，查核專屬 Chrome/HTTP/PG ports、刪除 owned profile/data，保留 runtime 與 repo 外證據。未動使用者瀏覽器或正式服務。
