// ============================================================
// confirmFlow.ts — 5-3a 人工確認流程（Bot 回覆整理結果 + ✅/✏️）
// 建檔後送出整理結果 + inline keyboard；使用者按 ✅ 正確 → 狀態 待確認→待改善（PRD）。
// ✏️ 修改 的完整流程（改工地等）留待 5-3b；本片先回覆「下一片開放」。
// callback data 格式：「{動作}:{recordId}」，動作 c=確認、e=修改。
// ============================================================
import type { IncomingCallback } from '../../channels/types';
import type {
  MessageChannelAdapter,
  OutgoingButton,
} from '../../channels/MessageChannelAdapter';
import type { Db } from '../../db';
import type { ProjectStore } from '../projects/ProjectStore';
import type { UserContextStore } from '../resolve/UserContextStore';
import { handleSitePick, showSitePicker } from './siteFlow';
import { logger } from '../../utils/logger';

/** 確認後的狀態（PRD：人工點 ✅ 後 → 待改善） */
const CONFIRMED_STATUS = '待改善';

/** 整理結果摘要（由上層在建檔後備齊） */
export interface ConfirmSummary {
  recordId: number;
  recordNo: string;
  /** 工地標示，例如「A001 信義豪宅案」或「（未歸檔／_inbox）」 */
  projectLabel: string;
  /** 判定方式（manual_code 等） */
  method: string;
  photoCount: number;
  /** 錄音/音訊則數（無則可省略） */
  voiceCount?: number;
  note: string | null;
  reporterName: string;
}

/** 判定方式中文標示（回條顯示用；查無對應就原樣顯示） */
const METHOD_LABELS: Record<string, string> = {
  manual_code: '訊息帶代碼',
  photo_gps: '照片GPS',
  telegram_location: '定位判定',
  recent_context: '自動沿用',
  manual_pick: '人工指定',
};

/**
 * 建檔後送出「整理結果 + ✅/✏️」訊息。
 * 回條語氣（2026-06-10 調整）：工地已判定才會走到這裡，歸檔已完成，
 * 使用者不需要回覆——按鈕只是「有錯才用」的修正入口與封單/計分器，
 * 文案不可寫成必答題（實測會被誤讀成又在問工地）。
 */
export async function promptConfirm(
  adapter: MessageChannelAdapter,
  chatId: string,
  s: ConfirmSummary,
): Promise<void> {
  const lines = [
    `📋 已建檔 ${s.recordNo}`,
    `🏗 工地：${s.projectLabel}（${METHOD_LABELS[s.method] ?? s.method}）`,
    `📷 照片：${s.photoCount} 張`,
  ];
  if (s.voiceCount) lines.push(`🎤 錄音：${s.voiceCount} 則`);
  if (s.note) lines.push(`📝 備註：${s.note}`);
  lines.push(`👤 回報：${s.reporterName}`);
  lines.push('', '✅ 已自動歸檔，不用回覆。', '資料有誤才需要按 ✏️ 修改。');

  const buttons: OutgoingButton[] = [
    { text: '✅ 確認無誤', callbackData: `c:${s.recordId}` },
    { text: '✏️ 修改', callbackData: `e:${s.recordId}` },
  ];
  await adapter.sendMessageWithButtons(chatId, lines.join('\n'), buttons);
}

/**
 * 處理按鈕回呼（✅ 確認 / ✏️ 改工地 / 選定工地）。
 * 回呼一律先 answerCallback 關掉使用者端的轉圈，再做後續動作。
 * callback data：c:{id}=確認、e:{id}=改工地（叫出選單）、s:{id}:{code}=選定工地。
 */
export async function handleConfirmCallback(
  adapter: MessageChannelAdapter,
  db: Db,
  projectStore: ProjectStore,
  contextStore: UserContextStore,
  cb: IncomingCallback,
): Promise<void> {
  const parts = cb.data.split(':');
  const action = parts[0];
  const recordId = Number(parts[1]);

  if (!action || Number.isNaN(recordId)) {
    await adapter.answerCallback(cb.callbackId, '無法辨識的操作');
    return;
  }

  if (action === 'c') {
    await confirmRecord(adapter, db, cb, recordId);
    return;
  }
  if (action === 'e') {
    // ✏️ 改工地：叫出工地選單（5-3b）
    await showSitePicker(adapter, db, projectStore, cb, recordId);
    return;
  }
  if (action === 's') {
    // 選定工地（code 可能含特殊碼 _keep；用 slice 保留完整）
    const code = parts.slice(2).join(':');
    await handleSitePick(adapter, db, projectStore, contextStore, cb, recordId, code);
    return;
  }
  await adapter.answerCallback(cb.callbackId, '無法辨識的操作');
}

/** ✅ 正確：待確認 → 待改善，就地更新訊息並移除按鈕 */
async function confirmRecord(
  adapter: MessageChannelAdapter,
  db: Db,
  cb: IncomingCallback,
  recordId: number,
): Promise<void> {
  const rec = db.getRecordById(recordId);
  if (!rec) {
    await adapter.answerCallback(cb.callbackId, '找不到這筆紀錄');
    return;
  }
  // 已確認過就不重複處理（避免重按產生重複歷程）
  if (rec.status === CONFIRMED_STATUS) {
    await adapter.answerCallback(cb.callbackId, '已經確認過了');
    return;
  }

  db.updateStatus(recordId, CONFIRMED_STATUS, cb.fromId);
  await adapter.answerCallback(cb.callbackId, '已確認 ✅');
  await adapter.editMessageText(
    cb.chatId,
    cb.messageId,
    `✅ 已確認定案 ${rec.recordNo}\n狀態：${CONFIRMED_STATUS}\n（確認：${cb.fromName}）`,
  );
  logger.info('紀錄已人工確認', {
    紀錄編號: rec.recordNo,
    狀態: `${rec.status} → ${CONFIRMED_STATUS}`,
    確認人: `${cb.fromName}（${cb.fromId}）`,
  });
}
