/**
 * พนักงานส่งไฟล์ Timesheet ของตัวเอง (18 ก.ย. 69)
 *
 * เส้นนี้เป็น**เส้นเขียนเส้นแรกที่ role 'user' เรียกได้** จึงต้องตรึงไว้สองเรื่องที่พังแล้วพังเงียบ:
 *   1. ต้องบันทึกว่า "ส่งแล้ว ช่องทาง self_obs" จริง ไม่ใช่แค่เก็บไฟล์ — ถ้าเก็บไฟล์อย่างเดียว
 *      หน้า "บันทึกการส่ง" จะยังขึ้นว่ายังไม่ส่ง ทั้งที่พนักงานส่งมาแล้ว และไม่มีใครรู้ว่าพลาด
 *   2. ต้อง**ไม่**สร้างแถว `timesheets` — พนักงานมีหน้าที่ส่งอย่างเดียว การอ่าน/ตรวจยังเป็นของ admin
 *      ถ้าเผลอสร้างแถวขึ้นมา จะกลายเป็นว่ารอบนั้นถูกนับว่ามีข้อมูลแล้วทั้งที่ยังไม่มีใครอ่านเลย
 *
 * ⚠️ ใช้ fixture ร่วมกับไฟล์อื่น — ทุกอย่างที่สร้างต้องลบคืนใน test.after ให้ครบ
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@obs/db';

import { seedFixtures } from './helpers/testDb.js';
import {
  submitOwnTimesheetFile,
  SubmitOwnFileError,
  pendingSubmissionFor,
} from '../src/lib/timesheetSubmissionService.js';

await seedFixtures();

const EMP = 'EMP-0042';
const FILE_B64 = Buffer.from('%PDF-1.4 fake timesheet').toString('base64');

test.after(async () => {
  await prisma.aiRead.deleteMany({ where: { employeeId: EMP, source: 'employee_submit' } });
  await prisma.timesheetSubmission.deleteMany({ where: { employeeId: EMP } });
  await prisma.$disconnect();
});

test('ไฟล์ว่าง/ชื่อไฟล์ว่าง ต้องถูกปฏิเสธก่อนแตะฐานข้อมูล', async () => {
  await assert.rejects(
    () => submitOwnTimesheetFile({ employeeId: EMP, actor: 'ทดสอบ', fileName: 'a.pdf', fileBase64: '' }),
    (e: unknown) => e instanceof SubmitOwnFileError && e.status === 400,
  );
  await assert.rejects(
    () => submitOwnTimesheetFile({ employeeId: EMP, actor: 'ทดสอบ', fileName: '  ', fileBase64: FILE_B64 }),
    (e: unknown) => e instanceof SubmitOwnFileError && e.status === 400,
  );
});

test('ไฟล์ใหญ่เกิน 8 MB ต้องถูกปฏิเสธ — กันไม่ให้ไปโดน body parser ตัดแล้วได้ error ที่อ่านไม่รู้เรื่อง', async () => {
  const tooBig = Buffer.alloc(8 * 1024 * 1024 + 1).toString('base64');
  await assert.rejects(
    () => submitOwnTimesheetFile({ employeeId: EMP, actor: 'ทดสอบ', fileName: 'big.pdf', fileBase64: tooBig }),
    (e: unknown) => e instanceof SubmitOwnFileError && e.status === 400,
  );
});

test('ส่งสำเร็จ: เก็บไฟล์ + บันทึกช่องทาง self_obs ของรอบที่ค้างอยู่ และไม่สร้างแถว timesheets', async () => {
  const pending = await pendingSubmissionFor(EMP);
  assert.ok(pending, 'fixture ต้องมีรอบที่ยังไม่ส่งอย่างน้อยหนึ่งรอบ ไม่งั้นเทสต์นี้ไม่ได้ทดสอบอะไรเลย');

  const timesheetsBefore = await prisma.timesheet.count({ where: { employeeId: EMP } });

  const result = await submitOwnTimesheetFile({
    employeeId: EMP,
    actor: 'ทดสอบ พนักงาน',
    fileName: 'timesheet.pdf',
    fileBase64: FILE_B64,
  });

  assert.equal(result.period, pending.period);
  assert.equal(result.fileName, 'timesheet.pdf');

  // ไฟล์ต้องอยู่จริงและเป็นไบต์เดิม ไม่ใช่แค่มีแถว
  const stored = await prisma.aiRead.findUnique({
    where: { id: result.fileId },
    select: { fileBytes: true, employeeId: true, period: true, source: true, model: true },
  });
  assert.equal(stored?.employeeId, EMP);
  assert.equal(stored?.period, pending.period);
  assert.equal(stored?.source, 'employee_submit');
  assert.equal(stored?.model, null, 'ห้ามมี model เพราะเส้นนี้ไม่ได้อ่านไฟล์');
  assert.equal(Buffer.from(stored!.fileBytes!).toString('utf8'), '%PDF-1.4 fake timesheet');

  // หัวใจของฟีเจอร์ — ต้องขึ้นว่าส่งแล้วผ่านระบบ OBS
  const submission = await prisma.timesheetSubmission.findUnique({
    where: { employeeId_period: { employeeId: EMP, period: pending.period } },
    select: { method: true, methodChosenAt: true, contractId: true },
  });
  assert.equal(submission?.method, 'self_obs');
  assert.ok(submission?.methodChosenAt, 'ต้องบันทึกเวลาที่ส่งด้วย ไม่งั้นหน้าบันทึกการส่งจะโชว์ "—"');
  assert.equal(submission?.contractId, pending.contractId);

  assert.equal(
    await prisma.timesheet.count({ where: { employeeId: EMP } }),
    timesheetsBefore,
    'เส้นนี้ต้องไม่สร้างแถว timesheets — การอ่าน/ตรวจยังเป็นงานของ admin',
  );
});
