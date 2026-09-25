/**
 * หน้า "ความคืบหน้าของฉัน" (ฝั่งพนักงาน) ต้องเห็นผลทันทีที่ตัวเองกดส่งไฟล์ — เจ้าของระบบเจอจริง
 * 25 ก.ย. 69: ส่ง Timesheet เดือน มิ.ย. ไปแล้ว แต่หน้ายังขึ้น "ยังไม่ได้ส่ง Timesheet" พร้อมไฮไลต์
 * เหมือนไม่เคยส่งเลย เพราะ employeeProgress() อ่านแค่ตาราง `timesheets` ส่วน submitOwnTimesheetFile()
 * ตั้งใจไม่สร้างแถวนั้น (เก็บไฟล์ไว้ที่ `ai_reads` + บันทึกช่องทางที่ `timesheet_submissions` แทน)
 *
 * เทสต์ชุดนี้จึงล็อกไว้สองด้าน: (1) เห็น "ส่งแล้ว" ทันทีที่มี method ใน timesheet_submissions และ
 * (2) แถวใน `timesheets` ยังต้องชนะเสมอ เหมือนที่ submissionLogService.ts ยึดมาตลอด — ให้หน้าฝั่ง
 * พนักงานกับหน้า "บันทึกการส่ง" ฝั่ง admin พูดตรงกันเรื่องคนเดียวกันรอบเดียวกัน
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@obs/db';

import { seedFixtures, CONTRACT } from './helpers/testDb.js';
import { employeeProgress } from '../src/lib/dashboardService.js';

await seedFixtures();

const EMP = 'EMP-0042';
/** รอบที่ fixture ไม่ได้สร้าง timesheet ไว้ (มีแค่ 2026-01) และอยู่ในอายุสัญญา 2026-01..2026-06 */
const PERIOD = '2026-03';

test.after(async () => {
  await prisma.timesheetSubmission.deleteMany({ where: { employeeId: EMP } });
  await prisma.$disconnect();
});

async function periodOf(period: string) {
  const progress = await employeeProgress(EMP);
  const contract = progress!.contracts.find((c) => c.contractId === CONTRACT.id)!;
  return contract.periods.find((p) => p.period === period)!;
}

test('ยังไม่ได้กดส่งอะไรเลย → ขึ้น "ยังไม่ได้ส่ง Timesheet" ตามเดิม', async () => {
  await prisma.timesheetSubmission.deleteMany({ where: { employeeId: EMP } });

  const p = await periodOf(PERIOD);
  assert.equal(p.timesheetStatus, 'not_submitted');
  assert.equal(p.timesheetStatusLabel, 'ยังไม่ได้ส่ง Timesheet');
});

test('พนักงานส่งไฟล์ผ่านระบบแล้ว (ยังไม่มีแถว timesheets) → ต้องขึ้น "ส่งแล้ว รอตรวจสอบ" ไม่ใช่ "ยังไม่ได้ส่ง"', async () => {
  await prisma.timesheetSubmission.deleteMany({ where: { employeeId: EMP } });
  const now = '2026-03-10T03:00:00.000Z';
  await prisma.timesheetSubmission.create({
    data: {
      id: `TSS-${EMP}-${PERIOD}`, employeeId: EMP, period: PERIOD, contractId: CONTRACT.id,
      method: 'self_obs', methodChosenAt: now, createdAt: now, updatedAt: now,
    },
  });

  const p = await periodOf(PERIOD);
  assert.equal(p.timesheetStatus, 'submitted', 'ส่งไฟล์ไปแล้วต้องไม่ถูกนับว่ายังไม่ส่ง — ไม่งั้นหน้าจะไฮไลต์ให้ส่งซ้ำ');
  assert.equal(p.timesheetStatusLabel, 'ส่งแล้ว รอตรวจสอบ');
  // ยังไม่มีแถว timesheets จริง — ฟิลด์นี้ต้องยัง null อยู่ ไม่ใช่กุขึ้นมาให้ครบ
  assert.equal(p.timesheetId, null);
});

test('คนตรวจทำเครื่องหมายว่ามีปัญหา → กลับไปเป็นรอบที่ต้องลงมือ ไม่ถูกกลบด้วยการที่เคยกดส่ง', async () => {
  await prisma.timesheetSubmission.deleteMany({ where: { employeeId: EMP } });
  const now = '2026-03-10T03:00:00.000Z';
  await prisma.timesheetSubmission.create({
    data: {
      id: `TSS-${EMP}-${PERIOD}`, employeeId: EMP, period: PERIOD, contractId: CONTRACT.id,
      method: 'self_obs', methodChosenAt: now, reviewStatus: 'problem', createdAt: now, updatedAt: now,
    },
  });

  const p = await periodOf(PERIOD);
  assert.equal(p.timesheetStatus, 'rejected');
});

test('มีแถวใน timesheets แล้วชนะเสมอ — ไม่ถูก timesheet_submissions ทับ', async () => {
  await prisma.timesheetSubmission.deleteMany({ where: { employeeId: EMP } });
  const now = '2026-01-10T03:00:00.000Z';
  await prisma.timesheetSubmission.create({
    data: {
      id: `TSS-${EMP}-2026-01`, employeeId: EMP, period: '2026-01', contractId: CONTRACT.id,
      method: 'self_obs', methodChosenAt: now, createdAt: now, updatedAt: now,
    },
  });

  const p = await periodOf('2026-01'); // fixture สร้าง timesheet ของรอบนี้ไว้แล้ว
  assert.ok(p.timesheetId, 'รอบนี้ต้องมีแถว timesheets จริงจาก fixture');
  assert.notEqual(p.timesheetStatus, 'submitted', 'สถานะจริงจาก timesheets ต้องชนะค่าที่อนุมานจากการกดส่ง');
});
