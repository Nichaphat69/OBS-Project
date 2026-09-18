/**
 * รอบบิลต้องนับเฉพาะคนที่อยู่ในสัญญา "ในรอบนั้นจริง" (18 ก.ย. 69)
 *
 * `getCycleStatus()` เดิมนับพนักงานทุกคนที่ผูกกับสัญญาอยู่ตอนนี้ โดยไม่ดูช่วงวันที่ของการมอบหมายงาน
 * (assignments.start_date / end_date) เลย ทั้งที่แต่ละคนเข้า-ออกโครงการคนละเดือนกันได้ และหน้าจออื่น
 * ที่ถามคำถามเดียวกัน (`overdueTimesheets()` กับหน้า "บันทึกการส่ง") ดูช่วงวันที่อยู่แล้ว
 *
 * ผลคือคนที่เพิ่งเข้าโครงการเดือนมีนา จะถูกนับว่า "ยังไม่ส่ง Timesheet" ของเดือนมกรา-กุมภา ที่เขายังไม่ได้
 * ทำงานด้วยซ้ำ → `complete` เป็น false ตลอดไป → รอบนั้นค้างที่สถานะ "ได้ไม่ครบ" และติด blocker
 * "ยังได้ Timesheet ไม่ครบ" ใน previewCycleInvoice() ทำให้วางบิลรอบเก่าไม่ได้เลยทั้งที่ข้อมูลครบแล้วจริง
 *
 * ⚠️ เทสต์ไฟล์อื่นใช้ fixture ชุดเดียวกัน — ไฟล์นี้จึงสร้างพนักงาน/การมอบหมายงานของตัวเองแยกต่างหาก
 * แล้วลบทิ้งให้หมดใน test.after ไม่แตะแถวเดิมของ fixture เลย
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@obs/db';

import { seedFixtures, CONTRACT } from './helpers/testDb.js';
import { getCycleStatus } from '../src/lib/dashboardService.js';

await seedFixtures();

/** พนักงานที่เพิ่งเข้าโครงการกลางสัญญา — สัญญาเริ่ม 2026-01 แต่คนนี้เริ่ม 2026-03 */
const LATE_EMP = 'EMP-LATEJOIN-TEST';
const LATE_ASG = 'ASG-LATEJOIN-TEST';

await prisma.employee.create({
  data: { id: LATE_EMP, nameTh: 'สมหญิง เข้าทีหลัง', invoicePosition: 'Developer', createdAt: '2026-03-01T00:00:00.000Z' },
});
await prisma.assignment.create({
  data: {
    id: LATE_ASG,
    contractId: CONTRACT.id,
    employeeId: LATE_EMP,
    monthlyRate: 50000,
    startDate: '2026-03-01',
    endDate: CONTRACT.endDate,
    status: 'active',
  },
});

test.after(async () => {
  await prisma.assignment.deleteMany({ where: { id: LATE_ASG } });
  await prisma.employee.deleteMany({ where: { id: LATE_EMP } });
  await prisma.$disconnect();
});

test('รอบก่อนที่พนักงานจะเข้าโครงการ ต้องไม่นับเขาว่า "ยังไม่ส่ง"', async () => {
  const jan = await getCycleStatus(CONTRACT.id, '2026-01');

  assert.ok(
    !jan.missing.includes('สมหญิง เข้าทีหลัง'),
    'คนที่เริ่มงาน มี.ค. ต้องไม่ถูกทวง Timesheet ของเดือน ม.ค. ที่ยังไม่ได้ทำงาน',
  );
});

test('รอบที่พนักงานอยู่ในโครงการจริง ต้องยังนับเขาตามปกติ', async () => {
  const mar = await getCycleStatus(CONTRACT.id, '2026-03');

  assert.ok(
    mar.missing.includes('สมหญิง เข้าทีหลัง'),
    'เดือน มี.ค. เขาอยู่ในโครงการแล้วและยังไม่ส่ง — ต้องถูกทวงตามปกติ ไม่ใช่กรองทิ้งทั้งหมด',
  );
});

test('คนที่ออกจากโครงการไปแล้ว ต้องไม่ถูกทวงรอบหลังจากที่ออกไป', async () => {
  await prisma.assignment.update({ where: { id: LATE_ASG }, data: { endDate: '2026-04-30' } });

  const may = await getCycleStatus(CONTRACT.id, '2026-05');
  assert.ok(
    !may.missing.includes('สมหญิง เข้าทีหลัง'),
    'สัญญาการมอบหมายจบ เม.ย. — เดือน พ.ค. ต้องไม่ทวงเขาอีก',
  );

  await prisma.assignment.update({ where: { id: LATE_ASG }, data: { endDate: CONTRACT.endDate } });
});
