# 追蹤模組：Phase 2 儲存／關聯介面

此文件只涵蓋 v0.3 第一個實作切片。新頁面、表格、Excel/PDF、匯入預覽與整體上線驗收不在本切片。真正掛載入口仍是 `src/main.tsx` → `App.tsx`，沒有另造 NormalizedApp 流程。

## 資料與權責

- `AppData.trackingItems?: TrackingItem[]`；缺欄視為空集合，正常讀取保留所有原欄及來源追溯，不按單號去重。
- `src/tracking/trackingTypes.ts` 涵蓋 F28／F34、來源工作表／列／原值。`id` 是每一可獨立處置分項的身份；`referenceNo`、`originalItemNo`、`subitemNo` 均不是鍵。
- `expectedDate`=DL、`preparationDate`=備貨日、`completionDate`=工程完工日、`actualDeliveryDate`=全部送达日、`closedDate`=結案日。互不推導；關閉／重開不改交船或完工事實。
- `deliveryStatus` 的 partial 值仍屬未全部交船。`trackingBucket` 將工程取消分成 `engineering-cancelled`，不得計入完工數。
- `linkedCaseId` + `linkState:'active'` 必須對應案件 `trackingItemId`；有效關係只按 ID 雙向解析。一來源只有一個有效案件；只有明確同步才建立案件，是否建立要事仍由原內控的 `syncToTask` 與明確 projection 決定。
- `statusLogs` 為最新在前；`events` / `trackingLifecycle` 為追加在後。不得覆寫舊歷程。

## 下一個 UI worker 可直接呼叫的 API

`src/tracking/trackingWorkflow.ts`：

```ts
runTrackingCommand(data: AppData, command: TrackingCommand, context: TrackingContext): AppData
// context = { actorId, at: ISO timestamp, operationId }
// source/endpoint references = { id, expectedUpdatedAt }
prefillTrackingCase(data, source, newCaseId): { item: InternalControlCase; missingDepartments: string[] }
validateTrackingItem(item): void
trackingBucket(item): string
TRACKING_EDIT_FIELDS
```

`runTrackingCommand` 是純規劃器：clone 輸入、驗證完整批次，成功才回傳整份 next；throw 時原 data 不變。它不是 RPC，也不宣稱已保存。command：

- `create {items}`：只新增來源，開啟狀態；忽略輸入的結案／連結欄，由 actor/context 填寫身份與時鐘。新 ID 由调用端配置，持久化 CAS 阻擋撞號。
- `edit {items:[{id,expectedUpdatedAt,changes}]}`：只允許 `TRACKING_EDIT_FIELDS`，不能改 ID、船、類型、連結、進度、交船、結案或歷程。來源基本欄更新不回寫案件／要事。
- `progress {items:[{id,expectedUpdatedAt,text}]}`：來源 + 有效案件 + 已有有效要事追加同一進度；不建立下游，不覆寫描述、分類、DL。已結案拒絕，不暗中重開。
- `delivery {items:[{id,expectedUpdatedAt,status,date}]}`：僅物料；delivered 必須有純日期，撤回全部交船時清除 actualDeliveryDate 並保留事件，不改結案。
- `sync {items:[{id,expectedUpdatedAt,item,projection?}]}`：先用 `prefillTrackingCase`，讓使用者核對原內控欄位。首次 DL、摘要、部門只預填。missingDepartments 不偷偷新增分類。重複有效同步拒絕；失效後須明確產生新案件再同步。
- `lifecycle {action:'close'|'reopen'|'correct-close-date',date?,outcome?,targets:[{entry:'tracking'|'internal-control'|'task',id,expectedUpdatedAt}]}`：精確有效群組一次收斂、保留歷史，不新增要事；工程 close 的 outcome 預設 completed，可明選 cancelled。結案日不得早於來源申請及案件報告日。

權限沿用既有 `createTasks`／`editBusinessContent`／`closeTasks` 及有效船舶範圍；船舶角色不能操作追蹤 command。具進度權限不等於具結案權限。

`src/tracking/trackingLifecycle.ts`：`resolveTrackingGroup`、`sourceForCase` 為精確圖解析；既有 case/task helper 已接入生命週期。`deleteInternalControlCase` 及 batch delete 在追蹤來源關聯時需要 actor/at。刪除案件或要事保留來源，標 invalid 並追加事件；保留下來的舊案件以 `trackingLinkState:'invalid'` 保留來源歷史而不再作為有效生命週期入口。普通無來源案件／要事原行為不變。

## 保存接線硬性要求

