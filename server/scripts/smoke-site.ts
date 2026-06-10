// ============================================================
// smoke-site.ts — 5-3b 按鈕詢問工地 / 改工地 離線驗收（不需 Telegram）
// 模擬一筆 _inbox 紀錄（真實檔案）→ 使用者按工地按鈕 → 驗證重歸檔：
//   檔案搬到 projects/、舊 _inbox 目錄清掉、DB 工地/狀態/照片路徑更新、metadata 重寫。
// 另測 ✏️ 叫出選單 與 留 _inbox。
// 用法：npx tsx scripts/smoke-site.ts
// ============================================================
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Db } from '../src/db';
import type { IncomingCallback } from '../src/channels/types';
import type { OutgoingButton } from '../src/channels/MessageChannelAdapter';
import { handleConfirmCallback } from '../src/core/confirm/confirmFlow';
import { UserContextStore } from '../src/core/resolve/UserContextStore';

const exists = (p: string) =>
  access(p).then(() => true).catch(() => false);

class StubAdapter {
  sent: { text: string; buttons: OutgoingButton[]; columns?: number }[] = [];
  answers: { id: string; text?: string }[] = [];
  edits: { text: string; buttons?: OutgoingButton[] }[] = [];
  async sendMessageWithButtons(_c: string, text: string, buttons: OutgoingButton[], columns?: number) {
    this.sent.push({ text, buttons, columns });
  }
  async answerCallback(id: string, text?: string) {
    this.answers.push({ id, text });
  }
  async editMessageText(_c: string, _m: string, text: string, buttons?: OutgoingButton[]) {
    this.edits.push({ text, buttons });
  }
  readonly channel = 'telegram' as const;
  onMessage() {}
  onCallback() {}
  async start() {}
  async stop() {}
  async downloadFile() { return { buffer: Buffer.alloc(0), remotePath: '' }; }
  async sendMessage() {}
}

// 工地 stub（siteFlow 只用 listActive / findByCode）
const PROJ = { code: 'A001', name: '信義豪宅案', centerLat: 0, centerLng: 0, radiusMeters: 100, active: true };
const projectStore = {
  listActive: () => [PROJ],
  findByCode: (c: string) => (c.toUpperCase() === PROJ.code ? PROJ : undefined),
} as never;

function cb(data: string): IncomingCallback {
  return {
    channel: 'telegram',
    callbackId: `cbid-${data}`,
    data,
    chatId: '-100',
    messageId: '777',
    fromId: 'u9',
    fromName: '工地主任',
  };
}

