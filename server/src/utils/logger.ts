// ============================================================
// logger.ts — 極簡時間戳記日誌
// V0 先用 console + 時間戳；之後要換成檔案/結構化日誌再從這裡改，呼叫端不動。
// ============================================================

/** 取得本地時間字串，例如 2026-06-05 14:03:21 */
function ts(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/** 統一日誌介面：info / warn / error，附時間戳與可選結構化資料 */
export const logger = {
  info(msg: string, data?: unknown) {
    console.log(`[${ts()}] [INFO ] ${msg}`, data !== undefined ? data : '');
  },
  warn(msg: string, data?: unknown) {
    console.warn(`[${ts()}] [WARN ] ${msg}`, data !== undefined ? data : '');
  },
  error(msg: string, data?: unknown) {
    console.error(`[${ts()}] [ERROR] ${msg}`, data !== undefined ? data : '');
  },
};
