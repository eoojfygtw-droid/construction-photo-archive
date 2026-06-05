// ============================================================
// SiteResolver.ts — 工地判斷引擎（前 4 層）
// 優先序：manual_code > photo_gps > telegram_location > recent_context > unresolved
// 判不出（unresolved）時不硬猜，交由上層走 _inbox + 按鈕詢問（下一步）。
// 成功（前三層）會更新該回報人的最近工地上下文，供第 4 層沿用。
// ============================================================
import type { ProjectStore } from '../projects/ProjectStore';
import type { UserContextStore } from './UserContextStore';

/** 工地判斷方式 */
export type ResolveMethod =
  | 'manual_code'
  | 'photo_gps'
  | 'telegram_location'
  | 'recent_context'
  | 'unresolved';

/** 經緯度 */
export interface LatLng {
  latitude: number;
  longitude: number;
}

/** 判斷輸入 */
export interface ResolveInput {
  reporterId: string;
  text?: string;
  caption?: string;
  /** 照片 EXIF 取得的 GPS（可能多張） */
  photoGpsList: LatLng[];
  /** Telegram 位置訊息 */
  location?: LatLng;
}

/** 判斷結果 */
export interface ResolveResult {
  /** 判定到的工地代碼；null＝無法判斷 */
  projectCode: string | null;
  method: ResolveMethod;
  /** GPS 類判定時，與工地中心的距離（公尺） */
  distanceM?: number;
}

/** 比對手動工地代碼，例如訊息中的 #A001 */
const MANUAL_CODE_RE = /#([A-Za-z][A-Za-z0-9]*)/;

export class SiteResolver {
  constructor(
    private readonly projects: ProjectStore,
    private readonly contexts: UserContextStore,
  ) {}

  resolve(input: ResolveInput): ResolveResult {
    const now = Date.now();

    // 第 1 層：manual_code — 訊息/說明含 #代碼 且該代碼存在
    const codeText = `${input.text ?? ''} ${input.caption ?? ''}`;
    const m = codeText.match(MANUAL_CODE_RE);
    if (m) {
      const proj = this.projects.findByCode(m[1]);
      if (proj) {
        this.contexts.set(input.reporterId, proj.code, now);
        return { projectCode: proj.code, method: 'manual_code' };
      }
    }

    // 第 2 層：photo_gps — 任一張照片的 EXIF GPS 落在某工地半徑內
    for (const gps of input.photoGpsList) {
      const hit = this.projects.findByGps(gps.latitude, gps.longitude);
      if (hit) {
        this.contexts.set(input.reporterId, hit.project.code, now);
        return {
          projectCode: hit.project.code,
          method: 'photo_gps',
          distanceM: Math.round(hit.distanceM),
        };
      }
    }

    // 第 3 層：telegram_location — 位置訊息落在某工地半徑內
    if (input.location) {
      const hit = this.projects.findByGps(
        input.location.latitude,
        input.location.longitude,
      );
      if (hit) {
        this.contexts.set(input.reporterId, hit.project.code, now);
        return {
          projectCode: hit.project.code,
          method: 'telegram_location',
          distanceM: Math.round(hit.distanceM),
        };
      }
    }

    // 第 4 層：recent_context — 該回報人 2 小時內的最近工地
    const ctx = this.contexts.get(input.reporterId, now);
    if (ctx) {
      return { projectCode: ctx, method: 'recent_context' };
    }

    // 都判不出
    return { projectCode: null, method: 'unresolved' };
  }
}
