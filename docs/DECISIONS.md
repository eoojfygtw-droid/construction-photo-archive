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

## 2026-06-08：V0 驗收期用唯讀 HTML 巡檢日報補後台缺口（不提前做 V1 後台網頁）
- **決策**：V0「連續 5 工作天」驗收期的資料核對,用一支唯讀 CLI 工具 `npm run report` 產 `data/_reports/report-YYYYMMDD.html`,**不提前做 V1 後台網頁**。工具以 `readOnly` 開 `app.db`,只讀不寫、不搬檔,把當日紀錄整理成可一眼核對的單頁（摘要 + _inbox 警示 + 依工地分組 + 縮圖）。
- **理由**：驗收要靠人每天確認「訊息有沒有正確保存分類」,但純翻檔案夾 + SQLite GUI 不可行;提前做 V1 後台又破壞「V0 驗收未過不進 V1」的分版紀律。唯讀日報是最小代價的中間解——驗收完還能當日常健檢續用,且零寫入風險不會污染驗收資料。
- **影響範圍**：新增 `server/scripts/report.ts`（含可被 import 的 `generateDailyReport`）、`server/scripts/smoke-report.ts`,`package.json` 加 `report` script 並把 smoke-report 串入 `test`。輸出在 `data/_reports/`（`.gitignore` 已擋）。

## 2026-06-08：scripts/ 納入 typecheck
- **決策**：`server/tsconfig.json` 的 `include` 從 `["src/**/*"]` 擴為 `["src/**/*", "scripts/**/*"]`,讓 `npm run typecheck` 也檢查 smoke / 工具腳本。
- **理由**：原本 scripts 完全沒被型別檢查,`report.ts` 漏帶 `photos` 欄位這種錯 `typecheck` 抓不到、要到執行才炸。納入後即時擋掉;代價是會曝出既有腳本的潛在小問題（本次修掉 `smoke-site.ts` 未用的 `dirname` import,因 `noUnusedLocals`）。

## 2026-06-08：bot 正式部署為 Windows 背景常駐排程（非前景視窗）
- **決策**：驗收期 bot 以 Windows 排程 `ConstructionPhotoBot` 常駐——S4U（不論登入與否、背景無視窗）、開機自啟、崩潰每分鐘自動重啟，動作 `run-bot.cmd`→`npm start`（正式模式）。啟動/註冊/移除腳本（run-bot.cmd、register/unregister-bot-task.ps1、view-log.cmd、remove-bot.cmd）含本機絕對路徑，**gitignore 不入庫**（換機需重生）。
- **理由**：掛在對話/前景主控台會被誤關或隨對話結束而停；經互動主控台啟動還會被主控台關閉時的 Ctrl+C 連帶結束。背景 S4U 無視窗、不可誤關、開機即起，最適合 5 天無人值守常駐。
- **影響範圍**：新增本機腳本（不入庫）；需使用者本人執行註冊（建立持久化動作被 AI 安全機制擋下，由使用者跑 `register-bot-task.ps1`）。

## 2026-06-08：加存活監控——Telegram 狀態通知 + healthchecks.io 死手開關
- **決策**：新增 `server/src/ops/notifier.ts`（與核心解耦、全 env-gated）。bot 啟動/停止/崩潰發 Telegram 通知，並每 3〜5 小時隨機回報工作時長；同時每 60s ping healthchecks.io。通知與警報都進獨立「運維群」(`TELEGRAM_ADMIN_CHAT_ID`)，與工作群 (`TELEGRAM_ALLOWED_CHAT_ID`) 分離。另加：訊息含「偷懶」→ 回報工作時長的互動。
- **理由**：5 天無人值守須知道 bot 是否活著。bot 自報涵蓋重啟/停止/程式崩潰；但「整台機器斷電/當死」自己發不了訊息，必須靠外部心跳中斷由 healthchecks 觸發警報（死手開關）。通知獨立群避免洗工作群。
- **影響範圍**：`notifier.ts`（新）、`index.ts`（啟動/關閉/崩潰掛鉤 + 偷懶查詢 + 非工作群不歸檔守門）、`env.ts`（+ admin chat / healthcheck url / interval）、`TelegramAdapter.ts`（放行運維群來源以供互動，歸檔仍只限工作群）、`logger.ts`（加寫純中文 `activity.log`）。`.env.example` 補三個選填欄位。

