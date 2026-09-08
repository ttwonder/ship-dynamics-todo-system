# U3 五人受控原 App / native PG QA

## 事先驗收與限制（input 9ba26e6c）

QA/docs-only，產品 src / SQL / package / UI / 權限凍結。唯一 writer；只本機 commit，不 Push / merge / 部署 / production / user Chrome。最多兩次 harness 修理、單命令 180 秒。只新增獨立 runner，利用既有 default-off performanceTrace + preparePerformanceFixture 在 UI 啟動前擴充 synthetic fixture；不改共享 helper 或預設两船/兩人，故不重開未受影響 siblings / type / build / N1–N6。

- U3a：5 個不同 actor（1 Owner + 4 assigned operators）、5 個獨立 Chrome contexts、原 site/personnel login、各自原快速更新草稿與 lease。真 outgoing requests 按同 audit expectedIds rendezvous；4 個有界 round。每 round 真 SQL 後 pre-COMMIT 短 hold，observer 確認另一獨立 PID 真 Lock wait。只放行原 client fetch/rebase/new operation，不能 helper 重寫、假回傳或提高 retry。
- U3b：若 retry 耗盡，必須明確未保存、不誤報 success、不提前關編輯器、同 DOM 草稿仍在；未 ACK 船舶保持原值；成功者與非空 tasks/cases/notifications/formal Itinerary/legacy/未參與船舶之完整 ledger 不受破壞。合法有界耗盡不等於資料丟失。
- U3c：停止競爭，沿原 Sync / 重新保存提示恢复。Sync 若已真保存 model，記其 ACK，不額外 header Save；需要原 editor「保存並關閉」收尾時核零額外 business RPC/audit。完整 payload 新 SQL connection + 每個 actor context 新 document 原 cloud reader 讀回、lease 釋放、成功 operation 与合法 audit 一對一。

審核 oracle 依實際 App：`App.tsx:946` 在第4次 conflict 拋錯；`553` 顯示未保存/Sync/重新保存；`4346` 只有 operational delta 才增快速更新 audit；`4061–4063` Sync 有本機 model delta 時可能直接 enqueue/ACK 且保留 editor。不預設全部自動成功，不硬猜人工步驟額外 audit。

## 實測結果

U3a / U3b / U3c **PASS**，是一套受控五人時序的三個 stable 子案例，不是三套獨立 E2E。程式彙整：5 actors，4 人自動成功，1 人需人工介入且真恢復；5 個唯一 committed operation / 5 個合法快速更新 audit。共 15 個原 UI patch HTTP requests，10 次 `HTTP 200 / ok=false / block-conflict / order:auditLogs`；不以 HTTP 200 冒充成功。

| actor | vessel | 自動 attempts | 真 conflicts | 結果 |
|---|---|---:|---:|---|
| qa-owner | qa-v2 | 1 | 0 | 自動成功 |
| qa-operator | qa-v1 | 2 | 1 | 自動成功 |
| qa-operator-3 | qa-v3 | 3 | 2 | 自動成功 |
| qa-operator-4 | qa-v4 | 4 | 3 | 自動成功 |
| qa-operator-5 | qa-v5 | 4 | 4 | 耗盡；原 Sync 恢復成功 |

每 round 所有未完成者的真 outgoing audit expectedIds 一致。leader 真 RPC 後 COMMIT 前 hold；observer 實測 follower `active / Lock / transactionid / pg_blocking_pids` 包含 leader，各自是獨立 backend，operation 對應見 receipt。

| round | 同 base requests | leader PID | blocked follower PID | pre-COMMIT hold ms |
|---|---:|---:|---|---:|
| 1 | 5 | 43716 | 5116 (qa-operator-3) | 162 |
| 2 | 4 | 5116 | 22716 (qa-operator-3) | 47 |
| 3 | 3 | 13468 | 40872 (qa-operator-4) | 72 |
| 4 | 2 | 22716 | 40872 (qa-operator-5) | 62 |

本次 patch 最長觀測 HTTP window 485.957ms，小於原 12 秒 RPC timeout；僅核有界排程，不作延遲/QPS/容量結論。自動重試均有真 conflict、原 client read、新 operation / payload hash、下次真 SQL / HTTP 對應；無手動 Sync 混進自動 rounds。

### 耗盡與原流程恢復

`qa-operator-5` 第 4 次衝突後原畫面明確「尚未保存到雲端」＋先 Sync / 再重新保存 / 不要關閉；同一 textarea 與 exact marker 留在 editor，lease 保留。其他 4 人成功內容已寫入；未 ACK marker 尚未進 SQL；完整 payload 與旁觀 ledger 正確。

