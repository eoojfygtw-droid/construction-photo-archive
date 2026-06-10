// ============================================================
// photoIntake.ts — 第 2 步：照片下載落檔 + EXIF 解析
// 把訊息夾帶的照片抓回本機暫存區並讀 EXIF。
// 注意：這裡只先落到「暫存區」data/_staging/，正式歸檔結構
//（_inbox / projects/{code}/.../records/{record_no}）在後續步驟（工地判斷後）才做。
// ============================================================
import { mkdir, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { MessageChannelAdapter } from '../../channels/MessageChannelAdapter';
import type { IncomingMessage, IncomingPhoto } from '../../channels/types';
import { logger } from '../../utils/logger';
import { extractExif, type ExifResult } from './exif';

/** 暫存區根目錄（已被 .gitignore 擋；正式歸檔結構後續步驟才建） */
const STAGING_ROOT = join('data', '_staging');

/** 單張照片落檔後的結果 */
export interface IntakeResult {
  filePath: string;
  uploadType: IncomingPhoto['uploadType'];
  bytes: number;
  exif: ExifResult;
}

/**
 * 下載訊息中的所有照片到暫存區並解析 EXIF。
 * 回傳每張的落檔結果（含 EXIF）；無照片則回空陣列。
 */
export async function intakePhotos(
  adapter: MessageChannelAdapter,
  msg: IncomingMessage,
): Promise<IntakeResult[]> {
  if (msg.photos.length === 0) return [];

  const dateStr = toDateStr(msg.date);
  // 暫存路徑：data/_staging/{YYYY-MM-DD}/{messageId}/
  const dir = join(STAGING_ROOT, dateStr, msg.messageId);
  await mkdir(dir, { recursive: true });

  const results: IntakeResult[] = [];
  for (let i = 0; i < msg.photos.length; i++) {
    const photo = msg.photos[i];
    const dl = await adapter.downloadFile(photo.fileId);

    // 副檔名優先用平台端路徑的，退而求其次依 MIME 猜，再不行給 .bin
    const ext =
      extname(dl.remotePath) || extFromMime(photo.mimeType) || '.bin';
    const filePath = join(dir, `${i + 1}${ext}`);
    await writeFile(filePath, dl.buffer);

    // 錄音/音訊沒有 EXIF，直接跳過解析
    const isAudio = photo.uploadType === 'voice' || photo.uploadType === 'audio';
    const exif = isAudio ? {} : await extractExif(dl.buffer);

    logger.info(isAudio ? '錄音已下載' : '照片已下載', {
      檔案: filePath,
      大小KB: Math.round(dl.buffer.length / 1024),
      上傳方式: photo.uploadType,
      ...(isAudio
        ? { 長度秒: photo.durationSec ?? '（未知）' }
        : {
            EXIF拍攝時間: exif.takenAt ?? '（無，可能是 photo 壓縮掉了）',
            EXIF_GPS: exif.gps
              ? `${exif.gps.latitude},${exif.gps.longitude}`
              : '（無）',
          }),
    });

    results.push({
      filePath,
      uploadType: photo.uploadType,
      bytes: dl.buffer.length,
      exif,
    });
  }

  return results;
}

/** unix 秒 → YYYY-MM-DD（本地時區） */
function toDateStr(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 由 MIME 類型推副檔名（document/voice/audio 上傳常帶 mime_type） */
function extFromMime(mime?: string): string {
  if (!mime) return '';
  const map: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/heic': '.heic',
    'image/heif': '.heif',
    'image/webp': '.webp',
    // 錄音/音訊（Telegram 語音訊息為 audio/ogg → .oga）
    'audio/ogg': '.oga',
    'audio/mpeg': '.mp3',
    'audio/mp4': '.m4a',
    'audio/x-m4a': '.m4a',
    'audio/wav': '.wav',
    'audio/x-wav': '.wav',
  };
  return map[mime] ?? '';
}
