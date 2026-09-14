# 匿名船端 Excel：真 PostgreSQL／來源往返後驗收

## 範圍與結論

候選 `6c57b5c42590a2c726e3386ddada5c133fa07035`／tree `4052d8893830059cd1506fae94f76e40eb852cd7`，650 個 raw Git source blobs父層逐一核對。原 `ship-itinerary.html → ship-itinerary-main.tsx → ShipItineraryPortal`，登入前先完成 records → legacy → records 最新資料往返；最後 source `records-v1`、epoch 2、legacy frozen。

**既有十個匿名船端 Excel 情境 SCOPED_PASS。** 只有 repo 外 QA runner／啟動與資料庫驅動型別核對調整；產品、UI、角色、SQL、範本、確認對話與保存語意未改。不是另做一個船端示意站。

此組為 **Vite 原入口＋實際 SupabaseJS＋native PostgreSQL獨立HTTP交易**，不是 production-bundle 全船端 Excel 情境，也不替代 hosted Supabase 或本人試用。production build 的原登入／多人保存／船端入口另見[本機試用交付](local-human-trial-handoff.md)。

## 十個原情境

| Stable ID | 已核對结果 |
|---|---|
| `ship-anonymous-latest-sql` | 免登入三船清單、最新正式內容、實際 public RPC、完整 SQL ledger 不變 |
| `ship-export-formal-only` | 原單船正式匯出，不含備選及其他船 |
| `ship-export-formal-plus-alternatives` | 原正式＋備選分頁，metadata與時區一致 |
| `ship-reject-wrong-vessel-preserve-draft` | 錯船 workbook 拒絕、保留當前草稿、零保存 |
| `ship-reject-multi-sheet-preserve-draft` | 多資料分頁拒絕、保留草稿、零保存 |
| `ship-manual-confirm-decline-zero-save` | 原上一港／報告時間／完整性確認選否，草稿不變、零保存 |
| `ship-import-draft-cancel-zero-save` | 匯入先成草稿；取消只釋放自有 lease，零業務保存 |
| `ship-manual-save-held-ack` | SQL實際提交後保持回覆，原UI仍待確認；釋放真200回覆後才成功關閉 |
| `ship-lost-ack-same-operation-status` | 真SQL提交後503，原UI查同一operation，不另存；status確認後成功 |
| `ship-new-document-readback-reexport` | 真新document重新讀取，重新匯出正式／全部方案皆符合最新實存版本 |

兩次實際正式保存、一次同operation status讀取；兩筆新增history／operation各與正式document、原request及public actor綁定。其他船、舊歷史、備選、record/AppData無雙寫；60張public tables的完整快照含xmin／ctid，對非目標變動與必要形式寫入逐項核對。

四個實際瀏覽器下載 XLSX已由原runner ExcelJS、ZIP/XML與父層獨立ZIP CRC／worksheet／公式結構核對。這四個船端檔案沒有另跑 Microsoft Excel COM；既有岸端三檔COM證據不冒充本組證據。

## 中斷與修正保留

- 子代理先因工具回執 `JSONDecodeError: Extra data` 停止；10 NOT_RUN、沒有產品執行或PASS，原 `delivery.json`／`terminal-handoff.json`不改寫。
- 父沿已保存的runner與650檔來源副本完成執行，未新開產品review。原來使用一般symlink的Windows權限錯誤改為已證實的junction；保留那次未啟動收據。
- 隨機HTTP port落在瀏覽器／Undici禁止區間造成 `bad port`；改為已檢查可bind的固定allowed port，並真正接入QA listen參數，不只設定未使用的環境變數。
- QA額外 `auth.uid()`探針在匿名角色下先被拒絕，尚未執行產品RPC；改核SQL role與JWT subject缺席，不增加auth schema授權，不修改產品public RPC。
- 衍生探針的JavaScript引用符號錯誤保留，修正後先做 `node --check`。
- native node-pg將直接讀出的int8 revision當字串，JSONB document則為數值。原strict equality因表示型別失敗；父驗證實際JSONB值一致與pg解析器後，僅改該欄為exact decimal string比較，原request／rows／history／operation及完整ledger斷言保留。

最後 `parent-attempt-6`與父 `parent-accept.py`均exit 0；六個父attempts不是六十個獨立情境，也不將未啟動的wrapper算產品測試。歷次失敗與部分PASS保留在私有cache。

## 證據與清理

私有根：`C:/Users/tuotu/AppData/Local/hermes/cache/ship-excel-native-6c57b5c/`。

- `contract.json`、原child handback、`source-identity.json`／`raw-source.zip`。
- `runner-parent.mjs`、`localqa-parent.mjs`、`setup.mjs`、`parent-resume-result.json`。
- `parent-attempt-6/evidence.json`、`receipt.json`、`source-cycle.json`、SQL statements、實際200/503 response、confirmed operation、完整ledger、PNG及四個原XLSX。
- `parent-acceptance.json`、`parent-artifact-inventory.json`：150個非source／非Vite-cache證據檔，另核650 source blobs；不混算其他驗收包。

自有HTTP／HMR／Chrome／PostgreSQL已停止，Chrome profile及一次性PG資料已移除，兩個dependency junction已移除；未操作其他服務。本人試用站使用不同根與資料庫，刻意保持運行。沒有canonical產品修改、Push、部署、正式SQL或正式資料操作。
