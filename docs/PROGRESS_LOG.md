# PROGRESS_LOG — 工地照片歸檔系統

> 時間軸。重大進展、踩雷、里程碑往這裡補。詳細規格演進另見 docs/HANDOFF.md「二、規格演進歷程」。

## 2026-06-13 筆電：處理桌機/筆電分岔 + recent_context 定案 + 後台確認上 GitHub 🟢
筆電開工（家，C 槽；非 bot 主機，只動程式碼/docs/git）。本場無新功能，主要是**對齊與決策**：
- **桌機/筆電分岔整合**：開工時筆電落後 origin **10 個 commit**（桌機 6/10 那批 bot 功能），同時筆電有**未提交的 6/09 工作**（repo 維持 public 安全盤點 + 「龍哥來了」彩蛋）origin 沒有。先把 6/09 工作 commit，再 `rebase` 到 origin/main 之上（衝突全為純新增，已逐一有腦合併：6/09 PROGRESS 條目插在 6/10 與 6/08 間、NEXT_ACTIONS「桌機 restart 待辦」更新為只剩龍哥彩蛋因 `/新增工地` 已於 6/10 套用、index.ts 彩蛋乾淨合進新版偷懶查詢之後）。typecheck + 7 支 smoke 全綠（16/15/19/20/14/16/34）。
- **recent_context 2 小時固定窗定案維持**（見 DECISIONS 2026-06-13）：驗收期未見明顯誤歸、也無重問抱怨 → 不改程式碼；滑動窗否決（放大誤歸）。收掉 6/08「驗收期觀察」待決項。
- **HANDOFF 更新**：最後更新日 6/05→6/13、補規格演進第 10 條（repo public、recent_context 定案、龍哥彩蛋）。
- **⚠️ 疑似擱置後台（重要踩雷）**：使用者記得桌機「做過後台 + commit+push」，但筆電端窮舉檢查（所有 branch `main`/`gh-pages`/origin + C:\ 各 clone + stash）**找不到任何後台 commit**；桌機本 repo 最後一次真正 push＝`035f542`（6/10 bot 功能）。判斷：後台很可能**做了沒 push、擱在桌機 D 槽**（本機碰不到 D 槽）。已在 NEXT_ACTIONS **置頂給桌機的警告**（開工先 `git log origin/main..HEAD` 查、先 pull --rebase 再 push、絕不 force-push/reset --hard，確認後台上 GitHub 後刪警告）。**✅ 2026-06-14 桌機開工結案**：後台確實「做了沒 push、擱在桌機」（即下方 6/11 那批 4 片）；本次 `git pull --rebase` 把筆電 6/13 那幾筆疊進來後一起 push，後台正式上 GitHub，置頂警告已撤。

## 2026-06-11 ➕新增工地實戰驗證 + V1 管理後台提前啟動（4 片）🟢
桌機開工。兩大塊：

**上半：開工對證與實戰驗證**
- 開工對證發現 NEXT_ACTIONS 警語過期：6/10 晚最後一筆 commit 在 21:06:10，activity.log 顯示 21:06:51 即重啟——**所有 6/10 功能當晚已生效**，今日 19:18 的重啟屬冗余（無害）。
- **「➕ 新增工地」實戰驗證通過**（18:45）：實地新增工地 A002 → 傳定位正確判到 → 後續照片/錄音全自動歸檔併入（A002-20260611-004/-005），「暫存定位當中心＋設上下文」整條鏈實戰過關。
- **驗收期第 4 天乾淨過關**：當日 5 筆全自動歸檔、_inbox 0、欄位修正 0（`npm run report` 巡檢三點皆綠）。

