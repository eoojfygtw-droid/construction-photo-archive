# NEXT_ACTIONS — 工地照片歸檔系統

## 當前進度
**正式後端 V0 開工中**（2026-06-05）。`server/`（Node + TS）已完成並實機驗收 5 片：收訊管線+adapter 介面 → 照片下載+EXIF → 相簿合併 → 工地判斷前 4 層 → SQLite 落地（5-1）。嚴格分版，每片跑通才做下一片。
Web Prototype v0（純前端 mock）仍在等同學回饋（GitHub Pages 臨時公開，開發告一段落要收回 private）。

## 下一步（依優先序）
1. **完成後端 V0 剩餘兩片**：
   - **5-2 正式搬檔歸檔**：照片從 `_staging` 搬到 `data/_inbox/{record_no}/` 或 `data/projects/{code}_{name}/{YYYY}/{MM}/{DD}/records/{record_no}/`，寫 `metadata.json`/`text.txt`，更新 DB 路徑。
   - **5-3 Bot 回覆 + 人工確認**：回報整理結果 + inline keyboard「✅ 正確 / ✏️ 修改」，含第 5 層「按鈕詢問工地」（callback_query + 狀態），確認後定案。
   - **V0 驗收＝連續 5 個工作天實際使用，欄位修正率達標才進 V1**。
2. **等同學確認 prototype 操作流程**（外部回饋）：欄位夠不夠（樓層/工種/區域）、Bot 回覆格式、匯出檔名格式。
3. **建檔前置**：取得公司對「工程照片送外部 AI API」知情同意（V0 未接 AI，V1 要，先談）；準備工種分類字典 + 嚴重度標準 + 50–100 張歷史照片校準樣本（供 V1 AI few-shot）。
4. **接戰情室**（時機到再做）：過 META_RULES 第 4 條安全檢查後，於 `ai-warroom-meta/config/projects.json` 加一筆（只放進度統計，照片/個資不放）。

## 規劃中（不急，架構已預留，往後推進時順手做）
- **多入口匯入**（目前照片入口只有 Telegram，2026-06-05 確認要擴充）：
  - **資料夾匯入**：監看本機/NAS 指定資料夾，丟進去的照片走同一套歸檔流程（適合補歷史照片、批次匯入）。
  - **網頁上傳**：併入 V1 後台網頁時順手加一個上傳頁。
  - 接法：各寫一個 adapter 實作 `MessageChannelAdapter`（或等價 intake 介面），餵出正規化 `IncomingMessage` 給核心；工地判斷／歸檔／DB 完全不用改。

## 已完成
- [x] **正式後端 V0：收訊管線 + adapter 介面**（Telegram long polling → 正規化 IncomingMessage，預留換 LINE）
- [x] **正式後端 V0：照片下載 + EXIF**（exifr，document 保留 EXIF / photo 壓縮掉；含 HEIC 能力）
- [x] **正式後端 V0：相簿合併**（media group debounce 約 2 秒合併單筆）
- [x] **正式後端 V0：工地判斷前 4 層 + /addproject**（manual_code/photo_gps/telegram_location/recent_context；判不出→unresolved）
- [x] **正式後端 V0：SQLite 落地 5-1**（records/photos/status_logs、編號流水號、回報人、狀態歷程；用 node:sqlite）
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
