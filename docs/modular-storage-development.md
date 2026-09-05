# 模組化儲存隔離開發契約

## 授權與原版

- 原版基準：`edd95e984b29818b705e25a7485fd91bf04f8ace`。
- 保留分支：`baseline/pre-normalized-storage`；開發分支：`development/normalized-storage`。
- 現有 `main` 不合併改造、不 Push、不部署、不修改正式資料庫／設定／瀏覽器儲存。
- 使用者授權隔離開發及必要本機測試，未授權正式切換。每個驗證完成的階段形成獨立本機 commit。
- 續作方式：在既定範圍內連續實作、驗證及 commit，不因批次完成而停下要求「繼續」。到正式 SQL、Push／部署、缺必要授權或重大需求／安全取捨時才停。
- Push 前保留使用者試用關卡：使用者提出時開啟隔離測試網站，明示「真實 UI＋測試資料」，通過後才進入正式推送流程。試用通過不等同已完成正式 DB migration/readback；當前沒有代推或正式 SQL 執行授權。
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

## 續作進度（工作分類，不換算工時百分比）

| 工作 | 狀態 |
|---|---|
| 隔離／原版保留／增量讀回 | 首批已本機驗證並 commit `d532f2c` |
| 逐筆權威儲存與原子保存 | 部分完成：九類原集合＋設定／順序的完整 patch 交易已接通；第三批要事／內控／會議等雙 SQL 案例通過，巢狀進度仍在 task row |
| 完整業務流程接線 | 待完成；船舶、要事、內控、會議、批量、設定、通知及稽核 |
| 按需讀取／鎖／同步及四種耗時 | 待完成；尚無 hosted 前後效能證據 |
| 原／新版聯動與下游內容比對 | 待完成；首批舊路徑回歸不等於新寫入路徑驗收 |
| 隔離真 Supabase 協作驗收 | 待環境與測試，禁止用正式 DB 測試寫入 |
| 最新資料切換及回退演練 | 待完成；正式操作另行授權 |

### 本批範圍與驗證界線

新增獨立 development-only 逐筆儲存：保留原字串 ID、每筆原 JSON 欄位、陣列順序及根欄位，回讀仍為原 AppData；這是相容的逐筆儲存，不是套用舊 normalized UI，也不宣稱巢狀分船進度／所有欄位都已拆完。原表不雙寫、不搬正式資料；新 RPC 預設撤銷 PUBLIC／anon／authenticated 執行權限，不列入正式 manifest。封閉測試傳輸由本機資料庫 owner 執行；沒有為 browser 角色開啟此候選。

本批必要證據：無損匯入／回讀及 rerun 不覆寫，真 SQL 的單船保存＋audit、其他船不被覆寫、同筆 CAS、有效／錯對象／過期 lease、actor guard、整筆交易失敗零部分提交、同 operation replay／不符拒絕及 lost ACK；真實 client adapter 封閉傳輸整合；型別／build／UI 原始檔不變。其他業務寫入尚未驗收時明確拒絕，不偷偷降級舊全包寫入。

尚未接入正式設定與現行 UI 保存隊列時，不宣稱整個船舶 UI 流程已驗收；本機 SQL 獨立記錄證據不代表真多連線同時不等待。完整按需載入、Realtime、多連線與 hosted 效能留在明列的後續工作。採直接可重現定點驗證，不新增多輪獨立 review；通過本批適用驗證即獨立 commit。

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

## 第二批本機驗證紀錄：逐筆儲存首個切片

- `npm run test:cloud-record-store`：16 個 SQL 案例＋7 個真實 Supabase JS adapter／封閉傳輸整合案例，共 23 個通過。
- 從現有 `saveVesselEditorDraft` 使用的 `applyItineraryOperationalWriteMask`、`applyVesselOperationalDraft`、`withAudit` 形成船舶 note 修改，經原 `buildCloudBlockPatch` 和授權驗證器送到新 SQL；沒有改這些業務函式或 UI callback。
- 額外在獨立 PGlite 執行原 SQL，用同起始資料／同操作比對新舊結果；只排除兩次獨立提交必然不同的根 `updatedAt`，其餘資料（含 audit 及伺服器網路欄位）一致。這只證明該切片，未冒稱所有聯動等價。
- 新權威保存只寫相關 vessel／audit 與必要順序及小型 revision／receipt；另一艘船的 value、revision、xmin、ctid 均未改，該資料庫舊 app_state 表仍無資料／無雙寫。對照用舊 SQL 在另一個獨立記憶體資料庫執行。
- 同筆 stale CAS、有效錯對象／錯 owner／缺漏／過期 lease、失效 actor guard、缺相關 audit、重複操作、整筆 SQL 中途例外回退、原 operation lost-ACK replay、不符 operation 拒絕、無變更 replay、500 筆 audit 保留上限均通過。
- 錯誤退出碼用故意失敗 sentinel 實測為 `1`；修正 PGlite dispose 可重設先前 `process.exitCode` 的 harness 問題，退出碼在清理後才發布。
- `test:atomic-collaboration` 聚合及 bootstrap safety、internal-control、internal-control-projection、meeting-reconcile、batch-tasks、batch-internal-control、normalize 均通過。第一批 cloud-delta 的 25＋18 案例亦在本批 adapter bytes 上通過。
- `typecheck`、`build`、`git diff --check` 通過；56 個 JSX／TSX／CSS 原始檔未改。既有業務函式與原設定資產未改，只有 `cloud.ts` 既有 adapter 增加 opt-in 分支。
- 工作分支仍為 `development/normalized-storage`，原 `main`／baseline 不变。本批未 Push、merge、部署或操作正式 DB；唯讀來源盤點不是獨立 review PASS。