**下半：V1 管理後台 web 提前啟動**（使用者拍板「驗收同步推進」，部分推翻 6/8「不提前做後台」，見 DECISIONS）。`npm run admin` → http://127.0.0.1:3300，純 `node:http` 零新依賴、只綁本機，一日 4 片：
- **5-A1 唯讀瀏覽**：紀錄列表（日期/工地/狀態/判定方式四篩選，對齊 prototype）、詳細頁（照片縮圖/錄音播放/EXIF/狀態歷程）、媒體串流 `/media/{photoId}`（以 DB id 查路徑，無路徑穿越面）；讀取全程唯讀連線，與跑中 bot 零衝突。
- **5-A2 狀態修改＋備註編輯**：狀態按鈕寫 `status_logs`（`changed_by=後台網頁`，同狀態重送防呆）；備註儲存同步重寫歸檔目錄 `metadata.json`/`text.txt`（重用 `appendFlow.rewriteRecordFiles`，檔案與 DB 不脫鉤）；POST 擋跨站 Origin。
- **5-A3 指定/改工地（_inbox 人工歸檔）**：與 bot ✏️ 改工地共用自 `siteFlow` 抽出的 `applyProjectReassign` 核心（搬檔＋metadata＋DB＋狀態一條龍）；工地下拉依 seed 檔 mtime 快取自動重載。prototype「無法判斷工地頁」的人工歸檔自此有真實版。
- **5-A4 儀表板**：總數/_inbox 警示卡、各狀態卡、近 7 天收件趨勢、各工地統計（含最後收件時間）、判定方式分布，全部可點進對應篩選；首頁導向儀表板。
- 驗收期每日核對從此可直接用後台（日報 `npm run report` 保留續用）。**匯出頁刻意不做**——檔名格式等同學回饋。
- 配套核心小改：`Db.init` 加 `busy_timeout=2000`（雙程序寫入等鎖）；`ProjectStore` seed 路徑可注入（測試隔離）。
- **踩雷**：smoke 內 `fetch` keep-alive 連線未斷時 `process.exit` 會觸發 Windows libuv `UV_HANDLE_CLOSING` 斷言、以非零碼炸掉 test 鏈 → 改 `server.closeAllConnections()` ＋ `process.exitCode` 自然退場根治。
- 全程 typecheck ＋ 8 支 smoke 全綠（archive 16 / confirm 15 / site 19 / location 20 / report 14 / voice 16 / append 34 / **admin 58**）；smoke-admin 用暫存 DB＋暫存 seed，不碰正式資料。
- 紅線自查：後台只綁 127.0.0.1、照片不出本機；docs 內案場只寫代號（順手把 NEXT_ACTIONS 一處真實案場名改回代號）。

### 下一步
- 明日 6/12 跑滿驗收第 5 天；6/13 決定 recent_context 時間窗與 remove-bot 去留。
- 後台後續分版：匯出（等回饋）、工地設定管理（待 bot seed 重載機制）、後台回寫上下文（跨程序，評估必要性）。

