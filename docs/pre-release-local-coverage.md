# 推送前有限本機覆蓋核對 — 本機缺口已關閉

## 結論與不變邊界

- **固定清單內的必要本機缺口為 0**。65 列規則中，62 列有適用本機證據（47 列沿用、15 列補驗），2 列只屬真雲端驗收，1 列明確不適用。這不是 65 項功能、65 個 E2E 或全站所有組合都已測完。
- 本輪接續原 13 列：先前 6 列已有實測，本次補完 7 列會議；不重跑已通的整站、Excel、手機或 PDF 矩陣。
- 測試為 **原 `main.tsx → App`＋合成資料＋本機 PostgreSQL**。不是 production，也不把 helper／source 判斷算成真雲端通過。
- 產品與 SQL 候選未變；畫面、導航、操作、角色政策未改。本輪只有 repo 外 QA 與本報告／索引更新。
- 未讀寫正式環境、未執行正式 SQL、未合併分支、未 Push、未部署；本人 `14695` 試用站未動。
- 這是進入正式更新準備的門檻，不是直接上線授權。SQL 可執行包與 hosted 演練、正式切換、部署讀回仍待另行完成。

## 本輪結果

1. 一般要事結案／重開／刪除；要事來源內控建立與禁止撤回。
2. 會議建立／編輯：兩決議兩船仍為兩個 task；共同與分船分開；內容更新保留 ID 與歷程。
3. 無涉船決議結案／重開；整場會議結案／重開，兩條操作不混同。
4. 關聯決議結案／重開只動對應項目，另一決議與整場狀態保持。
5. 原「同步關聯狀態」按鈕實際修復父項：使用隔離歷史矛盾 fixture，保留歷史完成人 `qa-operator`，不改為本次操作人 `qa-owner`；task、另一決議與整場狀態不變。
6. 移除決議會封存／解除 task 關聯並保歷程；刪整場會議刪除其仍關聯的 task，已解除關聯者保留；旁觀要事、會議與 Itinerary ledger 不變。
7. 會議歷程新增／合法刪除；原 sanitizer 的同名不同 ID 拒絕另列 helper 證據。
8. 原 UI 授權內控取消／涉船縮減及同步成功；不具取消授權時的原 helper 拒絕與零 SQL 變更另列，**不宣稱已做全角色 UI 拒權矩陣**。
9. 正式行程保存後船卡與行事曆投影同一 revision；四原登入角色入口及船舶可見範圍。
10. 既有要事執行日期／天數變更、清空、DL 不混用與停用／恢復投影。此證據不擴稱任意新增要事組合皆已驗收。

## 版本與證據核對

- 本輪測試候選：`6a25fa28fea5458f7b364d49ccc2f879c256e736`，tree `4e54d19399f89bd32f76fccb4ddfc19c1e17df90`。
- 655 份執行檔案與開始時 raw manifest 全相同；其中 361 份直接等於 Git blob，另 294 份僅已核對的 CRLF/LF 表示差異，沒有非換行差異。未為比對改寫任何產品檔案。
- 產品與先前已驗的 `6c57b5c42590a2c726e3386ddada5c133fa07035` 相同，因此沿用既有 build／Excel／手機／PDF 證據；本輪未重跑這些 gate。
- 新 runner 15 個輸入核對、112 個去重 run/file SQL 輸入核對、4 個前次原 UI 保存收據 seed binding 通過。這些是完整性檢查，不另加到功能測試數。
- 原失敗收據保留：必填／部門按鈕選擇、helper 用陣列首項而非原 ID、把初始化前 ledger 當操作前 ledger、QA 未接受原同步確認。已通 case 可從後續不同階段失敗的 run 沿用；**整個 FAIL run 不改標 PASS**。
- `GM-05` 原收據籠統寫 native layer，索引已明確修正為 `EXECUTED_ORIGINAL_HELPER_ZERO_SQL_DELTA`，並與 `GM-GUARDS-UI` 的真正 UI／PG 正向證據配對。

## 固定清單（分母不變）

