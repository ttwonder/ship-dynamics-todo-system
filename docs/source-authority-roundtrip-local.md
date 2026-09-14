# 本機：最新資料雙向切換

本片接續 `source-authority-publication-local.md` 的單向控制。只供隔離開發資料庫；**不是可直接交付正式環境執行的 migration**。原 App、畫面、角色、確認操作不變。

## 已接上的流程

安裝順序：既有完整 schema／record／formal fixture → legacy freeze/binding → business quiescence → paused records-to-legacy stage → source authority publication → browser source authority → `20260914_source_authority_roundtrip.sql`。底層 addon 若重裝，仍需按此順序重套後續 addon。所有控制使用 fresh READ COMMITTED transaction、明確 `SET LOCAL ROLE service_role`；不接受 JWT/GUC 偽裝角色。

1. 用既有 exact revision/server hash freeze 固定 legacy；用新 transition 暫停整組業務並取得 watermark。
2. `stage_ship_dynamics_paused_legacy_to_records_v1` 接受 workspace key/UUID、transition、原 pause watermark、source/target revisions/hashes、frozen timestamp、request UUID；**不接受外部業務 payload**。目標不存在時其 revision/hash 均為 NULL；已存在時必須完全匹配。受控測試目前涵蓋已存在的目標。
3. `publish_ship_dynamics_source_authority_v2` 接受 exact stage result 及目標 `records-v1`，發布來源但保持暫停。`resume_ship_dynamics_source_authority_v2` 接受 exact publication result，原子恢復該來源。
4. 在 records 保存新資料後再次 pause，沿用 `stage_ship_dynamics_paused_records_to_legacy_v1` 把**當時最新 records**放入仍凍結的 legacy，再用 v2 publish/resume 指向 legacy。不是還原舊備份。
5. legacy 再有新保存後，可重新 freeze/pause/stage/publish/resume 轉回 records；新 transition 及新 request IDs，epoch 逐次加一。epoch 只接受正的 JavaScript 安全整數，不接受小數、字串、越界值。舊 v1 publication/resume 和原收據仍保留。

已提交的 step 收據可用原 request 重讀。收據只證明那一次操作，不代表現在來源；NEW publish/resume 必須重新通過現在的 pause/stage/publication 綁定。重試應保持原 request，不能改 ID 盲重做。step 失敗會回滾該 transaction；已完成的 stage 不自動取消，也不自動解除維護。

## 資料及鎖的邊界

- 轉入 records 時在全域維護獨占鎖下重建**目標的目前列集合**，先把舊目前資料及 task progress 存入原有 interval history；不刪除歷史、operation receipts、read bases 或獨立正式 Itinerary／報告表。
- 每次切換 revision 為 `max(source,target)+1`。仅根 revision/updatedAt 映射到新版本及伺服器 UTC 毫秒；其餘 JSON 值、陣列順序、關聯和 audit provenance 原样保存。legacy row 的 nullable `updated_by` 在 records NOT NULL 欄位以空字串表示缺值，不捏造人員姓名；非空值保持原值。record import token 隨新 stage 更新，使舊增量 token 不再冒充新來源基線。
- task progress 重新配置內部 slots；既有歷史仍用原 slots 還原，原 member-fence triggers 繼續執行，過期編輯需重新取得正確條件。切換後實際 member save 已實跑，不以直接表更新代替正常保存。
- 維護鎖先 drain；舊未經 gate 的資料列鎖以 NOWAIT 拒絕並要求 fresh transaction。逐列豁免必須符合精確 table OID、verb、old/new SHA、backend、transaction、session actor，且僅用一次；沒有一般 service-write bypass，private helper 無 browser/service grants。
- 轉入 records 的完整 table expectations 在執行前準備，最後於 receipt/trigger 後讀回核對。獨立資料、控制及來源證據也核對。原已保存操作只查原收據，不能轉成新寫入。

## 已執行的證據