## 2026-06-10 晚間：錄音存檔 + 追加合併（封單只認 ✅）+ 選單指定記上下文 🟢
桌機晚間接續做（中途 CLI 誤關一次，工作樹無遺失，接續驗證後補完）。三個功能、兩個實測修正，全程 typecheck + 7 支 smoke 全綠（archive 16 / confirm 13 / site 19 / location 13 / report 14 / voice 16 / append 30）：
- **錄音存檔**：Telegram 語音/音訊**當媒體歸檔**——沿用照片下載→搬檔→DB 管線，`upload_type=voice`、不改表、不轉文字（Whisper 仍 V1）；副檔名取平台路徑、缺漏依 MIME 推斷（audio/ogg→.oga）；Bot 回覆分開顯示「🎤 錄音：N 則」。原本語音訊息被忽略不建檔的洞補掉。新增 `smoke-voice.ts`。
- **追加合併**：照片建檔後同一回報人 **10 分鐘內**的純語音/純文字自動**併入上一筆**（媒體續編 `-NN`、備註合併、metadata/text.txt 同步），回覆附「🆕 拆成新筆」反悔鈕（同筆只能拆一次，拆出去自成新紀錄並補發 ✅/✏️）。不併的守門：帶照片/帶位置（各走原流程）、文字含工地代碼（切工地語意）、別人傳的、超時、已封單。新增 `core/records/appendFlow.ts`、`smoke-append.ts`。
- **封單規則（實測修正）**：原本「狀態離開待確認」就不再併，但從選單選工地會把狀態改成待改善——只是歸類動作卻被誤當封單。改成**封單只認 ✅**（`markClosed`），選工地/改工地後補充仍會併入。
- **選單指定記上下文（實測修正）**：實測「判不出→選單指定→下一張照片又跳選單」。原因：manual_pick 是五種正向訊號中唯一沒回寫 `UserContextStore` 的。修正：選定工地後 `setIfNewer` 回寫——記在**紀錄的回報人**（非按按鈕者）、時間錨在**收件時間**（✏️ 改舊紀錄自然過期、不蓋較新上下文）。維持**固定 2 小時窗不滑動**（recent_context 沿用不續命），滑動窗議題併入 6/13 誤歸檢討。
- **20:09 bot 重啟（吃到新版）後實測 4 筆全數驗證通過**：定位判不出→選單選 C001 → 後續 2 照片+1 錄音全走 recent_context 自動歸 C001（**工地選單一次都沒再跳**）；✅ 封單後 6 秒傳的錄音正確開新筆不誤併。實測中使用者把「每筆建檔後的 ✅/✏️ 確認訊息」誤認為又在問工地——那是 5-3a 的整理結果確認（驗收期欄位修正率計分器），不按也已歸檔。
- **追加併入回覆統一回條格式**（實測需求，當場補）：原本併入只回一行「🎤 已併入 …（錄音 1 則＋備註）」，與建檔回條格式不一致。改成同版型（📋 已併入／🏗 工地（判定方式中文化）／📷📷🎤 併入後總計數／📝 合併後備註／👤 回報／不用回覆），按鈕仍只有「🆕 拆成新筆」（不放 ✅，按了會封單）。
- **建檔回條改回條語氣**（實測需求，當場補）：原文案「請確認資料是否正確：＋✅/✏️」每張照片都發，被誤讀成「又在問工地」。改成「✅ 已自動歸檔，不用回覆。資料有誤才需要按 ✏️ 修改。」按鈕改「✅ 確認無誤／✏️ 修改」、判定方式中文化（recent_context→自動沿用 等）。按鈕保留＝封單與驗收期欄位修正率計分照舊。
- **➕ 新增工地選項**（實測需求，當場補）：定位判不出的選單原本只有「已登錄工地＋略過」，人在**新工地**時無從選起。加「➕ 都不是，新增工地」（`loc:_new`）：按下提示輸入 `/新增工地 代碼 名稱`；新 `PendingLocationStore` 把剛傳的定位暫存 10 分鐘，`/新增工地` 不帶座標時自動拿它當工地中心（半徑 300m、開 GPS 自動歸檔）**並順手設 2 小時上下文**——建完直接傳照片就歸到新工地，全程不必手打座標、不必再傳一次位置。smoke-location 16→20 條全綠。

