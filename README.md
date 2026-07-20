# 船舶動態與會議管理系統

本專案由原始單檔 HTML 改造成 React + Vite + TypeScript，可部署到 GitHub Pages，並預留 Supabase 雲端同步。

## 已包含

- 已從附件 Excel 讀取 106 位辦公室人員、40 艘船舶作為初始資料。
- 首次進入後需先設定進站密碼；系統只保存雜湊、不保存明文。
- 首次初始化不建立 placeholder Owner，需從辦公室人員清單選擇第一位 Owner 並設定用戶名/密碼。
- 其他初始人員預設為操作員；Owner 可在管理中心重設或清除人員密碼，系統只保存雜湊、不保存明文。
- Header 提供登入、登出、切換用戶；登入用戶會記住在本機瀏覽器。
- Owner / 管理員 / 操作員權限分流。
- 管理中心可管理人員、權限、船舶、經管船舶、進站密碼、Supabase 設定、操作紀錄。
- 船舶動態保留智能船舶 API 接口欄位，目前以 mock-smart-ship-api 模擬位置、速度、港口與 ETA。
- 船舶載貨、人工位置備註、近期動態、後續補充可手動修改。
- 昨日未結、總清單、已結案、統計、臨時會議、保存會議議程/PDF 均已建立。
- 有手動「同步最新 / 保存修改」按鈕，也有登入後自動同步、自動保存雲端框架。

## 本機運行

```bash
npm install
npm run dev
```

## 打包驗證

```bash
npm run build
```

## GitHub Pages

1. 用 GitHub Desktop 加入此資料夾：
   `C:\Users\tuotu\Documents\ship-dynamics-todo-system`
2. Commit。
3. Push 到 GitHub。
4. 到 GitHub Repo `Settings → Pages → Source` 選 `GitHub Actions`。
5. Actions 綠燈後，用 Pages URL 開啟。

## Supabase

前端只可使用 Project URL 與 anon public key，不可使用 service_role key。

1. 在 Supabase SQL Editor 執行 `supabase/schema.sql`。
2. 把 Project URL / anon public key 寫入：
   `public/supabase-config.js`
3. 或由 Owner 在管理中心填入本機測試設定。

正式部署時建議把 `public/supabase-config.js` 裡的 placeholder 改成正式 public config 後再 commit。

## 密碼安全說明

系統保存的是 SHA-256 hash，不保存或展示舊密碼明文。Owner 可重設自己與管理員/操作員密碼；管理員可重設自己的密碼。這比直接顯示明文密碼安全。
