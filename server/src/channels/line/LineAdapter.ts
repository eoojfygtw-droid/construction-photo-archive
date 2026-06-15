// ============================================================
// LineAdapter.ts — LINE 通道實作（webhook 收訊）
// L0：起 HTTP server 收 webhook → 驗 X-Line-Signature → 先回 200 → 解析 events →
//     正規化成 IncomingMessage 交給 handler，並把每個 event 印到 log（看得到 groupId 即代表接通）。
// 送出側（下載檔案／回覆／按鈕）標記 L2/L3 再實作；L0 只用收訊。
// 與 Telegram 差異備忘：webhook（非 polling）、不能編輯訊息、無相簿群組 id、reply token 免費。
// ============================================================
import {
  createServer,
  type Server,
  type IncomingMessage as HttpReq,
  type ServerResponse,
} from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AppConfig } from '../../config/env';
import { logger } from '../../utils/logger';
import type {
  DownloadedFile,
  MessageChannelAdapter,
} from '../MessageChannelAdapter';
import type {
  ChannelName,
  IncomingCallbackHandler,
  IncomingMessage,
  IncomingMessageHandler,
  IncomingPhoto,
} from '../types';

// ---- LINE webhook 原始型別（只列我們會用到的欄位）----
interface LineSource {
  type: 'user' | 'group' | 'room';
  userId?: string;
  groupId?: string;
  roomId?: string;
}
interface LineMessage {
  id: string;
  type: string; // text / image / video / audio / file / location / sticker
  text?: string;
  fileName?: string;
  duration?: number; // audio 毫秒
  latitude?: number;
  longitude?: number;
}
interface LineEvent {
  type: string; // message / follow / join / postback ...
  timestamp?: number; // 毫秒
  source?: LineSource;
  replyToken?: string;
  message?: LineMessage;
  postback?: { data?: string };
}

export class LineAdapter implements MessageChannelAdapter {
  readonly channel: ChannelName = 'line';

  private readonly secret: string;
  private readonly token: string;
  private readonly port: number;
  private readonly path: string;

  private handler: IncomingMessageHandler | null = null;
  private callbackHandler: IncomingCallbackHandler | null = null;
  private server: Server | null = null;

  constructor(config: AppConfig) {
    this.secret = config.lineChannelSecret;
    this.token = config.lineChannelAccessToken;
    this.port = config.lineWebhookPort;
    this.path = config.lineWebhookPath;
  }

  onMessage(handler: IncomingMessageHandler): void {
    this.handler = handler;
  }

  onCallback(handler: IncomingCallbackHandler): void {
    this.callbackHandler = handler;
  }

  async start(): Promise<void> {
    if (!this.secret || !this.token) {
      throw new Error('LINE 未設定（缺 LINE_CHANNEL_SECRET / LINE_CHANNEL_ACCESS_TOKEN）');
    }
    this.server = createServer((req, res) =>
      this.handleHttp(req, res).catch((err) => {
        logger.error('LINE webhook 處理失敗', err instanceof Error ? err.message : err);
        if (!res.headersSent) {
          res.writeHead(500);
          res.end();
        }
      }),
    );
    // 只綁 127.0.0.1：公開入口（tunnel/反代）在本機把流量轉進來，不直接對外曝露
    await new Promise<void>((resolve) => this.server!.listen(this.port, '127.0.0.1', resolve));
    logger.info(
      `LINE webhook 收訊中：http://127.0.0.1:${this.port}${this.path}（等公開入口把 LINE 的請求轉進來）`,
    );
    // start() 不阻塞；HTTP server 會自行維持事件迴圈存活直到 stop()
  }

  async stop(): Promise<void> {
    if (this.server) {
      const s = this.server;
      this.server = null;
      await new Promise<void>((resolve) => s.close(() => resolve()));
    }
  }

  /** 處理一個 webhook HTTP 請求：驗簽 → 先回 200 → 非同步處理 events */
  private async handleHttp(req: HttpReq, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method !== 'POST' || url.pathname !== this.path) {
      res.writeHead(404);
      res.end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks);

    const sig = (req.headers['x-line-signature'] as string | undefined) ?? '';
    if (!this.verifySignature(body, sig)) {
      logger.warn('LINE webhook 簽章驗證失敗，拒絕（可能不是 LINE 來源或 secret 不符）');
      res.writeHead(401);
      res.end();
      return;
    }

