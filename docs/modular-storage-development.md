# 模組化儲存隔離開發契約

## 授權與原版

- 原版基準：`edd95e984b29818b705e25a7485fd91bf04f8ace`。
- 保留分支：`baseline/pre-normalized-storage`；開發分支：`development/normalized-storage`。
- 現有 `main` 不合併改造、不 Push、不部署、不修改正式資料庫／設定／瀏覽器儲存。
- 使用者授權隔離開發及必要本機測試，未授權正式切換。每個驗證完成的階段形成獨立本機 commit。
- 同一實體工作目錄維持單一寫入者；子代理僅唯讀分析。開發分支不是正式資料庫隔離措施。
- 可隨時停止；撤回恢復原檔及移除改造專用新增內容，不刪掉既有原檔，不丟棄期間其他獨立修正。

## 不變條件

- 不重建 UI、不切換至現有未掛載的 normalized App，不改 JSX/CSS、導航、密度、操作、PDF 內容及登入方式。
- 沿用現行業務函式；內控↔要事與會議→決議↔待辦為不同關係。必要聯動仍在同一提交內完成。
- 保存以 server ACK／同 operation committed 為準，未知結果不盲目重送，鎖釋放不繞過保存確認。
- 不為追求正規化擅自修改權限架構或重新設計整站。
- 過往聯動清單是線索；逐個流程以目前原始碼及行為驗證，不把舊未掛載候選的規則當成原版規則。

## 首批實作：權威增量讀回銜接層

目的：把傳輸與 UI 資料形狀分開，使既有畫面繼續接收完整 AppData，但重複讀回可以只傳輸變更記錄。這批不宣稱已完成資料正規化。

- 維持 `fetchCloudData` 的既有呼叫方式及原版預設行為。
- 新協議明確 opt-in，不修改現有設定資產，不探測／啟用正式環境。
- 伺服器回傳完整初始快照或帶精確基準的增量；客戶端不得使用可編輯的畫面／草稿當合併基線。
- 增量須包含伺服器在該版本的完整變更集合，包含刪除、順序、設定、通知、稽核及伺服器補寫欄位，而非只套本次送出的 patch。
- 快取綁定專案、key、table、workspace；並行請求不得把較舊回覆倒灌到較新快取。
- 缺基準可由伺服器明確回傳完整快照；未知協議、非法回覆、錯 workspace、abort、缺 RPC 均不得假裝成功。
- SQL 僅新增唯讀函式，使用既有表與 RLS、security invoker，不變更現行寫入、歷史 trigger、授權或鎖。
- 測試使用本機 PGlite 及封閉的 HTTP 替身；替身證據明確不冒充 hosted Supabase。

### 驗證與停止界線

必要：增量協議正負案例、實際 SQL 在 PGlite 執行與讀回、真實 Supabase client adapter→本機 SQL 整合、相關保存／聯動回歸、typecheck、build、原 UI／業務原始檔不變。

不適用於此批：完整 normalized 舊候選測試、未修改畫面的重設計／全站視覺調整、正式上線與 production QA。未要求獨立 review 迴圈；兩份只讀分析不是獨立審查 PASS。

修正只處理上述範圍可重現的失敗；不開啟無關全量審計。通過適用驗證即提交這批。

## 後續仍須完成，不能被此批 PASS 取代

1. 逐業務資料的權威儲存與交易命令，必要聯動保持原子性；不是永久以整包 JSON 作新架構。
2. 依完整業務流程逐一接線，包含新增、編輯、完成、重開、刪除、批量及副作用。
3. 按需初始讀取、逐筆／相關集合鎖與同步；量測打開、保存、釋放、同步的實際耗時。
4. 原／新版同起始資料的聯動與下游內容比對，斷線、lost ACK、並發測試。
5. 隔離的真 Supabase 驗證；正式站資料未用於本機測試。
6. 使用者另行批准的切換方案：取切換當時最新資料、完整核對、切換及可執行回退；不得用開發初期副本覆蓋正式資料。

## 證據標籤

本機測試通過 ≠ 真 Supabase 通過 ≠ 正式環境已切換。讀回負載減少 ≠ 真實網路耗時已改善。UI 原始檔未變 ≠ 已完成所有新後端下的 UI 功能驗收。

## 首批本機驗證紀錄

- `npm run test:cloud-delta`：25 個協議案例、18 個實際 PGlite SQL／Supabase JS adapter 整合案例通過。
- 原有 `test:atomic-collaboration` 聚合套件，以及 bootstrap safety、internal-control、internal-control-projection、meeting-reconcile、batch-tasks、batch-internal-control、normalize 均通過。
- 最後的 opt-in 延遲回覆保護補充後，重跑 cloud-delta、cloud-block-receipt、bootstrap safety、typecheck、build，全部通過；不影響原預設分支的業務程式未再修改。
- 與原版比較：既有應用程式僅修改 `src/cloud.ts`；56 個 JSX/TSX/CSS 檔未變，其他既有 `src` 檔也未變。`src/cloudDelta.ts` 是新增的非 UI 讀回模組。
- 本機 SQL 產生的 2,000 筆測試資料，修改一筆後：完整回覆 1,126,501 bytes，增量回覆 431 bytes。這只是該測試的傳輸量，不是正式資料量、線上速度或普遍加速比例。
- 型別檢查及正式模式建置通過；建置仍提示部分 bundle 超過 500 kB，本批未改切包／畫面架構。
- 未執行 hosted Supabase、真多連線／Realtime 或正式 UI 驗收；未執行任何正式 migration／正式設定寫入、Push、merge 或部署。
- 兩個子代理完成的是唯讀切入點分析，不是獨立程式審查 PASS；本批採直接可重現測試及定點檢查交付。

### 本機使用邊界

`npm run test:cloud-delta` 自帶隔離 PGlite 及封閉傳輸，無須任何雲端 key。新增 SQL 位於 `supabase/development/`，未加入現有 migration manifest；本批未更改任何現有設定資產，未自行啟用 `readMode: 'delta-v1'`，程式預設仍走原讀取方式。不要將這個開發候選當成可以立即上線的完整正規化版本。

本批的 SQL 仍從整包權威資料與既有歷史計算差異，因此尚有伺服器 JSON 比對成本；後續改成逐筆權威資料與變更索引後，才移除這個過渡成本。
