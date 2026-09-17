# 首頁行事曆及督導排序

- 首頁仍預設船卡；新增「切換行事曆顯示」，沿用原 ItineraryCalendar，ETA–ETD、要事、時區及工具列維持既有規則。
- 行事曆初次進入全選目前可見船舶。督導／其他篩選變更時，選取改為可見船舶；沒有符合船舶則顯示空白範圍。清除篩選恢復全選。穩定資料輪詢不重設手動選取；入會、批量、Itinerary 表格選取分開。
- 督導下拉增加 Owner／管理員專用「排序」，以上下箭頭調整後點「保存排序」。其他角色只讀取排序結果。
- optional `settings.supervisorOrder` 儲存穩定 user ID，經既有 audited/ACK 管理保存及 records settings CAS 上雲，不用 localStorage 當權威，不調整 AppData.users、權限或分管關係。
- 未設定排序保持原順序；新督導排在後面；停用／不可見 ID 可保留，重複 ID 去重。正規化不得替舊資料新增預設排序。
- 保存失敗保留排序草稿；等待保存期間禁止修改；取消不寫入。管理員設定例外僅 supervisorOrder，不放寬其他系統設定。
- 本機腳本：`npm run test:dashboard-calendar-entry`、`npm run test:supervisor-order`，加原看板、權限、Itinerary、typecheck/build。原 App＋native SQL 的保存／重開與行事曆互動由隔離試用驗證，不能用 SSR 冒充。
- 船端四欄與下一港 SQL 前置見 `itinerary-current-state-release.md`；正式 SQL、Push、部署須另外授權。