## 2026-06-10 單獨傳定位不再沉默 + restart-bot 套用新版（補記）🟢
桌機接續做（該場次未打收工，本條為事後對齊補記）。兩件事：
- **單獨傳「定位」改主動回應**：過去純位置訊息只默默更新上下文、不回任何訊息，現場體感像「bot 死了」。新增 `core/confirm/locationFlow.ts`：判得出（telegram_location / recent_context）→ 回覆判定到的工地＋「✏️ 不是這個 / 改工地」；判不出 → 直接跳工地選單問「你現在在哪個工地？」。使用者點選**只設「目前工地上下文」**（供 2 小時 recent_context 沿用），不建檔、不動 projects.json、不搬檔——維持「純位置不建檔」原則。`loc:` 回呼前綴與 siteFlow 的 `s:`（已建檔重歸）分離。
- **新增 `scripts/smoke-location.ts`**（5 案例：範圍內命中 / 範圍外選單 / `_pick` 完整選單 / `_skip` 略過 / 選定後沿用），串入 `npm run test`（現 5 支：archive 16 / confirm 13 / site 16 / location / report 14）。typecheck + smoke 全綠（18:45 commit 851afa8 前重跑確認）。
- **17:42 `restart-bot.cmd` 重啟背景 bot**：6/8 的 `/新增工地` 新版＋本日定位互動**皆已套用生效**（佐證：activity.log 17:42:48 完整啟動序列、node 程序啟動時間一致；原始檔最後修改 17:35–17:37 皆早於重啟）。NEXT_ACTIONS「桌機 restart 待辦」清除。
## 2026-06-09 筆電：repo 公開/私有安全盤點 + 「龍哥來了」彩蛋 🟢
筆電開工接續（筆電非 bot 主機，只做程式碼/docs/git）。
- **安全盤點（為決定 repo 維持 public）**：掃追蹤檔無真實地址/門牌/手機/身分證號；`git log --all` 確認歷史**從未**追蹤過 `.env`/`server/data/`/照片/db、無殘留 bot token；唯一具體案名「信義豪宅案」經使用者確認為**虛構測試範例**（免改）。確認真實工地清單 `server/data/projects.seed.json`（`ProjectStore` 讀寫）與所有執行期資料**只在桌機本機**、被 `.gitignore:33 server/data/` 擋死（`git check-ignore` 證實），永不進 git／不到筆電／不上 GitHub。結論：**repo 維持 public 無外洩風險**（見 DECISIONS 2026-06-09）。
- **踩雷（自我糾正）**：一度誤判「`.gitignore` 沒擋 `projects.seed.json`、要補一行」——**錯**。真 seed 在 `data/` 底下早被 `server/data/` 擋住；誤以為它在 server 根目錄（那裡只有追蹤中的 `projects.seed.example.json` 範本）。已撤回，不需改 gitignore。
- **新增「龍哥來了」彩蛋**（`src/index.ts`）：訊息含「龍哥來了」→ bot 回「快跑！🏃💨」。仿「偷懶」查詢做法（新增 `isDragonBrotherAlert`，在 `onRecordReady` 開頭 early return），**不分群、誰都能觸發、不進歸檔流程**。`typecheck` + 4 支 smoke（16/13/16/14）全綠。
> 註：彩蛋需在**桌機** `restart-bot.cmd` 套用到背景 bot 後才生效；筆電僅驗證程式碼。（`/新增工地` 新版已於 2026-06-10 17:42 restart 套用；本彩蛋因 6/10 後才合併入庫，仍待下次 restart 才生效。）

## 2026-06-08 新增工地改為現場可用（座標可選 / 傳位置設中心）+ 中文指令別名 🟢
驗收期間點出 `/addproject` 強制手打經緯度對工地現場根本不可行。改成：①指令加中文別名 **`/新增工地`**（`/addproject` 仍可用）；②**座標可選**——`/新增工地 代碼 名稱` 就能建（先用 `#代碼` 歸檔），加完**傳一個「位置」📍**即自動設成工地中心、開 GPS 自動歸檔；③一次帶全 `代碼 名稱 緯度 經度 [半徑]` 仍可用（供代查座標後貼）。新增 `PendingSiteStore`、`ProjectStore.setCenter`，`Project` 的 center/radius 改 `number | null`。typecheck + 4 支 smoke（16/13/16/14）全綠。
- 待補（V0 可做）：**錄音存檔**——把 Telegram 語音/音訊當媒體歸檔（沿用照片管線、`upload_type=voice`、不用改表），**不轉文字**；轉逐字稿（Whisper）仍 V1、需公司同意送外部 AI。見 NEXT_ACTIONS 規劃中。
> 註：以上程式改動需 `restart-bot.cmd` 套用到背景 bot 後才生效。（✅ 已於 2026-06-10 17:42 重啟套用）