| ID | 規則／結果 | 狀態 |
|---|---|---|
| BASE-01 | 原App登入、角色入口、導航順序；匿名船端入口獨立 | REUSED_PASS |
| BASE-02 | 船隊看板/船詳情、篩選與單筆完整讀取，返回不降級已載內容 | REUSED_PASS |
| BASE-03 | 船舶原快速更新與多人分船保存；未选資料不跟著改 | REUSED_PASS |
| BASE-04 | 管理人員/船舶/分類/角色/進站密碼沿原表單保存，ACK後本地成功 | REUSED_PASS |
| BASE-05 | 停用保全部資料/關係，原管理勾選啟用再顯示；不連帶重啟帳戶 | REUSED_PASS |
| BASE-06 | 分管逐船交接：未完成工作跟接任者、其他船/共用協辦/歷史/已結案保留 | REUSED_PASS |
| BASE-07 | 私稿只有真正丟稿才確認；取消保留、確認放棄，原表單保存不由頁首代送 | REUSED_PASS |
| BASE-08 | 全域保存成功須有確認；較新輸入/舊回覆不清稿或冒成功 | REUSED_PASS |
| BASE-09 | 啟動/設定/同步/恢復保身份與草稿，來源未知不沿舊入口亂寫 | REUSED_PASS |
| BASE-10 | 早會工作台原議程、篩選、保存/讀歷史與目前資料分離 | REUSED_PASS |
| BASE-11 | 數據分析保整體/部門/人員與原可見範圍，返回/同步讀取不污染看板 | REUSED_PASS |
| BASE-12 | PDF/手機沿原畫面與列印內容，不為額外字級門檻改版面 | REUSED_PASS |
| BASE-13 | 定向保存保關聯/通知/audit/歷史與未選資料，重送同操作不重覆效果 | REUSED_PASS |
| BASE-14 | 不同船/逐船進度可独立保存，同筆CAS/lease衝突不覆資料 | REUSED_PASS |
| BASE-15 | 最新資料雙向切換與保存回覆遺失保持同操作，非舊備份覆新資料 | REUSED_PASS |
| BASE-16 | 全部標記已讀只更新本人未讀，包含篩選外；他人通知/audit/業務資料保留 | REUSED_PASS |
| BASE-17 | 真雲端權限/HTTP RPC/Realtime重連/scheduler與正式資料切換、備份回退、部署讀回 | HOSTED_ONLY |
| REL-01 | 一般要事新增與更新 | REUSED_PASS |
| REL-02 | 一般要事整體結案、重開、刪除 | NEW_PASS |
| REL-03 | 內控新增同步/不建子要事 | REUSED_PASS |
| REL-04 | 內控↔要事雙向內容與進度保存 | REUSED_PASS |
| REL-05 | 內控兩端結案與原 closed-list 重開 | REUSED_PASS |
| REL-06 | 撤回同步與再同步 | REUSED_PASS |
| REL-07 | 取消內控不是撤回 | REUSED_PASS |
| REL-08 | 刪除兩端的非對稱原規則 | REUSED_PASS |
| REL-09 | 要事來源內控建立與撤回限制 | NEW_PASS |
| REL-10 | 內控批量新增/結案/刪除只作用選取 | REUSED_PASS |
| REL-11 | 專題會議新增/編輯與關聯同步 | NEW_PASS |
| REL-12 | 移除會議決議≠刪整場 | NEW_PASS |
| REL-13 | 決議完成/重開/關聯修復 | NEW_PASS |
| REL-14 | 無涉船決議完成與重開 | NEW_PASS |
| REL-15 | 整場會議結案與重開 | NEW_PASS |
| REL-16 | 逐船進度、最後一船與整體軸 | REUSED_PASS |
| REL-17 | 逐船等待ACK的較新輸入與清除 | REUSED_PASS |
| REL-18 | 通知/audit/歷史/未選資料是完整效果 | REUSED_PASS |
| REL-19 | 會議歷程新增/保留/合法刪除與actor | NEW_PASS |
| REL-20 | 個人移除與共享完成/永久刪除 | REUSED_PASS |
| REL-21 | 原無單船 Delete／任意link-unlink不列缺碼 | EXCLUDED |
| REL-22 | 真雲端邊界單列 | HOSTED_ONLY |
| REL-23 | 會議內控取消與涉船縮減的保護 | NEW_PASS |
| IT-01 | UTC儲存、每欄fixed offset顯示與Excel往返 | REUSED_PASS |
| IT-02 | L/U多選及A:/F:吃水文字保留 | REUSED_PASS |
| IT-03 | 保留原自動/手動ETA/B/C/D計算 | REUSED_PASS |
| IT-04 | 刪首列時上一港承接已刪列港名 | REUSED_PASS |
| IT-05 | 備選同document最多5個、船端編輯瀏覽 | REUSED_PASS |
| IT-06 | 正式首列ETA起算live聯動備選 | NEW_PASS |
| IT-07 | 備選轉正式僅複製草稿、人工保存且保留備選 | NEW_PASS |
| IT-08 | 同document保存備選可推進revision並留history | REUSED_PASS |
| IT-09 | 船端保存的人工三項確認 | REUSED_PASS |
| OP-01 | 正式sortOrder首列完整bundle投影 | REUSED_PASS |
| OP-02 | 首次無正式整組fallback、之後stale不倒退 | REUSED_PASS |
| OP-03 | 原保存後營運船卡/行事曆消費同一確認版本 | NEW_PASS |
| CA-01 | 登入四原角色可進Calendar且不擴可選船 | NEW_PASS |
| CA-02 | ETA–ETD預勾、hover六行完整欄位 | REUSED_PASS |
| CA-03 | 有效執行排程才投影且DL獨立 | NEW_PASS |
| CA-04 | 停用單船事件隱藏、跨船保有效部分且關係不刪 | NEW_PASS |
| CA-05 | 備選不進Calendar/報告/email | REUSED_PASS |
| EX-01 | 岸端只匯出選中正式行程與完整metadata | REUSED_PASS |
| EX-02 | 岸端preview取消零保存、只套用勾船 | REUSED_PASS |
| EX-03 | 岸端ACK/未知結果/鎖競爭保留逐船語意 | REUSED_PASS |
| EX-04 | 匿名船端正式-only及正式＋備選分開匯出 | REUSED_PASS |
| EX-05 | 船端匯入先草稿、拒錯船/多分頁、人工保存 | REUSED_PASS |
| RP-01 | 手動報告凍結正式快照、ACK後成功 | REUSED_PASS |
| RP-02 | 歷史page/date/exact-ID與不可變正式預覽 | REUSED_PASS |
| RP-03 | 每日09:00正式日快照保留本機SQL證據 | REUSED_PASS |

