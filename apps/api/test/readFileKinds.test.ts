/**
 * อ่านไฟล์ตามชนิดที่ตรวจได้จากเนื้อไฟล์ (6 ต.ค. 69): ชนิดที่อ่านไม่ได้ต้องถูกปฏิเสธพร้อมบอกชนิดที่รับได้, ภาพสแกนต้องไม่ลอบตกไปใช้เครื่องอ่านอื่น,
 * และ xls รุ่นเก่า (OLE2) ต้องผ่านตัวอ่านตารางเดียวกับ xlsx ไม่ถูกตีเป็นข้อความ CSV
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { readTimesheetFile, UploadError } from '../src/lib/uploadService.js';
import { extractTimesheetFromSpreadsheet } from '../src/lib/spreadsheetExtractionService.js';

test('ไฟล์ Word ถูกปฏิเสธพร้อมบอกชนิดที่รับได้', async () => {
  const docx = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('[Content_Types].xml word/document.xml')]);
  await assert.rejects(
    readTimesheetFile({ fileBytes: docx, fileName: 'ts.docx' }),
    (e: any) => e instanceof UploadError && /Word/.test(e.message) && /PDF/.test(e.message) && /Excel/.test(e.message),
  );
});

test('ภาพสแกนไม่ลอบตกไปใช้เครื่องอ่านอื่นเมื่อ ABBYY ยังตั้งค่าไม่ครบ', async () => {
  const saved = { ...process.env };
  for (const k of ['ABBYY_BASE_URL', 'ABBYY_CLIENT_ID', 'ABBYY_CLIENT_SECRET', 'ABBYY_SKILL_ID']) delete process.env[k];
  try {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
    await assert.rejects(
      readTimesheetFile({ fileBytes: png, fileName: 'scan.png' }),
      (e: any) => /ABBYY/.test(e.message) && /ตั้งค่า/.test(e.message),
    );
  } finally {
    Object.assign(process.env, saved);
  }
});

test('xls รุ่นเก่า (OLE2) อ่านผ่านตัวอ่านตารางได้ผลเหมือน xlsx', async () => {
  const rows = [
    ['ชื่อบริษัท :', 'iPassion Co., Ltd.'],
    ['เดือน/ปี :', 'กันยายน 2026'],
    ['ชื่อ-สกุล :', 'ทดสอบ ระบบ'],
    ['วันที่', 'เวลาเข้า', 'เวลาออก'],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
  const asXlsx = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  const asXls = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'biff8' }));
  assert.equal(asXls[0], 0xd0, 'ต้องได้ไฟล์ OLE2 จริง');

  const outcome = async (b: Buffer) => {
    try {
      const r: any = await extractTimesheetFromSpreadsheet(b, {});
      return { ok: true, name: r.data.employeeName, period: r.data.period };
    } catch (e: any) {
      return { ok: false, msg: String(e.message) };
    }
  };
  const a = await outcome(asXlsx);
  const b = await outcome(asXls);
  assert.deepEqual(b, a);
});