1. 下一頁必須使用既有 records-v1 保存協調器；`runTrackingCommand` 產生的 source/case/task delta 只可做一次 `apply_ship_dynamics_record_patch_v1`，不得拆成數個 RPC。
2. 保存前取得新鮮 scope，鎖 `tracking:<id>` 及 `relatedEntityLockKeysForSection` 列出的既有案件／要事；新案件用既有 `internal-control-create:<id>`，明確新要事仍用原 creation 協議。鎖須續期，保留 actor/config/generation fences。
3. 保留既有不可變 operation/request、unknown ACK receipt recovery、已確認 readback、draft continuity。command context.operationId 是事件歸屬，真正 RPC envelope 的 operation identity 應由同一次提交固定；重試不得重新生成 command 或 ID。
4. `recordRecoveryReadScope` 已納入 tracking source，`rebaseDisjointAppData` 保留互不相干來源改動，對有效關聯群組競爭拒絕盲目合併。
5. 新追蹤 UI 尚未接入；本切片只對既有 App 的案件/要事 handler 作最小接線，沒有新增頁面或 ship-side lifecycle privileges。

## 相容讀取與 forward migration

- 舊 `CLOUD_BLOCK_COLLECTIONS` / `read_ship_dynamics_record_scopes_v1` 維持嚴格九集合。
- `CLOUD_RECORD_COLLECTIONS_V2` / `read_ship_dynamics_record_scopes_v2` 是十集合版本。`RecordReadScope` 可用 `{targets:[],trackingVesselIds:[vesselId]}` 按船取來源；單筆來源、案件、要事 target 會展開有效關係，保留完整歷程。
- 新雲端 read adapter 優先 v2；只有 capability absent (`PGRST202`)、沒有 tracking coverage/target 時才相容退回 v1。追蹤要求不可退回舊版假裝成功；不退回 legacy writes。
- 唯一新安裝檔：`supabase/migrations/20260924160000_tracking_records.sql`。安裝在既有 records release 之後，按目前已安裝函数定义加 forward extension，不重寫過往遷移或執行 source unfreeze。
- 它擴充 record writer/import 名單、保護 v1 shape，加入私有來源/關聯驗證並保留既有 writer gate、entity CAS、lease、receipt、commit 路徑。v2 授權只鏡射 v1 reader；沒有新增表直讀或控制權限。
- 獨立唯讀確認檔：`supabase/verification/tracking-records-readback.sql`；每個布林值應 true。這只證明安裝，不能代替 hosted 操作驗收。正式 SQL 仍由使用者另行手動執行；不要重跑 08–12 控制流程。

## Parent 收斂核對

- 核對 child 的 28 個異動檔案與 raw SHA-256、20 個最新 npm gate receipts；沒有把 domain、native 與同一 aggregate 的重跑數相加當成獨立端到端案例。
- 加入真 native SQL＋實際 Supabase JS read adapter 的組合讀取回歸：`morning` 與 `trackingVesselIds` 合併後，原先詳細讀取漏帶船舶範圍，讓尚未同步內控的來源消失。已先取得行為 RED，再只修正 `cloud.ts` 的 scope 傳遞；單獨早會仍不額外載入來源。
- 修正後 native suite 為 **19 個具名案例**通過；相關 records store/workflows、typecheck、build 重驗通過。既有未受影響 gates 沿用相符候選證據。這不是新頁面 mounted-browser 或 hosted 驗收。

## 可重跑驗證

```text
npm run test:tracking
npm run test:tracking:native
npm run typecheck
npm run build
```

native runner 僅接受既有本機測試 prerequisite：`SHIP_QA_PG_BIN`、`SHIP_QA_PG_MODULE`、`QA_PREDECESSOR_MODULE`（已驗證本機 predecessor installer）、`QA_EVIDENCE_ROOT`（repo 外絕對路徑）。它建立專有 loopback PostgreSQL cluster，套用當前 release/控制鏈及新 migration，用 synthetic data 與真正 anon-role RPC 測試，結束停止 cluster；不接受外部 DB URL 或真實 credentials。測試版 07–11 只在這個私有 cluster 執行，不是正式操作指示。

本切片證據分層：domain/正規化/實際 App closure、native DB 原子 commit/rollback/replay、既有 records 與 internal-control gate。沒有聲稱新頁面瀏覽器驗收、hosted PostgREST/Auth/Realtime 成功、性能增益或全功能完成。UI worker 仍須驗證新來源編輯器的保存、unknown ACK/續期/導航草稿，以及所有表格與 Excel/PDF 操作。
