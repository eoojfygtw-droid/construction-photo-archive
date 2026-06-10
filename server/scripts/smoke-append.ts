// ============================================================
// smoke-append.ts — 追加合併離線驗收（不需 Telegram）
// 驗證：照片建檔後接著傳的語音/文字自動併入上一筆（媒體續編、備註合併、
// metadata 重寫）、各種不併入的守門條件、以及「🆕 拆成新筆」反悔。
// 用獨立 SMKA 測試工地避免撞真資料，跑完自動清除。
// 用法：npx tsx scripts/smoke-append.ts
// ============================================================
import { mkdir, readFile, writeFile, access, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Db } from '../src/db';
import type { IncomingCallback, IncomingMessage } from '../src/channels/types';
import type { OutgoingButton } from '../src/channels/MessageChannelAdapter';
import type { IntakeResult } from '../src/core/media/photoIntake';
import { writeRecord } from '../src/core/records/recordWriter';
import {
  LastRecordStore,
  AppendStore,
  isAppendCandidate,
  findAppendTarget,
  appendToRecord,
  isSplitCallback,
  handleSplitCallback,
} from '../src/core/records/appendFlow';
import { SiteResolver } from '../src/core/resolve/SiteResolver';
import { UserContextStore } from '../src/core/resolve/UserContextStore';

const exists = (p: string) =>
  access(p).then(() => true).catch(() => false);

/** 錄下送出訊息/按鈕/編輯的 stub adapter */
class StubAdapter {
  sent: { text: string; buttons?: OutgoingButton[] }[] = [];
  answers: { id: string; text?: string }[] = [];
  edits: { messageId: string; text: string }[] = [];

  async sendMessage(_chatId: string, text: string) {
    this.sent.push({ text });
  }
  async sendMessageWithButtons(_chatId: string, text: string, buttons: OutgoingButton[]) {
    this.sent.push({ text, buttons });
  }
  async answerCallback(id: string, text?: string) {
    this.answers.push({ id, text });
  }
  async editMessageText(_chatId: string, messageId: string, text: string) {
    this.edits.push({ messageId, text });
  }
  readonly channel = 'telegram' as const;
  onMessage() {}
  onCallback() {}
  async start() {}
  async stop() {}
  async downloadFile() { return { buffer: Buffer.alloc(0), remotePath: '' }; }
}

/** 工地 stub：只認 SMKA（writeRecord 與 manual_code 守門都用 findByCode） */
const projectStore = {
  findByCode: (code: string) =>
    code.toUpperCase() === 'SMKA' ? { code: 'SMKA', name: '煙霧追加工地' } : undefined,
} as never;

function msgOf(partial: Partial<IncomingMessage>): IncomingMessage {
  return {
    channel: 'telegram',
    chatId: '-100',
    messageId: 'm-x',
    reporterId: 'u1',
    reporterName: '阿明',
    photos: [],
    date: Math.floor(Date.now() / 1000),
    ...partial,
  };
}

function cbOf(data: string): IncomingCallback {
  return {
    channel: 'telegram',
    callbackId: `cbid-${data}`,
    data,
    chatId: '-100',
    messageId: '777',
    fromId: 'u1',
    fromName: '阿明',
  };
}

/** 建一個假暫存檔並回 IntakeResult */
async function stageFile(
  dir: string,
  name: string,
  uploadType: IntakeResult['uploadType'],
): Promise<IntakeResult> {
  await mkdir(dir, { recursive: true });
  const p = join(dir, name);
  await writeFile(p, `fake-${name}`);
  return { filePath: p, uploadType, bytes: 99, exif: {} };
}

