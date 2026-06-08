// ============================================================
// logger.ts — 極簡時間戳記日誌
// 兩個輸出:
//   1) console（被 run-bot.cmd 收進 data/_logs/bot.log，含 npm 橫幅/node 警告等原始雜訊）
//   2) data/_logs/activity.log —— 純中文、無雜訊的「活動紀錄」（只有 logger 自己的行，
//      不含 npm 橫幅與 SQLite 實驗性警告）。給人直接閱讀／監看用。
// ============================================================
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** 純中文活動紀錄檔（UTF-8；檔名用 ASCII 避免主控台路徑亂碼，內容是中文） */
const ACTIVITY_LOG = join('data', '_logs', 'activity.log');

/** 取得本地時間字串，例如 2026-06-05 14:03:21 */
function ts(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/** 把結構化資料壓成一行中文（活動紀錄用，避免多行雜亂） */
function fmtData(data: unknown): string {
  if (data === undefined || data === null || data === '') return '';
  if (typeof data === 'object') {
    const parts = Object.entries(data as Record<string, unknown>).map(
      ([k, v]) =>
        `${k}=${v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v)}`,
    );
    return parts.length ? `（${parts.join('，')}）` : '';
  }
  return String(data);
}

/** 追加一行到純中文活動紀錄（永不丟例外；失敗就放棄這行，不影響主程式） */
function writeActivity(icon: string, msg: string, data?: unknown): void {
  const line = `[${ts()}] ${icon}${msg}${fmtData(data)}\n`;
  try {
    appendFileSync(ACTIVITY_LOG, line, 'utf8');
  } catch {
    // 目錄可能還沒建：補建一次再試，仍失敗就算了
    try {
      mkdirSync(dirname(ACTIVITY_LOG), { recursive: true });
      appendFileSync(ACTIVITY_LOG, line, 'utf8');
    } catch {
      /* 寫不進活動紀錄不致命 */
    }
  }
}

/** 統一日誌介面：info / warn / error，附時間戳與可選結構化資料 */
export const logger = {
  info(msg: string, data?: unknown) {
    console.log(`[${ts()}] [INFO ] ${msg}`, data !== undefined ? data : '');
    writeActivity('', msg, data);
  },
  warn(msg: string, data?: unknown) {
    console.warn(`[${ts()}] [WARN ] ${msg}`, data !== undefined ? data : '');
    writeActivity('⚠️ ', msg, data);
  },
  error(msg: string, data?: unknown) {
    console.error(`[${ts()}] [ERROR] ${msg}`, data !== undefined ? data : '');
    writeActivity('❌ ', msg, data);
  },
};
