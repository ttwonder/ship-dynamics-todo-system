# 相容性來源檢查：兩項既有失配的處置

本片 **只改測試**。產品 TS／TSX／CSS／SQL、畫面、角色政策及套件均不變；無 Push、部署或正式 SQL。

## 原檢查與歸因

`47b1cc4bce63006264fcf2408e57418e65d5a9fb` 的固定八項來源／SSR檢查，原執行為六項 PASS、兩項 FAIL。原始輸出保留於本機 cache `compat-source-gates-47b1cc4/`，未把原 FAIL 覆寫為 PASS。

| 失敗項 | 原始證據 | 本片修正 |
|---|---|---|
| `verify-meeting-pdf-density.mjs` | 原檢查從 meeting compact 樣式起點掃到 CSS 檔尾，把其他 Itinerary 報告字級納入；此 CSS 在核對的原基準與目前版本相同 | 仍保留原間距／密度檢查；字級核對只針對 `body.printing-meeting-detail` 命名空間的規則，並涵蓋後方覆寫，要求可換算字級且至少 8pt |
| `verify-selected-list-pdf.mjs` | 舊來源斷言要求直接呼叫 `onBatchComplete`。目前 `completeSelected → runSelected → submit` 仍傳可完成要事／所選內控 ID，並保留權限與保存確認；是既有 dispatcher 改寫後的失配 | 保留原可選清單、per-vessel 排除、個人移除與 PDF 的各自資格；改核對當前原按鈕及完整 dispatch 連接，不刪掉該項要求 |

## 受影響驗證

- PDF：原失配 RED 保留；修正後原 `node scripts/verify-meeting-pdf-density.mjs` 終端 exit 0。來源 counterfactual 先 RED、再 GREEN。
- Selected list：原失配 RED 保留；來源 counterfactual 先 RED、再 GREEN；原 `node scripts/verify-selected-list-pdf.mjs`（含既有 SSR/helper檢查）exit 0。
- `node scripts/verify-compat-source-oracles.mjs`：17 個 source-contract 正／反控制全通過。實際執行當前 verifier 的程式／斷言；變體只在記憶體建立，不改磁碟產品檔案。包含會議小字、較小 px、晚覆寫、缺失目標 scope；錯選取範圍／callback／permission／ID／按鈕及個人移除範圍。
- 原八項中另外六項沒有重跑；其原 PASS 的程式、測試及相關產品輸入未受本片影響，結尾逐檔核對保留。
- 生產 build／typecheck 不因純測試修正重跑；產品輸入未變。本片沒有新增獨立 code review，不宣稱全工程 review PASS。

## 證據界線

上述是來源契約、SSR/helper 與 source counterfactual 證據。**不是**瀏覽器真實 PDF 下載／列印、手機、Excel、全角色或 hosted Supabase 驗收，也不取代本人隔離試用。

既有函式／原 UI 行為沒有為了讓測試綠燈而改動。測試仍屬來源型 contract，不保證任何未涵蓋的未來重構；後續產品變更仍須對其實際可達流程驗證。

後續 [本機編譯產物的 PDF／手機驗收](browser-print-mobile-compat-local.md) 另記真實瀏覽器結果：所選待辦PDF、Owner／操作員390px內容已完成有界驗收；會議PDF原有狀態標籤7.5pt與嚴格門檻差異仍明列。不得回填成上述八項來源／SSR本身已證明了實際輸出。
