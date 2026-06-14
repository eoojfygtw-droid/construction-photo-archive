// ============================================================
// smoke-admin.ts — 管理後台離線驗收（5-A1 唯讀瀏覽 + 5-A2 狀態/備註寫入 + 5-A5 報告頁）
// 暫存 DB 塞 3 筆紀錄（A001 待改善 / A002 待確認 / _inbox）＋真實暫存媒體檔，
// 起後台於隨機埠 → 用 fetch 驗列表、四篩選、詳細頁、媒體串流、404，
// 再驗 POST 改狀態（status_logs、防重送）、POST 改備註（metadata.json/text.txt 同步）。
// 全程不碰正式 app.db、不需 Telegram。
// 用法：npx tsx scripts/smoke-admin.ts
// ============================================================
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { Db } from '../src/db/index';
import { createAdminServer } from '../src/admin/index';

const TMP_ROOT = join('data', '_smoke', 'admin');
const TMP_DB = join(TMP_ROOT, 'admin-test.db');
const TMP_JPG = join(TMP_ROOT, 'photo-1.jpg');
const TMP_OGA = join(TMP_ROOT, 'voice-1.oga');
const TMP_SEED = join(TMP_ROOT, 'projects.seed.json');
const TMP_INBOX_DIR = join(TMP_ROOT, 'INBOX-20260605-001');
const TMP_INBOX_JPG = join(TMP_INBOX_DIR, 'INBOX-20260605-001-01.jpg');
/** 5-A3 人工歸檔的目標工地（搬進真實 data/projects/，測完整目錄清掉） */
const REASSIGN_TARGET_DIR = join('data', 'projects', 'B001_煙測工地B');

/** 假 JPEG 內容（只驗串流位元組與 Content-Type，不需是合法影像） */
const JPG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8, 0xff, 0xd9]);

const RECEIVED_D1 = '2026-06-05T08:00:00.000Z'; // 第一天（A001 與 _inbox）
const RECEIVED_D2 = '2026-06-06T09:30:00.000Z'; // 第二天（A002）

