# 模組化儲存隔離開發契約

## 授權與原版

- 原版基準：`edd95e984b29818b705e25a7485fd91bf04f8ace`。
- 保留分支：`baseline/pre-normalized-storage`；開發分支：`development/normalized-storage`。
- 現有 `main` 不合併改造、不 Push、不部署、不修改正式資料庫／設定／瀏覽器儲存。
- 使用者授權隔離開發及必要本機測試，未授權正式切換。每個驗證完成的階段形成獨立本機 commit。
- 續作方式：在既定範圍內連續實作、驗證及 commit，不因批次完成而停下要求「繼續」。到正式 SQL、Push／部署、缺必要授權或重大需求／安全取捨時才停。
- Push 前保留使用者試用關卡：使用者提出時開啟隔離測試網站，明示「真實 UI＋測試資料」，通過後才進入正式推送流程。試用通過不等同已完成正式 DB migration/readback；當前沒有代推或正式 SQL 執行授權。
- 同一實體工作目錄維持單一寫入者；一般子代理僅唯讀分析。接續實作須明確交接唯一寫入權，父代理暫停 repo 寫入／staging／commit／產品測試，交付或中斷核對後才接回。開發分支不是正式資料庫隔離措施。
- 可隨時停止；撤回恢復原檔及移除改造專用新增內容，不刪掉既有原檔，不丟棄期間其他獨立修正。

## 不變條件

- 不重建 UI、不切換至現有未掛載的 normalized App；除下列已批准文案例外外，保留可見版面、文字、控制項、導航、密度、操作方式、PDF 內容及登入方式。使用者最新明確授權：「可以，只改內部邏輯，畫面不變」「後面如果是類似修改，請直接進行，不需要問我的意見了」。因此不可見內部邏輯與元件傳參（包括 JSX props／回調／身份與權限版本）可在既定業務範圍內直接修改，不再因 JSX 字節變動反覆請示；這不是可見 UI／文案／權限政策／業務語意變更或 Push／正式 SQL／部署授權。
- 當前 ListPanel 修復可在「待辦總表／已結案」兩個呼叫點傳入真正的身份／權限版本及必要生命週期上下文；不以 exportedBy 顯示姓名代替身份、不改原可見操作。驗證須逐片明列不可見 props 的精確允許差異，核對其未進入 DOM 或改變版面／文字／操作；其餘 JSX／CSS 保留，不再錯稱含此差異的所有 JSX 原文相同。下文歷史「非 JSX／全部 roots 相同」只記當時切片證據，不限制此後已授權的內部傳參修改。
- 本批唯一文案例外（使用者已確認「允許只改這段提示，繼續實作」）：只修正 `src/DataManagementPanel.tsx` 的「刪除範圍」段落，移除寫死舊資料表的失實說明。新主句為「只會清理所勾選的歷史版本；不會改動目前版本、未勾選的歷史版本或正式業務資料。」原 Storage object／Lease／一般操作紀錄的保護說明，以及完整 revision 集合核對／有新保存時整次拒絕的說明保留。其餘 UI 文案、版面、按鈕、導航、操作及權限均不變；這不是其他可見 UI／樣式改動的授權，也不限制上列另已批准的不可見內部傳參。驗證必須把此唯一文案替換明列為允許差異，而不是再宣稱所有 JSX 原文完全相同。
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
| 完整業務流程接線 | 部分完成：原 App identity／船舶保存、Itinerary 讀寫、報告中心與資料管理 stats/prune 已本機接通；排程、全角色跨模組流程仍待驗 |
| 按需讀取／鎖／同步及四種耗時 | 待完成；尚無 hosted 前後效能證據 |
| 原／新版聯動與下游內容比對 | 部分完成：聯動 SQL、原船舶／Office UI、報告 SQL／adapter／UI 有界證據已具備；不等於整站與 hosted 驗收 |
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

## records 普通早會 server 排程切片：有界施工契約

本片只做明確 workspace、私有 development-only 早會排程入口：record 船／task／meeting／user 權威 → 同交易 report、append-only audit、逐筆 history／delta／receipt → 原 App 早會歷史讀回。先裝實際 schema 及最後有效 builder／scheduler 做真 SQL RED；不借 Owner session 呼叫 browser patch。保留台北星期一至五、原排程每次重跑更新同日報告、保留既有 manual source／created metadata 但重新取排程 snapshot 的語意；原手動 cutoff/window/internalControlCases 與排程不同，兩者明確隔離、不改手動函式。正式 Itinerary 六組值與 revision/首行 pin 仍來自正式 documents，draft/alternative 不參與。

必要 gate：PGlite owner 真 SQL＋SupabaseJS loopback、矛盾 records/legacy fixtures、最後有效原排程差異對照、工作日／台北日界、手動同日／重跑／exact replay、最後寫入失敗整體 rollback、完整 history/delta/audit 與未參與集合不變、至少一條原 App 真 UI 歷史顯示；共用 writer/workflow/history/delta 回歸、typecheck/build/diff 與凍結 UI source。只修本片可重現問題，harness 最多三輪定點修復，無獨立審查迴圈。禁止 cron 註冊／啟用／替換、manifest／預設／雲端設定、雙寫 legacy、督導早會／新報表設計、全站 mobile/PDF、Push／部署／遠端 SQL／使用者試用。PGlite 不證 hosted ACL/PostgREST/Realtime、多連線、真 cron 或正式效能。完整證據置於本片獨立 hermes/cache；驗畢獨立本機 commit 並交回唯一 writer。

## records-v1 內控↔要事原 UI 有界驗證契約

本片由原 main.tsx → App 進站／人員登入、內控清單／BatchCreateModal／CaseEditModal／TaskEditModal 產生命令，真 SupabaseJS → loopback → 私有 PGlite SQL → ACK／完整讀回／釋鎖。先以現行產品 bytes 跑最短 tracer；通過就補必要可重跑驗證，不製造產品 RED。只修可重現非 JSX API/save/identity/lifecycle seam；任何 UI／業務語意改動須停止決策。本片沒有新的文案例外。

必要：新增唯一雙向同步、來源／要事反向更新、兩端結案／重開清 closure；撤回刪 linked task／通知／dismissals 而留 open case，再同步新 ID；取消留普通 task＋closed 歷史 case／unlink；刪 case 刪兩端、刪 task 留 closed case。原授權正例與受限 role/scope 零寫入負例；至少一條原 UI lost ACK／linked CAS 故障及 draft／租約不提前釋放、同 operation status 對帳、ACK 後關閉／重開、無次輪 debounce 覆蓋。fixture 具有未參與 meeting/task/vessel、正式 Itinerary/history、矛盾 legacy users/head 並逐層讀回不變。沿用 SQL workflow/store/history/delta、internal-control／receipt／collaboration 回歸、typecheck/build/diff／精確 JSX/root 邊界；若改共享 QA，重跑原 8 browser＋4 hook＋4 mounted gate。最多三輪有證據的 harness 修正，產品缺口才依最小 RED→GREEN；不開獨立 review 迴圈。

證據保存在新的獨立 hermes/cache/record-internal-control-ui-*，保留每次 exit／失敗收據；本機 commit 後交回唯一 writer。禁止 Push／merge／部署／遠端或正式 SQL／credentials／設定／真 cron／使用者試用；未驗 hosted ACL/PostgREST/Realtime、多連線、性能、全站 mobile/PDF、完整會議三方流程／cutover，不以此片 PASS 取代。

本輪結果：原 UI 最短 tracer 通過後，反向保存實際被 SQL 以 `incomplete-vessel-audit-operation` 拒絕（`05-reverse-red`）；`saveTask` 現只為分類合併確實改變的一週關注船舶補同交易 audit，原分類／燈號語意不改。另 `10-delete-lifecycle-red` 證實 optimistic 刪除會在 ACK 前卸載 child 草稿；僅以相同 entity／lease／actor／epoch／generation 的非 JSX lifecycle gate 保留原 Case/Task editor，確認才按原流程關閉。真 SQL 過期租約拒絕後亦保留草稿；不宣稱失效租約可繼續寫入。

