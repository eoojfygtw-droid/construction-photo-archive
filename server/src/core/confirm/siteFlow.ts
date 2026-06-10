// ============================================================
// siteFlow.ts — 5-3b 按鈕詢問工地 + ✏️ 改工地（重歸檔）
// 第 5 層：判不出工地時，送出「工地選單」讓使用者點選。
// ✏️ 改工地：把確認訊息就地改成同一個工地選單。
// 選定工地 → 把照片從 _inbox / 舊工地搬到新工地，改寫 metadata、更新 DB、定案。
// callback data：s:{recordId}:{code}；code=_keep 代表「留 _inbox 不動」。
// 決策（2026-06-05）：record_no 不重編，保留原編號（含 INBOX-），只填 project_code。
// ============================================================
import type { IncomingCallback } from '../../channels/types';
import type {
  MessageChannelAdapter,
  OutgoingButton,
} from '../../channels/MessageChannelAdapter';
import type { Db } from '../../db';
import type { ProjectStore } from '../projects/ProjectStore';
import type { UserContextStore } from '../resolve/UserContextStore';
import { reassignArchive, type ReassignPhoto } from '../records/archiver';
import { logger } from '../../utils/logger';

/** 指定/改工地後的狀態（使用者主動選工地＝已確認） */
const ASSIGNED_STATUS = '待改善';
/** 「留 _inbox 不動」的特殊碼 */
export const KEEP_INBOX = '_keep';

/** 建工地選單按鈕：每個啟用工地一顆 + 「留 _inbox」 */
export function buildSitePickerButtons(
  projectStore: ProjectStore,
  recordId: number,
): OutgoingButton[] {
  const buttons: OutgoingButton[] = projectStore.listActive().map((p) => ({
    text: `${p.code} ${p.name}`,
    callbackData: `s:${recordId}:${p.code}`,
  }));
  buttons.push({
    text: '↩️ 留待歸檔（_inbox）',
    callbackData: `s:${recordId}:${KEEP_INBOX}`,
  });
  return buttons;
}

/** ✏️ 改工地：把訊息就地改成工地選單（一列一個工地） */
export async function showSitePicker(
  adapter: MessageChannelAdapter,
  db: Db,
  projectStore: ProjectStore,
  cb: IncomingCallback,
  recordId: number,
): Promise<void> {
  const rec = db.getRecordById(recordId);
  if (!rec) {
    await adapter.answerCallback(cb.callbackId, '找不到這筆紀錄');
    return;
  }
  if (projectStore.listActive().length === 0) {
    await adapter.answerCallback(cb.callbackId, '尚未設定工地，請先用 /addproject 新增');
    return;
  }
  await adapter.answerCallback(cb.callbackId);
  await adapter.editMessageText(
    cb.chatId,
    cb.messageId,
    `✏️ 請選擇正確工地（${rec.recordNo}）：`,
    buildSitePickerButtons(projectStore, recordId),
    1,
  );
}

/** 選定工地 s:{recordId}:{code} 的處理 */
export async function handleSitePick(
  adapter: MessageChannelAdapter,
  db: Db,
  projectStore: ProjectStore,
  contextStore: UserContextStore,
  cb: IncomingCallback,
  recordId: number,
  code: string,
): Promise<void> {
  // 留 _inbox：不動工地，僅確認收到
  if (code === KEEP_INBOX) {
    const rec = db.getRecordById(recordId);
    await adapter.answerCallback(cb.callbackId, '保留為待歸檔');
    await adapter.editMessageText(
      cb.chatId,
      cb.messageId,
      `↩️ 保留待歸檔（${rec?.recordNo ?? recordId}）。之後可再指定工地。`,
    );
    return;
  }

  const proj = projectStore.findByCode(code);
  if (!proj) {
    await adapter.answerCallback(cb.callbackId, '找不到這個工地');
    return;
  }
  const rec = db.getRecordFull(recordId);
  if (!rec) {
    await adapter.answerCallback(cb.callbackId, '找不到這筆紀錄');
    return;
  }

  // 沿用原收件日期分層（紀錄日期不變）
  const d = new Date(rec.receivedAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  const yyyy = String(d.getFullYear());
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());

  const photos = db.getPhotos(recordId);
  const reassignPhotos: ReassignPhoto[] = photos.map((p) => ({
    photoId: p.id,
    currentPath: p.filePath,
    uploadType: p.uploadType,
    bytes: p.bytes,
    hasExif: p.hasExif,
    exifTakenAt: p.exifTakenAt,
    exifGps:
      p.exifGpsLat != null && p.exifGpsLng != null
        ? { latitude: p.exifGpsLat, longitude: p.exifGpsLng }
        : null,
  }));

  // 搬檔重歸檔（resolve_method 標記為人工按鈕指定）
  const RESOLVE_METHOD = 'manual_pick';
  const result = await reassignArchive({
    recordNo: rec.recordNo,
    targetCode: proj.code,
    targetName: proj.name,
    yyyy,
    mm,
    dd,
    photos: reassignPhotos,
    meta: {
      channel: rec.channel,
      resolveMethod: RESOLVE_METHOD,
      reporterId: rec.reporterId,
      reporterName: rec.reporterName,
      receivedAt: rec.receivedAt,
      takenAt: rec.takenAt,
      gps:
        rec.gpsLat != null && rec.gpsLng != null
          ? { latitude: rec.gpsLat, longitude: rec.gpsLng }
          : null,
      mediaGroupId: rec.mediaGroupId,
      sourceMessageId: rec.sourceMessageId,
      textNote: rec.textNote,
    },
  });

  // 更新 DB：照片新路徑、工地、狀態
  for (const p of result.photos) {
    db.updatePhotoPath(p.photoId, p.archivedPath);
  }
  db.setProject(recordId, proj.code, proj.name, RESOLVE_METHOD);
  if (rec.status !== ASSIGNED_STATUS) {
    db.updateStatus(recordId, ASSIGNED_STATUS, cb.fromId);
  }

  // 選單指定也算正向判定：記回報人 2 小時工地上下文，之後傳的照片走 recent_context 自動沿用。
  // 記在「紀錄的回報人」（不是按按鈕的人）、時間錨在收件時間——
  // 事後 ✏️ 改幾小時前的舊紀錄會自然過期，且不會把回報人較新的上下文蓋掉。
  contextStore.setIfNewer(rec.reporterId, proj.code, Date.parse(rec.receivedAt));

  await adapter.answerCallback(cb.callbackId, '已歸檔 ✅');
  await adapter.editMessageText(
    cb.chatId,
    cb.messageId,
    `✅ 已歸檔到 ${proj.code} ${proj.name}\n` +
      `編號：${rec.recordNo}\n狀態：${ASSIGNED_STATUS}\n（指定：${cb.fromName}）`,
  );
  logger.info('紀錄已人工指定工地', {
    紀錄編號: rec.recordNo,
    工地: `${proj.code} ${proj.name}`,
    原工地: rec.projectCode ?? '（_inbox）',
    歸檔目錄: result.dir,
    指定人: `${cb.fromName}（${cb.fromId}）`,
  });
}
