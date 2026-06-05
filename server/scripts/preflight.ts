// ============================================================
// preflight.ts — 實機驗收前置健檢
// 用 .env 的 TELEGRAM_BOT_TOKEN 呼叫 Telegram getMe，確認金鑰有效。
// 只印出 bot 名稱與設定摘要，絕不印出 token 本身。
// 執行：npx tsx scripts/preflight.ts
// ============================================================
import { loadConfig } from '../src/config/env';

async function main(): Promise<void> {
  const config = loadConfig(); // 缺 token 會在這裡 fail loudly
  const base = `https://api.telegram.org/bot${config.telegramBotToken}`;

  // 1) getMe：驗證 token 有效，取得 bot 身分
  const res = await fetch(`${base}/getMe`);
  const data = (await res.json()) as {
    ok: boolean;
    result?: { id: number; username?: string; first_name?: string };
    description?: string;
  };
  if (!data.ok || !data.result) {
    console.error('❌ getMe 失敗：token 可能無效或已撤銷。');
    console.error('   Telegram 回應：', data.description ?? '(無描述)');
    process.exit(1);
  }
  const me = data.result;
  console.log('✅ Token 有效');
  console.log(`   Bot：@${me.username ?? '(無 username)'}（${me.first_name ?? ''}，id=${me.id}）`);

  // 2) 設定摘要
  console.log('--- 設定摘要 ---');
  console.log(
    `   限定群組 chat id：${config.telegramAllowedChatId || '（未設，不限制來源）'}`,
  );
  console.log(`   long polling timeout：${config.telegramPollTimeout}s`);

  // 3) 群組隱私提示
  console.log('--- 提醒 ---');
  console.log('   若 bot 收不到一般訊息（只收 /指令），到 @BotFather → /setprivacy → Disable。');
  console.log('   準備好後即可啟動：npm run dev');
}

main().catch((err) => {
  console.error('preflight 失敗：', err instanceof Error ? err.message : err);
  process.exit(1);
});
