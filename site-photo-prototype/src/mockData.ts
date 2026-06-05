// ============================================================
// mockData.ts — 全部假資料,僅供 Prototype 操作流程驗證
// 不連 Telegram / SQLite / AI,不處理真實檔案
// ============================================================

/** 紀錄狀態 */
export type RecordStatus =
  | '一般記錄'
  | '待處理'
  | '已改善'
  | '結案'
  | '不列管'
  | '未分類';

export const ALL_STATUSES: RecordStatus[] = [
  '一般記錄',
  '待處理',
  '已改善',
  '結案',
  '不列管',
  '未分類',
];

/** 工地判斷方式 */
export type ResolveMethod =
  | 'manual_code'
  | 'photo_gps'
  | 'telegram_location'
  | 'recent_context'
  | 'user_selected'
  | 'unresolved';

/** 工地判斷方式的中文說明(畫面顯示用) */
export const RESOLVE_METHOD_LABEL: Record<ResolveMethod, string> = {
  manual_code: '使用者指定工地代碼',
  photo_gps: '照片 GPS 判斷',
  telegram_location: 'Telegram 位置訊息',
  recent_context: '最近一次工地上下文',
  user_selected: '使用者手動選擇',
  unresolved: '無法判斷',
};

/** 工地設定 */
export interface Project {
  id: number;
  code: string; // 工地代碼,例如 A001
  name: string; // 工地名稱
  centerLat: number; // 中心點緯度
  centerLng: number; // 中心點經度
  radiusMeters: number; // 判斷半徑(公尺)
  active: boolean; // 啟用 / 停用
}

/** 照片(mock,只有標籤文字,不含真實檔案) */
export interface MockPhoto {
  label: string; // 照片內容描述,例如「牆面空心近拍」
  uploadType: 'photo' | 'document'; // Telegram 上傳方式
  hasExif: boolean; // 是否含 EXIF GPS
}

/** 工地紀錄 */
export interface SiteRecord {
  id: number;
  recordNo: string; // 紀錄編號,例如 A001-20260605-001
  projectCode: string | null; // 歸屬工地代碼,null = 未歸檔
  date: string; // 收件日期 YYYY-MM-DD
  time: string; // 收件時間 HH:mm
  reporter: string; // 回報人
  textNote: string; // 文字備註(Telegram caption / 訊息)
  photos: MockPhoto[];
  voiceCount: number; // 語音則數
  voiceTranscript: string; // 語音轉文字(mock)
  gps: { lat: number; lng: number; distanceM: number } | null; // GPS 與最近工地距離
  resolveMethod: ResolveMethod;
  status: RecordStatus;
  manualNote: string; // 後台人工備註
}

/** 工地資料夾名稱 */
export function projectFolderName(p: Project): string {
  return `${p.code}_${p.name}`;
}

/** 計算紀錄的歸檔資料夾路徑(未歸檔放 _inbox 暫存區) */
export function recordFolderPath(r: SiteRecord, projects: Project[]): string {
  if (!r.projectCode) return `data/_inbox/${r.recordNo}/`;
  const p = projects.find((x) => x.code === r.projectCode);
  const [y, m, d] = r.date.split('-');
  const folder = p ? projectFolderName(p) : r.projectCode;
  return `data/projects/${folder}/${y}/${m}/${d}/records/${r.recordNo}/`;
}

// ------------------------------------------------------------
// 工地假資料(台中地區座標)
// ------------------------------------------------------------
export const MOCK_PROJECTS: Project[] = [
  { id: 1, code: 'A001', name: '青山苑', centerLat: 24.1618, centerLng: 120.6469, radiusMeters: 300, active: true },
  { id: 2, code: 'A002', name: '文心匯', centerLat: 24.153, centerLng: 120.662, radiusMeters: 250, active: true },
  { id: 3, code: 'B001', name: '河岸天景', centerLat: 24.1745, centerLng: 120.6258, radiusMeters: 400, active: true },
  { id: 4, code: 'C001', name: '惠民段透天(已完工)', centerLat: 24.18, centerLng: 120.68, radiusMeters: 200, active: false },
];

// ------------------------------------------------------------
// 紀錄假資料(今日 = 2026-06-05)
// ------------------------------------------------------------
export const TODAY = '2026-06-05';

