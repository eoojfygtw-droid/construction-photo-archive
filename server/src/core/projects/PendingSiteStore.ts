// ============================================================
// PendingSiteStore.ts — 暫存「剛用 /新增工地 加好、但還沒設座標」的工地。
// 同一回報人接著傳一個「位置」時，就把那座標設成這個工地的中心（開 GPS 自動歸檔）。
// 記憶體即可，10 分鐘逾時；取一次就清掉。
// ============================================================
const TTL_MS = 10 * 60 * 1000; // 10 分鐘內傳位置才算數

export class PendingSiteStore {
  private map = new Map<string, { code: string; at: number }>();

  /** 記住某回報人剛新增、待設座標的工地代碼 */
  set(reporterId: string, code: string, now: number): void {
    this.map.set(reporterId, { code, at: now });
  }

  /** 取出並清除該回報人的待設工地；逾時或無則回 null */
  take(reporterId: string, now: number): string | null {
    const e = this.map.get(reporterId);
    if (!e) return null;
    this.map.delete(reporterId);
    if (now - e.at > TTL_MS) return null;
    return e.code;
  }
}
