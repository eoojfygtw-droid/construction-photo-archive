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

## 2026-06-05：manual_code 擴充——裸碼也認（比對已登錄工地清單）
- **決策**：第 1 層 manual_code 由「只認 `#A001`」擴充為「`#A001` 明確標註 **與** 裸碼 `A001` 都認」。裸碼比對規則：取訊息/說明中所有英數整段詞，**只在剛好等於某個已登錄工地代碼時**才命中（不分大小寫、需整段相等，不做模糊比對）；`#標註` 優先於裸碼。
- **理由**：實機驗收發現工地現場工人多半不會記得打 `#`，原規則會把「今天到 A001」這類正常回報誤判成 unresolved 丟進 _inbox。只比對已知代碼清單，誤判風險低（例如 `A0011` 不會錯認成 `A001`、純文字「現場」仍正確留 unresolved），兼顧好用與正確。
- **影響範圍**：`server/src/core/resolve/SiteResolver.ts`（`matchManualCode`）。離線 7/7 + 實機皆驗證通過。取代上方「五層優先序」決策中 manual_code 僅 `#A001` 的描述。

## 2026-06-05：紀錄編號與歸檔日期規則
- **決策**：紀錄編號＝`{project_code}-{YYYYMMDD}-{3 位流水號}`；歸檔日期以**收件時間**為準，EXIF 拍攝時間另存欄位。資料夾結構 `data/projects/{code}_{name}/{YYYY}/{MM}/{DD}/records/{record_no}/`（photos/ voices/ text.txt metadata.json），無法判斷者進 `data/_inbox/{record_no}/`。
- **理由**：收件時間穩定可控（EXIF 可能缺或被壓掉）；EXIF 拍攝時間仍保留供稽核。

## 2026-06-05：媒體與 EXIF 處理
- **決策**：media group（一次傳多張照片）debounce 約 2 秒合併為**同一筆**紀錄，不拆多筆。重要照片建議走 Telegram document 上傳（保留原圖 EXIF），photo 上傳會被壓縮移除 EXIF。EXIF 解析用 exifr（需支援 HEIC）。
- **理由**：一次回報多張本是同一缺失；Telegram photo 壓縮掉 EXIF 是已知雷，document 才保原圖；iPhone 多為 HEIC，解析庫須支援。

## 2026-06-05：資料外傳聲明（V1 AI 前置）
- **決策**：照片/語音「會」送 AI 服務商 API（V1+），須先取得公司知情同意；除 AI API 外不傳任何第三方、不公開發布、原始檔永久保存本機不刪。敏感案場可關閉 AI 改純人工欄位。
- **理由**：原規格「不對外發送任何資料」與 AI 功能矛盾，據實修正並要求公司同意，避免工程資料資安爭議。

## 2026-06-05：SQLite 函式庫改用 Node 內建 node:sqlite（原訂 better-sqlite3）
- **決策**：後端 SQLite 改用 Node 24 內建的 `node:sqlite`（`DatabaseSync`），不用 `better-sqlite3`。
- **理由**：`better-sqlite3` 為原生模組，在 Node 24 + Windows 常需 node-gyp/VS build tools 編譯易卡；`node:sqlite` 零相依、免編譯、同步 API 幾乎相容（prepare/run/get/all），未來要換回成本低。代價：目前為 experimental，啟動會印一行警告，可接受。
- **影響範圍**：`server/src/db/`；HANDOFF「正式後端規格摘要」原寫 better-sqlite3，以本決策為準。

## 2026-06-05：照片先進 _staging 暫存，正式歸檔分片做
- **決策**：收訊下載的照片先落 `server/data/_staging/{日期}/{訊息id}/`，DB 先記 staging 路徑；正式搬到 `_inbox`/`projects/{code}/.../records/{record_no}/` 與寫 metadata.json/text.txt 留待 5-2 片。
- **理由**：嚴格分版——先把「收得到、判得準、存進 DB」跑通，再做檔案搬移與資料夾結構，降低單片複雜度與風險。

## 2026-06-05：同一回報人訊息序列化處理（recent_context 正確性）
- **決策**：非相簿訊息由收訊主迴圈逐則 await 處理完再處理下一則，不併發。
- **理由**：工地判斷第 4 層 recent_context 需「設定上下文的訊息」先於「讀取的訊息」完成；併發會讓沿用上下文偶發失準。相簿仍走 debounce 合併。

## 2026-06-05：工程機密以本地/私有為預設，對外發布前必先徵詢
- **決策**：系統一律本地/私有（後端跑自家主機/NAS、照片與 SQLite 留本機、V1 後台網頁僅區網內，非公開網站）。任何對外公開動作（repo 設 public、GitHub Pages、部署公網、送第三方 API）都須先明確徵詢使用者。照片/個資/案場座標永不進 git。
- **理由**：需求方核心信任前提，外洩即專案失敗，優先於任何功能。資料離開掌控的已知三處：Telegram 伺服器（通道本質）、V1+ AI API（需公司同意，敏感案場可關）、戰情室 docs（只放紅綠燈、無真數字）。
- **備註**：2026-06-05 為給同學看 prototype 暫將 repo 設 public + 開 Pages，屬臨時窗口，開發階段結束應收回 private。

## 2026-06-05：改工地不重編 record_no（5-3b）
- **決策**：當一筆 `INBOX-` 紀錄事後被人工指定工地（第 5 層按鈕詢問或 ✏️ 改工地），**record_no 保留原編號不重編**，只填 `project_code`/`project_name`、把照片搬到 `projects/{code}_…` 並改寫 metadata，`resolve_method` 標為 `manual_pick`，狀態定案 `待改善`。
- **理由**：record_no 當不可變識別碼最單純，零重編號與資料夾改名風險；前綴語意的小落差（INBOX vs 工地碼）可在 V1 後台補顯示工地欄位。重編會牽涉唯一性、流水號重算、跨資料夾搬移，CP 值低。
- **影響範圍**：`server/src/core/confirm/siteFlow.ts`、`archiver.reassignArchive`。

## 2026-06-05：V0 歸檔目錄照片平鋪（暫不分 photos/voices 子目錄）
- **決策**：V0 把照片直接放 `records/{record_no}/`，檔名 `{record_no}-{NN}{ext}`（自帶識別、匯出可追溯），同層放 `metadata.json`/`text.txt`。HANDOFF 原規格的 `photos/ voices/` 子目錄暫不開，待 V1 接語音時再分。
- **理由**：V0 只有照片、無語音，平鋪最簡單；檔名已自帶 record_no，不靠目錄分類也能追溯。搬檔策略：同碟 `rename`，跨碟/失敗退 `copy+unlink`，連退路都失敗保留暫存路徑不丟檔。

## 2026-06-05：嚴格分版，V0 驗收未過不進 V1
- **決策**：V0（Bot 收訊→五層判斷→歸檔→SQLite→Bot 按鈕確認）驗收＝連續 5 個工作天實際使用、AI 欄位修正率 < 15%；過了才做 V1（語音/後台/Excel/狀態流），再 V2（前後照片關聯/逾期提醒/日報）。
- **理由**：一開始做太大做不完是最大風險；先用最小管線換真實使用回饋。
