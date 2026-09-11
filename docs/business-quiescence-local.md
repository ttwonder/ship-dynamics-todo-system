# 原 App 業務寫入暫停：LOCAL 第一片

本片只做「暫停業務保存 → 查回已保存結果 → 明確恢復」。原 UI、網址、設定及正常使用方式不改。**不是最新資料來源切換／回退的完整驗收，不可直接套用正式環境。**

## 本機安裝與範圍

- 產品檔：`supabase/development/20260911_business_quiescence.sql`。
- 獨立前置修正：`supabase/development/20260911_legacy_report_workspace_binding.sql`。原 legacy 手動報表及兩種刪除 RPC 寫了不存在的 `workspace.workspace_key`；實際 canonical schema 是 `legacy_key`。此修正僅替換三個 lookup，保留 OID、ACL、actor、receipt、CAS 及其餘函式內容。遇不認識的 schema／定義即整筆失敗，不補假欄位、不修改既有 migration。
- 不加入 manifest、不註冊 cron、不改前端、`src/main.tsx → App` 或任何預設設定。只在已停止舊 writer 的隔離本機 DB 明確安裝。
- 先裝現有 schema／records／data management、Itinerary／reports、legacy compact receipt／prune、morning report DDL/functions（不註冊 cron）及 `normalized-legacy-cutover.sql`；再裝 report binding 修正；**最後**裝 business quiescence。task-member／scoped read 可選；缺必需資料表即拒絕整次安裝，不支援任意不完整的 migration 組合。
- 完整納管清單由 SQL `ship_dynamics_quiescence_private.tables_v1()` 宣告，包括 AppData／records 主資料、版本／歷史／操作紀錄、正式 Itinerary、報表及其關聯、必要 workspace/vessel 映射。不是把未掛載的 NormalizedApp 全部納管。
- row trigger 擋 direct INSERT／UPDATE／DELETE，也擋搬進或搬出已暫停 workspace。TRUNCATE 沒有 workspace 條件，本片安裝後不支援。惡意 DBA 關 trigger／改 DDL／改私有控制狀態不屬一般呼叫者威脅模型。

## 暫停與恢復

`pause_ship_dynamics_business_v1(workspace, transition)`、`read_ship_dynamics_business_pause_v1(workspace, transition)`、`resume_ship_dynamics_business_v1(workspace, transition, watermark)` 僅授權 service_role 與 migration owner；browser 角色及自填 JWT/GUC 不能取得控制權。

1. 用全新 READ COMMITTED 交易，對 exact workspace 和新 transition UUID 執行 pause，再 COMMIT。不能沿用已持有業務 tuple／writer lock 的交易。
2. pause 取得既有 `record-maintenance-v1` 排他交易閘，等待已參與 writer 提交或回滾，再用純 MVCC SELECT 拍下業務資料摘要；不反向等待業務 tuple。
3. 暫停狀態持久保存。COMMIT、ACK 遺失、斷線都不自動恢復；一般 service_role 背景工作也不能保存。
4. 同 workspace／transition 可重查、重試 pause；錯 workspace、其他 transition、NULL 或重用已結束 token 均不代替目前控制。
5. readback 返回原 watermark 和 `unchanged`。resume 須同時符合 exact workspace、當前 paused transition、完整原 watermark，以及重新計算的業務摘要。任一不符就保留暫停，不採「自動恢復最新那次」。

watermark 是每表 row count＋排序 JSONB 的 MD5 變更摘要；**不是密碼學防碰撞證明、完整備份或跨資料來源的權威證明**。尚未量測正式資料量的耗時／記憶體，不承諾維護分鐘數。

## 保存、查詢與編輯權

