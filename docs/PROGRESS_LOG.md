# PROGRESS_LOG — 工地照片歸檔系統

> 時間軸。重大進展、踩雷、里程碑往這裡補。詳細規格演進另見 docs/HANDOFF.md「二、規格演進歷程」。

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
