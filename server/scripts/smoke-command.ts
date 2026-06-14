// ============================================================
// smoke-command.ts — /新增工地 自動編碼 + 沿用定位 離線驗收（不需 Telegram）
// 驗收 5-B2：
//   A. ProjectStore.nextAutoCode 自動編碼規則（前綴自適應、找空號補缺）
//   B. handleCommand /新增工地：只給名稱自動編碼、名稱含空格、指定碼向後相容、
//      有暫存定位則自動當中心+設上下文、無參數用法提示
// 全程用暫存 seed，不碰正式 projects.seed.json。
// 用法：npx tsx scripts/smoke-command.ts
// ============================================================
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { IncomingMessage } from '../src/channels/types';
import { ProjectStore } from '../src/core/projects/ProjectStore';
import { PendingSiteStore } from '../src/core/projects/PendingSiteStore';
import { PendingLocationStore } from '../src/core/projects/PendingLocationStore';
import { UserContextStore } from '../src/core/resolve/UserContextStore';
import { handleCommand } from '../src/core/commands/handleCommand';

const TMP_DIR = join('data', '_smoke', 'command');
const TMP_SEED = join(TMP_DIR, 'projects.seed.json');

const P = (code: string, name: string) => ({
  code, name, centerLat: null, centerLng: null, radiusMeters: null, active: true,
});

class StubAdapter {
  sent: string[] = [];
  async sendMessage(_c: string, text: string) { this.sent.push(text); }
  readonly channel = 'telegram' as const;
  onMessage() {} onCallback() {}
  async start() {} async stop() {}
  async sendMessageWithButtons() {}
  async answerCallback() {}
  async editMessageText() {}
  async downloadFile() { return { buffer: Buffer.alloc(0), remotePath: '' }; }
  last() { return this.sent.at(-1) ?? ''; }
}

function msg(text: string, reporterId = 'u1'): IncomingMessage {
  return { channel: 'telegram', chatId: '-100', messageId: '1', reporterId, reporterName: '測試員', text, photos: [], date: 0 };
}

async function freshStore(seed: object[]): Promise<ProjectStore> {
  await writeFile(TMP_SEED, JSON.stringify(seed));
  const s = new ProjectStore(TMP_SEED);
  await s.load();
  return s;
}

async function run() {
  let pass = 0, fail = 0;
  const ok = (c: boolean, l: string) => {
    if (c) { pass++; console.log(`  ✅ ${l}`); } else { fail++; console.log(`  ❌ ${l}`); }
  };

  await rm(join('data', '_smoke'), { recursive: true, force: true });
  await mkdir(TMP_DIR, { recursive: true });

  // ---- A) nextAutoCode 自動編碼規則 ----
  console.log('A) nextAutoCode 自動編碼規則');
  ok((await freshStore([])).nextAutoCode() === 'A001', '空清單 → A001');
  ok((await freshStore([P('A001', '一'), P('A002', '二'), P('C001', '三')])).nextAutoCode() === 'A003', 'A001/A002/C001 → A003（A 最常用、找空號）');
  ok((await freshStore([P('A001', '一'), P('A003', '三')])).nextAutoCode() === 'A002', '缺號 A002 被補回（不重用不跳號）');
  ok((await freshStore([P('B001', '一'), P('B002', '二'), P('A005', '五')])).nextAutoCode() === 'B003', '前綴自適應：B 最多 → B003');

  // ---- B) handleCommand /新增工地 自動編碼路徑 ----
  console.log('B) /新增工地 自動編碼路徑');
  const store = await freshStore([P('A001', '青山苑')]);
  const pending = new PendingSiteStore();
  const pendingLoc = new PendingLocationStore();
  const contexts = new UserContextStore();
  const adapter = new StubAdapter();

  await handleCommand(adapter as never, msg('/新增工地 林口廠房'), store, pending, pendingLoc, contexts);
  ok(store.findByCode('A002')?.name === '林口廠房', '只給名稱 → 自動編 A002 + 名稱正確');
  ok(adapter.last().includes('自動配'), '回覆點明代號是自動配的');

  await handleCommand(adapter as never, msg('/新增工地 林口 第二廠'), store, pending, pendingLoc, contexts);
  ok(store.findByCode('A003')?.name === '林口 第二廠', '名稱含空格 → A003 + 完整名稱');

  await handleCommand(adapter as never, msg('/新增工地 X9 桃園案'), store, pending, pendingLoc, contexts);
  ok(store.findByCode('X9')?.name === '桃園案', '指定碼 X9 名稱 向後相容');

  await handleCommand(adapter as never, msg('/新增工地 B002 林口廠房 25.078 121.349 300'), store, pending, pendingLoc, contexts);
  ok(store.findByCode('B002')?.centerLat === 25.078, '指定碼 + 座標一次帶全 向後相容');

  // 有暫存定位 → 自動編碼 + 用定位當中心 + 設 2 小時上下文
  const reporter = 'u-loc';
  pendingLoc.set(reporter, { latitude: 25.1, longitude: 121.3 }, Date.now());
  await handleCommand(adapter as never, msg('/新增工地 現場工地', reporter), store, pending, pendingLoc, contexts);
  const auto = store.list().find((p) => p.name === '現場工地');
  ok(!!auto && auto.centerLat === 25.1, '有暫存定位 → 自動用定位當中心、開 GPS');
  ok(!!auto && contexts.get(reporter, Date.now()) === auto.code, '設 2 小時上下文（後續照片自動歸）');
  ok(adapter.last().includes('自動配') && adapter.last().includes('定位'), '回覆同時點明自動代號與定位');

  await handleCommand(adapter as never, msg('/新增工地'), store, pending, pendingLoc, contexts);
  ok(adapter.last().includes('自動配'), '無參數 → 用法提示（免代號）');

  await rm(join('data', '_smoke'), { recursive: true, force: true });
  console.log(`\n結果：${pass} 通過 / ${fail} 失敗`);
  process.exit(fail === 0 ? 0 : 1);
}

run().catch((e) => { console.error('smoke-command 異常', e); process.exit(1); });
