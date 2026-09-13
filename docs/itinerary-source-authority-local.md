# 原主會話 Itinerary：來源接線與草稿恢復（本機分片）

本片保留原 App → Itinerary 看板 → 原編輯器、欄位、按鈕、角色與業務模型。只調整內部來源、操作查回及非同步生命週期；沒有 SQL／grants 變更，也不是正式上線核准。

## 實作邊界

- 主會話讀取、編輯鎖及新的保存使用同一工作區的來源狀態。原始全域設定與其他登入／船端模式不改寫。
- 待確認操作保留 id／signature 與最小來源欄位；舊格式不憑目前來源重建請求，也不自動換入口。
- 已有 pending 時先查 captured-source status，確認 workspace／vessel／operation／簽章與結果版本；未確認不重新提交。
- 看板重開先處理已保存的 pending，早於 claim。確認成功後只在 IndexedDB 交易中刪除仍完全相符的那筆草稿，再讀目前正式版本；不將舊收據版本覆蓋較新正式資料。
- 編輯器在確認關閉及卸載時使舊一輪工作失效；續鎖結果、延遲持久化返回、保存結果及成功回呼均不得影響下一個編輯器。
- 關閉失敗後仍可再次操作，不讓被作廢的舊保存回覆恢復成功狀態。

## 證據層次

### 原 App＋隔離本機 PostgreSQL

原按鈕的有效 actor／lease／正式文件，在來源切換後曾真正收到 retired record-save 拒絕並保留草稿。候選驗證包括：

- 正常保存與 heartbeat、正式及備選完整結果。
- 回覆與立即 status 回覆遺失後，暫停期間只查回原操作；不重複寫入。
- 過期鎖不保存、保留草稿並保護接手者。
- IndexedDB pending 重開／base drift；後續另一次合法保存已推進正式版本，確認舊操作不回退最新版本。

### Chromium 受控掛載（非原生 SQL）

使用原 Dashboard／Editor 與原 LocalDemoItineraryBackend；只控制 I/O 回覆時機，草稿讀寫為真正 IndexedDB。三條行為 RED 為舊續鎖覆蓋新草稿、延遲持久化後舊流程覆蓋新草稿、舊 ACK 刪草稿並關閉新編輯器。正常保存、續鎖、取消、唯讀保留／丟棄、取消傳輸失敗後手動重試，以及取消再開後的 actor／config 邊界作相鄰控制。

延遲持久化的檢查允許更安全的「舊保存根本不再送出」，但仍逐一比較接手者的完整 IndexedDB 記錄、UI、lease 與回呼。調整後的檢查另在未修副本保持原 RED。

### 其他控制與回歸

來源 adapter、IndexedDB 條件刪除、`test:itinerary`、相關 record-read/write、型別、建置及原 JSX 邊界各自記錄，不相加成端到端案例數。

## 可執行回歸

```bash
npm run test:itinerary
npm run test:itinerary-record-read
npm run test:itinerary-record-write
node node_modules/typescript/bin/tsc --noEmit
npm run build
```

本機 PostgreSQL 與掛載案例另由版本綁定的 QA producers／收據封存；正式 receipt、實際命令、完整輸入、舊版 RED、候選 GREEN、控制與清理結果分開，不能用一次工具 exit 0 代替逐案結果。

## 尚未代表完成的範圍

- 活動編輯器未關閉便跨來源切換；所有 actor／config 原地切換變體。
- 任意舊版本／任意未知請求的完整持久 journal 或全域恢復。
- IndexedDB 無法安全比對或 localStorage 備援記錄存在時，保留記錄，不自動刪除備援草稿。
- 報告刪除、早會、公開入口改造、完整正反切換與全站整合。
- Hosted Supabase／PostgREST／ACL／Realtime、手機／PDF 全量、使用者試用、Push／部署／正式 SQL。
