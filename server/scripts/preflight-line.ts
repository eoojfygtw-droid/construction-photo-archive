// ============================================================
// preflight-line.ts — LINE 憑證開跑健檢
// 讀 .env 的 LINE_CHANNEL_ACCESS_TOKEN / LINE_CHANNEL_SECRET，
// 呼叫 GET /v2/bot/info 驗證 token 有效並印出 bot 身分；不外洩 token。
// 用法：npx tsx scripts/preflight-line.ts
// ============================================================
import 'dotenv/config'; // 自動載入 server/.env

interface LineBotInfo {
  userId?: string;
  basicId?: string;
  displayName?: string;
  chatMode?: string; // 需為 'bot' 才會收到 webhook（OA 回應模式＝Bot）
  markAsReadMode?: string;
}

async function main(): Promise<void> {
  const token = (process.env.LINE_CHANNEL_ACCESS_TOKEN ?? '').trim();
  const secret = (process.env.LINE_CHANNEL_SECRET ?? '').trim();

  // 只印長度/是否存在，不印值
  console.log(`LINE_CHANNEL_SECRET：${secret ? `✅ 已設定（長度 ${secret.length}）` : '⚠️ 未設定'}`);
  console.log(`LINE_CHANNEL_ACCESS_TOKEN：${token ? `✅ 已設定（長度 ${token.length}）` : '⚠️ 未設定'}`);
  if (!token) {
    console.error('\n缺 LINE_CHANNEL_ACCESS_TOKEN，請填入 server/.env。');
    process.exitCode = 1;
    return;
  }

  const res = await fetch('https://api.line.me/v2/bot/info', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    console.error(`\n❌ 驗證失敗（HTTP ${res.status}）：${await res.text()}`);
    console.error('  token 可能填錯／含多餘空白，或尚未啟用 Messaging API。');
    process.exitCode = 1;
    return;
  }

  const info = (await res.json()) as LineBotInfo;
  console.log('\n✅ LINE 連線成功，token 有效');
  console.log(`  bot 名稱：${info.displayName ?? '（無）'}`);
  console.log(`  basicId：${info.basicId ?? '（無）'}`);
  console.log(`  chatMode：${info.chatMode ?? '（無）'}${info.chatMode === 'bot' ? '（✅ 已是 Bot 模式）' : '（⚠️ 需在 OA 後台把回應模式設成 Bot 才收得到 webhook）'}`);
}

main().catch((err) => {
  console.error('preflight-line 異常：', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
