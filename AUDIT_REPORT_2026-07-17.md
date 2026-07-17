# 船舶動態與會議管理系統－程式稽核報告

- 日期：2026-07-17
- 範圍：前端認證流程、角色可見範圍、待辦 CRUD、統計、報告、臨時會議、Supabase 同步與響應式 UI
- 分支：`main`
- 結論：本次確認的功能與資料一致性問題已修復；自動測試、嚴格型別檢查、production build 與隔離瀏覽器驗收通過。未推送遠端。

## 1. 已修復

### 登入與 Owner

- 未登入時不再自動採用第一位人員。
- 無 Owner 時必須先以既有人員帳密登入，只能將目前已驗證登入者初始化為 Owner。
- 已停用帳號即使保留舊 session 也不能繼續使用。
- 登入頁不顯示預設密碼；新增人員必須明確設定密碼。
- Owner 初始化僅接受啟用帳號；目前 Owner 不可自行降級或停用而破壞有效 Owner 不變條件。

### 資料與同步

- 載入本機／雲端 payload 時執行核心集合驗證與舊資料正規化。
- 新增全域 Error Boundary，未預期執行期錯誤不再只呈現白頁。
- 修正本地日期，避免 UTC 導致台灣日期錯一天。
- 本機模式保存只回報「已保存於本機瀏覽器」。
- 雲端保存加入 revision compare-and-swap；載入相同 revision 不會自動重寫。
- 本機 revision 高於既有雲端 revision 或雲端載入失敗時，會阻擋所有寫入；必須先明確同步最新資料。
- 移除管理頁可繞過啟動衝突鎖的獨立雲端保存路徑，統一由頁首同步／保存。
- 本機快取綁定 Supabase URL／資料表／workspace identity；切換到不同或來源未知的空工作區時禁止自動初始化，避免跨工作區複製。
- 每次入隊、實際 CAS 與同步完成前都重新核對目前 workspace identity；其他分頁變更設定時立即阻擋舊 revision。
- 自動保存與手動保存共用單一 coalescing queue，CAS 請求串行執行並保存最新待寫 revision。
- 正規化器逐層過濾 null 集合項目、非字串陣列元素與畸形 log/report，避免 React child crash。

### 角色與指派

- 操作員只可看到雙向指派範圍內船舶；零艘指派不再退化為全部可見。
- 操作員不能修改船舶經管人。
- 經管人異動同步更新 `vessel.assignedUserIds` 與 `user.managedVesselIds`。
- 管理頁具有導覽、render 與 action handler 多層防護。

### 待辦、統計與報告

- 新增事項先使用 draft；取消不落庫，確認建立後才新增。
- 禁止建立無內容事項。
- 統計從完整可見事項計算，不受總表 `closedMode` 篩選污染。
- 新增已結案入口、查無事項空狀態與零船報告阻擋。

### 臨時會議

- Owner／管理員可新增與保存；操作員唯讀。
- 操作員只看到其船舶相關會議或全部船舶會議。
- 唯讀編輯區使用原生 disabled fieldset，鍵盤亦不能修改。
- 逐船／船型模式解析為零艘時禁止保存。
- 跟進事項記錄 `sourceMeetingId`，修改既有會議不重複建立。
- 900px 以下改為單欄；桌面導覽固定單列並可橫向捲動。

## 2. 自動驗證

全部通過：

```text
npm run typecheck
npx tsc --noEmit --strict --noUnusedLocals --noUnusedParameters
npm run test:audit                  # 26/26
npm run test:normalize              # malformed payload runtime regression
npm run test:requested
npm run test:workflow
npm run test:management
npm run test:meeting-scope
npm run test:hybrid-ui
npm run build
npm audit --omit=dev              # 0 vulnerabilities
```

Production build：68 modules；CSS 37.43 kB（gzip 7.66 kB）；JS 508.06 kB（gzip 140.30 kB）。

## 3. 隔離瀏覽器驗收

使用空 Supabase URL/key 的獨立 origin；未寫入正式雲端。

實證通過：

- 進站後先要求個人登入，再初始化目前登入者為 Owner。
- 零船報告被阻擋；本機保存訊息正確。
- 新增 Modal 開啟及取消時事項數不變；有效建立後才增加。
- 結案統計：總 7、未結 6、已結 1、完成率 14%。
- 查無篩選顯示 0 筆與明確空狀態。
- 零艘操作員看板為 0 艘、沒有管理入口。
- 操作員臨時會議 fieldset：23 個控制項全為 `:disabled`、0 個 `:enabled`，不能聚焦。
- 逐船 0 艘建立時顯示「請至少選擇一艘船舶」，會議與事項數不變。
- 全部船舶會議建立後：1 筆會議、40 艘、40 筆具來源 ID 的跟進事項。
- 再次保存後仍為 40 筆關聯事項，無重複。
- 零艘操作員可讀該全部船舶會議，但無新增／保存入口。
- 桌面三欄沒有重疊、裁切或水平溢出；導覽孤立換行已修正。
- 瀏覽器 console 無 JavaScript error。
- 注入含 null 集合項與物件型字串字段的 malformed localStorage 後，頁面正常進入登入；Error Boundary 未觸發、Console 0 error，且不安全元素已過濾。

## 4. 安全掃描

- 未發現 service-role key、私鑰、資料庫連線字串、`eval`、`innerHTML`、debugger 或除錯 log。
- `public/supabase-config.js` 的 anon key 屬瀏覽器公開金鑰；本次未修改該檔案。
- production build 已還原正式 dist，未留下 QA 空設定。

## 5. 保留風險與建議

### 重要架構風險

目前為靜態前端應用，角色與密碼雜湊保存在應用資料中。UI 權限與 revision CAS 可防止正常操作誤用及並發覆蓋，但**不能取代 Supabase Auth、後端授權及 RLS**。能直接呼叫 Supabase API 或修改瀏覽器狀態的人，仍可能繞過前端角色判斷。

正式敏感用途建議：

1. 使用 Supabase Auth 建立每位人員的真實身份。
2. 以 RLS／RPC 在資料庫端強制 Owner、管理員與操作員權限。
3. 密碼改用具 salt 與成本參數的 Argon2／bcrypt；目前 SHA-256 雜湊不適合抵抗離線字典攻擊。
4. 部署後立即由 Owner 更換所有預設／種子密碼。

### 非阻斷項目

- JS chunk 約 506 kB，Vite 提示超過 500 kB；可後續用 dynamic import 拆分管理、報告及臨時會議頁。
- 遠端 QA browser 固定為 1254px，無法動態改 viewport；窄版由 CSS media-query 契約測試與靜態規則驗證，未取得 320/600/900px 實機截圖。
- Git 顯示多個檔案將由 LF 轉 CRLF，屬既有 Windows 行尾設定警告，`git diff --check` 已確認沒有行尾空白錯誤。
