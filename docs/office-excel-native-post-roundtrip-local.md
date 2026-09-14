# 岸端 Excel：原 App／真 PostgreSQL／來源往返後驗收

## 結論與範圍

**真實 UI＋測試資料，非正式環境。** 原六個岸端 Excel 情境 SCOPED_PASS，來源切換於登入前完成。產品、模板、UI、角色及逐船保存語意未改；不是船端、production bundle 或整站放行。

執行候選：`e9300e8e88061a9f9e87f6a6ee6b41b1969b6fb6`，tree `5f649bea4c5bb4ef91a73c7744d3d5c69a3fff2a`。保留既有 PGlite 證據，這次追加真 PostgreSQL 的同六項，不將重跑加總。

## 六項結果

| 穩定 case ID | 已驗操作及結果 |
|---|---|
| `excel-export-selected-formal` | 原按鈕實際下載兩艘選中船的正式行程；未選第三艘及備選不混入。L/U 多選、固定 offset、UTC metadata 與隱藏 metadata sheet 保留。 |
| `excel-preview-cancel-zero-save` | 修改實際下載檔，再由原 file-input 匯入；取消預覽後零 claim/save，完整業務 ledger 不變。 |
| `excel-selected-apply-per-vessel-ack` | 只選第一艘保存；hold 真 HTTP 200 時匯入框保持忙碌且沒有完成結果，收到回覆後顯示 Revision 8。只增加該船一次 history／operation。 |
| `excel-held-lost-ack-status` | 第二艘 SQL 已提交後實際回應 503；原 client 查同 operation，status 暫緩時不先顯示匯入完成，確認後不重複保存。 |
| `excel-lease-contention-partial-results` | 第一艘被另一編輯持鎖，顯示未覆蓋；第二艘仍獨立成功。保留原逐船結果，不改成全有或全無。 |
| `excel-new-document-reexport` | 真正新 document 載入並權威讀取後，用原按鈕重新匯出；資料、版本及 metadata 與保存結果一致，沒有尾隨新保存。 |

上述六項全部 PASS。來源流程為 records-v1 → legacy epoch 1 → records-v1 epoch 2，實際 pause/stage/publish/resume 後 admitted，退役 legacy 凍結。不是開著未保存表單跨維護的熱切換測試。

## 原始證據與父層核對

- 私有 native PostgreSQL、獨立 HTTP transactions；實際請求、200／503 response、同 operation status 與 SQL history／operation／讀回相互核對。
- 最終完整 ledger 含 60 張表；非目標資料、第三艘及非空 legacy 的 value／xmin／ctid 不變。兩次合法保存各自新增一次 history／operation，既有歷史及備選保留。
- 三個真 XLSX：`original-selected-export.xlsx`、`valid-edited-import.xlsx`、`reloaded-reexport.xlsx`。ExcelJS、獨立 ZIP/XML 與獨立 Microsoft Excel COM 唯讀開檔結果一致；每檔 22 個 XML 公式錨點與 Excel 辨識一致。原 workbook 未保存、未更動使用者已開啟的 Excel。
- COM 使用獨立新 PID、`ReadOnly=True`、`UpdateLinks=0`、`AutomationSecurity=3`、`CorruptLoad=0`，不儲存；自有 Excel 已退出。COM 對合併格的公式枚舉包含空續格，父 verifier 僅接受 XML 明確證明屬於公式合併範圍的空續格，公式錨點仍逐一精確核對。
- 父已查看部分成功與 lost-ACK pending 截圖。匯入成功依原 modal 的逐船結果判定；背景全域 AppData 已保存狀態不拿來當本次匯入成功證據。
- 父重新計算 762 個 artifacts、649 個候選 raw 檔及 1,590 個 runtime inputs，完整 path set／hash 一致；8 個 ports 關閉，46 個已記錄自有程序 PID 均不存在，資料／profile／依賴 links／Vite caches 已移除，原 logs／XLSX／截圖保留。
- 子代理僅一次 cache 收據撞名修正；兩輪證據保留。父 verifier 的合併格枚舉差異及修正亦保留，未重跑產品、未改 oracle 求過。

原始根目錄：`C:/Users/tuotu/AppData/Local/hermes/cache/office-excel-native-e9300e8/`。決定性證據在 `attempt-2/`，交接為 `delivery.json`／`terminal-handoff.json`／`artifact-inventory.json`。

父核對：`C:/Users/tuotu/AppData/Local/hermes/cache/office-excel-parent-e9300e8/accept.py`，實際 exit 0；`acceptance.json` 為 SCOPED_PASS。`terminal-handoff.json` SHA-256：`30e70eab666fdcb9d8363fdf2b7bf4de2d2db425cded738f9e6bb2e7a6ca0383`。

## 限制與交付邊界

本片使用 Vite 掛載 `index.html → src/main.tsx → App`，不是 production bundle 瀏覽器驗證；未重跑 typecheck／build，也未將舊 build 冒稱本輪產物。前端依賴以未變 lockfile 與保留 transient output 綁定，非新做整個 node_modules 開始前 byte audit。

不涵蓋匿名船端、全部角色、hosted Supabase ACL／PostgREST／Realtime 或本人持續試用。沒有獨立 code review（QA/docs-only 父核對）；沒有產品修改、Push、merge、部署、正式 SQL 或正式資料寫入。

本片只新增验收文件，不替代 [來源往返驗收](source-authority-roundtrip-local.md) 的其餘邊界；會議 PDF 原有 7.5pt 狀態標籤的嚴格 8pt 未符合紀錄仍保留。