async function run() {
  let pass = 0;
  let fail = 0;
  const ok = (cond: boolean, label: string) => {
    if (cond) { pass++; console.log(`  ✅ ${label}`); }
    else { fail++; console.log(`  ❌ ${label}`); }
  };

  const db = new Db(':memory:');
  await db.init();
  const adapter = new StubAdapter();
  const contextStore = new UserContextStore();

  // ---- 準備：一筆 INBOX 紀錄 + 真實檔案（模擬 5-2 已歸到 _inbox）----
  const receivedAt = '2026-06-05T08:00:00.000Z';
  const recordNo = 'INBOX-20260605-001';
  const inboxDir = join('data', '_inbox', recordNo);
  await mkdir(inboxDir, { recursive: true });
  const photoPath = join(inboxDir, `${recordNo}-01.jpg`);
  await writeFile(photoPath, 'fake-photo-bytes');
  await writeFile(join(inboxDir, 'metadata.json'), JSON.stringify({ record_no: recordNo, project: { code: null } }, null, 2));
  await writeFile(join(inboxDir, 'text.txt'), '外牆磁磚剝落\n');

  const recordId = db.insertRecord(recordNo, {
    channel: 'telegram',
    projectCode: null,
    projectName: null,
    resolveMethod: 'unresolved',
    textNote: '外牆磁磚剝落',
    reporterId: 'u9',
    reporterName: '工地主任',
    sourceMessageId: '1',
    mediaGroupId: null,
    gpsLat: null,
    gpsLng: null,
    status: '待確認',
    takenAt: null,
    receivedAt,
  });
  db.insertStatusLog(recordId, null, '待確認', 'u9');
  db.insertPhoto({
    recordId,
    filePath: photoPath,
    uploadType: 'document',
    hasExif: false,
    exifTakenAt: null,
    exifGpsLat: null,
    exifGpsLng: null,
    bytes: 16,
  });

  // 預期目標目錄（用與程式同樣的本地日期換算，避免時區假設）
  const d = new Date(receivedAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  const expectDir = join(
    'data', 'projects', 'A001_信義豪宅案',
    String(d.getFullYear()), pad(d.getMonth() + 1), pad(d.getDate()),
    'records', recordNo,
  );

  // ---- 1) 第 5 層：按工地按鈕 s:{id}:A001 → 重歸檔 ----
  console.log('1) 選定工地 A001（從 _inbox 搬到 projects）');
  await handleConfirmCallback(adapter as never, db, projectStore, contextStore, cb(`s:${recordId}:A001`));

  ok(await exists(join(expectDir, `${recordNo}-01.jpg`)), '照片已搬到 projects 目錄');
  ok(!(await exists(photoPath)), '_inbox 原照片已移走');
  ok(!(await exists(inboxDir)), '舊 _inbox 目錄已清掉（連同舊 metadata/text）');
  ok(await exists(join(expectDir, 'metadata.json')), '新目錄有 metadata.json');
  ok(await exists(join(expectDir, 'text.txt')), '新目錄有 text.txt');

  const rec = db.getRecordById(recordId);
  ok(rec?.projectCode === 'A001' && rec?.projectName === '信義豪宅案', 'DB 工地已更新為 A001');
  ok(rec?.status === '待改善', 'DB 狀態 → 待改善');
  const photos = db.getPhotos(recordId);
  ok(photos[0].filePath === join(expectDir, `${recordNo}-01.jpg`), 'DB 照片路徑已更新為新位置');

  const meta = JSON.parse(await readFile(join(expectDir, 'metadata.json'), 'utf8'));
  ok(meta.project.code === 'A001' && meta.resolve_method === 'manual_pick', 'metadata 工地與 resolve_method 正確');
  ok(meta.record_no === recordNo, 'metadata record_no 維持原編號（不重編）');
  ok(adapter.edits.at(-1)?.text.includes('已歸檔到 A001') ?? false, '訊息就地更新為已歸檔');

  // ---- 1b) 選單指定後，回報人 2 小時上下文已生效（之後照片走 recent_context）----
  const recvMs = Date.parse(receivedAt);
  ok(contextStore.get('u9', recvMs + 60 * 60 * 1000) === 'A001', '選單指定後記住 2 小時上下文（錨在收件時間）');
  ok(contextStore.get('u9', recvMs + 3 * 60 * 60 * 1000) === null, '超過 2 小時上下文過期');
  // setIfNewer 守門：較新的上下文不被舊紀錄的指定蓋掉
  contextStore.set('u9', 'B999', recvMs + 30 * 60 * 1000);
  contextStore.setIfNewer('u9', 'A001', recvMs);
  ok(contextStore.get('u9', recvMs + 60 * 60 * 1000) === 'B999', '改舊紀錄不蓋掉較新的上下文');

  // ---- 2) ✏️ 改工地：叫出工地選單 ----
  console.log('2) 按 ✏️ 改工地 → 叫出選單');
  await handleConfirmCallback(adapter as never, db, projectStore, contextStore, cb(`e:${recordId}`));
  const picker = adapter.edits.at(-1);
  ok((picker?.buttons?.length ?? 0) === 2, '選單含 1 工地 + 留_inbox 共 2 顆');
  ok(picker?.buttons?.[0].callbackData === `s:${recordId}:A001`, '選單工地按鈕 callbackData 正確');
  ok(picker?.buttons?.[1].callbackData === `s:${recordId}:_keep`, '選單含「留 _inbox」按鈕');

  // ---- 3) 留 _inbox：不動工地 ----
  console.log('3) 選「留 _inbox」');
  const beforeProj = db.getRecordById(recordId)?.projectCode;
  await handleConfirmCallback(adapter as never, db, projectStore, contextStore, cb(`s:${recordId}:_keep`));
  ok(adapter.answers.at(-1)?.text === '保留為待歸檔', '回「保留為待歸檔」');
  ok(db.getRecordById(recordId)?.projectCode === beforeProj, '工地維持不變');

  db.close();
  console.log(`\n結果：${pass} 通過 / ${fail} 失敗`);
  process.exit(fail === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error('smoke test 異常', err);
  process.exit(1);
});
