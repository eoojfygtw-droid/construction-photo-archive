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
  file_path     TEXT NOT NULL,                   -- 5-1 先存 staging 路徑，5-2 搬檔後更新
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