## 原 13 列的增量證據

- **REL-02** 一般要事整體結案、重開、刪除：`GT-01` → `record-meeting-browser-b2oc0p`（ORIGINAL_APP_NATIVE_POSTGRES；原run=PASS）
- **REL-09** 要事來源內控建立與撤回限制：`GT-02` → `record-meeting-browser-Eh1yob`（ORIGINAL_APP_NATIVE_POSTGRES；原run=FAIL）
- **REL-11** 專題會議新增/編輯與關聯同步：`GM-LINK` → `record-meeting-browser-JaGrQ0`（ORIGINAL_APP_NATIVE_POSTGRES；原run=FAIL）
- **REL-12** 移除會議決議≠刪整場：`GM-REMOVE` → `record-meeting-browser-gHHV10`（ORIGINAL_APP_NATIVE_POSTGRES；原run=FAIL）；`GM-02` → `record-meeting-browser-Qk95eo`（ORIGINAL_APP_NATIVE_POSTGRES；原run=PASS）
- **REL-13** 決議完成/重開/關聯修復：`GM-LINK-LIFECYCLE` → `record-meeting-browser-JaGrQ0`（ORIGINAL_APP_NATIVE_POSTGRES；原run=FAIL）；`GM-REPAIR` → `record-meeting-browser-zqAtzA`（ORIGINAL_APP_NATIVE_POSTGRES；原run=PASS）
- **REL-14** 無涉船決議完成與重開：`GM-01` → `record-meeting-browser-BORdvB`（ORIGINAL_APP_NATIVE_POSTGRES；原run=PASS）
- **REL-15** 整場會議結案與重開：`GM-01` → `record-meeting-browser-BORdvB`（ORIGINAL_APP_NATIVE_POSTGRES；原run=PASS）
- **REL-19** 會議歷程新增/保留/合法刪除與actor：`GM-04` → `record-meeting-browser-BORdvB`（ORIGINAL_APP_NATIVE_POSTGRES；原run=PASS）
- **REL-23** 會議內控取消與涉船縮減的保護：`GM-GUARDS-UI` → `record-meeting-browser-JaGrQ0`（ORIGINAL_APP_NATIVE_POSTGRES；原run=FAIL）；`GM-05` → `record-meeting-browser-gHHV10`（EXECUTED_ORIGINAL_HELPER_ZERO_SQL_DELTA；原run=FAIL）
- **OP-03** 原保存後營運船卡/行事曆消費同一確認版本：`G-PROJ-main-save-card-calendar` → `native-gap-6RdYDe`（ORIGINAL_APP_NATIVE_POSTGRES；原run=GAP_FAILED）
- **CA-01** 登入四原角色可進Calendar且不擴可選船：`G-CAL-four-original-role-entry` → `native-gap-6RdYDe`（ORIGINAL_APP_NATIVE_POSTGRES；原run=GAP_FAILED）
- **CA-03** 有效執行排程才投影且DL獨立：`G-CAL-original-schedule-DL-duration` → `native-gap-QjokDH`（ORIGINAL_APP_NATIVE_POSTGRES；原run=GAP_FAILED）
- **CA-04** 停用單船事件隱藏、跨船保有效部分且關係不刪：`G-CAL-original-deactivate-reactivate` → `native-gap-2DU1il`（ORIGINAL_APP_NATIVE_POSTGRES；原run=PASS）

