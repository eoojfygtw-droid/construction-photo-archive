// ============================================================
// exif.ts — EXIF 解析（用 exifr，支援 JPEG / HEIC 等）
// 取「拍攝時間」與「GPS 座標」；無 EXIF 或解析失敗時回空物件，不丟錯。
// 註：Telegram 以 photo 上傳會壓掉 EXIF；要保留請用 document（原檔）上傳。
// ============================================================
import exifr from 'exifr';

/** EXIF 解析結果 */
export interface ExifResult {
  /** 拍攝時間（ISO 字串），取自 DateTimeOriginal / CreateDate / ModifyDate */
  takenAt?: string;
  /** 照片內嵌 GPS（若有） */
  gps?: { latitude: number; longitude: number };
}

/**
 * 從檔案位元組解析 EXIF。
 * 失敗或無資料時回空物件——歸檔流程靠這個判斷「有沒有拍攝時間/GPS」。
 */
export async function extractExif(buffer: Buffer): Promise<ExifResult> {
  try {
    const data = await exifr.parse(buffer, {
      tiff: true,
      exif: true,
      gps: true,
    });
    if (!data) return {};

    const result: ExifResult = {};

    // 拍攝時間：優先 DateTimeOriginal，退而求其次
    const taken = data.DateTimeOriginal ?? data.CreateDate ?? data.ModifyDate;
    if (taken instanceof Date && !Number.isNaN(taken.getTime())) {
      result.takenAt = taken.toISOString();
    } else if (typeof taken === 'string' && taken) {
      result.takenAt = taken;
    }

    // GPS：exifr 在 gps:true 時提供 latitude/longitude 便捷欄位
    if (
      typeof data.latitude === 'number' &&
      typeof data.longitude === 'number'
    ) {
      result.gps = { latitude: data.latitude, longitude: data.longitude };
    }

    return result;
  } catch {
    // 非影像、無 EXIF、格式不支援等都當作「無 EXIF」
    return {};
  }
}
