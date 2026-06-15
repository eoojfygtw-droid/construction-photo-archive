// ============================================================
// env.ts — 讀取並驗證環境變數
// 缺必填（TELEGRAM_BOT_TOKEN）時 fail loudly：清楚報錯後讓程式停止，不帶半殘狀態啟動。
// ============================================================
import 'dotenv/config'; // 自動載入 server/.env

/** 後端執行所需的設定，已驗證過必填欄位 */
export interface AppConfig {
  telegramBotToken: string;
  /** 允許接收的群組 chat id；空字串＝不限制來源 */
  telegramAllowedChatId: string;
  /** long polling 等待秒數 */
  telegramPollTimeout: number;
  /** 狀態/警報通知要發到的 chat id；空字串＝不發狀態通知 */
  telegramAdminChatId: string;
  /** healthchecks.io 心跳 ping 網址；空字串＝不發心跳 */
  healthcheckUrl: string;
  /** 心跳間隔（秒），預設 60，最小 10 */
  healthcheckIntervalSec: number;

  // ── LINE 通道（L1 起預留；LineAdapter 於 L2 接上）──────────────────────
  /** LINE channel secret（驗 webhook 簽章）；空字串＝未設定，不啟用 LINE */
  lineChannelSecret: string;
  /** LINE channel access token（呼叫 Messaging API）；空字串＝未設定 */
  lineChannelAccessToken: string;
  /** 允許歸檔的 LINE 群組 id；空字串＝尚未綁定（L0 接通後從 log 取得再填） */
  lineAllowedGroupId: string;
  /** LINE webhook 監聽埠（本機，由公開入口/通道轉進來） */
  lineWebhookPort: number;
  /** LINE webhook 路徑 */
  lineWebhookPath: string;
}

/** LINE 是否已設妥憑證（決定 L2 起要不要掛上 LineAdapter） */
export function isLineConfigured(config: AppConfig): boolean {
  return !!config.lineChannelSecret && !!config.lineChannelAccessToken;
}

/**
 * 讀取設定並驗證。
 * 缺 TELEGRAM_BOT_TOKEN 時丟出明確錯誤訊息，引導使用者去設定。
 */
export function loadConfig(): AppConfig {
  const token = (process.env.TELEGRAM_BOT_TOKEN ?? '').trim();
  if (!token) {
    throw new Error(
      '缺少 TELEGRAM_BOT_TOKEN。請複製 server/.env.example 為 server/.env，' +
        '向 @BotFather 申請 Bot token 後填入。',
    );
  }

  // poll timeout：非法值退回預設 30 秒
  const rawTimeout = Number(process.env.TELEGRAM_POLL_TIMEOUT);
  const pollTimeout =
    Number.isFinite(rawTimeout) && rawTimeout > 0 ? Math.floor(rawTimeout) : 30;

  // 心跳間隔：非法或過小（<10 秒）退回預設 60 秒，避免過度頻繁
  const rawHb = Number(process.env.HEALTHCHECK_INTERVAL_SEC);
  const healthcheckIntervalSec =
    Number.isFinite(rawHb) && rawHb >= 10 ? Math.floor(rawHb) : 60;

  // LINE webhook 埠：非法值退回預設 3010
  const rawLinePort = Number(process.env.LINE_WEBHOOK_PORT);
  const lineWebhookPort =
    Number.isFinite(rawLinePort) && rawLinePort > 0 ? Math.floor(rawLinePort) : 3010;

  return {
    telegramBotToken: token,
    telegramAllowedChatId: (process.env.TELEGRAM_ALLOWED_CHAT_ID ?? '').trim(),
    telegramPollTimeout: pollTimeout,
    telegramAdminChatId: (process.env.TELEGRAM_ADMIN_CHAT_ID ?? '').trim(),
    healthcheckUrl: (process.env.HEALTHCHECK_URL ?? '').trim(),
    healthcheckIntervalSec,
    lineChannelSecret: (process.env.LINE_CHANNEL_SECRET ?? '').trim(),
    lineChannelAccessToken: (process.env.LINE_CHANNEL_ACCESS_TOKEN ?? '').trim(),
    lineAllowedGroupId: (process.env.LINE_ALLOWED_GROUP_ID ?? '').trim(),
    lineWebhookPort,
    lineWebhookPath: (process.env.LINE_WEBHOOK_PATH ?? '/line/webhook').trim() || '/line/webhook',
  };
}
