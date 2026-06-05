# PROGRESS_LOG — 工地照片歸檔系統

> 時間軸。重大進展、踩雷、里程碑往這裡補。詳細規格演進另見 docs/HANDOFF.md「二、規格演進歷程」。

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
