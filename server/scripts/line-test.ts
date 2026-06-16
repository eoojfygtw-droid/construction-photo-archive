// ============================================================
// line-test.ts — L2 實機測試（隔離版，完全不碰 Telegram / 不碰 DB / 不碰正式歸檔）
// 只起 LineAdapter webhook，收到真 LINE 訊息後「就地」驗證 L2 三件事：
//   ① downloadFile：真的把照片/檔案位元組抓回來（存到 data/_probe-dl/，gitignore 擋著）
//   ② resolveReporterName：取到真實顯示名稱（getGroupMemberProfile）
//   ③ 同人去抖合併：一次傳多張 image 經 MediaGroupAggregator 併成一筆
// 不寫 app.db、不搬正式歸檔目錄 → 不會污染驗收期資料、不會跟正式 bot 搶 DB。
// 用法：npx tsx scripts/line-test.ts
//   （若 3010 還被昨天的 line-probe 占著，可換埠：LINE_WEBHOOK_PORT=3011 npx tsx scripts/line-test.ts）
// 搭配 cloudflared 把該埠導出去、回貼 LINE webhook URL 後，在群組傳照片即可。
// ============================================================
import { mkdir, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { loadConfig, isLineConfigured } from '../src/config/env';
import { LineAdapter } from '../src/channels/line/LineAdapter';
import { MediaGroupAggregator } from '../src/core/ingest/MediaGroupAggregator';
import type { IncomingMessage } from '../src/channels/types';
import { logger } from '../src/utils/logger';

const DL_ROOT = join('data', '_probe-dl'); // 測試下載落腳處（data/ 已被 gitignore）

async function main(): Promise<void> {
  const config = loadConfig();
  if (!isLineConfigured(config)) {
    console.error('LINE 未設定（缺 LINE_CHANNEL_SECRET / LINE_CHANNEL_ACCESS_TOKEN），請先填 server/.env。');
    process.exit(1);
  }

  const adapter = new LineAdapter(config);

  // 收到（已合併）一筆 → 驗證 L2
  const onReady = async (msg: IncomingMessage) => {
    logger.info('✅ 收到 LINE 訊息（已正規化／合併）', {
      chatId_即groupId: msg.chatId,
      回報人ID: msg.reporterId,
      回報人顯示名稱: msg.reporterName, // ← L2 getGroupMemberProfile 成果
      文字: msg.text ?? '',
      照片數: msg.photos.length,
      合成相簿鍵: msg.mediaGroupId ?? '（無，非 image/file）',
      位置: msg.location ? `${msg.location.latitude},${msg.location.longitude}` : '無',
    });
    if (msg.chatId) {
      logger.info(`👉 要綁這個群：把 LINE_ALLOWED_GROUP_ID=${msg.chatId} 填進 server/.env`);
    }

    // L2 downloadFile：把每件媒體真的抓回來存到測試資料夾（不進正式歸檔）
    if (msg.photos.length > 0) {
      const dir = join(DL_ROOT, msg.messageId);
      await mkdir(dir, { recursive: true });
      for (let i = 0; i < msg.photos.length; i++) {
        const p = msg.photos[i];
        try {
          const dl = await adapter.downloadFile(p.fileId);
          const ext = extname(dl.remotePath) || '.bin';
          const out = join(dir, `${i + 1}${ext}`);
          await writeFile(out, dl.buffer);
          logger.info(`  ⬇️ 第 ${i + 1} 件下載成功`, {
            上傳方式: p.uploadType,
            大小KB: Math.round(dl.buffer.length / 1024),
            副檔名來源: dl.remotePath,
            存到: out,
          });
        } catch (err) {
          logger.error(`  ❌ 第 ${i + 1} 件下載失敗`, err instanceof Error ? err.message : err);
        }
      }
    }
  };

  // 同人去抖合併：與正式 index.ts 同一套聚合器（LINE 給合成 mediaGroupId，多張併一筆）
  const aggregator = new MediaGroupAggregator((m) => void onReady(m), 2500);
  adapter.onMessage((m) => aggregator.push(m));

  await adapter.start();
  logger.info('LINE L2 測試已啟動，等 webhook 進來…（Ctrl+C 結束）');

  const shutdown = async () => {
    aggregator.flushAll();
    await adapter.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('line-test 啟動失敗：', err instanceof Error ? err.message : err);
  process.exit(1);
});