## 2026-06-08 V0 進入 5 工作天驗收期 + bot 背景常駐 + 存活監控 🟢
桌機開工續做。**正式進入「連續 5 個工作天」驗收期**：今日累積 7 筆（A001×1 + C001×6，含 manual_code / photo_gps(距 0m) / recent_context）算**第 1 天，不清資料**。把 bot 從「掛在對話前景」升級成正式常駐 + 自我監控：
- **設定**：`TELEGRAM_ALLOWED_CHAT_ID` 綁定單一工作群（值在 .env）；`npx tsx scripts/preflight.ts` 通過（bot=@Cotton19testrobot）。
- **常駐**：Windows 排程 `ConstructionPhotoBot`——背景 S4U（無視窗、開機自啟、崩潰每分鐘自動重啟），動作 `run-bot.cmd`→`npm start`（正式模式，非 dev/watch）。
- **存活監控（新 `src/ops/notifier.ts`，與核心解耦、env-gated）**：Telegram 狀態通知 🟢上班/🔴下班/⚠️出事 + 每 3〜5 小時隨機「工作 N 分鐘」；healthchecks.io 心跳（60s，斷電/當機外部警報）。通知與警報都進獨立「機器人運維群」(`TELEGRAM_ADMIN_CHAT_ID`)，與工作群分離。死手開關已實測 down→up 警報送達運維群。
- **純中文無雜訊活動紀錄**：`logger` 加寫 `data/_logs/activity.log`（排除 npm/node 雜訊）+ `view-log.cmd` 即時監看視窗。
- **「偷懶」互動**：訊息含「偷懶」→ bot 回「報告老闆我沒偷懶，已經工作 N 分鐘了」；adapter 放行運維群以便互動，但只有工作群訊息會被歸檔。
- **防遺忘三道保險**：①每幾小時主動回報刷存在感 ②一鍵移除 `remove-bot.cmd` ③Google 行事曆 6/13 09:00 提醒決定保留或移除。
- **踩雷**：(a) 含中文的 `.ps1`/`.cmd` 被 Windows PowerShell 5.1 / cmd 以 Big5 讀爛（`'ndows' 不是內部命令`）→ 改純 ASCII 解決；(b) 經互動主控台 `Start-ScheduledTask` 啟動的 bot 會被主控台關閉時的 Ctrl+C 連帶結束（exit 0，排程「崩潰才重啟」不觸發）→ 改 S4U 背景執行（無主控台）根治。
- 全程 `typecheck` + 4 支 smoke（16/13/16/14）全綠；紅線：token/chat id/心跳網址只在 .env、照片/DB/log/活動紀錄在 `server/data/`，啟動移除腳本含本機絕對路徑 → 皆 gitignore。

### 下一步
- 跑滿連續 5 個工作天，每天 `npm run report` 核對三點；持續觀察 recent_context 2 小時沿用是否在實際節奏下造成誤歸（見 DECISIONS）。
- 6/13 行事曆提醒到時決定：bot 保留續跑 / 移除（`remove-bot.cmd`）；驗收欄位修正率達標才談進 V1。