    // LINE 要求數秒內回 200，否則會重送 → 先回應，再慢慢處理
    res.writeHead(200);
    res.end();

    let payload: { events?: LineEvent[] };
    try {
      payload = JSON.parse(body.toString('utf8')) as { events?: LineEvent[] };
    } catch {
      logger.warn('LINE webhook body 非合法 JSON，略過');
      return;
    }
    for (const ev of payload.events ?? []) {
      try {
        await this.handleEvent(ev);
      } catch (err) {
        logger.error('LINE event 處理失敗', err instanceof Error ? err.message : err);
      }
    }
  }

  /** 驗證 X-Line-Signature＝base64(HMAC-SHA256(channelSecret, body))，timing-safe 比對 */
  private verifySignature(body: Buffer, signature: string): boolean {
    if (!signature) return false;
    const expected = createHmac('sha256', this.secret).update(body).digest('base64');
    try {
      return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    } catch {
      return false; // 長度不同會丟例外，視為不符
    }
  }

  /** 單一 event：先 log（L0 看接通＋groupId），message 事件再正規化交 handler */
  private async handleEvent(ev: LineEvent): Promise<void> {
    const src = ev.source;
    const chatId = src?.groupId ?? src?.roomId ?? src?.userId ?? '';
    logger.info('LINE event', {
      type: ev.type,
      來源: src?.type ?? '?',
      chatId,
      userId: src?.userId ?? '（無）',
      訊息型別: ev.message?.type ?? '（非訊息）',
      文字: ev.message?.text ?? '',
    });

    // 按鈕回呼（postback）：L3 才正規化成 IncomingCallback 接歸檔流程；L0 先記錄
    if (ev.type === 'postback') {
      if (this.callbackHandler) {
        logger.info('LINE postback 收到（L3 再接按鈕回呼）', { data: ev.postback?.data ?? '' });
      }
      return;
    }

    if (ev.type !== 'message' || !ev.message || !this.handler) return;
    const m = ev.message;

    const photos: IncomingPhoto[] = [];
    if (m.type === 'image') {
      photos.push({ fileId: m.id, uploadType: 'photo' });
    } else if (m.type === 'file') {
      photos.push({ fileId: m.id, uploadType: 'document', fileName: m.fileName });
    } else if (m.type === 'audio') {
      photos.push({
        fileId: m.id,
        uploadType: 'audio',
        durationSec: m.duration != null ? Math.round(m.duration / 1000) : undefined,
      });
    }
    // video / sticker 等 L0 先不處理（仍會在上面 log）

    const msg: IncomingMessage = {
      channel: this.channel,
      chatId,
      messageId: m.id,
      // 相簿群組：LINE 無 album id；L2 會改用「同人短時間去抖」合併，這裡先不給
      reporterId: src?.userId ?? 'unknown',
      // L2 會改呼叫 getGroupMemberProfile 取真實顯示名稱；L0 先用 userId 前段佔位
      reporterName: src?.userId ? `LINE:${src.userId.slice(0, 8)}` : 'LINE使用者',
      text: m.type === 'text' ? m.text : undefined,
      caption: undefined,
      photos,
      location:
        m.type === 'location' && m.latitude != null && m.longitude != null
          ? { latitude: m.latitude, longitude: m.longitude }
          : undefined,
      date: ev.timestamp != null ? Math.floor(ev.timestamp / 1000) : Math.floor(Date.now() / 1000),
    };
    await this.handler(msg);
  }

  // ── 送出側：L2/L3 再實作；L0 只跑收訊（probe 不會呼叫到這些）──────────────
  async downloadFile(_fileId: string): Promise<DownloadedFile> {
    throw new Error('LineAdapter.downloadFile 尚未實作（L2 接媒體下載）');
  }
  async sendMessage(_chatId: string, _text: string): Promise<void> {
    throw new Error('LineAdapter.sendMessage 尚未實作（L3 接 reply/push）');
  }
  async sendMessageWithButtons(): Promise<void> {
    throw new Error('LineAdapter.sendMessageWithButtons 尚未實作（L3 接 Flex/quick reply）');
  }
  async answerCallback(): Promise<void> {
    // LINE postback 無「載入中」轉圈，無對應動作
  }
  async editMessageText(): Promise<void> {
    throw new Error('LineAdapter.editMessageText 尚未實作（L3；LINE 不能編輯訊息，改送新訊息）');
  }
}
