# 上線前：原功能與後加規則的本機驗收對照

產品基線：`854802a770419d4edb6b0d362b5dbd0642819ef1`；tree：`a14b93bd5bdfd3a5758f1598d1aa7eb96ab58c97`。

**環境：真實原 App UI＋合成測試資料＋隔離本機 PostgreSQL／PGlite。不是正式網站或真 Supabase 驗收。**

## 結論

盤點完成、補驗部分完成。本輪已停止重試並清理自建QA服務；必要本機驗收尚未全通，不能據此進入正式上線。

此次不重設計、不新增功能。原已成功且相關程式未改的證據沿用；舊文件中的局部 OPEN／PARTIAL 與後續結案收據分開處置。本人已回饋試用「似乎，一切正常」，但這不是正式發布核准；本人已解釋的短暫不能輸入不再檢查。

## 如何看這張表

- 「既有證據可沿用」是指定功能與證據層的重用；不是本輪把所有舊情境重跑一遍。
- 原 UI/native SQL、原 UI/PGlite、受控回呼、helper／SSR、真正 PDF／XLSX，各自分層；不互相冒充。
- 跨版本重用包含未變業務模組／原回呼，以及後續相同 App bytes 的保存、來源與關聯圖驗證；完整理由及雜湊在 JSON。
- 表格列數是規則項，不是功能數、測試數或完成百分比；同一測試被多列引用不重複加總。

## 必要補驗

- **REL-02**：一般要事整體結案、重開、刪除 — 必要證據待補
- **REL-09**：要事來源內控建立與撤回限制 — 必要證據待補
- **REL-11**：專題會議新增/編輯與關聯同步 — 必要證據待補
- **REL-12**：移除會議決議≠刪整場 — 必要證據待補
- **REL-13**：決議完成/重開/關聯修復 — 必要證據待補
- **REL-14**：無涉船決議完成與重開 — 必要證據待補
- **REL-15**：整場會議結案與重開 — 必要證據待補
- **REL-19**：會議歷程新增/保留/合法刪除與actor — 必要證據待補
- **REL-23**：會議內控取消與涉船縮減的保護 — 必要證據待補
- **OP-03**：原保存後營運船卡/行事曆消費同一確認版本 — 必要證據待補
- **CA-01**：登入四原角色可進Calendar且不擴可選船 — 必要證據待補
- **CA-03**：有效執行排程才投影且DL獨立 — 必要證據待補
- **CA-04**：停用單船事件隱藏、跨船保有效部分且關係不刪 — 必要證據待補

## 逐項結果

### 原網站與共用保存／同步

| ID | 保留的操作／規則 | 結果 | 證據層 |
|---|---|---|---|
| BASE-01 | 原App登入、角色入口、導航順序；匿名船端入口獨立 | 既有證據可沿用 | ORIGINAL_APP_PRODUCTION_BUILD_NATIVE_PG + CONTROLLED_BOOTSTRAP |
| BASE-02 | 船隊看板/船詳情、篩選與單筆完整讀取，返回不降級已載內容 | 既有證據可沿用 | ORIGINAL_APP_NATIVE_PG + CONTROLLED_COMPONENT |
| BASE-03 | 船舶原快速更新與多人分船保存；未选資料不跟著改 | 既有證據可沿用 | ORIGINAL_APP_NATIVE_PG |
| BASE-04 | 管理人員/船舶/分類/角色/進站密碼沿原表單保存，ACK後本地成功 | 既有證據可沿用 | ORIGINAL_APP_NATIVE_PG + CONTROLLED_CALLBACKS |
| BASE-05 | 停用保全部資料/關係，原管理勾選啟用再顯示；不連帶重啟帳戶 | 既有證據可沿用 | ORIGINAL_APP_NATIVE_PG + SELECTOR |
| BASE-06 | 分管逐船交接：未完成工作跟接任者、其他船/共用協辦/歷史/已結案保留 | 既有證據可沿用 | ORIGINAL_APP_NATIVE_PG + NATIVE_SQL_UPGRADE |
| BASE-07 | 私稿只有真正丟稿才確認；取消保留、確認放棄，原表單保存不由頁首代送 | 既有證據可沿用 | ORIGINAL_APP_NATIVE_PG + CONTROLLED_CALLBACKS |
| BASE-08 | 全域保存成功須有確認；較新輸入/舊回覆不清稿或冒成功 | 既有證據可沿用 | ORIGINAL_APP_NATIVE_PG + CONTROLLED_CALLBACKS |
| BASE-09 | 啟動/設定/同步/恢復保身份與草稿，來源未知不沿舊入口亂寫 | 既有證據可沿用 | ORIGINAL_APP_NATIVE_PG + CONTROLLED_MODULES |
| BASE-10 | 早會工作台原議程、篩選、保存/讀歷史與目前資料分離 | 既有證據可沿用 | ORIGINAL_APP_NATIVE_PG + NATIVE_MODEL_ORIGINAL_COMPONENT |
| BASE-11 | 數據分析保整體/部門/人員與原可見範圍，返回/同步讀取不污染看板 | 既有證據可沿用 | ORIGINAL_APP_NATIVE_PG + NATIVE_MODEL_ORIGINAL_COMPONENT |
| BASE-12 | PDF/手機沿原畫面與列印內容，不為額外字級門檻改版面 | 既有證據可沿用 | REAL_CHROMIUM_PDF + ORIGINAL_APP_PRODUCTION_BUILD_NATIVE_PG |
| BASE-13 | 定向保存保關聯/通知/audit/歷史與未選資料，重送同操作不重覆效果 | 既有證據可沿用 | ORIGINAL_APP_NATIVE_PG + NATIVE_SQL |
| BASE-14 | 不同船/逐船進度可独立保存，同筆CAS/lease衝突不覆資料 | 既有證據可沿用 | ORIGINAL_APP_NATIVE_PG + NATIVE_TWO_CONNECTION_SQL |
| BASE-15 | 最新資料雙向切換與保存回覆遺失保持同操作，非舊備份覆新資料 | 既有證據可沿用 | ORIGINAL_APP_NATIVE_PG + NATIVE_SQL + CONTROLLED_MODULES |
| BASE-16 | 全部標記已讀只更新本人未讀，包含篩選外；他人通知/audit/業務資料保留 | 既有證據可沿用 | ORIGINAL_APP_LOOPBACK_PGLITE |
| BASE-17 | 真雲端權限/HTTP RPC/Realtime重連/scheduler與正式資料切換、備份回退、部署讀回 | 真雲端待驗 | NOT_HOSTED_VERIFIED |