async function run() {
  let pass = 0;
  let fail = 0;
  const ok = (cond: boolean, label: string) => {
    if (cond) { pass++; console.log(`  ✅ ${label}`); }
    else { fail++; console.log(`  ❌ ${label}`); }
  };

  const adapter = new StubAdapter();
  const db = new Db(':memory:');
  await db.init();
  const store = new LastRecordStore();
  const appends = new AppendStore();
  const resolver = new SiteResolver(projectStore, new UserContextStore());
  const t0 = Date.now();

  // ---- 0) 建基底紀錄（一張照片＋備註）----
  const baseIntake = [
    await stageFile(join('data', '_staging', 'smka-base'), '1.jpg', 'photo'),
  ];
  const base = await writeRecord(
    db,
    msgOf({ messageId: 'm-1', text: '三樓樑柱裂縫' }),
    baseIntake,
    { projectCode: 'SMKA', method: 'manual_code' } as never,
    projectStore,
  );
  store.set('u1', base.recordId, t0);

  // ---- 1) isAppendCandidate 判定 ----
  console.log('1) 追加候選判定');
  ok(isAppendCandidate(msgOf({ photos: [{ fileId: 'v', uploadType: 'voice' }] })), '純語音 → 是');
  ok(isAppendCandidate(msgOf({ text: '補充說明' })), '純文字 → 是');
  ok(!isAppendCandidate(msgOf({ photos: [{ fileId: 'p', uploadType: 'photo' }] })), '帶照片 → 否（開新筆）');
  ok(!isAppendCandidate(msgOf({ location: { latitude: 25, longitude: 121 } })), '帶位置 → 否（走定位流程）');

  // ---- 2) findAppendTarget 守門 ----
  console.log('2) 併入目標守門');
  ok(findAppendTarget(store, db, resolver, msgOf({ text: '補充' }), t0 + 1000) === base.recordId, '時間窗內 → 命中上一筆');
  ok(findAppendTarget(store, db, resolver, msgOf({ text: '到 SMKA 了' }), t0 + 1000) === null, '文字含工地代碼 → 不併（切工地語意）');
  ok(findAppendTarget(store, db, resolver, msgOf({ text: '補充', reporterId: 'u2' }), t0 + 1000) === null, '別人傳的 → 不併');
  ok(findAppendTarget(store, db, resolver, msgOf({ text: '補充' }), t0 + 11 * 60 * 1000) === null, '超過 10 分鐘 → 不併');

  // ---- 3) 追加語音（帶說明文字）----
  console.log('3) 語音＋文字併入上一筆');
  const voiceIntake = [
    await stageFile(join('data', '_staging', 'smka-voice'), '1.oga', 'voice'),
  ];
  await appendToRecord(
    adapter as never, db, store, appends,
    msgOf({ messageId: 'm-2', caption: '口頭補充：鋼筋外露' }),
    voiceIntake, base.recordId, t0 + 60_000,
  );
  const photos = db.getPhotos(base.recordId);
  ok(photos.length === 2, '紀錄媒體變 2 件');
  ok(photos[1].uploadType === 'voice' && photos[1].filePath.endsWith(`${base.recordNo}-02.oga`), `錄音續編為 -02.oga：${photos[1].filePath}`);
  ok(await exists(photos[1].filePath), '錄音檔已搬進同一資料夾');
  const recAfter = db.getRecordFull(base.recordId);
  ok(recAfter?.textNote === '三樓樑柱裂縫\n口頭補充：鋼筋外露', `備註已合併：${recAfter?.textNote}`);
  const meta = JSON.parse(await readFile(join(base.archiveDir, 'metadata.json'), 'utf8'));
  ok(meta.photos.length === 2 && meta.photos[1].upload_type === 'voice', 'metadata.photos 已更新');
  ok(meta.text_note === '三樓樑柱裂縫\n口頭補充：鋼筋外露', 'metadata.text_note 已更新');
  ok((await readFile(join(base.archiveDir, 'text.txt'), 'utf8')).includes('鋼筋外露'), 'text.txt 已更新');
  const reply = adapter.sent.at(-1);
  ok(!!reply && reply.text.includes(`已併入 ${base.recordNo}`), '回覆「已併入」');
  ok(!!reply?.buttons?.[0]?.callbackData.startsWith('sp:'), '附「🆕 拆成新筆」按鈕');

  // ---- 4) 已按 ✅ 的紀錄不再併 ----
  console.log('4) 封單後不再併');
  db.updateStatus(base.recordId, '待改善', 'u1');
  ok(findAppendTarget(store, db, resolver, msgOf({ text: '補' }), t0 + 120_000) === null, '狀態離開 待確認 → 不併');
  db.updateStatus(base.recordId, '待確認', 'u1'); // 還原供後續拆單測試

  // ---- 5) 拆成新筆 ----
  console.log('5) 🆕 拆成新筆');
  const splitData = reply!.buttons![0].callbackData;
  ok(isSplitCallback(cbOf(splitData)), 'sp:… 判定為拆單回呼');
  await handleSplitCallback(adapter as never, db, store, appends, cbOf(splitData), t0 + 180_000);
  const oldPhotos = db.getPhotos(base.recordId);
  ok(oldPhotos.length === 1, '原紀錄媒體還原為 1 件');
  ok(db.getRecordFull(base.recordId)?.textNote === '三樓樑柱裂縫', '原紀錄備註已還原');
  const oldMeta = JSON.parse(await readFile(join(base.archiveDir, 'metadata.json'), 'utf8'));
  ok(oldMeta.photos.length === 1 && oldMeta.text_note === '三樓樑柱裂縫', '原紀錄 metadata 已還原');
  const editMsg = adapter.edits.at(-1);
  ok(!!editMsg && editMsg.text.includes('已拆成新筆'), '訊息就地更新為已拆單');
  const newRecordNo = editMsg!.text.match(/SMKA-\d{8}-\d{3}/)?.[0] ?? '';
  ok(newRecordNo !== '' && newRecordNo !== base.recordNo, `新紀錄編號：${newRecordNo}`);
  const confirmMsg = adapter.sent.at(-1);
  ok(!!confirmMsg && confirmMsg.text.includes(`已建檔 ${newRecordNo}`) && confirmMsg.text.includes('🎤 錄音：1 則'), '新筆補發 ✅/✏️ 確認（含錄音計數）');
  // 從確認按鈕取 recordId 驗 DB 與檔案
  const newId = Number(confirmMsg!.buttons![0].callbackData.split(':')[1]);
  const newPhotos = db.getPhotos(newId);
  ok(newPhotos.length === 1 && newPhotos[0].filePath.endsWith(`${newRecordNo}-01.oga`), '錄音已搬到新紀錄目錄並重新編號');
  ok(await exists(newPhotos[0].filePath), '新紀錄錄音檔存在');
  ok(db.getRecordFull(newId)?.textNote === '口頭補充：鋼筋外露', '新紀錄備註＝拆出的片段');

  // ---- 6) 重複拆 → 防呆 ----
  console.log('6) 重複拆防呆');
  await handleSplitCallback(adapter as never, db, store, appends, cbOf(splitData), t0 + 200_000);
  ok(adapter.answers.at(-1)?.text?.includes('找不到可拆') === true, '同一筆追加只能拆一次');

  db.close();

  // ---- 清掉測試殘檔 ----
  await rm(join('data', 'projects', 'SMKA_煙霧追加工地'), { recursive: true, force: true });
  await rm(join('data', '_staging', 'smka-base'), { recursive: true, force: true }).catch(() => {});
  await rm(join('data', '_staging', 'smka-voice'), { recursive: true, force: true }).catch(() => {});
  console.log('  🧹 已清掉 SMKA 測試資料夾與暫存殘檔');

  console.log(`\n結果：${pass} 通過 / ${fail} 失敗`);
  process.exit(fail === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error('smoke test 異常', err);
  process.exit(1);
});
