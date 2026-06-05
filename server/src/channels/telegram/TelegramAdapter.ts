// ============================================================
// TelegramAdapter.ts — Telegram 通道實作（long polling，免公開網址）
// 職責：輪詢 getUpdates → 把原始 update 轉成正規化 IncomingMessage → 丟給 handler。
// V0 第 1 步只到「轉換 + 交給 handler」；下載原檔、媒體群組合併在後續步驟。
// ============================================================
import type { AppConfig } from '../../config/env';
import { logger } from '../../utils/logger';
import type {
  DownloadedFile,
  MessageChannelAdapter,
  OutgoingButton,
} from '../MessageChannelAdapter';
import type {
  ChannelName,
  IncomingMessage,
  IncomingMessageHandler,
  IncomingPhoto,
} from '../types';

// ---- Telegram API 原始型別（只列我們會用到的欄位）----
interface TgUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}
interface TgPhotoSize {
  file_id: string;
  width: number;
  height: number;
  file_size?: number;
}
interface TgDocument {
  file_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}
interface TgLocation {
  latitude: number;
  longitude: number;
}
interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: { id: number };
  date: number;
  text?: string;
  caption?: string;
  photo?: TgPhotoSize[];
  document?: TgDocument;
  location?: TgLocation;
  media_group_id?: string;
}
interface TgUpdate {
  update_id: number;
  message?: TgMessage;
}
interface TgResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

export class TelegramAdapter implements MessageChannelAdapter {
  readonly channel: ChannelName = 'telegram';

  private readonly apiBase: string;
  private readonly fileApiBase: string; // 下載原檔用的網址前綴
  private readonly pollTimeout: number;
  private readonly allowedChatId: string;

  private handler: IncomingMessageHandler | null = null;
  private offset = 0; // getUpdates 的 update_id 游標
  private running = false;

  constructor(config: AppConfig) {
    this.apiBase = `https://api.telegram.org/bot${config.telegramBotToken}`;
    this.fileApiBase = `https://api.telegram.org/file/bot${config.telegramBotToken}`;
    this.pollTimeout = config.telegramPollTimeout;
    this.allowedChatId = config.telegramAllowedChatId;
  }

  onMessage(handler: IncomingMessageHandler): void {
    this.handler = handler;
  }

