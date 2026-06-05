# DECISIONS — 工地照片歸檔系統

> 設計決策依日期排序。詳細演進脈絡見 docs/HANDOFF.md。

## 2026-06-05：訊息通道採 Telegram，但強制 adapter 介面
- **決策**：V0 用 Telegram Bot（long polling，免公開網址，API 免費，開發最快）。訊息接收層必須寫成 `MessageChannelAdapter` 介面，核心邏輯不依賴特定平台。
- **理由**：初期使用者僅 1–3 人（特助自用），Telegram 部署成本最低；但台灣工地全員推行阻力大，未來可能須換 LINE（webhook + 公開 HTTPS），故用 adapter 預留換道空間、避免重寫。

## 2026-06-05：AI 定位為「輔助結構化」，非主分類；V0 不接 AI
- **決策**：必填欄位（棟別/樓層/工種）靠人工說明 + Bot 追問，AI 只做輔助結構化。V0 完全不接 AI 影像辨識，但保留 `AIAnalyzer` 介面，V1+ 才接 Claude API（影像）+ Whisper（語音）。
- **理由**：初版「AI 影像辨識分類」準確率不可控，先把歸檔管線做穩、用人工說明確保必填欄位正確；AI 留待有校準樣本（50–100 張歷史標註）後再驗準確率。

## 2026-06-05：工地判斷五層優先序，判不出不硬猜
- **決策**：工地歸屬依序判斷 manual_code(#A001) > photo_gps > telegram_location > recent_context(2 小時內) > 按鈕詢問使用者；全部判不出 → 存 `data/_inbox/{record_no}` 暫存，不可硬猜。位置訊息＝設定該使用者 recent context（與第 4 層共用機制）。
- **理由**：不依賴群組 ID（單一群組可能多工地）；硬猜會污染資料、缺失追蹤失準，寧可進 inbox 待人工歸檔。

## 2026-06-05：紀錄編號與歸檔日期規則
- **決策**：紀錄編號＝`{project_code}-{YYYYMMDD}-{3 位流水號}`；歸檔日期以**收件時間**為準，EXIF 拍攝時間另存欄位。資料夾結構 `data/projects/{code}_{name}/{YYYY}/{MM}/{DD}/records/{record_no}/`（photos/ voices/ text.txt metadata.json），無法判斷者進 `data/_inbox/{record_no}/`。
- **理由**：收件時間穩定可控（EXIF 可能缺或被壓掉）；EXIF 拍攝時間仍保留供稽核。

## 2026-06-05：媒體與 EXIF 處理
- **決策**：media group（一次傳多張照片）debounce 約 2 秒合併為**同一筆**紀錄，不拆多筆。重要照片建議走 Telegram document 上傳（保留原圖 EXIF），photo 上傳會被壓縮移除 EXIF。EXIF 解析用 exifr（需支援 HEIC）。
- **理由**：一次回報多張本是同一缺失；Telegram photo 壓縮掉 EXIF 是已知雷，document 才保原圖；iPhone 多為 HEIC，解析庫須支援。

## 2026-06-05：資料外傳聲明（V1 AI 前置）
- **決策**：照片/語音「會」送 AI 服務商 API（V1+），須先取得公司知情同意；除 AI API 外不傳任何第三方、不公開發布、原始檔永久保存本機不刪。敏感案場可關閉 AI 改純人工欄位。
- **理由**：原規格「不對外發送任何資料」與 AI 功能矛盾，據實修正並要求公司同意，避免工程資料資安爭議。

## 2026-06-05：嚴格分版，V0 驗收未過不進 V1
- **決策**：V0（Bot 收訊→五層判斷→歸檔→SQLite→Bot 按鈕確認）驗收＝連續 5 個工作天實際使用、AI 欄位修正率 < 15%；過了才做 V1（語音/後台/Excel/狀態流），再 V2（前後照片關聯/逾期提醒/日報）。
- **理由**：一開始做太大做不完是最大風險；先用最小管線換真實使用回饋。