可重跑：`node scripts/verify-record-internal-control-browser.mjs`（11 原 App＋真 SQL 情境、5 原 Page/Modal controlled-I/O mounted 情境），`node scripts/verify-record-internal-control-boundary.mjs`（10 原 App source-executed predicate 情境；對 `c73928d` 的 242 路徑、51 JSX 檔／147 JSX roots 精確比對）。source-executed／controlled-I/O 不當成全 App auth race 或 SQL 證據。SQL store 16＋adapter 7、workflow 23、history 12、record delta SQL 7＋adapter 6、identity 6，以及 internal-control／receipt／collaboration 等適用回歸通過；共用 QA 原 8 browser＋4 hook＋4 mounted 及 report/data-management/morning 既有 gate 另留本輪收據。終端失敗測試頁只在證據保存後由 harness disposal，不冒充正常保存／關閉成功。

收據根目錄：`C:/Users/tuotu/AppData/Local/hermes/cache/record-internal-control-ui-32adc77dae/`，最新 UI 為 `47-ui-final.log` 與 `record-internal-control-browser-t1jtRL/evidence.json`；完整 commands／最終 manifest、full-index patch／raw Git blob archive 隨本機 commit 交付。前期 Windows readiness／native input／等待 async handoff 的 harness 調整超過原訂三輪，屬執行紀律偏差；所有失敗與真正產品 RED 保留，不覆寫成 PASS，不再擴新 review／驗收範圍。

## records-v1 臨會／專題↔決議要事原 UI 有界驗證

本片沿用原 `main.tsx → App → TemporaryMeetingsPage / TaskEditModal`，原進站／人員登入、導航、建立／編輯及操作按鈕觸發真 SupabaseJS → loopback → 私有 PGlite owner SQL。所有會議測試資料由原 UI 建立；復用既有內控 QA fixture 作為矛盾 legacy 權威與未參與資料，不改原 QA 模式、HTTP allowlist、設定、SQL、產品或 JSX。第一條保存 tracer 已成功，不製造產品 RED、不為改而改。

有限必要矩陣：兩決議／兩船只建立兩 task（共同與分船各一）；原 Task editor 進度保存、來源內容／分類／關注／涉船縮放再恢復保持 ID／歷史；共同決議完成／重開只同步 parent item，不自動結整場；v1 完成保 v2、兩船完成才同步 parent item，重開 v1 保 v2 及頂層／整場各自狀態；lost ACK 後原 draft／meeting＋task leases 保留，完全相同 operation envelope 查 committed status 後才釋放；移除來源事項保留已封存、解除關聯的 task 及歷史；原受限 operator 無會議寫入控制、無 foreign meeting、零 patch；新 document 重載、無 trailing debounce、未參與 cases/tasks/vessels/users、正式 Itinerary/history 及 legacy 不變，通知只到原接收者。

可重跑：`node scripts/verify-record-meeting-browser.mjs`（8 原 App＋真 SQL 情境），`node scripts/verify-record-meeting-boundary.mjs`（相對 `bbace3bc022c9296729fd6ba1e427fd29235a6c8` 的 242 source/public/SQL/root 路徑，51 JSX 檔／147 JSX roots 精確保留，CRLF 正規化另述，不作全站視覺驗收）。`QA_EVIDENCE_ROOT` 可指定 repo 外 cache 根目錄；每次獨立 Chrome profile／PGlite，所有失敗與 exit 保留，清理不覆蓋失敗碼。最終原 UI 收據為 `record-meeting-browser-dLemlc/evidence.json`、`14-final-ui.log`，根目錄 `C:/Users/tuotu/AppData/Local/hermes/cache/record-meeting-ui-a138b00038/`。

必要回歸：meeting-reconcile、meeting-vessel-progress、meeting-status-history／scope、related-durable source gate；record workflow 新舊 helper＋SQL 對照 23、store SQL 16＋adapter 7、delta SQL 7＋adapter 6、record history、identity 6；另 typecheck／build／diff／凍結 source、明確 paths staging、完整 full-index binary patch、raw-blob ZIP／extraction 與 commit 身分核對。這些層次不相加冒充 E2E。因本片僅新增 verifier／文件、共用 App／handoff／QA bytes 未變，不重跑無關內控 11＋5、船舶／Office 8＋4＋4 或整站套件。

本輪上述必要回歸、record history 12、typecheck（tsc --noEmit）、build（tsc 及 vite build）、diff／source 邊界均為 exit 0；build 仍有既有大於 500 kB chunk 提示，未改切包。本片未發現產品缺口。harness 修正有三類：初建 `vesselProgress=[]` 是原 helper 的懶建未完成投影，不能誤要求預建兩列（一次）；決議 async transition 要等待 SQL 讀回及原按鈕解除 busy（兩次）；重載必須證明新 document，不能被舊頁身份誤判 ready（一次）。每類未超過三輪，沒有改產品迎合 fixture。使用者本次要求的獨立 reviewer 已另派，固定只讀 `bbace` 快照審上一批內控；不涵蓋本片新 verifier／文件 bytes，不宣稱本片取得獨立 PASS，也不擴永久 review 迴圈。

未驗 hosted ACL／PostgREST／Realtime、真多連線、性能、全手機／PDF、全 batch／督導早會、正式切换及使用者試用；不以本片 PASS 取代。禁止 Push／merge／部署／遠端或正式 SQL／credentials／設定／cron；必要 gate 通過即獨立本機 commit 並交回唯一 writer。

## B1：原 Case/Task 草稿與 client 租約能力分離（待獨立複核候選）

本輪只修獨立 review B1，基線 `ed4775ddb2073ae37d918827c62578c460038384`。`scripts/verify-related-draft-continuity.mjs` 先在原產品執行 upstream renewal／expiry＋原 renderer，desired assertion 真 exit 1（`02-desired-red.log`），不是「重現 bug 成功」的 exit 0。另原 Case 已完成 lease cleanup 後的明確 Close 補 `36-close-red.log` → `37-close-green.log`。

產品僅非 JSX seam：handoff 的 exact entity／opaque owner／actor／identity generation／authorization epoch／coordinator generation／config continuity 與寫入能力分離；Case/Task 失租保持同一原 editor 為唯讀，不清 request generation、換成最新雲端 editor 或提前 release。Case 使用 exact-handoff、原權限過濾的唯讀投影維持原 Page/Modal，不偽造 `activeItemLeaseKey`；component-local draft 沒有被投影重建。規劃、補鎖及每次 submit 仍須真寫權，已送出的原 operation 可以只讀 receipt 對帳；global retry 也不得在保留的失租草稿上建立新 mutation。明確拒絕後的原 Cancel/Close 可安全重讀、處置並清鎖；unknown 不能當作 rejected 或成功來放行。單次直接 caller 檢查涵蓋 releaseCurrent／releaseExclusive、requireMutation、notice close、renewal loss/error、expiry、授權刪項 observer；未重設全站 lifecycle。

實際證據分層（不能相加成 E2E）：
- Source-composed：16 個 Case/Task × pending/settled × transport error／明確 loss／deadline／late renewal；每格執行原 release／mutation producer 與 renderer，exact 身份、live actor/epoch/generation/config 負控；另 2 個原 App submit/lookup＋真 receipt coordinator controlled cases，以及無鎖 Close／錯 entity 控制。
- 原 App → SupabaseJS → loopback → 私有真 PGlite：原內控 11；原 Page/Modal controlled-I/O mounted 5；既有 source predicates 10。`QA_RELATED_DRAFT_B1=1 node scripts/verify-record-internal-control-browser.mjs` 增強其中兩條：Case 原 30 秒續租 timer 真失敗時保持同 DOM/草稿且 fieldset disabled，原 operation committed receipt 核實後才正常關閉/release；Task 已被真 SQL 拒絕後，以 controlled scheduler 將 primary 30 秒 interval 延至 100 秒（未修改 SQL/RPC 回應），等待原 client expiry timer 真觸發，仍同 DOM/唯讀草稿、新寫與提前 release 0，再由原「關閉」明確處置。這不是僅 server 過期或等 250ms 的證據。
- 最新 B1 UI：`38-final-b1-ui.log`、`record-internal-control-browser-XQvZpV/evidence.json`；Task rejection 後實等 59,387ms 才見 client expiry 唯讀；same-node、draft、SQL readback、operation/release 順序和截圖均留存。
- 適用回歸：related durable／session exit、task-delete 14、creation／exclusive lease／vessel continuity／bundle／lock plan／recovery、receipt App/client/adapter、save-intent queue／feedback、internal-control runtime/projection、bootstrap/fast-path；meeting 原 UI 8、船舶/Office 原 UI 8＋hook 4＋mounted 4，全部最後 exit 0。`verified-gates.json` 記逐命令/exit/耗時；typecheck、Vite production build、diff gate exit 0，保留既有 >500kB chunk 提示。
- 精確 source boundary：242 路徑／51 JSX 檔／147 roots；本輪無 JSX/CSS、入口、導航、文案、元件位置、SQL 或雲端設定變更。