## 2026-06-08：recent_context 2 小時沿用——維持現狀，驗收期觀察
- **決策**：第 4 層 recent_context「2 小時內沿用最近工地」**維持不變**（不縮短時間窗、不改成強制標代碼）。
- **理由**：實機發現「離開工地後 2 小時內亂傳的無定位照片會沿用到上一個工地」。確認這是設計內的便利（同工地連拍免重複標代碼）兼風險，使用者決定先維持、**驗收期實際觀察**是否造成誤歸，5 天後再決定是否調整。可調點：`SiteResolver` 時間窗 / 是否保留第 4 層。

## 2026-06-08：/新增工地 座標可選 + 傳位置設中心（現場可用）
- **決策**：`/新增工地`（`/addproject` 的中文別名，好記）改為**最少給「代碼 名稱」即可**，座標可省。省略座標時先建工地（GPS 自動判定關閉，仍可用 `#代碼` / recent_context 歸檔）並記 pending；同一回報人 **10 分鐘內傳一個「位置」📍** 即把該座標設為工地中心（半徑 300m，開 GPS 自動判定）。一次帶 `代碼 名稱 緯度 經度 [半徑]` 仍可用。
- **理由**：原本強制現場使用者手打經緯度完全不可行（使用者直接反映）。改成「打代碼名稱、要 GPS 就傳定位」最貼合手機現場操作；精確座標也可由助理代查後用完整指令補。
- **影響範圍**：`Project` 的 center/radius 改 `number | null`；`ProjectStore.findByGps` 跳過無座標工地、新增 `setCenter()`；新增 `PendingSiteStore`；`handleCommand`（2 參數流程 + 中文別名）；`index.ts`（傳位置設中心、handleCommand 多傳 pending）。

## 2026-06-10：單獨傳定位不再沉默——主動判斷工地並回覆／詢問
- **決策**：收到「單獨定位」（無照片、無文字）不再只默默更新上下文。判得出（telegram_location / recent_context）→ 回覆判定到的工地＋「✏️ 改工地」按鈕；判不出 → 直接跳工地選單詢問。使用者點選**只設「目前工地上下文」**（之後 2 小時照片自動沿用），不建檔、不動 projects.json、不搬檔——「純位置不建檔」原則維持不變。
- **理由**：實際使用發現傳定位後 bot 毫無回應，現場體感像「bot 死了」；判不出時使用者也不知道定位沒被用上，白傳。
- **影響範圍**：新增 `core/confirm/locationFlow.ts`（`loc:` 回呼前綴，與 siteFlow 的 `s:` 已建檔重歸分離）；`index.ts` 接 `promptBareLocation` / `handleLocationCallback`；新增 `smoke-location.ts`（5 案例）入 `npm run test`。

## 2026-06-10：錄音存檔——語音/音訊當媒體歸檔（V0 內做，不轉文字）
- **決策**：Telegram 語音/音訊訊息沿用照片下載→搬檔→DB 管線歸檔，`upload_type=voice`、不改資料表；檔名同照片規則 `{record_no}-NN.oga`（副檔名取平台路徑，缺漏依 MIME 推斷）。**不轉文字**——Whisper 仍屬 V1、需先取得公司「送外部 AI」同意。Bot 回覆把照片與錄音分開計數。
- **理由**：現場大量補充靠語音，原本語音訊息被直接忽略不建檔，資料漏掉；當媒體存檔零外部依賴、零新表，是 V0 成本最低的補洞法（2026-06-08 已記入規劃，今日落地）。
- **影響範圍**：TelegramAdapter（voice/audio 正規化為媒體）、下載管線（跳過 EXIF）、`recordWriter`；新增 `smoke-voice.ts` 入 `npm run test`。