- `node scripts/verify-source-roundtrip-native.mjs`：15 個原生 PostgreSQL 案例；三段前後切換、實際 record/legacy block 保存、原歷史讀回、切換後 member 保存、exact control replay、錯 workspace/UUID/transition/hash/role、三種末端故障全表回滾、舊 tuple holder、實際業務持鎖→pause 等待、paused new-write denial、重裝相容。每次自行建立/關閉隔離 loopback cluster，原始失敗與成功 receipt 留在 repo 外。
- 原 `verify-source-authority-publication-native.mjs` 的 repo 外衍生 runner：42 個既有原生單向案例保持原 assertion；只在每次 authority install 後安裝 browser＋本 addon，且將 imports 綁回原 script。producer recipe/hash 保留。
- `verify-source-roundtrip-client.mjs`：38 個 controlled module 案例，包括新來源/epoch 接受、錯 epoch 拒絕、floor identity 隔離、manual report/delete 依 captured source dispatch；故障替身只證明 client dispatch，不冒充真實保存。
- 既有 manual report 15、delete 21、原 App bootstrap 14、action preread 17 個 controlled 案例通過。原本「epoch 2 必定錯」的兩個 assertion 改為「小數 epoch 錯」；新增矩陣另外明確測 epoch 2/3 及兩種來源。
- `npm run typecheck`、`npm run build` 通過；build 仍有既有大 chunk 提示，未為此改架構。

## 追加：原管理表單熱切換保存（本機）

入口仍為 `src/main.tsx → App`，以原登入、原「姓名」欄位及原「保存變更」操作。`scripts/verify-browser-authority-original.mjs` 的 `QA_SOURCE_ROUNDTRIP=1` 是預設關閉的 QA 模式；新增 `scripts/source-roundtrip-original-scenario.mjs`。舊預設情境／assertions 不变，只在開啟此模式時加裝 roundtrip addon。

- `UI-RT-FWD`：同一頁、同一欄位已有未提交 C，legacy → records epoch 2 後手動保存，實際 record RPC 一次 ACK。
- `UI-RT-REV`：再輸入未提交 D，records → legacy epoch 3 後手動保存，實際 legacy RPC 一次 ACK。
- pause／stage／publish 三個暫停點均驗草稿、身份、頁面及設定不變，零使用者業務寫入；不刷新、不改設定、不清 storage、不注入 React 或保存 helper。
- stage 比較完整來源與只映射指定 metadata 的目標；手動保存以原 request＋原 audit builder 先建立完整 expected，再核 SQL ACK、exact receipt、fresh connection 全圖及 retired／independent stores。既有 receipt 保留，新增 receipt 與 read-base 另作精確比對。
- 兩個新情境不是把原 setup、原 controls 或多次執行加總。子執行前兩輪為 QA ledger／receipt 分類錯誤，保留失敗收據；修正後通過，沒有修改產品。父將相同 scenario 接回專案後，另跑專案內 QA 入口。
- 人員表單有密碼，故僅 DOM 證據，沒有截圖。診斷 SHA 使用非 canonical `JSON.stringify`，JSONB／JS 物件 key 順序可能令 hashes 不同；完整業務一致由未降級的 `assert.deepEqual` 判定，陣列順序和值仍嚴格保留。

重現（隔離本機、非正式環境；先提供已驗證的 PG runtime／pg module 環境變數）：

```bash
QA_SOURCE_ROUNDTRIP=1 QA_BROWSER_AUTHORITY_MODE=direct QA_EVIDENCE_ROOT="C:/path/outside-repo/unique-evidence" node scripts/verify-browser-authority-original.mjs
```

`QA_AUTHORITY_BASELINE`、`QA_MGACK_MODE`、`QA_HANDOVER_UPGRADE` 應未設定。每次使用獨立 evidence／Vite cache／HMR port；結束核對自有 PG／HTTP／Chrome／HMR 關閉。收據及原始失敗留在 repo 外，不包含實際名冊或憑證。

## 尚不能宣稱

此處只補同一原管理表單的雙向熱切換保存，不是所有頁面的熱切換、全角色多人多船完整驗收、舊 unbound v2/v3 恢復驗收、hosted Supabase ACL/PostgREST/Realtime/scheduler 驗收，也不是本人持續試用站。沒有正式 SQL／Push／部署。正式操作包、維護時窗、其他原 UI 流程及本人試用仍分開交付。