## 2026-06-08 補 V0 驗收期巡檢工具（唯讀 HTML 日報）🟢
桌機開工。驗收前點出規劃缺口：要「連續 5 工作天」實機驗收,但後台網頁是 V1 範圍,這 5 天只能翻檔案夾 + 開 SQLite GUI,人工根本沒法每天核對「訊息有沒有正確保存分類」。解法**不提前做 V1 後台網頁**（破壞分版）,改補一個輕量唯讀巡檢工具（見 DECISIONS）：
- **新增 `server/scripts/report.ts`**：以 `readOnly` 開 `app.db`（絕不寫入、不搬檔）,撈指定日期（預設今天,依本機自然日篩 `received_at`）紀錄,產 `data/_reports/report-YYYYMMDD.html`。內容：頂部摘要（共幾筆/已歸檔/_inbox⚠️/待確認）+ `_inbox` 警示區置頂 + 已歸檔依工地分組 + 每筆編號/狀態 badge/判定方式中文化/回報人/時間/文字/縮圖（jpg 直顯、HEIC 佔位卡、缺檔標⚠️、📄文件/🖼照片）。
- **新增 `server/scripts/smoke-report.ts`**：餵暫存 DB（照片指向 repo 既有測試檔）驗 HTML 與摘要,**14/14 通過**;串入 `npm run test`（現 archive 16 / confirm 13 / site 16 / report 14,全綠）。
- **`npm run report`** 一行產當日日報;`report -- YYYY-MM-DD` 補產某日。
- **踩雷**：`report.ts` 漏帶 `photos` 欄位但 `typecheck` 沒抓到 → 發現 `tsconfig.json` 的 `include` 只含 `src/**/*`,**scripts 從來沒被型別檢查**。已補 `scripts/**/*`,順手修掉因此曝出的 `smoke-site.ts` 未用 import（`dirname`）。
- 瀏覽器實際預覽確認版面正確;jpg 縮圖顯示破圖是因 repo 內測試檔是 16-byte 假位元（非真 JPEG）,實機真照片會正常顯示。
- 紅線：`server/data/` 整夾被 `.gitignore:33` 擋（巡檢 HTML 含個資縮圖、`app.db`、暫存全不進 git）,已 `check-ignore` 確認。

### 下一步
- 開始「連續 5 工作天」驗收:每天收工 `npm run report` 開 HTML 掃三點（筆數對不對 / 有沒有掉 _inbox / 判定方式對不對）。
- 開跑前仍待決定:是否清掉舊測試資料（app.db + projects/_inbox/_staging,保留 seed）從乾淨狀態起算、`TELEGRAM_ALLOWED_CHAT_ID` 綁定單一群組。

## 2026-06-05 補 `npm run test` 串接三支離線 smoke test 🟢
`server/package.json` 加 `test` script，以 `&&` 串接既有三支離線 smoke（`tsx scripts/smoke-archive.ts && smoke-confirm.ts && smoke-site.ts`），任一支 `process.exit(1)` 即整體中斷回非零。`npm run test` 全綠：archive 16 / confirm 13 / site 16，0 失敗。解掉「smoke test 只能 `tsx` 直跑、會跳 proceed 詢問」的缺口，後續驗收/CI 一條指令到底。

## 2026-06-05 正式後端 V0 實機驗收通過（真 Telegram）🟢
桌機開工後接續做 V0 實機驗收。bot `@Cotton19testrobot` 真跑一輪，五層工地判斷 + 歸檔 + 按鈕逐項對 DB 與 `data/` 落地，全綠：

| 驗收項 | 結果 | 證據 |
|---|---|---|
| manual_code（裸碼 A001，本次修正點） | 🟢 | `A001-20260605-004` method=manual_code |
| photo_gps（document 上傳保留 EXIF） | 🟢 | `C001-002` GPS 24.08852,120.72577 距 0m、taken_at 寫入、has_exif=1 |
| telegram_location / 純位置不建檔 | 🟢 | 距 C001 14m、僅更新上下文 |
| recent_context | 🟢 | 沿用上下文歸 C001 |
| media group 合併 | 🟢 | 3 則合併 → 單筆 `C001-003`（照片數 3） |
| ✅ 確認 | 🟢 | 狀態 `待確認→待改善` + status_logs |
| ✏️ 改工地 / 工地選單 | 🟢 | `INBOX-003`→TEST、`manual_pick`、照片搬至 TEST 資料夾、_inbox 清空 |
| record_no 不重編 | 🟢 | 改工地後仍 `INBOX-20260605-003` |
| `_staging` 搬檔後清空 | 🟢 | 掃描為空 |

