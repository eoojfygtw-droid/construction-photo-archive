// ============================================================
// MessageChannelAdapter.ts — 訊息通道介面（平台無關）
// 核心邏輯只依賴這個介面，未來從 Telegram 換到 LINE 不需改核心。
// ============================================================
import type { ChannelName, IncomingMessageHandler } from './types';

/** 回覆訊息附帶的按鈕（對應 Telegram inline keyboard） */
export interface OutgoingButton {
  /** 按鈕顯示文字 */
  text: string;
  /** 按下後回傳的識別資料（callback data） */
  callbackData: string;
}

/** 下載回來的檔案 */
export interface DownloadedFile {
  /** 原始檔案位元組 */
  buffer: Buffer;
  /** 平台端檔案相對路徑（通常含副檔名，可用來判斷 ext） */
  remotePath: string;
  /** 檔案大小（位元組） */
  fileSize?: number;
}

/** 訊息通道 adapter 介面 */
export interface MessageChannelAdapter {
  /** 通道代號 */
  readonly channel: ChannelName;

  /** 註冊收到訊息的處理函式（須在 start() 前呼叫） */
  onMessage(handler: IncomingMessageHandler): void;

  /** 啟動收訊（Telegram = 開始 long polling）；持續運行直到 stop() */
  start(): Promise<void>;

  /** 停止收訊並釋放資源 */
  stop(): Promise<void>;

  /** 依平台檔案識別碼下載原始檔案 */
  downloadFile(fileId: string): Promise<DownloadedFile>;

  /** 送出純文字訊息 */
  sendMessage(chatId: string, text: string): Promise<void>;

  /** 送出附按鈕的訊息（人工確認用的 ✅/✏️ 即走這裡） */
  sendMessageWithButtons(
    chatId: string,
    text: string,
    buttons: OutgoingButton[],
  ): Promise<void>;
}
