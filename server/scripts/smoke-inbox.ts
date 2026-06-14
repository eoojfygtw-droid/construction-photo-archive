// ============================================================
// smoke-inbox.ts — 冷啟動判不出「累積+去抖+批次歸檔」離線驗收（不需 Telegram）
// 驗收 5-B1：
//   A. PendingInboxStore 去抖/累積/新批邏輯
//   B. 批次歸檔端到端：3 筆 _inbox（真實檔案）→ 點一次工地 → 全搬到 projects/、
//      _inbox 清掉、DB 更新、recent_context 播種（後續自動歸）
//   C. 「暫不處理」清累積但留 _inbox
//   D. 重複點批次防呆
// 用法：npx tsx scripts/smoke-inbox.ts
// ============================================================
import { access, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Db } from '../src/db';
import type { IncomingCallback } from '../src/channels/types';
import type { OutgoingButton } from '../src/channels/MessageChannelAdapter';
import { UserContextStore } from '../src/core/resolve/UserContextStore';
import { PendingInboxStore } from '../src/core/projects/PendingInboxStore';
import { buildBatchSitePickerButtons, handleBatchSitePick } from '../src/core/confirm/siteFlow';

const exists = (p: string) => access(p).then(() => true).catch(() => false);

class StubAdapter {
  answers: { id: string; text?: string }[] = [];
  edits: { text: string; buttons?: OutgoingButton[] }[] = [];
  async answerCallback(id: string, text?: string) { this.answers.push({ id, text }); }
  async editMessageText(_c: string, _m: string, text: string, buttons?: OutgoingButton[]) {
    this.edits.push({ text, buttons });
  }
  readonly channel = 'telegram' as const;
  onMessage() {}
  onCallback() {}
  async start() {}
  async stop() {}
  async sendMessage() {}
  async sendMessageWithButtons() {}
  async downloadFile() { return { buffer: Buffer.alloc(0), remotePath: '' }; }
}

// 工地 stub（siteFlow 只用 listActive / findByCode）；中性測試名，不用真實案場
const PROJ = { code: 'B001', name: '煙測工地B', centerLat: 0, centerLng: 0, radiusMeters: 100, active: true };
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

const RECEIVED = '2026-06-12T05:20:00.000Z';

/** 建一筆 _inbox 紀錄 + 真實暫存檔案 */
async function makeInbox(db: Db, recordNo: string, reporterId: string) {
  const inboxDir = join('data', '_inbox', recordNo);
  await mkdir(inboxDir, { recursive: true });
  const photoPath = join(inboxDir, `${recordNo}-01.jpg`);
  await writeFile(photoPath, 'fake-photo-bytes');
  await writeFile(
    join(inboxDir, 'metadata.json'),
    JSON.stringify({ record_no: recordNo, project: { code: null } }, null, 2),
  );
  const recordId = db.insertRecord(recordNo, {
    channel: 'telegram', projectCode: null, projectName: null, resolveMethod: 'unresolved',
    textNote: null, reporterId, reporterName: '工地主任', sourceMessageId: '1', mediaGroupId: null,
    gpsLat: null, gpsLng: null, status: '待確認', takenAt: null, receivedAt: RECEIVED,
  });
  db.insertStatusLog(recordId, null, '待確認', reporterId);
  db.insertPhoto({
    recordId, filePath: photoPath, uploadType: 'photo', hasExif: false,
    exifTakenAt: null, exifGpsLat: null, exifGpsLng: null, bytes: 16,
  });
  return { recordId, photoPath, inboxDir };
}

