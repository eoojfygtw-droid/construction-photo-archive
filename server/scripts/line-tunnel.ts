// ============================================================
// line-tunnel.ts — LINE 對外入口常駐（給 Windows 排程掛背景、開機自啟用）
// 做的事：開 cloudflared quick tunnel → 抓 trycloudflare 網址 →
//         自動把該網址設成 LINE 的 webhook endpoint（用 .env 的 access token）→
//         隧道掛掉就自動重起並重設。
// 解決痛點：trycloudflare 免費隧道每次起來「網址會變」。這支不依賴固定網址，
//           改成每次起來自動回報給 LINE（PUT /v2/bot/channel/webhook/endpoint），
//           所以重開機也免手動改 webhook URL。
// 注意：這只是「臨時入口的常駐化」，足夠跑幾天測試；正式持久入口（固定網址）＝L5
//       （cloudflared 具名 tunnel 掛 Windows service／反代／NAS）。
// 用法（手動）：npm run line-tunnel ；常駐請用 register-line-tunnel-task.ps1。
// ============================================================
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { loadConfig } from '../src/config/env';
import { logger } from '../src/utils/logger';

/** 從 cloudflared 輸出抓 trycloudflare 公開網址 */
const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 把 LINE webhook endpoint 設成新網址（成功＝重開機後免手動改 console） */
async function setLineWebhookEndpoint(token: string, endpoint: string): Promise<void> {
  const res = await fetch('https://api.line.me/v2/bot/channel/webhook/endpoint', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ endpoint }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`設定 LINE webhook 失敗：HTTP ${res.status} ${detail}`.trim());
  }
}

/**
 * 等隧道對外真的可達再註冊：新 trycloudflare 網址要等 DNS 傳播 + origin 連上，
 * 否則 LINE 驗證網址會回 400「Invalid webhook endpoint URL」。
 * 對網址 GET，拿到 <500 的回應（我們的 server 對 GET 會回 404）即代表可達。
 */
async function waitReachable(baseUrl: string, tries = 20, delayMs = 3000): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(baseUrl, { method: 'GET' });
      if (r.status < 500) return true; // 404 = 已穿到我們的 node server
    } catch {
      // DNS 未就緒 / 502：再等
    }
    await sleep(delayMs);
  }
  return false;
}

/** 等可達 → 重試數次設定 webhook（吸收傳播延遲與偶發 400/網路抖動） */
async function registerWithRetry(token: string, baseUrl: string, endpoint: string): Promise<void> {
  const ready = await waitReachable(baseUrl);
  if (!ready) logger.warn('隧道尚未確認可達，仍嘗試註冊', { baseUrl });
  for (let i = 1; i <= 5; i++) {
    try {
      await setLineWebhookEndpoint(token, endpoint);
      logger.info('✅ 已自動設定 LINE webhook endpoint', { endpoint });
      return;
    } catch (err) {
      logger.warn(`設定 LINE webhook 第 ${i}/5 次失敗，4 秒後重試`, err instanceof Error ? err.message : err);
      await sleep(4000);
    }
  }
  logger.error('設定 LINE webhook 連續失敗，放棄這輪（隧道仍在跑，可手動到 console 貼網址）');
}

/** 解析 cloudflared 執行檔：優先 PATH 的 'cloudflared'，失敗退回 winget 安裝路徑 */
function cloudflaredBin(): string {
  const fallback = `${process.env.LOCALAPPDATA ?? ''}\\Microsoft\\WinGet\\Packages\\Cloudflare.cloudflared_Microsoft.Winget.Source_8wekyb3d8bbwe\\cloudflared.exe`;
  return process.env.CLOUDFLARED_BIN || (existsSync(fallback) ? fallback : 'cloudflared');
}

let child: ChildProcess | null = null;

/** 起一次隧道，抓到網址就設 webhook；隧道結束時 resolve（由外層迴圈重起） */
function runOnce(bin: string, port: number, path: string, token: string): Promise<void> {
  return new Promise((resolve) => {
    let registered = false;
    logger.info('啟動 cloudflared 隧道…', { bin, target: `http://127.0.0.1:${port}` });
    child = spawn(bin, ['tunnel', '--url', `http://127.0.0.1:${port}`, '--no-autoupdate'], {
      windowsHide: true,
    });

    const scan = (buf: Buffer) => {
      const text = buf.toString();
      if (!registered) {
        const m = text.match(URL_RE);
        if (m) {
          registered = true;
          const baseUrl = m[0];
          const endpoint = `${baseUrl}${path}`;
          logger.info('抓到隧道網址，等可達後向 LINE 註冊 webhook…', { endpoint });
          void registerWithRetry(token, baseUrl, endpoint);
        }
      }
    };
    child.stdout?.on('data', scan);
    child.stderr?.on('data', scan); // cloudflared 把網址印在 stderr

    child.on('exit', (code) => {
      logger.warn('cloudflared 結束，稍後自動重起', { code });
      child = null;
      resolve();
    });
    child.on('error', (err) => {
      logger.error('cloudflared 啟動失敗（檢查是否已安裝/在 PATH）', err instanceof Error ? err.message : err);
      child = null;
      resolve();
    });
  });
}

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.lineChannelAccessToken) {
    logger.error('缺 LINE_CHANNEL_ACCESS_TOKEN，無法自動註冊 webhook，結束。');
    process.exit(1);
  }
  const bin = cloudflaredBin();
  const { lineWebhookPort: port, lineWebhookPath: path, lineChannelAccessToken: token } = config;
  logger.info('LINE 入口常駐啟動', { port, path, bin });

  // 收到結束訊號：殺掉 cloudflared 子程序再退出（排程停止/重啟時）
  const shutdown = () => {
    if (child) child.kill();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // 無限重起迴圈：隧道掛了等 5 秒重起，重新拿網址＋重設 webhook
  for (;;) {
    await runOnce(bin, port, path, token);
    await sleep(5000);
  }
}

main().catch((err) => {
  logger.error('line-tunnel 啟動失敗', err instanceof Error ? err.message : err);
  process.exit(1);
});