  async start(): Promise<void> {
    // 先確認 token 有效，順便取得 bot 身分（getMe），失敗即 fail loudly
    const me = await this.callApi<TgUser>('getMe');
    logger.info(
      `Telegram 連線成功，bot＝@${me.username ?? me.first_name ?? me.id}`,
    );
    if (this.allowedChatId) {
      logger.info(`僅接收來源 chat id＝${this.allowedChatId}`);
    } else {
      logger.warn('未設定 TELEGRAM_ALLOWED_CHAT_ID，目前接收所有來源訊息');
    }

    this.running = true;
    logger.info('開始 long polling…（Ctrl+C 結束）');
    await this.pollLoop();
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  /** 持續輪詢 getUpdates 的主迴圈 */
  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        const updates = await this.callApi<TgUpdate[]>('getUpdates', {
          offset: this.offset,
          timeout: this.pollTimeout,
          allowed_updates: ['message'],
        });

        for (const update of updates) {
          this.offset = update.update_id + 1; // 游標前進，確認過的不再重收
          if (update.message) {
            await this.handleRawMessage(update.message);
          }
        }
      } catch (err) {
        // 網路波動等暫時性錯誤：記錄後短暫等待再重試，不讓程式整個掛掉
        logger.error('getUpdates 失敗，3 秒後重試', errMessage(err));
        await sleep(3000);
      }
    }
  }

  /** 把單則 Telegram 訊息正規化並交給 handler */
  private async handleRawMessage(m: TgMessage): Promise<void> {
    const chatId = String(m.chat.id);

    // 來源過濾：有設定 allowedChatId 時，非該群組的訊息直接略過
    if (this.allowedChatId && chatId !== this.allowedChatId) {
      logger.warn('略過非允許來源的訊息', { chatId });
      return;
    }

    const photos: IncomingPhoto[] = [];
    // Telegram 的 photo 是「同一張照片的多種解析度」陣列，取最大的那個
    if (m.photo && m.photo.length > 0) {
      const largest = m.photo.reduce((a, b) =>
        (b.file_size ?? b.width * b.height) > (a.file_size ?? a.width * a.height)
          ? b
          : a,
      );
      photos.push({
        fileId: largest.file_id,
        uploadType: 'photo',
        width: largest.width,
        height: largest.height,
        fileSize: largest.file_size,
      });
    }
    // document＝原檔上傳（保留 EXIF），常見於重要照片
    if (m.document) {
      photos.push({
        fileId: m.document.file_id,
        uploadType: 'document',
        fileName: m.document.file_name,
        fileSize: m.document.file_size,
        mimeType: m.document.mime_type,
      });
    }

    const msg: IncomingMessage = {
      channel: this.channel,
      chatId,
      messageId: String(m.message_id),
      mediaGroupId: m.media_group_id,
      reporterId: m.from ? String(m.from.id) : 'unknown',
      reporterName: formatReporterName(m.from),
      text: m.text,
      caption: m.caption,
      photos,
      location: m.location
        ? { latitude: m.location.latitude, longitude: m.location.longitude }
        : undefined,
      date: m.date,
    };

    if (this.handler) {
      await this.handler(msg);
    }
  }

  async downloadFile(fileId: string): Promise<DownloadedFile> {
    // 1) getFile 取得平台端檔案路徑（Telegram 的下載連結有時效，臨用臨取）
    const file = await this.callApi<{
      file_path?: string;
      file_size?: number;
    }>('getFile', { file_id: fileId });
    if (!file.file_path) {
      throw new Error(`getFile 未回傳 file_path（file_id=${fileId}）`);
    }

    // 2) 下載原檔位元組
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60_000); // 下載上限 60 秒
    try {
      const res = await fetch(`${this.fileApiBase}/${file.file_path}`, {
        signal: ctrl.signal,
      });
      if (!res.ok) {
        throw new Error(`下載檔案失敗：HTTP ${res.status}`);
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      return { buffer, remotePath: file.file_path, fileSize: file.file_size };
    } finally {
      clearTimeout(timer);
    }
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    await this.callApi('sendMessage', { chat_id: chatId, text });
  }

  async sendMessageWithButtons(
    chatId: string,
    text: string,
    buttons: OutgoingButton[],
  ): Promise<void> {
    // 單列排版：每個按鈕一格，對應 Telegram inline keyboard
    const inline_keyboard = [
      buttons.map((b) => ({ text: b.text, callback_data: b.callbackData })),
    ];
    await this.callApi('sendMessage', {
      chat_id: chatId,
      text,
      reply_markup: { inline_keyboard },
    });
  }

  /** 呼叫 Telegram Bot API，回傳 result；ok=false 時丟出錯誤 */
  private async callApi<T = unknown>(
    method: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    // long polling 的 getUpdates 等待時間較長，超時上限放寬到 timeout + 10 秒
    const ctrl = new AbortController();
    const timer = setTimeout(
      () => ctrl.abort(),
      (this.pollTimeout + 10) * 1000,
    );
    try {
      const res = await fetch(`${this.apiBase}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      const data = (await res.json()) as TgResponse<T>;
      if (!data.ok || data.result === undefined) {
        throw new Error(
          `Telegram API ${method} 失敗：${data.description ?? `HTTP ${res.status}`}`,
        );
      }
      return data.result;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** 組出回報人顯示名稱：姓名優先，退而求其次用 username / id */
function formatReporterName(user?: TgUser): string {
  if (!user) return '未知';
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ');
  if (name) return name;
  if (user.username) return `@${user.username}`;
  return String(user.id);
}

/** 取錯誤訊息字串 */
function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 等待指定毫秒 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