### 要事、內控、專題會議及逐船關聯

| ID | 保留的操作／規則 | 結果 | 證據層 |
|---|---|---|---|
| REL-01 | 一般要事新增與更新 | 既有證據可沿用 | ORIGINAL_APP_NATIVE_POSTGRES |
| REL-02 | 一般要事整體結案、重開、刪除 | 必要證據待補 | ORIGINAL_APP_NATIVE_POSTGRES |
| REL-03 | 內控新增同步/不建子要事 | 既有證據可沿用 | ORIGINAL_APP_LOOPBACK_PGLITE + ORIGINAL_APP_NATIVE_POSTGRES |
| REL-04 | 內控↔要事雙向內容與進度保存 | 既有證據可沿用 | ORIGINAL_APP_LOOPBACK_PGLITE + ORIGINAL_APP_NATIVE_POSTGRES |
| REL-05 | 內控兩端結案與原 closed-list 重開 | 既有證據可沿用 | ORIGINAL_APP_LOOPBACK_PGLITE + ORIGINAL_APP_NATIVE_POSTGRES |
| REL-06 | 撤回同步與再同步 | 既有證據可沿用 | ORIGINAL_APP_LOOPBACK_PGLITE |
| REL-07 | 取消內控不是撤回 | 既有證據可沿用 | ORIGINAL_APP_LOOPBACK_PGLITE |
| REL-08 | 刪除兩端的非對稱原規則 | 既有證據可沿用 | ORIGINAL_APP_LOOPBACK_PGLITE |
| REL-09 | 要事來源內控建立與撤回限制 | 必要證據待補 | ORIGINAL_APP_LOOPBACK_PGLITE |
| REL-10 | 內控批量新增/結案/刪除只作用選取 | 既有證據可沿用 | ORIGINAL_APP_LOOPBACK_PGLITE |
| REL-11 | 專題會議新增/編輯與關聯同步 | 必要證據待補 | ORIGINAL_APP_LOOPBACK_PGLITE |
| REL-12 | 移除會議決議≠刪整場 | 必要證據待補 | ORIGINAL_APP_LOOPBACK_PGLITE |
| REL-13 | 決議完成/重開/關聯修復 | 必要證據待補 | ORIGINAL_APP_LOOPBACK_PGLITE + ORIGINAL_APP_NATIVE_POSTGRES |
| REL-14 | 無涉船決議完成與重開 | 必要證據待補 | SOURCE_ONLY |
| REL-15 | 整場會議結案與重開 | 必要證據待補 | ORIGINAL_APP_NATIVE_POSTGRES |
| REL-16 | 逐船進度、最後一船與整體軸 | 既有證據可沿用 | ORIGINAL_APP_LOOPBACK_PGLITE + ORIGINAL_APP_NATIVE_POSTGRES |
| REL-17 | 逐船等待ACK的較新輸入與清除 | 既有證據可沿用 | ORIGINAL_APP_NATIVE_POSTGRES |
| REL-18 | 通知/audit/歷史/未選資料是完整效果 | 既有證據可沿用 | ORIGINAL_APP_LOOPBACK_PGLITE + ORIGINAL_APP_NATIVE_POSTGRES |
| REL-19 | 會議歷程新增/保留/合法刪除與actor | 必要證據待補 | ORIGINAL_APP_NATIVE_POSTGRES |
| REL-20 | 個人移除與共享完成/永久刪除 | 既有證據可沿用 | ORIGINAL_APP_LOOPBACK_PGLITE |
| REL-21 | 原無單船 Delete／任意link-unlink不列缺碼 | 原範圍不含 | ORIGINAL_APP_NATIVE_POSTGRES |
| REL-22 | 真雲端邊界單列 | 真雲端待驗 | SOURCE_ONLY |
| REL-23 | 會議內控取消與涉船縮減的保護 | 必要證據待補 | ORIGINAL_APP_LOOPBACK_PGLITE |

