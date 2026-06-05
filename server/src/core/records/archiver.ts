// ============================================================
// archiver.ts — 5-2 正式搬檔歸檔（純檔案操作，與 DB 解耦）
// 把照片從 data/_staging/ 搬到正式歸檔目錄，並在該目錄寫：
//   - metadata.json：整筆紀錄結構化資料（含每張照片 EXIF 摘要）
//   - text.txt     ：文字備註（有才寫）
// 目錄規則（與 NEXT_ACTIONS 5-2 一致）：
//   判定到工地 → data/projects/{code}_{name}/{YYYY}/{MM}/{DD}/records/{record_no}/
//   未判定     → data/_inbox/{record_no}/
// 註：整個 data/ 已被 .gitignore 擋（照片/個資/metadata/text 紅線），不進 git。
// ============================================================
import { copyFile, mkdir, rename, rm, rmdir, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { logger } from '../../utils/logger';
import type { IntakeResult } from '../media/photoIntake';

/** 執行期資料根目錄 */
const DATA_ROOT = 'data';

/** 寫入 metadata.json 的紀錄層欄位（檔案操作不依賴 DB，欄位由上層備齊） */
export interface ArchiveMeta {
  channel: string;
  resolveMethod: string;
  reporterId: string;
  reporterName: string | null;
  receivedAt: string;
  takenAt: string | null;
  textNote: string | null;
  gps: { latitude: number; longitude: number } | null;
  mediaGroupId: string | null;
  sourceMessageId: string | null;
}

/** 歸檔輸入 */
export interface ArchiveInput {
  recordNo: string;
  projectCode: string | null;
  projectName: string | null;
  /** 本地收件日期（與 record_no 內 YYYYMMDD 同源，作為歸檔日期分層） */
  yyyy: string;
  mm: string;
  dd: string;
  /** 暫存區的照片落檔結果（與輸出 photos 同序） */
  intake: IntakeResult[];
  meta: ArchiveMeta;
}

/** 單張照片歸檔後的位置（與 input.intake 同序） */
export interface ArchivedPhoto {
  archivedPath: string;
  fileName: string;
}

/** 歸檔結果 */
export interface ArchiveResult {
  /** 紀錄歸檔目錄 */
  dir: string;
  photos: ArchivedPhoto[];
}

/**
 * 把一筆紀錄的照片搬進正式歸檔目錄，寫 metadata.json / text.txt。
 * 搬檔以「盡力而為」：單張搬失敗會保留其暫存路徑（不丟檔），其餘照片照常處理。
 */
export async function archiveRecord(input: ArchiveInput): Promise<ArchiveResult> {
  const dir = recordDir(input);
  await mkdir(dir, { recursive: true });

  // 1) 逐張搬檔（命名：{record_no}-{NN}{ext}，自帶識別，匯出後仍可追溯）
  const photos: ArchivedPhoto[] = [];
  for (let i = 0; i < input.intake.length; i++) {
    const src = input.intake[i].filePath;
    const ext = extname(src) || '.bin';
    const seq = String(i + 1).padStart(2, '0');
    const fileName = `${input.recordNo}-${seq}${ext}`;
    const dest = join(dir, fileName);
    try {
      await moveFile(src, dest);
      photos.push({ archivedPath: dest, fileName });
    } catch (err) {
      // 連 copy 退路都失敗：保留暫存路徑，DB 仍指向真實檔案，避免遺失
      logger.error('搬檔失敗，保留暫存路徑', {
        來源: src,
        目的: dest,
        錯誤: err instanceof Error ? err.message : err,
      });
      photos.push({ archivedPath: src, fileName: basename(src) });
    }
  }

  // 2) metadata.json（紀錄層 + 每張照片 EXIF 摘要）
  const metadata = {
    record_no: input.recordNo,
    project: {
      code: input.projectCode,
      name: input.projectName,
    },
    channel: input.meta.channel,
    resolve_method: input.meta.resolveMethod,
    reporter: {
      id: input.meta.reporterId,
      name: input.meta.reporterName,
    },
    received_at: input.meta.receivedAt, // 收件時間（歸檔日期依據）
    taken_at: input.meta.takenAt, // 代表拍攝時間（第一張有 EXIF 的）
    gps: input.meta.gps,
    media_group_id: input.meta.mediaGroupId,
    source_message_id: input.meta.sourceMessageId,
    text_note: input.meta.textNote,
    photos: input.intake.map((r, i) => ({
      file: photos[i].fileName,
      upload_type: r.uploadType,
      bytes: r.bytes,
      has_exif: !!(r.exif.takenAt || r.exif.gps),
      exif_taken_at: r.exif.takenAt ?? null,
      exif_gps: r.exif.gps ?? null,
    })),
  };
  await writeFile(
    join(dir, 'metadata.json'),
    JSON.stringify(metadata, null, 2),
    'utf8',
  );

  // 3) text.txt（有文字才寫）
  const note = input.meta.textNote?.trim();
  if (note) {
    await writeFile(join(dir, 'text.txt'), `${note}\n`, 'utf8');
  }

  // 4) 清掉已淨空的暫存來源目錄（非空/不存在都忽略）
  await cleanupStagingDirs(input.intake);

  return { dir, photos };
}

/** 重歸檔的單張照片（來源已在歸檔區，非 staging） */
export interface ReassignPhoto {
  photoId: number;
  currentPath: string;
  uploadType: string | null;
  bytes: number | null;
  hasExif: boolean;
  exifTakenAt: string | null;
  exifGps: { latitude: number; longitude: number } | null;
}

/** 重歸檔輸入（改工地：從 _inbox 或舊工地搬到新工地） */
export interface ReassignInput {
  recordNo: string;
  /** 目標工地（改工地一定有 code） */
  targetCode: string;
  targetName: string | null;
  /** 收件日期分層（沿用原 received_at，紀錄日期不變） */
  yyyy: string;
  mm: string;
  dd: string;
  photos: ReassignPhoto[];
  meta: ArchiveMeta;
}

/** 重歸檔結果 */
export interface ReassignResult {
  dir: string;
  /** 每張照片更新後的路徑（搬失敗者維持原路徑）；與 input.photos 同序 */
  photos: { photoId: number; archivedPath: string }[];
}

/**
 * 改工地時把整筆紀錄的照片搬到新工地資料夾，改寫 metadata.json / text.txt，
 * 並清掉舊歸檔目錄。搬檔以盡力而為：單張失敗保留原路徑、且不刪舊目錄（避免遺失）。
 */
export async function reassignArchive(input: ReassignInput): Promise<ReassignResult> {
  const dir = recordDir({
    recordNo: input.recordNo,
    projectCode: input.targetCode,
    projectName: input.targetName,
    yyyy: input.yyyy,
    mm: input.mm,
    dd: input.dd,
  });
  await mkdir(dir, { recursive: true });

  // 舊目錄（用第一張照片所在目錄推定；無照片則無從推定）
  const oldDir =
    input.photos.length > 0 ? dirname(input.photos[0].currentPath) : null;

  let allMoved = true;
  const outPhotos: { photoId: number; archivedPath: string; fileName: string }[] = [];
  for (let i = 0; i < input.photos.length; i++) {
    const p = input.photos[i];
    const ext = extname(p.currentPath) || '.bin';
    const seq = String(i + 1).padStart(2, '0');
    const fileName = `${input.recordNo}-${seq}${ext}`;
    const dest = join(dir, fileName);
    if (dest === p.currentPath) {
      // 已在目標位置（理論上不會，保險）
      outPhotos.push({ photoId: p.photoId, archivedPath: dest, fileName });
      continue;
    }
    try {
      await moveFile(p.currentPath, dest);
      outPhotos.push({ photoId: p.photoId, archivedPath: dest, fileName });
    } catch (err) {
      allMoved = false;
      logger.error('改工地搬檔失敗，保留原路徑', {
        來源: p.currentPath,
        目的: dest,
        錯誤: err instanceof Error ? err.message : err,
      });
      outPhotos.push({
        photoId: p.photoId,
        archivedPath: p.currentPath,
        fileName: basename(p.currentPath),
      });
    }
  }

  // 改寫 metadata.json（工地改為目標工地）
  const metadata = {
    record_no: input.recordNo,
    project: { code: input.targetCode, name: input.targetName },
    channel: input.meta.channel,
    resolve_method: input.meta.resolveMethod,
    reporter: { id: input.meta.reporterId, name: input.meta.reporterName },
    received_at: input.meta.receivedAt,
    taken_at: input.meta.takenAt,
    gps: input.meta.gps,
    media_group_id: input.meta.mediaGroupId,
    source_message_id: input.meta.sourceMessageId,
    text_note: input.meta.textNote,
    photos: input.photos.map((p, i) => ({
      file: outPhotos[i].fileName,
      upload_type: p.uploadType,
      bytes: p.bytes,
      has_exif: p.hasExif,
      exif_taken_at: p.exifTakenAt,
      exif_gps: p.exifGps,
    })),
  };
  await writeFile(
    join(dir, 'metadata.json'),
    JSON.stringify(metadata, null, 2),
    'utf8',
  );

  const note = input.meta.textNote?.trim();
  if (note) {
    await writeFile(join(dir, 'text.txt'), `${note}\n`, 'utf8');
  }

  // 全數搬成功才清掉舊目錄（連同舊 metadata.json/text.txt）；否則保留避免遺失
  if (allMoved && oldDir && oldDir !== dir) {
    await rm(oldDir, { recursive: true, force: true }).catch(() => {
      /* 清不掉舊目錄不致命 */
    });
  }

  return {
    dir,
    photos: outPhotos.map((p) => ({
      photoId: p.photoId,
      archivedPath: p.archivedPath,
    })),
  };
}

/** 歸檔目錄參數 */
interface RecordDirInput {
  recordNo: string;
  projectCode: string | null;
  projectName: string | null;
  yyyy: string;
  mm: string;
  dd: string;
}

/** 依工地判定結果決定歸檔目錄 */
function recordDir(input: RecordDirInput): string {
  if (input.projectCode) {
    const folder = projectFolder(input.projectCode, input.projectName);
    return join(
      DATA_ROOT,
      'projects',
      folder,
      input.yyyy,
      input.mm,
      input.dd,
      'records',
      input.recordNo,
    );
  }
  // 判不出工地 → _inbox 暫存區（不硬猜）
  return join(DATA_ROOT, '_inbox', input.recordNo);
}

/** 工地資料夾名：{code}_{淨化後名稱}；無名稱則只用 code */
function projectFolder(code: string, name: string | null): string {
  const safe = sanitizeName(name ?? '');
  return safe ? `${code}_${safe}` : code;
}

/** 淨化檔名片段：去除 Windows/POSIX 不合法字元與結尾的點/空白 */
function sanitizeName(s: string): string {
  return s
    .replace(/[\\/:*?"<>|]/g, '') // 路徑非法字元
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, ''); // Windows 不允許結尾為點或空白
}

/**
 * 搬檔：先試 rename（同磁碟最快）；跨磁碟（EXDEV）或目的已存在等情況
 * 退回 copy + unlink。任一步都失敗則往上拋，由呼叫端保留暫存路徑。
 */
async function moveFile(src: string, dest: string): Promise<void> {
  try {
    await rename(src, dest);
  } catch {
    await copyFile(src, dest);
    await unlink(src).catch(() => {
      /* 來源刪不掉不致命，僅留下暫存殘檔 */
    });
  }
}

/** 嘗試移除已淨空的暫存來源目錄（best-effort，非空會自然失敗並忽略） */
async function cleanupStagingDirs(intake: IntakeResult[]): Promise<void> {
  const dirs = new Set(intake.map((r) => dirname(r.filePath)));
  for (const d of dirs) {
    await rmdir(d).catch(() => {
      /* 目錄非空或不存在都忽略 */
    });
  }
}
