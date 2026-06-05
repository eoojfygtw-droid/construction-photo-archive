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
  centerLat: number; // 中心點緯度
  centerLng: number; // 中心點經度
  radiusMeters: number; // 判斷半徑（公尺）
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

  /** 從 seed 檔載入；檔案不存在則清單為空（可用 /addproject 新增） */
  async load(): Promise<void> {
    if (!existsSync(SEED_PATH)) {
      logger.warn(
        `找不到 ${SEED_PATH}，工地清單為空。可複製 projects.seed.example.json 或用 /addproject 新增。`,
      );
      return;
    }
    const raw = await readFile(SEED_PATH, 'utf8');
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
    await mkdir(dirname(SEED_PATH), { recursive: true });
    await writeFile(SEED_PATH, JSON.stringify(this.projects, null, 2), 'utf8');
  }
}
