# 船端內控／訴求

## 功能與界線

- 獨立入口：`ship-internal-control.html`。沿用原站部署位置；不需要登入主站。
- 選擇目前啟用船舶，按「增加內控/訴求」，使用岸端原批量內控表單的共用元件，提交單筆或多筆（每批最多 100 筆）。
- **最新使用者要求：船端只能新增內控，不提供同步到要事、追蹤窗口或結案設定。** 岸端原有同步要事及結案功能不變。
- 船端只追加主站同一個 `internalControlCases` 集合，沒有第二份同步副本，不新增 `tasks` 或改動分管／代管資料。
- 分管及啟用代管沿用既有 `vesselResponsibilityIncludes`／工作中心選擇器；未啟用代管、無關人員不取得待辦。
- 選船是資料歸屬，**不是填報者身分認證**。來源標記為該船「船端未驗證」，不冒用岸端帳戶。

## 保存與恢復

1. 草稿按 Supabase URL、workspace、船舶分隔，儲存於船端瀏覽器；關閉輸入視窗不清除草稿。
2. 第一次提交前，先保存完整、不可變的提交內容及兩個隨機 UUID（操作編號與匿名客戶端標記）。保存本機副本失敗就不發送；本機空間不足時保留畫面輸入。
3. 每次送出先查同一操作的精確回執；只有不存在時才呼叫專用新增 RPC。重新整理不會自行再次提交。
4. 日期／選項／型別、未知欄位及批次限制由伺服器校驗；不接受用戶指定案件 ID、建立者、結案、要事、分管或任意 records operations。
5. 一個批次同一筆交易，一次 revision：所有新內控、初始歷程、audit、集合順序及回執一起保存，失敗全部回滾。
6. 只有回執的 workspace、船舶、操作、案件 IDs、筆數、revision 與時間等完整對上，才顯示「成功提交 X 筆」。
7. 遺失回覆或狀態不明時保留並鎖定原批內容，使用「確認結果／重試相同提交」，不另造操作編號。確定整批被拒絕後保留草稿供修改。
8. 已成功操作即使後來停用船舶、暫停寫入或退休來源，仍可精確讀回既有回執；新的提交則須目前啟用船舶且 authority 是 admitted `records-v1`。

每筆事項／狀態各限 10,000 字；伺服器整批 JSON 上限 2,000,000 bytes，前端預留 JSON 編碼空間。原 UI 必填與設備故障細項規則保留。

## 岸端更新

- 保留原 Realtime 訂閱、focus/visibility 喚醒及安全合併。
- `records-v1` 補充可見頁面每 15 秒的 revision 備援查詢，經同一安全更新流程，不把通知當保存回執。
- 原 SQL 未安裝時，缺少該新查詢的明確錯誤只停用備援，不改用舊資料來源。
- 既有編輯／未提交草稿不被換掉。這不依賴先擴大資料表 SELECT 權限或新增 Realtime publication。
- 岸端新增／更新內控在取得既有編輯鎖並讀取最新資料後，不再把其他案件新增造成的整站 revision 增加誤判為本案件衝突；原案件 `updatedAt`、目前權限、涉船範圍、關聯鎖及 SQL CAS／回執仍保留。
- 同時寫入可能短暫等鎖，或由原保存佇列自動合併重試；不能因此宣稱任何多方競爭或網路故障都不會失敗。本案件真的被修改、權限失效或結果未知時，仍依原保護流程處理，不強制覆蓋。

## SQL 手動交付

前提：既有 records-v1 release、來源 authority、business quiescence 與相關 helper 已安裝。資料來源由伺服器 authority 判定，不要求現有 `supabase-config.js` 增添 `storageMode`，也不修改該設定檔。這是**增量**，不重新跑舊 08–12，不搬移舊資料、不切換 source、不解除暫停。

1. 由使用者在正確的 Supabase 專案執行：
   `supabase/migrations/20260919090000_ship_internal_control_public.sql`
2. 執行獨立唯讀核對：
   `supabase/verification/ship_internal_control_public_readback.sql`
   須得到 `result = PASS` 且 `failed_checks = []`。核對涵蓋六個函式的實際 body 指紋、屬性、公開／私有 EXECUTE、私有 schema 及原 records 資料表權限；指紋容忍 LF/CRLF，實質內容不同仍失敗。
