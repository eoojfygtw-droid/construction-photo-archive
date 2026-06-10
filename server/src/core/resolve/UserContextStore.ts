// ============================================================
// UserContextStore.ts — 回報人「最近工地上下文」（工地判斷第 4 層）
// 記憶體版：記住每位回報人最後一次「正向判定」的工地與時間，
// 在 TTL（預設 2 小時）內可沿用。V0 重啟即清空，可接受。
// 設定者：manual_code / photo_gps / telegram_location 這三層判定成功時，
// 以及人工正向指定（定位選單 loc:{code}、紀錄工地選單 manual_pick）。
// ============================================================

interface Ctx {
  projectCode: string;
  atMs: number;
}

export class UserContextStore {
  private readonly map = new Map<string, Ctx>();

  /** ttlMs 預設 2 小時 */
  constructor(private readonly ttlMs = 2 * 60 * 60 * 1000) {}

  /** 記錄某回報人最後判定的工地 */
  set(reporterId: string, projectCode: string, atMs: number): void {
    this.map.set(reporterId, { projectCode, atMs });
  }

  /**
   * 只在 atMs 不比現存舊時才記錄。
   * 供「事後補判定」使用（✏️ 改舊紀錄的工地時，時間錨在原收件時間）：
   * 不可把回報人較新的上下文蓋成舊工地。
   */
  setIfNewer(reporterId: string, projectCode: string, atMs: number): void {
    const c = this.map.get(reporterId);
    if (c && c.atMs > atMs) return;
    this.map.set(reporterId, { projectCode, atMs });
  }

  /** 取回報人在 TTL 內的工地；過期或無紀錄回 null */
  get(reporterId: string, nowMs: number): string | null {
    const c = this.map.get(reporterId);
    if (!c) return null;
    if (nowMs - c.atMs > this.ttlMs) return null;
    return c.projectCode;
  }
}
