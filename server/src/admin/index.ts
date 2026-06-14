// ============================================================
// admin/index.ts — V1 管理後台 web
//   slice 5-A1：唯讀瀏覽（列表四篩選 / 詳細頁 / 媒體串流）
//   slice 5-A2：狀態修改＋備註編輯（後台第一個寫入功能）
// 路由：
//   GET  /dashboard            儀表板（工地/狀態/判定方式統計、最近 7 天趨勢、_inbox 警示）
//   GET  /report               報告頁（5-A5：按工地分區、期間下拉、代表照片、列印友善；開會/報告用）
//   GET  /records              紀錄列表（日期 / 工地 / 狀態 / 判定方式 四篩選）
//   GET  /records/{id}         單筆詳細（照片預覽、錄音播放、EXIF、狀態歷程）
//   GET  /media/{photoId}      照片/錄音串流（以 DB photo id 查路徑，不收使用者路徑 → 無路徑穿越）
//   POST /records/{id}/status  改狀態（寫 status_logs，changed_by=後台網頁）
//   POST /records/{id}/note    改文字備註（同步重寫歸檔目錄 metadata.json / text.txt）
//   POST /records/{id}/project 指定/改工地（含 _inbox 人工歸檔；重用 bot 的 applyProjectReassign）
//
// 安全紅線：
//   - 只綁 127.0.0.1（照片與案場資訊不出本機；要遠端看再議，不預設開放）
//   - 讀取一律 readOnly 連線；寫入只開放狀態與備註兩個動作，走與 bot 同一個 Db 類別
//   - POST 擋跨站 Origin（本機後台不接受其他網站的表單觸發）
//
// 用法：
//   npm run admin            # http://127.0.0.1:3300
//   ADMIN_PORT=3456 可換埠
// ============================================================
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { Db } from '../db/index';
import { dirOfRecord, rewriteRecordFiles } from '../core/records/appendFlow';
import { ProjectStore, type Project } from '../core/projects/ProjectStore';
import { applyProjectReassign } from '../core/confirm/siteFlow';

/** 預設 DB 路徑（與 db/index.ts 一致） */
const DEFAULT_DB = join('data', 'app.db');

/** 預設工地清單路徑（與 ProjectStore 一致） */
const DEFAULT_SEED = join('data', 'projects.seed.json');

/** resolve_method → 中文標籤（與 scripts/report.ts 對齊） */
const RESOLVE_LABEL: Record<string, string> = {
  manual_code: '手動代碼',
  photo_gps: '照片 GPS',
  telegram_location: 'TG 位置',
  recent_context: '近期上下文',
  manual_pick: '按鈕選擇',
  unresolved: '判不出',
};

/** 副檔名 → Content-Type（媒體串流用；不在表內回 octet-stream 讓瀏覽器下載） */
const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.oga': 'audio/ogg',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
};

/** 後台可切換的狀態集合（與 bot 流程、report.ts 的已知狀態對齊） */
const ALLOWED_STATUSES = ['待確認', '待改善', '已完成', '已結案'];

/** 後台寫入時記在 status_logs.changed_by 的操作者標示 */
const ADMIN_ACTOR = '後台網頁';

/** 瀏覽器 <img> 能直接顯示的副檔名（HEIC 不在列 → 佔位卡） */
const DISPLAYABLE = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']);
/** 瀏覽器 <audio> 能播放的副檔名 */
const PLAYABLE_AUDIO = new Set(['.oga', '.ogg', '.mp3', '.m4a', '.wav']);

/** 列表一筆（含照片數，不含照片明細） */
interface ListRow {
  id: number;
  recordNo: string;
  projectCode: string | null;
  projectName: string | null;
  resolveMethod: string;
  status: string;
  reporterName: string | null;
  textNote: string | null;
  receivedAt: string;
  photoCount: number;
}

/** 詳細頁的照片/媒體 */
interface MediaRow {
  id: number;
  filePath: string;
  uploadType: string | null;
  hasExif: boolean;
  exifTakenAt: string | null;
  exifGpsLat: number | null;
  exifGpsLng: number | null;
  bytes: number | null;
}

/** 詳細頁的狀態歷程 */
interface StatusLogRow {
  fromStatus: string | null;
  toStatus: string;
  changedBy: string | null;
  changedAt: string;
}

/** 篩選條件（全部可空 = 不過濾） */
interface Filters {
  date: string; // YYYY-MM-DD；空 = 全部日期
  project: string; // 工地代碼；'_inbox' = 判不出；空 = 全部
  status: string;
  method: string;
}