async function run() {
  let pass = 0, fail = 0;
  const ok = (cond: boolean, label: string) => {
    if (cond) { pass++; console.log(`  ✅ ${label}`); }
    else { fail++; console.log(`  ❌ ${label}`); }
  };

  // ---- A) PendingInboxStore 去抖/累積/新批 ----
  console.log('A) 去抖與累積邏輯');
  const store = new PendingInboxStore();
  const t0 = 1_700_000_000_000;
  store.add('u9', 101, t0);
  ok(store.shouldPrompt('u9', t0) === true, '第一筆判不出 → 送選單');
  store.add('u9', 102, t0 + 5000);
  ok(store.shouldPrompt('u9', t0 + 5000) === false, '90 秒內第二筆 → 靜默不洗版');
  ok(store.shouldPrompt('u9', t0 + 100 * 1000) === true, '逾 90 秒去抖期 → 再送一次選單');
  ok(JSON.stringify(store.peek('u9')) === JSON.stringify([101, 102]), '累積兩筆 record id');
  ok(store.takeAll('u9').length === 2 && store.peek('u9').length === 0, 'takeAll 取出並清空');
  store.add('u9', 201, t0);
  store.add('u9', 202, t0 + 3 * 60 * 60 * 1000); // 超過 2 小時 BATCH_TTL
  ok(JSON.stringify(store.peek('u9')) === JSON.stringify([202]), '超過 2 小時視為新批，舊的清掉');

  // ---- B) 批次歸檔端到端 ----
  console.log('B) 批次歸檔（3 筆 _inbox → 點一次工地全歸）');
  const db = new Db(':memory:');
  await db.init();
  const adapter = new StubAdapter();
  const contextStore = new UserContextStore();
  const pendingInbox = new PendingInboxStore();

  const a = await makeInbox(db, 'INBOX-20260612-001', 'u9');
  const b = await makeInbox(db, 'INBOX-20260612-002', 'u9');
  const c2 = await makeInbox(db, 'INBOX-20260612-003', 'u9');
  const now = Date.parse(RECEIVED);
  pendingInbox.add('u9', a.recordId, now);
  pendingInbox.add('u9', b.recordId, now + 1000);
  pendingInbox.add('u9', c2.recordId, now + 2000);

  const btns = buildBatchSitePickerButtons(projectStore, 'u9');
  ok(btns.length === 2, '批次選單：1 工地 + 暫不處理');
  ok(btns[0].callbackData === 'sb:u9:B001', '批次按鈕 callbackData 帶 reporterId');
  ok(btns[1].callbackData === 'sb:u9:_keep', '含「暫不處理」');

  await handleBatchSitePick(adapter as never, db, projectStore, contextStore, pendingInbox, cb('sb:u9:B001'), 'u9', 'B001');

  const d = new Date(RECEIVED);
  const pad = (n: number) => String(n).padStart(2, '0');
  const dir = (no: string) => join('data', 'projects', 'B001_煙測工地B', String(d.getFullYear()), pad(d.getMonth() + 1), pad(d.getDate()), 'records', no);
  ok(await exists(join(dir('INBOX-20260612-001'), 'INBOX-20260612-001-01.jpg')), '第 1 張搬到 B001 目錄');
  ok(await exists(join(dir('INBOX-20260612-003'), 'INBOX-20260612-003-01.jpg')), '第 3 張搬到 B001 目錄');
  ok(!(await exists(a.inboxDir)) && !(await exists(c2.inboxDir)), '舊 _inbox 目錄全清掉');
  ok(db.getRecordById(a.recordId)?.projectCode === 'B001', '第 1 筆 DB 工地 → B001');
  ok(db.getRecordById(c2.recordId)?.projectCode === 'B001', '第 3 筆 DB 工地 → B001');
  ok(db.getRecordById(b.recordId)?.status === '待改善', '狀態 → 待改善');
  ok(pendingInbox.peek('u9').length === 0, '批次後 store 清空');
  ok(contextStore.get('u9', now + 60 * 60 * 1000) === 'B001', '批次歸檔後寫 2 小時上下文（後續自動歸、不再判不出）');
  ok(adapter.answers.at(-1)?.text === '已歸檔 3 張 ✅', '回報「已歸檔 3 張」');
  ok(adapter.edits.at(-1)?.text.includes('一起歸到 B001') ?? false, '訊息更新為批次已歸檔');

  // ---- D) 重複點批次防呆 ----
  console.log('D) 重複點批次防呆');
  await handleBatchSitePick(adapter as never, db, projectStore, contextStore, pendingInbox, cb('sb:u9:B001'), 'u9', 'B001');
  ok(adapter.answers.at(-1)?.text === '這批已經處理過了', '重複點批次 → 防呆');

  // ---- C) 暫不處理：清累積但留 _inbox ----
  console.log('C) 暫不處理（留 _inbox）');
  const e = await makeInbox(db, 'INBOX-20260612-004', 'u7');
  pendingInbox.add('u7', e.recordId, now);
  await handleBatchSitePick(adapter as never, db, projectStore, contextStore, pendingInbox, cb('sb:u7:_keep'), 'u7', '_keep');
  ok(pendingInbox.peek('u7').length === 0, '暫不處理後 store 清空');
  ok(db.getRecordById(e.recordId)?.projectCode === null, '記錄仍留 _inbox（工地 null）');
  ok(await exists(e.photoPath), '_inbox 檔案還在（沒被搬走）');
  ok(adapter.answers.at(-1)?.text === '暫不處理，留待歸檔', '回「暫不處理，留待歸檔」');

  db.close();
  // 清掉本次建立的歸檔/暫存目錄
  await rm(join('data', 'projects', 'B001_煙測工地B'), { recursive: true, force: true });
  await rm(e.inboxDir, { recursive: true, force: true });

  console.log(`\n結果：${pass} 通過 / ${fail} 失敗`);
  process.exit(fail === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error('smoke-inbox 異常', err);
  process.exit(1);
});