3. 再由使用者 Push／部署前端。新入口是部署根路徑下的 `ship-internal-control.html`。
4. 正式啟用後，另行確認主站與船端載入的新版本；是否以真實事項做首次正式提交，仍由使用者決定。

公開 RPC：

- `read_ship_dynamics_internal_control_public_v1(text,text)`：僅有效船 ID／船名與必要表單選項，不公開帳戶名冊、密碼、root 或既存內控內容。
- `submit_ship_dynamics_internal_control_public_v1(text,text,uuid,uuid,jsonb)`：限新增。
- `get_ship_dynamics_internal_control_public_receipt_v1(text,text,uuid,uuid,jsonb)`：完整原內容及客戶端標記綁定的回執。
- `read_ship_dynamics_internal_control_public_revision_v1(text)`：最小 revision 通知。

既有通用 patch、私有 commit helper 與 records 表的權限不放寬。短交易使用既有 workspace exclusive writer gate；不是新增船舶租約或另一套責任分派機制。

若部署後需要停止使用，先由使用者撤回新入口／停止發佈，不刪除已存內控或回執。需要撤銷服務端新 RPC 權限時另行確認；本交付不附帶自動回滾或資料刪除。

## 本機驗證命令

```sh
npm run test:ship-internal-control
npm run test:internal-control
npm run test:internal-control-projection
npm run test:batch-internal-control
npm run test:internal-control-presentation-filters
npm run test:realtime-sync
npm run test:delegate-vessel-management
npm run test:work-center-updates
npm run build
npm run verify:itinerary-build-output
```

先設定既有 native PostgreSQL QA 環境 `SHIP_QA_PG_BIN`、`SHIP_QA_PG_MODULE` 及 repo 外 `QA_EVIDENCE_ROOT`，再執行：

```sh
npm run verify:ship-internal-control-sql
npm run verify:ship-internal-control-browser
npm run verify:ship-internal-control-concurrency
```

SQL 驗證使用真實本機 PostgreSQL、匿名角色及獨立連線，涵蓋批次回滾、receipt 故障、同操作並發、最大筆數、500 筆 audit 保留／歷史、停用與 source／pause admission、權限與安裝核對。

UI 驗證使用真實共用表單與岸端 App、測試資料、隔離的本機 HTTP→PostgreSQL 邊界；驗證提交、斷線／未知回覆／刷新恢復、手機邊界、分管／代管待辦、無焦點刷新時收到新內控及岸端草稿不被沖掉。測試中的網路／配額故障注入是可控失敗，不是正式事故重演。

並發 verifier 補足「草稿保留後真正保存」：

1. 岸端更新原案件，船端先新增成功，再按岸端保存；核對同一個草稿 DOM、原案件修改及船端新案件均保留。
2. 船端批次交易完成 SQL 但尚未 COMMIT 時，岸端批次送出，觀察真實 backend PID／`pg_blocking_pids`；釋放後由原 App 自動處理集合順序衝突，兩端皆取得成功回執。
3. 相反次序：岸端交易尚未 COMMIT 時船端送出；兩端皆完成。
4. 全新岸端瀏覽器 context 登入，核對完整案件集合與分管待辦、沒有重複 IDs，也沒有新增要事。

此矩陣使用獨立 HTTP PostgreSQL 連線，不以 JavaScript 同時啟動或同一 DB connection 冒充 SQL 並發。另有實際 App callback 的受控 I/O 版本閘門測試，驗證單案版本、編輯鎖、權限、涉船及版本倒退仍會拒絕；它不是雲端或瀏覽器驗收。

補測首次重現了整站 revision 誤擋岸端保存，修正只涉及前端上述兩個條件，不需額外 SQL。相關耐久保存 source verifier 同時校正既有 creation-lock helper 的第四個參數斷言；該 helper 與其產品接線沒有改動。

回歸過程發現一個既有代管測試只尋找舊 helper 名稱；改為實際呼叫目前工作中心選擇器，正反驗證啟用／未啟用代管。沒有為了通過測試而修改分管或代管產品邏輯。

**本機測試、安裝腳本、正式 SQL 已執行、Push、部署與正式驗收是不同狀態；本次開發不執行正式 SQL、不 Push、不提供未要求的常駐試用站。**
