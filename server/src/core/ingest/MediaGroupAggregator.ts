// ============================================================
// MediaGroupAggregator.ts — 第 3 步：相簿（media group）合併
// Telegram 一次傳多張照片時，會拆成多則訊息、共用同一個 media_group_id 連續送達。
// 本聚合器以 debounce（預設約 2 秒）把同一相簿的訊息合併成「一筆」再交給下游，
// 避免一個相簿被拆成多筆紀錄。
//
// 規則：
// - 無 mediaGroupId 的訊息：立即放行（單張/純文字/位置）。
// - 有 mediaGroupId 的訊息：暫存並重設計時器；最後一則到齊約 2 秒後 flush 合併。
// ============================================================
import type { IncomingMessage } from '../../channels/types';
import { logger } from '../../utils/logger';

/** 合併完成後交給下游的處理函式 */
export type AggregatedHandler = (msg: IncomingMessage) => void | Promise<void>;

interface Buffer {
  messages: IncomingMessage[];
  timer: NodeJS.Timeout;
}

export class MediaGroupAggregator {
  private readonly buffers = new Map<string, Buffer>();

  constructor(
    private readonly onReady: AggregatedHandler,
    private readonly debounceMs = 2000,
  ) {}

  /**
   * 餵入一則正規化訊息。
   * 非相簿訊息回傳 Promise 並由呼叫端 await，確保「同一輪訊息依抵達順序逐則處理完」，
   * 這對工地判斷第 4 層 recent_context（讀取需在設定之後）很重要。
   */
  push(msg: IncomingMessage): void | Promise<void> {
    // 沒有相簿群組 → 不需等待合併，直接（依序）處理
    if (!msg.mediaGroupId) {
      return this.safeEmit(msg);
    }

    const key = `${msg.chatId}:${msg.mediaGroupId}`;
    const existing = this.buffers.get(key);
    if (existing) {
      existing.messages.push(msg);
      // 又來一張 → 重設計時器（debounce：等這批不再有新訊息才合併）
      clearTimeout(existing.timer);
      existing.timer = setTimeout(() => this.flush(key), this.debounceMs);
    } else {
      const timer = setTimeout(() => this.flush(key), this.debounceMs);
      this.buffers.set(key, { messages: [msg], timer });
    }
  }

  /** 立即合併並送出指定相簿（debounce 計時器到點時呼叫） */
  private flush(key: string): void {
    const entry = this.buffers.get(key);
    if (!entry) return;
    this.buffers.delete(key);
    clearTimeout(entry.timer);

    const merged = mergeMessages(entry.messages);
    logger.info('相簿合併', {
      相簿群組: merged.mediaGroupId,
      合併則數: entry.messages.length,
      照片總數: merged.photos.length,
    });
    void this.safeEmit(merged);
  }

  /** 關閉前把所有尚在等待的相簿立即 flush，避免漏件 */
  flushAll(): void {
    for (const key of [...this.buffers.keys()]) {
      this.flush(key);
    }
  }

  /** 呼叫下游 handler，吞掉例外以免拖垮收訊主迴圈 */
  private async safeEmit(msg: IncomingMessage): Promise<void> {
    try {
      await this.onReady(msg);
    } catch (err) {
      logger.error(
        '下游處理失敗',
        err instanceof Error ? err.message : err,
      );
    }
  }
}

/**
 * 把同一相簿的多則訊息合併為一則：
 * - 以 message_id 最小（最早）那則為基底
 * - 照片：依序串接所有則的照片
 * - 文字/說明/位置：取第一個非空者（Telegram 通常把 caption 放在其中一則）
 * - 時間：取最早
 */
function mergeMessages(messages: IncomingMessage[]): IncomingMessage {
  const sorted = [...messages].sort(
    (a, b) => Number(a.messageId) - Number(b.messageId),
  );
  const base = sorted[0];

  const photos = sorted.flatMap((m) => m.photos);
  const caption = sorted
    .map((m) => m.caption)
    .find((c) => c && c.trim().length > 0);
  const text = sorted.map((m) => m.text).find((t) => t && t.trim().length > 0);
  const location = sorted.map((m) => m.location).find((loc) => loc != null);

  return {
    ...base,
    photos,
    caption,
    text,
    location,
    date: Math.min(...sorted.map((m) => m.date)),
  };
}
