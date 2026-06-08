// ============================================================
// report.ts — V0 驗收巡檢工具（唯讀 HTML 日報）
// 連續 5 工作天驗收期用：把當日 DB + 歸檔結果整理成一頁能一眼核對的 HTML，
// 回答「今天進來幾筆 / 歸到哪個工地 / 怎麼判的 / 有沒有掉進 _inbox / 誰還沒確認」。
//
// 唯讀：以 readOnly 開啟 app.db，絕不寫入；不搬檔、不改任何資料。
// 輸出：data/_reports/report-YYYYMMDD.html（data/ 已被 .gitignore 擋，不進 git）。
//
// 用法：
//   npm run report              # 今天（本機日期）
//   npm run report -- 2026-06-05  # 指定日期
// ============================================================
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';

/** 執行期資料根目錄（與 db/index.ts、archiver.ts 一致） */
const DATA_ROOT = 'data';
const DEFAULT_DB = join(DATA_ROOT, 'app.db');
const REPORT_DIR = join(DATA_ROOT, '_reports');

/** 瀏覽器 <img> 能直接顯示的副檔名（HEIC/HEIF 不在此列，顯示佔位卡） */
const DISPLAYABLE = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']);

/** resolve_method → 中文標籤（驗收時一眼看出「怎麼判到這個工地」） */
const RESOLVE_LABEL: Record<string, string> = {
  manual_code: '手動代碼',
  photo_gps: '照片 GPS',
  telegram_location: 'TG 位置',
  recent_context: '近期上下文',
  manual_pick: '按鈕選擇',
  unresolved: '判不出',
};

/** 一筆紀錄（report 用） */
interface ReportRecord {
  id: number;
  recordNo: string;
  projectCode: string | null;
  projectName: string | null;
  resolveMethod: string;
  status: string;
  reporterName: string | null;
  textNote: string | null;
  receivedAt: string;
  photos: { filePath: string; uploadType: string | null }[];
}

/** 報表產出結果 */
export interface ReportSummary {
  date: string;
  total: number;
  archived: number; // 已歸檔（有工地）
  inbox: number; // 判不出 → _inbox
  pending: number; // 待確認
}