### 本批仍然不能宣稱完成的部分

`storageMode: 'records-v1'` 只在本機測試設定中啟用，不變更任何既有配置資產。寫入目前只接受已測的既存船舶 note／必要稽核切片；其他業務命令明確拒絕，舊 v1／整包保存不得 fallback。新 RPC 和表維持 browser 角色不可用，因此不是可推送上線的完整版本。

新記錄儲存的讀回目前仍重組完整 AppData，尚未把第一批 delta 協議接上逐筆 change cursor／按需 bootstrap；Realtime 明確未啟用，不訂閱錯誤的舊權威表。仍有小型 workspace revision 鎖與 audit 順序 CAS。上述限制需要後续對應工作解除，不能由資料列沒有互相覆寫就推論真多連線不等待或四種耗時已解決。

完整保存隊列／UI／身份／鎖釋放在新後端下的 E2E、要事↔內控／會議與分船進度、其他權限與批量流程、真 Supabase ACL/PostgREST/Realtime、多連線及 hosted 效能、最新資料切換與回退仍未完成。

## 第三批：原業務完整 patch 交易，畫面和業務函式不動

第二批的「只接受船舶 note」限制由本批擴充，不代表已完成整站 UI 驗收。

- 新 writer 接受與原 `buildCloudBlockPatch` 相同的九類集合、設定、排序。只写涉及的實體 row、發生變動的 ID 順序與小型 root/revision/receipt；不組裝全包業務 JSON 後寫回舊表。
- actor／授權域 guard、每個受影響業務實體 lease、完整原 row CAS、重複操作及最終 ID 集合，都在寫入前驗證；交易後段例外亦完整回退。新增帳戶連帶船舶分派沿用帳戶 audit，不誤要求每艘再造一筆「快速更新船舶」audit。
- `test:cloud-record-workflows`：23 個新案例，使用原 mutation／reconciliation／notification／audit／lock-plan helpers，將同一 patch 送至兩個獨立 PGlite 的原 SQL 與新 SQL，比對完整 AppData（只排除根提交時鐘）。涵蓋要事新增、內控新增與雙向修改、完成／重開、取消、撤回同步（含通知／dismissal 清理）、從 case 與 task 刪除的不同結果、會議來源同步、決議完成／重開、分船進度、混合批量、移除會議 item 的封存、指定 case 批刪、設定、帳戶分派、排序、報告與無 audit 的通知已讀。
- 衝突及 SQL 後段例外驗證實體、順序、revision、receipt 沒有半套寫入；排序不重寫其他實體 body／revision／xmin。角色驗證仍沿用現行 client 的授權層與 SQL guard；沒有偷偷換成舊 normalized Auth 模型。
- 這些是 SQL／原函式組裝驗證，不是所有 React inline handlers 的 E2E，也不是 hosted PostgREST、真多連線或瀏覽器角色權限證明。整場會議刪除、個別 inline 通知／audit 組裝與所有角色 UI 到 ACK 的完整接線仍須後續驗收。
- 本批 UI、業務函式、設定資產與正式 manifest 均未改。RPC 仍是 development-only、browser roles 不可執行；正式 DB／Push／部署零操作。

驗證：第三批 23 個雙 SQL workflow 案例、原 record store 16 SQL＋7 adapter、atomic-collaboration 聚合與 internal-control／meeting-reconcile／batch-tasks／batch-internal-control、typecheck／build 通過。建置仍有既有大型 bundle 警告。

後續順序：將 record authority 接上增量讀回與變更游標 → 原 App 保存隊列／同步接線及隔離瀏覽器驗收 → 真 Supabase／切換與回退。不能以本批 local PASS 略過任一項。

## 第四批：逐筆權威的增量同步讀回

