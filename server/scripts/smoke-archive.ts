// ============================================================
// smoke-archive.ts — 5-2 搬檔歸檔離線驗收（不需 Telegram）
// 建假暫存檔 → 跑 archiveRecord 兩種情境（工地 / INBOX）→ 驗證結果。
// 用法：npx tsx scripts/smoke-archive.ts
// ============================================================
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { archiveRecord, type ArchiveInput } from '../src/core/records/archiver';
import type { IntakeResult } from '../src/core/media/photoIntake';

const exists = (p: string) =>
  access(p).then(() => true).catch(() => false);

async function makeStaging(dir: string, names: string[]): Promise<string[]> {
  await mkdir(dir, { recursive: true });
  const paths: string[] = [];
  for (const n of names) {
    const p = join(dir, n);
    await writeFile(p, `fake-bytes-${n}`);
    paths.push(p);
  }
  return paths;
}

async function run() {
  let pass = 0;
  let fail = 0;
  const ok = (cond: boolean, label: string) => {
    if (cond) {
      pass++;
      console.log(`  ✅ ${label}`);
    } else {
      fail++;
      console.log(`  ❌ ${label}`);
    }
  };

  // ---- 情境 1：判定到工地（含名稱有非法字元，測淨化）----
  console.log('情境 1：判定到工地 A001');
  const stage1 = join('data', '_staging', '2026-06-05', 'msg-1');
  const files1 = await makeStaging(stage1, ['1.jpg', '2.heic']);
  const intake1: IntakeResult[] = [
    {
      filePath: files1[0],
      uploadType: 'document',
      bytes: 1234,
      exif: { takenAt: '2026-06-05T01:02:03.000Z', gps: { latitude: 25.03, longitude: 121.56 } },
    },
    {
      filePath: files1[1],
      uploadType: 'photo',
      bytes: 5678,
      exif: {},
    },
  ];
  const input1: ArchiveInput = {
    recordNo: 'A001-20260605-001',
    projectCode: 'A001',
    projectName: '信義:豪宅*案/B棟', // 故意含非法字元
    yyyy: '2026',
    mm: '06',
    dd: '05',
    intake: intake1,
    meta: {
      channel: 'telegram',
      resolveMethod: 'manual_code',
      reporterId: 'u123',
      reporterName: '阿明',
      receivedAt: '2026-06-05T08:00:00.000Z',
      takenAt: '2026-06-05T01:02:03.000Z',
      gps: { latitude: 25.03, longitude: 121.56 },
      mediaGroupId: 'mg-1',
      sourceMessageId: 'msg-1',
      textNote: '三樓樑柱裂縫，需複查',
    },
  };
  const r1 = await archiveRecord(input1);
  const expectDir1 = join('data', 'projects', 'A001_信義豪宅案B棟', '2026', '06', '05', 'records', 'A001-20260605-001');
  ok(r1.dir === expectDir1, `歸檔目錄正確（名稱已淨化）：${r1.dir}`);
  ok(await exists(join(r1.dir, 'A001-20260605-001-01.jpg')), '照片 1 已搬到歸檔目錄');
  ok(await exists(join(r1.dir, 'A001-20260605-001-02.heic')), '照片 2 已搬到歸檔目錄');
  ok(!(await exists(files1[0])) && !(await exists(files1[1])), '暫存原檔已移走');
  ok(!(await exists(stage1)), '已淨空的暫存目錄已清掉');
  ok(await exists(join(r1.dir, 'text.txt')), 'text.txt 已寫');
  ok((await readFile(join(r1.dir, 'text.txt'), 'utf8')).trim() === '三樓樑柱裂縫，需複查', 'text.txt 內容正確');
  const meta1 = JSON.parse(await readFile(join(r1.dir, 'metadata.json'), 'utf8'));
  ok(meta1.record_no === 'A001-20260605-001', 'metadata.record_no 正確');
  ok(meta1.project.code === 'A001' && meta1.project.name === '信義:豪宅*案/B棟', 'metadata.project 保留原始名稱');
  ok(meta1.photos.length === 2, 'metadata.photos 數量正確');
  ok(meta1.photos[0].file === 'A001-20260605-001-01.jpg' && meta1.photos[0].has_exif === true, 'metadata 第一張檔名與 has_exif 正確');
  ok(meta1.photos[1].has_exif === false, 'metadata 第二張 has_exif=false（photo 壓掉 EXIF）');

  // ---- 情境 2：判不出工地 → INBOX，且無文字（不寫 text.txt）----
  console.log('情境 2：未判定 → _inbox，無文字');
  const stage2 = join('data', '_staging', '2026-06-05', 'msg-2');
  const files2 = await makeStaging(stage2, ['1.jpg']);
  const intake2: IntakeResult[] = [
    { filePath: files2[0], uploadType: 'photo', bytes: 999, exif: {} },
  ];
  const input2: ArchiveInput = {
    recordNo: 'INBOX-20260605-001',
    projectCode: null,
    projectName: null,
    yyyy: '2026',
    mm: '06',
    dd: '05',
    intake: intake2,
    meta: {
      channel: 'telegram',
      resolveMethod: 'unresolved',
      reporterId: 'u999',
      reporterName: null,
      receivedAt: '2026-06-05T09:00:00.000Z',
      takenAt: null,
      gps: null,
      mediaGroupId: null,
      sourceMessageId: 'msg-2',
      textNote: null,
    },
  };
  const r2 = await archiveRecord(input2);
  ok(r2.dir === join('data', '_inbox', 'INBOX-20260605-001'), `INBOX 歸檔目錄正確：${r2.dir}`);
  ok(await exists(join(r2.dir, 'INBOX-20260605-001-01.jpg')), '照片已搬到 _inbox');
  ok(!(await exists(join(r2.dir, 'text.txt'))), '無文字 → 不寫 text.txt');
  const meta2 = JSON.parse(await readFile(join(r2.dir, 'metadata.json'), 'utf8'));
  ok(meta2.project.code === null && meta2.resolve_method === 'unresolved', 'INBOX metadata 正確');

  console.log(`\n結果：${pass} 通過 / ${fail} 失敗`);
  process.exit(fail === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error('smoke test 異常', err);
  process.exit(1);
});
