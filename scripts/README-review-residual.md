# 有限剩餘缺陷回歸

僅 R6a-F1、R2a-F01、R6b-F2、R6b-F3、R5-F02、R3-F7，加 parent 已實證 R2b-F01；保留既有產品政策。不代表全站／hosted／發布 PASS。

先設定絕對 repo 外 `QA_EVIDENCE_ROOT`，與可用 native PostgreSQL 的 `SHIP_QA_PG_BIN`、`SHIP_QA_PG_MODULE`、`SHIP_QA_RELEASE_PREDECESSOR_MODULE`。已安裝 node_modules，不需重新安裝。Chrome 預設 Windows 官方安裝路徑。所有 browser/HTTP/SQL 都是 loopback＋synthetic；每個 probe 自行停 server、Chrome、native PG 並寫 receipt。測試仍需在 repo 根目錄執行。

- `npm run test:review:residual`：source 契約、原 App＋native PG、original mounted component＋controlled callback 分層回歸。
- `npm run test:review:residual:affected`：受影響的既有 tracking、meeting、projection、資料管理 aggregates。
- `node scripts/verify-management-ack-controls.mjs`、`node scripts/verify-management-scoped-controls.mjs`：分開執行且給不同 QA_EVIDENCE_ROOT，避免 controls.json 覆寫；160／23 為 controlled callbacks，不是 UI／SQL。

`verify-review-residual-ui.mjs` 的個別參數：`R6a-F1`、`R2a-F01`、`R2b-F01`。`verify-review-residual-data-native.mjs`：`r5`／`r7`。`verify-review-residual-data-browser.mjs`：`r2`（原 App／native）、`r3`（歷史 component callbacks）、`r7ui`（資料管理 component callbacks）。不把 case rows 加總成 E2E 數。

R3 新統計讀 admitted authority，新 prune 在 prepare 時捕捉該來源；舊 pending 保留原 raw namespace、operation ID、revision sets 與 RPC route，來源退役即拒絕，不轉派。native r7 的反向 publication 僅 QA 本機支持路徑，不授權正式反切或 hosted 發布。

已知舊 gates 的界線：`verify-record-data-management-ui-boundary.mjs` 把整個 src 固定在歷史 commit 377d004；現在多項已授權修改使其全站 byte freeze 不適用。本回歸另保留同一 DataManagementPanel 的 exact JSX 比較，原 gate 不刪改。舊 `verify-cloud-record-data-management-browser.mjs` 的 PGlite fixture 未裝目前 authority RPC，首次初始化失敗；未稱它 PASS，也未繼續重建整套舊 fixture。原 App 本機 native 與獨立原 Panel mounted 證據分開交付。PGlite data-management helper aggregate 的 authority response 明列受控 unmanaged fixture；business SQL 仍真執行。

`r7ui` 的 same-origin key/mode/actor 切換會產生既有 Supabase 多 client 診斷 warning；不隱藏，無 runtime error。R1-001/002/003、R3-F5 providerblocked，不由此 suite 驗證。
