# 原 App 多人聯動：來源往返後本機驗收

本片為 **QA-only、真實原 UI＋隔離 native PostgreSQL 測試資料**。產品／UI／SQL／角色政策不變，無 Push、部署或正式 SQL。

## 候選與範圍

- 執行產品基線：`4a4a5829682bc4454c56d17ab0fe4bb18c06a3bf`，tree `57df6ef50aa1a45b54e6abc344b3a37029827554`。
- 原入口仍為 `src/main.tsx → App`；沿用 `scripts/verify-record-mixed-workflows-browser.mjs` 的原 M1／M2 操作、實際出站集合、native pre-COMMIT barrier 與完整圖／歷史 oracle。
- 唯一情境前置：登入前以真實 service transactions 完成 records→legacy→records；目前來源為 `records-v1 / epoch 2 / resumed / admitted`。不是聲稱兩個未保存多人表單跨維護熱切換。
- 僅增加 browser-authority 路由與必要 schema。原 read mode、資料組合、原控制及 oracle 不改；安裝早會所需 SQL 時不載入早會投影樣本。

## 接受結果

| 穩定情境 | 原操作 | 結果 |
|---|---|---|
| POST-RT-M1 | Operator 新增一般要事；Owner 同時新增內控並同步要事 | PASS |
| POST-RT-M2 | Operator 更新上述一般要事；Owner 同時結案上述內控／關聯要事 | PASS |

- 兩個情境、四個 actor-stage、四筆實際業務 ACK；兩次原 App 自動衝突重試，手動補救零次。這些不是互相相加的 E2E 個數，也不是 QPS／正式失敗率。
- 兩次真實 PostgreSQL backend blocking；等待時原 DOM 草稿與協作鎖保留。每個 actor 每階段只有一筆成功操作，重試採新 operation 且中間實際讀回最新資料。
- 原完整業務圖、成功 revision history、audit 保留規則與未選資料 oracle 通過；新 SQL 連線及原 reader 新文件讀回通過。原兩份文件真正重新載入後，一般要事更新及內控結案清單仍可見，沒有額外寫入；原返回船舶編輯器的取消也不新增寫入。
- 舊來源保持 frozen；切換前初始歷史保存；全部協作鎖釋放。
- 父核對 645 tracked Windows 檔案、22 個執行輸入 hash、全部已宣告文字替換及原 oracle 保全。核對兩張 M2 代表畫面：pending 表單仍在且結案已勾，ACK 後表單關閉並顯示原成功提示；不可由截圖獨立推定 SQL 或真雲端結果。

## 保留的失敗與證據

第一次在 setup 即拒絕，沒有進入來源切換／UI 情境：我將早會投影樣本與內控 fixture 合併，早會樣本的孤立 `internal` 要事被原雙向關聯保護拒絕。原／合併 fixture 的最小對照已確認原因。僅將 DDL 安裝與樣本 seed 拆開；未修改產品、弱化 oracle 或刪改資料求過。第一輪檔案／收據保留，第二輪實際 exit 0。

本機 evidence root：`C:/Users/tuotu/AppData/Local/hermes/cache/mixed-post-roundtrip-4a4a582`。

- `acceptance.json`；成功 `attempt-2/mixed-cweIqu/receipt.json`、`attempt-2/command-result.json`；原始 `attempt-1/mixed-HzIVNJ/receipt.json`。
- `produce-run.py`、`runner.mjs`、`setup.mjs`、`derivation.json/.diff`、完整 preservation inputs；每輪 `frozen-inputs.zip`，以及 fixture 最小對照與修正紀錄。重現須保留對應產品基線及依赖，不把外部產物命令當正式部署工具。
- 成功 receipt SHA256：`a2f2156bb1f038786991daa090e4fce570a4cf9aee61c09dd4f12c5c2ee5c177`。
- 父核對 HTTP／Chrome／PG ports 關閉、owned data/profile 移除、自有 live services 零；工作目錄乾淨。

## 不擴稱

不代表全角色／手機／PDF、所有自然 dirty/unknown 恢復、所有會議工作流、真 Supabase ACL/PostgREST/Realtime/排程/吞吐或本人試用已完成。不重開已結案的 root/member 協議與管理熱切換／v2/v3 報告 COMMITTED lost-ACK 恢復。
