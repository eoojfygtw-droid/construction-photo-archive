// ============================================================
// LineAdapter.ts — LINE 通道實作（webhook 收訊）
// L0：起 HTTP server 收 webhook → 驗 X-Line-Signature → 先回 200 → 解析 events →
//     正規化成 IncomingMessage 交給 handler，並把每個 event 印到 log（看得到 groupId 即代表接通）。
// L2：① downloadFile 接 /v2/bot/message/{id}/content 媒體下載；② image/file 給合成
//     mediaGroupId 讓既有 debounce 做「同人去抖合併」；③ resolveReporterName 取真實顯示名稱。
// L3：送出側全到位——push 回覆文字、quick reply 取代 inline 按鈕、postback 正規化成
//     IncomingCallback、editMessageText 改送新訊息（LINE 不能編輯）。至此互動與 Telegram 等價。
// 與 Telegram 差異備忘：webhook（非 polling）、不能編輯訊息（改送新訊息）、無相簿群組 id（合成）、
//     按鈕用 quick reply（上限 13 顆／label 20 字）、回覆一律 push。
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
  OutgoingButton,
} from '../MessageChannelAdapter';
import type {
  ChannelName,
  IncomingCallback,
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
  /** userId → displayName 快取（同人多則訊息只打一次 profile API） */
  private readonly nameCache = new Map<string, string>();

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

    // 按鈕回呼（postback）：L3 正規化成 IncomingCallback 交 callbackHandler（與 Telegram 同流程）。
    // LINE 無 callback ack、不能編輯訊息，故 callbackId / messageId 留空（對應方法為 no-op／改送新訊息）。
    if (ev.type === 'postback') {
      const data = ev.postback?.data;
      if (this.callbackHandler && data) {
        const cb: IncomingCallback = {
          channel: this.channel,
          callbackId: '',
          data,
          chatId,
          messageId: '',
          fromId: src?.userId ?? 'unknown',
          fromName: await this.resolveReporterName(src),
        };
        await this.callbackHandler(cb);
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

    // L2 同人去抖合併：LINE 沒有相簿 id，一次傳多張會拆成多則 image 事件連續送達。
    // 給 image/file 一個「同人穩定鍵」line:{userId}，讓 MediaGroupAggregator 用既有的
    // debounce（約 2 秒）把這批合併成一筆；text/location/audio 不給鍵→即時放行。
    const isAlbumable = m.type === 'image' || m.type === 'file';
    const mediaGroupId = isAlbumable
      ? `line:${src?.userId ?? src?.groupId ?? chatId}`
      : undefined;

    const msg: IncomingMessage = {
      channel: this.channel,
      chatId,
      messageId: m.id,
      mediaGroupId,
      reporterId: src?.userId ?? 'unknown',
      // L2：呼叫 group/room/user profile API 取真實顯示名稱（取不到退回佔位、結果快取）
      reporterName: await this.resolveReporterName(src),
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

  /**
   * 取回報人顯示名稱（L2：getGroupMemberProfile）。
   * 依來源型別選 endpoint：群組 → group member、多人房 → room member、1對1 → profile。
   * 結果快取在 nameCache；API 失敗（如 bot 未在群內、隱私設定）退回 userId 前段佔位，不致命。
   */
  private async resolveReporterName(src: LineSource | undefined): Promise<string> {
    const userId = src?.userId;
    if (!userId) return 'LINE使用者';

    const cached = this.nameCache.get(userId);
    if (cached) return cached;

    let url: string;
    if (src?.type === 'group' && src.groupId) {
      url = `https://api.line.me/v2/bot/group/${src.groupId}/member/${userId}`;
    } else if (src?.type === 'room' && src.roomId) {
      url = `https://api.line.me/v2/bot/room/${src.roomId}/member/${userId}`;
    } else {
      url = `https://api.line.me/v2/bot/profile/${userId}`;
    }

    const fallback = `LINE:${userId.slice(0, 8)}`;
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${this.token}` },
      });
      if (!res.ok) {
        logger.warn('LINE 取顯示名稱失敗，用佔位', {
          status: res.status,
          userId: userId.slice(0, 8),
        });
        return fallback;
      }
      const data = (await res.json()) as { displayName?: string };
      const name = data.displayName?.trim();
      if (name) {
        this.nameCache.set(userId, name);
        return name;
      }
      return fallback;
    } catch (err) {
      logger.warn('LINE 取顯示名稱例外，用佔位', err instanceof Error ? err.message : err);
      return fallback;
    }
  }

  // ── 送出側：reply/push（sendMessage…）於 L3 接；L2 先補媒體下載 ──────────────

  /**
   * 下載 LINE 訊息夾帶的內容（L2：照片/檔案/錄音）。
   * LINE 用 message id 取內容，且走 api-data 網域：GET /v2/bot/message/{id}/content。
   * 註：handleEvent 正規化時 fileId 直接填 message id（m.id），故這裡 fileId 即 message id。
   * LINE 不回傳檔名/路徑，副檔名改由回應的 Content-Type 推（photoIntake 讀 remotePath 的副檔名）。
   */
  async downloadFile(fileId: string): Promise<DownloadedFile> {
    if (!this.token) {
      throw new Error('LINE 未設定 access token，無法下載內容');
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60_000); // 下載上限 60 秒
    try {
      const res = await fetch(
        `https://api-data.line.me/v2/bot/message/${encodeURIComponent(fileId)}/content`,
        {
          headers: { Authorization: `Bearer ${this.token}` },
          signal: ctrl.signal,
        },
      );
      if (!res.ok) {
        throw new Error(`LINE 下載內容失敗：HTTP ${res.status}（message id=${fileId}）`);
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim();
      // remotePath 只用來讓 photoIntake 取副檔名；LINE 無真實路徑，給合成檔名帶副檔名即可
      return {
        buffer,
        remotePath: `content${extFromContentType(contentType)}`,
        fileSize: buffer.length,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  // ── 送出側（L3）：bot 主動回覆一律走 push API（reply token 有時效，建檔多在非同步下載後才回）─

  /** 送純文字訊息（push） */
  async sendMessage(chatId: string, text: string): Promise<void> {
    await this.push(chatId, [{ type: 'text', text }]);
  }

  /**
   * 送附按鈕的訊息：LINE 無 inline keyboard，改用 quick reply（鍵盤上方按鈕、帶 postback）。
   * 限制：quick reply 上限 13 顆、label 上限 20 字。超量取前 13 並警告（不靜默截斷）。
   * columns 在 LINE 無對應（quick reply 單列水平捲動），忽略。
   */
  async sendMessageWithButtons(
    chatId: string,
    text: string,
    buttons: OutgoingButton[],
    _columns?: number,
  ): Promise<void> {
    await this.push(chatId, [{ type: 'text', text, quickReply: toQuickReply(buttons) }]);
  }

  async answerCallback(): Promise<void> {
    // LINE postback 無「載入中」轉圈，無對應動作
  }

  /**
   * 「就地更新訊息」：LINE 不能編輯訊息 → 改送一則新訊息達到等效（原 quick reply 會自然消失）。
   * 有 buttons 就帶 quick reply，無 buttons＝單純送新文字（等同把按鈕收掉）。
   */
  async editMessageText(
    _chatId: string,
    _messageId: string,
    text: string,
    buttons?: OutgoingButton[],
    columns?: number,
  ): Promise<void> {
    if (buttons && buttons.length > 0) {
      await this.sendMessageWithButtons(_chatId, text, buttons, columns);
    } else {
      await this.sendMessage(_chatId, text);
    }
  }

  /** 呼叫 LINE Messaging API 的 push（主動推訊息給某 chat） */
  private async push(to: string, messages: unknown[]): Promise<void> {
    if (!this.token) {
      throw new Error('LINE 未設定 access token，無法送訊息');
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    try {
      const res = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify({ to, messages }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`LINE push 失敗：HTTP ${res.status} ${detail}`.trim());
      }
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * 把平台無關的按鈕陣列轉成 LINE quick reply。
 * postback action：label（鍵面字，≤20）、data（回呼資料）、displayText（按下後聊天室顯示的字）。
 */
function toQuickReply(buttons: OutgoingButton[]): {
  items: { type: 'action'; action: Record<string, string> }[];
} {
  const MAX = 13; // LINE quick reply 上限
  if (buttons.length > MAX) {
    logger.warn('LINE quick reply 超過上限，只送前 13 顆', { 原顆數: buttons.length });
  }
  const items = buttons.slice(0, MAX).map((b) => ({
    type: 'action' as const,
    action: {
      type: 'postback',
      label: b.text.slice(0, 20),
      data: b.callbackData,
      displayText: b.text,
    },
  }));
  return { items };
}

/**
 * 由下載回應的 Content-Type 推副檔名（LINE 不提供檔名）。
 * 對不到時回空字串，交給 photoIntake 後續退路（mimeType→.bin）。
 */
function extFromContentType(contentType: string): string {
  const map: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/heic': '.heic',
    'image/heif': '.heif',
    'image/webp': '.webp',
    'image/gif': '.gif',
    // 錄音/音訊（LINE 語音多為 m4a）
    'audio/mp4': '.m4a',
    'audio/x-m4a': '.m4a',
    'audio/aac': '.aac',
    'audio/mpeg': '.mp3',
    'audio/ogg': '.oga',
    'audio/wav': '.wav',
    'audio/x-wav': '.wav',
    // 檔案常見型別
    'application/pdf': '.pdf',
    'video/mp4': '.mp4',
  };
  return map[contentType] ?? '';
}
