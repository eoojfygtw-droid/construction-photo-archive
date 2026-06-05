// ============================================================
// recordWriter.ts — 把一筆就緒的紀錄寫進 SQLite（5-1）
// 產生紀錄編號 → 寫 records → 寫 photos → 寫 status_logs（初始 待確認）。
// 照片 file_path 此片先存 staging 路徑，正式搬檔（_inbox/projects）在 5-2。
// ============================================================
import type { IncomingMessage } from '../../channels/types';
import type { Db } from '../../db';
import type { IntakeResult } from '../media/photoIntake';
import type { ProjectStore } from '../projects/ProjectStore';
import type { ResolveResult } from '../resolve/SiteResolver';

export interface WriteOutcome {
  recordNo: string;
  recordId: number;
}

/** 寫入一筆紀錄與其照片，回傳編號與 id */
export function writeRecord(
  db: Db,
  msg: IncomingMessage,
  intake: IntakeResult[],
  resolution: ResolveResult,
  projectStore: ProjectStore,
): WriteOutcome {
  const now = new Date();
  const receivedAt = now.toISOString(); // 收件時間（歸檔日期依據）
  const yyyymmdd = localYmd(now);

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

  for (const r of intake) {
    db.insertPhoto({
      recordId,
      filePath: r.filePath,
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

  return { recordNo, recordId };
}

/** Date → YYYYMMDD（本地時區，作為收件日期） */
function localYmd(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}
