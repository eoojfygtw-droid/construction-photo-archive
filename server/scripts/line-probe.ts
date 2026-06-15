// ============================================================
// line-probe.ts — L0：LINE webhook 接通驗證（獨立跑，不啟動 Telegram）
// 只起 LineAdapter 的 webhook server，收到訊息就印出來（含 groupId），
// 用來確認「LINE → 公開入口 → 本機」這條路通，並抓出工作群的 groupId。
// 不會和正式 bot 搶 Telegram token（這支完全不碰 Telegram）。
// 用法：npx tsx scripts/line-probe.ts （搭配 cloudflared/ngrok 把 webhook 埠導出去）
// ============================================================
import { loadConfig, isLineConfigured } from '../src/config/env';
import { LineAdapter } from '../src/channels/line/LineAdapter';
import { logger } from '../src/utils/logger';

async function main(): Promise<void> {
  const config = loadConfig();
  if (!isLineConfigured(config)) {
    console.error('LINE 未設定（缺 LINE_CHANNEL_SECRET / LINE_CHANNEL_ACCESS_TOKEN），請先填 server/.env。');
    process.exit(1);
  }

  const line = new LineAdapter(config);
  line.onMessage(async (msg) => {
    logger.info('✅ 收到 LINE 訊息（已正規化）', {
      chatId_即groupId: msg.chatId,
      回報人: msg.reporterId,
      文字: msg.text ?? '',
      照片數: msg.photos.length,
      位置: msg.location ? `${msg.location.latitude},${msg.location.longitude}` : '無',
    });
    if (msg.chatId) {
      logger.info(`👉 要綁這個群：把 LINE_ALLOWED_GROUP_ID=${msg.chatId} 填進 server/.env`);
    }
  });

  await line.start();
  logger.info('LINE probe 已啟動，等 webhook 進來…（Ctrl+C 結束）');

  // 優雅關閉
  const shutdown = async () => {
    await line.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('line-probe 啟動失敗：', err instanceof Error ? err.message : err);
  process.exit(1);
});