- `storageMode: records-v1` 可明確搭配 `readMode: delta-v1`，沿用原 `fetchCloudData`、無改 JSX／CSS／業務函式／正式設定。讀取模式不切換寫入權威，legacy 與 records 游標分開。
- 新 `read_ship_dynamics_record_delta_v1` 用一個 STABLE statement snapshot，依逐筆 revision 索引取變更 body，以舊／新 ID 順序確認刪除、建立與排序；不讀 legacy workspace/revision，不需要比對兩包業務 JSON。
- 每次非空提交只另保留舊 root metadata＋ordered IDs 作讀回基準，不複製全部業務 body；該基準與實體、receipt 同交易。基準缺失／token 不符時回傳真實完整快照。這是增量讀回基準，不是完整可還原的歷史備份，不能冒充 cutover rollback。
- `test:cloud-record-delta`：7 個 SQL＋6 個真實 Supabase JS／封閉 SQL 傳輸案例通過，包含多次離線變更、刪除／短暫建立再刪除、首次 optional collection、設定／伺服器 audit、abort、舊回覆倒灌、權威模式切換與缺 RPC 不降級。
- 本機 1,000 筆合成 task fixture：初次回覆 1,102,816 bytes；修改一筆 body 的 delta 回覆 862 bytes。此量測沒有加 audit、沒有真網路耗時，不能解讀為一般 UI 保存速度或正式效能比例。
- 既有 cloud-delta 25 protocol＋18 integration、record-store 16 SQL＋7 adapter、record-workflows 23 案例及 typecheck 通過。rollback 的實際 readback 已加入 read-base 表。
- 尚未消除初始完整 AppData 重組、完整本機 normalize、小型 workspace revision 鎖與大型 ID 順序／audit order 競爭；read-base retention 也尚未制定。這些資料結構不等同四種耗時的最終驗收。
- 仍是隔離 development SQL、browser roles 不可用；未啟用正式設定／Realtime，未 Push／部署或更動正式 DB。下一項為原 App 保存／同步流程與隔離試用接線，不以本批通過宣稱整站完成。

## 第五批：原 App 權威身份與同步入口

- 舊 workspace/config identity 保留原字串，records mode 加上獨立權威識別；readMode 變更只切換 I/O generation，不改同權威的 durable revision floor。舊 cache identity 升級不再把 legacy base 承認為 records base。
- 原 App 的 config coordinator 與 sameCloudConfig 共用此識別，拒絕模式切換前／後才返回的旧保存结果；沒有重寫保存隊列或關閉／放棄草稿。
- 原 subscribeToCloudRevision 接到正確的 record workspace revision 表，App 沿用原 wakeup／延後同步邏輯；測試替身證明的是註冊目標與回調，尚不證明 hosted publication、RLS 或真 Realtime。
- `test:cloud-record-identity` 6 項通過，其中 3 項執行實際 recovery／App coordinator；另核對原設定來源優先序及同步 wiring。AST 比對 App 全部 19 個最外層 JSX 區塊與 baseline 完全一致；其餘 UI 原始檔不改。
- atomic-collaboration 聚合、record store 23、record delta 13、cloud delta 43、bootstrap safety、typecheck／build 通過。原「Realtime 禁用」測試依新增接線調整為「僅註冊正確權威，非真 Realtime 證明」。建置保留既有大型 bundle 提醒。
- 下一項為原 App＋真 SQL 的隔離瀏覽器保存／reload 驗證，以及仍讀 legacy payload 的下游 RPC 相容性；不能把這批身份修正視為已完成完整 UI／報告／資料管理驗收。

## 第六批：原畫面的本機 SQL 保存閉環

- `test:cloud-record-browser` 啟動只綁 loopback 的 Vite＋PGlite service 及全新 headless Chrome profile，使用原 main.tsx → App；沒有瀏覽器正式登入、正式 credentials、遠端 SQL 或正式資料。測試服務資產明示「真實 UI＋測試資料」，CSP 限制外部連線；RPC 白名單以真正 SQL 執行，不製造成功回覆。
- 四個真瀏覽器核心場景通過：既有進站／Owner 密碼登入；船舶近期動態保存＋一筆 audit／另一船不變／durable 後釋放鎖；重新載入並再開原 editor 看到保存值；未修改取消不新增 revision，鎖亦釋放。legacy workspace 保持空表，沒有大 JSON 鏡像寫入。
- 測試先抓到合成資料把 Owner 放在只允許 admin/operator 的船舶分派名單，normalize 會剔除而 SQL 正確拒絕未帶 guard 的隱含權限變動；已只修 fixture。產品授權規則、保存函式與 SQL 都未為此放寬。
- Chromium DOM readiness 與原「同步最新」確認對話框已用實際事件處理；只接受該明確確認文字，其他對話框使 gate 失敗。測試結果及請求時序寫到本機 Temp 獨立 evidence.json；服務與測試 Chrome 於結束後關閉。
- 明確缺口：此服務還未掛 `sd_itinerary_main_load_many`，因此畫面保留真實 Itinerary 讀取失敗提示；沒有替身掩飾，也不能把 CORE_FLOW_PASS 稱為全站/Itinerary/PDF/真 Realtime 通過。尚未向使用者開啟試用網站。
- 這一批僅新增 QA 腳本、npm 指令與本文件；產品 bytes 未變，沿用第五批已通過的 typecheck／build及回歸，不重跑不受影響的全套測試。
