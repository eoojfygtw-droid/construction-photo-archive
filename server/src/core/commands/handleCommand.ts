// ============================================================
// handleCommand.ts — 最小指令處理（/addproject、/start、/help）
// 回傳 true＝這是指令、已處理（不應再當成一筆紀錄）；false＝非指令。
// ============================================================
import type { MessageChannelAdapter } from '../../channels/MessageChannelAdapter';
import type { IncomingMessage } from '../../channels/types';
import type { ProjectStore } from '../projects/ProjectStore';

export async function handleCommand(
  adapter: MessageChannelAdapter,
  msg: IncomingMessage,
  store: ProjectStore,
): Promise<boolean> {
  const text = (msg.text ?? '').trim();
  if (!text.startsWith('/')) return false;

  const parts = text.split(/\s+/);
  // 去掉群組裡可能附帶的 @botname（例如 /addproject@MyBot）
  const cmd = parts[0].split('@')[0];
  const args = parts.slice(1);

  switch (cmd) {
    case '/addproject': {
      // 用法：/addproject 代碼 名稱 緯度 經度 [半徑公尺]
      if (args.length < 4) {
        await adapter.sendMessage(
          msg.chatId,
          '用法：/addproject 代碼 名稱 緯度 經度 [半徑公尺]\n例：/addproject A001 青山苑 24.1618 120.6469 300',
        );
        return true;
      }
      const [code, name, latS, lngS, radS] = args;
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
      if (store.findByCode(code)) {
        await adapter.sendMessage(msg.chatId, `工地代碼 ${code} 已存在。`);
        return true;
      }
      await store.add({
        code: code.toUpperCase(),
        name,
        centerLat: lat,
        centerLng: lng,
        radiusMeters: radius,
        active: true,
      });
      await adapter.sendMessage(
        msg.chatId,
        `已新增工地：${code.toUpperCase()} ${name}（中心 ${lat},${lng}，半徑 ${radius}m）`,
      );
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
          '・新增工地：/addproject 代碼 名稱 緯度 經度 [半徑]',
        ].join('\n'),
      );
      return true;

    default:
      await adapter.sendMessage(msg.chatId, `未知指令：${cmd}`);
      return true;
  }
}
