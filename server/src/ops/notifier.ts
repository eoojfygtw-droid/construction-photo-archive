// ============================================================
// notifier.ts — 存活通知 + 外部心跳（死手開關）
// 兩種互補的「機器還活著嗎」訊號：
//   1) Telegram 狀態通知：bot 啟動/停止/崩潰時,主動發訊息給「管理對象」chat。
//      涵蓋:重開機恢復、手動停止、程式級崩潰。
//   2) healthchecks.io 心跳:每隔幾分鐘 ping 一個外部網址。一旦這台機器斷電/當死,
//      心跳就停了,由外部服務(在別處)發警報——這是唯一抓得到「整台機器沒了」的方法。
//
// 設計原則:
//   - 與 adapter 解耦,自己直接打 Telegram API,所以崩潰路徑(adapter 可能已壞)仍能發訊息。
//   - 所有方法「永不丟出例外」:通知失敗只記 log,絕不拖垮主程式。
//   - 全部 env-gated:未設 adminChatId / healthcheckUrl 就靜默略過。
// ============================================================
import { logger } from '../utils/logger';

/** 通知器設定 */
export interface NotifierOptions {
  botToken: string;
  /** 狀態通知要發到的 chat id；空＝不發 Telegram 通知 */
  adminChatId: string;
  /** healthchecks.io ping 網址；空＝不發心跳 */
  healthcheckUrl: string;
  /** 心跳間隔（秒） */
  heartbeatIntervalSec: number;
}

export class Notifier {
  private hbTimer: ReturnType<typeof setInterval> | null = null;
  private uptimeTimer: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;

  constructor(private readonly opts: NotifierOptions) {}

  /** 發一則狀態訊息到管理對象（未設 adminChatId 則略過；永不丟例外） */
  async notify(text: string): Promise<void> {
    if (!this.opts.adminChatId) return;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 10_000);
      try {
        const res = await fetch(
          `https://api.telegram.org/bot${this.opts.botToken}/sendMessage`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: this.opts.adminChatId, text }),
            signal: ctrl.signal,
          },
        );
        if (!res.ok) logger.warn('狀態通知送出失敗', { http: res.status });
      } finally {
        clearTimeout(t);
      }
    } catch (err) {
      logger.warn('狀態通知送出例外', err instanceof Error ? err.message : err);
    }
  }

  /**
   * ping healthchecks.io。suffix 可為:
   *   ''       一般「我還活著」
   *   '/fail'  主動回報失敗（崩潰時用,讓外部服務立刻知道）
   * 未設 url 則略過；永不丟例外。
   */
  async ping(suffix = ''): Promise<void> {
    if (!this.opts.healthcheckUrl) return;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 10_000);
      try {
        await fetch(`${this.opts.healthcheckUrl}${suffix}`, {
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(t);
      }
    } catch (err) {
      logger.warn('心跳 ping 失敗', err instanceof Error ? err.message : err);
    }
  }

  /** 開始定時心跳:先 ping 一次,之後每隔 interval ping。未設 url 則不啟動。 */
  startHeartbeat(): void {
    if (!this.opts.healthcheckUrl) return;
    void this.ping();
    this.hbTimer = setInterval(
      () => void this.ping(),
      this.opts.heartbeatIntervalSec * 1000,
    );
    // 心跳 timer 不該成為「擋住程序結束」的唯一理由(收到結束訊號時 shutdown 會清掉)
    this.hbTimer.unref?.();
  }

  /**
   * 開始「工作時長」回報:每隔 3〜5 小時的隨機時間發一則「已經工作 N 分鐘了」。
   * 用隨機間隔(非固定),所以回報的分鐘數不會是整齊的倍數(186、369、640…)。
   * 時長從這一刻起算(每次啟動歸零,數字變小＝剛重啟過)。未設 adminChatId 則不啟動。
   */
  startUptimeReports(): void {
    if (!this.opts.adminChatId) return;
    this.startedAt = Date.now();
    const MIN_MS = 3 * 60 * 60 * 1000; // 3 小時
    const MAX_MS = 5 * 60 * 60 * 1000; // 5 小時
    const scheduleNext = (): void => {
      const delay = MIN_MS + Math.floor(Math.random() * (MAX_MS - MIN_MS + 1));
      this.uptimeTimer = setTimeout(() => {
        const mins = Math.round((Date.now() - this.startedAt) / 60000);
        void this.notify(`🟢 報告老闆我已經工作 ${mins} 分鐘了`);
        scheduleNext(); // 排下一次(又是新的隨機間隔)
      }, delay);
      this.uptimeTimer.unref?.();
    };
    scheduleNext();
  }

  /** 停止所有背景 timer（心跳 + 工作時長回報） */
  stopTimers(): void {
    if (this.hbTimer) {
      clearInterval(this.hbTimer);
      this.hbTimer = null;
    }
    if (this.uptimeTimer) {
      clearTimeout(this.uptimeTimer);
      this.uptimeTimer = null;
    }
  }
}
