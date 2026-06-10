// ============================================================
// PendingLocationStore.ts — 暫存回報人剛傳的「定位」座標。
// 用途：單獨傳定位但判不出工地時，使用者可按「➕ 新增工地」→ 打 /新增工地 代碼 名稱，
//       10 分鐘內就用這個暫存座標直接當新工地的中心（不必再傳一次位置）。
// 與 PendingSiteStore 互為鏡像：那邊是「先建工地、等位置」，這邊是「先有位置、等建工地」。
// 記憶體即可，10 分鐘逾時；取一次就清掉。
// ============================================================
const TTL_MS = 10 * 60 * 1000; // 10 分鐘內打 /新增工地 才算數

export interface PendingLocation {
  latitude: number;
  longitude: number;
}

export class PendingLocationStore {
  private map = new Map<string, { loc: PendingLocation; at: number }>();

  /** 記住某回報人剛傳的定位座標 */
  set(reporterId: string, loc: PendingLocation, now: number): void {
    this.map.set(reporterId, { loc, at: now });
  }

  /** 取出並清除該回報人的暫存定位；逾時或無則回 null */
  take(reporterId: string, now: number): PendingLocation | null {
    const e = this.map.get(reporterId);
    if (!e) return null;
    this.map.delete(reporterId);
    if (now - e.at > TTL_MS) return null;
    return e.loc;
  }
}