- 原 record writer gate 在 shared maintenance gate 後、各 early return 前加持久狀態檢查；保留其他 workspace、try-upgrade、40001 等分支及 OID／ACL。
- direct DML 到 row trigger 時可能已持有 tuple／子系統鎖，因此只 try shared gate，不反向等待。pause 尚持閘時回 `40001 / business-pause-retry-transaction`；已提交 pause 時回 `55000 / business-writes-paused`。
- 業務 guard 為 VOLATILE，只支援 READ COMMITTED；REPEATABLE READ／SERIALIZABLE 業務寫入明確回 `25001`，不能用舊 snapshot 繞過。
- 暫停是逐 workspace；drain 暫時使用既有全域閘，其他 workspace 在 pause 交易持閘時也可能等待／重試。pause COMMIT 後，未暫停 workspace 可正常保存；無吞吐量承諾。
- **暫停業務保存不等於零 DB 寫入。** lease、member fence bookkeeping、disposable read cache 不列入 watermark；拒絕 INSERT 仍可能消耗 sequence 號碼。
- task/member 的保留／續期／釋放編輯權沿用原鎖協議，經安裝時從原 writer gate 取得的私有 locking-only 函式，不通過業務拒寫檢查；實際保存仍走原 public writer gate 及 table guards。有效 lease 不能授權已暫停的保存。
- payload／version／receipt／status 保持原授權。兩種 history prune 及 records scheduler 的 exact terminal replay 先走只讀查詢；對不到原 actor／workspace／完整請求，不建立新業務紀錄。一般 mutation RPC 不因此一律變成 read-only。
- 重裝較舊 records／task-member SQL 後，須在閒置本機重新最後安裝本片；這不是正式線上升級協議。

## 本機驗證

使用現有 `createNativeRecordQa` 和 portable PostgreSQL；建立自己擁有的全新 loopback cluster，不接受外部 DSN。SQL 均為真實程式，資料與身份為合成測試資料；沒有 browser 或 hosted Auth／PostgREST 證明。

```text
node scripts/verify-legacy-report-workspace-native.mjs
node scripts/verify-business-quiescence-native.mjs
```

須設 `SHIP_QA_PG_BIN`、`SHIP_QA_PG_MODULE`，以及 repo 外的新 `QA_EVIDENCE_ROOT`、`QA_VITE_CACHE_DIR`。legacy scheduler 依真實工作日運行；週末測試會失敗，不替換 clock 或函式假造證明。

- 報表 binding：三個舊 RPC 都先重現 `42703`；修正後，manual 正式 snapshot／exact replay、兩種非空刪除／replay，以及只有 lookup 改變、OID／ACL／重裝不變通過。
- business pause：持久暫停、有效 linked task-member、main/public/office Itinerary、manual/scheduled reports、prune 的正常／暫停／恢复與 exact receipt；讀取／lease 保留、角色／transition／隔離級別、未暫停 workspace、逐表非空 direct DML 均有實測。
- 多連線：legacy、records、Itinerary、report 的 in-flight drain；tuple-before-gate 不死鎖；record waiter 看到新提交 pause；重装及 try-upgrade。保留 `pg_stat_activity`／`pg_locks` 證據。
- linked task 使用真正 eligible temporary-meeting distributed graph，核所選 member 與未選船／來源 meeting；不是傳入空 command 即被拒絕的替代測試。
- normalized owner/login/rollout bootstrap 是合成資料；rollout 呼叫真 Owner RPC。`sd_operations` 非空 seed 只證 **TABLE GUARD**，不宣稱原 App/NormalizedApp 的業務寫入路徑。
- legacy cron 沒有每次 operation ID；只證既有 frozen report readback 和 drain，不虛構 invocation receipt，也不套用 records scheduler 的 receipt 證明。

所有失敗均留在 repo 外 evidence，包括首輪交易鎖 RED、paused terminal replay RED、三個 binding RED、member 續期 RED，以及 fixture／receipt 預期的 QA 修正。零行 UPDATE 不計覆蓋；0=完整適用 PASS、1=執行 FAIL、2=契約仍 PARTIAL。重跑不加總成更多獨立案例。

## 仍未完成的後續階段

- 原 App 維護提示與未保存草稿／未知保存結果的完整交接。
- 新舊資料來源切換、舊頁面來源阻擋、以最新資料完整回退及中斷恢復。
- 正式 Supabase、全角色手機／PDF、使用者隔離試用與正式切換操作／時長量測。

本片不提供搬移／restore bypass，不變更正式資料；local commit、Push、部署、正式 SQL 為不同授權，不能把本機 PASS 當成正式切換可立即執行。