### Itinerary、備選、行事曆、營運投影與匯出

| ID | 保留的操作／規則 | 結果 | 證據層 |
|---|---|---|---|
| IT-01 | UTC儲存、每欄fixed offset顯示與Excel往返 | 既有證據可沿用 | HELPER + ORIGINAL_UI_NATIVE_XLSX |
| IT-02 | L/U多選及A:/F:吃水文字保留 | 既有證據可沿用 | HELPER + ORIGINAL_UI_NATIVE_XLSX |
| IT-03 | 保留原自動/手動ETA/B/C/D計算 | 既有證據可沿用 | HELPER + SSR |
| IT-04 | 刪首列時上一港承接已刪列港名 | 既有證據可沿用 | HELPER + SOURCE_WIRING |
| IT-05 | 備選同document最多5個、船端編輯瀏覽 | 既有證據可沿用 | HELPER + SSR + PGLITE + NATIVE_READ_EXPORT |
| IT-06 | 正式首列ETA起算live聯動備選 | 本輪補驗通過 | 原船端UI＋native PostgreSQL獨立讀回；僅G-ALT指定流程 |
| IT-07 | 備選轉正式僅複製草稿、人工保存且保留備選 | 本輪補驗通過 | 原船端UI＋native PostgreSQL獨立讀回；僅G-ALT指定流程 |
| IT-08 | 同document保存備選可推進revision並留history | 既有證據可沿用 | PGLITE + ORIGINAL_UI_NATIVE |
| IT-09 | 船端保存的人工三項確認 | 既有證據可沿用 | HELPER + ORIGINAL_PORTAL_NATIVE |
| OP-01 | 正式sortOrder首列完整bundle投影 | 既有證據可沿用 | HELPER + PGLITE |
| OP-02 | 首次無正式整組fallback、之後stale不倒退 | 既有證據可沿用 | HELPER |
| OP-03 | 原保存後營運船卡/行事曆消費同一確認版本 | 必要證據待補 | SOURCE + HELPER；native只證保存/讀回，不代證所有下游DOM |
| CA-01 | 登入四原角色可進Calendar且不擴可選船 | 必要證據待補 | SSR + SOURCE_WIRING；不是四角色Calendar browser |
| CA-02 | ETA–ETD預勾、hover六行完整欄位 | 既有證據可沿用 | SSR + HELPER |
| CA-03 | 有效執行排程才投影且DL獨立 | 必要證據待補 | 0.5 helper確有S1 PASS；全duration/DL測試僅找到source |
| CA-04 | 停用單船事件隱藏、跨船保有效部分且關係不刪 | 必要證據待補 | CURRENT_SOURCE_ONLY；未找到停用Calendar原UI receipt |
| CA-05 | 備選不進Calendar/報告/email | 既有證據可沿用 | HELPER + SOURCE + ORIGINAL_UI_REPORT/XLSX |
| EX-01 | 岸端只匯出選中正式行程與完整metadata | 既有證據可沿用 | ORIGINAL_APP_NATIVE + XLSX/ZIP_XML + EXCEL_COM |
| EX-02 | 岸端preview取消零保存、只套用勾船 | 既有證據可沿用 | ORIGINAL_APP_NATIVE |
| EX-03 | 岸端ACK/未知結果/鎖競爭保留逐船語意 | 既有證據可沿用 | ORIGINAL_APP_NATIVE + REAL_XLSX |
| EX-04 | 匿名船端正式-only及正式＋備選分開匯出 | 既有證據可沿用 | ORIGINAL_PORTAL_NATIVE + REAL_XLSX/ZIP_XML |
| EX-05 | 船端匯入先草稿、拒錯船/多分頁、人工保存 | 既有證據可沿用 | ORIGINAL_PORTAL_NATIVE + REAL_XLSX |
| RP-01 | 手動報告凍結正式快照、ACK後成功 | 既有證據可沿用 | ORIGINAL_APP_NATIVE + PGLITE |
| RP-02 | 歷史page/date/exact-ID與不可變正式預覽 | 既有證據可沿用 | ORIGINAL_APP_PGLITE_PREVIEW + NATIVE_CLIENT_READBACK + HELPER/SSR |
| RP-03 | 每日09:00正式日快照保留本機SQL證據 | 既有證據可沿用 | PGLITE + SOURCE_CRON_CONFIGURATION |

