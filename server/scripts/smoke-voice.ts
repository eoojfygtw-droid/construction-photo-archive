// ============================================================
// smoke-voice.ts — 錄音存檔離線驗收（不需 Telegram）
// 驗證：語音訊息走照片同一套管線——下載落暫存（跳過 EXIF）→ writeRecord
// 建檔＋搬檔歸檔（upload_type=voice）→ Bot 回覆分開顯示「照片/錄音」。
// 用法：npx tsx scripts/smoke-voice.ts
// ============================================================
import { readFile, access, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Db } from '../src/db';
import type { IncomingMessage } from '../src/channels/types';
import type { OutgoingButton } from '../src/channels/MessageChannelAdapter';
import { intakePhotos } from '../src/core/media/photoIntake';
import { writeRecord } from '../src/core/records/recordWriter';
import { promptConfirm } from '../src/core/confirm/confirmFlow';

const exists = (p: string) =>
  access(p).then(() => true).catch(() => false);

/** 只實作會用到的 adapter 方法：downloadFile 回假音檔、send 系列錄下呼叫 */
class StubAdapter {
  sent: { text: string; buttons: OutgoingButton[] }[] = [];
  /** fileId → 假下載結果（remotePath 控制副檔名來源） */
  files: Record<string, { buffer: Buffer; remotePath: string }> = {};

  async downloadFile(fileId: string) {
    const f = this.files[fileId];
    if (!f) throw new Error(`沒有假檔案 ${fileId}`);
    return { buffer: f.buffer, remotePath: f.remotePath };
  }
  async sendMessageWithButtons(_chatId: string, text: string, buttons: OutgoingButton[]) {
    this.sent.push({ text, buttons });
  }
  // 不會用到的方法給空殼，滿足型別
  readonly channel = 'telegram' as const;
  onMessage() {}
  onCallback() {}
  async start() {}
  async stop() {}
  async sendMessage() {}
  async answerCallback() {}
  async editMessageText() {}
}

/**
 * 工地清單 stub（writeRecord 只用 findByCode）。
 * 注意：用獨立測試代碼 SMKV，避免歸檔檔案寫進真實工地（A001 等）今日的資料夾，
 * 與驗收期實際資料撞目錄；跑完會清掉整個 SMKV 測試資料夾。
 */
const projectStore = {
  findByCode: (code: string) =>
    code === 'SMKV' ? { code: 'SMKV', name: '煙霧測試工地' } : undefined,
} as never;

function voiceMsg(messageId: string, photos: IncomingMessage['photos'], text?: string): IncomingMessage {
  return {
    channel: 'telegram',
    chatId: '-100',
    messageId,
    reporterId: 'u1',
    reporterName: '阿明',
    text,
    photos,
    date: Math.floor(Date.now() / 1000),
  };
}

