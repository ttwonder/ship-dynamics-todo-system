# task.vesselProgress：development-only 物理拆分

基線 `ece55206dde4aa851eb8a1a0c8680c6b9fa7e9c7`。本片只改四個 development SQL；原 `src/main.tsx → App`、AppData、RPC envelope、登入／角色、業務 helper、task／related lease 及完整 task CAS 保留。沒有新 scope epoch 或 member lease 政策；frozen report snapshot 不拆。

## 內部表示

- `ship_dynamics_records` 與 `ship_dynamics_record_history` 加 `task_progress_meta`，不佔用使用者 JSON 欄位。NULL 表示未轉換的舊 body／非 task。
- task body 移除 `vesselProgress`；metadata 明確分 absent、非 array literal、array ordered entry IDs。缺失、`[]`、JSON null、非 array、raw 重複／未知欄位／原字串 ID 及順序不經 normalize。
- 私有 `ship_dynamics_record_task_progress` 保留原樣 entry JSON 與 revision；`ship_dynamics_record_task_progress_history` 保留 `[from,to)` body。
- `ship_dynamics_record_progress_write_v1` 先保留所有 exact raw matches，再只對完整新／舊集合均唯一的非空 string vesselId 追蹤變更。歧義使用新 slot，不猜業務身份；slot 不是 scope epoch。只 archive／update changed leaves，移除的葉仍存歷史。
- `ship_dynamics_record_hydrate_v1` 共用於 full/history、完整 expected CAS、delta upserts、版本邏輯大小及排程 task 投影。missing／duplicate／錯 workspace slot 或重疊 body 不回傳半份 JSON。
- task parent 仍按既有交易更新 revision／metadata；整體 status/isClosed 仍獨立。各船進度、歷史順序、scope 外 closed 保留／open 清理仍由原 helper 決定。
- 現行 physical stats 以 `ship_dynamics_%` relation prefix 計算，已自然包含新兩表；logical version bytes 計重組完整 task，非內部 refs。Prune 仍只刪明選版本 roots，不 GC 共用 body。
- 新表 RLS enabled；兩 helper invoker／固定 search_path；PUBLIC、anon、authenticated 無表存取或函式 execute。未放入正式 manifest，未給 browser grants。

## 本機無損升級與反向演練

`node scripts/verify-cloud-record-task-progress.mjs`

此命令只建立兩個 synthetic in-memory PGlite。舊表示從上述 Git object 讀出，不 checkout／重建 clone／使用正式資料。

`record-task-progress-local-rollback.mjs` 提供 `upgradeLocalTaskProgress(db)` 與 `rollbackLocalTaskProgress(db)`，明確只接受 PGlite instance。不是正式 DB runner，不接受 URL／credentials。

- 升級：四檔 DDL 去除各自 transaction wrapper 後置於**同一 transaction**；不可對可用中的既有 authority 逐檔 commit，避免舊 delta／排程 reader 的中途不相容。local fixture fresh install 在開放 loopback 前完成安裝。
- store DDL 對真實存在的 current／history body 轉換，歷史沿用原 interval；舊歷史版本採新私有 slots，不猜跨版本 identity。不能由 disposable read_bases 補造已丟失 body。
- preflight 檢查已存在版本可重建與 task interval overlap；轉換後檢查各 retained body interval 的所有 leaf 邊界，連已 prune root 的 body 也檢查。每個既有可讀版本／current 必須前後相同。import token、revision、receipt signature/result 不更新。
- 重套 DDL 零 record／leaf／history tuple 寫入（不宣稱 pg_catalog 函式定義零寫入）。
- 反向：同交易 preflight，再把**包含升級後新提交**的所有 current/history hydrate 回舊 body，恢復 Git-pinned 四檔舊函式、移除 metadata／新表／helper。完整可讀版本前後相同；不是覆蓋舊資料備份。操作須停止其他 writer，僅 synthetic 本機執行。

## 有界驗證

- 真 SQL RED：只完成 A，B 已結案，原 `[B,A,scope 外 closed C]`。原 helper＋builder＋task/meeting guards＋原 notifications／雙 audit 真提交；先通過完整原表示業務 parity，再因 B body owner revision/xmin/ctid 變動失敗。不是以缺 leaf 表當 RED。
- GREEN：A 正確、順序 `[A,B,C]`，B leaf value/revision/tableoid/xmin/ctid 不變；task 整體／meeting.status 不自動完成，只有 parent 決議 item 同步。
- 錯／過期 lease、stale task／meeting CAS、actor conflict、operation mismatch 全 ledger 零寫入；receipt 前 late exception 用非交易 sequence 證明 leaf/history/meeting/audit 已到達後，驗兩新表在內完整 rollback。exact lost ACK replay 在失租後不重寫。
- full/history/delta 舊表示對照、raw import／duplicates／order-only tuple、logical size、真舊 current＋多 history upgrade、zero-write rerun、升級後新資料 reverse，以及 private catalog。
- 原會議 UI verifier 新增 B leaf 實體斷言，原操作 → SupabaseJS loopback → SQL → ACK／釋鎖 → 新 document 重載；不是 native SQL 冒充 hosted。原資料管理 UI 的保護 ledger 也納入新兩表。

重跑命令：

```text
node scripts/verify-cloud-record-task-progress.mjs
node scripts/verify-record-task-progress-boundary.mjs
node scripts/verify-cloud-record-store.mjs
node scripts/verify-cloud-record-workflows.mjs
node scripts/verify-cloud-record-history.mjs
node scripts/verify-cloud-record-delta.mjs
node scripts/verify-cloud-record-data-management.mjs
node scripts/verify-record-daily-morning-scheduler.mjs
node scripts/verify-record-meeting-browser.mjs
node scripts/verify-cloud-record-data-management-browser.mjs
node scripts/verify-task-vessel-progress.mjs
node scripts/verify-related-durable-mutations.mjs
node scripts/verify-meeting-task-reconciliation.mjs
node scripts/verify-meeting-status-history.mjs
node scripts/verify-meeting-scope.mjs
npm run typecheck
npm run build
```

`QA_EVIDENCE_ROOT` 可指定 repo 外新 cache。每次 core／browser 證據建立獨立子目錄。此次收據：`C:/Users/tuotu/AppData/Local/hermes/cache/task-progress-partition-ece55206/`。新版 source boundary 相對本片基線允許僅四個 SQL；舊切片的 SQL 全 bytes 相等宣告不能拿來批准本片。

## 限制與停止線

PGlite owner 真 SQL 不證 hosted ACL/PostgREST、Realtime、多連線、真正無等待／效能、真 cron 或正式切換。workspace revision lock、完整 task CAS／lease 與完整 task transport 未拆，**不宣稱消除 coarse lock 或降低傳輸量**。本片不重開全站 UI／PDF／Mobile／Excel QA，不做新 review。驗證後獨立本機 commit；不 Push／merge／部署／遠端／正式 SQL／正式 config／使用者 browser storage，交回唯一 writer，不啟動下一片。
