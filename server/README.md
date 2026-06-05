# 工地照片歸檔系統 — 後端（server）

正式後端 V0。Node.js + TypeScript，Telegram Bot 採 **long polling**（免公開網址）。
分版開發，每個功能點先跑通再做下一個（見 `../docs/NEXT_ACTIONS.md`）。

## 目前進度：V0 程式碼完成（8 片，離線驗收全綠，🟡 實機驗收待跑）
- ✅ 收訊管線 + `MessageChannelAdapter` 介面（平台無關，未來可換 LINE）
- ✅ 照片下載 + EXIF（exifr；document 保留、photo 壓縮掉，含 HEIC 能力）
- ✅ 相簿合併（media group debounce ~2 秒）
- ✅ 工地判斷前 4 層 + `/addproject`（判不出→ `_inbox` 暫存）
- ✅ SQLite 落地（records/photos/status_logs；`node:sqlite`）
- ✅ 搬檔歸檔（`_staging`→`projects`/`_inbox`、`metadata.json`/`text.txt`）
- ✅ Bot 回覆整理結果 + ✅/✏️ 確認（callback_query 管線、`待確認→待改善`）
- ✅ 第 5 層按鈕詢問工地 + ✏️ 改工地（重歸檔，record_no 不重編）

> 離線驗收：`npx tsx scripts/smoke-archive.ts`、`smoke-confirm.ts`、`smoke-site.ts`（皆全綠）。
> 下一步：真 Telegram 實機驗收 → 連續 5 工作天實際使用。

## 目錄結構
```
server/
├─ src/
│  ├─ index.ts                       進入點
│  ├─ config/env.ts                  讀取 / 驗證環境變數
│  ├─ channels/                      訊息通道層（平台無關）
│  │  ├─ types.ts                    IncomingMessage 等正規化型別
│  │  ├─ MessageChannelAdapter.ts    通道介面
│  │  └─ telegram/TelegramAdapter.ts long polling 實作
│  └─ utils/logger.ts
└─ data/                             執行期資料（git 不追蹤；照片/個資紅線）
```

## 設定與執行
1. 安裝相依：`npm install`
2. 申請 Bot token：在 Telegram 找 **@BotFather** → `/newbot` → 取得 token
3. 設定環境：複製 `.env.example` 為 `.env`，填入 `TELEGRAM_BOT_TOKEN`
   - （`.env` 已被 `.gitignore` 擋，真 token 不會進 git）
4. 把 bot 加進你的工作群組
   - 若 bot 預設只收到 `/指令`，向 @BotFather 對該 bot 執行 `/setprivacy` → **Disable**，才收得到一般訊息
5. 啟動：
   - 開發（自動重載）：`npm run dev`
   - 一般執行：`npm start`
   - 型別檢查：`npm run typecheck`

### 第 1 步驗收
啟動後，在群組傳「一段文字」「一張照片附 caption」「一個位置」，
終端機應印出對應的正規化 `IncomingMessage`（含回報人、caption、照片 file_id、media_group_id）。
此步驟不會存任何檔案或資料庫。
