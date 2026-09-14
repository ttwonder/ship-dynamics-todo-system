# 舊版日快照刪除：已提交／回覆遺失後的來源切換恢復

## 結論及證據層級

**真實原 UI＋合成測試資料＋本機 native PostgreSQL**。下列兩個獨立情境通過，父層核對後接受；不是 hosted Supabase 或整版發布驗收。沒有產品修正、Push、部署或正式 SQL。

目前 App 固定為 `0cf815d623a45b38cb4121bc3c17a20436a8809d`，tree `f9083e1e0659aaaf583dd1848d5d51ad8f123aa8`；本次提交僅更新說明文件，runtime bytes 不變。

| 情境 | 完整舊 App | 自然 pending／來源切換 | 新版原操作 |
| --- | --- | --- | --- |
| HIST-V2-COMMITTED-LOST-ACK | `443d7e5fa4616bd6f0577708f4e6b2a77a68f071` | v2 日期型；legacy → records | 對帳舊版本操作 |
| HIST-V3-COMMITTED-LOST-ACK | `85a13c14f5686b2a2d240cc8d70470f6a6104822` | unbound v3 報告 ID 型；records → legacy | 對帳上次操作 |

## 已實跑及核對

1. 完整舊 App 原勾選、確認及 dispatch；在放行網路與 SQL 前讀取自然 pending，不手動塞入 envelope、operation ID 或 sourceAuthority。
2. 真實 SQL COMMIT 後故意回傳 503；只有精確選取的報告被刪除，未選取報告與其他表不變，原 pending 留在瀏覽器。
3. 同 tab 進入同 origin 空白文件，完整核對 localStorage／sessionStorage；銷毀舊 document、排空 HTTP、關閉舊 Vite，再用 fresh service transactions 執行 freeze／pause／stage／publish／resume。
4. 維持同 origin、actor、raw config 開啟目前原 App，由上表原按鈕對帳；日期不轉 ID、不換 operation 或 set token。完整 request／result 匹配後才清 pending，顯示原成功文字。
5. 每案均以 fresh readers 比較對帳前後 **69 張表完整列（含 xmin／ctid）零變動**。兩次 RPC transaction COMMIT，只有第一次有實體刪除效果，不是再次刪除。
6. 切換後完整最新 payload、既有歷史及獨立 stores 保留。v2 forward stage 合法重建 task/member fence；預先從 source／target／初始 sequence 計算精確 keys/versions，不是放寬整表檢查。對帳本身不允許表變動。

## 收據與修正紀錄

- 證據根目錄在本機 Hermes cache：`historical-report-recovery-0cf815d`（v3）、`historical-v2-recovery-0cf815d`（v2）。含完整固定舊樹、執行器／scenario、每輪 inputs、command ledger、成功及失敗 receipt、清理與 handoff。
- 父層核對：`historical-report-recovery-parent-0cf815d/v3-acceptance.json`、`acceptance-v2.json`；核 current Git／Windows bytes、old raw ZIP／extraction、每輪 input hash、原生操作與清理。v3 舊包中的 v2 NOT_RUN 是歷史限制，本次 v2 收據已取代，不回寫舊交接。
- v3 修正同 origin 新分頁不能保留 sessionStorage 的 QA 假設；v2 修正未綁定的既有 stats RPC，以及 stage fence metadata 的 QA oracle。原失敗保留；没有藉此修改產品或重跑 v3。
- 測試服務／ports 已關閉，舊依賴 junction 已移除。DOM/native-input 證據，未截圖憑證表單。沒有為 QA-only 驗收重跑 typecheck/build，也沒有另開獨立產品 review。

## 仍未涵蓋

本片只接受 **COMMITTED + lost ACK**。未提交操作、無法識別／損毀 pending、全部歷史恢復、其他角色／手機／PDF、hosted PostgREST／ACL／Realtime／scheduler，以及本人試用站並未因此通過。Native HTTP adapter 以隔離 fixture 身分執行，檢查既有 anon EXECUTE 但未擴 grants；不能冒充 hosted browser-role 權限驗收。node_modules 目標內容沒有完整初始清單，不把 tracked bytes 核對說成整個依賴目錄的 byte baseline。
