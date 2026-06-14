// ============================================================
// PendingInboxStore.ts — 冷啟動判不出時，累積「同一回報人連續判不出的照片」。
//
// 痛點（2026-06-13 驗收期實測）：到現場連續單張傳照片、既沒標代碼也沒傳定位、
// 又不在 2 小時 recent_context 窗內 → 每張都判不出、每張各跳一個工地選單洗版，
// 使用者一個都沒點，全留 _inbox。但其實只要點一次工地，這批通常是同一工地。
//
// 解法：判不出時把 record id 累積到該回報人名下，去抖只送一次選單；
//       使用者點一次工地 → 把這批 _inbox 一次全歸過去（見 siteFlow.handleBatchSitePick），
//       並順手寫 recent_context，後續照片自動歸、不再判不出。
//
// 純記憶體：bot 重啟即清空（未處理的紀錄仍在 DB／_inbox，可用後台歸檔，不會遺失）。
// ============================================================

/** 連續判不出時，選單去抖：90 秒內只送一次，避免每張洗版 */
const PROMPT_DEBOUNCE_MS = 90 * 1000;

/** 同一回報人超過 2 小時沒再判不出，視為新的一批（與 recent_context 窗一致） */
const BATCH_TTL_MS = 2 * 60 * 60 * 1000;

interface InboxBatch {
  recordIds: number[];
  lastPromptAt: number; // 上次送選單的時間（去抖用）
  lastAddAt: number; // 上次累積的時間（判斷是否同一批）
}

export class PendingInboxStore {
  private map = new Map<string, InboxBatch>();

  /**
   * 把一筆判不出的紀錄累積到該回報人名下。
   * 距上次累積超過 BATCH_TTL_MS 視為新一批（清掉舊的重來）。
   */
  add(reporterId: string, recordId: number, now: number): void {
    let e = this.map.get(reporterId);
    if (!e || now - e.lastAddAt > BATCH_TTL_MS) {
      e = { recordIds: [], lastPromptAt: 0, lastAddAt: now };
      this.map.set(reporterId, e);
    }
    if (!e.recordIds.includes(recordId)) e.recordIds.push(recordId);
    e.lastAddAt = now;
  }

  /**
   * 這次判不出要不要送選單？第一筆要送；之後 90 秒內的連續判不出靜默累積、不洗版。
   * 回傳 true 時已順手更新去抖計時。
   */
  shouldPrompt(reporterId: string, now: number): boolean {
    const e = this.map.get(reporterId);
    if (!e) return false;
    if (now - e.lastPromptAt > PROMPT_DEBOUNCE_MS) {
      e.lastPromptAt = now;
      return true;
    }
    return false;
  }

  /** 取出並清空該回報人累積的所有待歸檔 record id（批次歸檔時用） */
  takeAll(reporterId: string): number[] {
    const e = this.map.get(reporterId);
    if (!e) return [];
    this.map.delete(reporterId);
    return e.recordIds;
  }

  /** 唯讀偷看目前累積（smoke 測試用，不清空） */
  peek(reporterId: string): number[] {
    return this.map.get(reporterId)?.recordIds ?? [];
  }
}
