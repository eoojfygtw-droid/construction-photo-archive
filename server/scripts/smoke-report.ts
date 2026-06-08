// ============================================================
// smoke-report.ts — 巡檢日報離線驗收（不需 Telegram、不需現成 app.db）
// 在暫存 DB 塞 2 筆紀錄（1 筆已歸檔 A001 + 1 筆 _inbox），照片指向 repo 內
// 既有的測試檔，跑 generateDailyReport → 驗證 HTML 內容與摘要正確。
// 用法：npx tsx scripts/smoke-report.ts
// ============================================================
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Db } from '../src/db/index';
import { generateDailyReport } from './report';

// 與既有歸檔測試資料對齊的真實照片路徑（縮圖才顯示得出來）
const JPG = join('data', 'projects', 'A001_信義豪宅案B棟', '2026', '06', '05', 'records', 'A001-20260605-001', 'A001-20260605-001-01.jpg');
const HEIC = join('data', 'projects', 'A001_信義豪宅案B棟', '2026', '06', '05', 'records', 'A001-20260605-001', 'A001-20260605-001-02.heic');
const INBOX_JPG = join('data', 'projects', 'A001_信義豪宅案', '2026', '06', '05', 'records', 'INBOX-20260605-001', 'INBOX-20260605-001-01.jpg');

const RECEIVED = '2026-06-05T08:00:00.000Z';
const TMP_DB = join('data', '_smoke', 'report-test.db');
const TMP_OUT = join('data', '_smoke', 'reports');

async function run() {
  let pass = 0;
  let fail = 0;
  const ok = (cond: boolean, label: string) => {
    if (cond) { pass++; console.log(`  ✅ ${label}`); }
    else { fail++; console.log(`  ❌ ${label}`); }
  };

  // 乾淨起點
  await rm(join('data', '_smoke'), { recursive: true, force: true });

  // ---- 準備暫存 DB ----
  const db = new Db(TMP_DB);
  await db.init();

  // 紀錄 1：已歸檔 A001，待改善，2 張照片（jpg + heic）
  const id1 = db.insertRecord('A001-20260605-001', {
    channel: 'telegram',
    projectCode: 'A001',
    projectName: '信義豪宅案B棟',
    resolveMethod: 'manual_code',
    textNote: '三樓樑柱裂縫，需複查',
    reporterId: 'u123',
    reporterName: '阿明',
    sourceMessageId: 'msg-1',
    mediaGroupId: 'mg-1',
    gpsLat: 25.03,
    gpsLng: 121.56,
    status: '待改善',
    takenAt: '2026-06-05T01:02:03.000Z',
    receivedAt: RECEIVED,
  });
  db.insertPhoto({ recordId: id1, filePath: JPG, uploadType: 'document', hasExif: true, exifTakenAt: '2026-06-05T01:02:03.000Z', exifGpsLat: 25.03, exifGpsLng: 121.56, bytes: 1234 });
  db.insertPhoto({ recordId: id1, filePath: HEIC, uploadType: 'photo', hasExif: false, exifTakenAt: null, exifGpsLat: null, exifGpsLng: null, bytes: 5678 });

  // 紀錄 2：_inbox 判不出工地，待確認，1 張照片
  const id2 = db.insertRecord('INBOX-20260605-001', {
    channel: 'telegram',
    projectCode: null,
    projectName: null,
    resolveMethod: 'unresolved',
    textNote: null,
    reporterId: 'u999',
    reporterName: null,
    sourceMessageId: 'msg-2',
    mediaGroupId: null,
    gpsLat: null,
    gpsLng: null,
    status: '待確認',
    takenAt: null,
    receivedAt: RECEIVED,
  });
  db.insertPhoto({ recordId: id2, filePath: INBOX_JPG, uploadType: 'photo', hasExif: false, exifTakenAt: null, exifGpsLat: null, exifGpsLng: null, bytes: 999 });

  db.close();

  // ---- 跑報表 ----
  // 用 received_at 推算本機日期當篩選目標，避免測試受機器時區影響
  const date = new Date(RECEIVED);
  const targetDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const { outPath, summary } = await generateDailyReport({ dbPath: TMP_DB, date: targetDate, outDir: TMP_OUT });

  // ---- 驗摘要 ----
  ok(summary.total === 2, `摘要 total=2（實際 ${summary.total}）`);
  ok(summary.archived === 1, `摘要 archived=1（實際 ${summary.archived}）`);
  ok(summary.inbox === 1, `摘要 inbox=1（實際 ${summary.inbox}）`);
  ok(summary.pending === 1, `摘要 pending=1（實際 ${summary.pending}）`);

  // ---- 驗 HTML 內容 ----
  const html = await readFile(outPath, 'utf8');
  ok(html.includes('A001-20260605-001'), 'HTML 含已歸檔紀錄編號');
  ok(html.includes('INBOX-20260605-001'), 'HTML 含 _inbox 紀錄編號');
  ok(html.includes('信義豪宅案B棟'), 'HTML 含工地名稱');
  ok(html.includes('手動代碼'), 'resolve_method 已中文化（手動代碼）');
  ok(html.includes('判不出'), 'resolve_method 已中文化（判不出）');
  ok(html.includes('三樓樑柱裂縫'), 'HTML 含回報文字');
  ok(html.includes('⚠️ _inbox'), 'HTML 有 _inbox 警示區');
  ok(/<img\s+src="file:/.test(html), 'jpg 以 <img file://> 顯示縮圖');
  ok(html.includes('HEIC 無法預覽'), 'heic 顯示佔位卡（無法預覽）');
  ok(html.includes('待確認') && html.includes('待改善'), 'HTML 含狀態標籤');

  // 清掉暫存
  await rm(join('data', '_smoke'), { recursive: true, force: true });

  console.log(`\n結果：${pass} 通過 / ${fail} 失敗`);
  process.exit(fail === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error('smoke-report 異常', err);
  process.exit(1);
});