## 保留的差異與例外

- 內控「撤回同步」、取消內控、刪除內控與刪除要事是不同操作，保留原通知／歷史／關聯處理；不改成任意新 link/unlink 功能。
- 一船進度、整體要事、會議決議與整場會議的生命週期分開；單船原本没有的 Delete 不新增。
- 備選與正式可存在同一 Itinerary document，保存可推進 document revision；備選不進正式船卡、行事曆、報告或郵件。帶入正式只建立草稿，仍須人工保存。
- **PRINT-MEETING 嚴格字級檢查仍是 FAIL**：原有「追蹤中」標籤 7.5pt，未為助手額外提出的 8pt 門檻改畫面。原樣／內容核對與此門檻分開。
- 手機證據是本機390px Owner／操作員指定內容，不是實體手機與所有頁面逐像素驗收。
- 舊 FAIL／NOT_RUN、setup失敗與後續成功各自保留；不改寫歷史、不把重跑次數當額外成功。

## 仍須真雲端及正式發布前確認

1. 另行確認隔離 Supabase 目標及允許的外部寫入／成本，再驗實際 RPC、既有角色權限、Realtime／斷線重連及排程。
2. 正式現況唯讀盤點、完整更新／readback／切換與回退操作包，另階段處理。
3. 切換必保留準備期間新增資料；不能拿早期備份覆蓋目前資料。
4. 正式 SQL 仍由本人複製、貼入、按 Run；Push 預設本人。沒有本輪正式 SQL／Push／部署／正式資料讀寫。

## 可追溯文件

以下收據路徑皆相對本機證據根目錄：`C:/Users/tuotu/AppData/Local/hermes/cache/ship-preflight-854802a`。

本repo摘要索引：`pre-release-local-coverage-index.json`。

- 完整規則／來源行號／證據路徑：`coverage-ledger.json`。
- 固定分母及排除範圍：`frozen-denominator.json`、`contract.json`、`gap-execution-contract.json`。
- 舊證據跨版本核對：`bridge-reconciliation.json`、`relations/byte-reuse.json`、`relations/callback-byte-reuse.json`、`relations/receipt-input-binding.json`。
- 初始各域盤點保留在 `relations/`、`itinerary/` 與 `parent-matrix.json`，不以最後結果覆寫最初缺口。
- 新執行在 `relations-qa/`、`itinerary-qa/` 與 `parent-qa/` 的獨立資料；既有14695本人試用站不動。

## 本輪補驗與停止原因

- 已獨立核對三個G-ALT情境：新增／起算即時連動、帶入正式僅改草稿且SQL零變動、人工保存revision8後新頁與獨立SQL一致；因此只關閉IT-06、IT-07。
- 關聯組另有同名不同actor的歷程刪除、取消／縮減範圍授權拒絕等helper證據；不冒充原UI/native已通，相關缺口仍保留。
- 關聯UI測試先遭遇缺少本機browser-authority接線／SQL，父層接續再遇重複seed，調整後GT-01仍在Runtime.evaluate逾時，沒有合格的新UI成功收據。不是已證明要事保存壞掉。
- 營運投影最初fixture行程列順序不合法；改為合法序列後仍顯示「行程讀取失敗」，本輪未取得足以定位的完整load-many/validator證據。原因仍待分辨測試資料／QA接線或產品讀取邊界，不能一概歸咎QA，也不能當產品已修正。
- 原Itinerary收據另保留三則未分類Runtime例外；指定G-ALT的資料／SQL斷言已獨立核對，但不作console全無錯的聲稱。
- 已停止整批重試。`final-owned-cleanup.json`確認本輪已無匹配QA程序，已知11個QA埠均關閉，殘留自建Chrome profile與owned junction已移除。舊cleanup=false記錄保留並另列後續處置。
- 下一個最小工作單元是定位這個讀取失敗及修正瀏覽器測試控制，再跑本表未通的相連流程；不是重做全站，也不是先改產品／先上線。

## 表格完整性核對

- 固定規則列：65；原導航入口：10；AppData欄位：12。
- 狀態：`{"EXCLUDED": 1, "HOSTED_ONLY": 2, "LOCAL_EVIDENCE_GAP": 13, "NEW_PASS": 2, "REUSED_PASS": 47}`。
- 完整JSON SHA256：`ea50fbd6bd9192fb44da97448196ad5e8ec6d5d44e101ee232b2262babae15d2`。
