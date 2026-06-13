# NEXT_ACTIONS — 工地照片歸檔系統

## 當前進度
**🟢 2026-06-10 晚間再補三塊**：**錄音存檔**（語音/音訊當媒體歸檔 `upload_type=voice`、不轉文字）＋**追加合併**（建檔後 10 分鐘內語音/文字自動併入上一筆、附 🆕 拆成新筆反悔；**封單只認 ✅**，選工地不封單）＋**選單指定工地也記 2 小時上下文**（判不出→選單指定後，後續照片不再每張都問；維持固定 2 小時窗不滑動）。20:09 bot 重啟後**實測 4 筆全驗證通過**（選單選工地後 2 照片+1 錄音全自動歸 C001、✅ 封單後錄音正確開新筆）。實測再加一塊：**定位判不出選單加「➕ 新增工地」**（`loc:_new`＋`PendingLocationStore`：剛傳的定位暫存 10 分鐘，`/新增工地 代碼 名稱` 自動拿它當中心＋設 2 小時上下文）。typecheck + 7 支 smoke 全綠（16/13/19/20/14/16/30）。另把**建檔回條改回條語氣**（「✅ 已自動歸檔，不用回覆。資料有誤才按 ✏️」，判定方式中文化；按鈕保留＝封單/計分照舊），**追加併入回覆也統一成同版型**（顯示併入後總計數與合併備註，按鈕仍只有 🆕 拆成新筆）。**⚠️ 「➕ 新增工地」、回條語氣、併入回條在 20:26 重啟之後才寫——要再跑一次 `restart-bot.cmd` 才生效。**

**🟢 2026-06-10 補強：單獨傳定位不再沉默**（`locationFlow.ts`：判得出回覆工地＋✏️改工地、判不出跳選單、點選只設 2 小時上下文不建檔；smoke-location 5 案例入 `npm run test`，現 5 支全綠）。**同日 17:42 已跑 `restart-bot.cmd`** —— 背景 bot 現跑最新版（含 6/8 `/新增工地` 座標可選新版），桌機 restart 待辦清除。

**🟢 2026-06-08 起進入「連續 5 個工作天」驗收期（第 1 天，今日 7 筆算數）。** bot 已從前景升級為 **Windows 排程背景常駐**（`ConstructionPhotoBot`：S4U 無視窗 / 開機自啟 / 崩潰自動重啟）＋**存活監控**（Telegram 上班/下班/出事/每 3-5h 工作時長 + healthchecks.io 死手開關 → 運維群）＋純中文活動紀錄（`activity.log` / `view-log.cmd`）＋「偷懶」互動。移除：`server/remove-bot.cmd`；6/13 有行事曆提醒決定保留或移除。詳見 PROGRESS_LOG / DECISIONS（2026-06-08）。

**正式後端 V0 實機驗收通過**（2026-06-05，真 Telegram `@Cotton19testrobot`）。`server/`（Node + TS）8 片全跑通，五層工地判斷 + 歸檔 + 按鈕逐項對過 DB 與 `data/` 落地（裸碼/`#`/位置/photo_gps(EXIF GPS,document 保留 EXIF,距 0m)/recent_context/media group 3 張合併/✅ 確認/✏️ 改工地重歸檔且 record_no 不重編）。`npm run typecheck` 過；離線 smoke 全綠。
🟢 已可進「連續 5 工作天」驗收期。實機唯一落差已修正：manual_code 擴充為**裸碼也認**（只比對已登錄工地，見 PROGRESS_LOG/DECISIONS）。
**2026-06-08 補驗收期巡檢工具**：`npm run report` 產唯讀 HTML 日報（`data/_reports/report-YYYYMMDD.html`），補上「V0 沒後台網頁、5 天怎麼核對資料」的缺口（見 DECISIONS，不提前做 V1 後台）。離線 smoke 14/14、四支全綠、typecheck 過（scripts 已納入檢查）。
Web Prototype v0 仍在等同學回饋（GitHub Pages 臨時公開，開發告一段落要收回 private）。

## 下一步（依優先序）
1. **開工先跑 `restart-bot.cmd`**：套用「➕ 新增工地」新功能（其餘 6/10 功能已於 20:09 重啟生效並實測通過）。實測：到未登錄地點傳定位 → 按「➕ 都不是，新增工地」→ 打 `/新增工地 代碼 名稱` → 直接傳照片應自動歸到新工地。
2. **V0「連續 5 工作天」驗收期進行中**（最優先）：**第 1 天 = 2026-06-08**（今日 7 筆算數，未清）。跑滿連續 5 個工作天、欄位修正率達標才進 V1。
   - ✅ 已綁 `TELEGRAM_ALLOWED_CHAT_ID`（單一工作群）；✅ bot 背景常駐 + 存活監控上線；✅ 開跑健檢 `npx tsx scripts/preflight.ts` 通過。
   - 重要照片提醒回報者用「**檔案/文件**」上傳才保留 EXIF（GPS/拍攝時間）；用「照片」會被壓掉。
   - 開跑前健檢：`npx tsx scripts/preflight.ts`（驗 token、印 bot 名，不外洩 token）。
   - **每日核對**：每天收工 `cd server && npm run report`（或 `npm run report -- YYYY-MM-DD`），瀏覽器開 `data/_reports/report-YYYYMMDD.html`，掃三點 → ①筆數對不對 ②有沒有掉進 _inbox ③判定方式/工地對不對。發現錯誤就記下來算欄位修正率。
