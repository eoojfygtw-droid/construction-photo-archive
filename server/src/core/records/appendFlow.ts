// ============================================================
// appendFlow.ts — 追加合併：照片建檔後接著傳的語音/文字，自動併入上一筆
// 背景：現場常見「先傳照片、再錄音/打字補充說明」，原本會拆成兩筆紀錄對不起來。
// 行為：
//   - 同一回報人 10 分鐘內接著傳「純語音/音訊或純文字」→ 自動併入他上一筆紀錄
//     （媒體續編進同一資料夾、文字接到備註、DB/metadata.json/text.txt 同步更新）。
//   - 回覆附「🆕 拆成新筆」按鈕可反悔：把剛併入的內容拆出去開成新紀錄。
// 不併入的情況（照舊開新筆/走原流程）：
//   - 訊息帶照片/檔案（拍新東西＝新紀錄）、帶位置（有自己的定位流程）
//   - 文字含工地代碼（語意是「切換工地」，不能吞掉）
//   - 上一筆已按 ✅ 確認（視為封單）、或超過 10 分鐘、或 bot 重啟後（store 是記憶體）
// callback data：sp:{appendId} → 拆成新筆
// ============================================================
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import type { IncomingCallback, IncomingMessage } from '../../channels/types';
import type {
  MessageChannelAdapter,
  OutgoingButton,
} from '../../channels/MessageChannelAdapter';
import type { Db, RecordFull } from '../../db';
import type { IntakeResult } from '../media/photoIntake';
import type { SiteResolver } from '../resolve/SiteResolver';
import { moveFile, recordDir } from './archiver';
import { promptConfirm } from '../confirm/confirmFlow';
import { logger } from '../../utils/logger';

/** 追加合併時間窗（毫秒）：上一筆建檔/上次追加後 10 分鐘內 */
const APPEND_WINDOW_MS = 10 * 60 * 1000;

/** 拆單 callback 前綴 */
const SPLIT_PREFIX = 'sp';

/** 記住每個回報人最近一筆紀錄（記憶體；bot 重啟即清空，屬可接受損失） */
export class LastRecordStore {
  private map = new Map<string, { recordId: number; atMs: number }>();
  /** 已封單（按過 ✅）的紀錄：不再接受追加。選工地/改工地不算封單。 */
  private closed = new Set<number>();

  set(reporterId: string, recordId: number, atMs: number): void {
    this.map.set(reporterId, { recordId, atMs });
  }

  /** 按 ✅ 確認＝封單：之後的語音/文字不再併入這筆 */
  markClosed(recordId: number): void {
    // 防無限成長：封單只在 10 分鐘時間窗內有意義，累積多了直接清掉
    if (this.closed.size > 500) this.closed.clear();
    this.closed.add(recordId);
  }

  /** 取時間窗內的最近紀錄 id；過期或已封單回 null */
  get(reporterId: string, nowMs: number): number | null {
    const e = this.map.get(reporterId);
    if (!e || nowMs - e.atMs > APPEND_WINDOW_MS) return null;
    if (this.closed.has(e.recordId)) return null;
    return e.recordId;
  }
}

/** 一次追加的內容（拆單時要原樣搬出去） */
interface AppendEntry {
  recordId: number;
  /** 追加進去的媒體 photo id（DB） */
  photoIds: number[];
  /** 追加的文字片段（拆單時還原） */
  textFragment: string | null;
  /** 追加前的舊備註（拆單時還原） */
  prevTextNote: string | null;
  reporterId: string;
  reporterName: string;
}

/** 記住每次追加的內容，供「🆕 拆成新筆」反悔（記憶體，bot 重啟即失效） */
export class AppendStore {
  private map = new Map<number, AppendEntry>();
  private nextId = 1;

  add(entry: AppendEntry): number {
    const id = this.nextId++;
    this.map.set(id, entry);
    return id;
  }

  take(id: number): AppendEntry | null {
    const e = this.map.get(id);
    if (e) this.map.delete(id);
    return e ?? null;
  }
}

/** 這則訊息是不是「追加候選」：純語音/音訊或純文字（無照片/檔案、無位置） */
export function isAppendCandidate(msg: IncomingMessage): boolean {
  if (msg.location) return false;
  const hasPhotoOrDoc = msg.photos.some(
    (p) => p.uploadType === 'photo' || p.uploadType === 'document',
  );
  if (hasPhotoOrDoc) return false;
  const hasVoice = msg.photos.some(
    (p) => p.uploadType === 'voice' || p.uploadType === 'audio',
  );
  const hasText = !!msg.text?.trim() || !!msg.caption?.trim();
  return hasVoice || hasText;
}

