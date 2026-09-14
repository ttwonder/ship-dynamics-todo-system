# 本機正式編譯產物：PDF與窄幅內容驗收

本片使用 **真實原 App UI＋隔離 native PostgreSQL 測試資料＋本機 production build**；不是正式網站、真雲端或實體手機驗收。執行基線 `90ce18c2ecf2f8f4e824b3ef1600bec7b8cce4b7`／tree `f930a8bf7a4204a9135739fb56de9152cdcfd9b8`。產品 TS/TSX/CSS/SQL/套件未變，無 Push／部署／正式 SQL。

## 原四項範圍的結果

| 情境 | 結果與限制 |
|---|---|
| PRINT-SELECTED | 父核對 SCOPED_PASS。原 checkbox／原列印入口產生真正 Chromium PDF；選中標記在、未選標記不在，實際渲染頁面及內容邊界完整。 |
| PRINT-MEETING | 真 PDF 內容、頁面與原樣已核對。嚴格「所有字形皆≥8pt」仍 FAIL：只有原有「追蹤中」狀態標籤是7.5pt，其餘文字≥8.497pt。此失敗不改寫成PASS，不擅自更改原UI。 |
| MOBILE-OWNER | 後續 mobile-only 首次執行及父核對 SCOPED_PASS。390px Owner登入、原同步、會議主題／決議與待辦工具列／實列。 |
| MOBILE-OPERATOR | 同一 mobile-only 執行 SCOPED_PASS。獨立登入／同步、390px待辦工具列與實列，保留原角色投影。 |

## PDF字級不是此次儲存改造造成的縮小

- PDFium原始字級不能直接當成紙上尺寸；以文字物件矩陣計算有效尺寸，另與 pypdf 的文字/頁面矩陣核對，兩者一致。
- 最低字形精確定位為「追蹤中」。原基準 `baseline/pre-normalized-storage` 與本候選的整份 CSS 是同一 Git blob；標籤與 `.meeting-status{font-size:10px}` 都原已存在。
- 保留原始 FAIL、PDF及渲染圖；不為滿足助手加上的全字形門檻而放大既有標籤。這不代表全域字級或全部輸出格式已驗收。

## 手機補驗不是取消保護或重印PDF

首批 runner 在兩次登入後點原「同步最新」，卻一律取消 confirm，並可能以背景讀取/舊saved標記判斷同步完成，因此留下提示、手機內容覆蓋也不完整。這批舊結果與證據保留。

父層只補手機兩項：接受**該次主動同步、同一browser session、完整訊息完全相符且僅一次**的確認；其他對話仍拒絕。確認後要求新的讀取、原唯一「已同步雲端」完成文案、saved狀態及身份警告消失，不以背景讀取單獨判成功。

- 沿用原已驗證建置；第二份完整raw source copy供QA依賴使用，未重建或重印PDF。
- 兩個原同步確認、兩個成功同步結果；無未分類對話或JS錯誤。
- 六張390×844原圖已逐一檢視：Owner會議主題/決議、Owner待辦工具列/實列、操作員工具列/實列。
- 六處量測 `innerWidth=390`，文件及body寬度均為375（有垂直捲軸），目標均在視窗範圍內。導航列局部橫捲及正常垂直捲動保留，不強行消除。
- 原可關閉的綠色同步浮層可能遮住畫面上緣部分標籤，未遮住本次目標內容；不擴稱全頁零浮層或pixel-perfect parity。

## 證據與保全

首批 `browser-compat-90ce18c/`：648份Git/raw/Windows來源、714個artifact pins、17份實際供應的建置資產、native完整業務圖及60表讀回已核對。`browser-compat-parent-90ce18c/` 保存字級交叉核對與部分結果處置。

補驗 `browser-mobile-completion-90ce18c/attempt-1/`：實際命令exit0、原runner精確衍生、原同步確認、幾何、PNG、native讀回及清理收據。`browser-mobile-parent-90ce18c/acceptance.json` 與 `visual-review.json` 為父層核對：648來源/複本、原714份證據不變、16個執行來源、17建置資產重用、60表及完整業務圖不變；自有ports/processes已關閉、PG資料/瀏覽器profile及依賴/建置junction已移除。父核對程式曾修正欄位與inventory範圍假設，未因此重跑產品檢查。

本片沒有新產品修改或獨立code review。原有 build/typecheck 證據與完全相同的建置產物重用；唯讀驗收文件不觸發重建。

## 尚未交付或未涵蓋

Excel、Admin／Vessel所有工作流程、真雲端ACL/PostgREST/Realtime、持續可用本人試用站、正式切換／回退操作包及上線驗收，不能由本片宣稱完成。此處兩項PDF使用原列印入口及真正Chromium PDF生成，不代表已自動操作Windows原生另存新檔對話框。
