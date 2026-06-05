// ============================================================
// db/index.ts — SQLite 落地（用 Node 24 內建 node:sqlite）
// 決策：原 HANDOFF 寫 better-sqlite3，但在 Node 24 + Windows 需原生編譯易卡；
//       改用內建 node:sqlite（同步 API，幾乎相容），未來可低成本換回。
// 本片（5-1）只負責「寫入紀錄/照片/狀態歷程」，搬檔歸檔在 5-2。
// ============================================================
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { logger } from '../utils/logger';

/** 資料庫檔路徑（執行期資料，.gitignore 已擋 server/data/） */
const DB_PATH = join('data', 'app.db');

/** Schema（冪等，可重複執行） */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS records (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  record_no         TEXT NOT NULL UNIQUE,        -- {代碼}-{YYYYMMDD}-{NNN} 或 INBOX-...
  channel           TEXT NOT NULL,
  project_code      TEXT,                        -- null = 未歸檔（_inbox）
  project_name      TEXT,
  resolve_method    TEXT NOT NULL,               -- manual_code/photo_gps/telegram_location/recent_context/unresolved
  text_note         TEXT,                        -- 合併後的文字 / caption
  reporter_id       TEXT NOT NULL,
  reporter_name     TEXT,
  source_message_id TEXT,                        -- 代表訊息 id（相簿取第一則）
  media_group_id    TEXT,
  gps_lat           REAL,
  gps_lng           REAL,
  status            TEXT NOT NULL DEFAULT '待確認',
  taken_at          TEXT,                        -- 代表拍攝時間（第一張有 EXIF 的）
  received_at       TEXT NOT NULL,               -- 收件時間（歸檔日期依據）
  created_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS photos (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id     INTEGER NOT NULL,
  file_path     TEXT NOT NULL,                   -- 正式歸檔路徑（5-2 搬檔後；搬檔失敗才退暫存路徑）
  upload_type   TEXT,                            -- photo / document
  has_exif      INTEGER NOT NULL DEFAULT 0,      -- 0/1
  exif_taken_at TEXT,
  exif_gps_lat  REAL,
  exif_gps_lng  REAL,
  bytes         INTEGER,
  phase         TEXT NOT NULL DEFAULT 'before',  -- before/after（V2 改善前後）
  created_at    TEXT NOT NULL,
  FOREIGN KEY (record_id) REFERENCES records(id)
);

CREATE TABLE IF NOT EXISTS status_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id   INTEGER NOT NULL,
  from_status TEXT,
  to_status   TEXT NOT NULL,
  changed_by  TEXT,
  changed_at  TEXT NOT NULL,
  FOREIGN KEY (record_id) REFERENCES records(id)
);
`;

/** 寫入一筆紀錄所需欄位 */
export interface NewRecord {
  channel: string;
  projectCode: string | null;
  projectName: string | null;
  resolveMethod: string;
  textNote: string | null;
  reporterId: string;
  reporterName: string | null;
  sourceMessageId: string | null;
  mediaGroupId: string | null;
  gpsLat: number | null;
  gpsLng: number | null;
  status: string;
  takenAt: string | null;
  receivedAt: string;
}

/** 紀錄重點欄位（人工確認/回覆用） */
export interface RecordBrief {
  recordNo: string;
  status: string;
  projectCode: string | null;
  projectName: string | null;
}

/** 紀錄完整欄位（重歸檔／改工地時重寫 metadata 用） */
export interface RecordFull extends RecordBrief {
  id: number;
  channel: string;
  resolveMethod: string;
  textNote: string | null;
  reporterId: string;
  reporterName: string | null;
  sourceMessageId: string | null;
  mediaGroupId: string | null;
  gpsLat: number | null;
  gpsLng: number | null;
  takenAt: string | null;
  receivedAt: string;
}

/** 照片列（重歸檔搬檔用） */
export interface PhotoRow {
  id: number;
  filePath: string;
  uploadType: string | null;
  hasExif: boolean;
  exifTakenAt: string | null;
  exifGpsLat: number | null;
  exifGpsLng: number | null;
  bytes: number | null;
}

/** 寫入一張照片所需欄位 */
export interface NewPhoto {
  recordId: number;
  filePath: string;
  uploadType: string | null;
  hasExif: boolean;
  exifTakenAt: string | null;
  exifGpsLat: number | null;
  exifGpsLng: number | null;
  bytes: number | null;
  phase?: string;
}

export class Db {
  private db!: DatabaseSync;

  constructor(private readonly path: string = DB_PATH) {}

  /** 開啟資料庫並建表 */
  async init(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const fresh = !existsSync(this.path);
    this.db = new DatabaseSync(this.path);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA);
    logger.info(`SQLite 就緒：${this.path}${fresh ? '（新建）' : ''}`);
  }

  /** 產生紀錄編號 {prefix}-{yyyymmdd}-{NNN}（流水號依當日同前綴筆數 +1） */
  nextRecordNo(prefix: string, yyyymmdd: string): string {
    const like = `${prefix}-${yyyymmdd}-%`;
    const row = this.db
      .prepare('SELECT COUNT(*) AS c FROM records WHERE record_no LIKE ?')
      .get(like) as { c: number };
    const seq = String(row.c + 1).padStart(3, '0');
    return `${prefix}-${yyyymmdd}-${seq}`;
  }

  /** 寫入紀錄，回傳 record id */
  insertRecord(recordNo: string, r: NewRecord): number {
    const info = this.db
      .prepare(
        `INSERT INTO records
          (record_no, channel, project_code, project_name, resolve_method,
           text_note, reporter_id, reporter_name, source_message_id, media_group_id,
           gps_lat, gps_lng, status, taken_at, received_at, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        recordNo,
        r.channel,
        r.projectCode,
        r.projectName,
        r.resolveMethod,
        r.textNote,
        r.reporterId,
        r.reporterName,
        r.sourceMessageId,
        r.mediaGroupId,
        r.gpsLat,
        r.gpsLng,
        r.status,
        r.takenAt,
        r.receivedAt,
        new Date().toISOString(),
      );
    return Number(info.lastInsertRowid);
  }

  /** 寫入一張照片 */
  insertPhoto(p: NewPhoto): void {
    this.db
      .prepare(
        `INSERT INTO photos
          (record_id, file_path, upload_type, has_exif, exif_taken_at,
           exif_gps_lat, exif_gps_lng, bytes, phase, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        p.recordId,
        p.filePath,
        p.uploadType,
        p.hasExif ? 1 : 0,
        p.exifTakenAt,
        p.exifGpsLat,
        p.exifGpsLng,
        p.bytes,
        p.phase ?? 'before',
        new Date().toISOString(),
      );
  }

  /** 依 id 查紀錄重點欄位（人工確認用） */
  getRecordById(id: number): RecordBrief | null {
    const row = this.db
      .prepare(
        `SELECT record_no, status, project_code, project_name
           FROM records WHERE id = ?`,
      )
      .get(id) as
      | {
          record_no: string;
          status: string;
          project_code: string | null;
          project_name: string | null;
        }
      | undefined;
    if (!row) return null;
    return {
      recordNo: row.record_no,
      status: row.status,
      projectCode: row.project_code,
      projectName: row.project_name,
    };
  }

  /** 取完整紀錄（重歸檔／改工地用）；找不到回 null */
  getRecordFull(id: number): RecordFull | null {
    const row = this.db
      .prepare(
        `SELECT id, record_no, status, project_code, project_name, channel,
                resolve_method, text_note, reporter_id, reporter_name,
                source_message_id, media_group_id, gps_lat, gps_lng,
                taken_at, received_at
           FROM records WHERE id = ?`,
      )
      .get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: row.id as number,
      recordNo: row.record_no as string,
      status: row.status as string,
      projectCode: (row.project_code as string | null) ?? null,
      projectName: (row.project_name as string | null) ?? null,
      channel: row.channel as string,
      resolveMethod: row.resolve_method as string,
      textNote: (row.text_note as string | null) ?? null,
      reporterId: row.reporter_id as string,
      reporterName: (row.reporter_name as string | null) ?? null,
      sourceMessageId: (row.source_message_id as string | null) ?? null,
      mediaGroupId: (row.media_group_id as string | null) ?? null,
      gpsLat: (row.gps_lat as number | null) ?? null,
      gpsLng: (row.gps_lng as number | null) ?? null,
      takenAt: (row.taken_at as string | null) ?? null,
      receivedAt: row.received_at as string,
    };
  }

  /** 取某筆紀錄的所有照片（依 id 排序，與當初寫入同序） */
  getPhotos(recordId: number): PhotoRow[] {
    const rows = this.db
      .prepare(
        `SELECT id, file_path, upload_type, has_exif, exif_taken_at,
                exif_gps_lat, exif_gps_lng, bytes
           FROM photos WHERE record_id = ? ORDER BY id`,
      )
      .all(recordId) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as number,
      filePath: r.file_path as string,
      uploadType: (r.upload_type as string | null) ?? null,
      hasExif: (r.has_exif as number) === 1,
      exifTakenAt: (r.exif_taken_at as string | null) ?? null,
      exifGpsLat: (r.exif_gps_lat as number | null) ?? null,
      exifGpsLng: (r.exif_gps_lng as number | null) ?? null,
      bytes: (r.bytes as number | null) ?? null,
    }));
  }

  /** 更新單張照片的歸檔路徑（搬檔後） */
  updatePhotoPath(photoId: number, newPath: string): void {
    this.db
      .prepare('UPDATE photos SET file_path = ? WHERE id = ?')
      .run(newPath, photoId);
  }

  /** 指定/變更紀錄的工地與判定方式（改工地用） */
  setProject(
    id: number,
    code: string | null,
    name: string | null,
    resolveMethod: string,
  ): void {
    this.db
      .prepare(
        `UPDATE records SET project_code = ?, project_name = ?, resolve_method = ?
           WHERE id = ?`,
      )
      .run(code, name, resolveMethod, id);
  }

  /**
   * 更新紀錄狀態並寫一筆狀態歷程。
   * 回傳原狀態；找不到紀錄回 null。
   */
  updateStatus(
    id: number,
    toStatus: string,
    changedBy: string | null,
  ): string | null {
    const cur = this.getRecordById(id);
    if (!cur) return null;
    this.db
      .prepare('UPDATE records SET status = ? WHERE id = ?')
      .run(toStatus, id);
    this.insertStatusLog(id, cur.status, toStatus, changedBy);
    return cur.status;
  }

  /** 寫入狀態異動歷程 */
  insertStatusLog(
    recordId: number,
    fromStatus: string | null,
    toStatus: string,
    changedBy: string | null,
  ): void {
    this.db
      .prepare(
        `INSERT INTO status_logs (record_id, from_status, to_status, changed_by, changed_at)
         VALUES (?,?,?,?,?)`,
      )
      .run(recordId, fromStatus, toStatus, changedBy, new Date().toISOString());
  }

  close(): void {
    this.db.close();
  }
}