/**
 * 找出可併入的目標紀錄 id；不符合任一條件回 null（走原本建檔流程）。
 * 條件：時間窗內有上一筆、該筆未封單（封單＝按過 ✅，store 記）、文字不含工地代碼。
 * 注意：不看紀錄狀態——從選單選工地/改工地會把狀態改成「待改善」，
 *       但那只是歸類動作，不代表這件事記錄完了，封單只認 ✅。
 */
export function findAppendTarget(
  store: LastRecordStore,
  db: Db,
  resolver: SiteResolver,
  msg: IncomingMessage,
  nowMs: number,
): number | null {
  const recordId = store.get(msg.reporterId, nowMs);
  if (recordId == null) return null;

  // 文字含工地代碼＝切換工地的語意，交回原流程（會建新筆並更新上下文）
  const codeText = `${msg.text ?? ''} ${msg.caption ?? ''}`.trim();
  if (codeText && resolver.matchManualCode(codeText)) return null;

  // 紀錄不存在（理論上不會）才放棄
  const rec = db.getRecordById(recordId);
  if (!rec) return null;

  return recordId;
}

/** 取紀錄的歸檔目錄：有媒體用第一件所在目錄（經得起改工地搬移）；沒有就按規則推 */
function dirOfRecord(db: Db, rec: RecordFull): string {
  const photos = db.getPhotos(rec.id);
  if (photos.length > 0) return dirname(photos[0].filePath);
  const d = new Date(rec.receivedAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  return recordDir({
    recordNo: rec.recordNo,
    projectCode: rec.projectCode,
    projectName: rec.projectName,
    yyyy: String(d.getFullYear()),
    mm: pad(d.getMonth() + 1),
    dd: pad(d.getDate()),
  });
}

/** 用 DB 目前狀態重寫紀錄目錄的 metadata.json / text.txt（追加/拆單後同步） */
async function rewriteRecordFiles(db: Db, recordId: number, dir: string): Promise<void> {
  const rec = db.getRecordFull(recordId);
  if (!rec) return;
  const photos = db.getPhotos(recordId);
  const metadata = {
    record_no: rec.recordNo,
    project: { code: rec.projectCode, name: rec.projectName },
    channel: rec.channel,
    resolve_method: rec.resolveMethod,
    reporter: { id: rec.reporterId, name: rec.reporterName },
    received_at: rec.receivedAt,
    taken_at: rec.takenAt,
    gps:
      rec.gpsLat != null && rec.gpsLng != null
        ? { latitude: rec.gpsLat, longitude: rec.gpsLng }
        : null,
    media_group_id: rec.mediaGroupId,
    source_message_id: rec.sourceMessageId,
    text_note: rec.textNote,
    photos: photos.map((p) => ({
      file: basename(p.filePath),
      upload_type: p.uploadType,
      bytes: p.bytes,
      has_exif: p.hasExif,
      exif_taken_at: p.exifTakenAt,
      exif_gps:
        p.exifGpsLat != null && p.exifGpsLng != null
          ? { latitude: p.exifGpsLat, longitude: p.exifGpsLng }
          : null,
    })),
  };
  await writeFile(join(dir, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf8');
  const note = rec.textNote?.trim();
  if (note) {
    await writeFile(join(dir, 'text.txt'), `${note}\n`, 'utf8');
  } else {
    await rm(join(dir, 'text.txt'), { force: true }).catch(() => {});
  }
}

/**
 * 把這則訊息（已下載的媒體 + 文字）併入指定紀錄：
 * 媒體續編搬進同一資料夾、文字接到備註、重寫 metadata/text，回覆附「拆成新筆」。
 */
export async function appendToRecord(
  adapter: MessageChannelAdapter,
  db: Db,
  store: LastRecordStore,
  appends: AppendStore,
  msg: IncomingMessage,
  intake: IntakeResult[],
  recordId: number,
  nowMs: number,
): Promise<void> {
  const rec = db.getRecordFull(recordId);
  if (!rec) return;

  // 防呆：媒體全數下載失敗又沒有文字 → 沒東西可併，請使用者重傳
  const fragmentEarly =
    [msg.text, msg.caption].map((s) => s?.trim()).filter(Boolean).join(' ') || null;
  if (intake.length === 0 && !fragmentEarly) {
    await adapter.sendMessage(msg.chatId, '⚠️ 內容下載失敗，這則沒有併入，請再傳一次。');
    return;
  }

  const dir = dirOfRecord(db, rec);
  await mkdir(dir, { recursive: true });

  // 1) 媒體續編搬入（接在既有件數之後：-02、-03…）
  const existingCount = db.getPhotos(recordId).length;
  const photoIds: number[] = [];
  for (let i = 0; i < intake.length; i++) {
    const r = intake[i];
    const ext = extname(r.filePath) || '.bin';
    const seq = String(existingCount + i + 1).padStart(2, '0');
    const dest = join(dir, `${rec.recordNo}-${seq}${ext}`);
    let finalPath = r.filePath;
    try {
      await moveFile(r.filePath, dest);
      finalPath = dest;
    } catch (err) {
      logger.error('追加搬檔失敗，保留暫存路徑', {
        來源: r.filePath,
        目的: dest,
        錯誤: err instanceof Error ? err.message : err,
      });
    }
    photoIds.push(
      db.insertPhoto({
        recordId,
        filePath: finalPath,
        uploadType: r.uploadType,
        hasExif: !!(r.exif.takenAt || r.exif.gps),
        exifTakenAt: r.exif.takenAt ?? null,
        exifGpsLat: r.exif.gps?.latitude ?? null,
        exifGpsLng: r.exif.gps?.longitude ?? null,
        bytes: r.bytes,
      }),
    );
  }

  // 2) 文字接到備註
  const fragment =
    [msg.text, msg.caption]
      .map((s) => s?.trim())
      .filter((s): s is string => !!s)
      .join(' ') || null;
  const prevTextNote = rec.textNote;
  if (fragment) {
    const merged = [prevTextNote, fragment].filter((s) => !!s).join('\n');
    db.updateTextNote(recordId, merged);
  }

  // 3) 重寫 metadata.json / text.txt
  await rewriteRecordFiles(db, recordId, dir);

  // 4) 延長時間窗（連續補充視為同一回事）並記住此次追加供拆單
  store.set(msg.reporterId, recordId, nowMs);
  const appendId = appends.add({
    recordId,
    photoIds,
    textFragment: fragment,
    prevTextNote,
    reporterId: msg.reporterId,
    reporterName: msg.reporterName,
  });

  // 5) 回覆已併入 + 拆單按鈕
  const voiceCount = intake.filter(
    (r) => r.uploadType === 'voice' || r.uploadType === 'audio',
  ).length;
  const parts: string[] = [];
  if (voiceCount) parts.push(`錄音 ${voiceCount} 則`);
  if (fragment) parts.push('備註');
  const head = voiceCount ? '🎤' : '📝';
  const buttons: OutgoingButton[] = [
    { text: '🆕 拆成新筆', callbackData: `${SPLIT_PREFIX}:${appendId}` },
  ];
  await adapter.sendMessageWithButtons(
    msg.chatId,
    `${head} 已併入 ${rec.recordNo}（${parts.join('＋')}）。\n如果這是另一件事，按下面拆成新筆。`,
    buttons,
  );
  logger.info('已追加併入上一筆', {
    紀錄編號: rec.recordNo,
    追加內容: parts.join('＋'),
    回報人: `${msg.reporterName}（${msg.reporterId}）`,
  });
}

/** 是否為拆單回呼（sp:…） */
export function isSplitCallback(cb: IncomingCallback): boolean {
  return cb.data.startsWith(`${SPLIT_PREFIX}:`);
}

/**
 * 處理「🆕 拆成新筆」：把剛併入的媒體/文字搬出去開成新紀錄，
 * 原紀錄的備註還原、metadata 重寫；新紀錄沿用原工地（判定方式記 recent_context）。
 */
export async function handleSplitCallback(
  adapter: MessageChannelAdapter,
  db: Db,
  store: LastRecordStore,
  appends: AppendStore,
  cb: IncomingCallback,
  nowMs: number,
): Promise<void> {
  const appendId = Number(cb.data.slice(`${SPLIT_PREFIX}:`.length));
  const entry = Number.isNaN(appendId) ? null : appends.take(appendId);
  if (!entry) {
    await adapter.answerCallback(cb.callbackId, '找不到可拆的內容（可能已拆過或 bot 重啟）');
    return;
  }

  const oldRec = db.getRecordFull(entry.recordId);
  if (!oldRec) {
    await adapter.answerCallback(cb.callbackId, '找不到原紀錄');
    return;
  }

  // 1) 開新紀錄（沿用原工地；收件時間=現在）
  const now = new Date(nowMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  const yyyy = String(now.getFullYear());
  const mm = pad(now.getMonth() + 1);
  const dd = pad(now.getDate());
  const prefix = oldRec.projectCode ?? 'INBOX';
  const newRecordNo = db.nextRecordNo(prefix, `${yyyy}${mm}${dd}`);
  const newRecordId = db.insertRecord(newRecordNo, {
    channel: oldRec.channel,
    projectCode: oldRec.projectCode,
    projectName: oldRec.projectName,
    resolveMethod: oldRec.projectCode ? 'recent_context' : 'unresolved',
    textNote: entry.textFragment,
    reporterId: entry.reporterId,
    reporterName: entry.reporterName,
    sourceMessageId: null,
    mediaGroupId: null,
    gpsLat: null,
    gpsLng: null,
    status: '待確認',
    takenAt: null,
    receivedAt: now.toISOString(),
  });
  db.insertStatusLog(newRecordId, null, '待確認', cb.fromId);

  // 2) 把追加的媒體搬到新紀錄目錄並改掛 DB
  const newDir = recordDir({
    recordNo: newRecordNo,
    projectCode: oldRec.projectCode,
    projectName: oldRec.projectName,
    yyyy,
    mm,
    dd,
  });
  await mkdir(newDir, { recursive: true });
  const allPhotos = db.getPhotos(entry.recordId);
  const moved = allPhotos.filter((p) => entry.photoIds.includes(p.id));
  for (let i = 0; i < moved.length; i++) {
    const p = moved[i];
    const ext = extname(p.filePath) || '.bin';
    const dest = join(newDir, `${newRecordNo}-${String(i + 1).padStart(2, '0')}${ext}`);
    let finalPath = p.filePath;
    try {
      await moveFile(p.filePath, dest);
      finalPath = dest;
    } catch (err) {
      logger.error('拆單搬檔失敗，保留原路徑', {
        來源: p.filePath,
        目的: dest,
        錯誤: err instanceof Error ? err.message : err,
      });
    }
    db.movePhotoToRecord(p.id, newRecordId, finalPath);
  }

  // 3) 原紀錄備註還原 + 兩邊 metadata/text 重寫
  if (entry.textFragment) {
    db.updateTextNote(entry.recordId, entry.prevTextNote);
  }
  const refreshedOld = db.getRecordFull(entry.recordId);
  if (refreshedOld) {
    await rewriteRecordFiles(db, entry.recordId, dirOfRecord(db, refreshedOld));
  }
  await rewriteRecordFiles(db, newRecordId, newDir);

  // 4) 拆出去的新筆成為該回報人的「最近紀錄」（接著補充會併到新筆）
  store.set(entry.reporterId, newRecordId, nowMs);

  await adapter.answerCallback(cb.callbackId, '已拆成新筆 ✅');
  await adapter.editMessageText(
    cb.chatId,
    cb.messageId,
    `🆕 已拆成新筆 ${newRecordNo}（工地沿用 ${oldRec.projectCode ?? '_inbox'}），原紀錄 ${oldRec.recordNo} 已還原。`,
  );

  // 新筆補發 ✅/✏️ 確認（有工地才發；_inbox 的人工歸檔走既有流程）
  if (oldRec.projectCode) {
    const voiceCount = moved.filter(
      (p) => p.uploadType === 'voice' || p.uploadType === 'audio',
    ).length;
    await promptConfirm(adapter, cb.chatId, {
      recordId: newRecordId,
      recordNo: newRecordNo,
      projectLabel: `${oldRec.projectCode}${oldRec.projectName ? ` ${oldRec.projectName}` : ''}`,
      method: 'recent_context',
      photoCount: moved.length - voiceCount,
      voiceCount,
      note: entry.textFragment,
      reporterName: entry.reporterName,
    });
  }
  logger.info('追加內容已拆成新筆', {
    原紀錄: oldRec.recordNo,
    新紀錄: newRecordNo,
    媒體數: moved.length,
    操作人: `${cb.fromName}（${cb.fromId}）`,
  });
}