## 2026-06-10：追加合併——10 分鐘內語音/文字併入上一筆；封單只認 ✅
- **決策**：照片建檔後，同一回報人 **10 分鐘內**傳的**純語音/純文字**自動併入上一筆（媒體續編、備註合併、metadata/text.txt 同步更新），回覆附「🆕 拆成新筆」反悔鈕（同筆只能拆一次）。不併的條件：帶照片或帶位置（各走原流程）、文字含工地代碼（視為切工地）、不同回報人、超過 10 分鐘、該筆已封單。**封單只認 ✅**：從選單選工地/✏️ 改工地只是歸類動作（狀態雖轉待改善），不算封單，後續補充仍併入。
- **理由**：現場習慣「先拍照、再補一段語音說明」，不併會把一件事碎成多筆；封單若看狀態，判不出→選單指定工地的紀錄會立刻變成「不可補充」，與實際意圖不符（使用者只是歸類，事情還沒記完）。
- **影響範圍**：新增 `core/records/appendFlow.ts`（`LastRecordStore`＋封單集合 `markClosed`、`AppendStore` 拆單反悔）；`index.ts`（c: 回呼掛封單、sp: 拆單分流）；新增 `smoke-append.ts` 入 `npm run test`。

## 2026-06-10：選單指定工地也寫 2 小時上下文（固定窗不滑動）
- **決策**：第 5 層按鈕選定工地（manual_pick）成功後，回寫回報人 2 小時工地上下文——記在**紀錄的回報人**（非按按鈕的人）、時間錨在**收件時間**，並以新增的 `UserContextStore.setIfNewer()` 守門（事後 ✏️ 改舊紀錄不會把較新的上下文蓋成舊工地）。recent_context 自動沿用**不續命**，維持固定 2 小時窗；「滑動窗」（沿用即重設計時）列為 6/13 檢討選項之一。
- **理由**：實測抓到缺口——判不出→選單指定 A001 後，下一張照片又跳選單；原因是 manual_pick 是五種正向訊號（代碼/GPS/定位/定位選單/紀錄選單）中唯一沒回寫上下文的。滑動窗雖可整天免重問，但會拉長誤歸風險，正好踩在「2 小時沿用是否誤歸」的觀察項上，先維持固定窗收資料。
- **影響範圍**：`UserContextStore`（`setIfNewer`）、`siteFlow`（指定成功回寫）、`confirmFlow`/`index.ts`（串 `contextStore`）、`smoke-site.ts`（+3 條驗證）/`smoke-confirm.ts`。

## 2026-06-10：定位判不出選單加「➕ 新增工地」——暫存定位自動當中心
- **決策**：單獨傳定位判不出工地時，選單在「已登錄工地＋略過」外加「➕ 都不是，新增工地」（`loc:_new`）。按下提示輸入 `/新增工地 代碼 名稱`；收到任何單獨定位時先以新 `PendingLocationStore` 暫存座標 10 分鐘，`/新增工地` 不帶座標時自動沿用當工地中心（半徑 300m、開 GPS 自動歸檔），並**順手設回報人 2 小時上下文**——建完直接傳照片即歸新工地。與 `PendingSiteStore` 互為鏡像（那邊「先建工地等位置」，這邊「先有位置等建工地」）。
- **理由**：實測在未登錄的新工地傳定位，選單裡根本沒有可選的項目，使用者卡死；按鈕拿不到自由文字，故以「暫存定位＋指令補名稱」二段式完成，全程不必手打座標。
- **影響範圍**：新增 `core/projects/PendingLocationStore.ts`；`locationFlow`（選單按鈕、`loc:_new` 回呼、進場暫存）；`handleCommand`（無座標時先查暫存、建好設上下文）；`index.ts` 串接；`smoke-location.ts` 16→20 條。

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
