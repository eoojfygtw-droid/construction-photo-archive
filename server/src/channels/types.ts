// ============================================================
// types.ts — 平台無關的訊息正規化型別
// 核心邏輯只認這些型別，不認 Telegram/LINE 的原始格式。
// 未來換通道時，只要新 adapter 把原始訊息轉成這裡的型別即可。
// ============================================================

/** 來源平台代號 */
export type ChannelName = 'telegram' | 'line';

/** 單張照片/檔案（V0 先記錄識別碼，尚未下載原檔） */
export interface IncomingPhoto {
  /** 平台檔案識別碼（Telegram = file_id），後續步驟才用它下載原檔 */
  fileId: string;
  /**
   * 上傳方式：
   * - photo：經平台壓縮，EXIF 會被移除
   * - document：原檔上傳，保留 EXIF（重要照片建議用此方式）
   */
  uploadType: 'photo' | 'document';
  fileName?: string;
  fileSize?: number;
  width?: number;
  height?: number;
  /** document 的 MIME 類型（photo 通常為 undefined） */
  mimeType?: string;
}

/** 位置訊息（用於工地判斷第 3 層 telegram_location） */
export interface IncomingLocation {
  latitude: number;
  longitude: number;
}

/** 正規化後的單則訊息 */
export interface IncomingMessage {
  channel: ChannelName;
  /** 群組/對話識別碼 */
  chatId: string;
  /** 訊息識別碼 */
  messageId: string;
  /**
   * 相簿群組識別碼：同一次傳多張照片時，這批訊息共用同一個值。
   * 後續步驟會以此做 debounce 合併為同一筆紀錄。
   */
  mediaGroupId?: string;
  /** 回報人平台 ID */
  reporterId: string;
  /** 回報人顯示名稱 */
  reporterName: string;
  /** 純文字訊息內容 */
  text?: string;
  /** 照片附帶的說明文字 */
  caption?: string;
  /** 本則訊息夾帶的照片/檔案 */
  photos: IncomingPhoto[];
  /** 位置訊息（若有） */
  location?: IncomingLocation;
  /** 平台訊息時間（unix 秒） */
  date: number;
}

/** 收到訊息時的處理函式 */
export type IncomingMessageHandler = (
  msg: IncomingMessage,
) => void | Promise<void>;

/**
 * 正規化後的按鈕回呼（inline keyboard 被按下）。
 * 對應 Telegram callback_query；換 LINE 時由其 adapter 轉成同一型別。
 */
export interface IncomingCallback {
  channel: ChannelName;
  /** 平台回呼識別碼（用於關掉按鈕的「載入中」轉圈） */
  callbackId: string;
  /** 按鈕攜帶的資料（我們在這裡編入「動作:紀錄id」） */
  data: string;
  chatId: string;
  /** 被按的那則訊息 id（用於就地更新訊息內容） */
  messageId: string;
  /** 按按鈕的人 */
  fromId: string;
  fromName: string;
}

/** 收到按鈕回呼時的處理函式 */
export type IncomingCallbackHandler = (
  cb: IncomingCallback,
) => void | Promise<void>;
