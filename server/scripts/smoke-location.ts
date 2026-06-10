// ============================================================
// smoke-location.ts — 「單獨傳定位」判斷＋詢問流程 離線驗收（不需 Telegram）
// 模擬：使用者單獨傳一個定位（無照片、無文字），驗證：
//   1) 定位落在工地範圍內 → 回覆判定到的工地 + 「✏️ 改工地」按鈕
//   2) 定位不在任何工地範圍 → 跳工地選單詢問（loc:{code} + loc:_skip）
//   3) loc:_pick → 就地改成完整工地選單
//   4) loc:_skip → 略過、不記工地
//   5) loc:{code} → 設「目前工地」上下文（不搬檔）；之後無 GPS 的定位改走 recent_context
// 用法：npx tsx scripts/smoke-location.ts
// ============================================================
import type {
  IncomingCallback,
  IncomingMessage,
  IncomingLocation,
} from '../src/channels/types';
import type { OutgoingButton } from '../src/channels/MessageChannelAdapter';
import { SiteResolver } from '../src/core/resolve/SiteResolver';
import { UserContextStore } from '../src/core/resolve/UserContextStore';
import {
  promptBareLocation,
  handleLocationCallback,
} from '../src/core/confirm/locationFlow';

class StubAdapter {
  sent: { text: string; buttons?: OutgoingButton[]; columns?: number }[] = [];
  answers: { id: string; text?: string }[] = [];
  edits: { text: string; buttons?: OutgoingButton[] }[] = [];
  async sendMessage(_c: string, text: string) {
    this.sent.push({ text });
  }
  async sendMessageWithButtons(
    _c: string,
    text: string,
    buttons: OutgoingButton[],
    columns?: number,
  ) {
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
}

// 工地 stub：A001 中心(24.18,120.66)，只有「靠近」的座標才命中 findByGps
const PROJ = { code: 'A001', name: '信義豪宅案', centerLat: 24.18, centerLng: 120.66, radiusMeters: 300, active: true };
const INSIDE: IncomingLocation = { latitude: 24.1801, longitude: 120.6601 };
const OUTSIDE: IncomingLocation = { latitude: 25.05, longitude: 121.5 };
const projectStore = {
  listActive: () => [PROJ],
  findByCode: (c: string) => (c.toUpperCase() === PROJ.code ? PROJ : undefined),
  findByGps: (lat: number, lng: number) =>
    Math.abs(lat - PROJ.centerLat) < 0.01 && Math.abs(lng - PROJ.centerLng) < 0.01
      ? { project: PROJ, distanceM: 32 }
      : undefined,
} as never;

function msg(location: IncomingLocation, reporterId = 'u9'): IncomingMessage {
  return {
    channel: 'telegram',
    chatId: '-100',
    messageId: '1',
    reporterId,
    reporterName: '工地主任',
    photos: [],
    location,
    date: 0,
  };
}

function cb(data: string, fromId = 'u9'): IncomingCallback {
  return {
    channel: 'telegram',
    callbackId: `cbid-${data}`,
    data,
    chatId: '-100',
    messageId: '777',
    fromId,
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

  // 用真實時間：SiteResolver 內部以 Date.now() 算 recent_context TTL，
  // 設上下文的時間必須與之同基準，第 5 步「沿用」才會在 2 小時 TTL 內命中。
  const NOW = Date.now();
  const contexts = new UserContextStore();
  const resolver = new SiteResolver(projectStore, contexts);
  const adapter = new StubAdapter();

  // ---- 1) 定位落在工地範圍內 → 回覆判定 + ✏️ 改工地 ----
  console.log('1) 定位在工地範圍內（telegram_location 命中）');
  await promptBareLocation(adapter as never, resolver, projectStore, msg(INSIDE));
  const m1 = adapter.sent.at(-1);
  ok(m1?.text.includes('A001 信義豪宅案') ?? false, '回覆含判定到的工地');
  ok(m1?.text.includes('32m') ?? false, '回覆含距離');
  ok(m1?.buttons?.[0].callbackData === 'loc:_pick', '附「✏️ 改工地」(loc:_pick) 按鈕');

  // ---- 2) 定位不在任何工地 → 跳選單詢問 ----
  console.log('2) 定位不在任何工地（unresolved → 選單）');
  const adapter2 = new StubAdapter();
  // 換一個沒有上下文的回報人，避免沿用第 1 步設的上下文
  await promptBareLocation(adapter2 as never, resolver, projectStore, msg(OUTSIDE, 'uNew'));
  const m2 = adapter2.sent.at(-1);
  ok(m2?.text.includes('哪個工地') ?? false, '送出「你現在在哪個工地」詢問');
  ok(m2?.buttons?.[0].callbackData === 'loc:A001', '選單含工地按鈕 loc:A001');
  ok(m2?.buttons?.at(-1)?.callbackData === 'loc:_skip', '選單含「略過」loc:_skip');

  // ---- 3) loc:_pick → 就地改成完整選單 ----
  console.log('3) loc:_pick 叫出完整選單');
  const a3 = new StubAdapter();
  await handleLocationCallback(a3 as never, projectStore, contexts, cb('loc:_pick', 'uNew'), NOW);
  ok((a3.edits.at(-1)?.buttons?.length ?? 0) === 2, '選單含 1 工地 + 略過 共 2 顆');

  // ---- 4) loc:_skip → 略過 ----
  console.log('4) loc:_skip 略過');
  const a4 = new StubAdapter();
  await handleLocationCallback(a4 as never, projectStore, contexts, cb('loc:_skip', 'uNew'), NOW);
  ok(a4.edits.at(-1)?.text.includes('已略過') ?? false, '訊息更新為「已略過」');
  ok(contexts.get('uNew', NOW) === null, '略過後不留任何工地上下文');

  // ---- 5) loc:{code} → 設目前工地；之後無 GPS 定位走 recent_context ----
  console.log('5) loc:A001 設目前工地 → 之後沿用');
  const a5 = new StubAdapter();
  await handleLocationCallback(a5 as never, projectStore, contexts, cb('loc:A001', 'uNew'), NOW);
  ok(a5.answers.at(-1)?.text === '已記住 ✅', '回呼回「已記住」');
  ok(a5.edits.at(-1)?.text.includes('已記住你在 A001') ?? false, '訊息更新為「已記住你在 A001」');
  ok(contexts.get('uNew', NOW) === 'A001', '上下文已記為 A001');

  // 同一人之後再傳「不在工地範圍」的定位 → 應改走 recent_context 沿用 A001
  const a5b = new StubAdapter();
  await promptBareLocation(a5b as never, resolver, projectStore, msg(OUTSIDE, 'uNew'));
  ok(a5b.sent.at(-1)?.text.includes('沿用你最近的工地') ?? false, '記住後，新定位走 recent_context 沿用');

  console.log(`\n結果：${pass} 通過 / ${fail} 失敗`);
  process.exit(fail === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error('smoke test 異常', err);
  process.exit(1);
});
