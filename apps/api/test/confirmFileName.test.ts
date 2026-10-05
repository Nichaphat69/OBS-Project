/**
 * ชื่อไฟล์ Timesheet ต้องเป็นชื่อไฟล์ต้นฉบับจริงเสมอ (5 ต.ค. 69)
 *
 * เดิมตอนกดยืนยันหลังอ่านไฟล์ หน้าเว็บไม่ได้ส่งชื่อไฟล์มา ระบบเลยตั้งชื่อปลอมว่า "อัปโหลดด้วยมือ · 2026-07" ทั้งที่ชื่อจริง
 * เก็บอยู่ในแถวอ่านไฟล์ (ai_reads.file_name) อยู่แล้ว
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@obs/db';
import { seedFixtures } from './helpers/testDb.js';
import { confirmTimesheet, logAiRead } from '../src/lib/uploadService.js';

// ไม่ให้ LINE จริงจาก .env หลุดเข้ามา เหมือนเทสต์ ingest
process.env.LINE_CHANNEL_ACCESS_TOKEN = '';
process.env.LINE_CHANNEL_SECRET = '';
process.env.LINE_APPROVER_TARGET = '';

await seedFixtures();

test.after(async () => {
  await prisma.$disconnect();
});

const extraction = {
  employeeName: 'Pongpun Mamak',
  period: '2026-02',
  position: 'Java Programmer',
  totalWorkDays: 20,
  totalLeaveDays: 0,
  days: [],
  leaveDays: [],
};

test('ยืนยันโดยไม่ส่งชื่อไฟล์ → ใช้ชื่อไฟล์ต้นฉบับจากแถวอ่านไฟล์ ไม่ใช่ "อัปโหลดด้วยมือ"', async () => {
  const documentNo = await logAiRead({
    source: 'upload',
    fileName: 'T8 Ruethaiwan 8-2026.pdf',
    result: { data: extraction, fileBytes: Buffer.from('%PDF-ไฟล์ปลอม') },
    actor: 'ทดสอบ',
  });

  const result = await confirmTimesheet({ documentNo, extraction, actor: 'ทดสอบ' });
  assert.ok(result.timesheetId, 'ต้องบันทึกสำเร็จ');

  const row = await prisma.timesheet.findUnique({ where: { id: result.timesheetId! } });
  assert.equal(row?.sourceFile, 'T8 Ruethaiwan 8-2026.pdf');
});

test('ถ้าหน้าเว็บส่งชื่อไฟล์มาเอง → ใช้ชื่อที่ส่งมา', async () => {
  const documentNo = await logAiRead({
    source: 'upload',
    fileName: 'ชื่อในประวัติการอ่าน.pdf',
    result: { data: { ...extraction, period: '2026-03' }, fileBytes: Buffer.from('%PDF-ไฟล์ปลอม') },
    actor: 'ทดสอบ',
  });
  const result = await confirmTimesheet({
    documentNo,
    extraction: { ...extraction, period: '2026-03' },
    fileName: 'ชื่อที่ส่งมาตรงๆ.pdf',
    actor: 'ทดสอบ',
  });
  const row = await prisma.timesheet.findUnique({ where: { id: result.timesheetId! } });
  assert.equal(row?.sourceFile, 'ชื่อที่ส่งมาตรงๆ.pdf');
});
