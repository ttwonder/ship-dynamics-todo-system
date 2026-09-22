# 總清單新增要事

## 使用方式與範圍

- 岸端「待辦總表／總清單」在「數據統計」左側增加「＋ 新增要事」。只有既有新增要事權限可使用；船舶角色不增加此入口。
- 先選目前可使用的啟用船舶，再開原新增要事表單。沒有預選船舶；選定後船舶固定，選錯請取消並重選。
- 復用 `addTaskForVessel`、`TaskEditModal`、`saveTask`，沒有第二套保存或寫入路徑。既有新增草稿、協作鎖、待同步佇列、權限重查及雲端確認均保留。
- 原分類對應的船卡燈號在保存中合併，保留原有其他燈號；要事關注、手動關注及異常標記沿用原規則。沒有改成結案後自動熄滅分類燈。
- 追蹤窗口及「我的待辦」沿用原責任歸屬，不因建立者或 Owner 身份自動新增指派。
- 新入口不清除目前篩選或勾選。正常保存確認後，新要事若不符合當前篩選，顯示可清除篩選查看的提示。排隊中的新增仍顯示原等待保存提示，不誤報成功。
- 既有船卡、早會、批量視窗新增入口與船端內控入口不變。不需要資料庫 migration。

## 本機驗證

```text
npm run test:total-task-create
npm run test:total-task-create-browser
npm run test:task-creation-lock
npm run test:pending-task-creation-queue
npm run test:permissions
npm run test:attention
npm run test:attention-dimensions
npm run test:work-center-updates
npm run test:page-statistics
npm run build
```

瀏覽器驗證需要明確指定絕對路徑的 `SHIP_QA_PG_BIN`、`SHIP_QA_PG_MODULE`、`QA_EVIDENCE_ROOT`。沿用既有 portable PostgreSQL 及 Chrome；不新增產品依賴。`QA_EVIDENCE_ROOT` 必須位於 repository 外。

證據層級：原始 `main.tsx → App`、真實表單操作、隔離的合成帳號與測試資料、本機原生 PostgreSQL及 SQL 讀回；**不是正式 Supabase 驗收**。瀏覽器只允許連接自己的 loopback QA origin，不使用正式憑證或使用者瀏覽器資料。

瀏覽器情境：

1. 選船取消零業務寫入、不建立鎖；停用及無權限船不出現在選項。
2. 原新增表單取消，沒有新增案件或改變燈號，原新增鎖釋放。
3. 真正 SQL commit 後暫扣回覆：同船案件與燈號一致、其他船不變，表單不提前關閉或誤報成功；放行 ACK 才完成。
4. 船卡保留原分類燈與較高的手動關注，顯示異常；真正登入追蹤窗口帳號可在「我的待辦」看見案件。
5. 明確拒絕保存時保留輸入，案件與燈號都不變；重試沿用原待同步恢復流程，最終只新增一筆。
6. 非預設篩選及已選項保留，保存後被篩選隱藏有明確提示；清除篩選可見新增案件。
7. 桌機／手機入口及選船視窗的可見性、範圍與溢出檢查，截圖核對；全新文件重新讀取仍有已保存資料。

## QA 注意事項

- 登入後的預設部門篩選可能隱藏合法的新案。測試應明確建立自己的篩選前提，不改產品預設來配合測試。
- 案件表格選擇器需限定 `.batch-task-table`；總清單另有隱藏列印表格，不能把其選中列加入畫面列數。
- 明確失敗後的重試可能進入既有待同步佇列，需等待保留的 lease 到期及真正 SQL 讀回；編輯器關閉不等於已保存。
- Windows `initdb` 偶有超過既有 30 秒的情況。本驗證明確使用 `initTimeoutMs:120000`，其他 native QA 呼叫的預設不變。
- 窄版截圖需先捲到總清單工具列；只拍頁首無法證明新增按鈕可見。