舊 verifier 三個 source 字串因實際 seam 改變而更新：per-intent 多了獨立 `canSubmit`、Case visibility 經 exact retained projection、related enqueue 明確傳 identity/read-only recovery 與 write-capability predicates。task-delete controlled-I/O 的 expiry 情境是「已合法 dispatch 後延遲 committed ACK」，所以現在允許確認成功；同 user ABA／epoch／config／coordinator stale 仍不得成功，新增 coordinator 負控，沒有把新寫入失鎖改成合法。兩次 browser harness 失敗為 CDP 回傳 DOM object chain、fieldset 子 textarea 應檢查 `matches(':disabled')` 而非自身 `.disabled`；修正沒有改產品 UI。另錯命令 `verify-cloud-save-intents.mjs` 的 MODULE_NOT_FOUND 已更正為 manifest 中 `verify-cloud-save-intent-queue.mjs`。所有早期失敗保留。

證據根目錄：`C:/Users/tuotu/AppData/Local/hermes/cache/related-draft-b1-2f8c3f3c/worker/`。終點為明確 paths staged、raw-blob exact tree 候選；不 commit，由父安排 B1-only 獨立複核後再決定。未重跑未變 SQL store/history/delta 全套；未驗 hosted ACL/PostgREST/Realtime、多連線、性能、全手機/PDF、部署或使用者試用。無 Push／merge／部署／遠端/正式 SQL／production browser／cron／新模組。

## records-v1 原內控批量閉環（本機）

本片基線 `8b614ac7ded143e7673b751e8beaa961afe1c4b2`；只原內控清單／BatchCreateModal 的批量新增→同步或不聯動→跨船勾選→批量結案／刪除。原登入及 `main.tsx → App`、JSX/CSS、文案、導航、PDF、權限矩陣、helpers、SQL／正式設定不改；不是首頁船卡批量、混合待辦選擇或分船會議批量。共用船舶是每次原新增 modal 的規則，跨船資料由兩次原 UI 批次建立；原新增列沒有產品筆數上限，不套用報告／prune 的 100 限制。

- 第一條原 UI＋真 SupabaseJS→loopback→私有 PGlite tracer 已在未改產品上 PASS（`01-tracer`）：兩列各自為案件，同步列只建立一筆唯一雙向 task，不同步列不建 task。
- 產品 RED `03-selection-desired-red`：批量結案 lost ACK 尚待同 operation status 時，原 Page optimistic 清單先把「已選 4」清為 0。只在原 Page 非 JSX seam 保留該次 selection 的讀取投影；仍依 exact actor／authorization epoch 及目前 vessel scope 限制。原 callback confirmed 才清選擇，false 保留，身份／scope 負控及 late callback 不恢復舊選擇；此投影不作寫入依據。
- `04-selection-green`／`05-batch-diagnostic` 另證實原批量顯式保存與 900ms debounce 重複入列，第一筆 committed 後尾隨保存被 `dependency:internal-control`／`dependency:internal-control-task` 攔下。App 僅對「無 taskIds、確有內控選擇」的兩個批量 command 精確 snapshot 加 WeakSet，排除同 snapshot 的自動 debounce；顯式保存、一般新 snapshot、mixed／分船命令及原 rebase／actor／CAS／lease guards 均不改。兩缺口一起在 `06-batch-green` 轉 GREEN。
- 可重跑 `node scripts/verify-record-batch-internal-control-browser.mjs`，可用 `--tracer-only`；`QA_EVIDENCE_ROOT` 指定 repo 外根。最終 `10-full-matrix`：8 條完整原 App／真 SQL 情境，另 8 條原 Page mounted controlled-callback 情境，兩層不相加冒稱 16 條 SQL E2E。含兩船／多列同步與獨立案件、原 create/cancel／confirm decline 零 patch、跨船兩端結案與原 closure/status/audit、lost ACK 保同 DOM 草稿及 selection／全鎖、same-envelope status 確認才釋放、closed-list 刪 selected roots／linked tasks、operator 原授權新增／結案正例與 foreign scope／delete 控制負例、新 document reload／零尾隨 patch、未選 records／正式 Itinerary/history／legacy 不變。
- 刪除副作用以原 `deleteInternalControlCase` 核對：不同於撤回同步，它保留既有 notification 與 taskDismissal；QA 以非空 fixture 明確驗證保留，不自行改成清除。前兩次 QA 錯誤預期保存在 `07`／`08`，不是產品 RED。`09` 的 catalog regex 漏了 `ship_dynamics_records`，只改 QA identifier allowlist；各類 harness 修正未超過三輪。
- 真 SQL fault：只讓整批其中一筆 linked task 的 exact-owner lease 過期，原整批 delete 回傳 `lock-conflict`；records／orders／history／版本／receipt 全表不变，selection 在 callback 後保留、零提前 release／零自動補保存。失敗測試頁的 teardown 不是正常業務 ACK／關閉成功，也不宣稱失效租約可新寫入。
- `11`–`40` 共 30 個適用 gate 命令全 exit 0：batch helpers 2、record workflows 23／store 16 SQL＋7 adapter／history 12／delta 7 SQL＋6 adapter／identity 6；B1 原 source-composed continuity、related durable、receipt client/adapter/App、task-delete、authorization/rebase／lock plan/recovery／queue／session exit、internal-control runtime/projection；另 B1 原內控 UI 11＋mounted 5（實 client renewal／expiry）、船舶／Office 原 UI 8＋hook 4＋mounted 4、meeting 原 UI 8。typecheck、Vite production build、diff PASS；保留既有 >500kB chunk 提示。
- `node scripts/verify-record-batch-internal-control-boundary.mjs` 對基線 242 source/public/SQL/root 路徑核對，51 JSX 檔／147 roots 原文相同；只有 App／InternalControlPage 非 JSX seam 允許差異。Windows working bytes 與 Git clean-filtered bytes 分記；不冒稱整站視覺／mobile／PDF 驗收。舊 B1 review receipt 不當本片 PASS，未新增獨立 review。

證據根 `C:/Users/tuotu/AppData/Local/hermes/cache/record-batch-internal-control-32a7e5159c/`；逐命令 log／exit、`record-batch-internal-control-browser-GokRK9/evidence.json`、raw-blob archive／exact extraction、完整 binary/full-index patch 及 commit readback 都保存在 repo 外。本片驗畢獨立本機 commit，交回唯一 writer。無 Push／merge／部署／遠端 SQL／正式 browserstorage／credentials／真 cron／使用者試用；未驗 hosted ACL/PostgREST/Realtime、多連線、性能、全手機/PDF、整站流程、cutover。

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

## 第七批：新逐筆版本的完整歷史重組基礎

### 已實作與不變界線

- `supabase/development/20260906_appdata_record_store.sql` 新增私有 `ship_dynamics_record_history`：更新／刪除時只保存受影響 row 的原 body 及 `[valid_from_revision, valid_to_revision)`。當前 row 的 revision 為其現行生命區間起點；同字串 ID 刪除再建立不混淆前後版本。排序／設定不複製無關 body，沒有每次寫入全 AppData snapshot。
- `ship_dynamics_record_versions` 僅保存每版 root（含設定、revision、updatedAt）及 ordered IDs；與可缺失的 delta `read_bases` 分表。清掉 delta 基準只能觸發真實完整讀回，不可被當作刪除歷史的授權。本批未制定或啟用任何 history retention policy。
- 私有 STABLE、security invoker 函式 `read_ship_dynamics_record_history_v1(text,integer)` 使用同一 statement snapshot，以當版順序重組原 AppData。每個 ordered ID 須 exactly-one body，另核對完整 active row 數；缺 body／重疊生命區間拋出 `record-history-incomplete`，缺版本 metadata 回傳 `status: missing` 且無 payload，不以當前／legacy 資料偽造歷史。
- 新匯入保留 import baseline；既有 development store 再套 DDL 不 backfill 已遺失的歷史 body，只在下一次非空提交保留當時實際 current baseline 與新版本。匯入及 operation replay 不增加歷史；body history、versions、read-base、實體、順序、workspace revision 與 receipt 在同一交易提交／回退。
- 新表啟用 RLS，所有新表／函式撤銷 PUBLIC／anon／authenticated 權限，沒有 browser grant。原 patch／write 授權、lease／CAS 規則未重做；legacy workspace／JSON history 留在原地，不 backfill、不刪除、不雙寫。

