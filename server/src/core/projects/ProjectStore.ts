// ============================================================
// ProjectStore.ts — 工地清單來源
// 從 data/projects.seed.json 載入（gitignore 已擋；含案場座標屬敏感資訊）。
// 提供：依代碼查、依 GPS 找最近且在半徑內的工地、新增（/addproject 用）。
// ============================================================
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { logger } from '../../utils/logger';
import { distanceMeters } from './geo';

/** 工地設定 */
export interface Project {
  code: string; // 工地代碼，例如 A001
  name: string; // 工地名稱
  centerLat: number | null; // 中心點緯度（null＝未設座標，不做 GPS 自動判定）
  centerLng: number | null; // 中心點經度（null＝未設）
  radiusMeters: number | null; // 判斷半徑（公尺）（null＝未設）
  active: boolean; // 是否啟用
}

/** GPS 命中結果 */
export interface GpsMatch {
  project: Project;
  distanceM: number;
}

/** 工地清單檔路徑（執行期資料，不進 git） */
const SEED_PATH = join('data', 'projects.seed.json');

export class ProjectStore {
  private projects: Project[] = [];

  /** seed 路徑可注入（管理後台 smoke 測試用暫存檔）；預設用正式路徑 */
  constructor(private readonly seedPath: string = SEED_PATH) {}

  /** 從 seed 檔載入；檔案不存在則清單為空（可用 /addproject 新增） */
  async load(): Promise<void> {
    if (!existsSync(this.seedPath)) {
      logger.warn(
        `找不到 ${this.seedPath}，工地清單為空。可複製 projects.seed.example.json 或用 /addproject 新增。`,
      );
      return;
    }
    const raw = await readFile(this.seedPath, 'utf8');
    this.projects = JSON.parse(raw) as Project[];
    logger.info(`載入工地清單 ${this.projects.length} 筆`);
  }

  list(): Project[] {
    return this.projects;
  }

  /** 啟用中的工地（按鈕詢問工地選單用） */
  listActive(): Project[] {
    return this.projects.filter((p) => p.active);
  }

  /** 依代碼查（不分大小寫） */
  findByCode(code: string): Project | undefined {
    const c = code.trim().toUpperCase();
    return this.projects.find((p) => p.code.toUpperCase() === c);
  }

  /** 找出「啟用中、且該點落在半徑內」最近的工地；都不符回 null */
  findByGps(lat: number, lng: number): GpsMatch | null {
    let best: GpsMatch | null = null;
    for (const p of this.projects) {
      if (!p.active) continue;
      // 未設座標的工地不參與 GPS 判定（只能靠 #代碼 / recent_context）
      if (p.centerLat == null || p.centerLng == null || p.radiusMeters == null) {
        continue;
      }
      const d = distanceMeters(lat, lng, p.centerLat, p.centerLng);
      if (d <= p.radiusMeters && (best === null || d < best.distanceM)) {
        best = { project: p, distanceM: d };
      }
    }
    return best;
  }

  /** 新增工地並寫回 seed 檔 */
  async add(project: Project): Promise<void> {
    this.projects.push(project);
    await mkdir(dirname(this.seedPath), { recursive: true });
    await writeFile(this.seedPath, JSON.stringify(this.projects, null, 2), 'utf8');
  }

  /** 設定/更新某工地的中心座標與半徑（傳「位置」設 GPS 用），寫回 seed。找不到代碼回 false */
  async setCenter(
    code: string,
    lat: number,
    lng: number,
    radiusMeters: number,
  ): Promise<boolean> {
    const p = this.findByCode(code);
    if (!p) return false;
    p.centerLat = lat;
    p.centerLng = lng;
    p.radiusMeters = radiusMeters;
    await mkdir(dirname(this.seedPath), { recursive: true });
    await writeFile(this.seedPath, JSON.stringify(this.projects, null, 2), 'utf8');
    return true;
  }
}