**唯一落差並修正**：第 1 層 manual_code 原只認 `#A001`，實機發現工人多半不打 `#`，「今天到 A001」被誤判 unresolved。已擴充為**裸碼也認、只比對已登錄工地清單**（`SiteResolver.matchManualCode`，離線 7/7 通過，含 `A0011` 不誤認、純中文正確留 unresolved）。詳見 DECISIONS。

附帶：新增 `server/scripts/preflight.ts`（開跑前用 token 打 getMe 健檢，不外洩 token）。

### 下一步
- 進入 V0「**連續 5 工作天實際使用、欄位修正率達標**」驗收期。
- 開始正式驗收前可清掉今日測試資料（app.db + data/projects/_inbox/_staging），保留 seed，從乾淨狀態起算。
- 補充次要觀察：`TELEGRAM_ALLOWED_CHAT_ID` 未設＝接收所有來源，正式上線建議綁定單一工作群組。

## 2026-06-05 正式後端 V0 收尾（5-2 搬檔歸檔 + 5-3 Bot 按鈕確認/改工地）
延續同日，完成 V0 後端最後三片（程式碼完成 + 離線驗收，🟡 實機驗收待跑）：
- **5-2 正式搬檔歸檔**：新增 `core/records/archiver.ts`（與 DB 解耦）。照片從 `_staging` 搬到 `projects/{code}_{name}/{YYYY}/{MM}/{DD}/records/{record_no}/`（判不出→`_inbox/{record_no}/`），寫 `metadata.json`/`text.txt`、清掉淨空暫存目錄；DB photos 改存正式路徑。檔名 `{record_no}-{NN}{ext}` 自帶識別；工地名稱淨化非法字元；搬檔 rename→copy 退路→保留暫存不丟檔。
- **5-3a Bot 回覆 + ✅ 確認**：通道層擴充 callback_query 管線（`onCallback`/`answerCallback`/`editMessageText`，`getUpdates` 加訂閱）。建檔後送整理結果 + ✅/✏️ inline keyboard；按 ✅ → `待確認→待改善` 就地更新訊息、重按防呆。新增 `core/confirm/confirmFlow.ts`、DB `getRecordById`/`updateStatus`。
- **5-3b 第 5 層按鈕詢問工地 + ✏️ 改工地**：unresolved 送工地選單；選定/改工地 → `archiver.reassignArchive` 把照片從 `_inbox`/舊工地搬到新工地、改寫 metadata、更新 DB（工地/狀態/照片路徑、`resolve_method=manual_pick`）。**record_no 不重編**（見 DECISIONS）。新增 `core/confirm/siteFlow.ts`、DB `getRecordFull`/`getPhotos`/`updatePhotoPath`/`setProject`、按鈕多列排版。

### 本期成效
| 項目 | 燈號 |
|---|---|
| 5-2 搬檔歸檔（_inbox/projects + metadata.json/text.txt） | 🟢 離線驗收 16/16 |
| 5-3a callback 管線 + Bot 回覆 + ✅ 確認 | 🟢 離線驗收 13/13 |
| 5-3b 按鈕詢問工地 + ✏️ 改工地（重歸檔） | 🟢 離線驗收 16/16 |
| `npm run typecheck` | 🟢 通過 |
| 實機驗收（真 Telegram 傳照片/按按鈕） | 🟡 待跑（V0 連續 5 工作天驗收起點） |
| 紅線（照片/個資/metadata/text/db 不進 git） | 🟢 `server/data/` 全擋並掃描確認 |

### 下一步
- **實機驗收 V0**：真 Telegram 跑一輪（傳照片→看 `data/projects` 長檔→按 ✅/✏️/選工地），開始「連續 5 工作天實際使用、欄位修正率達標」驗收。
- 等同學 prototype 回饋（欄位/Bot 格式/匯出檔名）。

