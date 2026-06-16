// ============================================================
// smoke-line.ts — LINE 通道 L2 離線驗收（不需真 LINE / 不碰 Telegram）
// 起一個真的 LineAdapter webhook server（綁 127.0.0.1），用簽好章的假 webhook
// POST 進去，驗證：
//   ① X-Line-Signature 驗簽（正確放行 / 錯誤回 401）
//   ② 事件正規化（text / image / location 的欄位）
//   ③ 同人去抖合併（image 帶合成 mediaGroupId，多張經 MediaGroupAggregator 併成一筆）
//   ④ getGroupMemberProfile 取顯示名稱 + 快取（同人只打一次 profile API）
//   ⑤ downloadFile：打 /v2/bot/message/{id}/content、Content-Type 推副檔名
// 對 LINE 官方 API 的呼叫一律用 stub 攔截（換掉 globalThis.fetch），本機 POST 走 node:http。
// 用法：npx tsx scripts/smoke-line.ts
// ============================================================
import http from 'node:http';
import { createHmac } from 'node:crypto';
import type { AppConfig } from '../src/config/env';
import type { IncomingCallback, IncomingMessage } from '../src/channels/types';
import { LineAdapter } from '../src/channels/line/LineAdapter';
import { MediaGroupAggregator } from '../src/core/ingest/MediaGroupAggregator';

const SECRET = 'test-channel-secret';
const TOKEN = 'test-access-token';
const PORT = 3997; // 測試專用埠，避開正式 3010
const PATH = '/line/webhook';

/** 最小可用的 AppConfig（只填 LINE 相關＋必要欄位） */
const config: AppConfig = {
  telegramBotToken: 'unused',
  telegramAllowedChatId: '',
  telegramPollTimeout: 30,
  telegramAdminChatId: '',
  healthcheckUrl: '',
  healthcheckIntervalSec: 60,
  lineChannelSecret: SECRET,
  lineChannelAccessToken: TOKEN,
  lineAllowedGroupId: '',
  lineWebhookPort: PORT,
  lineWebhookPath: PATH,
};