### 本機證據

- 新 runner：`node scripts/verify-cloud-record-history.mjs`。先執行 import＋同 row 兩次修改的 tracer test，實際 RED 為缺少歷史重組函式（SQLSTATE `42883`、exit `1`）；實作後 GREEN，最終 **12 項 PASS**，精確重組及比對資料庫所列 **revision 1–12 全部 12 版**，不排除根時鐘或未知欄位。
- 覆蓋設定及 server-stamped audit、純排序、缺 optional → 首次建立、原內控／要事 helper 聯動、刪除重用原字串 ID、未知 root／row 欄位、未受影響 row 的 body／revision／xmin／ctid 不變。測試資料含空白、前導零及非 UUID 原 ID，未 trim／重編。
- 後段 receipt trigger 先確認 history 與新 version 已寫入，再故意拋例外；讀回完整 record storage 狀態證明全部回退。lost-ACK 丟棄 ACK 後、lease 過期仍原 operation replay，history／versions 不增加；no-op、DDL／import replay 同樣驗證不增加。缺版本、缺 body、重疊區間均 fail closed，read-base 刪除不影響歷史重組。
- 同一 workspace 的 legacy authority 放入相同 revision 數字但不同內容，確認與新歷史分離；原 app_state／app_revisions／block_operations 資料及 legacy table columns／RLS／ACL 未改。新 reader／tables 以 anon、authenticated 實際呼叫均 permission denied，並核對 invoker、STABLE、search_path 及 PUBLIC EXECUTE 撤銷。
- 受影響回歸：`node scripts/verify-cloud-record-store.mjs` **16 SQL＋7 adapter PASS**；`node scripts/verify-cloud-record-delta.mjs` **7 SQL＋6 adapter PASS**；`node scripts/verify-cloud-record-workflows.mjs` **23 PASS**。store／workflow 的 rollback／replay 全表比對已包含兩個新 history objects。
- 新 runner 的 `--probe-failure-exit` 為故意失敗 sentinel；清理 Vite／PGlite 後才設定 exitCode，必須 exit `1`。真實 RED、GREEN、回歸、hygiene／fingerprint／commit stdout 及 exit code 保存在 repo 外 `C:/Users/tuotu/AppData/Local/Temp/record-history-verification.txt`，不把測試輸出寫入 repo。
- 本批沒有修改產品 TS／JSX／CSS、業務 helpers、設定資產或正式 manifest。typecheck／build 引用產品前 commit `ac343b5` 已有 PASS，不重跑未受此 SQL-only 產品差異影響的建置。未新增獨立 review gate；只做有界定點驗證。

### 仍未完成，不由此 PASS 取代

這是 development-only、owner SQL 層的可重組基礎，**不是資料管理 UI／回退操作／可上線 RPC 的完成證明**。dataManagement stats/prune 仍讀 legacy app_state 的 users／current revision；legacy history head 與 record history head 是不同權威，不能只憑相同 revision 數字合併或判定同版。尚未改資料管理、Itinerary、RPC 選路、WebSocket、多連線或 retention；原 UI 與 NormalizedApp 掛載不變。

完整歷史讀取仍須重組 AppData；每版 root／ordered IDs 仍有儲存成本。未補齊過往已遺失的逐筆 body，未把旧 JSON 歷史搬入新表，未提供跨權威歷史整合／回退寫入或正式 cutover rollback。沒有 hosted Supabase、真多連線、新 browser／Itinerary／全站驗收或效能量測。本批只做獨立本機 commit；Push、merge、部署、正式／遠端 SQL 皆未執行，正式操作與使用者試用關卡仍保留。

## 第八批：原首頁 Itinerary operational read 的逐筆身份接線

### 本機完成的第一條 read 鏈

- 新 development-only `20260906_itinerary_record_read.sql` 定義明確命名的 `sd_itinerary_record_actor_v1`／`sd_itinerary_record_load_many_v1`，都是 STABLE、security invoker、固定 search_path，撤銷 PUBLIC／anon／authenticated 執行權限；未加入正式 manifest 或 browser grants。
- `records-v1` 以目前 records users 的 active／四角色裁決。缺失、停用、未知角色直接拒絕，不能由同 workspace 舊 payload 或有效 membership 的角色救活。沿用原 UUID→legacyUserId／actorUuid／actorKey 映射：UUID 路徑保留 membership／profile 的顯示 metadata，非 UUID 路徑從 record user 取得原 name／username／department 欄位。membership 僅作既有身份映射，不能取代 record user 的 active／role。
- 正式船舶 metadata、active filter、document、revision、alternatives 仍直接呼叫現行 `sd_itinerary_document_for_vessel`，不拿 AppData vessel JSON／draft 拼文件；不覆寫舊 actor／loadMany，不看 record table 存在與否自動切換 legacy 請求。
- 原 `OfficeItineraryCloudRepository.loadMany`／`loadDocument` 明確依 storageMode 選路，新 RPC 缺失或出錯不 fallback。原 operational hook 使用包含 authority mode、credential key、read mode 的既有 `cloudConfigIdentity`，原 generation／identity guard 因此涵蓋同 URL／workspace 的模式切換及 key rotation。
- 未相容的 Office claim／renew／release／save 在 records mode 先拋出 typed `ItineraryRecordWriteUnsupportedError`，零 RPC，save 亦不進入 legacy operation-status recovery。這是明確缺口，不是完整 Itinerary 寫入功能。

### 實際驗證及分層

- `npm run test:itinerary-record-read`：**12 SQL＋4 真 Supabase JS adapter／封閉 SQL 傳輸案例＝16 PASS**。同 workspace record Vessel／legacy Owner／membership Owner、四角色、UUID metadata、inactive／missing／invalid actor、空列表仍先授權、缺新 RPC、Office 寫入封鎖、真正正式／備選內容一致均驗證。SQL 安裝／重套與讀回前後，所有 fixture `sd_*` 表及 legacy app_state 的 value／xmin／ctid 完全一致，包含有資料的正式 document history、有效 lease、daily report history。
- `npm run test:cloud-record-browser`：**5 原畫面情境 PASS**（原進站與 Owner 登入、真正 SQL 正式行程投影、船舶保存＋audit＋ACK 後釋鎖、reload 再開 editor、無修改取消釋鎖）。原首頁與 reload 均沒有 loadMany／行程讀取錯誤，正式上下港和貨物可見、備選不投影；UNSUPPORTED RPC 清單為空。原船舶保存不改任何正式 `sd_*` 資料／lease／report history，舊 app_state 仍空，Owner fixture 仍不放入 assignedUserIds。
- 同 runner 另在獨立 blank page 執行 **4 真 React hook／deferred repository I/O 案例 PASS**：舊 mode 成功遲到、舊 callback、舊 mode 例外遲到、同 mode key rotation。此層刻意控制 Promise 時序，不冒充 SQL／hosted；原 App browser gate 則每次 read 確實經 HTTP→PGlite SQL。這些共 **25 個分層情境**，不是 25 個 hosted／全站情境。
- RED→GREEN 分別捕捉 SQL 缺 actor `42883`、client 選到舊 RPC、Office claim 仍呼叫舊 RPC、同 workspace mode 切換未發新讀取、原 browser 新 RPC UNSUPPORTED。fixture 修正只涉及 PGlite 不支援 cron registration、DB actor_kind 的 office／public 值、ETA 必須帶 offset，未放寬產品驗證。早期 Temp 收據在交付前消失，因此重新重現 RED、還原候選並重跑 GREEN／回歸，以下只列重新持久保存的證據。
- 原 `test:itinerary` 聚合、record identity **6**、record store **23**、record delta **13**、record history **12** 均 PASS；typecheck／build PASS，保留既有 >500 kB bundle 警告。與前 HEAD 比對 **56 個 JSX／TSX／CSS 檔完全不變**；原 App **19 個 JSX roots** 與 baseline 相等。沒有改 props、label、導航或掛載 NormalizedApp。
- stdout／exit code、RED／GREEN／回歸與 commit fingerprint：`C:/Users/tuotu/AppData/Local/Temp/record-itinerary-delivery-74419431/verification.txt`。原 browser 證據與截圖：`C:/Users/tuotu/AppData/Local/Temp/record-itinerary-delivery-74419431/browser-evidence.json`、`C:/Users/tuotu/AppData/Local/Temp/record-itinerary-delivery-74419431/browser-home.png`。證據都在 repo 外，未覆寫先前 record-history 證據。

