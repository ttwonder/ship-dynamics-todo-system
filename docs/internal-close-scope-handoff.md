# 內控單筆結案：同船跟蹤單誤報衝突

**原入口**：首頁 → 內控異常 → 更新 → 結案並保存 → 選擇日期 → 確認結案。岸端修正，不需要 SQL 或資料搬移。正式案件未用於試寫。

舊版會把讀到一筆來源跟蹤單，誤當成編輯器已載入整船跟蹤清單。提交時額外讀入同船其他單，導致同一版本比較到不同資料集合，報「缺少可信的雲端合併基線」。現在以原編輯範圍比較；若真的有新版，只補讀有變化的歷程目標。保留權限、鎖、版本檢查、追加歷程規則及原子寫入。已保存讀取範圍的草稿在恢復時沿用原範圍；舊格式仍保留原有保護。

## 操作與影響

- 結案：這筆內控及確實關聯的跟蹤項目以同一個實際結案日期結案。既有關聯要事一併處理；未連結且本次未勾選要事同步時不建立要事。其他同船、同單號項目不受影響。
- 重開：清除目前結案日期，保留歷程。更正日期：維持已結案，變更結案日期。結案本身不等於送船／完工，不改其日期或 DL。
- 確認畫面分列來源、案件及要事、變更結果、保持不變的欄位，以業務名稱和日期取代技術 ID。資料不足時不猜測同步對象。

## 本機驗證（原 UI、合成資料、獨立 PostgreSQL）

`node scripts/verify-internal-close-scoped-browser.mjs [--baseline] [same-vessel|other-vessel|task|rewrite|rollback]`，需設定 `SHIP_QA_PG_BIN`、`SHIP_QA_PG_MODULE`、repo 外的 `QA_EVIDENCE_ROOT`。`--baseline` 使用 c8c860a；same-vessel 預期測試失敗並出現原錯誤，零 writer。只把未關聯單移到另一艘船，原版即通過。修正版同船通過；無要事／既有要事分別在一次提交更新兩／三個端點，保留送達日、DL、三筆舊狀態記錄。同船同單號的另一筆保持原樣。真實改寫舊歷程被拒絕；測試注入資料庫錯誤則整組回滾，不冒稱已保存。

另已執行：`scripts/verify-tracking-lifecycle-impact-ui.mjs`、`scripts/verify-managed-action-routing.mjs`、`scripts/verify-browser-authority-bootstrap.mjs`、`test:tracking`、`test:quick-update-history-browser`、`test:atomic-collaboration`、型別檢查與正式打包。草稿恢復包括原分頁、重新載入與重新發現資料來源的受控讀取測試，不當作正式資料恢復回執。

已知測試限制：`test:internal-control` 的 `verify-internal-control-runtime.mjs:53` 在原版就比對舊版單鎖釋放程式字串，與目前逐筆釋放關聯鎖的寫法不同；修前後同一斷言失敗，未以移除斷言取得綠燈。單項結案／權限、案件版本、分析測試另行通過。

## 上線與草稿

使用者 Push 後，由 Pages 部署。本機通過不等於正式案件已結案。若原分頁仍有未保存內容，先保留分頁並另存或抄下草稿、狀態記錄及日期，不清快取、不強制覆蓋。新版先查原單是否已結案；若已有正確狀態及日期，不必再送一次。有已辨識的本機草稿時使用「同步最新（安全合併）」並核對結果；發生真正內容衝突時應保留草稿人工確認。
