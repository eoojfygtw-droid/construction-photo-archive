# 計畫：LINE 通道串接（雙通道並存）

> 決策前置文件。使用者已定：①雙通道並存（Telegram + LINE，未來還要第三通道 app）②webhook 入口要先評估 ③一次做到與 Telegram 對等。
> 依「分版開發」推進，每個 Phase 先跑通再做下一個。動工前需使用者拍板「入口方案」與提供「LINE 憑證」。

---

## 0. 結論先講（TL;DR）

- **架構撐得住**：`core/` 不依賴 Telegram，只認 `MessageChannelAdapter` 介面。加 LINE＝新寫一個 `LineAdapter` + 把 bootstrap 改成多通道。但有 **4 個硬差異** 要工程處理（webhook、不能編輯訊息、無相簿群組 id、EXIF 待驗）。
- **webhook 入口建議**：驗證期先用 **ngrok / Cloudflare quick tunnel**（臨時、免費、網址會變沒差）把流程跑通；正式落腳**首選 NAS（DS1517+）自架反向代理**——資料留本機合紅線，又一次解掉懸很久的「24 小時主機」題。次選 Cloudflare Tunnel + 便宜網域（bot 留桌機）。**雲端 VM 不建議**（照片會離開本機，踩「真檔案存本機/NAS」紅線）。
- **省錢關鍵**：LINE **回覆（reply token）免費不計額度，只有 push 計數**。LineAdapter 設計成「能回覆就回覆」，免費 plan 夠用。

---

## 1. webhook 入口評估（使用者指定先評估）

### 背景限制
- 現況：bot 是**桌機 Windows 排程背景常駐**，Telegram 用 long polling 主動拉、**不需對外曝露**。
- LINE Messaging API **只能 webhook**：LINE 伺服器主動 POST 到你的 **公開 HTTPS 網址**（需有效 TLS）。所以一定要有對外入口。
- 紅線：照片與個資**只放本機/NAS**，不進雲端、不進 Git。

### 四方案比較

| 方案 | 穩定網址 | 資料落地 | 成本 | 維護負擔 | 24h 運行 | 紅線 |
|---|---|---|---|---|---|---|
| **NAS DS1517+ 自架**（反向代理 + Let's Encrypt + DDNS） | ✅ 固定（DDNS 網域） | ✅ 留 NAS | 免費（已有 NAS） | 中（設反代/憑證/DDNS 一次） | ✅ NAS 本就 24h | ✅ **最佳，同時解 24h 主機題** |
| **Cloudflare Tunnel（桌機）** | ✅ 需自有網域（~NT$300/yr）；quick tunnel 免費但網址會變 | ✅ 留桌機 | 近免費 | 低（裝 cloudflared service） | ⚠️ 桌機要開著 | ✅ 資料不出本機 |
| **ngrok** | ⚠️ 免費版網址會變，付費才固定 | ✅ 留桌機 | 免費～付費 | 低 | ⚠️ 桌機要開著 | ✅ 但僅適合測試 |
| **雲端 VM/主機** | ✅ 公開 IP/網域 | ⚠️ 照片進雲端 | ~NT$150–300/月 | 中高（部署+搬遷+運維） | ✅ | ⚠️ **踩紅線，需另議** |

### 建議路線（分兩段）
1. **驗證期（馬上能動）**：ngrok 或 Cloudflare quick tunnel，臨時網址把 LINE→機器這條路跑通，先別管網址會變。
2. **正式落腳**：
   - **首選 NAS 自架**：Synology 內建反向代理 + Let's Encrypt 憑證 + DDNS（或 QuickConnect 之外的自有網域）即可收 webhook，bot 跑在 NAS（Container/Node）或桌機由 NAS 反代轉進來。資料完全留本機，且 NAS 本來就 24h → 一石二鳥。
   - **次選 Cloudflare Tunnel + 便宜網域**：bot 維持留桌機不搬，cloudflared 當 Windows service 把固定網域導進 localhost。改動最小，但桌機得一直開著。
   - **不選雲端 VM**：除非你接受照片離開本機（預設違反紅線）。

---

## 2. 架構改動：單通道 → 多通道

目前是隱性單通道，雙通道並存要動這些（**不改 Telegram 行為**為前提）：

1. **設定分通道**（`config/env.ts`）：拆出 per-channel 設定區塊。新增 LINE：`LINE_CHANNEL_ACCESS_TOKEN`、`LINE_CHANNEL_SECRET`、`LINE_ALLOWED_GROUP_ID`、`LINE_WEBHOOK_PORT/PATH`。Telegram 設定原樣保留。
2. **bootstrap 改多 adapter**（`index.ts`）：把 `const adapter = new TelegramAdapter(...)` 改成 `adapters: MessageChannelAdapter[]`，對每個 adapter 註冊**同一組** `onMessage`(→aggregator.push) 與 `onCallback`，再**並行** `start()` 全部（Telegram 的 `start()` 會阻塞於 poll loop、LINE 的 `start()` 起 HTTP server，需用 `Promise.all` 一起跑、shutdown 一起停）。
3. **狀態 key 加通道前綴**：`UserContextStore`、`LastRecordStore`、`AppendStore`、`PendingInboxStore`、`PendingSiteStore`、`PendingLocationStore` 目前多以 `reporterId` 為 key。雙通道下兩平台 id 命名空間不同，改用 `${channel}:${reporterId}`（與 `${channel}:${chatId}`）避免極端情況撞 key。
4. **「可歸檔來源」判斷分通道**：`index.ts` 現在硬比 `config.telegramAllowedChatId`。改為由各 adapter 自行過濾來源群（adapter 已有 allowedChatId 機制），核心不再寫死 Telegram 設定。
5. **回呼分流相容**：callback `data` 編碼（`c:`/`s:`/`e:`/`sb:`/`sp:`/`loc:`）兩通道共用，不用改。
6. **回歸保護**：Telegram 全套 smoke 維持綠燈、實機不退化，才算這階段過關。