按原「同步最新（安全合併）」後，先前已提交到 App model 的內容由原 enqueue 保存，operation `cloud-block-operation_1788833234401_9_14050aa3-c0d4-4346-aeb1-235bebb45534`、revision 6。**沒有再按無意義的頁首 Save**。原 editor 尚開，但 exact draft 已獲真 SQL ACK；原成功 toast 是這次已確認內容的回饋，不把「editor 尚開」硬判成未保存，全文/圖片均保留。隨後只按原 editor「保存並關閉」結束編輯器，核零額外 business RPC / audit，最後 lease 釋放；沒有以 Cancel 掩飾。

全資料 oracle：1 個新 SQL connection＋5 個 actor context 各一新 document 原 `fetchCloudData` 完整讀回（唯讀 helper 層，不冒稱再登入 UI）。只有 5 船 operational mask、server metadata 與 5 個合法 audit 改變；qa-v6、非空 tasks/cases/notifications 等旁觀 records 的 value/revision/xmin/ctid，以及 22 個 formal/legacy 表快照不變。fresh readers 完成後再核全 payload / receipt ledger 無 trailing write。5 個唯一成功 operation 精確對應 outgoing audit ID 與 SQL audit，不重複計 retry。

### Evidence 與兩次 harness 修理

根：`C:/Users/tuotu/AppData/Local/hermes/cache/record-five-actor-9ba26e6c/`。

- 最終 `five-N8adcr/receipt.json`、`final.json` / `final.log`：exit 0。`verification-summary.json` 程式聚合；`input-binding.json` / `delivery-receipt.json` 綁 protected blobs、runner inputs、staged/commit tree 與 cleanup。native child commands 另有 receipt / `postgres-commands.log`。
- 第一次 `five-tUxQgq` / `attempt-1.json` exit 1：U3a/U3b、實際恢復/全資料已走到收尾，但雙人 runner 舊 allowlist 誤把 `App.tsx:1247` 原合法未保存 alert 列 unexpected。只增 exact alert + U3a + 真耗盡 actor 的受控分類，未知 alert 仍 FAIL。
- 第二次 `five-dFUUQW` / `attempt-2.json` exit 1：過強 oracle 禁止任何「仍開 editor」顯示成功，誤把真 ACK 的相同內容當成未保存。依真 revision 6 ACK/畫面/全 payload 修正為先核完整 SQL 與 exact draft，再記回饋；U3b 尚未 ACK 禁成功完全保留。未撤回或修改產品 feedback。共兩次 harness 修理，已收斂，不再擴張。
- 代表截圖 `U3a-five-pending.png`、`U3b-exhausted-qa-operator-5.png`、`U3c-ACK-editor-retained.png`，後兩張已人工檢視。圖片不單獨證明 SQL/DOM identity。
- input hashes 使用 `SHA256(JSON.stringify(exact UTF8 file text))`；App.tsx CRLF 不能被 Python `read_text` universal-newline 偷換。一次證據聚合讀法不符已修為 `read_bytes().decode()`，非 runner 或產品修理；final inputs 全吻合。
- 所有 run 的 owned HTTP/Chrome/PG 與專屬 ports 均停止，專屬 profile/data 移除；保留證據及既有 runtime，不動別人的服務。239 個產品 protected blobs 不變；shared helpers 和原 U1/U2/D1–D4/default PGlite fixture 不變，因此不重跑未受影響 siblings/N1–N6/type/build；父已核相同產品 bytes 的既有 gate 不新加成 E2E 數。

### 最小重跑

```bash
export SHIP_QA_PG_BIN='C:/Users/tuotu/AppData/Local/hermes/cache/ship-pg-runtime-17.11-3/runtime/pgsql/bin'
export SHIP_QA_PG_MODULE='C:/Users/tuotu/AppData/Local/hermes/cache/ship-pg-runtime-17.11-3/client/node_modules/pg'
export QA_EVIDENCE_ROOT='C:/Users/tuotu/AppData/Local/hermes/cache/record-five-actor-9ba26e6c/new-run'
node scripts/verify-record-five-actor-browser.mjs
```

QA/docs 本機提交、無獨立 review。真實 UI＋測試資料＋本機 SQL；非 hosted Supabase/PostgREST/Realtime、production、mobile/PDF、抗刷新草稿持久化或性能容量證據。受控最壞時序耗盡不代表一般五人必然失敗。U3 範圍未發現資料丟失、錯誤 ACK 或恢復失敗，不延伸為所有並發時序成功。
