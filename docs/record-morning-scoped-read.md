# Morning 按需讀取（本機候選）

## 範圍與不變項

以 `dc65d6d4ab02354dce3ea22d1acb4d8740c44b3e` 為本片固定基準；只調整內部讀取與投影。MorningWorkspace、Report UI、JSX、CSS、文案、密度、按鈕、操作、角色權限、業務分類、手機與 PDF 原 source 保留。沒有新 UI、資料搬移或正式 SQL 執行。

## 讀取與寫入邊界

- `morning`（或 `{morning:true, targets}`）是 client logical scope，不是新 SQL scope。先讀 `home`，依原 `latestManualReport`／`reportCutoff` 找到真正有效、非 scheduled 的人工 baseline，再讀全部 tasks、internalControlCases、meetings 所需完整 graph 與該 baseline；額外 target 合併保留。
- 兩讀 revision 相同才回傳完整 model，最多三次；缺 metadata 或 revision 持續改變即拒絕，不能 partial publish。不傳未選的巨大歷史 snapshot；仍讀取原分類需要的全部工作資料，不宣稱已做逐船資料庫分頁或消除所有歷史載入。
- `__recordMorningTimes` 只保留 `windowEndedAt`／`capturedAt`。沿用原 cutoff 優先順序，不把假的 snapshot 塞回 UI。SQL 先剝除舊 metadata、只由有效 snapshot 建立投影，最後剝除 snapshot；normalizer 不讓 metadata 取代真 snapshot。legacy full-save 與 block patch 都拒寫這些唯讀欄位。
- 原導覽續行加入 morning fence；開啟 task／切換 overall 保留 morning context，返回分頁不改內容。保存今日早會與正式預覽維持 full coverage；task／內控 linked save 保持原交易與權限。
- 同日人工重存保留第一次 cutoff 與舊 snapshot；最新工作內容累積下一場。不同日期的新人工 baseline 才按原規則移動窗口。

## 驗證與沿用證據

`node scripts/verify-morning-scoped-boundary.mjs` 對固定基準逐檔驗證精確內部替換、完整凍結其餘產品 source，並比較 App 全部 JSX；反例只在記憶體，不改產品。不得放寬相鄰 slice 的歷史 boundary 來迎合本片。

既有 `morning-v1/matrix7/ui-mpprxi/receipt.json` 是現行原 UI/native PostgreSQL PASS：MW1 冷讀；MW2 選船／空選全部、空 filter 零筆、類型／priority／排序；MW3 混合 task/case 每頁 30 筆及編輯取消返回；MW4 延遲導覽／身份退出、新日期 baseline 與同日 cutoff；MW5 內控 linked task、task 實存、今日保存完整 graph 與 full 預覽。11 個 UI/native 場景、9 個原 component 模型、1 個分類／metadata boundary 分層計數，不相加成 UI 場景。

沿用已核對 raw bytes 的 history、pagination、agenda classification、cutoff、workspace window gates；report／stats 相鄰 PASS 的唯一 input 差異是它們不使用的 morning browser verifier。父方另重跑 12 個 production callbacks、typecheck、meeting inclusion，補足 control runner input 與 command exit 缺口。完整 input 與 commit/tree 綁定見 repo 外 `morning-scoped-delivery.json`。

SQL oracle 的 expected 在送入 SQL 前獨立形成，不能以 actual 倒造。含合法新增的保存不得以整體 before/after 相等作判斷；既有原行與預期新增按 collection/entity 核對。matrix5 的同日 cutoff 錯誤期待及 matrix6 all-wire timeout 保留為歷史失敗；matrix7 已完成相同合約，不重稱目前產品 bug。

## 限制與交付

有限確定性收尾，不開新 review 循環，不宣稱新的獨立 review PASS。既有基準與現行均未有的新增 PDF section 不屬本片，記錄後續需求，不改測試硬變綠；本片只證明 PDF／手機 source 未變，不宣稱新增 PDF/mobile 驗收。build 的輸出及 cache 放 repo 外。僅驗證後本機 commit；push、正式 SQL、production 連線與部署皆未執行，需另行授權。