## 2026-06-05 正式後端 V0 開工（收訊管線 → SQLite 落地）
在 `server/` 動工正式後端（Node + TS，嚴格分版、每片跑通才做下一片），完成並實機驗收 5 個里程碑：
1. **收訊管線 + adapter 介面**：Telegram long polling 收文字/照片/位置 → 正規化為平台無關的 `IncomingMessage`；`MessageChannelAdapter` 介面預留換 LINE。
2. **照片下載 + EXIF**：用 file_id 抓原檔落地，exifr 解析拍攝時間/GPS（document 保留 EXIF、photo 壓縮掉，符合預期）。
3. **相簿合併**：同一 media group debounce 約 2 秒合併為單筆多照片。
4. **工地判斷（前 4 層）**：manual_code / photo_gps / telegram_location / recent_context 全驗證，判不出標記 unresolved；含 `/addproject` 與工地清單來源。
5. **SQLite 落地（5-1）**：records / photos / status_logs 寫入，紀錄編號 `{代碼}-{YYYYMMDD}-{NNN}`（流水號按工地+日期遞增）、回報人與狀態歷程齊全。

踩雷與決策：`better-sqlite3` 在 Node 24 + Windows 易卡原生編譯 → 改用內建 `node:sqlite`（見 DECISIONS）；發現訊息併發處理會讓 recent_context 偶發失準 → 改為非相簿訊息序列化處理。照片暫存 `server/data/_staging/`，正式搬檔歸檔留待 5-2。

### 本期成效
| 項目 | 燈號 |
|---|---|
| 後端 V0 收訊管線（adapter 介面） | 🟢 通過實機驗收 |
| 照片下載 + EXIF（含 HEIC 能力） | 🟢 |
| 相簿（media group）合併 | 🟢 |
| 五層工地判斷（前 4 層 + unresolved） | 🟢 |
| SQLite 落地（records/photos/status_logs） | 🟢 |
| 5-2 正式搬檔歸檔 / 5-3 Bot 按鈕確認 | 🟡 未開始（下一步） |
| 同學 prototype 操作流程回饋 | 🟡 待回 |
| 紅線（照片/個資/.env/DB 不進 git） | 🟢 .gitignore 已擋並驗證 |

### 下一步
- 5-2 正式搬檔（`_inbox`/`projects` 結構 + metadata.json/text.txt）、5-3 Bot 回覆整理結果 + ✅/✏️ 人工確認（含第 5 層按鈕詢問工地）。

## 2026-06-05 接入戰情室管轄、docs 歸位
- 經 Claude cowork 完成需求溝通後，交接給 Claude Code（檔案交接：CLAUDE.md + HANDOFF.md + PRD_v2.md）。
- 在 `D:\projects\construction-photo-archive` 建 repo、`git init`、`.gitignore`（照片/影片/個資/機密全擋——照片絕不進 Git 的紅線）。
- 兩份規格從根目錄歸位到 docs/（`HANDOFF.md`、`PRD_v2.md`），補齊戰情室四件套（PROJECT_OVERVIEW / NEXT_ACTIONS / PROGRESS_LOG / DECISIONS）。
- 規格演進收斂重點：AI 從「主分類」降為「輔助結構化」、通道定 Telegram（adapter 預留 LINE）、工地判斷改五層優先序、V0 範圍刪減（不做 AI 影像/語音/LINE/PDF）、先做 Web Prototype 驗流程再寫後端。

## 2026-06-05（先前，cowork 階段）Web Prototype v0 完成
- Vite + React + TS 純前端 mock，7 個頁面，操作流程可走完。
- tsc + vite build 通過，本機 `npm run dev` 可跑；分享 GitHub Pages 給建設公司特助試。
- 待回饋：欄位完整度（樓層/工種）、Bot 回覆格式、匯出檔名格式。

### 下一步
- 等同學確認 prototype → 動工正式後端 V0（Node+TS+SQLite+Telegram long polling），把「收訊 → 五層工地判斷 → 檔案歸檔 → SQLite → Bot 按鈕確認」管線做穩。