3. **等同學確認 prototype 操作流程**（外部回饋）：欄位夠不夠（樓層/工種/區域）、Bot 回覆格式、匯出檔名格式。
4. **建檔前置**：取得公司對「工程照片送外部 AI API」知情同意（V0 未接 AI，V1 要，先談）；準備工種分類字典 + 嚴重度標準 + 50–100 張歷史照片校準樣本（供 V1 AI few-shot）。
5. **接戰情室**（時機到再做）：過 META_RULES 第 4 條安全檢查後，於 `ai-warroom-meta/config/projects.json` 加一筆（只放進度統計，照片/個資不放）。

## 規劃中（不急，架構已預留，往後推進時順手做）
- **多入口匯入**（目前照片入口只有 Telegram，2026-06-05 確認要擴充）：
  - **資料夾匯入**：監看本機/NAS 指定資料夾，丟進去的照片走同一套歸檔流程（適合補歷史照片、批次匯入）。
  - **網頁上傳**：併入 V1 後台網頁時順手加一個上傳頁。
  - 接法：各寫一個 adapter 實作 `MessageChannelAdapter`（或等價 intake 介面），餵出正規化 `IncomingMessage` 給核心；工地判斷／歸檔／DB 完全不用改。

## 已完成
- [x] **定位判不出選單加「➕ 新增工地」**（2026-06-10：`loc:_new`＋`PendingLocationStore` 暫存定位 10 分鐘、`/新增工地` 自動當中心＋設上下文；smoke-location 20 條）
- [x] **錄音存檔**（2026-06-10：語音/音訊當媒體歸檔 `upload_type=voice`、副檔名缺漏依 MIME 推斷、回覆分開計數；smoke-voice 16 條。語音轉文字仍 V1）
- [x] **追加合併＋封單規則**（2026-06-10：10 分鐘內純語音/文字併入上一筆、媒體續編、🆕 拆成新筆反悔；封單只認 ✅、選工地不封單；smoke-append 30 條）
- [x] **選單指定工地記 2 小時上下文**（2026-06-10：manual_pick 以 `setIfNewer` 回寫、記回報人、錨收件時間；判不出不再每張都問；smoke-site 19 條）
- [x] **單獨傳定位不再沉默**（2026-06-10：判得出回覆＋改工地按鈕、判不出跳選單、只設上下文不建檔；smoke 5 案例；同日 restart-bot 套用生效）
- [x] **`/新增工地` 新版套用到背景 bot**（2026-06-10 17:42 `restart-bot.cmd` 重啟，activity.log 佐證）
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
- [x] **repo 公開/私有 + 個資盤點**（2026-06-09 筆電完成）：**決定維持 PUBLIC**——個資/機密全盤點通過（無真實地址/電話/身分證、git 歷史乾淨無 token、真實工地清單只在桌機 `server/data/`、被 gitignore 擋死）；「信義豪宅案」確認虛構範例免改；gitignore 無需調整。詳見 DECISIONS 2026-06-09。
- [ ] **分享給他人獨立開發（有人要時再做的 SOP）**：做法 `git clone` 後 `rm -rf .git` 重新 init，或 GitHub「Use this template」；對方須自配 bot token / 自己的測試群 / `projects.seed.json`，**不共用** token 與 data。（repo 已維持 public，對方可直接取用基礎碼，但取不到你的真實工地清單與 token。）
- [ ] **桌機待辦（restart-bot 套「龍哥來了」彩蛋）**：**「龍哥來了」彩蛋**（訊息含「龍哥來了」→ 回「快跑！🏃💨」）已入庫但**尚未套用到正在跑的背景 bot**，需在**桌機**雙擊 `server/restart-bot.cmd`（UAC 同意）才生效，**筆電無法代勞**。（註：`/新增工地` 新版與定位互動已於 2026-06-10 17:42 restart 套用生效，那條待辦已清。）
- [x] **recent_context 2 小時固定窗**（2026-06-13 定案）：驗收期未見明顯誤歸、也無重問抱怨 → **維持現狀不改程式碼**，滑動窗否決（會放大誤歸）。日後若真誤歸，最小調整為縮短 `UserContextStore.ttlMs`（建議 1h）。詳見 DECISIONS 2026-06-13。
- [ ] 同學回饋三件（欄位完整度 / Bot 回覆格式 / 匯出檔名）尚未回來
- [ ] 公司是否同意工程照片送外部 AI API（V1 前必確認；敏感案場可關 AI）
- [ ] 工種分類字典與嚴重度判定標準由誰提供、何時給
- [ ] 24 小時運行主機定哪一個（NAS DS1517+ / 小主機 / 雲端 VM）
- [ ] 使用規模最終是 1–3 人（續用 Telegram）還是全工地（須切 LINE）

## 不做的事（V0 明確 out of scope）
- 不做 AI 影像辨識（保留 AIAnalyzer 介面，V1+ 才接）
- 不做語音轉文字（V1）、不做後台網頁（V1）、不做 LINE、不做 PDF
- 判不出工地不硬猜、不一次產出全部程式碼