/** 把 ISO 收件時間轉成本機日期字串 YYYY-MM-DD（驗收以本機自然日為單位） */
function localDateStr(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** 把 ISO 轉成本機 HH:MM（列表顯示用） */
function localTimeStr(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** HTML 跳脫，避免回報文字/姓名破壞版面或夾帶標記 */
function esc(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 讀取指定日期的所有紀錄（唯讀） */
function readRecords(dbPath: string, date: string): ReportRecord[] {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const rows = db
      .prepare(
        `SELECT id, record_no, project_code, project_name, resolve_method,
                status, reporter_name, text_note, received_at
           FROM records ORDER BY received_at, id`,
      )
      .all() as Record<string, unknown>[];

    const photoStmt = db.prepare(
      `SELECT file_path, upload_type FROM photos WHERE record_id = ? ORDER BY id`,
    );

    const out: ReportRecord[] = [];
    for (const row of rows) {
      const receivedAt = row.received_at as string;
      // 以本機自然日篩選（歸檔日期以收件時間為準）
      if (localDateStr(receivedAt) !== date) continue;
      const id = row.id as number;
      const photos = (photoStmt.all(id) as Record<string, unknown>[]).map(
        (p) => ({
          filePath: p.file_path as string,
          uploadType: (p.upload_type as string | null) ?? null,
        }),
      );
      out.push({
        id,
        recordNo: row.record_no as string,
        projectCode: (row.project_code as string | null) ?? null,
        projectName: (row.project_name as string | null) ?? null,
        resolveMethod: row.resolve_method as string,
        status: row.status as string,
        reporterName: (row.reporter_name as string | null) ?? null,
        textNote: (row.text_note as string | null) ?? null,
        receivedAt,
        photos,
      });
    }
    return out;
  } finally {
    db.close();
  }
}

/** 單張照片縮圖 HTML（可顯示→<img>；HEIC/缺檔→佔位卡） */
function photoCell(filePath: string, uploadType: string | null): string {
  const ext = extname(filePath).toLowerCase();
  const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
  const badge = uploadType === 'document' ? '📄 文件' : '🖼 照片';
  if (existsSync(filePath) && DISPLAYABLE.has(ext)) {
    const url = pathToFileURL(resolve(filePath)).href;
    return `<figure class="thumb"><img src="${esc(url)}" alt="${esc(fileName)}" loading="lazy"><figcaption>${esc(fileName)}<br><span class="up">${badge}</span></figcaption></figure>`;
  }
  // 不可預覽（HEIC 等）或檔案不存在
  const note = existsSync(filePath)
    ? ext.replace('.', '').toUpperCase() + ' 無法預覽'
    : '⚠️ 檔案不存在';
  return `<figure class="thumb thumb-placeholder"><div class="ph">${esc(note)}</div><figcaption>${esc(fileName)}<br><span class="up">${badge}</span></figcaption></figure>`;
}

/** 狀態 badge 的 CSS class（已知狀態給色，其他預設灰） */
function statusClass(status: string): string {
  if (status === '待確認') return 'st-pending';
  if (status === '待改善') return 'st-fix';
  if (status === '已完成' || status === '已結案') return 'st-done';
  return 'st-other';
}

/** 單筆紀錄卡片 HTML */
function recordCard(r: ReportRecord): string {
  const resolveLabel = RESOLVE_LABEL[r.resolveMethod] ?? r.resolveMethod;
  const thumbs = r.photos.map((p) => photoCell(p.filePath, p.uploadType)).join('');
  const note = r.textNote
    ? `<div class="note">${esc(r.textNote)}</div>`
    : '<div class="note empty">（無文字備註）</div>';
  return `
  <div class="rec">
    <div class="rec-head">
      <span class="rno">${esc(r.recordNo)}</span>
      <span class="badge st ${statusClass(r.status)}">${esc(r.status)}</span>
      <span class="badge rm">${esc(resolveLabel)}</span>
      <span class="cnt">${r.photos.length} 張</span>
    </div>
    <div class="rec-meta">${esc(r.reporterName ?? '（未具名）')} · ${localTimeStr(r.receivedAt)}</div>
    ${note}
    <div class="thumbs">${thumbs || '<span class="empty">（無照片）</span>'}</div>
  </div>`;
}

/** 組整頁 HTML */
function renderHtml(date: string, records: ReportRecord[], summary: ReportSummary): string {
  // 已歸檔的依工地分組；_inbox（判不出）獨立一區
  const archived = records.filter((r) => r.projectCode);
  const inbox = records.filter((r) => !r.projectCode);

  const groups = new Map<string, ReportRecord[]>();
  for (const r of archived) {
    const key = `${r.projectCode}_${r.projectName ?? ''}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  const groupsHtml = [...groups.entries()]
    .map(([, recs]) => {
      const first = recs[0];
      const title = `${esc(first.projectCode)}　${esc(first.projectName ?? '')}`;
      return `<section class="grp"><h2>🏗 ${title}<span class="grp-cnt">${recs.length} 筆</span></h2>${recs
        .map(recordCard)
        .join('')}</section>`;
    })
    .join('');

  const inboxHtml = inbox.length
    ? `<section class="grp grp-inbox"><h2>⚠️ _inbox 判不出工地<span class="grp-cnt">${inbox.length} 筆</span></h2>
        <p class="hint">五層判斷皆未命中（無手動代碼 / 照片無 GPS / 無位置訊息 / 2 小時內無上下文），已暫存，需人工歸檔。</p>
        ${inbox.map(recordCard).join('')}</section>`
    : '';

  const empty =
    records.length === 0
      ? `<div class="empty-day">這天沒有任何紀錄。<br>確認 bot 當天有在跑、且你有傳訊息到綁定的群組。</div>`
      : '';

  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>歸檔巡檢日報 ${date}</title>
<style>
  :root { font-family: "Segoe UI", "Microsoft JhengHei", system-ui, sans-serif; }
  body { margin: 0; background: #f4f5f7; color: #222; }
  header { background: #1f2d3d; color: #fff; padding: 18px 24px; position: sticky; top: 0; z-index: 5; }
  header h1 { margin: 0 0 8px; font-size: 20px; }
  .sum { display: flex; gap: 18px; flex-wrap: wrap; font-size: 14px; }
  .sum b { font-size: 18px; }
  .sum .warn { color: #ffd24d; }
  main { padding: 20px 24px 60px; max-width: 1100px; margin: 0 auto; }
  .grp { margin-bottom: 28px; }
  .grp h2 { font-size: 16px; border-left: 4px solid #2d6cdf; padding-left: 10px; display: flex; align-items: center; gap: 10px; }
  .grp-inbox h2 { border-left-color: #e0a800; }
  .grp-cnt { font-size: 12px; color: #666; font-weight: normal; }
  .hint { font-size: 13px; color: #8a6d00; background: #fff8e1; padding: 8px 12px; border-radius: 6px; }
  .rec { background: #fff; border: 1px solid #e3e6ea; border-radius: 8px; padding: 14px 16px; margin: 10px 0; }
  .rec-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .rno { font-weight: 700; font-family: ui-monospace, "Consolas", monospace; }
  .badge { font-size: 12px; padding: 2px 8px; border-radius: 10px; }
  .rm { background: #eef2f7; color: #41576f; }
  .st-pending { background: #fff3cd; color: #856404; }
  .st-fix { background: #cfe2ff; color: #084298; }
  .st-done { background: #d1e7dd; color: #0f5132; }
  .st-other { background: #e2e3e5; color: #41464b; }
  .cnt { font-size: 12px; color: #777; margin-left: auto; }
  .rec-meta { font-size: 13px; color: #555; margin: 6px 0; }
  .note { font-size: 14px; background: #f8f9fa; border-radius: 6px; padding: 8px 10px; margin: 6px 0; white-space: pre-wrap; }
  .note.empty, .empty { color: #aaa; }
  .thumbs { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 8px; }
  .thumb { margin: 0; width: 130px; }
  .thumb img { width: 130px; height: 130px; object-fit: cover; border-radius: 6px; border: 1px solid #ddd; background: #000; }
  .thumb figcaption { font-size: 11px; color: #666; word-break: break-all; margin-top: 4px; }
  .thumb .up { color: #2d6cdf; }
  .thumb-placeholder .ph { width: 130px; height: 130px; border-radius: 6px; border: 1px dashed #bbb; background: #fafafa; display: flex; align-items: center; justify-content: center; color: #999; font-size: 12px; text-align: center; padding: 4px; box-sizing: border-box; }
  .empty-day { text-align: center; color: #888; padding: 60px 0; font-size: 15px; line-height: 1.8; }
  footer { text-align: center; color: #aaa; font-size: 12px; padding: 20px; }
</style>
</head>
<body>
<header>
  <h1>🗂 歸檔巡檢日報　${date}</h1>
  <div class="sum">
    <span>共 <b>${summary.total}</b> 筆</span>
    <span>已歸檔 <b>${summary.archived}</b></span>
    <span class="${summary.inbox ? 'warn' : ''}">_inbox <b>${summary.inbox}</b>${summary.inbox ? ' ⚠️' : ''}</span>
    <span>待確認 <b>${summary.pending}</b></span>
  </div>
</header>
<main>
  ${empty}
  ${inboxHtml}
  ${groupsHtml}
</main>
<footer>唯讀巡檢報表 · 由 npm run report 產生 · 不含任何寫入操作</footer>
</body>
</html>`;
}

/** 產生某日的巡檢 HTML，回傳輸出路徑與摘要 */
export async function generateDailyReport(opts: {
  dbPath?: string;
  date: string;
  outDir?: string;
}): Promise<{ outPath: string; summary: ReportSummary }> {
  const dbPath = opts.dbPath ?? DEFAULT_DB;
  const outDir = opts.outDir ?? REPORT_DIR;

  if (!existsSync(dbPath)) {
    throw new Error(
      `找不到資料庫 ${dbPath}。請先啟動 bot（npm start）收過訊息，產生 app.db 後再跑巡檢。`,
    );
  }

  const records = readRecords(dbPath, opts.date);
  const summary: ReportSummary = {
    date: opts.date,
    total: records.length,
    archived: records.filter((r) => r.projectCode).length,
    inbox: records.filter((r) => !r.projectCode).length,
    pending: records.filter((r) => r.status === '待確認').length,
  };

  const html = renderHtml(opts.date, records, summary);
  await mkdir(outDir, { recursive: true });
  const outPath = join(outDir, `report-${opts.date.replace(/-/g, '')}.html`);
  await writeFile(outPath, html, 'utf8');
  return { outPath, summary };
}

/** CLI 進入點 */
async function main() {
  const arg = process.argv[2];
  const date = arg && /^\d{4}-\d{2}-\d{2}$/.test(arg) ? arg : localDateStr(new Date().toISOString());
  if (arg && !/^\d{4}-\d{2}-\d{2}$/.test(arg)) {
    console.error(`日期格式須為 YYYY-MM-DD，收到「${arg}」。改用今天 ${date}。`);
  }
  const { outPath, summary } = await generateDailyReport({ date });
  console.log(`\n📋 ${date} 巡檢日報`);
  console.log(
    `   共 ${summary.total} 筆｜已歸檔 ${summary.archived}｜_inbox ${summary.inbox}${summary.inbox ? ' ⚠️' : ''}｜待確認 ${summary.pending}`,
  );
  console.log(`   已輸出：${outPath}`);
  console.log(`   用瀏覽器開啟即可核對（含照片縮圖）。\n`);
}

// 僅在被直接執行時跑 CLI（被 smoke-report 匯入時不自動執行）
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('產生巡檢日報失敗：', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
