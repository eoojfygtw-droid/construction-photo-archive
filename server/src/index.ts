// ============================================================
// index.ts — 後端進入點
// 流程：讀設定 → 開 SQLite → 載入工地清單 → 建 Telegram adapter → 相簿合併 →
//        指令處理 / 照片下載+EXIF / 工地判斷 / 寫入 DB → 啟動收訊。
// 目前到「寫入 SQLite（5-1）」；尚未做正式搬檔歸檔（5-2）、按鈕詢問（5-3）。
// ============================================================
import { loadConfig } from './config/env';
import { logger } from './utils/logger';
import { TelegramAdapter } from './channels/telegram/TelegramAdapter';
import type { MessageChannelAdapter } from './channels/MessageChannelAdapter';
import type { IncomingMessage } from './channels/types';
import { intakePhotos, type IntakeResult } from './core/media/photoIntake';
import { MediaGroupAggregator } from './core/ingest/MediaGroupAggregator';
import { ProjectStore } from './core/projects/ProjectStore';
import { UserContextStore } from './core/resolve/UserContextStore';
import { SiteResolver } from './core/resolve/SiteResolver';
import { handleCommand } from './core/commands/handleCommand';
import { Db } from './db';
import { writeRecord } from './core/records/recordWriter';

async function main(): Promise<void> {
  const config = loadConfig(); // 缺 token 會在這裡 fail loudly

  // SQLite
  const db = new Db();
  await db.init();

  // 工地清單 + 回報人上下文 + 判斷引擎
  const projectStore = new ProjectStore();
  await projectStore.load();
  const contextStore = new UserContextStore();
  const resolver = new SiteResolver(projectStore, contextStore);

  // 目前綁 Telegram；未來換 LINE 只要換成另一個 adapter 實作，以下程式碼不動
  const adapter: MessageChannelAdapter = new TelegramAdapter(config);

  // 一筆紀錄就緒後的處理：指令優先 → 下載照片+EXIF → 工地判斷
  const onRecordReady = async (msg: IncomingMessage) => {
    // 指令（/addproject、/help…）優先，不當成一筆紀錄
    if (await handleCommand(adapter, msg, projectStore)) return;

    logger.info('紀錄就緒', {
      來源: msg.channel,
      群組: msg.chatId,
      訊息id: msg.messageId,
      相簿群組: msg.mediaGroupId ?? '（無）',
      回報人: `${msg.reporterName}（${msg.reporterId}）`,
      文字: msg.text ?? '',
      照片說明: msg.caption ?? '',
      照片數: msg.photos.length,
      照片: msg.photos.map((p) => `${p.uploadType}:${p.fileId}`),
      位置: msg.location
        ? `${msg.location.latitude},${msg.location.longitude}`
        : '（無）',
    });

    // 下載照片 + EXIF（單則訊息的下載失敗不影響收訊主迴圈）
    let intake: IntakeResult[] = [];
    try {
      intake = await intakePhotos(adapter, msg);
    } catch (err) {
      logger.error(
        '照片下載/EXIF 失敗',
        err instanceof Error ? err.message : err,
      );
    }
    // 收集有 GPS 的照片，供工地判斷第 2 層 photo_gps 使用
    const photoGpsList = intake
      .map((r) => r.exif.gps)
      .filter((g): g is { latitude: number; longitude: number } => g != null);

    // 工地判斷（前 4 層）
    const result = resolver.resolve({
      reporterId: msg.reporterId,
      text: msg.text,
      caption: msg.caption,
      photoGpsList,
      location: msg.location,
    });
    if (result.projectCode) {
      const proj = projectStore.findByCode(result.projectCode);
      logger.info('工地判定', {
        工地: `${result.projectCode}${proj ? ` ${proj.name}` : ''}`,
        判定方式: result.method,
        距離M: result.distanceM ?? '（不適用）',
      });
    } else {
      logger.warn('工地無法判斷 → 編號用 INBOX（_inbox 搬檔與按鈕詢問見後續片）', {
        回報人: `${msg.reporterName}（${msg.reporterId}）`,
      });
    }

    // 純位置/空訊息（無照片且無文字）只更新上下文，不建檔
    const hasContent =
      intake.length > 0 || !!msg.text?.trim() || !!msg.caption?.trim();
    if (!hasContent) {
      logger.info('位置/空訊息：僅更新上下文，不建檔');
      return;
    }

    // 寫入 SQLite（5-1）；狀態 待確認
    try {
      const { recordNo } = writeRecord(db, msg, intake, result, projectStore);
      logger.info('已建檔', {
        紀錄編號: recordNo,
        工地: result.projectCode ?? '（未歸檔/_inbox）',
        判定方式: result.method,
        照片數: intake.length,
        狀態: '待確認',
        回報人: `${msg.reporterName}（${msg.reporterId}）`,
      });
    } catch (err) {
      logger.error('寫入 DB 失敗', err instanceof Error ? err.message : err);
    }
  };

  // 相簿合併：同一 media group 的多則訊息 debounce 約 2 秒合併為一筆再處理
  const aggregator = new MediaGroupAggregator(onRecordReady, 2000);
  adapter.onMessage((msg) => aggregator.push(msg));

  // 優雅關閉：Ctrl+C / 終止訊號時停止收訊再退出
  const shutdown = async () => {
    logger.info('收到結束訊號，停止收訊…');
    aggregator.flushAll(); // 把尚在 debounce 等待的相簿先合併送出
    await adapter.stop();
    db.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await adapter.start();
}

main().catch((err) => {
  logger.error('啟動失敗', err instanceof Error ? err.message : err);
  process.exit(1);
});