/** ISO → 本機日期 YYYY-MM-DD（與後台篩選同邏輯，避免時區影響） */
function localDateStr(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function run() {
  let pass = 0;
  let fail = 0;
  const ok = (cond: boolean, label: string) => {
    if (cond) { pass++; console.log(`  ✅ ${label}`); }
    else { fail++; console.log(`  ❌ ${label}`); }
  };

  // 乾淨起點 + 暫存媒體檔 + 暫存工地清單（不碰正式 projects.seed.json）
  await rm(TMP_ROOT, { recursive: true, force: true });
  await rm(REASSIGN_TARGET_DIR, { recursive: true, force: true });
  await mkdir(TMP_INBOX_DIR, { recursive: true });
  await writeFile(TMP_JPG, JPG_BYTES);
  await writeFile(TMP_OGA, Buffer.from('OggS-fake-voice'));
  await writeFile(TMP_INBOX_JPG, JPG_BYTES);
  await writeFile(
    TMP_SEED,
    JSON.stringify([
      { code: 'B001', name: '煙測工地B', centerLat: null, centerLng: null, radiusMeters: null, active: true },
      { code: 'B999', name: '停用工地', centerLat: null, centerLng: null, radiusMeters: null, active: false },
    ]),
  );

  // ---- 準備暫存 DB ----
  const db = new Db(TMP_DB);
  await db.init();

  // 紀錄 1：A001 已歸檔，待改善（有狀態歷程），1 張照片 + 1 則錄音
  const id1 = db.insertRecord('A001-20260605-001', {
    channel: 'telegram',
    projectCode: 'A001',
    projectName: '煙測工地A',
    resolveMethod: 'manual_code',
    textNote: '三樓樑柱裂縫，需複查',
    reporterId: 'u123',
    reporterName: '阿明',
    sourceMessageId: 'msg-1',
    mediaGroupId: null,
    gpsLat: 25.03,
    gpsLng: 121.56,
    status: '待確認',
    takenAt: '2026-06-05T01:02:03.000Z',
    receivedAt: RECEIVED_D1,
  });
  const photoId1 = db.insertPhoto({ recordId: id1, filePath: TMP_JPG, uploadType: 'document', hasExif: true, exifTakenAt: '2026-06-05T01:02:03.000Z', exifGpsLat: 25.03, exifGpsLng: 121.56, bytes: JPG_BYTES.length });
  db.insertPhoto({ recordId: id1, filePath: TMP_OGA, uploadType: 'voice', hasExif: false, exifTakenAt: null, exifGpsLat: null, exifGpsLng: null, bytes: 15 });
  db.updateStatus(id1, '待改善', '阿明'); // 產生一筆狀態歷程

  // 紀錄 2：A002 已歸檔，待確認，近期上下文判定
  const id2 = db.insertRecord('A002-20260606-001', {
    channel: 'telegram',
    projectCode: 'A002',
    projectName: '工地乙',
    resolveMethod: 'recent_context',
    textNote: null,
    reporterId: 'u456',
    reporterName: '小華',
    sourceMessageId: 'msg-2',
    mediaGroupId: null,
    gpsLat: null,
    gpsLng: null,
    status: '待確認',
    takenAt: null,
    receivedAt: RECEIVED_D2,
  });
  db.insertPhoto({ recordId: id2, filePath: join(TMP_ROOT, 'missing.heic'), uploadType: 'photo', hasExif: false, exifTakenAt: null, exifGpsLat: null, exifGpsLng: null, bytes: 999 });

  // 紀錄 3：_inbox 判不出（有 1 張照片，5-A3 人工歸檔測試對象）
  const id3 = db.insertRecord('INBOX-20260605-001', {
    channel: 'telegram',
    projectCode: null,
    projectName: null,
    resolveMethod: 'unresolved',
    textNote: null,
    reporterId: 'u999',
    reporterName: null,
    sourceMessageId: 'msg-3',
    mediaGroupId: null,
    gpsLat: null,
    gpsLng: null,
    status: '待確認',
    takenAt: null,
    receivedAt: RECEIVED_D1,
  });
  db.insertPhoto({ recordId: id3, filePath: TMP_INBOX_JPG, uploadType: 'photo', hasExif: false, exifTakenAt: null, exifGpsLat: null, exifGpsLng: null, bytes: JPG_BYTES.length });
  db.close();

  // ---- 起後台（隨機埠，只綁 127.0.0.1；工地清單用暫存 seed）----
  const server = createAdminServer({ dbPath: TMP_DB, seedPath: TMP_SEED });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const get = async (path: string) => {
    const r = await fetch(base + path, { redirect: 'manual' });
    return { status: r.status, headers: r.headers, text: r.status === 200 ? await r.text() : '' };
  };

  try {
    // ---- 首頁導向 + 儀表板 ----
    const home = await get('/');
    ok(home.status === 302 && home.headers.get('location') === '/dashboard', '/ 導向 /dashboard');
    const dash = await get('/dashboard');
    ok(dash.status === 200, '/dashboard 回 200');
    ok(dash.text.includes('全部紀錄') && dash.text.includes('全部 <b>3</b> 筆'), '儀表板總數 3 筆');
    ok(dash.text.includes('_inbox 待歸檔'), '儀表板有 _inbox 卡');
    ok(dash.text.includes('前往人工歸檔'), '_inbox>0 顯示人工歸檔捷徑');
    ok(dash.text.includes('A001') && dash.text.includes('A002'), '儀表板各工地列 A001/A002');
    ok(dash.text.includes('判定方式分布') && dash.text.includes('手動代碼'), '儀表板有判定方式分布');

    // ---- 列表（無篩選）----
    const list = await get('/records');
    ok(list.status === 200, '/records 回 200');
    ok(list.text.includes('A001-20260605-001') && list.text.includes('A002-20260606-001') && list.text.includes('INBOX-20260605-001'), '列表含全部 3 筆');
    ok(list.text.includes('符合 <b>3</b> 筆'), '摘要符合 3 筆');
    ok(list.text.includes('_inbox <b>1</b>'), '摘要 _inbox 1 筆');
    ok(list.text.includes('手動代碼') && list.text.includes('近期上下文') && list.text.includes('判不出'), '判定方式中文化');
    ok(list.text.includes('三樓樑柱裂縫'), '列表含文字備註');
    const a002First = list.text.indexOf('A002-20260606-001') < list.text.indexOf('A001-20260605-001');
    ok(a002First, '新的在前（A002 06/06 排在 A001 06/05 之前）');

    // ---- 四篩選 ----
    const byDate = await get(`/records?date=${localDateStr(RECEIVED_D1)}`);
    ok(byDate.text.includes('A001-20260605-001') && !byDate.text.includes('A002-20260606-001'), '日期篩選只留第一天 2 筆');
    const byProject = await get('/records?project=A002');
    ok(byProject.text.includes('A002-20260606-001') && !byProject.text.includes('A001-20260605-001'), '工地篩選 A002');
    const byInbox = await get('/records?project=_inbox');
    ok(byInbox.text.includes('INBOX-20260605-001') && !byInbox.text.includes('A001-20260605-001'), '_inbox 篩選');
    const byStatus = await get(`/records?status=${encodeURIComponent('待改善')}`);
    ok(byStatus.text.includes('A001-20260605-001') && !byStatus.text.includes('A002-20260606-001'), '狀態篩選 待改善');
    const byMethod = await get('/records?method=recent_context');
    ok(byMethod.text.includes('A002-20260606-001') && !byMethod.text.includes('A001-20260605-001'), '判定方式篩選 recent_context');
    const combo = await get(`/records?date=${localDateStr(RECEIVED_D1)}&project=A001`);
    ok(combo.text.includes('符合 <b>1</b> 筆'), '複合篩選（日期＋工地）剩 1 筆');

    // ---- 詳細頁 ----
    const detail = await get(`/records/${id1}`);
    ok(detail.status === 200, `/records/${id1} 回 200`);
    ok(detail.text.includes('A001-20260605-001') && detail.text.includes('煙測工地A'), '詳細頁含編號與工地');
    ok(detail.text.includes(`/media/${photoId1}`), '照片走 /media/{id} 串流');
    ok(detail.text.includes('thumb-audio'), '錄音以播放器顯示');
    ok(detail.text.includes('HEIC 無法預覽') === false, 'A001 詳細頁無 HEIC 佔位卡（健全性）');
    ok(detail.text.includes('待確認') && detail.text.includes('待改善'), '狀態歷程含 待確認 → 待改善');
    const detail2 = await get(`/records/${id2}`);
    ok(detail2.text.includes('⚠️ 檔案不存在'), '缺檔顯示佔位卡');
    const notFound = await get('/records/999999');
    ok(notFound.status === 404, '不存在的紀錄回 404');

    // ---- 媒體串流 ----
    const mediaRes = await fetch(`${base}/media/${photoId1}`);
    const buf = Buffer.from(await mediaRes.arrayBuffer());
    ok(mediaRes.status === 200 && mediaRes.headers.get('content-type') === 'image/jpeg', '/media 回 200 且 Content-Type=image/jpeg');
    ok(buf.equals(JPG_BYTES), '/media 串流位元組正確');
    const mediaMissing = await get('/media/999999');
    ok(mediaMissing.status === 404, '不存在的媒體回 404');

    // ---- 其他 404 ----
    const bad = await get('/etc/passwd');
    ok(bad.status === 404, '未知路徑回 404（無任意路徑讀取）');

    // ---- 5-A5：報告頁（按工地分區 + 代表照片 + 列印友善）----
    // 趁 DB 仍是原始 3 筆（A001 待改善 / A002 待確認 / _inbox）測；後面 POST 會改歸 _inbox。
    const rptDefault = await get('/report');
    ok(rptDefault.status === 200 && rptDefault.text.includes('🖨 列印'), '/report 預設回 200 且有列印按鈕');
    ok(rptDefault.text.includes('value="7d" selected'), '報告預設期間為近 7 天');

    const rpt = await get('/report?preset=custom&from=2026-06-05&to=2026-06-06');
    ok(rpt.status === 200, '/report 自訂區間回 200');
    ok(rpt.text.includes('共 <b>3</b> 筆'), '報告期間共 3 筆');
    ok(rpt.text.includes('待改善 <b>1</b>'), '報告摘要待改善 1 筆');
    ok(rpt.text.includes('煙測工地A') && rpt.text.includes('工地乙'), '報告含兩個工地分區');
    ok(rpt.text.includes('_inbox 判不出（待歸檔）'), '報告含 _inbox 待歸檔分區');
    ok(rpt.text.includes(`/media/${photoId1}`), '工地分區放代表照片縮圖');
    ok(rpt.text.includes('rthumbs-empty'), '無可預覽媒體的工地顯示佔位字');
    ok(
      rpt.text.indexOf('_inbox 判不出（待歸檔）') > rpt.text.indexOf('煙測工地A'),
      '_inbox 分區排在工地之後',
    );
    ok(rpt.text.includes('window.print()'), '列印友善：有 window.print 觸發');
    // 縮圖頁內放大（非開新視窗）：走 lightbox + onclick，不再有 target=_blank 開新視窗
    ok(rpt.text.includes('onclick="openLb(this)"') && rpt.text.includes('id="lb"'), '縮圖點擊走頁內放大（lightbox）');
    ok(!rpt.text.includes('rthumb" href') && !rpt.text.includes('target="_blank"'), '縮圖不再開新視窗');
    // 放大檢視帶出文字註解（A001 備註「三樓樑柱裂縫，需複查」放在縮圖 data-note）
    ok(rpt.text.includes('data-note="三樓樑柱裂縫，需複查"'), '放大檢視帶出文字註解');
    // 錄音只在放大層裡播放：有錄音的照片帶 data-audio + 右下角 🎤 標記；報告頁不內嵌、不單列錄音
    ok(rpt.text.includes(`data-audio="/media/`) && rpt.text.includes('thumb-mic'), '有錄音的照片標 🎤 並帶錄音來源');
    ok(rpt.text.includes('id="lb-play"') && rpt.text.includes('playLbAudio'), '放大層有「播放錄音」按鈕');
    ok(rpt.text.includes('id="lb-audio"'), '放大層內含錄音元素');
    ok(!rpt.text.includes('class="raudio"') && !rpt.text.includes('rthumb-audio'), '報告頁不內嵌、不單列錄音');

    const rptEmpty = await get('/report?preset=custom&from=2026-01-01&to=2026-01-02');
    ok(rptEmpty.text.includes('沒有任何紀錄'), '空區間顯示無紀錄');

    const rptToday = await get('/report?preset=today');
    ok(rptToday.status === 200 && rptToday.text.includes('value="today" selected'), '期間切今天可運作');

    // ---- 5-A2：POST 改狀態 ----
    const post = (path: string, body: Record<string, string>, headers: Record<string, string> = {}) =>
      fetch(base + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
        body: new URLSearchParams(body).toString(),
        redirect: 'manual',
      });

    const st1 = await post(`/records/${id1}/status`, { to: '已完成' });
    ok(st1.status === 303 && st1.headers.get('location') === `/records/${id1}`, '改狀態回 303 導回詳細頁');
    const afterSt = await get(`/records/${id1}`);
    ok(afterSt.text.includes('已完成'), '詳細頁狀態已變為 已完成');
    ok(afterSt.text.includes('待改善') && afterSt.text.includes('後台網頁'), '狀態歷程含 待改善→已完成 由 後台網頁');
    // 同狀態重送不重複寫歷程（防表單重送）
    await post(`/records/${id1}/status`, { to: '已完成' });
    const dupCheck = await get(`/records/${id1}`);
    ok((dupCheck.text.match(/後台網頁/g) ?? []).length === 1, '同狀態重送不重複寫歷程');
    const stBad = await post(`/records/${id1}/status`, { to: '亂寫狀態' });
    ok(stBad.status === 400, '不支援的狀態回 400');
    const stMissing = await post('/records/999999/status', { to: '已完成' });
    ok(stMissing.status === 404, '不存在紀錄改狀態回 404');

    // ---- 5-A2：POST 改備註（同步重寫 metadata.json / text.txt）----
    const note1 = await post(`/records/${id1}/note`, { note: '後台補記：已複查無虞' });
    ok(note1.status === 303, '改備註回 303');
    const afterNote = await get(`/records/${id1}`);
    ok(afterNote.text.includes('後台補記：已複查無虞'), '詳細頁顯示新備註');
    const metaText = await readFile(join(TMP_ROOT, 'metadata.json'), 'utf8');
    ok(metaText.includes('後台補記：已複查無虞'), 'metadata.json 已同步重寫');
    const txtText = await readFile(join(TMP_ROOT, 'text.txt'), 'utf8');
    ok(txtText.includes('後台補記：已複查無虞'), 'text.txt 已同步重寫');
    // 清空備註 → text.txt 移除、metadata text_note 為 null
    await post(`/records/${id1}/note`, { note: '' });
    ok(!existsSync(join(TMP_ROOT, 'text.txt')), '清空備註後 text.txt 已移除');
    const metaCleared = JSON.parse(await readFile(join(TMP_ROOT, 'metadata.json'), 'utf8')) as { text_note: string | null };
    ok(metaCleared.text_note === null, '清空備註後 metadata.text_note=null');

    // ---- 5-A2：跨站 Origin 防護 ----
    const xsite = await post(`/records/${id1}/status`, { to: '待確認' }, { Origin: 'http://evil.example' });
    ok(xsite.status === 403, '跨站 Origin 回 403');
    const samesite = await post(`/records/${id1}/status`, { to: '待確認' }, { Origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` });
    ok(samesite.status === 303, '本機 Origin 正常通過');

    // ---- 5-A3：指定工地（_inbox 人工歸檔）----
    const before3 = await get(`/records/${id3}`);
    ok(before3.text.includes('指定工地（人工歸檔）'), '_inbox 詳細頁有指定工地表單');
    ok(before3.text.includes('B001 煙測工地B') && !before3.text.includes('B999'), '下拉只列啟用工地（不含停用）');

    const asg = await post(`/records/${id3}/project`, { code: 'B001' });
    ok(asg.status === 303, '指定工地回 303');
    const after3 = await get(`/records/${id3}`);
    ok(after3.text.includes('B001 煙測工地B'), '詳細頁工地已變 B001');
    ok(after3.text.includes('待改善'), '人工歸檔後狀態進 待改善');
    ok(after3.text.includes('按鈕選擇') || after3.text.includes('manual_pick'), '判定方式變 人工指定');

    // 檔案實際搬到新工地資料夾、舊 _inbox 目錄清掉
    const d1 = new Date(RECEIVED_D1);
    const pad = (n: number) => String(n).padStart(2, '0');
    const newDir = join(REASSIGN_TARGET_DIR, String(d1.getFullYear()), pad(d1.getMonth() + 1), pad(d1.getDate()), 'records', 'INBOX-20260605-001');
    ok(existsSync(join(newDir, 'INBOX-20260605-001-01.jpg')), '照片已搬到新工地資料夾');
    const movedMeta = await readFile(join(newDir, 'metadata.json'), 'utf8');
    ok(movedMeta.includes('"code": "B001"'), '新 metadata.json 工地為 B001');
    ok(!existsSync(TMP_INBOX_DIR), '舊 _inbox 目錄已清掉');
    const inboxAfter = await get('/records?project=_inbox');
    ok(inboxAfter.text.includes('符合 <b>0</b> 筆'), '_inbox 篩選歸零');

    const asgBad = await post(`/records/${id3}/project`, { code: 'ZZZZ' });
    ok(asgBad.status === 400, '不存在的工地代碼回 400');
    const asgMissing = await post('/records/999999/project', { code: 'B001' });
    ok(asgMissing.status === 404, '不存在紀錄指定工地回 404');
  } finally {
    // 先斷掉 fetch 留下的 keep-alive 連線再關伺服器；
    // 並用 process.exitCode 自然退場（Windows 上 process.exit 會跟未關完的
    // socket handle 打架，觸發 libuv assertion 而以非零碼結束）。
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  // 清掉暫存（含人工歸檔搬出去的測試工地資料夾）
  await rm(join('data', '_smoke'), { recursive: true, force: true });
  await rm(REASSIGN_TARGET_DIR, { recursive: true, force: true });

  console.log(`\n結果：${pass} 通過 / ${fail} 失敗`);
  process.exitCode = fail === 0 ? 0 : 1;
}

run().catch((err) => {
  console.error('smoke-admin 異常', err);
  process.exitCode = 1;
});
