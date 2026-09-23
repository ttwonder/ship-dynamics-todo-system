# 我的待辦：內控狀態標籤與直接編輯

## 使用方式

- 尚未同步成要事的內控案件顯示 `內控(未同步要事)`。
- 已同步案件仍只列原關聯要事，改標示 `內控(已同步要事)`，不再額外列同一案件。
- 這裡的「同步」指內控與要事的業務關聯，並非上傳雲端是否成功。
- 單純勾選要事的「內部管控」不等於由內控案件同步；沒有案件關聯的普通要事不會誤標為已同步。
- 來源篩選與所選項目的列印資料使用一致標籤；新增已同步內控的篩選選項，保留原早會／臨會來源規則。
- 點內控項目內容或「更新」均在我的待辦上開啟原內控編輯視窗，不跳到內控總頁。
- 一般／已同步要事維持原 `openTask` 編輯路徑，不另做一套表單或保存方法。
- 取消或保存後仍留在我的待辦；背景清單不重建，保留既有篩選及選取規則。

## 實作邊界

- `WorkCenter` 傳入精確案件 ID；內控開啟 callback 不再切換頁籤。
- `InternalControlPage` 增加 `editorOnly` 模式，復用同一個 `CaseEditModal` 及原有的讀取、權限、lease、版本檢查、保存、刪除、撤回同步流程。
- 純編輯模式未開啟案件時不輸出頁面、篩選器或列印內容；原內控異常頁完整保留。
- App 仍以原 `canAccessTab` 與操作權限控制入口，按頁籤分開元件生命週期。
- 不變更待辦責任範圍、去重、永久刪除、船端權限或資料庫結構。
- 不需要正式 SQL；本機驗證不是正式環境驗收。

## 驗證

- `npm run test:work-center-direct-edit`：實際 React 元件 SSR，檢查標籤、關聯去重、普通管控標記不誤判，以及純編輯／原內控頁的呈現邊界。
- `npm run test:work-center-direct-edit-browser`：原 `main.tsx → App`、原生輸入、隔離測試資料與本機 PostgreSQL。
- Browser runner 需指定外部 `QA_EVIDENCE_ROOT`、`SHIP_QA_PG_BIN`、`SHIP_QA_PG_MODULE`，使用已安裝 Chrome；不使用正式帳號或後端。
- 六組瀏覽器案例涵蓋：標籤與去重；內容直接開啟與取消零寫入；更新入口、保存確認延遲與 SQL 讀回；普通／已同步要事原編輯器；來源篩選、列印標籤、桌機／手機；重載後持久化與原內控頁。
- 取消與保存確認前後均檢查背景清單仍掛載，並保留已設定的搜尋與勾選；保存後另查 SQL 及新文件重載結果。
- 保存確認測試是在 SQL 提交後暫扣真實回應，非偽造成功；未確認前保留原編輯器。
- 內控更新依原流程先「加入狀態記錄」再保存；已存在要事使用「取消／保存變更」，不是新增案的「取消並關閉／保存並關閉」。
- 相關回歸：`test:work-center-updates`、`test:permissions`、`test:internal-control`、`test:internal-control-projection`、`test:internal-control-presentation-filters`、`test:batch-internal-control`、`test:total-task-create`、typecheck 與 build。
- 舊內控 runtime test 的兩個文字比對隨入口更新：保留總清單的角色資料隔離判斷（不再要求兩個 props 緊鄰），並核對共用內控編輯入口的同步權限守衛。
