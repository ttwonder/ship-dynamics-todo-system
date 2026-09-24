# 跟蹤模組：多人保存與同步驗收

## 結論與證據界線

使用原始 `main.tsx → App.tsx`、原船端 `ship-internal-control.html`、兩位不同岸端登入者（Owner／操作員）、各自獨立的瀏覽器 context，以及兩個獨立船端 context。操作原有表單和保存按鈕，HTTP 實際執行本機原生 PostgreSQL RPC；使用獨立 observer 讀回資料，並在指定情境以不同 backend PID 和 `pg_blocking_pids` 證明交易確實重疊。

**全程為真實 UI＋測試資料＋本機 SQL，並非正式 Supabase 的多人測試。** 測試瀏覽器只允許 loopback，沒有正式帳號、正式業務資料或正式寫入。這是有限情境驗收，不是任意人數的壓力／吞吐量保證；也不宣稱「永遠不會衝突」。

## 新增多人矩陣：10 個具名情境 PASS

| ID | 真實操作 | 最終核對 |
|---|---|---|
| M01 | 不同登入者對同船不同項目同時保存 | 真正 SQL 阻塞／排序後兩項皆保存；操作者正確、各一筆歷程、不互覆 |
| M02 | 不同登入者編輯同船同一項，先送者 ACK 延遲 | 後送者因鎖／過期版本被擋；原輸入仍在；核對操作零寫入，明確重送後兩段歷程皆保留 |
| M03 | 批量更新中一項被別人先改 | 整批拒絕、沒有部分寫入；兩列原輸入保留，明確核對後才保存整批 |
| M04 | 主站內控編輯與另一位的來源進度競爭同一組關聯 | 關聯鎖阻擋後送者；主站完成後可重試，來源進度追加而不抹掉先前內控歷程 |
| M05 | 不同登入者從來源／主站要事結案及重開 | 來源、內控、要事的有效關聯同時更新；日期一致、沒有順帶改成已送船 |
| M06 | 一人刪內控，另一人持有舊來源表單 | 內控和原連結要事按原規則刪除，來源保留並標失效；舊表單不使已刪除資料復活 |
| M07 | 一人刪要事，另一人修改來源 | 內控按原刪除命令保留並結束同步、來源關聯失效；後續來源進度不恢復舊關聯、不重建 Task |
| M08 | 兩個船端同時向同船提報，岸端仍持有來源草稿 | 兩筆提報各保存一次、含報告人姓名＋職務；沒有自動建立要事；岸端後續保存不沖掉提報 |
| M09 | 一人保存已提交但回覆遺失，另一人再保存其他項目 | 原 operation／payload 精確核對與重試，僅一筆 receipt／歷程；另一人的較新修改保留 |
| M10 | 換全新瀏覽器 context，以兩個原角色登入重讀 | 來源與關聯狀態一致；另以獨立 SQL connection 比對完整資料／revision |

相同項目衝突的 PASS 指「拒絕靜默覆蓋、保留輸入、可明確核對後繼續」，**不是兩人的不同內容自動合成同一欄**。批量的 PASS 指整批成功或整批拒絕，不把被擋下算成保存成功。

## 既有主站及船岸回歸

- `verify-record-concurrency-browser.mjs`：U1／U2 兩個不同登入者保存情境，加 D1–D4 四項未送出草稿、頁首保存、取消零寫入及乾淨頁成功提示檢查。U2 證明真正 SQL 等待、實際 order conflict、App 重讀／新操作自動重試成功，不是測試直接改資料。
- `verify-ship-internal-control-concurrency.mjs`：C01–C04 四項，涵蓋岸端編輯時船端新增、兩種先後順序的未提交交易重疊，以及新岸端清單／個人待辦重讀。原生鎖與自動重試均有實際 HTTP／SQL 證據。
- 跟蹤 UI：17 個原 App＋SQL 情境，另列 7 個 component-only 情境；不得混稱全部為多人 E2E。
- XLSX／匯入匯出：15 個原 UI 情境重新通過，包括已提交但 ACK 遺失、重複匯入攔截、真正 document reload 讀回及明確取消結案。
- TypeScript／production build 通過。既有 bundle 大小提示不是此次新增錯誤；沒有藉此調整架構。

## 本次發現及最小修正

實測曾重現：跟蹤表單提交被拒絕且輸入仍未保存，但協作鎖釋放後，頁首仍可顯示「已安全保存」。原生 UI 回歸先 RED，修正後同一斷言 GREEN。

現在跟蹤子表單的 dirty／pending 訊號納入既有 actor-scoped 私稿提示，完成或卸載時解除；頁首不再把尚未提交的跟蹤內容當成已保存。提示依目前頁面標示「跟蹤表單」，管理頁原文不變。**不改保存／lease／CAS／receipt／授權／SQL 邏輯，不把單純打開匯入窗口當成新草稿。**

測試本身另做有限修正：舊主站 runner 補上目前 client 所需的原有 migration prerequisites；匯入重載等待窗口關閉善後，並以 QA-only document nonce 證明確實換了 document。原生 alert 要從對話事件驗證，不能假設 alert 文字在頁面 body；Task 刪除的預期以既有命令為準，失效關聯不得繼續同步。中途失敗紀錄保留在 repo 外，不冒充全為產品缺陷。

## 重跑及追溯

```text
npm run test:tracking:multiuser
npm run test:tracking:browser
npm run test:tracking:spreadsheet-browser
npm run typecheck
npm run build
```

需使用既有本機 PostgreSQL／Chrome runtime 與 repo 外 `QA_EVIDENCE_ROOT`；不能將測試改指正式資料庫。矩陣指令順序執行新 tracking runner、既有主站 runner、既有船岸 runner。各自的真實 case ID 分開計數，wrapper 與重跑不是額外測試案例。

原始 logs／逐情境 receipts／截圖位於 repo 外 `tracking-spreadsheet-implementation` 證據根；最終精簡驗收、輸入 hash 與 commit 綁定存於 `C:/Users/tuotu/.hermes/reports/tracking-multiuser-20260924/`。測試自有 HTTP／Chrome／PostgreSQL 均停止並核對端口，沒有終止使用者的瀏覽器。

## 上線仍未完成

本次未改 migration／readback SQL，未執行正式 SQL、未 Push、未部署。仍按 [原發布交接](tracking-spreadsheets-release.md) 的順序：確認正確 Supabase 專案 → 使用者執行安裝 SQL → 獨立唯讀 readback → 使用者 Push → 核對 remote／Pages／正式入口。正式寫入多人煙霧測試須另確認測試範圍；本機 PASS 不替代正式環境驗收。