---

## 3. LineAdapter：4 個硬差異怎麼解 + 介面逐項對應

### 4 個硬差異
| 差異 | Telegram | LINE | 解法 |
|---|---|---|---|
| 收訊機制 | long polling（免公開網址） | **只能 webhook** | `start()` 改成起 HTTP server 收 POST；**先回 200 再非同步處理**（LINE 要求數秒內回應否則重送） |
| 編輯訊息 | `editMessageText` 收按鈕 | **不能編輯已送訊息** | 降級為「送一則新訊息」；按鈕重複按由既有 DB 狀態檢查擋（已有防呆） |
| 相簿合併 | `media_group_id` | **無，逐張獨立事件** | `MediaGroupAggregator` 加「無 group id 時，依 `${channel}:${chatId}:${reporterId}` 時間窗去抖」的後備合併 |
| EXIF/GPS | document 上傳保留 | **待驗**（image vs file 訊息） | Phase L2 實測；若 image 被壓，photo_gps 層在 LINE 端改靠「傳 file / 傳定位」替代，並在回覆文案引導 |

### 介面逐項對應（`MessageChannelAdapter`）
- `channel` → `'line'`
- `start()` → 驗 token（取 bot 資訊）→ 起 HTTP server、路由 `POST {LINE_WEBHOOK_PATH}` → **驗 X-Line-Signature（HMAC-SHA256 + channel secret）** → 解析 events → 正規化 → 交 handler。先回 200。
- `stop()` → 關 HTTP server。
- `downloadFile(messageId)` → `GET https://api-data.line.me/v2/bot/message/{id}/content`（Bearer token）→ buffer；副檔名由 Content-Type 推斷（image 無檔名；file 訊息帶 fileName）。
- `sendMessage(chatId,text)` → **有該對話新鮮的 reply token（~30 秒、一次性）就用 reply（免費）**，否則 push（計額度）。adapter 內維護 `chatId→最近 replyToken` 短期映射。
- `sendMessageWithButtons(...)` → 用 Flex / buttons template / quick reply 的 **postback action**，data 沿用既有 callbackData 編碼。**長清單（工地選單可能很多）**用 Flex 或 quick reply（上限多）或 carousel 分頁。
- `answerCallback(callbackId,text?)` → LINE 無轉圈，**no-op**（必要時用 reply 補一句）。
- `editMessageText(...)` → 降級為送新訊息（見上）。
- 取 `reporterName`：LINE 群組需另呼叫 `getGroupMemberProfile`（多一次 API），或先存 userId 之後補名。

---

## 4. 分版計畫（每版先跑通再下一步）

- **L0 — 入口 + 連通驗證**：建 LINE Official Account + 啟用 Messaging API、拿 token/secret、關掉 LINE OA 後台的「自動回覆/歡迎訊息」避免吃掉 webhook；臨時入口（ngrok/quick tunnel）；最小 webhook 收 POST + 驗簽 + 回 200 + log event。確認 LINE→機器路通。
- **L1 — 多通道架構重構**：第 2 節全部；Telegram smoke 全綠 + 實機不退化才過關。
- **L2 — LINE 收訊正規化**：text/image/file/audio/location → `IncomingMessage`；同人連拍去抖合併；**EXIF 實測**。跑通「LINE 傳照片→判工地→歸檔→log」。
- **L3 — LINE 回覆 + 確認流程**：reply 優先/push 後備；✅/✏️ 走 postback；editMessage 改送新訊息；工地選單（長清單 Flex/quick reply）。跑通 ✅ 確認、✏️ 改工地。
- **L4 — 對等補完**：批次歸檔選單、追加合併、純定位流程、錄音、`/新增工地` 等指令在 LINE 全通；每塊配 smoke。
- **L5 — 正式落腳 + 上線**：入口換正式（NAS 反代 / Cloudflare Tunnel+網域）、背景常駐、存活監控納入 LINE、更新 HANDOFF/DECISIONS/NEXT_ACTIONS。

---

## 5. 需要使用者提供 / 決定

1. **入口拍板**：驗證期用 ngrok 還是 Cloudflare quick tunnel？正式落腳走 NAS 還是 Cloudflare Tunnel+網域？（雲端 VM 預設不建議）
2. **LINE 憑證**：到 developers.line.biz 建 Provider + Messaging API channel（綁一個 LINE Official Account），給我 **Channel access token（long-lived）** 與 **Channel secret**。放 `server/.env`（已被 gitignore，不進 Git）。要的話我列申請步驟。
3. **測試群**：建一個 LINE 群把 bot 拉進去，取 group id（L0 用 log 印出來）。
4. **LINE OA 後台設定**：關掉「自動回應訊息」「加入好友的歡迎訊息」「聊天」功能、開啟 webhook，否則收不到事件。

## 6. 待驗證 / 風險

- **EXIF 是否保住**（影響 photo_gps 自動歸檔）— L2 實測；壓掉就靠 file/定位替代。
- **免費額度**：reply 免費、push 計數；1–3 人內部用＋盡量走 reply token，免費 Light（約 200 push/月）應夠；push 量大再升 plan。
- **群組能否給定位 / member profile**（取名字要多一次 API）— L0/L2 驗。
- **webhook 5 秒內回 200**：handler 流程要「先回 200、後非同步處理」，與目前 Telegram 同步處理不同，避免重送。
- 雙通道狀態 key 前綴若遺漏，可能跨通道誤併上下文 — L1 要全面掃過。