export const MOCK_RECORDS: SiteRecord[] = [
  {
    id: 1,
    recordNo: 'A001-20260605-001',
    projectCode: 'A001',
    date: '2026-06-05',
    time: '08:12',
    reporter: '王大明(工地主任)',
    textNote: '#A001 5F 泥作 牆面空心,需打除重做',
    photos: [
      { label: '牆面空心近拍', uploadType: 'photo', hasExif: false },
      { label: '牆面空心全景', uploadType: 'photo', hasExif: false },
      { label: '位置示意(柱位旁)', uploadType: 'photo', hasExif: false },
    ],
    voiceCount: 0,
    voiceTranscript: '',
    gps: null,
    resolveMethod: 'manual_code',
    status: '待處理',
    manualNote: '',
  },
  {
    id: 2,
    recordNo: 'A001-20260605-002',
    projectCode: 'A001',
    date: '2026-06-05',
    time: '09:05',
    reporter: '李志成(監工)',
    textNote: '3F 水電配管完成,留存記錄',
    photos: [
      { label: '3F 天花配管', uploadType: 'document', hasExif: true },
      { label: '3F 管線間', uploadType: 'document', hasExif: true },
    ],
    voiceCount: 0,
    voiceTranscript: '',
    gps: { lat: 24.16201, lng: 120.64715, distanceM: 32 },
    resolveMethod: 'photo_gps',
    status: '一般記錄',
    manualNote: '',
  },
  {
    id: 3,
    recordNo: 'A002-20260605-001',
    projectCode: 'A002',
    date: '2026-06-05',
    time: '10:21',
    reporter: '陳美華(總經理特助)',
    textNote: '外牆磁磚進場抽查,色差確認 OK',
    photos: [
      { label: '磁磚棧板全景', uploadType: 'photo', hasExif: false },
      { label: '磁磚色號近拍', uploadType: 'photo', hasExif: false },
    ],
    voiceCount: 1,
    voiceTranscript: '磁磚今天進場兩批,色號跟樣品比對沒有問題,先記錄起來。',
    gps: null,
    resolveMethod: 'recent_context',
    status: '一般記錄',
    manualNote: '',
  },
  {
    id: 4,
    recordNo: 'B001-20260605-001',
    projectCode: 'B001',
    date: '2026-06-05',
    time: '11:02',
    reporter: '林俊宏(水電班)',
    textNote: 'B2 消防管吊架間距不足,已通知廠商',
    photos: [{ label: '吊架間距量測', uploadType: 'document', hasExif: true }],
    voiceCount: 0,
    voiceTranscript: '',
    gps: { lat: 24.17488, lng: 120.62542, distanceM: 58 },
    resolveMethod: 'photo_gps',
    status: '待處理',
    manualNote: '已開缺失單 #D-114',
  },
  {
    id: 5,
    recordNo: 'INBOX-20260605-001',
    projectCode: null,
    date: '2026-06-05',
    time: '11:40',
    reporter: '王大明(工地主任)',
    textNote: '樓梯間踢腳板缺角',
    photos: [
      { label: '踢腳板缺角近拍', uploadType: 'photo', hasExif: false },
      { label: '樓梯間全景', uploadType: 'photo', hasExif: false },
    ],
    voiceCount: 0,
    voiceTranscript: '',
    gps: null,
    resolveMethod: 'unresolved',
    status: '未分類',
    manualNote: '',
  },
  {
    id: 6,
    recordNo: 'INBOX-20260605-002',
    projectCode: null,
    date: '2026-06-05',
    time: '13:15',
    reporter: '林俊宏(水電班)',
    photos: [{ label: '配電箱接線', uploadType: 'photo', hasExif: false }],
    textNote: '',
    voiceCount: 1,
    voiceTranscript: '這個配電箱接線我覺得要再確認一下,等主任看過。',
    gps: null,
    resolveMethod: 'unresolved',
    status: '未分類',
    manualNote: '',
  },
  {
    id: 7,
    recordNo: 'A001-20260604-001',
    projectCode: 'A001',
    date: '2026-06-04',
    time: '08:45',
    reporter: '李志成(監工)',
    textNote: '5F 泥作打底完成',
    photos: [
      { label: '5F 打底全景', uploadType: 'photo', hasExif: false },
      { label: '陰角收邊', uploadType: 'photo', hasExif: false },
    ],
    voiceCount: 0,
    voiceTranscript: '',
    gps: null,
    resolveMethod: 'recent_context',
    status: '一般記錄',
    manualNote: '',
  },
  {
    id: 8,
    recordNo: 'A001-20260604-002',
    projectCode: 'A001',
    date: '2026-06-04',
    time: '14:30',
    reporter: '王大明(工地主任)',
    textNote: '2F 窗框周邊防水缺失,改善完成回報',
    photos: [
      { label: '防水改善後近拍', uploadType: 'document', hasExif: true },
      { label: '防水改善後全景', uploadType: 'document', hasExif: true },
    ],
    voiceCount: 0,
    voiceTranscript: '',
    gps: { lat: 24.16165, lng: 120.64702, distanceM: 21 },
    resolveMethod: 'photo_gps',
    status: '已改善',
    manualNote: '對應缺失單 #D-102,待複查',
  },
  {
    id: 9,
    recordNo: 'A002-20260604-001',
    projectCode: 'A002',
    date: '2026-06-04',
    time: '15:50',
    reporter: '陳美華(總經理特助)',
    textNote: '(Telegram 位置訊息 + 照片)模板拆除進度記錄',
    photos: [{ label: '模板拆除進度', uploadType: 'photo', hasExif: false }],
    voiceCount: 0,
    voiceTranscript: '',
    gps: { lat: 24.15312, lng: 120.66188, distanceM: 17 },
    resolveMethod: 'telegram_location',
    status: '一般記錄',
    manualNote: '',
  },
  {
    id: 10,
    recordNo: 'B001-20260603-001',
    projectCode: 'B001',
    date: '2026-06-03',
    time: '09:20',
    reporter: '李志成(監工)',
    textNote: '1F 大廳石材接縫不齊',
    photos: [
      { label: '石材接縫近拍', uploadType: 'photo', hasExif: false },
      { label: '大廳全景', uploadType: 'photo', hasExif: false },
    ],
    voiceCount: 0,
    voiceTranscript: '',
    gps: null,
    resolveMethod: 'manual_code',
    status: '已改善',
    manualNote: '6/4 廠商已重貼,照片待補',
  },
  {
    id: 11,
    recordNo: 'B001-20260603-002',
    projectCode: 'B001',
    date: '2026-06-03',
    time: '16:05',
    reporter: '王大明(工地主任)',
    textNote: '#B001 頂樓女兒牆洩水坡度記錄',
    photos: [{ label: '女兒牆洩水坡度', uploadType: 'photo', hasExif: false }],
    voiceCount: 0,
    voiceTranscript: '',
    gps: null,
    resolveMethod: 'manual_code',
    status: '結案',
    manualNote: '',
  },
  {
    id: 12,
    recordNo: 'A001-20260602-001',
    projectCode: 'A001',
    date: '2026-06-02',
    time: '10:10',
    reporter: '林俊宏(水電班)',
    textNote: '弱電箱品牌與設計不符,業主同意替代品',
    photos: [{ label: '弱電箱銘牌', uploadType: 'photo', hasExif: false }],
    voiceCount: 1,
    voiceTranscript: '設計圖上的品牌缺貨,業主那邊已經口頭同意用替代品牌,先拍照備查。',
    gps: null,
    resolveMethod: 'recent_context',
    status: '不列管',
    manualNote: '業主 6/2 LINE 同意,截圖已存',
  },
  {
    id: 13,
    recordNo: 'INBOX-20260602-001',
    projectCode: null,
    date: '2026-06-02',
    time: '17:42',
    reporter: '李志成(監工)',
    textNote: '下班前補拍的,明天再整理',
    photos: [
      { label: '現場雜項 1', uploadType: 'photo', hasExif: false },
      { label: '現場雜項 2', uploadType: 'photo', hasExif: false },
      { label: '現場雜項 3', uploadType: 'photo', hasExif: false },
    ],
    voiceCount: 0,
    voiceTranscript: '',
    gps: null,
    resolveMethod: 'unresolved',
    status: '未分類',
    manualNote: '',
  },
  {
    id: 14,
    recordNo: 'A002-20260602-001',
    projectCode: 'A002',
    date: '2026-06-02',
    time: '08:30',
    reporter: '王大明(工地主任)',
    textNote: '鷹架護網破損,已要求當日修復',
    photos: [
      { label: '護網破損處', uploadType: 'document', hasExif: true },
      { label: '修復後(下午補拍)', uploadType: 'photo', hasExif: false },
    ],
    voiceCount: 0,
    voiceTranscript: '',
    gps: { lat: 24.15275, lng: 120.66235, distanceM: 44 },
    resolveMethod: 'photo_gps',
    status: '結案',
    manualNote: '工安項目,當日完成',
  },
];
