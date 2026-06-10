// ============================================================
// smoke-confirm.ts — 5-3a 人工確認流程離線驗收（不需 Telegram）
// in-memory SQLite + stub adapter，驗證：摘要按鈕、✅ 狀態轉移、重複按防呆、
// 找不到紀錄、✏️ 佔位回覆、未知動作。
// 用法：npx tsx scripts/smoke-confirm.ts
// ============================================================
import { Db } from '../src/db';
import type { IncomingCallback } from '../src/channels/types';
import type { OutgoingButton } from '../src/channels/MessageChannelAdapter';
import {
  handleConfirmCallback,
  promptConfirm,
} from '../src/core/confirm/confirmFlow';
import { UserContextStore } from '../src/core/resolve/UserContextStore';

/** 只實作 confirmFlow 會用到的 adapter 方法，並錄下呼叫 */
class StubAdapter {
  sent: { text: string; buttons: OutgoingButton[] }[] = [];
  answers: { id: string; text?: string }[] = [];
  edits: { messageId: string; text: string }[] = [];

  async sendMessageWithButtons(_chatId: string, text: string, buttons: OutgoingButton[]) {
    this.sent.push({ text, buttons });
  }
  async answerCallback(id: string, text?: string) {
    this.answers.push({ id, text });
  }
  async editMessageText(_chatId: string, messageId: string, text: string) {
    this.edits.push({ messageId, text });
  }
  // confirmFlow 不會用到的方法給空殼，滿足型別
  readonly channel = 'telegram' as const;
  onMessage() {}
  onCallback() {}
  async start() {}
  async stop() {}
  async downloadFile() { return { buffer: Buffer.alloc(0), remotePath: '' }; }
  async sendMessage() {}
}

/** 空工地清單 stub（siteFlow 只用到 listActive / findByCode） */
const emptyProjects = {
  listActive: () => [],
  findByCode: () => undefined,
} as never;
/** 上下文 stub（本檔不測選定工地，僅滿足簽名） */
const contextStore = new UserContextStore();

function cb(data: string): IncomingCallback {
  return {
    channel: 'telegram',
    callbackId: `cbid-${data}`,
    data,
    chatId: '-100',
    messageId: '555',
    fromId: 'u1',
    fromName: '阿明',
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

  // 建一筆 待確認 紀錄
  const recordId = db.insertRecord('A001-20260605-001', {
    channel: 'telegram',
    projectCode: 'A001',
    projectName: '信義豪宅案',
    resolveMethod: 'manual_code',
    textNote: '三樓樑柱裂縫',
    reporterId: 'u1',
    reporterName: '阿明',
    sourceMessageId: '1',
    mediaGroupId: null,
    gpsLat: null,
    gpsLng: null,
    status: '待確認',
    takenAt: null,
    receivedAt: '2026-06-05T08:00:00.000Z',
  });
  db.insertStatusLog(recordId, null, '待確認', 'u1');

  // 1) promptConfirm 送出摘要 + 兩顆按鈕
  console.log('1) 送出整理結果 + ✅/✏️');
  await promptConfirm(adapter as never, '-100', {
    recordId,
    recordNo: 'A001-20260605-001',
    projectLabel: 'A001 信義豪宅案',
    method: 'manual_code',
    photoCount: 2,
    note: '三樓樑柱裂縫',
    reporterName: '阿明',
  });
  ok(adapter.sent.length === 1, '送出一則訊息');
  ok(adapter.sent[0].buttons.length === 2, '附兩顆按鈕');
  ok(adapter.sent[0].buttons[0].callbackData === `c:${recordId}`, '✅ 按鈕 callbackData 正確');
  ok(adapter.sent[0].buttons[1].callbackData === `e:${recordId}`, '✏️ 按鈕 callbackData 正確');
  ok(adapter.sent[0].text.includes('A001-20260605-001') && adapter.sent[0].text.includes('三樓樑柱裂縫'), '摘要含編號與備註');

  // 2) 按 ✅ → 待確認 → 待改善，就地更新訊息
  console.log('2) 按 ✅ 正確');
  await handleConfirmCallback(adapter as never, db, emptyProjects, contextStore, cb(`c:${recordId}`));
  ok(db.getRecordById(recordId)?.status === '待改善', '狀態轉為 待改善');
  ok(adapter.answers.at(-1)?.text === '已確認 ✅', 'answerCallback 回「已確認」');
  ok(adapter.edits.length === 1 && adapter.edits[0].text.includes('已確認定案'), '訊息就地更新為已定案');

  // 3) 重複按 ✅ → 防呆，不重複轉移
  console.log('3) 重複按 ✅');
  const editsBefore = adapter.edits.length;
  await handleConfirmCallback(adapter as never, db, emptyProjects, contextStore, cb(`c:${recordId}`));
  ok(adapter.answers.at(-1)?.text === '已經確認過了', '重按提示「已經確認過了」');
  ok(adapter.edits.length === editsBefore, '不再就地更新訊息');

  // 4) 找不到紀錄
  console.log('4) 不存在的紀錄');
  await handleConfirmCallback(adapter as never, db, emptyProjects, contextStore, cb('c:99999'));
  ok(adapter.answers.at(-1)?.text === '找不到這筆紀錄', '回「找不到這筆紀錄」');

  // 5) ✏️ 修改 → 叫出工地選單；此測試無工地 → 提示先設定工地
  console.log('5) 按 ✏️ 修改（無工地）');
  await handleConfirmCallback(adapter as never, db, emptyProjects, contextStore, cb(`e:${recordId}`));
  ok(adapter.answers.at(-1)?.text?.includes('尚未設定工地') ?? false, '✏️ 無工地時提示先 /addproject');

  // 6) 未知動作
  console.log('6) 未知 callback data');
  await handleConfirmCallback(adapter as never, db, emptyProjects, contextStore, cb('x:1'));
  ok(adapter.answers.at(-1)?.text === '無法辨識的操作', '未知動作回「無法辨識的操作」');

  db.close();
  console.log(`\n結果：${pass} 通過 / ${fail} 失敗`);
  process.exit(fail === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error('smoke test 異常', err);
  process.exit(1);
});
