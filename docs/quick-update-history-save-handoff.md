# 快速更新：完整歷程與摘要的保存修正

## 本次範圍與狀態

- 修正快速更新共用保存佇列：首頁摘要的兩筆 `statusLogs` 不得當成完整歷程，比對遠端異動前，沿現有權威來源補讀必要的記錄詳情。
- 原 UI、權限、actor/session/config fence、CAS、不可改寫舊歷程規則、原子保存及 operation receipt 不變；不強制覆蓋，不以移除衝突檢查修復。
- 只改前端保存準備；無 SQL migration、無 Edge/Cron 變更。Push 仍由使用者操作。
- 本機驗證完成不等於正式保存已驗收。最初那次 `compact 原子區塊保存逾時` 缺少當次 operation/network 證據，起因仍未證實，不能斷言是網路，也不能用本機故障注入冒充正式事故重現。

## 已確認缺陷與最小修改

原 `enqueueCloudSave` 直接把 HOME 摘要交給完整歷程的 B/L/R 合併保護。另一端追加歷程後，先前可見的舊條目移出最近兩筆預覽；原邏輯誤以為它被刪除，因此即使本端只改另一艘船的動態也拒絕保存。

修正版使用現有 `recordRecoveryReadScope` / `unionRecordScopes`，擴充受影響記錄的詳情覆蓋，再執行未放寬的歷程與衝突檢查。補讀最多三次；完整來源轉換、早會及既有 full scope 沿原路徑。ACK 後的讀回與 confirmed cache 使用同一覆蓋範圍。

## 證據層級

### 原 App＋合成資料＋隔離本機 PostgreSQL

`npm run test:quick-update-history-browser` 使用原頁面、原保存入口、既有 SQL 與獨立 headless Chrome；外部瀏覽器請求被阻擋。每次產生 receipt、網路記錄、截圖及自有程序/連接埠清理結果。

| 案例 | 驗證 |
|---|---|
| QH01 | 健康開窗與取消，完整資料不變，零業務寫入 |
| QH02 | 另一端追加內控歷程後，快速更新保存一次，全部六筆歷程保留 |
| QH03 | 保存後重開，不產生額外業務寫入 |
| QH04 | native COMMIT 後丟失 ACK，讀回原 operation receipt，writer 只送一次 |
| QH05 | native COMMIT 後延遲回應，實際觸發原 12 秒 client deadline，仍由 receipt 確認，writer 只送一次 |
| QH06 | 私有 fixture trigger 注入 SQLSTATE 57014，真實 transaction 回滾，完整快照不變、草稿保留、無假成功 |
| QH07 | 移除測試故障後，用原保存按鈕再次操作，成功保存且完整歷程保留 |
| QH08 | 私有 fixture 故意改寫已信任舊歷程，原歷程保護拒絕，零 writer、草稿保留 |

最終八項通過。QH06 是故障注入，不是自然發生的 SQL timeout；QH08 是測試資料的刻意破壞，不是經正常 writer 授權的歷程改寫。

以 `QA_QUICK_BASELINE=1` 執行時，僅在測試伺服器記憶體中載入不可變基線 `084fc6bd1fbb0fd4f307528a8d0e6460b41b9d5b:src/App.tsx`。QH01 通過、QH02 因假衝突失敗；不覆寫工作樹。最早的 authority/fixture/normalization 配置失敗保留為 harness 證據，不列為產品 RED。

本機命令需要既有 `SHIP_QA_PG_BIN`、`SHIP_QA_PG_MODULE`、絕對路徑 `QA_EVIDENCE_ROOT`；可另指定 repo 外的 `QA_VITE_CACHE_DIR`。不得把 fixture 指向正式服務。

### 其他相關回歸

- `test:atomic-collaboration`：既有原子保存、回執、協作鎖、權限、重整與 B/L/R 回歸。
- `test:browser-authority-bootstrap`：46 個原 callback / controlled-read 情境，非 native UI 證據。
- `test:record-action-authority`：原 scope loader / action callback 的來源、會話與覆蓋範圍檢查，非 native UI 證據。
- `test:vessel-quick-update-scope`、TypeScript typecheck、production build。
- 測試維護：receipt source assertion 更新 const→let；managed-action closure 接入真實 scope helper 與原 baseline；bootstrap 測試補上原本遺漏的 neutral `relatedMutationHandoffInFlight` ref。舊基線同樣重現該 ReferenceError，未更改其斷言或產品 bootstrap。
- Build 保留既有 bundle-size warning；不為此改架構。Node localStorage experimental warning 不影響通過結果。

### 正式只讀核對

只呼叫 authority 與 scoped read RPC，沒有正式業務寫入、鎖定、刷新風險或部署。報錯所涉內控的完整歷程仍有三筆，HOME 只回最近兩筆，與缺陷機制一致；不把目前資料當成當時 request trace。

冷讀樣本約 7.25 / 10.77 秒、約 1.89 MB；帶實際版本向量的增量樣本約 3.13 / 4.08 秒、約 132 / 134 KB，分別零筆／一筆變更。這些是獨立唯讀 HTTP 樣本，不是使用者原瀏覽器的保存請求，不能據此斷定原 writer timeout 根因或承諾正式開窗速度。

## 交付與仍待確認

本次不新增 SQL，也不重部署風險函式。按既有流程完成本機 commit，交由使用者 Push origin；Pages 完成後才在使用者原操作中驗收。若仍有逾時，保留草稿與當次錯誤，不先清快取、不強制覆蓋，需按原 operation/請求確認提交、回執、讀回各階段。

每日 07:00 船隊風險自然排程是另一待驗項目，未被這份本機保存修正關閉。

本次自查與上述測試不宣稱獨立代理 review。詳細私有證據保存在 repo 外 `quick-update-save-repair`，不把正式資料內容或憑證加入 Git。