### 未完成與授權邊界

本批只關閉原首頁這條 operational read；**不宣稱整個 Itinerary、報告中心或資料管理已完成 records 相容**。Office 正式／備選保存、lease 操作與其他下游讀寫需後續獨立切片；public 船端與原報告 authority 未改。沒有新登入模型、hosted ACL／PostgREST／Realtime／真多連線／效能驗收或正式 cutover。封閉 service 使用 DB owner；既有依賴 SQL 僅在 PGlite fixture 執行，daily report 省略的只有不支援的 cron 註冊，不假造 report／document 函式。

採有界直接驗證，未要求獨立 review PASS。完成獨立本機 commit，未 Push、merge、部署、執行正式／遠端 SQL，也未向使用者開放試用網站。

## 第九批：records-v1 Office Itinerary 完整租約／保存相容切片

本批解除第八批的 Office write unsupported 阻斷；只完成本節列明的切片，不代表報告／資料管理或整站已可切換。

- 新增 development-only `20260906_itinerary_record_write.sql`：五個明確 `sd_itinerary_record_{claim_lease,renew_lease,save,operation_status,release_lease}_v1` wrapper。每個先用目前 record actor，保留原 UUID／metadata 映射和四角色語意；inactive／missing／invalid role 不會被 legacy payload 救活。固定 search_path、security invoker，撤銷 PUBLIC／anon／authenticated 執行權，未列入正式 manifest。
- 直接沿用最後生效的 `sd_itinerary_save_internal`（含 alternatives）及原 lease core，不改舊 RPC／helper／GUC／schema。正式＋備選、live anchors、單船 lease／fence／holder、CAS、operation receipt 與原 history 保持同交易；保留原 SQL 保存時釋放租約的行為，原 UI 確認後仍呼叫 release。公共船端免登入有效船及同 core 互斥不變，未改公共入口或強制搶鎖。
- 原 Office adapter 五路均依 storageMode 明確選路，缺能力或失敗不 fallback。實際重現同 operation 不同內容被 catch/status 舊成功 receipt 冒充成功；最小修正為 Office 明確 `operation-mismatch` 直接失敗，不再進 status。records 與 legacy regression 皆驗證；同 actor／workspace 的 exact replay 可跨 mode 讀同一原 ledger，不另建 Itinerary history，也不雙寫任何 AppData。
- 只改必要非 JSX seam：Dashboard fallback memo 包含 mode／key identity；同正式 workspace／actor 的 mode/key 改變不被當作關閉編輯器，不清除原 draft／pending。真正 workspace／actor cleanup 仍使用 captured backend；延遲 open claim/load/draft continuation 有 generation fence。原 Editor 的 inline renew callback 隨背景 polling 改變，曾令 30 秒 timer 不斷重啟；真瀏覽器 RED 捕捉後改用最新 callback ref，保持原 timer／操作／畫面。

### 本機實際驗證

- `npm run test:itinerary-record-write`：**21 真 SQL＋7 Supabase JS→封閉 SQL 傳輸＝28 PASS**。完整五路、四角色、active 權威、actor/workspace status、stale CAS、錯 fence／holder／actor／有效錯船 lease／expired lease、非法備選、operation mismatch、expired exact replay、ledger 後段例外原子回退、公船與岸端同 lease core 競爭、owner-only ACL／invoker／重套不變均驗證。正常保存逐表比對其他 AppData／report history 及另一船現存 document／lease 的 value、xmin、ctid 不變。
- 原 `main.tsx → App → Dashboard → ItineraryDashboard/Editor` headless browser：**8 場景 PASS**（原有 5＋Itinerary 正常保存／lost ACK 同 operation status 恢復／失鎖草稿保留）。真正 UI claim、輸入、實際 30 秒 renew、保存、SQL authoritative read、再開看到保存值、取消／釋放均執行。兩次成功各只增一版 document/history/ledger，備選保留；失敗不半寫、不釋放 successor lease。沒有直接呼叫 prop/helper 冒稱 UI 保存。
- 另 **4 原 hook deferred I/O＋4 mounted Dashboard/Editor controlled I/O**：mode/key 遲到讀取、舊 callback、草稿及 pending 完全保留、延遲 open 清理、真正 workspace cleanup。這些是 React seam，不冒稱 SQL／真多連線。
- 受影響 record read **16**、record identity **6** 通過；原 `test:itinerary` 聚合全部通過（stdout **23 個 PASS 標記**，不是宣称僅 23 個内部 assertion）。typecheck／build 通過，保留既有 >500 kB bundle 提醒。
- AST 比對 **56 個 JSX/TSX/CSS**：54 檔完全未改；Dashboard 1 個、Editor 2 個最外層 JSX 原文完全相同；App 19 個 JSX roots 與 baseline 相同。原 labels／導航／密度／CSS／有效業務 helpers 不改，不掛 NormalizedApp。截圖可見原編輯器、Revision 9、`QA ITINERARY RECOVERED` 和「真實 UI＋測試資料」。
- RED 分別為缺 wrapper `42883`、adapter unsupported、mismatch 被誤回 success、mode memo／誤 release／遲到 open、原頁 heartbeat 被 polling 持續重啟。另有測試層問題（blank page 缺 React refresh preamble、fixture 非標準 tableName、舊 constructor source assertion），只修對應 harness；不把 fixture crash 算產品 RED。

### 證據與仍保留的界線

完整 stdout／exit code：`C:/Users/tuotu/AppData/Local/hermes/cache/record-itinerary-write-59adaf2198/commands.jsonl` 及逐命令 `.log`；分層索引 `verified-results.json`；完整候選 patch／fingerprint／commit readback 亦在同 cache，未覆寫上一批。原 browser 證據：`C:/Users/tuotu/AppData/Local/hermes/cache/record-itinerary-write-59adaf2198/ship-record-ui-evidence-uNwFTg/evidence.json`，截圖 `itinerary-saved.png`、`itinerary-recovered.png`。最終 browser 的 errors／外連／unsupported 都為空，關閉後 loopback health 不再可達、Chrome 已退出。早期兩個 Temp browser 目錄已即時複製進此唯一 cache；最終 gates 直接寫 cache。

只做本機 PGlite owner SQL＋封閉 HTTP，**不是 hosted ACL／PostgREST／Realtime／真多連線或效能驗收**；未做所有 Itinerary import/export、跨登入／跨真正 workspace 的完整草稿恢復 E2E 或整站下游驗收。actor 傳遞沿用原系統，未新增登入／防冒名架構；新 RPC 對 browser roles 仍不可用。報告／資料管理、排程／retention、正式 migration／cutover 保持後續範圍。

採有界直接驗證，未新增獨立 review gate。完成後僅獨立本機 commit；沒有 Push、merge、branch 切換、部署、遠端／正式 SQL、正式設定／服務更動，也未開使用者試用站。

## 八、records-v1 報告中心六 RPC 相容切片（本機）

### 已完成的範圍

