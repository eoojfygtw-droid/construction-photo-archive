# NEXT_ACTIONS — 工地照片歸檔系統

## 當前進度
**正式後端 V0 實機驗收通過**（2026-06-05，真 Telegram `@Cotton19testrobot`）。`server/`（Node + TS）8 片全跑通，五層工地判斷 + 歸檔 + 按鈕逐項對過 DB 與 `data/` 落地（裸碼/`#`/位置/photo_gps(EXIF GPS,document 保留 EXIF,距 0m)/recent_context/media group 3 張合併/✅ 確認/✏️ 改工地重歸檔且 record_no 不重編）。`npm run typecheck` 過；離線 smoke 全綠。
🟢 已可進「連續 5 工作天」驗收期。實機唯一落差已修正：manual_code 擴充為**裸碼也認**（只比對已登錄工地，見 PROGRESS_LOG/DECISIONS）。
**2026-06-08 補驗收期巡檢工具**：`npm run report` 產唯讀 HTML 日報（`data/_reports/report-YYYYMMDD.html`），補上「V0 沒後台網頁、5 天怎麼核對資料」的缺口（見 DECISIONS，不提前做 V1 後台）。離線 smoke 14/14、四支全綠、typecheck 過（scripts 已納入檢查）。
Web Prototype v0 仍在等同學回饋（GitHub Pages 臨時公開，開發告一段落要收回 private）。

## 下一步（依優先序）
1. **進入 V0「連續 5 工作天」驗收期**（最優先）：實機驗收已過，接著**連續 5 個工作天實際使用、欄位修正率達標才進 V1**。
   - 開始前可清掉今日測試資料（app.db + `data/projects`/`_inbox`/`_staging`），保留 seed，從乾淨狀態起算。（**尚未執行**，待決定）
   - 正式上線建議把 `server/.env` 的 `TELEGRAM_ALLOWED_CHAT_ID` 綁定單一工作群組（目前未設＝接收所有來源）。
   - 重要照片提醒回報者用「**檔案/文件**」上傳才保留 EXIF（GPS/拍攝時間）；用「照片」會被壓掉。
   - 開跑前健檢：`npx tsx scripts/preflight.ts`（驗 token、印 bot 名，不外洩 token）。
   - **每日核對**：每天收工 `cd server && npm run report`（或 `npm run report -- YYYY-MM-DD`），瀏覽器開 `data/_reports/report-YYYYMMDD.html`，掃三點 → ①筆數對不對 ②有沒有掉進 _inbox ③判定方式/工地對不對。發現錯誤就記下來算欄位修正率。
2. **等同學確認 prototype 操作流程**（外部回饋）：欄位夠不夠（樓層/工種/區域）、Bot 回覆格式、匯出檔名格式。
3. **建檔前置**：取得公司對「工程照片送外部 AI API」知情同意（V0 未接 AI，V1 要，先談）；準備工種分類字典 + 嚴重度標準 + 50–100 張歷史照片校準樣本（供 V1 AI few-shot）。
4. **接戰情室**（時機到再做）：過 META_RULES 第 4 條安全檢查後，於 `ai-warroom-meta/config/projects.json` 加一筆（只放進度統計，照片/個資不放）。

## 規劃中（不急，架構已預留，往後推進時順手做）
- **多入口匯入**（目前照片入口只有 Telegram，2026-06-05 確認要擴充）：
  - **資料夾匯入**：監看本機/NAS 指定資料夾，丟進去的照片走同一套歸檔流程（適合補歷史照片、批次匯入）。
  - **網頁上傳**：併入 V1 後台網頁時順手加一個上傳頁。
  - 接法：各寫一個 adapter 實作 `MessageChannelAdapter`（或等價 intake 介面），餵出正規化 `IncomingMessage` 給核心；工地判斷／歸檔／DB 完全不用改。

## 已完成
- [x] **正式後端 V0：實機驗收通過**（2026-06-05，真 Telegram）：五層判斷 + 歸檔 + 按鈕全綠，對過 DB 與 `data/` 落地
- [x] **manual_code 擴充裸碼**：`#A001` 與裸碼 `A001` 都認（只比對已登錄工地清單；離線 7/7 + 實機通過）
- [x] **正式後端 V0：收訊管線 + adapter 介面**（Telegram long polling → 正規化 IncomingMessage，預留換 LINE）
- [x] **正式後端 V0：照片下載 + EXIF**（exifr，document 保留 EXIF / photo 壓縮掉；含 HEIC 能力）
- [x] **正式後端 V0：相簿合併**（media group debounce 約 2 秒合併單筆）
- [x] **正式後端 V0：工地判斷前 4 層 + /addproject**（manual_code/photo_gps/telegram_location/recent_context；判不出→unresolved）
- [x] **正式後端 V0：SQLite 落地 5-1**（records/photos/status_logs、編號流水號、回報人、狀態歷程；用 node:sqlite）
- [x] **正式後端 V0：搬檔歸檔 5-2**（_staging→projects/_inbox、metadata.json/text.txt、清暫存；DB 存正式路徑。離線驗收 16/16）
- [x] **正式後端 V0：Bot 回覆 + ✅ 確認 5-3a**（callback_query 管線、整理結果+✅/✏️、待確認→待改善、重按防呆。離線驗收 13/13）
- [x] **正式後端 V0：第 5 層按鈕詢問工地 + ✏️ 改工地 5-3b**（工地選單、reassignArchive 重歸檔、record_no 不重編、resolve_method=manual_pick。離線驗收 16/16）
- [x] Web Prototype v0（7 頁：儀表板 / 紀錄列表四篩選 / 紀錄詳細改狀態存備註 / 無法判斷工地頁模擬人工歸檔 / 工地設定 GPS / 匯出報表 / Telegram 流程模擬 3 情境）
- [x] 建置驗證通過（tsc + vite build）
- [x] 關鍵決策定案（通道 Telegram、五層工地判斷、_inbox、紀錄編號格式、media group 合併、HEIC exifr、V0 範圍刪減）見 docs/DECISIONS.md
- [x] 規格文件 docs/PRD_v2.md、交接文件 docs/HANDOFF.md
- [x] repo + `.gitignore`（照片/影片/個資/機密全擋）+ docs 四件套（2026-06-05 接戰情室管轄）

## 待釐清問題
- [ ] 同學回饋三件（欄位完整度 / Bot 回覆格式 / 匯出檔名）尚未回來
- [ ] 公司是否同意工程照片送外部 AI API（V1 前必確認；敏感案場可關 AI）
- [ ] 工種分類字典與嚴重度判定標準由誰提供、何時給
- [ ] 24 小時運行主機定哪一個（NAS DS1517+ / 小主機 / 雲端 VM）
- [ ] 使用規模最終是 1–3 人（續用 Telegram）還是全工地（須切 LINE）

## 不做的事（V0 明確 out of scope）
- 不做 AI 影像辨識（保留 AIAnalyzer 介面，V1+ 才接）
- 不做語音轉文字（V1）、不做後台網頁（V1）、不做 LINE、不做 PDF
- 判不出工地不硬猜、不一次產出全部程式碼