## 保留限制

- 真 Supabase Auth／ACL、PostgREST、Realtime／重連、scheduler、QPS、正式資料切換與部署讀回，不由本機 PASS 代替。兩個 HOSTED_ONLY 列是證據分類，不是工時估計。
- 原會議 PDF「追蹤中」7.5pt 的 strict 8pt 門檻仍 FAIL；與核准 baseline 一致、無裁切，按原 UI 保留，不改測試結果。
- 前輪記錄的 3 筆 generic Promise exception 未追溯定位；不得據此宣稱全站 console clean。原始觀察保留於索引。
- 本輪未新開全站獨立 review；採固定缺口補驗、定點唯讀分析與父端原 UI／PG 實測。
- 先前部分報告可由 Git commit `6a25fa28fea5458f7b364d49ccc2f879c256e736` 取回；本頁及索引為後續增量結論。

## 自有資源與後續門檻

- 已核對本輪 46 個宣告 QA 埠關閉、12 個直接列出的 PG data directory 已移除；本輪自有 Chrome／Node／PostgreSQL 程序為 0。
- 補清理前次留下的 2 個自有 Chrome profiles 與 4 個 junction；原始碼、成功／失敗證據、原 node_modules 目標保留。沒有清理本人試用站。
- 下一步：確認獨立 Supabase 演練環境與外部寫入範圍，再核對正式現況、整理 SQL／獨立 readback／切換與回退包。使用者自行貼 SQL、按 Run；Push 仍由使用者決定。

## 本機可核實成果

- 完整固定規則 ledger：`C:\Users\tuotu\AppData\Local\hermes\cache\ship-preflight-6a25fa2-resume\coverage-ledger-final.json`
- 父端核對收據：`C:\Users\tuotu\AppData\Local\hermes\cache\ship-preflight-6a25fa2-resume\acceptance.json`
- owned cleanup：`C:\Users\tuotu\AppData\Local\hermes\cache\ship-preflight-6a25fa2-resume\owned-cleanup-final.json`
- 收據 inventory：`C:\Users\tuotu\AppData\Local\hermes\cache\ship-preflight-6a25fa2-resume\receipt-inventory.json`
- 機器可讀摘要：`docs/pre-release-local-coverage-index.json`

原始 DB／network／失敗差異可能含合成認證欄位，只留私有 cache；不得整包公開或當正式資料交付。
