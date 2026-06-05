// ============================================================
// recordWriter.ts — 把一筆就緒的紀錄寫進 SQLite + 正式歸檔（5-1 + 5-2）
// 產生紀錄編號 → 寫 records → 搬檔歸檔（_inbox/projects，寫 metadata.json/text.txt）
//   → 用正式路徑寫 photos → 寫 status_logs（初始 待確認）。
// ============================================================
import type { IncomingMessage } from '../../channels/types';
import type { Db } from '../../db';
import type { IntakeResult } from '../media/photoIntake';
import type { ProjectStore } from '../projects/ProjectStore';
import type { ResolveResult } from '../resolve/SiteResolver';
import { archiveRecord } from './archiver';

export interface WriteOutcome {
  recordNo: string;
  recordId: number;
  /** 紀錄歸檔目錄（5-2；供上層回報/Bot 回覆用） */
  archiveDir: string;
}

/** 寫入一筆紀錄與其照片並完成搬檔歸檔，回傳編號、id 與歸檔目錄 */
export async function writeRecord(
  db: Db,
  msg: IncomingMessage,
  intake: IntakeResult[],
  resolution: ResolveResult,
  projectStore: ProjectStore,
): Promise<WriteOutcome> {
  const now = new Date();
  const receivedAt = now.toISOString(); // 收件時間（歸檔日期依據）
  const pad = (n: number) => String(n).padStart(2, '0');
  const yyyy = String(now.getFullYear());
  const mm = pad(now.getMonth() + 1);
  const dd = pad(now.getDate());
  const yyyymmdd = `${yyyy}${mm}${dd}`;

  // 編號前綴：判定到工地用代碼，否則 INBOX
  const prefix = resolution.projectCode ?? 'INBOX';
  const recordNo = db.nextRecordNo(prefix, yyyymmdd);
  const proj = resolution.projectCode
    ? projectStore.findByCode(resolution.projectCode)
    : undefined;

  // 文字備註：合併文字與照片說明
  const textNote =
    [msg.text, msg.caption]
      .map((s) => s?.trim())
      .filter((s): s is string => !!s)
      .join(' ') || null;

  // 代表拍攝時間：第一張有 EXIF 拍攝時間者
  const takenAt = intake.find((r) => r.exif.takenAt)?.exif.takenAt ?? null;
  // 代表 GPS：位置訊息優先，否則第一張有 GPS 的照片
  const gps =
    msg.location ?? intake.map((r) => r.exif.gps).find((g) => g != null) ?? null;

  const recordId = db.insertRecord(recordNo, {
    channel: msg.channel,
    projectCode: resolution.projectCode,
    projectName: proj?.name ?? null,
    resolveMethod: resolution.method,
    textNote,
    reporterId: msg.reporterId,
    reporterName: msg.reporterName,
    sourceMessageId: msg.messageId,
    mediaGroupId: msg.mediaGroupId ?? null,
    gpsLat: gps?.latitude ?? null,
    gpsLng: gps?.longitude ?? null,
    status: '待確認',
    takenAt,
    receivedAt,
  });

  // 5-2 正式搬檔歸檔：照片從 _staging 搬到 _inbox/projects，寫 metadata.json/text.txt
  const archive = await archiveRecord({
    recordNo,
    projectCode: resolution.projectCode,
    projectName: proj?.name ?? null,
    yyyy,
    mm,
    dd,
    intake,
    meta: {
      channel: msg.channel,
      resolveMethod: resolution.method,
      reporterId: msg.reporterId,
      reporterName: msg.reporterName,
      receivedAt,
      takenAt,
      gps,
      mediaGroupId: msg.mediaGroupId ?? null,
      sourceMessageId: msg.messageId,
      textNote,
    },
  });

  // 用搬檔後的正式路徑寫 photos（與 intake 同序）
  for (let i = 0; i < intake.length; i++) {
    const r = intake[i];
    db.insertPhoto({
      recordId,
      filePath: archive.photos[i].archivedPath,
      uploadType: r.uploadType,
      hasExif: !!(r.exif.takenAt || r.exif.gps),
      exifTakenAt: r.exif.takenAt ?? null,
      exifGpsLat: r.exif.gps?.latitude ?? null,
      exifGpsLng: r.exif.gps?.longitude ?? null,
      bytes: r.bytes,
    });
  }

  // 初始狀態歷程：null → 待確認
  db.insertStatusLog(recordId, null, '待確認', msg.reporterId);

  return { recordNo, recordId, archiveDir: archive.dir };
}