/** 攔截對 LINE 官方 API 的呼叫，計數／側錄並回假資料；本機 127.0.0.1 不會走到這（用 node:http） */
const apiCalls = { profile: 0, content: 0, push: 0 };
/** 側錄每次 push 的 body（{to, messages}），供 L3 斷言按鈕/文字內容 */
const pushed: { to: string; messages: any[] }[] = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  // 送訊息（push）——要在 profile 分支之前判斷，因網址同樣含 api.line.me/v2/bot/
  if (url.includes('/v2/bot/message/push')) {
    apiCalls.push++;
    pushed.push(JSON.parse(String(init?.body ?? '{}')));
    return new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  // 取顯示名稱：group member / room member / profile 都走 api.line.me/v2/bot/
  if (url.includes('://api.line.me/v2/bot/')) {
    apiCalls.profile++;
    return new Response(JSON.stringify({ displayName: '王小明' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  // 內容下載走 api-data.line.me
  if (url.includes('://api-data.line.me/')) {
    apiCalls.content++;
    return new Response(Buffer.from('FAKE-JPEG-BYTES'), {
      status: 200,
      headers: { 'content-type': 'image/jpeg' },
    });
  }
  return originalFetch(input, init);
}) as typeof fetch;

const sign = (body: string) => createHmac('sha256', SECRET).update(body).digest('base64');

/** POST 一包 webroot body 到本機 webhook，回應 status；signature 可覆寫成壞值 */
function postWebhook(
  body: string,
  signature = sign(body),
): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: PORT,
        path: PATH,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          'x-line-signature': signature,
        },
      },
      (res) => {
        res.on('data', () => {});
        res.on('end', () => resolve({ status: res.statusCode ?? 0 }));
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 組一個 LINE webhook event 包 */
function payload(events: unknown[]): string {
  return JSON.stringify({ destination: 'Uxxxx', events });
}

async function run(): Promise<void> {
  let pass = 0;
  let fail = 0;
  const ok = (cond: boolean, label: string) => {
    if (cond) { pass++; console.log(`  ✅ ${label}`); }
    else { fail++; console.log(`  ❌ ${label}`); }
  };

  // 收到的（已合併）紀錄收集起來；adapter → aggregator(去抖 80ms) → 收集
  const received: IncomingMessage[] = [];
  const callbacks: IncomingCallback[] = [];
  const aggregator = new MediaGroupAggregator((m) => { received.push(m); }, 80);
  const adapter = new LineAdapter(config);
  adapter.onMessage((m) => aggregator.push(m));
  adapter.onCallback((cb) => { callbacks.push(cb); });
  await adapter.start();

  try {
    // ---- 1) 驗簽：壞簽章回 401、不進 handler ----
    console.log('1) 驗簽：壞 X-Line-Signature 應回 401');
    const before = received.length;
    const bad = await postWebhook(
      payload([{ type: 'message', message: { id: 'x', type: 'text', text: 'hi' }, source: { type: 'user', userId: 'Uhack' } }]),
      'this-is-a-wrong-signature',
    );
    await sleep(150);
    ok(bad.status === 401, `壞簽章回 401（實得 ${bad.status}）`);
    ok(received.length === before, '壞簽章訊息未進 handler');

    // ---- 2) 正規化：群組 text 訊息 ----
    console.log('2) 群組 text 訊息正規化 + 取顯示名稱');
    apiCalls.profile = 0;
    await postWebhook(
      payload([{
        type: 'message',
        timestamp: 1700000000000,
        message: { id: 'm-text-1', type: 'text', text: 'A001 三樓灌漿完成' },
        source: { type: 'group', groupId: 'Cgroup1', userId: 'Ualice' },
      }]),
    );
    await sleep(200);
    const t = received.find((m) => m.messageId === 'm-text-1');
    ok(!!t, '收到 text 訊息');
    ok(t?.text === 'A001 三樓灌漿完成', 'text 內容正確');
    ok(t?.chatId === 'Cgroup1', 'chatId = groupId');
    ok(t?.reporterId === 'Ualice', 'reporterId = userId');
    ok(t?.reporterName === '王小明', 'reporterName 取自 group member API');
    ok(t?.mediaGroupId === undefined, 'text 無 mediaGroupId（即時放行）');
    ok(apiCalls.profile === 1, 'group member API 打 1 次');

    // ---- 3) 同人去抖合併：一次傳兩張 image → 併成一筆兩張 ----
    console.log('3) 同人去抖合併：兩張 image 併成一筆');
    apiCalls.profile = 0;
    const beforeImg = received.length;
    await postWebhook(
      payload([
        { type: 'message', timestamp: 1700000001000, message: { id: 'm-img-1', type: 'image' }, source: { type: 'group', groupId: 'Cgroup1', userId: 'Ubob' } },
        { type: 'message', timestamp: 1700000001050, message: { id: 'm-img-2', type: 'image' }, source: { type: 'group', groupId: 'Cgroup1', userId: 'Ubob' } },
      ]),
    );
    await sleep(300); // 等去抖（80ms）flush
    const merged = received.slice(beforeImg);
    ok(merged.length === 1, `兩張 image 併成 1 筆（實得 ${merged.length} 筆）`);
    ok(merged[0]?.photos.length === 2, '合併後含 2 張照片');
    ok(merged[0]?.photos.every((p) => p.uploadType === 'photo'), '皆為 photo');
    ok(merged[0]?.mediaGroupId === 'line:Ubob', '合成 mediaGroupId = line:{userId}');
    ok(apiCalls.profile === 1, '同人顯示名稱有快取（兩張只打 1 次 profile）');

    // ---- 4) location 訊息正規化 ----
    console.log('4) location 訊息正規化');
    await postWebhook(
      payload([{
        type: 'message',
        message: { id: 'm-loc-1', type: 'location', latitude: 25.033, longitude: 121.565 },
        source: { type: 'group', groupId: 'Cgroup1', userId: 'Ualice' },
      }]),
    );
    await sleep(200);
    const loc = received.find((m) => m.messageId === 'm-loc-1');
    ok(loc?.location?.latitude === 25.033 && loc?.location?.longitude === 121.565, '經緯度正確');
    ok(loc?.mediaGroupId === undefined, 'location 無 mediaGroupId');
    ok(loc?.photos.length === 0, 'location 無照片');

    // ---- 5) downloadFile：打 content 端點、Content-Type 推副檔名 ----
    console.log('5) downloadFile：/message/{id}/content + 副檔名');
    apiCalls.content = 0;
    const dl = await adapter.downloadFile('m-img-1');
    ok(apiCalls.content === 1, 'content API 打 1 次');
    ok(dl.buffer.toString() === 'FAKE-JPEG-BYTES', '下載位元組正確');
    ok(dl.remotePath.endsWith('.jpg'), `Content-Type image/jpeg → .jpg（${dl.remotePath}）`);
    ok(dl.fileSize === dl.buffer.length, 'fileSize = 位元組長度');

    // ---- 6) L3 sendMessage：push 純文字 ----
    console.log('6) L3 sendMessage → push 純文字');
    pushed.length = 0;
    await adapter.sendMessage('Cgroup1', '✅ 已自動歸檔，不用回覆');
    ok(pushed.length === 1, 'push 呼叫 1 次');
    ok(pushed[0]?.to === 'Cgroup1', 'push to = chatId');
    ok(pushed[0]?.messages[0]?.type === 'text', '訊息型別 text');
    ok(pushed[0]?.messages[0]?.text === '✅ 已自動歸檔，不用回覆', '文字內容正確');
    ok(pushed[0]?.messages[0]?.quickReply === undefined, '純文字無 quickReply');

    // ---- 7) L3 sendMessageWithButtons：quick reply（postback、label 截 20 字）----
    console.log('7) L3 sendMessageWithButtons → quick reply');
    pushed.length = 0;
    await adapter.sendMessageWithButtons('Cgroup1', '選一個工地：', [
      { text: '✅ 沒問題', callbackData: 'c:42' },
      { text: '這是一個超級無敵長到爆炸會被截斷的工地名稱字串', callbackData: 's:42:A001' },
    ]);
    const qr = pushed[0]?.messages[0]?.quickReply;
    ok(!!qr, '帶 quickReply');
    ok(qr?.items?.length === 2, '兩顆按鈕');
    ok(qr?.items[0]?.action?.type === 'postback', 'action 型別 postback');
    ok(qr?.items[0]?.action?.data === 'c:42', 'callbackData 進 postback data');
    ok(qr?.items[0]?.action?.label === '✅ 沒問題', '短文字 label 原樣');
    ok((qr?.items[1]?.action?.label?.length ?? 99) === 20, `長 label 截到 20 字（實 ${qr?.items[1]?.action?.label?.length}）`);
    ok(qr?.items[1]?.action?.displayText?.startsWith('這是一個超級'), 'displayText 保留完整文字');

    // ---- 8) L3 quick reply 上限 13：超量取前 13 ----
    console.log('8) L3 quick reply 超過 13 顆 → 取前 13');
    pushed.length = 0;
    const many = Array.from({ length: 20 }, (_, i) => ({ text: `工地${i}`, callbackData: `s:${i}` }));
    await adapter.sendMessageWithButtons('Cgroup1', '太多了：', many);
    ok(pushed[0]?.messages[0]?.quickReply?.items?.length === 13, '只送前 13 顆');

    // ---- 9) L3 editMessageText：LINE 不能編輯 → 改送新訊息 ----
    console.log('9) L3 editMessageText → 改送新訊息');
    pushed.length = 0;
    await adapter.editMessageText('Cgroup1', 'ignored-msg-id', '✅ 已定案：A001');
    ok(pushed.length === 1 && pushed[0]?.messages[0]?.text === '✅ 已定案：A001', '無按鈕→送新文字訊息');
    pushed.length = 0;
    await adapter.editMessageText('Cgroup1', 'ignored', '改工地：', [{ text: 'A001', callbackData: 's:1:A001' }]);
    ok(!!pushed[0]?.messages[0]?.quickReply, '有按鈕→送帶 quick reply 的新訊息');

    // ---- 10) L3 postback → 正規化成 IncomingCallback 交 callbackHandler ----
    console.log('10) L3 postback → callbackHandler');
    const beforeCb = callbacks.length;
    await postWebhook(
      payload([{
        type: 'postback',
        postback: { data: 'c:42' },
        source: { type: 'group', groupId: 'Cgroup1', userId: 'Ualice' },
      }]),
    );
    await sleep(200);
    const cb = callbacks.slice(beforeCb).find((c) => c.data === 'c:42');
    ok(!!cb, '收到 postback 回呼');
    ok(cb?.chatId === 'Cgroup1', 'callback chatId = groupId');
    ok(cb?.fromId === 'Ualice', 'callback fromId = userId');
    ok(cb?.fromName === '王小明', 'callback fromName 取自 profile');
    ok(cb?.callbackId === '' && cb?.messageId === '', 'LINE 無 ack/編輯：callbackId/messageId 留空');
  } finally {
    await adapter.stop();
    globalThis.fetch = originalFetch;
  }

  console.log(`\n結果：${pass} 通過 / ${fail} 失敗`);
  process.exit(fail === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error('smoke test 異常', err);
  process.exit(1);
});
