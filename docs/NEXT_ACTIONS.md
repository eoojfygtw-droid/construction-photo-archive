# NEXT_ACTIONS — 工地照片歸檔系統

## 當前進度
**Web Prototype v0 已完成、待同學回饋**（2026-06-05 接手戰情室管轄）。
純前端 mock（Vite + React + TS，7 個頁面），tsc + vite build 通過、本機 `npm run dev` 可跑。
正分享 GitHub Pages 給建設公司特助試操作流程。下一階段＝動工正式後端 V0。

## 下一步（依優先序）
1. **等同學確認 prototype 操作流程**（卡在外部回饋）：收斂三件——欄位夠不夠（要不要樓層/工種/區域）、Bot 回覆格式好不好懂、匯出檔名格式。
2. **動工正式後端 V0**（prototype 確認後才開始，嚴格分版）：
   - Bot 收訊（文字 / 照片 / caption），照片下載保存、讀 EXIF（拍攝時間、有 GPS 則記錄）
   - media group（一次多張）debounce 約 2 秒合併為同一筆紀錄
   - 五層工地判斷：manual_code(#A001) > photo_gps > telegram_location > recent_context(2 小時) > 按鈕詢問
   - 判不出 → 存 `data/_inbox/{record_no}`，不硬猜
   - 寫入 SQLite（projects / records / photos / user_contexts / status_logs），記錄回報人
   - Bot 回覆整理結果 + inline keyboard「✅ 正確 / ✏️ 修改」，人工確認後定案
   - **V0 驗收＝連續 5 個工作天實際使用，AI 欄位修正率 < 15% 才進 V1**
3. **建檔前置**：取得公司對「工程照片送外部 AI API」的知情同意（V0 其實還沒接 AI，但 V1 要，先談）；準備工種分類字典 + 嚴重度標準 + 50–100 張歷史照片校準樣本（供 V1 AI prompt few-shot）。
4. **接戰情室**（時機到再做）：過 META_RULES 第 4 條安全檢查後，於 `ai-warroom-meta/config/projects.json` 加一筆（只放進度統計，照片/個資不放）。

## 已完成
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
