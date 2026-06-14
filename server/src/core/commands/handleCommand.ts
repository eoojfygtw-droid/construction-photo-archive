// ============================================================
// handleCommand.ts — 最小指令處理（/addproject、/start、/help）
// 回傳 true＝這是指令、已處理（不應再當成一筆紀錄）；false＝非指令。
// ============================================================
import type { MessageChannelAdapter } from '../../channels/MessageChannelAdapter';
import type { IncomingMessage } from '../../channels/types';
import type { ProjectStore } from '../projects/ProjectStore';
import type { PendingSiteStore } from '../projects/PendingSiteStore';
import type { PendingLocationStore } from '../projects/PendingLocationStore';
import type { UserContextStore } from '../resolve/UserContextStore';

export async function handleCommand(
  adapter: MessageChannelAdapter,
  msg: IncomingMessage,
  store: ProjectStore,
  pending: PendingSiteStore,
  pendingLocations: PendingLocationStore,
  contexts: UserContextStore,
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
      // 最少給「名稱」即可，代號系統自動配；要自己指定代號用 /新增工地 代碼 名稱 [座標]。
      if (args.length < 1) {
        await adapter.sendMessage(
          msg.chatId,
          [
            '用法：/新增工地 工地名稱  （代號我自動配）',
            '例：/新增工地 林口廠房',
            '人在工地的話，先傳一個「位置」📍再打這行，我就用你的定位當中心、開 GPS 自動歸檔。',
            '想自己指定代號：/新增工地 代碼 名稱 [緯度 經度 半徑]',
          ].join('\n'),
        );
        return true;
      }

      // 第一個字像代號（英數短碼）且後面還有名稱 → 使用者自訂代號（向後相容）；
      // 否則整串當工地名稱，代號自動配。
      const looksLikeCode = (s: string) => /^[A-Za-z][A-Za-z0-9]{0,7}$/.test(s);
      const manualCode = args.length >= 2 && looksLikeCode(args[0]);

      let upperCode: string;
      let name: string;
      let latS: string | undefined;
      let lngS: string | undefined;
      let radS: string | undefined;
      let autoCoded = false;

      if (manualCode) {
        upperCode = args[0].toUpperCase();
        name = args[1];
        latS = args[2];
        lngS = args[3];
        radS = args[4];
        if (store.findByCode(upperCode)) {
          await adapter.sendMessage(msg.chatId, `工地代碼 ${upperCode} 已存在。`);
          return true;
        }
      } else {
        upperCode = store.nextAutoCode();
        name = args.join(' ');
        autoCoded = true;
      }
      // 自動配的代號在回覆裡點明，讓使用者知道用哪個碼歸檔
      const codeNote = autoCoded ? `（代號 ${upperCode} 是我自動配的）` : '';

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
          `已新增工地：${upperCode} ${name}${codeNote}（中心 ${lat},${lng}，半徑 ${radius}m，GPS 自動歸檔已開）`,
        );
      } else {
        // 沒帶座標：若 10 分鐘內剛傳過定位（例如判不出 → 按「➕ 新增工地」），直接用它當中心
        const stash = pendingLocations.take(msg.reporterId, Date.now());
        if (stash) {
          await store.add({
            code: upperCode,
            name,
            centerLat: stash.latitude,
            centerLng: stash.longitude,
            radiusMeters: 300,
            active: true,
          });
          // 人就在現場（定位是剛傳的）：順手設 2 小時上下文，
          // 接下來的照片（多半無 GPS）才能立刻自動歸到這個新工地
          contexts.set(msg.reporterId, upperCode, Date.now());
          await adapter.sendMessage(
            msg.chatId,
            `✅ 已新增工地：${upperCode} ${name}${codeNote}\n📍 已用你剛剛傳的定位當中心（半徑 300m），GPS 自動歸檔已開。\n接下來 2 小時內你傳的照片會自動歸到 ${upperCode}。`,
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
            `✅ 已新增工地：${upperCode} ${name}${codeNote}\n` +
              `⚠️ 現在直接傳照片還「不會」自動歸到這裡（這個工地還沒中心、也沒設自動歸窗），會判不出進待歸檔。\n` +
              `要自動歸，二選一：\n` +
              `① 照片訊息帶 #${upperCode}（或裸碼 ${upperCode}）。\n` +
              `② 人在現場：10 分鐘內傳一個「位置」📍給我 → 我把它設成 ${upperCode} 的中心並開 2 小時自動歸，之後照片免標自動跟著歸。`,
          );
        }
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
          '・新增工地：/新增工地 工地名稱（代號自動配；人在工地先傳定位📍就開 GPS 自動歸檔）',
        ].join('\n'),
      );
      return true;

    default:
      await adapter.sendMessage(msg.chatId, `未知指令：${cmd}`);
      return true;
  }
}
