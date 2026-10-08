# 每日早會保存修復：本機交付與正式核驗

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