- development-only 六個明確 record RPC：manual save、list、locate、load-by-ID、Owner exact-ID delete、scheduled-date-only delete；原 `itineraryDailyReports` adapter 依寫入 authority 選路，缺 capability 不降級 legacy。
- 原 `sd_itinerary_daily_reports`／operations ledger 與正式 `sd_*` Itinerary authority 不搬家；保存只呼叫現有正式 snapshot builder，不接受 AppData／畫面草稿快照，不混入備選，不雙寫 legacy。
- actor 取 record store 的 active／role；即使舊 membership／AppData 聲稱 Owner，也不能救回 missing／inactive record actor。合法既有 ID 映射及原 replay-before-role 語意保留。
- 同日手動與排程報告並存、依不同日期分頁、strict bigint report-ID、set-token CAS、最多 100、相同 operation 對帳、receipt 最後一步失敗全交易 rollback 均有真 SQL 正反證據。日期刪除只動 scheduled，不傷同日 manual／正式行程／備選／history／lease。
- 三個原 TSX 元件只改非 JSX 的 async seam。mode、key、actor／role、workspace／table identity 與 generation 保護遲到 list／preview／manual／delete 回覆；pending 按 record authority 隔離，既有 legacy pending key 保留。

### 父代理最後實際驗證

證據根：`C:/Users/tuotu/AppData/Local/hermes/cache/record-itinerary-reports-0dd25b1afc/`。`commands.jsonl` 保留每個命令的 exit／log；`verified-results.json` 分層列出案例，不把重複回歸加算成新案例。

- `29-parent-report-matrix-green.log`：**16 個情境**＝12 SQL、2 真 SupabaseJS→SQL、2 adapter。
- `30-parent-report-browser.log`：**4 個情境**＝2 個原 App「登入→報告中心保存／歷史／預覽／lost-ACK reload 對帳」＋2 個獨立掛載原 DataView 的 Owner 刪除／lost-ACK 對帳。後兩個不是經完整 App 導航進資料管理，不能取代 stats/prune 的接線驗收。底層實際 loopback HTTP→PGlite SQL。
- 同一 browser runner：**6 個 mounted lifecycle 情境**，使用 controlled repository I/O；不是 SQL 或真多連線。
- `34-parent-shared-qa-regression.log`：原船舶／Office **8 個 browser 情境**＋4 hook＋4 mounted Dashboard/Editor lifecycle 回歸通過。兩個 stdout label 重複列出的 8 情境不重複計數。
- 原 `npm run test:itinerary` 聚合（含 daily/manual reports）、typecheck、build 通過；bundle 大於 500 kB 的既有提示保留，不擴切包架構。
- 全部 56 個 `src` JSX/TSX/CSS 檔核對：相對上批 `571a35d`，53 檔內容未變、3 檔僅非 JSX seam；相對最初 `edd95e9`，50 檔內容未變、6 檔僅非 JSX seam，App 19 個 JSX roots 保留。**只正規化 Windows checkout 的 CRLF/LF；不是宣稱全部工作檔 raw bytes 相同**。所有 JSX 與 CSS 內容相同，未作視覺重設計；此證據也不是整站像素級／mobile／PDF 全驗收。
- deliberate `--probe-failure-exit` 在 PGlite cleanup 後仍 exit 1，確認失敗不被關閉 DB 誤蓋成成功。

### 中斷與測試失敗的處置

兩個 worker 的 provider connection failure 都是程序中斷，沒有當作產品 RED／完成。父核对存留檔案、既有 logs 與無殘留程序後接回唯一寫入權，不丟棄有效部分、不重建 repo。最後一個 role 負例矩陣在顯式交易內預期拋 SQL error，首個 error 會使後續查詢只收到 `25P02`；用每例 savepoint／rollback-to-savepoint 修 harness，沒有放寬產品 actor guard。JSX 比對另排除已實證的 checkout 行尾差異，不改產品 JSX 以遷就 verifier。

### 明確未完成／未執行

只驗本機 PGlite owner／封閉 HTTP，沒有 hosted PostgREST／browser-role ACL／真多連線／Realtime／正式效能結論。六 RPC 保持私有 invoker，不改 grants／manifest／正式設定。未驗 scheduler 的 record authority、資料管理 stats/prune、retention、最新資料 cutover 與使用者試用。未有獨立 review gate；未 Push、merge、部署或任何遠端／正式 SQL。下一批仍依原 UI 逐流程接續，正式門前停止。

## records-v1 資料管理 stats/prune 閉環（本機）

- 新增獨立 `20260906_appdata_record_data_management.sql`：明確 record stats/prune RPC、私有邏輯計量 helper 與 `ship_dynamics_record_prune_operations` ledger。沿用最後有效原 prune 的參數、Owner／Admin 邊界、完整 revision-set CAS、100 上限及 actor/workspace/request 綁定的 COMMITTED／REJECTED exact replay；不借用 legacy receipt。
- stats 使用 record current/head、collections/items、版本 root 與有效區間 body。版本邏輯量為 `pg_column_size(root) + pg_column_size(orders) + 該版本可見的 body sizes`；共享 body 在不同邏輯版本各自計入，不等於獨占／可釋放磁碟量。prune 只移除人工選定版本 roots，本批明確不回收共享 body、不清 delta read bases、不建立 retention 政策。較舊版本未存 actor metadata，誠實顯示「未記錄」。
- `dataManagement.ts` 明確按 storage authority 選路；record pending namespace 獨立，原 legacy key 仍可恢復。帶錯 authority/workspace 的 persisted envelope 在 RPC 前拒絕，未知結果只以同 operation 對帳。
- 原 `DataManagementPanel` 保留全部 JSX／CSS／導航／控制與原確認操作，只有第 17 行批准的「刪除範圍」原文替換；非 JSX 加入 mode/key/actor/role/workspace generation fencing，遲到回覆與 retained callback 不可清除新 pending 或發布舊結果。
- 新 `test:cloud-record-data-management`：15 個真 PGlite／SupabaseJS→SQL 情境，以及原 data-management source contract、精確 JSX allowlist。包括矛盾 legacy Owner、current/missing/duplicate、100/101、真新保存後整批拒絕、ACK 丟失重送、錯 operation/actor/workspace/authority、receipt UPDATE 最後失敗全交易回退、rerun 與本機 catalog/role-denial。
- 新 browser gate：4 個完整原 `main.tsx → App` 的本機 SQL 情境（進站／Owner 登入→管理→數據管理→統計→勾選→原 confirm→清理→讀回；另含 lost ACK→reload→明確對帳）。每次清理逐一重建所有保留歷史，核對 current、正式 Itinerary、legacy、body/read-bases 不變。另有 16 個原 Panel mounted lifecycle 情境，採 controlled deferred transport；後者不冒充 SQL。
- 有界回歸：history 12、record delta 13；共享 QA 原船舶／Office browser 8＋hook 4＋mounted lifecycle 4。舊 PG CLI data-management DB/scale scripts 未執行，避免讀取 PGHOST；相關安全 oracle 已移至封閉 PGlite。本批無獨立 review gate。
- 證據：`C:/Users/tuotu/AppData/Local/hermes/cache/record-data-management-complete/`，保留 RED→GREEN／命令退出码／browser readback 與 fingerprint。前一份 `record-data-management-slice/` RED 阻斷收據未覆寫；其中直接呼叫 legacy stats 與舊提示的探針不是新 record RPC 的 GREEN oracle。
- 仍未驗 hosted Supabase/PostgREST/ACL、真多連線、Realtime、scheduler、retention、cutover、使用者試用與正式效能；未 Push、merge、部署或遠端／正式 SQL。私有 SQL 不加入正式 manifest、不改正式 grants／設定。

## records-v1 普通早會 server 排程閉環（本機完成）