async function run() {
  let pass = 0;
  let fail = 0;
  const ok = (cond: boolean, label: string) => {
    if (cond) { pass++; console.log(`  ✅ ${label}`); }
    else { fail++; console.log(`  ❌ ${label}`); }
  };

  const adapter = new StubAdapter();

  // ---- 1) 語音下載落暫存：副檔名沿用平台路徑、跳過 EXIF ----
  console.log('1) 語音訊息下載落暫存（.oga、無 EXIF）');
  adapter.files['v1'] = {
    buffer: Buffer.from('fake-ogg-bytes'),
    remotePath: 'voice/file_1.oga',
  };
  const msg1 = voiceMsg('vmsg-1', [
    { fileId: 'v1', uploadType: 'voice', mimeType: 'audio/ogg', durationSec: 7 },
  ]);
  const intake1 = await intakePhotos(adapter as never, msg1);
  ok(intake1.length === 1, '回傳 1 件媒體');
  ok(intake1[0].filePath.endsWith('.oga'), `副檔名取自平台路徑：${intake1[0].filePath}`);
  ok(intake1[0].uploadType === 'voice', 'uploadType=voice');
  ok(!intake1[0].exif.takenAt && !intake1[0].exif.gps, '跳過 EXIF（空結果）');
  ok(await exists(intake1[0].filePath), '暫存檔已落地');

  // ---- 2) 平台路徑無副檔名 → 依 MIME 推 .oga ----
  console.log('2) 平台路徑無副檔名 → 依 MIME 推斷');
  adapter.files['v2'] = {
    buffer: Buffer.from('fake-ogg-bytes-2'),
    remotePath: 'voice/file_2',
  };
  const msg2 = voiceMsg('vmsg-2', [
    { fileId: 'v2', uploadType: 'voice', mimeType: 'audio/ogg', durationSec: 3 },
  ]);
  const intake2 = await intakePhotos(adapter as never, msg2);
  ok(intake2[0].filePath.endsWith('.oga'), `MIME audio/ogg → .oga：${intake2[0].filePath}`);

  // ---- 3) writeRecord 全管線：建檔 + 搬檔歸檔 + DB upload_type=voice ----
  console.log('3) writeRecord：語音建檔歸檔（工地 SMKV）');
  const db = new Db(':memory:');
  await db.init();
  const { recordNo, recordId, archiveDir } = await writeRecord(
    db,
    voiceMsg('vmsg-1', msg1.photos, '三樓水電師傅口頭回報'),
    intake1,
    { projectCode: 'SMKV', method: 'manual_code' } as never,
    projectStore,
  );
  ok(recordNo.startsWith('SMKV-'), `紀錄編號前綴正確：${recordNo}`);
  ok(archiveDir.includes(join('projects', 'SMKV_煙霧測試工地')), `歸檔到工地目錄：${archiveDir}`);
  const archivedVoice = join(archiveDir, `${recordNo}-01.oga`);
  ok(await exists(archivedVoice), '錄音已搬到歸檔目錄（{record_no}-01.oga）');
  ok(!(await exists(intake1[0].filePath)), '暫存原檔已移走');
  const photoRows = db.getPhotos(recordId);
  ok(photoRows.length === 1 && photoRows[0].uploadType === 'voice', 'DB photos.upload_type=voice');
  ok(!photoRows[0].hasExif, 'DB has_exif=0');
  const meta = JSON.parse(await readFile(join(archiveDir, 'metadata.json'), 'utf8'));
  ok(meta.photos.length === 1 && meta.photos[0].upload_type === 'voice', 'metadata.photos.upload_type=voice');
  ok(meta.text_note === '三樓水電師傅口頭回報', 'metadata.text_note 正確（語音附帶文字）');

  // ---- 4) Bot 回覆：照片/錄音分開計數 ----
  console.log('4) Bot 回覆分開顯示照片與錄音');
  await promptConfirm(adapter as never, '-100', {
    recordId,
    recordNo,
    projectLabel: 'SMKV 煙霧測試工地',
    method: 'manual_code',
    photoCount: 0,
    voiceCount: 1,
    note: '三樓水電師傅口頭回報',
    reporterName: '阿明',
  });
  const sent = adapter.sent.at(-1);
  ok(!!sent && sent.text.includes('🎤 錄音：1 則'), '回覆含「🎤 錄音：1 則」');
  ok(!!sent && sent.text.includes('📷 照片：0 張'), '照片計數不含錄音');

  db.close();

  // ---- 清掉測試殘檔（SMKV 工地整夾 + 未消化的暫存檔） ----
  await rm(join('data', 'projects', 'SMKV_煙霧測試工地'), { recursive: true, force: true });
  // 暫存日期分層與 photoIntake 同邏輯（本機自然日）
  const d = new Date(msg2.date * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const stagingDate = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  await rm(join('data', '_staging', stagingDate, 'vmsg-2'), { recursive: true, force: true }).catch(() => {});
  console.log('  🧹 已清掉 SMKV 測試資料夾與暫存殘檔');

  console.log(`\n結果：${pass} 通過 / ${fail} 失敗`);
  process.exit(fail === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error('smoke test 異常', err);
  process.exit(1);
});
