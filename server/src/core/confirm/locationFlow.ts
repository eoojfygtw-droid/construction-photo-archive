// ============================================================
// locationFlow.ts — 單獨傳「定位」（無照片、無文字）時的判斷＋詢問
// 背景：純位置訊息沒有照片可歸檔，過去 index.ts 只默默更新上下文、不回任何訊息，
//       現場體感像「bot 死了」。本流程改成：收到定位就主動判斷工地並回覆／詢問。
// 行為：
//   - 判得出（telegram_location / recent_context）→ 回覆判定到的工地，附「✏️ 改工地」可改。
//   - 判不出 → 直接跳工地選單問「你現在在哪個工地？」。
//   - 使用者點工地 → 只設「目前工地上下文」（recent_context），不動 projects.json、不搬檔。
// 與 siteFlow 的差異：siteFlow 的 s:{recordId}:{code} 是針對「已建檔紀錄」搬檔重歸；
//   這裡沒有 record，loc:{code} 只記住回報人現在在哪個工地，供之後照片沿用。
// callback data：
//   loc:_pick        → 把訊息就地改成完整工地選單（給「判得出但要改」用）
//   loc:_skip        → 略過，不記任何工地
//   loc:{code}       → 把回報人目前工地設為 code（2 小時內照片自動沿用）
// ============================================================
import type { IncomingCallback, IncomingMessage } from '../../channels/types';
import type {
  MessageChannelAdapter,
  OutgoingButton,
} from '../../channels/MessageChannelAdapter';
import type { ProjectStore } from '../projects/ProjectStore';
import type { SiteResolver } from '../resolve/SiteResolver';
import type { UserContextStore } from '../resolve/UserContextStore';
import { logger } from '../../utils/logger';

/** 本流程的 callback 前綴 */
export const LOC_PREFIX = 'loc';
/** 「叫出完整工地選單」特殊碼 */
const PICK = '_pick';
/** 「略過、不記工地」特殊碼 */
const SKIP = '_skip';

/** 建「目前工地」選單：每個啟用工地一顆（loc:{code}）＋「略過」 */
function buildContextPickerButtons(projectStore: ProjectStore): OutgoingButton[] {
  const buttons: OutgoingButton[] = projectStore.listActive().map((p) => ({
    text: `${p.code} ${p.name}`,
    callbackData: `${LOC_PREFIX}:${p.code}`,
  }));
  buttons.push({ text: '↩️ 略過', callbackData: `${LOC_PREFIX}:${SKIP}` });
  return buttons;
}

/**
 * 收到「單獨定位」（無照片、無文字）時的處理：判斷工地並回覆／詢問。
 * 注意：resolver.resolve 在 telegram_location 命中時會順手設好上下文，故判得出時不必再設。
 */
export async function promptBareLocation(
  adapter: MessageChannelAdapter,
  resolver: SiteResolver,
  projectStore: ProjectStore,
  msg: IncomingMessage,
): Promise<void> {
  // 尚未設定任何工地：選單會是空的，直接提示去新增
  if (projectStore.listActive().length === 0) {
    await adapter.sendMessage(
      msg.chatId,
      '📍 收到定位，但目前還沒有任何工地。請先用 /新增工地 代碼 建立工地。',
    );
    return;
  }

  // 跑工地判斷（沒有照片，故 photoGpsList 留空；命中 telegram_location 會自動設上下文）
  const result = resolver.resolve({
    reporterId: msg.reporterId,
    photoGpsList: [],
    location: msg.location,
  });

  if (result.projectCode) {
    // 判得出：回覆判定到的工地，附一顆「✏️ 改工地」讓使用者更正
    const proj = projectStore.findByCode(result.projectCode);
    const label = `${result.projectCode}${proj ? ` ${proj.name}` : ''}`;
    const head =
      result.method === 'telegram_location'
        ? `📍 你的定位在【${label}】範圍內（距 ${result.distanceM}m）。`
        : `📍 收到定位，沿用你最近的工地【${label}】。`;
    await adapter.sendMessageWithButtons(
      msg.chatId,
      `${head}\n接下來 2 小時內你傳的照片會先歸到這。`,
      [{ text: '✏️ 不是這個 / 改工地', callbackData: `${LOC_PREFIX}:${PICK}` }],
    );
    logger.info('定位判定（單獨定位）', {
      工地: label,
      判定方式: result.method,
      距離M: result.distanceM ?? '（不適用）',
      回報人: `${msg.reporterName}（${msg.reporterId}）`,
    });
    return;
  }

  // 判不出：直接跳工地選單問人
  await adapter.sendMessageWithButtons(
    msg.chatId,
    '📍 這個位置不在任何已登錄工地的範圍內。你現在在哪個工地？',
    buildContextPickerButtons(projectStore),
    1,
  );
  logger.info('定位判不出工地，已送選單詢問', {
    位置: msg.location
      ? `${msg.location.latitude},${msg.location.longitude}`
      : '（無）',
    回報人: `${msg.reporterName}（${msg.reporterId}）`,
  });
}

/** 是否為本流程的回呼（loc:…） */
export function isLocationCallback(cb: IncomingCallback): boolean {
  return cb.data.startsWith(`${LOC_PREFIX}:`);
}

/**
 * 處理 loc:… 回呼。
 *  - loc:_pick → 就地改成完整工地選單
 *  - loc:_skip → 略過、移除按鈕
 *  - loc:{code} → 設定回報人「目前工地」上下文（只記不搬檔）
 */
export async function handleLocationCallback(
  adapter: MessageChannelAdapter,
  projectStore: ProjectStore,
  contextStore: UserContextStore,
  cb: IncomingCallback,
  nowMs: number,
): Promise<void> {
  const code = cb.data.slice(`${LOC_PREFIX}:`.length);

  if (code === PICK) {
    if (projectStore.listActive().length === 0) {
      await adapter.answerCallback(cb.callbackId, '尚未設定工地，請先 /新增工地');
      return;
    }
    await adapter.answerCallback(cb.callbackId);
    await adapter.editMessageText(
      cb.chatId,
      cb.messageId,
      '📍 你現在在哪個工地？',
      buildContextPickerButtons(projectStore),
      1,
    );
    return;
  }

  if (code === SKIP) {
    await adapter.answerCallback(cb.callbackId, '好，先略過');
    await adapter.editMessageText(
      cb.chatId,
      cb.messageId,
      '↩️ 已略過。之後傳照片時再判斷工地，或先標代碼／用「檔案」傳保留 GPS。',
    );
    return;
  }

  // 選定工地：只記目前工地上下文（不動 projects.json、不搬任何檔案）
  const proj = projectStore.findByCode(code);
  if (!proj) {
    await adapter.answerCallback(cb.callbackId, '找不到這個工地');
    return;
  }
  contextStore.set(cb.fromId, proj.code, nowMs);
  await adapter.answerCallback(cb.callbackId, '已記住 ✅');
  await adapter.editMessageText(
    cb.chatId,
    cb.messageId,
    `✅ 已記住你在 ${proj.code} ${proj.name}。\n接下來 2 小時內你傳的照片會先歸到這（仍可標代碼或改工地）。`,
  );
  logger.info('定位選單：已設目前工地上下文', {
    工地: `${proj.code} ${proj.name}`,
    回報人: `${cb.fromName}（${cb.fromId}）`,
  });
}
