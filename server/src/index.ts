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
import { PendingSiteStore } from './core/projects/PendingSiteStore';
import { UserContextStore } from './core/resolve/UserContextStore';
import { SiteResolver } from './core/resolve/SiteResolver';
import { handleCommand } from './core/commands/handleCommand';
import { Db } from './db';
import { writeRecord } from './core/records/recordWriter';
import {
  handleConfirmCallback,
  promptConfirm,
} from './core/confirm/confirmFlow';
import { buildSitePickerButtons } from './core/confirm/siteFlow';
import {
  promptBareLocation,
  isLocationCallback,
  handleLocationCallback,
} from './core/confirm/locationFlow';
import { Notifier } from './ops/notifier';

async function main(): Promise<void> {
  const config = loadConfig(); // 缺 token 會在這裡 fail loudly
  const botStartedAt = Date.now(); // bot 啟動時刻（「有沒有偷懶」查詢用來算工作時長）

  // 存活通知 + 外部心跳（死手開關）；未設對應 env 則自動略過
  const notifier = new Notifier({
    botToken: config.telegramBotToken,
    adminChatId: config.telegramAdminChatId,
    healthcheckUrl: config.healthcheckUrl,
    heartbeatIntervalSec: config.healthcheckIntervalSec,
  });

  // 程式級崩潰（未捕捉例外/未處理 rejection）：盡力發通知 + 標記心跳失敗後退出。
  // 註：OS 級斷電/當死無法靠自己發訊息,那種情況靠 healthchecks.io 心跳中斷觸發外部警報。
  const onFatal = async (label: string, err: unknown): Promise<void> => {
    logger.error(label, err instanceof Error ? (err.stack ?? err.message) : err);
    notifier.stopTimers();
    await notifier.notify(
      `⚠️ 報告老闆我出事了\n原因：${err instanceof Error ? err.message : String(err)}\n時間：${nowLocal()}`,
    );
    await notifier.ping('/fail');
    process.exit(1);
  };
  process.on('uncaughtException', (err) => void onFatal('uncaughtException', err));
  process.on('unhandledRejection', (err) => void onFatal('unhandledRejection', err));

  // SQLite
  const db = new Db();
  await db.init();

  // 工地清單 + 回報人上下文 + 判斷引擎
  const projectStore = new ProjectStore();
  await projectStore.load();
  const contextStore = new UserContextStore();
  const pendingSite = new PendingSiteStore(); // 剛新增、待傳位置設座標的工地
  const resolver = new SiteResolver(projectStore, contextStore);

  // 目前綁 Telegram；未來換 LINE 只要換成另一個 adapter 實作，以下程式碼不動
  const adapter: MessageChannelAdapter = new TelegramAdapter(config);

  // 一筆紀錄就緒後的處理：指令優先 → 下載照片+EXIF → 工地判斷
  const onRecordReady = async (msg: IncomingMessage) => {
    // 「有沒有偷懶」查詢：工作群/運維群都可問，回報目前工作時長
    if (isSlackingQuery(msg.text)) {
      const mins = Math.round((Date.now() - botStartedAt) / 60000);
      await adapter.sendMessage(
        msg.chatId,
        `報告老闆，我沒偷懶，我已經工作 ${mins} 分鐘了 💪`,
      );
      return;
    }

    // 指令（/addproject、/help…）優先，不當成一筆紀錄
    if (await handleCommand(adapter, msg, projectStore, pendingSite)) return;

    // 非工作群來源（例如運維群閒聊）只回應上面的查詢/指令，不進歸檔流程
    if (
      config.telegramAllowedChatId &&
      msg.chatId !== config.telegramAllowedChatId
    ) {
      return;
    }

    // 剛用 /新增工地 加好「無座標」工地的人，接著傳「位置」→ 設成該工地中心（開 GPS 自動歸檔）
    if (msg.location && msg.photos.length === 0) {
      const pendingCode = pendingSite.take(msg.reporterId, Date.now());
      if (pendingCode) {
        const ok = await projectStore.setCenter(
          pendingCode,
          msg.location.latitude,
          msg.location.longitude,
          300,
        );
        if (ok) {
          logger.info('已設定工地中心', {
            工地: pendingCode,
            座標: `${msg.location.latitude},${msg.location.longitude}`,
          });
          await adapter.sendMessage(
            msg.chatId,
            `✅ 已把 ${pendingCode} 的中心設為你傳的位置（半徑 300m）。之後落在範圍內、用「檔案」上傳的照片會自動歸到 ${pendingCode}。`,
          );
        } else {
          await adapter.sendMessage(msg.chatId, `找不到工地 ${pendingCode}，請重新 /新增工地。`);
        }
        return;
      }
    }

    // 第 2 種純定位：單獨傳「定位」（無照片、無文字、也不是剛 /新增工地）
    // → 不再沉默，主動判斷工地並回覆／詢問（判得出回覆、判不出跳選單），由使用者點選記住目前工地。
    const isBareLocation =
      !!msg.location &&
      msg.photos.length === 0 &&
      !msg.text?.trim() &&
      !msg.caption?.trim();
    if (isBareLocation) {
      await promptBareLocation(adapter, resolver, projectStore, msg);
      return;
    }

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

    // 寫入 SQLite（5-1）+ 正式搬檔歸檔（5-2）；狀態 待確認
    try {
      const { recordNo, recordId, archiveDir } = await writeRecord(
        db,
        msg,
        intake,
        result,
        projectStore,
      );
      logger.info('已建檔歸檔', {
        紀錄編號: recordNo,
        工地: result.projectCode ?? '（未歸檔/_inbox）',
        判定方式: result.method,
        照片數: intake.length,
        歸檔目錄: archiveDir,
        狀態: '待確認',
        回報人: `${msg.reporterName}（${msg.reporterId}）`,
      });

      // Bot 回覆整理結果 + ✅/✏️ 人工確認（5-3a）；照片與錄音分開計數
      const voiceCount = intake.filter(
        (r) => r.uploadType === 'voice' || r.uploadType === 'audio',
      ).length;
      if (result.projectCode) {
        const proj = projectStore.findByCode(result.projectCode);
        await promptConfirm(adapter, msg.chatId, {
          recordId,
          recordNo,
          projectLabel: `${result.projectCode}${proj ? ` ${proj.name}` : ''}`,
          method: result.method,
          photoCount: intake.length - voiceCount,
          voiceCount,
          note:
            [msg.text, msg.caption]
              .map((s) => s?.trim())
              .filter((s): s is string => !!s)
              .join(' ') || null,
          reporterName: msg.reporterName,
        });
      } else {
        // 判不出工地（第 5 層）：送工地選單讓使用者點選；無工地可選則純文字提示
        const activeProjects = projectStore.listActive();
        if (activeProjects.length > 0) {
          await adapter.sendMessageWithButtons(
            msg.chatId,
            `⚠️ 判不出工地（${recordNo}），已暫存 _inbox。請選擇正確工地：`,
            buildSitePickerButtons(projectStore, recordId),
            1,
          );
        } else {
          await adapter.sendMessage(
            msg.chatId,
            `⚠️ 判不出工地，已暫存待歸檔（${recordNo}）。尚未設定任何工地，請先用 /addproject 新增。`,
          );
        }
      }
    } catch (err) {
      logger.error('寫入 DB / 搬檔失敗', err instanceof Error ? err.message : err);
    }
  };

  // 相簿合併：同一 media group 的多則訊息 debounce 約 2 秒合併為一筆再處理
  const aggregator = new MediaGroupAggregator(onRecordReady, 2000);
  adapter.onMessage((msg) => aggregator.push(msg));

  // 人工確認按鈕回呼（✅ 確認 / ✏️ 改工地 / 選工地）；單則失敗不影響主迴圈
  adapter.onCallback(async (cb) => {
    try {
      // loc:… 為「單獨定位」流程（只設目前工地上下文，不搬檔），與 s:/c:/e: 分流
      if (isLocationCallback(cb)) {
        await handleLocationCallback(
          adapter,
          projectStore,
          contextStore,
          cb,
          Date.now(),
        );
        return;
      }
      await handleConfirmCallback(adapter, db, projectStore, cb);
    } catch (err) {
      logger.error('處理按鈕回呼失敗', err instanceof Error ? err.message : err);
    }
  });

  // 優雅關閉：Ctrl+C / 終止訊號時停止收訊再退出
  const shutdown = async () => {
    logger.info('收到結束訊號，停止收訊…');
    notifier.stopTimers();
    await notifier.notify(
      `🔴 報告老闆我下班了\n時間：${nowLocal()}`,
    );
    aggregator.flushAll(); // 把尚在 debounce 等待的相簿先合併送出
    await adapter.stop();
    db.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // 啟動通知 + 開始心跳,然後進 long polling（start() 會阻塞直到 stop()）。
  // 重開機後 bot 自動爬起來就會發這則,等同「機器已恢復」的通知。
  await notifier.notify(
    `🟢 報告老闆我上班了\n時間：${nowLocal()}`,
  );
  notifier.startHeartbeat();
  notifier.startUptimeReports(); // 3〜5 小時隨機回報工作時長

  await adapter.start();
}

/** 是不是在問「有沒有偷懶」（訊息含「偷懶」二字即觸發） */
function isSlackingQuery(text?: string): boolean {
  return !!text && text.includes('偷懶');
}

/** 本機時間字串 YYYY-MM-DD HH:MM:SS（通知訊息用,讓訊息本身自帶時間） */
function nowLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

main().catch((err) => {
  logger.error('啟動失敗', err instanceof Error ? err.message : err);
  process.exit(1);
});
