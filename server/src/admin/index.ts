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

/** 報告頁的一張代表照片，帶所屬紀錄的編號、文字註解，以及該筆的錄音（若有，放大層裡播放） */
interface ReportMedia {
  id: number; // 照片 photo id（走 /media/{id} 串流）
  recordNo: string;
  note: string | null; // 該筆的文字註解（放大層顯示）
  audioId: number | null; // 該筆的錄音 photo id（放大層「錄音」鈕播放用）；無則 null
}

/** 報告頁一個工地（或 _inbox）一塊 */
interface ReportGroup {
  code: string | null; // null = _inbox 判不出
  name: string | null;
  count: number;
  byStatus: Map<string, number>;
  lastReceivedAt: string;
  media: ReportMedia[]; // 代表媒體（圖片可放大、錄音可播放；上限見 MEDIA_CAP）
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

/** 每個工地代表照片上限 */
const IMAGE_CAP = 8;

/**
 * 報告頁查詢：收件日落在 [from, to]（本機日期、含端點）的紀錄，按工地聚合。
 * 代表媒體只放「可顯示照片」當縮圖（每工地上限 IMAGE_CAP），每張帶該筆的編號、文字註解，
 * 以及該筆的錄音 id（若有）——錄音不單獨列在報告頁，改在放大層裡按鈕播放。
 */
function queryReport(dbPath: string, preset: string, from: string, to: string): ReportData {
  const db = openRo(dbPath);
  try {
    const recs = db
      .prepare(
        `SELECT id, record_no, project_code, project_name, status, text_note, received_at FROM records`,
      )
      .all() as Record<string, unknown>[];

    // 收件日換成本機日期再比對區間（與列表/儀表板同邏輯）
    const inRange = recs.filter((r) => {
      const d = localDateStr(r.received_at as string);
      return d >= from && d <= to;
    });
    // record id → 該筆中繼（工地 key、編號、文字註解），給媒體歸組與標註用
    const recMeta = new Map<number, { key: string; recordNo: string; note: string | null }>(
      inRange.map((r) => [
        r.id as number,
        {
          key: (r.project_code as string | null) ?? '_inbox',
          recordNo: r.record_no as string,
          note: (r.text_note as string | null) ?? null,
        },
      ]),
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
          media: [],
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

    // 先把每筆的「照片清單」與「第一個錄音」分出來（只取檔案存在、可顯示 / 可播放者）
    const photos = db
      .prepare(`SELECT id, record_id, file_path, upload_type FROM photos ORDER BY id`)
      .all() as Record<string, unknown>[];
    const recImages = new Map<number, number[]>(); // record id → 照片 photo id（依 id 序）
    const recAudio = new Map<number, number>(); // record id → 第一個錄音 photo id
    for (const p of photos) {
      const rid = p.record_id as number;
      if (!recMeta.has(rid)) continue; // 不在區間
      const filePath = p.file_path as string;
      if (!existsSync(filePath)) continue;
      const ext = extname(filePath).toLowerCase();
      const uploadType = (p.upload_type as string | null) ?? null;
      if ((uploadType === 'voice' || uploadType === 'audio') && PLAYABLE_AUDIO.has(ext)) {
        if (!recAudio.has(rid)) recAudio.set(rid, p.id as number); // 一筆只取一個錄音
      } else if (DISPLAYABLE.has(ext)) {
        const arr = recImages.get(rid) ?? [];
        arr.push(p.id as number);
        recImages.set(rid, arr);
      }
      // HEIC / 不支援 → 報告頁不放（詳細頁仍有佔位卡）
    }

    // 代表照片：依紀錄順序填進各工地，每張帶該筆的錄音 id（放大層按鈕播放用），每組上限 IMAGE_CAP
    for (const r of inRange) {
      const rid = r.id as number;
      const meta = recMeta.get(rid);
      const g = meta ? groupMap.get(meta.key) : undefined;
      if (!meta || !g) continue;
      const audioId = recAudio.get(rid) ?? null;
      for (const imgId of recImages.get(rid) ?? []) {
        if (g.media.length >= IMAGE_CAP) break;
        g.media.push({ id: imgId, recordNo: meta.recordNo, note: meta.note, audioId });
      }
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

/** 相機標誌 SVG（導覽列品牌，白線條相機）*/
const MARK_SVG = `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="1.5" y="4.5" width="15" height="11" rx="2" stroke="#fff" stroke-width="1.6"/><circle cx="9" cy="10" r="2.6" stroke="#fff" stroke-width="1.6"/><rect x="6" y="2.2" width="6" height="3" rx="1" fill="#fff"/></svg>`;

/** 警示三角形 SVG（_inbox／待注意，可調大小與顏色）*/
function warnSvg(size = 16, color = 'currentColor'): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" aria-hidden="true" style="vertical-align:-2px"><path d="M8 1.6 15 14H1L8 1.6Z" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/><rect x="7.3" y="6" width="1.4" height="4" rx=".7" fill="${color}"/><circle cx="8" cy="11.6" r=".85" fill="${color}"/></svg>`;
}

/** 狀態 → 設計 token 的 class key（與設計 styles.css 對齊）*/
function statusKey(status: string): string {
  if (status === '待確認') return 'pending';
  if (status === '待改善') return 'fix';
  if (status === '已完成') return 'done';
  if (status === '已結案') return 'closed';
  return 'closed';
}

/** 狀態 badge（小圓點＋文字＋可選計數）；沿用設計的 .badge .dot .n */
function statusBadge(status: string, count?: number): string {
  const n = count != null ? ` <span class="n">${count}</span>` : '';
  return `<span class="badge st-${statusKey(status)}"><span class="dot"></span>${esc(status)}${n}</span>`;
}

/** 判定方式 badge（低調；判不出走琥珀 alarm）*/
function methodBadge(method: string): string {
  const label = RESOLVE_LABEL[method] ?? method;
  const alarm = method === 'unresolved' ? ' alarm' : '';
  return `<span class="mbadge${alarm}">${esc(label)}</span>`;
}

/** 工地標示：正常工地（代碼框＋名稱）或 _inbox 琥珀標 */
function siteTag(code: string | null, name: string | null): string {
  if (!code) return `<span class="inbox-tag">${warnSvg(13)} _inbox 判不出</span>`;
  return `<span class="site-tag"><span class="code mono">${esc(code)}</span><span class="nm">${esc(name ?? '')}</span></span>`;
}

/** 共用 CSS（移植自 Claude Design：工程藍灰＋安全琥珀；設計 token + 四頁版面 + RWD + 列印）*/
const CSS = `
  :root {
    --ink:#1b2733; --ink-2:#46566a; --ink-3:#6c7c8f;
    --line:#d6dde4; --line-2:#e8ecf1;
    --bg:#eceff3; --surface:#fff; --surface-2:#f5f7f9;
    --navy:#2a3c4f; --navy-2:#213140; --navy-line:#3b4f63;
    --accent:#e0851b; --accent-deep:#b5640a; --accent-ink:#8a4e02; --accent-soft:#fbeed3; --accent-line:#f0d39a;
    --st-pending-bg:#fcefce; --st-pending-ink:#8a5b07; --st-pending-dot:#d49413;
    --st-fix-bg:#e2ecf8; --st-fix-ink:#1d5aa6; --st-fix-dot:#2f76cf;
    --st-done-bg:#e0f0e6; --st-done-ink:#1d7a48; --st-done-dot:#2a9d62;
    --st-closed-bg:#e8ecef; --st-closed-ink:#58697a; --st-closed-dot:#8a9aaa;
    --sans:'Noto Sans TC','PingFang TC','Microsoft JhengHei',system-ui,sans-serif;
    --mono:'JetBrains Mono',ui-monospace,'SFMono-Regular',monospace;
    --r-card:8px; --r-sm:6px; --r-badge:5px;
    --shadow-card:0 1px 2px rgba(20,35,50,.05);
    --shadow-hov:0 6px 18px rgba(20,35,50,.12);
    --shadow-pop:0 12px 40px rgba(15,25,38,.30);
    --wrap:1100px;
  }
  * { box-sizing: border-box; }
  html, body { margin:0; background:var(--bg); color:var(--ink); font-family:var(--sans); font-size:16px; line-height:1.55; -webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility; }
  .mono { font-family:var(--mono); font-feature-settings:"tnum" 1; }
  a { color:var(--st-fix-ink); text-decoration:none; }
  a:hover { text-decoration:underline; }
  button { font-family:inherit; }

  /* 導覽列 + 摘要列 */
  .topbar { background:var(--navy); background-image:linear-gradient(90deg,rgba(255,255,255,.025) 1px,transparent 1px),linear-gradient(rgba(255,255,255,.025) 1px,transparent 1px); background-size:40px 40px,40px 40px; color:#eaf0f5; border-bottom:3px solid var(--accent); position:sticky; top:0; z-index:50; }
  .topbar-inner { max-width:var(--wrap); margin:0 auto; padding:14px 24px; display:flex; align-items:center; gap:28px; flex-wrap:wrap; }
  .brand { display:flex; align-items:center; gap:11px; font-size:19px; font-weight:700; letter-spacing:.01em; color:#fff; }
  .brand:hover { text-decoration:none; }
  .brand .mark { width:30px; height:30px; flex:0 0 auto; border-radius:6px; background:var(--accent); display:grid; place-items:center; }
  .brand .mark svg { display:block; }
  .brand .sub { color:#9fb3c4; font-weight:500; font-size:16px; }
  .tabs { display:flex; gap:4px; margin-left:auto; }
  .tab { appearance:none; background:transparent; border:1px solid transparent; color:#b6c6d4; font-size:16px; font-weight:600; padding:7px 16px; border-radius:var(--r-sm); cursor:pointer; white-space:nowrap; transition:background .12s,color .12s; }
  .tab:hover { background:rgba(255,255,255,.07); color:#fff; text-decoration:none; }
  .tab.active { background:rgba(255,255,255,.12); color:#fff; }
  .summary-bar { background:var(--navy-2); border-top:1px solid var(--navy-line); }
  .summary-inner { max-width:var(--wrap); margin:0 auto; padding:9px 24px; display:flex; align-items:center; gap:22px; flex-wrap:wrap; font-size:14.5px; color:#9db0c0; }
  .summary-inner b, .summary-inner .sv { color:#eef3f7; font-weight:700; }
  .summary-inner .warn { color:var(--accent); font-weight:700; }
  .summary-inner a { color:#9fc1ff; }
  .summary-sep { width:1px; height:15px; background:var(--navy-line); display:inline-block; }

  /* 版面容器 */
  .wrap { max-width:var(--wrap); margin:0 auto; padding:28px 24px 64px; }
  .section-head { display:flex; align-items:baseline; gap:12px; margin:34px 0 14px; }
  .section-head:first-child { margin-top:0; }
  .section-head h2 { font-size:19px; font-weight:700; margin:0; letter-spacing:.01em; padding-left:12px; border-left:4px solid var(--navy); line-height:1.2; }
  .section-head .meta { color:var(--ink-3); font-size:14px; margin-left:auto; }
  .page-title-row { display:flex; align-items:center; gap:14px; margin-bottom:6px; }
  .back-link { display:inline-flex; align-items:center; gap:6px; font-size:15px; font-weight:600; color:var(--ink-2); }
  .back-link:hover { color:var(--navy); text-decoration:none; }

  /* 卡片 */
  .card { background:var(--surface); border:1px solid var(--line); border-radius:var(--r-card); box-shadow:var(--shadow-card); }
  .card-pad { padding:18px 20px; }

  /* 狀態 badge */
  .badge { display:inline-flex; align-items:center; gap:6px; font-size:13.5px; font-weight:700; line-height:1; padding:5px 10px 5px 9px; border-radius:var(--r-badge); white-space:nowrap; border:1px solid transparent; }
  .badge .dot { width:7px; height:7px; border-radius:50%; flex:0 0 auto; }
  .badge .n { font-family:var(--mono); font-weight:700; }
  .st-pending { background:var(--st-pending-bg); color:var(--st-pending-ink); border-color:#f2e2b6; }
  .st-pending .dot { background:var(--st-pending-dot); }
  .st-fix { background:var(--st-fix-bg); color:var(--st-fix-ink); border-color:#cadcf1; }
  .st-fix .dot { background:var(--st-fix-dot); }
  .st-done { background:var(--st-done-bg); color:var(--st-done-ink); border-color:#c4e3d0; }
  .st-done .dot { background:var(--st-done-dot); }
  .st-closed { background:var(--st-closed-bg); color:var(--st-closed-ink); border-color:#d6dde3; }
  .st-closed .dot { background:var(--st-closed-dot); }

  /* 判定方式 badge */
  .mbadge { display:inline-flex; align-items:center; font-size:12.5px; font-weight:600; padding:4px 9px; border-radius:var(--r-badge); background:var(--surface-2); color:var(--ink-3); border:1px solid var(--line-2); white-space:nowrap; }
  .mbadge.alarm { background:var(--accent-soft); color:var(--accent-ink); border-color:var(--accent-line); font-weight:700; }

  /* 工地標示 */
  .site-tag { display:inline-flex; align-items:baseline; gap:7px; white-space:nowrap; }
  .site-tag .code { font-family:var(--mono); font-weight:700; font-size:13.5px; color:var(--ink); background:var(--surface-2); border:1px solid var(--line-2); border-radius:4px; padding:2px 6px; letter-spacing:.02em; }
  .site-tag .nm { font-weight:600; color:var(--ink); }
  .site-tag.inbox .code, .inbox-tag { color:var(--accent-ink); background:var(--accent-soft); border:1px solid var(--accent-line); font-weight:700; }
  .inbox-tag { display:inline-flex; align-items:center; gap:6px; font-family:var(--mono); font-size:13.5px; border-radius:5px; padding:3px 9px; white-space:nowrap; }

  /* 按鈕 */
  .btn { appearance:none; font-size:14.5px; font-weight:600; padding:8px 15px; border-radius:var(--r-sm); border:1px solid var(--line); background:var(--surface); color:var(--ink); cursor:pointer; transition:background .12s,border-color .12s,box-shadow .12s; white-space:nowrap; }
  .btn:hover { background:var(--surface-2); border-color:#c2cbd4; }
  .btn-primary { background:var(--navy); border-color:var(--navy); color:#fff; }
  .btn-primary:hover { background:#233646; border-color:#233646; }
  .btn-accent { background:var(--accent); border-color:var(--accent-deep); color:#fff; }
  .btn-accent:hover { background:var(--accent-deep); }
  .btn-sm { font-size:13.5px; padding:6px 11px; }
  .btn:disabled { opacity:.5; cursor:default; }

  /* 表單控制 */
  .field { display:flex; flex-direction:column; gap:5px; }
  .field > label { font-size:13px; font-weight:700; color:var(--ink-2); }
  .input, select.input, textarea.input { font-family:inherit; font-size:15px; color:var(--ink); background:var(--surface); border:1px solid var(--line); border-radius:var(--r-sm); padding:8px 11px; line-height:1.4; }
  select.input { cursor:pointer; min-width:130px; }
  .input:focus, textarea.input:focus, select.input:focus { outline:none; border-color:var(--accent); box-shadow:0 0 0 3px rgba(224,133,27,.15); }
  textarea.input { resize:vertical; min-height:80px; width:100%; }

  /* 警示橫幅 / 空狀態 */
  .alert-banner { display:flex; align-items:center; gap:12px; background:var(--accent-soft); border:1px solid var(--accent-line); border-left:5px solid var(--accent); border-radius:var(--r-card); padding:14px 18px; color:var(--accent-ink); font-size:15.5px; font-weight:600; }
  .alert-banner .ico { flex:0 0 auto; font-size:18px; line-height:0; }
  .alert-banner a { color:var(--accent-deep); font-weight:700; text-decoration:underline; text-underline-offset:2px; }
  .alert-banner .num { font-family:var(--mono); font-weight:800; }
  .empty-state { text-align:center; color:var(--ink-3); padding:54px 20px; font-size:16px; }
  .empty-state .big { font-size:17px; font-weight:600; color:var(--ink-2); margin-bottom:4px; }

  /* 縮圖 / 佔位卡 / 錄音標 */
  .thumb-sq { position:relative; aspect-ratio:1/1; }
  .thumb-sq img { width:100%; height:100%; object-fit:cover; border-radius:6px; border:1px solid var(--line); background:#1c2731; display:block; }
  .thumb-sq.zoom { cursor:zoom-in; }
  .placeholder-card { aspect-ratio:1/1; border:1px dashed var(--line); border-radius:var(--r-sm); background:repeating-linear-gradient(135deg,#eef1f4 0 9px,#e7ebf0 9px 18px); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px; text-align:center; padding:12px; color:var(--ink-3); }
  .placeholder-card .pc-ico { font-size:22px; opacity:.8; }
  .placeholder-card .pc-t { font-size:12.5px; font-weight:700; color:var(--ink-2); }
  .placeholder-card .pc-n { font-size:11px; font-family:var(--mono); word-break:break-all; max-width:100%; }
  .audio-pip { position:absolute; right:6px; bottom:6px; width:26px; height:26px; border-radius:50%; background:rgba(20,30,40,.82); color:#fff; display:grid; place-items:center; font-size:13px; box-shadow:0 1px 4px rgba(0,0,0,.4); z-index:3; pointer-events:none; }

  /* 儀表板：統計卡片 */
  .stat-row { display:grid; grid-template-columns:repeat(4,1fr); gap:14px; margin-bottom:22px; }
  .stat-card { display:block; background:var(--surface); border:1px solid var(--line); border-radius:var(--r-card); box-shadow:var(--shadow-card); padding:18px 18px 16px; cursor:pointer; color:inherit; transition:box-shadow .14s,border-color .14s,transform .14s; }
  .stat-card:hover { box-shadow:var(--shadow-hov); transform:translateY(-1px); text-decoration:none; }
  .stat-card .num { font-family:var(--mono); font-size:40px; font-weight:700; line-height:1; letter-spacing:-.01em; color:var(--ink); }
  .stat-card .lbl { margin-top:10px; display:flex; align-items:center; gap:8px; font-size:14.5px; color:var(--ink-2); font-weight:600; white-space:nowrap; }
  .stat-card.alarm { background:var(--accent-soft); border-color:var(--accent-line); }
  .stat-card.alarm .num { color:var(--accent-deep); }
  .stat-card.alarm .lbl { color:var(--accent-ink); }
  .stat-card .lbl .badge { padding:3px 8px; font-size:12px; }

  .bars { display:flex; flex-direction:column; }
  .bar-row { display:grid; grid-template-columns:120px 1fr auto; align-items:center; gap:14px; padding:11px 18px; border-bottom:1px solid var(--line-2); }
  .bar-row:last-child { border-bottom:0; }
  .bar-row .d { font-family:var(--mono); font-size:14px; color:var(--ink-2); }
  .bar-track { height:22px; display:flex; align-items:center; gap:10px; }
  .bar-fill { height:22px; border-radius:4px; background:linear-gradient(90deg,#3a5167,#2f76cf); min-width:4px; }
  .bar-row.today .bar-fill { background:linear-gradient(90deg,#c46e0f,var(--accent)); }
  .bar-row .cnt { font-size:14.5px; color:var(--ink); white-space:nowrap; }
  .bar-row .cnt b { font-family:var(--mono); font-weight:700; }
  .bar-row .view { font-size:14px; }

  .list-row { display:grid; grid-template-columns:92px 1fr auto; align-items:center; gap:16px; padding:13px 18px; border-bottom:1px solid var(--line-2); }
  .list-row:last-child { border-bottom:0; }
  .list-row .code { font-family:var(--mono); font-weight:700; font-size:14px; color:var(--ink-2); }
  .list-row .nm { font-weight:600; }
  .list-row .right { display:flex; align-items:center; gap:14px; color:var(--ink-3); font-size:14px; white-space:nowrap; }
  .list-row .right .num { font-family:var(--mono); color:var(--ink); font-weight:700; }
  .list-row.inbox { background:var(--accent-soft); }

  /* 紀錄列表 */
  .filter-bar { display:flex; align-items:flex-end; gap:14px; flex-wrap:wrap; padding:16px 18px; margin-bottom:18px; }
  .filter-bar .actions { display:flex; align-items:center; gap:12px; margin-left:auto; }
  .filter-bar .clear-link { font-size:14px; color:var(--ink-3); }
  .rec-list { display:flex; flex-direction:column; gap:12px; }
  .rec-card { display:block; background:var(--surface); border:1px solid var(--line); border-radius:var(--r-card); box-shadow:var(--shadow-card); padding:15px 18px; cursor:pointer; color:inherit; transition:box-shadow .14s,border-color .14s,transform .14s; }
  .rec-card:hover { box-shadow:var(--shadow-hov); border-color:#c2cbd4; transform:translateY(-1px); text-decoration:none; }
  .rec-card.inbox { border-left:4px solid var(--accent); }
  .rec-line1 { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
  .rec-line1 .rid { font-family:var(--mono); font-weight:700; font-size:15.5px; color:var(--ink); letter-spacing:.01em; }
  .rec-line1 .spacer { flex:1; }
  .rec-line1 .when { color:var(--ink-3); font-size:13.5px; white-space:nowrap; }
  .rec-line1 .when .ct { font-family:var(--mono); color:var(--ink-2); font-weight:700; }
  .rec-line2 { margin-top:8px; color:var(--ink-2); font-size:14px; display:flex; gap:8px; align-items:center; }
  .rec-line2 .reporter { font-weight:600; }
  .rec-note { margin-top:10px; background:var(--surface-2); border:1px solid var(--line-2); border-radius:var(--r-sm); padding:9px 12px; font-size:14px; color:var(--ink-2); white-space:pre-wrap; line-height:1.5; }

  /* 單筆詳細 */
  .kv { background:var(--surface); border:1px solid var(--line); border-radius:var(--r-card); box-shadow:var(--shadow-card); overflow:hidden; }
  .kv-row { display:grid; grid-template-columns:140px 1fr; border-bottom:1px solid var(--line-2); }
  .kv-row:last-child { border-bottom:0; }
  .kv-row > .k { background:var(--surface-2); padding:14px 16px; font-size:14px; font-weight:700; color:var(--ink-2); border-right:1px solid var(--line-2); }
  .kv-row > .v { padding:13px 16px; font-size:15px; display:flex; flex-direction:column; gap:9px; }
  .kv-row > .v .v-main { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .kv-row .rid-big { font-family:var(--mono); font-weight:700; font-size:17px; letter-spacing:.01em; }
  .kv-row .muted { color:var(--ink-3); }
  .inline-actions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
  .inline-actions .lead { font-size:13px; color:var(--ink-3); margin-right:2px; }
  .help-text { font-size:13px; color:var(--ink-3); }
  .media-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:16px; }
  .media-item .thumb-sq, .media-item .placeholder-card { margin-bottom:8px; }
  .media-cap { font-size:12.5px; color:var(--ink-3); line-height:1.5; }
  .media-cap .fn { font-family:var(--mono); color:var(--ink-2); word-break:break-all; display:block; }
  .mk-badge { display:inline-block; margin-top:3px; font-size:11.5px; font-weight:700; color:var(--ink-2); background:var(--surface-2); border:1px solid var(--line-2); border-radius:4px; padding:2px 7px; white-space:nowrap; }
  .media-item audio { width:100%; margin-bottom:6px; }
  .tl-row { display:grid; grid-template-columns:120px 1fr auto; align-items:center; gap:16px; padding:13px 18px; border-bottom:1px solid var(--line-2); font-size:14.5px; }
  .tl-row:last-child { border-bottom:0; }
  .tl-row .tl-when { font-family:var(--mono); font-size:13.5px; color:var(--ink-3); }
  .tl-row .tl-change { color:var(--ink-2); }
  .tl-row .tl-change b { color:var(--ink); }
  .tl-row .tl-by { color:var(--ink-3); font-size:13.5px; white-space:nowrap; }
  .tl-row .tl-by .who { font-family:var(--mono); color:var(--ink-2); }

  /* 報告頁 */
  .report-control { display:flex; align-items:flex-end; gap:14px; flex-wrap:wrap; padding:16px 18px; margin-bottom:22px; }
  .report-control .actions { margin-left:auto; display:flex; gap:10px; }
  .report-section { margin-bottom:22px; break-inside:avoid; }
  .rs-head { display:flex; align-items:baseline; gap:14px; flex-wrap:wrap; padding-bottom:12px; margin-bottom:14px; border-bottom:2px solid var(--navy); }
  .rs-head .rs-title { font-size:20px; font-weight:700; display:flex; align-items:baseline; gap:9px; }
  .rs-head .rs-title .code { font-family:var(--mono); color:var(--navy); }
  .rs-head .rs-meta { margin-left:auto; color:var(--ink-3); font-size:14px; white-space:nowrap; }
  .rs-head .rs-meta .num { font-family:var(--mono); color:var(--ink); font-weight:700; }
  .report-section.inbox .rs-head { border-bottom-color:var(--accent); }
  .rs-badges { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px; }
  .photo-wall { display:grid; grid-template-columns:repeat(auto-fill,minmax(140px,1fr)); gap:12px; }
  .photo-wall .rthumb { position:relative; padding:0; border:0; background:none; cursor:zoom-in; line-height:0; }
  .photo-wall .rthumb img { width:100%; aspect-ratio:1/1; object-fit:cover; border-radius:6px; border:1px solid var(--line); background:#1c2731; display:block; }
  .photo-wall .rthumb:hover img { border-color:var(--accent); }
  .photo-wall .no-photo, .rthumbs-empty { color:var(--ink-3); font-size:14px; padding:8px 2px; }
  .thumb-mic { position:absolute; right:6px; bottom:6px; width:24px; height:24px; border-radius:50%; background:rgba(20,30,40,.82); color:#fff; display:grid; place-items:center; font-size:12px; box-shadow:0 1px 4px rgba(0,0,0,.4); }

  /* lightbox（頁內放大層）*/
  .lb { display:none; position:fixed; inset:0; z-index:200; background:rgba(15,22,30,.82); align-items:center; justify-content:center; padding:32px; }
  .lb.show { display:flex; }
  .lb-box { position:relative; width:min(840px,100%); margin:0; display:flex; flex-direction:column; gap:16px; }
  .lb-box img { width:100%; max-height:min(62vh,560px); object-fit:contain; border-radius:var(--r-card); background:#11181f; }
  #lb-cap { display:flex; flex-direction:column; gap:6px; color:#fff; font-size:24px; line-height:1.4; }
  #lb-cap .lb-id { font-size:18px; color:#ffd89b; font-weight:700; font-family:var(--mono); }
  #lb-audio { width:100%; max-width:420px; }
  .lb-actions { display:flex; gap:10px; }
  .lb-btn { padding:7px 18px; border:1px solid #ffffff66; border-radius:var(--r-sm); background:transparent; color:#fff; font-size:14px; cursor:pointer; }
  .lb-btn:hover { background:#ffffff22; }
  #lb-play { border-color:#7fc4ff; color:#cfe6ff; }
  .lb-close { position:absolute; top:-14px; right:-8px; width:40px; height:40px; border-radius:50%; background:rgba(255,255,255,.12); color:#fff; border:0; font-size:18px; cursor:pointer; z-index:2; }
  .lb-close:hover { background:rgba(255,255,255,.24); }

  footer { text-align:center; color:var(--ink-3); font-size:12.5px; padding:24px; }

  /* RWD（手機單欄）*/
  @media (max-width:720px) {
    html, body { font-size:15.5px; }
    .topbar-inner { gap:12px 18px; padding:12px 16px; }
    .brand { font-size:17px; }
    .brand .sub { display:none; }
    .tabs { margin-left:0; width:100%; }
    .tab { flex:1; text-align:center; padding:9px 6px; }
    .summary-inner { padding:8px 16px; gap:12px; font-size:13px; }
    .wrap { padding:18px 16px 56px; }
    .stat-row { grid-template-columns:repeat(2,1fr); gap:10px; }
    .stat-card .num { font-size:32px; }
    .bar-row { grid-template-columns:86px 1fr; row-gap:4px; padding:10px 14px; }
    .bar-row .view, .bar-row .cnt { grid-column:2; justify-self:start; }
    .bar-track { grid-column:1 / -1; }
    .list-row { grid-template-columns:1fr auto; gap:8px; padding:12px 14px; }
    .filter-bar { flex-direction:column; align-items:stretch; }
    .filter-bar .field, .filter-bar select.input, .filter-bar .input { width:100%; }
    .filter-bar .actions { margin-left:0; justify-content:space-between; }
    .rec-line1 .when { width:100%; order:5; }
    .kv-row { grid-template-columns:1fr; }
    .kv-row > .k { border-right:0; border-bottom:1px solid var(--line-2); padding:10px 14px; }
    .tl-row { grid-template-columns:1fr; gap:4px; padding:12px 14px; }
    .report-control { flex-direction:column; align-items:stretch; }
    .report-control .field, .report-control .input { width:100%; }
    .report-control .actions { margin-left:0; }
    .photo-wall { grid-template-columns:repeat(auto-fill,minmax(108px,1fr)); gap:8px; }
    .lb { padding:16px; }
    #lb-cap { font-size:20px; }
  }

  /* 列印（報告頁存 PDF）*/
  @media print {
    :root { --bg:#fff; }
    html, body { background:#fff; font-size:12pt; }
    .topbar, .summary-bar, .report-control, .lb, .back-link, .print-hide { display:none !important; }
    .wrap { max-width:100%; padding:0; }
    .card, .kv, .rec-card, .stat-card { box-shadow:none; }
    .report-section { break-inside:avoid; page-break-inside:avoid; margin-bottom:16pt; }
    .rs-head { border-bottom:1.5pt solid var(--navy); }
    .photo-wall { grid-template-columns:repeat(4,1fr); gap:8pt; }
    a { color:var(--ink) !important; text-decoration:none; }
  }
`;

/** 包整頁外框（導覽列＋摘要列）；activeTab ∈ dashboard/records/report（''＝不高亮）*/
function page(title: string, activeTab: string, summaryHtml: string, body: string): string {
  const tab = (key: string, label: string, href: string) =>
    `<a class="tab${activeTab === key ? ' active' : ''}" href="${href}">${label}</a>`;
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700;900&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<style>${CSS}</style>
</head>
<body>
<header class="topbar">
  <div class="topbar-inner">
    <a class="brand" href="/dashboard"><span class="mark">${MARK_SVG}</span>工地照片歸檔 <span class="sub">— 管理後台</span></a>
    <nav class="tabs">${tab('dashboard', '儀表板', '/dashboard')}${tab('records', '紀錄列表', '/records')}${tab('report', '報告', '/report')}</nav>
  </div>
  ${summaryHtml ? `<div class="summary-bar"><div class="summary-inner">${summaryHtml}</div></div>` : ''}
</header>
<main class="wrap">${body}</main>
<footer>本機管理後台 · 只綁 127.0.0.1 · 讀取唯讀，寫入僅限狀態／備註／指定工地</footer>
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
  const sep = '<span class="summary-sep"></span>';
  const sum = `<span>符合 <b>${rows.length}</b> 筆</span>${sep}<span>已歸檔 <b>${archived}</b></span>${sep}<span class="${inbox ? 'warn' : ''}">_inbox <b>${inbox}</b>${inbox ? ' ⚠' : ''}</span>${sep}<span>待確認 <b>${pending}</b></span>`;

  const projOpts = [
    `<option value="">全部工地</option>`,
    `<option value="_inbox"${f.project === '_inbox' ? ' selected' : ''}>⚠ _inbox 判不出</option>`,
    ...options.projects.map(
      (p) =>
        `<option value="${esc(p.code)}"${f.project === p.code ? ' selected' : ''}>${esc(p.code)} ${esc(p.name ?? '')}</option>`,
    ),
  ].join('');
  const statusOpts = [
    `<option value="">全部狀態</option>`,
    ...options.statuses.map(
      (s) => `<option value="${esc(s)}"${f.status === s ? ' selected' : ''}>${esc(s)}</option>`,
    ),
  ].join('');
  const methodOpts = [
    `<option value="">全部判定方式</option>`,
    ...Object.entries(RESOLVE_LABEL).map(
      ([k, label]) => `<option value="${k}"${f.method === k ? ' selected' : ''}>${label}</option>`,
    ),
  ].join('');

  const filterForm = `
  <form class="card filter-bar" method="get" action="/records">
    <div class="field"><label>收件日</label><input class="input" type="date" name="date" value="${esc(f.date)}"></div>
    <div class="field"><label>工地</label><select class="input" name="project">${projOpts}</select></div>
    <div class="field"><label>狀態</label><select class="input" name="status">${statusOpts}</select></div>
    <div class="field"><label>判定方式</label><select class="input" name="method">${methodOpts}</select></div>
    <div class="actions">
      <button class="btn btn-primary" type="submit">篩選</button>
      <a class="clear-link" href="/records">清除條件</a>
    </div>
  </form>`;

  const cards = rows
    .map((r) => {
      const note = r.textNote ? `<div class="rec-note">${esc(r.textNote)}</div>` : '';
      return `
      <a class="rec-card${r.projectCode ? '' : ' inbox'}" href="/records/${r.id}">
        <div class="rec-line1">
          <span class="rid">${esc(r.recordNo)}</span>
          ${siteTag(r.projectCode, r.projectName)}
          ${statusBadge(r.status)}
          ${methodBadge(r.resolveMethod)}
          <span class="spacer"></span>
          <span class="when"><span class="ct">${r.photoCount}</span> 件 · ${localDateTimeStr(r.receivedAt)}</span>
        </div>
        <div class="rec-line2"><span class="reporter">${esc(r.reporterName ?? '（未具名）')}</span></div>
        ${note}
      </a>`;
    })
    .join('');

  const list = rows.length
    ? `<div class="rec-list">${cards}</div>`
    : `<div class="card empty-state"><div class="big">沒有符合條件的紀錄。</div><div>試著放寬篩選條件，或 <a href="/records">清除條件</a>。</div></div>`;
  return page('紀錄列表 — 管理後台', 'records', sum, filterForm + list);
}

/** 儀表板頁 */
function renderDashboard(stats: ReturnType<typeof queryStats>): string {
  const sum = `<span>全部 <b>${stats.total}</b> 筆</span><span class="summary-sep"></span><span class="${stats.inbox ? 'warn' : ''}">_inbox <b>${stats.inbox}</b>${stats.inbox ? ' ⚠' : ''}</span>`;
  const today = localDateStr(new Date().toISOString());

  // 總覽兩張卡（全部 / _inbox）
  const topCards = `<div class="stat-row" style="grid-template-columns:1fr 1fr;margin-bottom:14px">
    <a class="stat-card" href="/records"><div class="num">${stats.total}</div><div class="lbl">全部紀錄</div></a>
    <a class="stat-card${stats.inbox ? ' alarm' : ''}" href="/records?project=_inbox"><div class="num">${stats.inbox}</div><div class="lbl">${warnSvg(15)} _inbox 待歸檔</div></a>
  </div>`;

  // 各狀態卡（固定四種順序，0 也顯示，方便一眼掃）
  const statusCards = `<div class="stat-row">${ALLOWED_STATUSES.map(
    (st) =>
      `<a class="stat-card" href="/records?status=${encodeURIComponent(st)}"><div class="num">${stats.byStatus.get(st) ?? 0}</div><div class="lbl">${statusBadge(st)}</div></a>`,
  ).join('')}</div>`;

  const inboxAlert = stats.inbox
    ? `<div class="alert-banner" style="margin-top:8px"><span class="ico">${warnSvg(18, 'var(--accent-deep)')}</span><span>有 <span class="num">${stats.inbox}</span> 筆判不出工地，<a href="/records?project=_inbox">前往人工歸檔 →</a></span></div>`
    : '';

  // 最近 7 天長條
  const maxDay = Math.max(1, ...stats.byDay.map((d) => d.count));
  const dayRows = stats.byDay
    .map(
      (d) =>
        `<div class="bar-row${d.date === today ? ' today' : ''}"><span class="d">${esc(d.date)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(6, Math.round((d.count / maxDay) * 100))}%"></div></div><span class="cnt"><b>${d.count}</b> 筆 <a class="view" href="/records?date=${esc(d.date)}">查看</a></span></div>`,
    )
    .join('');

  // 各工地
  const projRows = stats.byProject.length
    ? stats.byProject
        .map(
          (p) =>
            `<div class="list-row"><span class="code">${esc(p.code)}</span><a class="nm" href="/records?project=${esc(p.code)}">${esc(p.name ?? '')}</a><span class="right"><span><span class="num">${p.count}</span> 筆</span><span>最後收件 ${esc(localDateTimeStr(p.lastReceivedAt))}</span></span></div>`,
        )
        .join('')
    : '<div class="list-row"><span class="muted">（尚無已歸檔紀錄）</span></div>';

  // 判定方式分布
  const methodRows = [...stats.byMethod.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(
      ([m, n]) =>
        `<div class="list-row" style="grid-template-columns:1fr auto"><span>${methodBadge(m)}</span><span class="right"><span><span class="num">${n}</span> 筆</span><a class="view" href="/records?method=${esc(m)}">查看</a></span></div>`,
    )
    .join('');

  const body = `${topCards}${statusCards}${inboxAlert}
  <div class="section-head"><h2>最近 7 天收件</h2></div>
  <div class="card"><div class="bars">${dayRows}</div></div>
  <div class="section-head"><h2>各工地</h2></div>
  <div class="card">${projRows}</div>
  <div class="section-head"><h2>判定方式分布</h2></div>
  <div class="card">${methodRows}</div>`;
  return page('儀表板 — 管理後台', 'dashboard', sum, body);
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
  const sep = '<span class="summary-sep"></span>';
  const sum = `<span>期間 <b class="mono">${esc(data.from)} ~ ${esc(data.to)}</b></span>${sep}<span>共 <b>${data.total}</b> 筆</span>${sep}<span class="${fixCount ? 'warn' : ''}">待改善 <b>${fixCount}</b></span>${sep}<span class="${data.inbox ? 'warn' : ''}">_inbox <b>${data.inbox}</b>${data.inbox ? ' ⚠' : ''}</span>`;

  const presetOpts = [
    ...REPORT_PRESETS.map(
      (p) => `<option value="${p.value}"${data.preset === p.value ? ' selected' : ''}>${p.label}</option>`,
    ),
    `<option value="custom"${data.preset === 'custom' ? ' selected' : ''}>自訂區間</option>`,
  ].join('');

  // 期間切換 + 列印按鈕（列印時整條隱藏）；改日期會自動把 preset 切成「自訂」
  const ctrl = `
  <form class="card report-control print-hide" method="get" action="/report">
    <div class="field"><label>期間</label><select class="input" name="preset">${presetOpts}</select></div>
    <div class="field"><label>起</label><input class="input" type="date" name="from" value="${esc(data.from)}" oninput="this.form.preset.value='custom'"></div>
    <div class="field"><label>迄</label><input class="input" type="date" name="to" value="${esc(data.to)}" oninput="this.form.preset.value='custom'"></div>
    <div class="actions">
      <button class="btn btn-primary" type="submit">套用</button>
      <button class="btn" type="button" onclick="window.print()">🖨 列印 / 存 PDF</button>
    </div>
  </form>`;

  if (data.total === 0) {
    return page('報告 — 管理後台', 'report', sum, ctrl + `<div class="card empty-state"><div class="big">這段期間（${esc(data.from)} ~ ${esc(data.to)}）沒有任何紀錄。</div></div>`);
  }

  const sections = data.groups
    .map((g) => {
      const isInbox = !g.code;
      const href = isInbox ? '/records?project=_inbox' : `/records?project=${esc(g.code)}`;
      const titleInner = isInbox
        ? `<span class="inbox-tag" style="font-size:16px">${warnSvg(15)} _inbox 判不出（待歸檔）</span>`
        : `<span class="code">${esc(g.code)}</span><span>${esc(g.name ?? '')}</span>`;
      // 狀態分布依固定順序排（待確認→待改善→已完成→已結案），其餘殿後
      const statusBits = [...g.byStatus.entries()]
        .sort((a, b) => {
          const ia = ALLOWED_STATUSES.indexOf(a[0]);
          const ib = ALLOWED_STATUSES.indexOf(b[0]);
          return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
        })
        .map(([st, n]) => statusBadge(st, n))
        .join('');
      // 縮圖只放照片；點擊開放大層。該筆若有錄音，縮圖右下角標 🎤、並帶 data-audio
      // 供放大層的「錄音」鈕播放（錄音本身不出現在報告頁）。
      const mediaHtml = g.media
        .map((m) => {
          const audioAttr = m.audioId != null ? ` data-audio="/media/${m.audioId}"` : '';
          const mic = m.audioId != null ? '<span class="thumb-mic" title="此照片所屬紀錄有錄音">🎤</span>' : '';
          return `<button type="button" class="rthumb" data-img="/media/${m.id}"${audioAttr} data-rno="${esc(m.recordNo)}" data-note="${esc(m.note)}" onclick="openLb(this)"><img src="/media/${m.id}" loading="lazy" alt="代表照片">${mic}</button>`;
        })
        .join('');
      const media = g.media.length
        ? `<div class="photo-wall">${mediaHtml}</div>`
        : '<div class="rthumbs-empty">（此區間無可預覽照片）</div>';
      return `<section class="report-section${isInbox ? ' inbox' : ''}">
        <div class="rs-head"><a class="rs-title" href="${href}">${titleInner}</a><span class="rs-meta"><span class="num">${g.count}</span> 筆 · 最後 ${esc(localDateTimeStr(g.lastReceivedAt))}</span></div>
        <div class="rs-badges">${statusBits}</div>
        ${media}
      </section>`;
    })
    .join('');

  // 頁內放大層（lightbox）：點縮圖把大圖／錄音播放器＋編號＋文字註解放上來；
  // 點背景任一處（或 Esc / 關閉）收起，可再點下一張。框內 stopPropagation，
  // 避免點到圖或操作播放器時誤關。錄音在這一層裡播放（不內嵌在報告頁）。
  const lightbox = `
  <div id="lb" class="lb" onclick="closeLb()">
    <figure class="lb-box" onclick="event.stopPropagation()">
      <img id="lb-img" alt="放大照片">
      <figcaption id="lb-cap"></figcaption>
      <audio id="lb-audio" controls preload="none" style="display:none"></audio>
      <div class="lb-actions">
        <button type="button" id="lb-play" class="lb-btn" onclick="playLbAudio()" style="display:none">🎤 播放錄音</button>
        <button type="button" class="lb-btn" onclick="closeLb()">關閉 ✕</button>
      </div>
    </figure>
  </div>
  <script>
    function openLb(el){
      var lb=document.getElementById('lb');
      document.getElementById('lb-img').src=el.getAttribute('data-img');
      var rno=el.getAttribute('data-rno')||'';
      var note=el.getAttribute('data-note')||'';
      document.getElementById('lb-cap').textContent=note?(rno+'　'+note):rno;
      // 該照片所屬紀錄若有錄音 → 顯示「播放錄音」鈕（先備好來源，按了才播）
      var aud=document.getElementById('lb-audio');
      var playBtn=document.getElementById('lb-play');
      aud.pause(); aud.style.display='none';
      var audioSrc=el.getAttribute('data-audio');
      if(audioSrc){ aud.src=audioSrc; playBtn.style.display=''; }
      else{ aud.removeAttribute('src'); playBtn.style.display='none'; }
      lb.classList.add('show');
    }
    function playLbAudio(){
      var aud=document.getElementById('lb-audio');
      aud.style.display='block';                       // 顯示播放器供暫停/拖曳
      document.getElementById('lb-play').style.display='none';
      try{ aud.currentTime=0; aud.play(); }catch(e){}
    }
    function closeLb(){
      document.getElementById('lb').classList.remove('show');
      document.getElementById('lb-img').removeAttribute('src');
      var aud=document.getElementById('lb-audio'); aud.pause(); aud.removeAttribute('src'); aud.style.display='none';
    }
    document.addEventListener('keydown',function(e){if(e.key==='Escape')closeLb();});
  </script>`;

  return page('報告 — 管理後台', 'report', sum, ctrl + sections + lightbox);
}

/** 詳細頁的單件媒體（照片 <img>、錄音 <audio>、其他佔位卡；來源一律走 /media/{id}） */
function mediaCell(m: MediaRow): string {
  const ext = extname(m.filePath).toLowerCase();
  const fileName = m.filePath.split(/[\\/]/).pop() ?? m.filePath;
  const isAudio = m.uploadType === 'voice' || m.uploadType === 'audio';
  const kindBadge = isAudio ? '🎤 錄音' : m.uploadType === 'document' ? '📄 文件' : '🖼 照片';
  const exifInfo = m.hasExif
    ? ` · ${m.exifTakenAt ? esc(localDateTimeStr(m.exifTakenAt)) : 'EXIF'}${m.exifGpsLat != null ? ' 📍' : ''}`
    : '';
  const cap = `<div class="media-cap"><span class="fn">${esc(fileName)}</span> <span class="mk-badge">${kindBadge}</span>${exifInfo}</div>`;
  const exists = existsSync(m.filePath);
  let visual: string;
  if (exists && isAudio && PLAYABLE_AUDIO.has(ext)) {
    visual = `<audio controls preload="none" src="/media/${m.id}"></audio>`;
  } else if (exists && DISPLAYABLE.has(ext)) {
    visual = `<div class="thumb-sq"><img src="/media/${m.id}" alt="${esc(fileName)}" loading="lazy"></div>`;
  } else {
    const isHeic = ext === '.heic' || ext === '.heif';
    const t = !exists ? '⚠️ 檔案不存在' : isHeic ? 'HEIC 無法預覽' : `${ext.replace('.', '').toUpperCase()} 無法預覽`;
    const ico = isAudio ? '🎤' : m.uploadType === 'document' ? '📄' : '🖼';
    visual = `<div class="placeholder-card"><div class="pc-ico">${ico}</div><div class="pc-t">${esc(t)}</div></div>`;
  }
  return `<div class="media-item">${visual}${cap}</div>`;
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
  const projectName = (record.project_name as string | null) ?? null;
  const method = record.resolve_method as string;
  const gps = record.gps_lat != null ? `${record.gps_lat}, ${record.gps_lng}` : null;
  const sep = '<span class="summary-sep"></span>';
  const sum = `<span>紀錄 <b class="mono">${esc(recordNo)}</b></span>${sep}<span>狀態 ${statusBadge(status)}</span>`;

  // 工地列就地操作（改工地 / _inbox 人工歸檔）
  const siteAction = activeProjects.length
    ? `<div class="inline-actions"><span class="lead">${projectCode ? '改工地：' : '指定工地（人工歸檔）：'}</span><form class="inline-actions" method="post" action="/records/${id}/project" onsubmit="return confirm('確定要把這筆紀錄重歸檔到選定的工地？照片會搬到新工地資料夾。')"><select class="input" name="code" style="padding:6px 10px;font-size:14px">${activeProjects
        .map(
          (p) =>
            `<option value="${esc(p.code)}"${p.code === projectCode ? ' selected' : ''}>${esc(p.code)} ${esc(p.name)}</option>`,
        )
        .join('')}</select><button class="btn btn-sm btn-primary" type="submit">${projectCode ? '改工地' : '指定工地'}</button></form></div>`
    : '';

  const statusAction = `<div class="inline-actions"><span class="lead">改為：</span><form class="inline-actions" method="post" action="/records/${id}/status">${ALLOWED_STATUSES.filter((s) => s !== status)
    .map((s) => `<button class="btn btn-sm" type="submit" name="to" value="${esc(s)}">${esc(s)}</button>`)
    .join('')}</form></div>`;

  const kvRow = (k: string, v: string) => `<div class="kv-row"><div class="k">${k}</div><div class="v">${v}</div></div>`;
  const kv = `<div class="kv">
    ${kvRow('紀錄編號', `<div class="v-main"><span class="rid-big">${esc(recordNo)}</span></div>`)}
    ${kvRow('工地', `<div class="v-main">${siteTag(projectCode, projectName)}</div>${siteAction}`)}
    ${kvRow('狀態', `<div class="v-main">${statusBadge(status)}</div>${statusAction}`)}
    ${kvRow('判定方式', `<div class="v-main">${methodBadge(method)}</div>`)}
    ${kvRow('回報人', `<div class="v-main">${esc((record.reporter_name as string | null) ?? '（未具名）')}</div>`)}
    ${kvRow('收件時間', `<div class="v-main">${esc(localDateTimeStr(record.received_at as string))} <span class="muted">（歸檔日期依據）</span></div>`)}
    ${kvRow('拍攝時間', `<div class="v-main">${record.taken_at ? esc(localDateTimeStr(record.taken_at as string)) : '<span class="muted">（無 EXIF）</span>'}</div>`)}
    ${kvRow('GPS', `<div class="v-main">${gps ? `<span class="mono">${esc(gps)}</span>` : '<span class="muted">（無）</span>'}</div>`)}
    ${kvRow('文字備註', `<form method="post" action="/records/${id}/note"><textarea class="input" name="note" rows="3" placeholder="（無備註）">${esc((record.text_note as string | null) ?? '')}</textarea><div class="inline-actions" style="margin-top:8px"><button class="btn btn-sm btn-accent" type="submit">儲存備註</button></div></form><div class="help-text">儲存會同步重寫歸檔目錄的 metadata.json / text.txt。</div>`)}
    ${kvRow('來源', `<div class="v-main">${esc(record.channel as string)}${record.media_group_id ? '（相簿合併）' : ''}</div>`)}
  </div>`;

  const thumbs = media.length
    ? `<div class="card card-pad"><div class="media-grid">${media.map(mediaCell).join('')}</div></div>`
    : '<div class="card empty-state">（無媒體檔案）</div>';

  const logRows = logs.length
    ? logs
        .map(
          (l) =>
            `<div class="tl-row"><span class="tl-when">${esc(localDateTimeStr(l.changedAt))}</span><span class="tl-change">${esc(l.fromStatus ?? '（建檔）')} → <b>${esc(l.toStatus)}</b></span><span class="tl-by">${l.changedBy ? `由 <span class="who">${esc(l.changedBy)}</span>` : ''}</span></div>`,
        )
        .join('')
    : '<div class="tl-row"><span class="muted">（尚無狀態異動）</span></div>';

  const body = `<div class="page-title-row"><a class="back-link" href="/records">← 回列表</a></div>
  ${kv}
  <div class="section-head"><h2>媒體（${media.length} 件）</h2></div>${thumbs}
  <div class="section-head"><h2>狀態歷程</h2></div><div class="card timeline">${logRows}</div>`;
  return page(`${recordNo} — 管理後台`, 'records', sum, body);
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