- 最後有效定義：`20260806093000_daily_morning_reports.sql` 的 scheduler／publisher，`20260903230000_itinerary_daily_morning_projection.sql` 的 builder；實際 DDL 查得 `sd_vessels.id`／document `vessel_id` 為 text、revision 為 bigint。先原樣執行非空正式 builder pin，再捕捉新入口缺失 SQLSTATE 42883／true exit 1。
- 新 `supabase/development/20260906_record_daily_morning_scheduler.sql` 提供私有 invoker builder＋`run_ship_dynamics_record_daily_morning_v1(workspace_key,operation_id,captured_at)`。固定 clock 是隔離 owner-side 入口參數，不是 browser capability；真 cron 及 clock/工作區選定仍留正式 cutover 關卡，不加入 manifest／HTTP allowlist／預設設定。新 RPC/helper 對 PUBLIC／anon／authenticated 撤權。
- record 船、task、meeting、active Owner eligibility／attribution 為權威。Owner 不是假登入 session，audit 明示 `actorRole: system`。保留原始 record row 欄位（不使用舊 normalized 扁平投影覆寫 records），正式六組營運值仍直接 pin `sd_itinerary_documents`；fallback 的 `source: legacy` 標記只表示用 snapshot 中 record vessel 的整組資料，不查舊 appstate。
- 抽出既有 writer 的私有 materialization tail，共用 current／changed-row history／version／delta read-base／receipt 同交易；原 browser patch 的 actor/CAS/lease/order/audit 驗證仍在原 caller，未放寬。scheduler 只生成 report＋追加 audit，不清理其他集合／歷史、不雙寫 `sd_saved_reports`、`sd_audit_events` 或舊 AppData。
- 原 SQL schedule 與手動本來不同，已保留隔離：schedule 取全部合資格未結案 task，包含其舊規則允許的 future／無 meeting 的 temporary task；meeting 可因只關聯 inactive 船的 open task 而被保存。manual 有 cutoff/window、internalControlCases，且重存保留已凍結內容。schedule 同日不同 operation 重跑會更新 snapshot／追加 audit，保留既有 manual source／created metadata，但不保留手動 cutoff 內容；同 operation＋clock 只回原 receipt，即使現在 owner inactive 仍可 exact replay，不重新生成。週末／缺 active record Owner 為零寫入 skip，未建立 skip ledger。
- `node scripts/verify-record-daily-morning-scheduler.mjs`：13 個有界情境＝12 SQL＋1 真 SupabaseJS loopback（真 read/delta，scheduler HTTP 404 拒絕）。含最後有效原 scheduler 僅換名稱／clock 的同起始 transaction oracle、矛盾 legacy head99／records head1、task/meeting/owner、五個台北日界、正式首行排序與六組 pin、備選負例、同日手動／重跑／lost ACK、完整 1–5 五版 history、receipt 最後注入失敗全表 rollback、未參與列 body/revision/xmin/ctid 不變及 ACL denial／重套。deliberate failure sentinel 在 cleanup 後仍 exit 1。
- `node scripts/verify-record-daily-morning-browser.mjs`：2 個原 `main.tsx → App` 真 SQL 情境：原登入→報告中心空歷史→owner-side job→原「同步最新」經 SupabaseJS/delta 顯示 09:00自動歷史；原「檢視當日快照」顯示 record task／正式上下港及貨物→reload 保留。真 itineraryDraftStore 草稿与 alternative 不參與且前後不變；沒有匯出／列印 PDF。最後 errors／外連／unsupported 空，HTTP/Chrome cleanup 通過。
- 回歸：record workflows 23、store 16 SQL＋7 adapter、history 12、delta 7 SQL＋6 adapter；共享原船舶／Office browser 8＋hook 4＋mounted lifecycle 4。既有 morning-history 與 manual-cutoff runner 通過；前者過時 source assertion 仍在 App 找已移到 `ReportDailyHistories` 的按鈕，只修 harness 定位並保留其 source-test 標籤。typecheck/build/diff 通過，僅既有 >500 kB bundle 提醒。
- Harness 失敗均留收據：最初缺 core-domain 依賴不是產品 RED；browser fixture 的 fullName、連續 sortOrder／上一港只可首行修正未動 validator；一次 business PASS 後 Chrome cleanup true exit 1 不計完整 PASS，修為判斷 exit/signal 並只清自身 process tree。最終原 App／全部 src／JSX／CSS／登入／main entry／設定與正式 migrations 完全未改，未做全站像素/mobile/PDF 驗收。
- 唯一證據根：`C:/Users/tuotu/AppData/Local/hermes/cache/record-daily-morning-scheduler-3f2b6734d2/`。`commands.jsonl`／逐命令 log、scheduler-results、browser evidence/screenshots、完整 binary/full-index patch、raw-blob ZIP/extraction、候選及 commit/final receipts 同根保存，不覆寫前片。
- 本片只本機實作、驗證、獨立 commit；沒有獨立 review gate，skill reference 不是審查 PASS。未 Push／merge／部署／遠端 SQL／真 cron／使用者試用。仍不證 hosted ACL/PostgREST/Realtime、多連線、正式效能／排程啟用；正式切換仍須另行授權。

### ListPanel 批量完成／刪除：ACK 與精確身份（2026-09-06）

- 延續既有 tracer 與完成／刪除兩條真 SQL desired RED，不重開已完成的內控批量建立片。原證據完整複製至 `C:/Users/tuotu/AppData/Local/hermes/cache/listpanel-resume-20260906/prior-evidence/`；續作 `01-desired-red` 再現完成 selection 3→0。修復後在 held committed receipt 期間分別保留 3／2 筆選擇及完整關聯鎖；僅同 operation ACK 後清選擇、釋鎖。
- 本片唯一 JSX 允許差異：`src/App.tsx` 的兩個 `ListPanel`（`tasks={filteredTasks}`／`filters={filters}` 與 `tasks={closedTasks}`／`filters={closedFilters}`）各增加 **`batchContext={listBatchContext}`**。沒有傳到 WorkCenter 或 DOM。其值含 exact actor ID、既有 authorization epoch、session generation、config identity／既有 coordinator epoch、tab／view generation、role permissions；不是 exportedBy 姓名，也沒有 hidden global registry。
- ListPanel 僅保留這次選擇的讀取投影。身份／scope／filter／view 變更令舊投影失效，正常篩選仍保留目前結果內的選擇；同 actor ABA、config ABA、view ABA、unmount 與使用者新選擇均 fencing late callback。無選擇／無權限／pending 重按不 dispatch；reject／unknown 不自行當作成功清除。實際寫入沿用 App 最新資料、parent linkage、權限、CAS 與鎖驗證。
- 延遲 ACK 暴露另一個真產品 RED：同一 mixed batch snapshot 被 debounce 再排入 queue，第一筆已 committed 後第二筆在 `rebaseDisjointAppData` 出現 linked dependency conflict。`02`／`03`／`04` 收據保留；只把該 exact task/mixed snapshot 納入既有 WeakSet（不 suppress 後續其他 snapshot），沒有放寬 merge／SQL／通知／dismissal 語義。
- 原 UI 回歸 runner `node scripts/verify-record-list-batch-browser.mjs` 與 `--delete-probe` 分別 6／7 個有界 checks：登入、同來源 common＋per-vessel 兩決議／兩船、select-all/cancel、empty/filter、confirm decline、mixed completion、closed delete、同 envelope receipt、reload、未參與 rows／正式 Itinerary／history／legacy 不變、無 trailing patch；各自還測一次 exact linked-parent lease fault，整批 SQL storage 零部分提交、保選擇、不提前 release。已結案 IC linked task 原刪除 guard 整批拒絕、零 patch、保選擇並回滾已取得鎖，沒有弱化。分船 task 仍可 PDF 勾選但不能整體批量完成。
- 證據層分開：`record-list-batch-lifecycle-probe.mjs` 為原 ListPanel **33 mounted controlled-callback cases**，不冒稱 SQL；`verify-record-list-batch-lifecycle.mjs` 直接執行原 App declarations＋真 config coordinator，**16 個 planning／acquired-fetch 身份矩陣 cases**，不冒稱完整登入。B1 原 UI／真 SQL 回歸 11 checks，含原 30 秒 renewal 與 lease-expiry timer；另 5 個原 editor mounted probes。沒有再開 review。
- 精確 UI 邊界 runner 只移除上述兩個 named prop/value 後比較；242 source/public/SQL paths、51 TSX files、147 JSX roots，其餘完全不變；4 個 mutation negatives 必須拒絕 total/closed label、wrong context value、另一個 ListPanel data prop。舊內控 boundary 只接納同一精確 allowlist，不豁免整個 App。曾因 prop 位置觸發舊 positional source assertion，以及一次未提交接線誤擴至 WorkCenter，均保留診斷並在本片修正；不是放寬 UI contract。
- 完整命令、exit、first RED→GREEN、適用／不適用 gate、最終 path list／tree／commit、binary full-index patch、raw Git blobs ZIP／extraction 比對、owned QA cleanup 收據集中於上述續作 cache。只本機 commit；未 Push／merge／部署／遠端 SQL／真 cron／正式試用；未驗 hosted／Realtime／真多連線／性能／全手機 PDF。共享 QA 與 SQL 未改，不重跑全共享 8 browser＋4 hook＋4 mounted 或全 store/history/delta。

