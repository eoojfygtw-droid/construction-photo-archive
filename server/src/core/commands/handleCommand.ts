// ============================================================
// handleCommand.ts — 最小指令處理（/addproject、/start、/help）
// 回傳 true＝這是指令、已處理（不應再當成一筆紀錄）；false＝非指令。
// ============================================================
import type { MessageChannelAdapter } from '../../channels/MessageChannelAdapter';
import type { IncomingMessage } from '../../channels/types';
import type { ProjectStore } from '../projects/ProjectStore';
import type { PendingSiteStore } from '../projects/PendingSiteStore';

export async function handleCommand(
  adapter: MessageChannelAdapter,
  msg: IncomingMessage,
  store: ProjectStore,
  pending: PendingSiteStore,
): Promise<boolean> {
  const text = (msg.text ?? '').trim();
  if (!text.startsWith('/')) return false;

  const parts = text.split(/\s+/);
  // 去掉群組裡可能附帶的 @botname（例如 /addproject@MyBot）
  const cmd = parts[0].split('@')[0];
  const args = parts.slice(1);

  switch (cmd) {
    case '/addproject':
    case '/新增工地': {
      // 最少給「代碼 名稱」即可；要 GPS 自動歸檔可一次帶座標，或加完再傳「位置」設定。
      if (args.length < 2) {
        await adapter.sendMessage(
          msg.chatId,
          [
            '用法：/新增工地 代碼 名稱',
            '例：/新增工地 B002 林口廠房',
            '（加完再傳一個「位置」📍給我，就會開 GPS 自動歸檔；',
            ' 或一次給全：/新增工地 B002 林口廠房 25.078 121.349 300）',
          ].join('\n'),
        );
        return true;
      }
      const [code, name, latS, lngS, radS] = args;
      const upperCode = code.toUpperCase();
      if (store.findByCode(code)) {
        await adapter.sendMessage(msg.chatId, `工地代碼 ${upperCode} 已存在。`);
        return true;
      }

      // 有帶座標 → 直接設好；沒帶 → 先建（無座標），記下 pending 等使用者傳「位置」
      if (latS !== undefined && lngS !== undefined) {
        const lat = Number(latS);
        const lng = Number(lngS);
        const radius = radS !== undefined ? Number(radS) : 300;
        if (
          !Number.isFinite(lat) ||
          !Number.isFinite(lng) ||
          !Number.isFinite(radius) ||
          radius <= 0
        ) {
          await adapter.sendMessage(msg.chatId, '緯度／經度／半徑需為有效數字。');
          return true;
        }
        await store.add({
          code: upperCode,
          name,
          centerLat: lat,
          centerLng: lng,
          radiusMeters: radius,
          active: true,
        });
        await adapter.sendMessage(
          msg.chatId,
          `已新增工地：${upperCode} ${name}（中心 ${lat},${lng}，半徑 ${radius}m，GPS 自動歸檔已開）`,
        );
      } else {
        await store.add({
          code: upperCode,
          name,
          centerLat: null,
          centerLng: null,
          radiusMeters: null,
          active: true,
        });
        pending.set(msg.reporterId, upperCode, Date.now());
        await adapter.sendMessage(
          msg.chatId,
          `✅ 已新增工地：${upperCode} ${name}\n現在就能用 #${upperCode}（或裸碼 ${upperCode}）歸檔。\n📍 想開 GPS 自動歸檔的話，10 分鐘內傳一個「位置」給我，我把它設成 ${upperCode} 的中心。`,
        );
      }
      return true;
    }

    case '/start':
    case '/help':
      await adapter.sendMessage(
        msg.chatId,
        [
          '工地照片歸檔（V0 開發測試）',
          '・直接傳照片／文字／位置即可',
          '・指定工地：訊息含 #代碼（例 #A001）',
          '・新增工地：/新增工地 代碼 名稱 緯度 經度 [半徑]（或 /addproject）',
        ].join('\n'),
      );
      return true;

    default:
      await adapter.sendMessage(msg.chatId, `未知指令：${cmd}`);
      return true;
  }
}
