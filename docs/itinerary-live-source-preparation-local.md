# 開啟中的 Itinerary：新保存意圖跨來源切換（本機）

本片延續原 App、原 Dashboard 與原 ItineraryEditor，不改畫面、按鈕、角色或業務模型。沒有 SQL／grants／全域設定變更；不是上線核准。

## 修正順序

1. 新保存意圖先持久保存不含新 pending 的草稿。
2. 主會話確認目前來源仍可寫、正式版本仍與原基線一致；來源改變時，重新確認原 lease 的相同 ID、holder 及 fencing token，不取得新 lease、不接管其他編輯者。
3. 確認與畫面生命週期仍有效後，才捕捉來源、產生／保存新 operation，再送出。整次保存保留開始時的 context predicate，在各 await 後核對同一 editor、backend、generation 與目前原始設定；設定／身份變更時不再 dispatch、不清除或重綁已持久化的 pending。仍在原 editor 的忙碌提示會結束，沿用既有未確認提示；不顯示成功。
4. 已有 pending 跳過新準備；原來源、operation ID／signature 與既有 status-first 語意保留。
5. `notDispatched` 只由本機保存器在尚未調用業務保存前標示。只有本輪新意圖可因此移除尚未送出的 pending 並保留草稿；既有 pending 不信任這個提示，已送出但未知結果仍保留。

## 已有證據及層次

- 原 App／獨立本機 PostgreSQL：原 editor、同一輸入節點、真正未送出草稿、未改原設定；pause／publication／resume 後按原保存，完整正式行程、備選、history 與 operation oracle 核对，未影響其他 stores。
- 同一流程的 save ACK／立即 status 遺失：暫停期間只查回捕捉來源的原操作，不重送。
- 暫停時的準備拒絕：沒有業務保存或新的 pending，草稿與原画面保留。
- `npm run test:itinerary-fresh-preparation`：真實 adapter 加受控傳輸；涵蓋同來源、跨來源原 lease、版本漂移、缺失文件、失效／不符 lease、暫停／無效來源、未送出分類與歷史 pending。不是 SQL 或 mounted 證據。
- 準備期 Chromium／實際 Dashboard、Editor、LocalDemo、IndexedDB 的八個受控案例：先草稿後準備、成功後才持久化來源、取消／身份／設定變更、未知結果、fresh 未送出，以及舊 pending 不重綁。準備／查回介面為受控 I/O，不能當作 native SQL。
- 既有掛載生命週期矩陣及適用行程回歸、型別、建置另行綁定最終候選；不同層不相加成 E2E 數量。

### Review B-01 限定補件

- 原候選已在真實掛載流程重現：準備完成、真實 IndexedDB pending 寫入完成但返回被延遲；設定改變後，舊 callback 仍進入 LocalDemo 保存並提交。這不是正式事故或 SQL 重現。
- 相同時序的設定變更、身份變更與不變對照，修正後均通過；同組原八案例亦通過。保留 RED 與 GREEN 收據，不把原 review 改成 PASS。
- 上述 npm 指令另執行三個原始 submit／Dashboard predicate 的受控函式案例（含設定改變但尚未 rerender），獨立標示，不能冒充掛載或 SQL。

## UI 邊界

新增 `ItineraryEditor.onPrepareSave` 與 `isSaveContextCurrent` 兩個不輸出到 DOM 的內部 callback。專用 source gate 固定允許這兩個 prop 的確切值，移除這兩處差異後比較原有 JSX。後者只在記憶體核對 context，不持久化或記錄原始設定／金鑰；它不是改版或完整手機／PDF 視覺驗收。

## 保留限制

- 初始尚不存在正式文件的跨切換流程，不由本片的既有正式行程 native 案例代證。
- 保留原 id／signature 草稿格式；沒有建立全域完整 request journal。
- 不改別的登入／船端模式、報告刪除或早會寫入；這些與完整正反切換、全站整合及隔離試用仍各自列管。
- 受控 actor／config 案例不等於正式登入／RLS／Realtime／多使用者全矩陣驗收。
- 不 Push、不部署、不執行正式 SQL。正式與隔離真雲端驗證須另外取得相應環境與授權。