### WorkCenter 個人移除／共用完成／永久刪除（本機）

- 基線 `73228e6714bf1c18d6f14b17c095a4ab0c7b6edd`。唯一 writer 接手原 `main.tsx → App → WorkCenter`；只做原「我的待辦」三命令。個人 dismissal 不是共用 soft delete；永久刪除仍調用原共用批量 helper。原權限、普通／會議共同／分船語意、未同步內控、同交易聯動、稽核、SQL 及共享 QA 都未更動，亦未扩修通知「全部標記已讀」。
- 第一條個人移除 tracer 通過：原登入、原 confirmation、真 SupabaseJS → loopback → 私有 PGlite；held 同 operation receipt 時原選取與清單保留，SQL 僅加自己的 dismissal 與原 audit、無共用 lease、他人 dismissal／共用 task/case/meeting 等不變；ACK 才發布完整 confirmed snapshot，新 document 重載保存自己的隱藏。另一負責人經原人員登入仍可見同 task／未同步 case，foreign scope 不可見，operator 沒有永久刪除按鈕。
- 真 RED `03-complete-red`：共用完成 optimistic 清單於 ACK 前將 selection 2 清為 0。只在 WorkCenter 非 JSX 邏輯保留這次選擇的只讀 task／case 投影，按目前個人歸屬及可見船舶限制；寫入仍驗最新 App／SQL，不把 retained rows 當資料快照。confirmed 才清選擇，false／throw 不清；pending 防重按，身份／filter／scope／permission／新選擇／unmount 不讓 late callback 覆蓋。
- 原 App source-executed RED `04`／`06` 證實 WorkCenter 缺 session/config/view ABA fence，以及個人 dismissal 在 epoch／ABA 後仍會發布舊結果。現共用 batch bundle 將 `work` 納入已有 exact context，dismissal 開始／保存／讀回／錯誤呈現使用同一精確 context；不加個人共用鎖、不新增全局 registry、不用姓名當身份。App 唯一 JSX allowlist 是 named `WorkCenter` 的 **`batchContext={listBatchContext}`**（其 `data={roleVisibleData}`、`user={currentUser}` 保留）；prop 不進 DOM。可選 prop 僅保留未掛載舊 caller 型別相容，原 App 必須明確傳入真 context，無改動或驗收 normalized 入口。
- `verify-record-work-center-browser.mjs` 最終正常路徑 6 checks：個人移除／其他登入讀回、原 UI 建立 common＋distributed 兩船會議、ordinary＋common＋未同步 case 原子完成、full-result／empty/filter／分船完成排除、ordinary＋distributed＋未同步 case 永久刪除。三命令的原 confirmation decline 零 patch／claim；共用命令 held receipt 前選取與全鎖保留、ACK 後清選取／釋鎖，reload 及未選 rows／正式 Itinerary/history／legacy 不變、無 trailing patch。`--reject-complete` 與 `--reject-delete` 各 4 checks（前三條重疊）：只讓其中 case exact-owner lease 過期，整批真 SQL 回退，record/order/history/version/receipt 全表不變，selection 保留、零提前 release。
- 證據不混算：每條 runner 另有 **49 原 WorkCenter mounted controlled-callback cases**（三命令 × 16 outcomes，再加 12 筆跨原 10 筆分頁全選）；原 App declarations＋真 config coordinator 有 **24 controlled-I/O cases**，不是完整 auth E2E。ListPanel 必要回歸 7 原 UI／SQL checks＋33 mounted、原 App identity 16 通過。
- 最新適用命令按 command 去重 **34 個均 exit 0**，含直接 batch/dismissal、receipt client/adapter/App、queue/feedback、authorization/rebase/confirmed merge、lease/bundle/recovery、related/session exit、內控 runtime/projection、meeting/per-vessel、typecheck、production build、diff。共享 helpers／SQL／QA 未變，不重做全 store/history/delta、全 8＋4＋4 或 B1 長 timer。WorkCenter 精確 boundary 比較基線 **242 paths／51 TSX／147 roots**，僅移除上述一個 exact prop；4 個 negatives 拒絕 wrong context／callback／data 及可見 label。未改 CSS／導航／密度／控件／文案／登入／PDF。
- Harness 診斷保留：一次 navigation label 含動態計數；初 fixture Owner 船分派不符 normalize 已移除，後續產品 RED/GREEN 與最終矩陣均用合法 fixture；meeting 原建立狀態是「待召開」，只要求批量完成前後不變，不假定「進行中」。舊 batch verifier 三條直接-callback source assertions 改核新的 typed dispatcher（mounted 再驗精確 task/case IDs）。一次 Vite SSR transport timeout 未改產品，獨立重跑通過；typecheck 暴露未掛載 caller 缺 prop，以可選相容處理。保留全部早期 fail／exit；build 僅原 >500 kB chunk 提示。
- 證據根 `C:/Users/tuotu/AppData/Local/hermes/cache/work-center-20260906/`，`verification.json`、`final-gates.json`、正常 `record-work-center-browser-TQdk3f/evidence.json`、fault `AmqWxz`／`P9kcuB` 各子目錄及完整 patch/raw-blob archive/extraction/commit receipts。只做本機獨立 commit、完成後交回唯一 writer；無 Push／merge／部署／遠端 SQL／正式 storage／cron／使用者試用／新 review。未驗 hosted ACL/PostgREST/Realtime、真多連線、性能、全手機/PDF，不冒稱整站或正式切換完成。

### WorkCenter「全部標記已讀」有界恢復驗證

- 基線 `0144453a1b9d35f9f551aff2632953aa101ec197`；前 writer API 逾時後保留原部分成果，使用者暫停／明確恢復後核 HEAD 未變、index 空、相關程序與 agents 為零；未重建工作樹或重開已完成三命令。
- 原 UI → SupabaseJS → 私有本機 PGlite，固定原登入、WorkCenter、關鍵字篩選、「全部標記已讀」、身份切換、「同步最新（安全合併）」與新 document 重載。正常／lost ACK／SQL 交易拒絕／等待 receipt 時切換真身份，檢查自己所有未讀 readAt（包括篩選外與待辦外）、非空 audit、他人通知及所有業務集合不變；通知讀取不取得業務 lease。
- 已保存 RED：`notification-read-20260907/direct-red.json` 及 `record-notification-read-01K6Ye/evidence.json`，真身份切換後原安全同步把已 committed 的 root revision 2 變成僅本機 3。`prepareCloudSyncSnapshot` 僅在原 rebase／衝突驗證之後，內容已完全與 remote 收斂時回傳 remote 的獨立完整 clone；不放寬 actor／authorization／dependency／rollback guards，不新造無內容變化的 revision。
- 必要 gates：目前 direct notification／rebase／confirmed merge／authorization／block patch／receipt／queue／feedback、bootstrap／Realtime／browser recovery，以及四種原 UI 本機 SQL modes、typecheck、production build、diff 和 exact source boundary。較早 store/history/delta／linked UI／B1 長 timer 既有 PASS 不重算成這片驗收；SQL／共享 QA／JSX／CSS 未改，不重跑無關 normalized 舊入口與全站 mobile/PDF。
- 本片不新增獨立 review；必要驗證通過即本機 commit。禁止 Push、部署、遠端 SQL、正式設定／儲存修改；本機結果不證 hosted ACL／PostgREST／Realtime、多連線、正式效能或使用者試用。最終 gates 和證據置於 `C:/Users/tuotu/AppData/Local/hermes/cache/notification-read-resume-20260907/`。
- 最終本機結果：四種 browser modes 通過（按穩定 scenario ID 去重 6 個原 UI／SQL checks，跨 modes 的前置重疊不相加）；目前 source／QA bytes 綁定的適用命令、typecheck／build 與 diff gates 均保留收據。exact boundary 僅允許 cloudRebase 的兩行替換，其餘 JSX／CSS／SQL／入口不變。工具長時間停頓後先核無程序及測試 bytes 未變，僅接續未完成 gate；沒有以逾時冒充產品失敗。文件 EOF 空行格式失敗另修，原失敗 log 不覆寫。
