# 管理頁有限按需讀取（MG1–MG5）

本片以 `810819eb51a42897a72484e1a56ecca25a9e2eac` 為基準，只改 `App.navigateToTab`：管理頁使用既有 `home`，並加入同一 actor/session/generation continuation 檢查。沒有新 SQL scope、RPC、欄位、UI 或權限政策。

## 實際驗證

- 原 `main.tsx → App → ManagementView`，合成人員與船舶，私有 loopback 原生 PostgreSQL；不使用正式設定或憑證。
- 冷進管理原始 RED 有 full read；GREEN 不讀全包或未選報告的大型快照。獨立 native full 模型與 home 模型的管理總清單、導航及人船數一致。
- Owner 全管理分頁與 audit、數據管理只讀入口；其他角色沿原權限可見／拒絕。數據管理保留權威專用 RPC，另與 native SQL 統計對帳。
- 原人員保存（非特權姓名），原船舶保存（有效操作員指派）：在 SQL 前以明確意圖建立 expected；原 outgoing request、SQL after、独立連線 fresh readback、完整業務圖與未選資料 physical rows 對帳。指派雙向一致，已指派者代管清理，audit 完整。另以真新文件重新載入確認。
- 原 UI target 展開後，hold 真 native home response，再轉到待辦總表；舊管理導航不得返回。其餘 actor/session/config/readMode、generation 與原管理權限 go callback 控制分層記錄，不冒稱 UI E2E。
- 固定 negative oracle probes 檢測錯名、未選資料／history／snapshot、遺漏與錯誤 audit、設定，以及人船 reciprocal／delegate 破壞。

## 執行

需要既有依賴、原生 PG runtime，明確設定 repo 外 `QA_EVIDENCE_ROOT`、`QA_VITE_CACHE_DIR`、獨有 `QA_HMR_PORT`、`SHIP_QA_PG_BIN`、`SHIP_QA_PG_MODULE`。不得用正式資料庫。

```
node scripts/verify-management-scoped-browser.mjs
node scripts/verify-management-scoped-controls.mjs
node scripts/verify-management-scoped-boundary.mjs
```

Browser inputs 的 SHA-256 配方是 `JSON.stringify(UTF-8 source string)`；command inputs 是 raw file bytes；Git clean/blob/extraction 另記，不互相混用。`readScopeCounts` 分 home / targets / full，`readCoverage` 每 call 分 root header、collection ids/rows；targets 空陣列不是沒有資料。

## 界線

`Management.setSaveNotice` 是原本 local 提示，`App.commit` 是原 setData mutation，不是 SQL ACK Promise。本片僅以實際 SQL ACK/readback 證明保存；沒有重寫全域 ACK／dirty／提示、Auth、RBAC、鎖或 saga。全角色／手機／PDF／hosted／正式 SQL／部署／使用者試用／Push 不在本片完成範圍。既有 PDF 獨立內控段落 assertion disposition 保留，不增 UI 或刪 assert。Independent review：NOT_RUN。