/** ISO → 本機日期 YYYY-MM-DD（歸檔日期以收件時間為準，與 report.ts 同邏輯） */
function localDateStr(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** ISO → 本機 MM/DD HH:MM（列表顯示用） */
function localDateTimeStr(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** HTML 跳脫（回報文字/姓名可能含特殊字元） */
function esc(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 狀態 badge 的 CSS class（與 report.ts 對齊） */
function statusClass(status: string): string {
  if (status === '待確認') return 'st-pending';
  if (status === '待改善') return 'st-fix';
  if (status === '已完成' || status === '已結案') return 'st-done';
  return 'st-other';
}

// ------------------------------------------------------------
// DB 查詢（每請求獨立 readOnly 連線，用完即關）
// ------------------------------------------------------------

/** 開唯讀連線；bot 同時寫入時最多等 2 秒再放棄 */
function openRo(dbPath: string): DatabaseSync {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  db.exec('PRAGMA busy_timeout = 2000;');
  return db;
}

/** 讀全部紀錄（含照片數），新的在前；篩選在 JS 端做（日期需本機時區換算） */
function queryList(dbPath: string, f: Filters): ListRow[] {
  const db = openRo(dbPath);
  try {
    const rows = db
      .prepare(
        `SELECT r.id, r.record_no, r.project_code, r.project_name, r.resolve_method,
                r.status, r.reporter_name, r.text_note, r.received_at,
                (SELECT COUNT(*) FROM photos p WHERE p.record_id = r.id) AS photo_count
           FROM records r ORDER BY r.received_at DESC, r.id DESC`,
      )
      .all() as Record<string, unknown>[];
    return rows
      .map((row) => ({
        id: row.id as number,
        recordNo: row.record_no as string,
        projectCode: (row.project_code as string | null) ?? null,
        projectName: (row.project_name as string | null) ?? null,
        resolveMethod: row.resolve_method as string,
        status: row.status as string,
        reporterName: (row.reporter_name as string | null) ?? null,
        textNote: (row.text_note as string | null) ?? null,
        receivedAt: row.received_at as string,
        photoCount: Number(row.photo_count),
      }))
      .filter((r) => {
        if (f.date && localDateStr(r.receivedAt) !== f.date) return false;
        if (f.project === '_inbox' && r.projectCode) return false;
        if (f.project && f.project !== '_inbox' && r.projectCode !== f.project) return false;
        if (f.status && r.status !== f.status) return false;
        if (f.method && r.resolveMethod !== f.method) return false;
        return true;
      });
  } finally {
    db.close();
  }
}

/** 儀表板統計：全部在 JS 端聚合（日期需本機時區換算；V0 資料量小） */
function queryStats(dbPath: string): {
  total: number;
  inbox: number;
  byProject: { code: string; name: string | null; count: number; lastReceivedAt: string }[];
  byStatus: Map<string, number>;
  byMethod: Map<string, number>;
  byDay: { date: string; count: number }[]; // 最近 7 個自然日（含今天），舊到新
} {
  const db = openRo(dbPath);
  try {
    const rows = db
      .prepare(
        `SELECT project_code, project_name, resolve_method, status, received_at
           FROM records`,
      )
      .all() as Record<string, unknown>[];

    const byProjectMap = new Map<string, { code: string; name: string | null; count: number; lastReceivedAt: string }>();
    const byStatus = new Map<string, number>();
    const byMethod = new Map<string, number>();
    const byDayMap = new Map<string, number>();
    let inbox = 0;

    for (const r of rows) {
      const code = (r.project_code as string | null) ?? null;
      const receivedAt = r.received_at as string;
      if (!code) {
        inbox++;
      } else {
        const cur = byProjectMap.get(code);
        if (!cur) {
          byProjectMap.set(code, {
            code,
            name: (r.project_name as string | null) ?? null,
            count: 1,
            lastReceivedAt: receivedAt,
          });
        } else {
          cur.count++;
          if (receivedAt > cur.lastReceivedAt) cur.lastReceivedAt = receivedAt;
        }
      }
      const st = r.status as string;
      byStatus.set(st, (byStatus.get(st) ?? 0) + 1);
      const m = r.resolve_method as string;
      byMethod.set(m, (byMethod.get(m) ?? 0) + 1);
      const day = localDateStr(receivedAt);
      byDayMap.set(day, (byDayMap.get(day) ?? 0) + 1);
    }

    // 最近 7 個自然日（含今天）；沒紀錄的補 0
    const byDay: { date: string; count: number }[] = [];
    const today = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      const key = localDateStr(d.toISOString());
      byDay.push({ date: key, count: byDayMap.get(key) ?? 0 });
    }

    return {
      total: rows.length,
      inbox,
      byProject: [...byProjectMap.values()].sort((a, b) => b.lastReceivedAt.localeCompare(a.lastReceivedAt)),
      byStatus,
      byMethod,
      byDay,
    };
  } finally {
    db.close();
  }
}

/** 報告頁一個工地（或 _inbox）一塊 */
interface ReportGroup {
  code: string | null; // null = _inbox 判不出
  name: string | null;
  count: number;
  byStatus: Map<string, number>;
  lastReceivedAt: string;
  thumbIds: number[]; // 代表照片的 photo id（可顯示影像、檔案存在；上限見 THUMB_CAP）
}

/** 報告頁資料：指定區間內，按工地聚合 */
interface ReportData {
  preset: string; // 期間下拉目前選的值（today/7d/14d/30d/custom）
  from: string; // YYYY-MM-DD（含）
  to: string; // YYYY-MM-DD（含）
  total: number;
  inbox: number;
  byStatus: Map<string, number>;
  groups: ReportGroup[]; // 工地依筆數多到少；_inbox 排最後
}

/** 每個工地最多挑幾張代表照片 */
const THUMB_CAP = 6;

/**
 * 報告頁查詢：收件日落在 [from, to]（本機日期、含端點）的紀錄，按工地聚合。
 * 代表照片只取「瀏覽器可顯示、且檔案存在」的影像，每工地上限 THUMB_CAP 張。
 */
function queryReport(dbPath: string, preset: string, from: string, to: string): ReportData {
  const db = openRo(dbPath);
  try {
    const recs = db
      .prepare(
        `SELECT id, project_code, project_name, status, received_at FROM records`,
      )
      .all() as Record<string, unknown>[];

    // 收件日換成本機日期再比對區間（與列表/儀表板同邏輯）
    const inRange = recs.filter((r) => {
      const d = localDateStr(r.received_at as string);
      return d >= from && d <= to;
    });
    const recIds = new Set(inRange.map((r) => r.id as number));
    // record id → 工地 key（code 或 '_inbox'），給縮圖歸組用
    const recKey = new Map<number, string>(
      inRange.map((r) => [r.id as number, (r.project_code as string | null) ?? '_inbox']),
    );

    const groupMap = new Map<string, ReportGroup>();
    const byStatus = new Map<string, number>();
    let inbox = 0;
    for (const r of inRange) {
      const code = (r.project_code as string | null) ?? null;
      const key = code ?? '_inbox';
      let g = groupMap.get(key);
      if (!g) {
        g = {
          code,
          name: (r.project_name as string | null) ?? null,
          count: 0,
          byStatus: new Map(),
          lastReceivedAt: r.received_at as string,
          thumbIds: [],
        };
        groupMap.set(key, g);
      }
      g.count++;
      const st = r.status as string;
      g.byStatus.set(st, (g.byStatus.get(st) ?? 0) + 1);
      if ((r.received_at as string) > g.lastReceivedAt) g.lastReceivedAt = r.received_at as string;
      if (!code) inbox++;
      byStatus.set(st, (byStatus.get(st) ?? 0) + 1);
    }

    // 代表照片：只取區間內紀錄、可顯示影像、檔案存在，每組上限 THUMB_CAP
    const photos = db
      .prepare(`SELECT id, record_id, file_path, upload_type FROM photos ORDER BY id`)
      .all() as Record<string, unknown>[];
    for (const p of photos) {
      const rid = p.record_id as number;
      if (!recIds.has(rid)) continue;
      const uploadType = (p.upload_type as string | null) ?? null;
      if (uploadType === 'voice' || uploadType === 'audio') continue;
      const filePath = p.file_path as string;
      const ext = extname(filePath).toLowerCase();
      if (!DISPLAYABLE.has(ext) || !existsSync(filePath)) continue;
      const g = groupMap.get(recKey.get(rid) as string);
      if (g && g.thumbIds.length < THUMB_CAP) g.thumbIds.push(p.id as number);
    }

    const groups = [...groupMap.values()].sort((a, b) => {
      // _inbox 永遠排最後；其餘按筆數多到少
      if (!a.code && b.code) return 1;
      if (a.code && !b.code) return -1;
      return b.count - a.count;
    });

    return { preset, from, to, total: inRange.length, inbox, byStatus, groups };
  } finally {
    db.close();
  }
}

/** 下拉選單選項：紀錄中出現過的工地與狀態（去重） */
function queryFilterOptions(dbPath: string): {
  projects: { code: string; name: string | null }[];
  statuses: string[];
} {
  const db = openRo(dbPath);
  try {
    const projects = (
      db
        .prepare(
          `SELECT DISTINCT project_code AS code, project_name AS name
             FROM records WHERE project_code IS NOT NULL ORDER BY project_code`,
        )
        .all() as Record<string, unknown>[]
    ).map((r) => ({ code: r.code as string, name: (r.name as string | null) ?? null }));
    const statuses = (
      db.prepare(`SELECT DISTINCT status FROM records ORDER BY status`).all() as Record<string, unknown>[]
    ).map((r) => r.status as string);
    return { projects, statuses };
  } finally {
    db.close();
  }
}

/** 單筆完整資料（紀錄 + 媒體 + 狀態歷程）；找不到回 null */
function queryDetail(
  dbPath: string,
  id: number,
): { record: Record<string, unknown>; media: MediaRow[]; logs: StatusLogRow[] } | null {
  const db = openRo(dbPath);
  try {
    const record = db.prepare(`SELECT * FROM records WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    if (!record) return null;
    const media = (
      db
        .prepare(
          `SELECT id, file_path, upload_type, has_exif, exif_taken_at,
                  exif_gps_lat, exif_gps_lng, bytes
             FROM photos WHERE record_id = ? ORDER BY id`,
        )
        .all(id) as Record<string, unknown>[]
    ).map((p) => ({
      id: p.id as number,
      filePath: p.file_path as string,
      uploadType: (p.upload_type as string | null) ?? null,
      hasExif: (p.has_exif as number) === 1,
      exifTakenAt: (p.exif_taken_at as string | null) ?? null,
      exifGpsLat: (p.exif_gps_lat as number | null) ?? null,
      exifGpsLng: (p.exif_gps_lng as number | null) ?? null,
      bytes: (p.bytes as number | null) ?? null,
    }));
    const logs = (
      db
        .prepare(
          `SELECT from_status, to_status, changed_by, changed_at
             FROM status_logs WHERE record_id = ? ORDER BY changed_at, id`,
        )
        .all(id) as Record<string, unknown>[]
    ).map((l) => ({
      fromStatus: (l.from_status as string | null) ?? null,
      toStatus: l.to_status as string,
      changedBy: (l.changed_by as string | null) ?? null,
      changedAt: l.changed_at as string,
    }));
    return { record, media, logs };
  } finally {
    db.close();
  }
}

/** 以 photo id 查檔案路徑（媒體串流用）；找不到回 null */
function queryMediaPath(dbPath: string, photoId: number): string | null {
  const db = openRo(dbPath);
  try {
    const row = db.prepare(`SELECT file_path FROM photos WHERE id = ?`).get(photoId) as
      | { file_path: string }
      | undefined;
    return row?.file_path ?? null;
  } finally {
    db.close();
  }
}

// ------------------------------------------------------------
// HTML 視圖
// ------------------------------------------------------------

/** 共用 CSS（沿用 report.ts 視覺，加上表單/表格樣式） */
const CSS = `
  :root { font-family: "Segoe UI", "Microsoft JhengHei", system-ui, sans-serif; }
  body { margin: 0; background: #f4f5f7; color: #222; }
  header { background: #1f2d3d; color: #fff; padding: 14px 24px; position: sticky; top: 0; z-index: 5; }
  header h1 { margin: 0 0 6px; font-size: 18px; display: flex; align-items: baseline; gap: 16px; flex-wrap: wrap; }
  header h1 a { color: #fff; text-decoration: none; }
  header nav { display: inline-flex; gap: 12px; }
  header nav a { font-size: 13px; font-weight: normal; color: #9fc1ff; }
  .cards { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 18px; }
  .card { background: #fff; border: 1px solid #e3e6ea; border-radius: 8px; padding: 12px 18px; min-width: 110px; }
  .card .num { font-size: 26px; font-weight: 700; }
  .card .lbl { font-size: 12px; color: #666; }
  .card.warn { border-color: #e0a800; background: #fff8e1; }
  .bar { display: inline-block; height: 10px; background: #2d6cdf; border-radius: 3px; vertical-align: middle; }
  table.kv td .muted { color: #999; font-size: 12px; }
  .sum { display: flex; gap: 18px; flex-wrap: wrap; font-size: 13px; }
  .sum b { font-size: 16px; }
  .sum .warn { color: #ffd24d; }
  main { padding: 18px 24px 60px; max-width: 1100px; margin: 0 auto; }
  form.filters { display: flex; gap: 10px; flex-wrap: wrap; align-items: end; background: #fff; border: 1px solid #e3e6ea; border-radius: 8px; padding: 12px 14px; margin-bottom: 16px; }
  form.filters label { display: flex; flex-direction: column; font-size: 12px; color: #555; gap: 4px; }
  form.filters input, form.filters select { padding: 5px 8px; border: 1px solid #ccd2d9; border-radius: 6px; font-size: 13px; min-width: 130px; }
  form.filters button { padding: 6px 16px; border: 0; border-radius: 6px; background: #2d6cdf; color: #fff; font-size: 13px; cursor: pointer; }
  form.filters a.clear { font-size: 12px; color: #777; align-self: center; }
  .rec { background: #fff; border: 1px solid #e3e6ea; border-radius: 8px; padding: 12px 16px; margin: 8px 0; display: block; text-decoration: none; color: inherit; }
  .rec:hover { border-color: #2d6cdf; }
  .rec-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .rno { font-weight: 700; font-family: ui-monospace, "Consolas", monospace; }
  .proj { font-size: 13px; color: #2d6cdf; font-weight: 600; }
  .proj.inbox { color: #b58900; }
  .badge { font-size: 12px; padding: 2px 8px; border-radius: 10px; }
  .rm { background: #eef2f7; color: #41576f; }
  .st-pending { background: #fff3cd; color: #856404; }
  .st-fix { background: #cfe2ff; color: #084298; }
  .st-done { background: #d1e7dd; color: #0f5132; }
  .st-other { background: #e2e3e5; color: #41464b; }
  .cnt { font-size: 12px; color: #777; margin-left: auto; white-space: nowrap; }
  .rec-meta { font-size: 13px; color: #555; margin-top: 4px; }
  .note { font-size: 14px; background: #f8f9fa; border-radius: 6px; padding: 8px 10px; margin: 6px 0; white-space: pre-wrap; }
  .note.empty, .empty { color: #aaa; }
  .empty-day { text-align: center; color: #888; padding: 60px 0; font-size: 15px; }
  table.kv { border-collapse: collapse; background: #fff; border: 1px solid #e3e6ea; border-radius: 8px; width: 100%; font-size: 14px; }
  table.kv th, table.kv td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #eef1f4; vertical-align: top; }
  table.kv th { width: 130px; color: #666; font-weight: 600; white-space: nowrap; }
  .thumbs { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 8px; }
  .thumb { margin: 0; width: 180px; }
  .thumb img { width: 180px; height: 180px; object-fit: cover; border-radius: 6px; border: 1px solid #ddd; background: #000; }
  .thumb figcaption { font-size: 11px; color: #666; word-break: break-all; margin-top: 4px; }
  .thumb .up { color: #2d6cdf; }
  .thumb-placeholder .ph { width: 180px; height: 180px; border-radius: 6px; border: 1px dashed #bbb; background: #fafafa; display: flex; align-items: center; justify-content: center; color: #999; font-size: 12px; text-align: center; padding: 4px; box-sizing: border-box; }
  .thumb-audio { width: 270px; }
  .thumb-audio audio { width: 270px; height: 40px; }
  h2 { font-size: 16px; border-left: 4px solid #2d6cdf; padding-left: 10px; margin-top: 26px; }
  .back { font-size: 13px; }
  .inline-actions { display: inline-flex; gap: 6px; margin-left: 10px; flex-wrap: wrap; }
  .inline-actions button { padding: 3px 10px; font-size: 12px; border: 1px solid #ccd2d9; border-radius: 6px; background: #fff; cursor: pointer; }
  .inline-actions select { padding: 3px 6px; font-size: 12px; border: 1px solid #ccd2d9; border-radius: 6px; }
  .inline-actions button:hover { border-color: #2d6cdf; color: #2d6cdf; }
  .note-form textarea { width: 100%; max-width: 560px; box-sizing: border-box; padding: 6px 8px; border: 1px solid #ccd2d9; border-radius: 6px; font: inherit; font-size: 13px; display: block; }
  .note-form button { margin-top: 6px; padding: 5px 14px; border: 0; border-radius: 6px; background: #2d6cdf; color: #fff; font-size: 13px; cursor: pointer; }
  footer { text-align: center; color: #aaa; font-size: 12px; padding: 20px; }
  /* 報告頁 */
  form.report-ctrl { display: flex; gap: 10px; flex-wrap: wrap; align-items: end; background: #fff; border: 1px solid #e3e6ea; border-radius: 8px; padding: 12px 14px; margin-bottom: 16px; }
  form.report-ctrl label { display: flex; flex-direction: column; font-size: 12px; color: #555; gap: 4px; }
  form.report-ctrl select, form.report-ctrl input { padding: 5px 8px; border: 1px solid #ccd2d9; border-radius: 6px; font-size: 13px; }
  form.report-ctrl button { padding: 6px 16px; border: 0; border-radius: 6px; background: #2d6cdf; color: #fff; font-size: 13px; cursor: pointer; }
  form.report-ctrl .print-btn { background: #41576f; }
  .rpt-proj { background: #fff; border: 1px solid #e3e6ea; border-radius: 8px; padding: 14px 18px; margin: 10px 0; break-inside: avoid; }
  .rpt-proj.inbox { border-color: #e0a800; background: #fff8e1; }
  .rpt-proj h3 { margin: 0 0 8px; font-size: 16px; display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
  .rpt-proj h3 a { color: #1f2d3d; text-decoration: none; }
  .rpt-proj h3 .cnt { font-size: 12px; color: #777; font-weight: normal; margin-left: auto; }
  .rpt-status { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
  .rthumbs { display: flex; gap: 8px; flex-wrap: wrap; }
  .rthumb img { width: 120px; height: 120px; object-fit: cover; border-radius: 6px; border: 1px solid #ddd; background: #000; display: block; }
  .rthumbs-empty { font-size: 12px; color: #aaa; }
  /* 列印 / 存 PDF：藏掉導覽與控制列，背景轉白，每個工地區塊不跨頁切斷 */
  @media print {
    header nav, form.report-ctrl, footer, .back { display: none !important; }
    header { position: static; }
    body { background: #fff; }
    a { color: inherit !important; }
    .rpt-proj { break-inside: avoid; border-color: #ccc; }
  }
`;

/** 包整頁外框 */
function page(title: string, headerSum: string, body: string): string {
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head>
<body>
<header><h1><a href="/records">🗂 工地照片歸檔 — 管理後台</a><nav><a href="/dashboard">儀表板</a><a href="/records">紀錄列表</a><a href="/report">報告</a></nav></h1><div class="sum">${headerSum}</div></header>
<main>${body}</main>
<footer>本機管理後台（5-A4）· 只綁 127.0.0.1 · 讀取唯讀，寫入僅限狀態／備註／指定工地</footer>
</body>
</html>`;
}

/** 列表頁 */
function renderList(
  rows: ListRow[],
  f: Filters,
  options: { projects: { code: string; name: string | null }[]; statuses: string[] },
): string {
  const archived = rows.filter((r) => r.projectCode).length;
  const inbox = rows.length - archived;
  const pending = rows.filter((r) => r.status === '待確認').length;
  const sum = `<span>符合 <b>${rows.length}</b> 筆</span><span>已歸檔 <b>${archived}</b></span><span class="${inbox ? 'warn' : ''}">_inbox <b>${inbox}</b>${inbox ? ' ⚠️' : ''}</span><span>待確認 <b>${pending}</b></span>`;

  const projOpts = [
    `<option value="">（全部工地）</option>`,
    `<option value="_inbox"${f.project === '_inbox' ? ' selected' : ''}>⚠️ _inbox 判不出</option>`,
    ...options.projects.map(
      (p) =>
        `<option value="${esc(p.code)}"${f.project === p.code ? ' selected' : ''}>${esc(p.code)} ${esc(p.name ?? '')}</option>`,
    ),
  ].join('');
  const statusOpts = [
    `<option value="">（全部狀態）</option>`,
    ...options.statuses.map(
      (s) => `<option value="${esc(s)}"${f.status === s ? ' selected' : ''}>${esc(s)}</option>`,
    ),
  ].join('');
  const methodOpts = [
    `<option value="">（全部方式）</option>`,
    ...Object.entries(RESOLVE_LABEL).map(
      ([k, label]) => `<option value="${k}"${f.method === k ? ' selected' : ''}>${label}</option>`,
    ),
  ].join('');

  const filterForm = `
  <form class="filters" method="get" action="/records">
    <label>日期（收件日）<input type="date" name="date" value="${esc(f.date)}"></label>
    <label>工地<select name="project">${projOpts}</select></label>
    <label>狀態<select name="status">${statusOpts}</select></label>
    <label>判定方式<select name="method">${methodOpts}</select></label>
    <button type="submit">篩選</button>
    <a class="clear" href="/records">清除條件</a>
  </form>`;

  const cards = rows
    .map((r) => {
      const proj = r.projectCode
        ? `<span class="proj">${esc(r.projectCode)} ${esc(r.projectName ?? '')}</span>`
        : `<span class="proj inbox">⚠️ _inbox 判不出</span>`;
      const note = r.textNote
        ? `<div class="note">${esc(r.textNote)}</div>`
        : '';
      return `
      <a class="rec" href="/records/${r.id}">
        <div class="rec-head">
          <span class="rno">${esc(r.recordNo)}</span>
          ${proj}
          <span class="badge st ${statusClass(r.status)}">${esc(r.status)}</span>
          <span class="badge rm">${esc(RESOLVE_LABEL[r.resolveMethod] ?? r.resolveMethod)}</span>
          <span class="cnt">${r.photoCount} 件 · ${localDateTimeStr(r.receivedAt)}</span>
        </div>
        <div class="rec-meta">${esc(r.reporterName ?? '（未具名）')}</div>
        ${note}
      </a>`;
    })
    .join('');

  const empty = rows.length === 0 ? `<div class="empty-day">沒有符合條件的紀錄。</div>` : '';
  return page('紀錄列表 — 管理後台', sum, filterForm + cards + empty);
}

/** 儀表板頁 */
function renderDashboard(stats: ReturnType<typeof queryStats>): string {
  const sum = `<span>全部 <b>${stats.total}</b> 筆</span><span class="${stats.inbox ? 'warn' : ''}">_inbox <b>${stats.inbox}</b>${stats.inbox ? ' ⚠️' : ''}</span>`;

  const statusCards = [...stats.byStatus.entries()]
    .map(([st, n]) => `<div class="card"><div class="num">${n}</div><div class="lbl"><span class="badge st ${statusClass(st)}">${esc(st)}</span></div></div>`)
    .join('');
  const cards = `<div class="cards">
    <div class="card"><div class="num">${stats.total}</div><div class="lbl">全部紀錄</div></div>
    <div class="card${stats.inbox ? ' warn' : ''}"><div class="num">${stats.inbox}</div><div class="lbl">⚠️ _inbox 待歸檔</div></div>
    ${statusCards}
  </div>`;

  const maxDay = Math.max(1, ...stats.byDay.map((d) => d.count));
  const dayRows = stats.byDay
    .map(
      (d) =>
        `<tr><th>${esc(d.date)}</th><td><span class="bar" style="width:${Math.round((d.count / maxDay) * 240)}px"></span> ${d.count} 筆 <a class="muted" href="/records?date=${esc(d.date)}">查看</a></td></tr>`,
    )
    .join('');

  const projRows = stats.byProject.length
    ? stats.byProject
        .map(
          (p) =>
            `<tr><th>${esc(p.code)}</th><td><a href="/records?project=${esc(p.code)}">${esc(p.name ?? '')}</a>　${p.count} 筆 <span class="muted">最後收件 ${esc(localDateTimeStr(p.lastReceivedAt))}</span></td></tr>`,
        )
        .join('')
    : '<tr><td class="empty">（尚無已歸檔紀錄）</td></tr>';

  const methodRows = [...stats.byMethod.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(
      ([m, n]) =>
        `<tr><th>${esc(RESOLVE_LABEL[m] ?? m)}</th><td>${n} 筆 <a class="muted" href="/records?method=${esc(m)}">查看</a></td></tr>`,
    )
    .join('');

  const inboxAlert = stats.inbox
    ? `<p class="note">⚠️ 有 <b>${stats.inbox}</b> 筆判不出工地，<a href="/records?project=_inbox">前往人工歸檔</a>。</p>`
    : '';

  const body = `${cards}${inboxAlert}
  <h2>最近 7 天收件</h2><table class="kv">${dayRows}</table>
  <h2>各工地</h2><table class="kv">${projRows}</table>
  <h2>判定方式分布</h2><table class="kv">${methodRows}</table>`;
  return page('儀表板 — 管理後台', sum, body);
}

/** 期間下拉的預設值（值 → 中文 / 往前推幾天；custom 例外） */
const REPORT_PRESETS: { value: string; label: string; days: number }[] = [
  { value: 'today', label: '今天', days: 0 },
  { value: '7d', label: '近 7 天', days: 6 },
  { value: '14d', label: '近 14 天', days: 13 },
  { value: '30d', label: '近 30 天', days: 29 },
];

/** 由 preset 與 from/to 算出實際區間（本機日期字串，含端點）；非 custom 以今天回推 */
function resolveReportRange(
  preset: string,
  fromIn: string,
  toIn: string,
): { preset: string; from: string; to: string } {
  const today = new Date();
  const todayStr = localDateStr(today.toISOString());
  const shift = (days: number) =>
    localDateStr(new Date(today.getFullYear(), today.getMonth(), today.getDate() - days).toISOString());
  const found = REPORT_PRESETS.find((p) => p.value === preset);
  if (preset === 'custom') {
    // 自訂：缺值時退回近 7 天
    return { preset: 'custom', from: fromIn || shift(6), to: toIn || todayStr };
  }
  const days = found ? found.days : 6; // 預設近 7 天
  return { preset: found ? preset : '7d', to: todayStr, from: shift(days) };
}

/** 報告頁（按工地分區 + 代表照片 + 列印友善）：開會 / 跟老闆報告用 */
function renderReport(data: ReportData): string {
  const fixCount = data.byStatus.get('待改善') ?? 0;
  const sum = `<span>期間 <b>${esc(data.from)} ~ ${esc(data.to)}</b></span><span>共 <b>${data.total}</b> 筆</span><span class="${fixCount ? 'warn' : ''}">待改善 <b>${fixCount}</b></span><span class="${data.inbox ? 'warn' : ''}">_inbox <b>${data.inbox}</b>${data.inbox ? ' ⚠️' : ''}</span>`;

  const presetOpts = [
    ...REPORT_PRESETS.map(
      (p) => `<option value="${p.value}"${data.preset === p.value ? ' selected' : ''}>${p.label}</option>`,
    ),
    `<option value="custom"${data.preset === 'custom' ? ' selected' : ''}>自訂區間</option>`,
  ].join('');

  // 期間切換 + 列印按鈕（列印時整條隱藏）；改日期會自動把 preset 切成「自訂」
  const ctrl = `
  <form class="report-ctrl noprint" method="get" action="/report">
    <label>期間<select name="preset">${presetOpts}</select></label>
    <label>起<input type="date" name="from" value="${esc(data.from)}" oninput="this.form.preset.value='custom'"></label>
    <label>迄<input type="date" name="to" value="${esc(data.to)}" oninput="this.form.preset.value='custom'"></label>
    <button type="submit">套用</button>
    <button type="button" class="print-btn" onclick="window.print()">🖨 列印 / 存 PDF</button>
  </form>`;

  if (data.total === 0) {
    return page('報告 — 管理後台', sum, ctrl + `<div class="empty-day">這段期間（${esc(data.from)} ~ ${esc(data.to)}）沒有任何紀錄。</div>`);
  }

  const sections = data.groups
    .map((g) => {
      const isInbox = !g.code;
      const title = isInbox
        ? '⚠️ _inbox 判不出（待歸檔）'
        : `${esc(g.code)} ${esc(g.name ?? '')}`;
      const href = isInbox ? '/records?project=_inbox' : `/records?project=${esc(g.code)}`;
      // 狀態分布依固定順序排（待確認→待改善→已完成→已結案），其餘殿後
      const statusBits = [...g.byStatus.entries()]
        .sort((a, b) => {
          const ia = ALLOWED_STATUSES.indexOf(a[0]);
          const ib = ALLOWED_STATUSES.indexOf(b[0]);
          return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
        })
        .map(([st, n]) => `<span class="badge st ${statusClass(st)}">${esc(st)} ${n}</span>`)
        .join('');
      const thumbs = g.thumbIds.length
        ? `<div class="rthumbs">${g.thumbIds
            .map(
              (id) =>
                `<a class="rthumb" href="/media/${id}" target="_blank" rel="noopener"><img src="/media/${id}" loading="lazy" alt="代表照片"></a>`,
            )
            .join('')}</div>`
        : '<div class="rthumbs-empty">（此區間無可預覽照片）</div>';
      return `<section class="rpt-proj${isInbox ? ' inbox' : ''}">
        <h3><a href="${href}">${title}</a><span class="cnt">${g.count} 筆 · 最後 ${esc(localDateTimeStr(g.lastReceivedAt))}</span></h3>
        <div class="rpt-status">${statusBits}</div>
        ${thumbs}
      </section>`;
    })
    .join('');

  return page('報告 — 管理後台', sum, ctrl + sections);
}

/** 詳細頁的單件媒體（照片 <img>、錄音 <audio>、其他佔位卡；來源一律走 /media/{id}） */
function mediaCell(m: MediaRow): string {
  const ext = extname(m.filePath).toLowerCase();
  const fileName = m.filePath.split(/[\\/]/).pop() ?? m.filePath;
  const badge =
    m.uploadType === 'voice' || m.uploadType === 'audio'
      ? '🎤 錄音'
      : m.uploadType === 'document'
        ? '📄 文件'
        : '🖼 照片';
  const exifInfo = m.hasExif
    ? ` · EXIF ${m.exifTakenAt ? esc(localDateTimeStr(m.exifTakenAt)) : ''}${m.exifGpsLat != null ? ' 📍' : ''}`
    : '';
  const caption = `<figcaption>${esc(fileName)}<br><span class="up">${badge}</span>${exifInfo}</figcaption>`;
  const exists = existsSync(m.filePath);
  if (exists && (m.uploadType === 'voice' || m.uploadType === 'audio') && PLAYABLE_AUDIO.has(ext)) {
    return `<figure class="thumb thumb-audio"><audio controls preload="none" src="/media/${m.id}"></audio>${caption}</figure>`;
  }
  if (exists && DISPLAYABLE.has(ext)) {
    return `<figure class="thumb"><img src="/media/${m.id}" alt="${esc(fileName)}" loading="lazy">${caption}</figure>`;
  }
  const note = exists ? ext.replace('.', '').toUpperCase() + ' 無法預覽' : '⚠️ 檔案不存在';
  return `<figure class="thumb thumb-placeholder"><div class="ph">${esc(note)}</div>${caption}</figure>`;
}

/** 詳細頁 */
function renderDetail(
  record: Record<string, unknown>,
  media: MediaRow[],
  logs: StatusLogRow[],
  activeProjects: Project[],
): string {
  const id = record.id as number;
  const recordNo = record.record_no as string;
  const status = record.status as string;
  const projectCode = (record.project_code as string | null) ?? null;
  const proj = projectCode
    ? `${esc(projectCode)} ${esc((record.project_name as string | null) ?? '')}`
    : '⚠️ _inbox 判不出';
  const method = record.resolve_method as string;
  const gps =
    record.gps_lat != null ? `${record.gps_lat}, ${record.gps_lng}` : '（無）';
  const sum = `<span class="back"><a href="javascript:history.back()" style="color:#9fc1ff">← 回列表</a></span>`;

  const kv = `
  <table class="kv">
    <tr><th>紀錄編號</th><td><b>${esc(recordNo)}</b></td></tr>
    <tr><th>工地</th><td>${proj}${
      activeProjects.length
        ? `<form class="inline-actions" method="post" action="/records/${id}/project" onsubmit="return confirm('確定要把這筆紀錄重歸檔到選定的工地？照片會搬到新工地資料夾。')"><select name="code">${activeProjects
            .map(
              (p) =>
                `<option value="${esc(p.code)}"${p.code === projectCode ? ' selected' : ''}>${esc(p.code)} ${esc(p.name)}</option>`,
            )
            .join('')}</select><button type="submit">${projectCode ? '改工地' : '指定工地（人工歸檔）'}</button></form>`
        : ''
    }</td></tr>
    <tr><th>狀態</th><td><span class="badge st ${statusClass(status)}">${esc(status)}</span><form class="inline-actions" method="post" action="/records/${id}/status">${ALLOWED_STATUSES.filter((s) => s !== status)
      .map((s) => `<button type="submit" name="to" value="${esc(s)}">改為 ${esc(s)}</button>`)
      .join('')}</form></td></tr>
    <tr><th>判定方式</th><td>${esc(RESOLVE_LABEL[method] ?? method)}</td></tr>
    <tr><th>回報人</th><td>${esc((record.reporter_name as string | null) ?? '（未具名）')}</td></tr>
    <tr><th>收件時間</th><td>${esc(localDateTimeStr(record.received_at as string))}（歸檔日期依據）</td></tr>
    <tr><th>拍攝時間</th><td>${record.taken_at ? esc(localDateTimeStr(record.taken_at as string)) : '（無 EXIF）'}</td></tr>
    <tr><th>GPS</th><td>${esc(gps)}</td></tr>
    <tr><th>文字備註</th><td><form class="note-form" method="post" action="/records/${id}/note"><textarea name="note" rows="3" placeholder="（無備註）">${esc((record.text_note as string | null) ?? '')}</textarea><button type="submit">儲存備註</button></form>儲存會同步重寫歸檔目錄的 metadata.json / text.txt</td></tr>
    <tr><th>來源</th><td>${esc(record.channel as string)}${record.media_group_id ? '（相簿合併）' : ''}</td></tr>
  </table>`;

  const thumbs = media.length
    ? `<div class="thumbs">${media.map(mediaCell).join('')}</div>`
    : '<p class="empty">（無媒體檔案）</p>';

  const logRows = logs.length
    ? logs
        .map(
          (l) =>
            `<tr><th>${esc(localDateTimeStr(l.changedAt))}</th><td>${esc(l.fromStatus ?? '（建檔）')} → <b>${esc(l.toStatus)}</b>${l.changedBy ? `　由 ${esc(l.changedBy)}` : ''}</td></tr>`,
        )
        .join('')
    : '<tr><td class="empty">（尚無狀態異動）</td></tr>';

  const body = `${kv}
  <h2>媒體（${media.length} 件）</h2>${thumbs}
  <h2>狀態歷程</h2><table class="kv">${logRows}</table>`;
  return page(`${recordNo} — 管理後台`, sum, body);
}

// ------------------------------------------------------------
// HTTP 伺服器
// ------------------------------------------------------------

/** 回 HTML */
function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

/** 回純文字錯誤 */
function sendText(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

/** 讀取 POST 表單內容（application/x-www-form-urlencoded） */
async function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

/** 建立後台伺服器（不自動 listen；smoke 測試可掛任意埠、用暫存工地清單） */
export function createAdminServer(opts?: { dbPath?: string; seedPath?: string }): Server {
  const dbPath = opts?.dbPath ?? DEFAULT_DB;
  const seedPath = opts?.seedPath ?? DEFAULT_SEED;

  // 工地清單：依 seed 檔 mtime 快取（bot /新增工地 寫入後自動重載；避免每個請求都重讀＋寫 log）
  let projCache: { mtime: number; store: ProjectStore } | null = null;
  const getProjects = async (): Promise<ProjectStore> => {
    const mtime = existsSync(seedPath) ? statSync(seedPath).mtimeMs : 0;
    if (!projCache || projCache.mtime !== mtime) {
      const store = new ProjectStore(seedPath);
      await store.load();
      projCache = { mtime, store };
    }
    return projCache.store;
  };

  // 寫入用 Db（與 bot 同一個類別，含 busy_timeout）：第一次寫入才開，整個伺服器共用一條
  let writeDb: Db | null = null;
  const getWriteDb = async (): Promise<Db> => {
    if (!writeDb) {
      const d = new Db(dbPath);
      await d.init();
      writeDb = d;
    }
    return writeDb;
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const path = url.pathname;

      // ---- 寫入路由（5-A2：只有狀態與備註兩個動作）----
      if (req.method === 'POST') {
        // 同源防護：本機後台不接受其他網站表單跨站觸發（瀏覽器會帶 Origin）
        const origin = req.headers.origin;
        if (origin && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
          sendText(res, 403, '拒絕跨站請求');
          return;
        }

        // 改狀態：寫 records.status + 一筆 status_logs
        const mStatus = path.match(/^\/records\/(\d+)\/status$/);
        if (mStatus) {
          const id = Number(mStatus[1]);
          const to = (await readForm(req)).get('to')?.trim() ?? '';
          if (!ALLOWED_STATUSES.includes(to)) {
            sendText(res, 400, `不支援的狀態「${to}」`);
            return;
          }
          const db = await getWriteDb();
          const cur = db.getRecordById(id);
          if (!cur) {
            sendText(res, 404, '找不到這筆紀錄');
            return;
          }
          // 同狀態重送不重複寫歷程（防重新整理重送表單）
          if (cur.status !== to) db.updateStatus(id, to, ADMIN_ACTOR);
          res.writeHead(303, { Location: `/records/${id}` });
          res.end();
          return;
        }

        // 指定/改工地（含 _inbox 人工歸檔）：與 bot ✏️ 改工地走同一個核心
        const mProject = path.match(/^\/records\/(\d+)\/project$/);
        if (mProject) {
          const id = Number(mProject[1]);
          const code = (await readForm(req)).get('code')?.trim() ?? '';
          const projects = await getProjects();
          const proj = projects.findByCode(code);
          if (!proj) {
            sendText(res, 400, `找不到工地代碼「${code}」`);
            return;
          }
          const db = await getWriteDb();
          const result = await applyProjectReassign(db, id, proj, ADMIN_ACTOR);
          if (!result) {
            sendText(res, 404, '找不到這筆紀錄');
            return;
          }
          res.writeHead(303, { Location: `/records/${id}` });
          res.end();
          return;
        }

        // 改備註：更新 DB 並同步重寫歸檔目錄的 metadata.json / text.txt
        const mNote = path.match(/^\/records\/(\d+)\/note$/);
        if (mNote) {
          const id = Number(mNote[1]);
          const note = (await readForm(req)).get('note')?.trim() ?? '';
          const db = await getWriteDb();
          const rec = db.getRecordFull(id);
          if (!rec) {
            sendText(res, 404, '找不到這筆紀錄');
            return;
          }
          db.updateTextNote(id, note || null);
          await rewriteRecordFiles(db, id, dirOfRecord(db, rec));
          res.writeHead(303, { Location: `/records/${id}` });
          res.end();
          return;
        }

        sendText(res, 404, '404 — 路徑不存在');
        return;
      }

      // 首頁 → 儀表板
      if (path === '/' || path === '') {
        res.writeHead(302, { Location: '/dashboard' });
        res.end();
        return;
      }

      // 儀表板
      if (path === '/dashboard') {
        sendHtml(res, 200, renderDashboard(queryStats(dbPath)));
        return;
      }

      // 報告頁（按工地分區 + 代表照片 + 列印友善）
      if (path === '/report') {
        const range = resolveReportRange(
          url.searchParams.get('preset') ?? '7d',
          url.searchParams.get('from') ?? '',
          url.searchParams.get('to') ?? '',
        );
        sendHtml(res, 200, renderReport(queryReport(dbPath, range.preset, range.from, range.to)));
        return;
      }

      // 列表（四篩選）
      if (path === '/records') {
        const f: Filters = {
          date: url.searchParams.get('date') ?? '',
          project: url.searchParams.get('project') ?? '',
          status: url.searchParams.get('status') ?? '',
          method: url.searchParams.get('method') ?? '',
        };
        const rows = queryList(dbPath, f);
        const options = queryFilterOptions(dbPath);
        sendHtml(res, 200, renderList(rows, f, options));
        return;
      }

      // 詳細頁 /records/{id}
      const mDetail = path.match(/^\/records\/(\d+)$/);
      if (mDetail) {
        const detail = queryDetail(dbPath, Number(mDetail[1]));
        if (!detail) {
          sendText(res, 404, '找不到這筆紀錄');
          return;
        }
        sendHtml(res, 200, renderDetail(detail.record, detail.media, detail.logs, (await getProjects()).listActive()));
        return;
      }

      // 媒體串流 /media/{photoId}（路徑一律出自 DB，不收使用者路徑）
      const mMedia = path.match(/^\/media\/(\d+)$/);
      if (mMedia) {
        const filePath = queryMediaPath(dbPath, Number(mMedia[1]));
        if (!filePath || !existsSync(filePath)) {
          sendText(res, 404, '找不到媒體檔案');
          return;
        }
        const ext = extname(filePath).toLowerCase();
        res.writeHead(200, {
          'Content-Type': MIME[ext] ?? 'application/octet-stream',
          'Content-Length': statSync(filePath).size,
        });
        createReadStream(filePath).pipe(res);
        return;
      }

      sendText(res, 404, '404 — 路徑不存在');
    }
  };

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    handle(req, res).catch((err) => {
      sendText(res, 500, `伺服器錯誤：${err instanceof Error ? err.message : String(err)}`);
    });
  });
  // 伺服器關閉時順手關寫入連線（smoke 測試重複起停用）
  server.on('close', () => {
    writeDb?.close();
    writeDb = null;
  });
  return server;
}

/** CLI 進入點（被 smoke-admin 匯入時不自動啟動） */
async function main() {
  const port = Number(process.env.ADMIN_PORT ?? 3300);
  if (!existsSync(DEFAULT_DB)) {
    console.error(`找不到資料庫 ${DEFAULT_DB}。請先啟動 bot 收過訊息再開後台。`);
    process.exit(1);
  }
  const server = createAdminServer();
  // 只綁 127.0.0.1：照片與案場資訊不出本機（紅線）
  server.listen(port, '127.0.0.1', () => {
    console.log(`\n🗂 管理後台（唯讀）已啟動：http://127.0.0.1:${port}/records`);
    console.log(`   只綁本機介面，外部連不進來；Ctrl+C 結束。\n`);
  });
}

import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('管理後台啟動失敗：', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
