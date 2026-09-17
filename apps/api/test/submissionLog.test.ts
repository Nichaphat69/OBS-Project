/**
 * หน้า "บันทึกการส่ง" — ชั้นอ่าน (17 ก.ย. 69)
 *
 * เน้นสองข้อที่พังแล้วจะพังเงียบ:
 *   1. สถานะต้องคำนวณจากของจริง — มีไฟล์ใน `timesheets` แล้วต้องชนะเสมอ ไม่ว่าใครจะกดอะไรไว้
 *   2. รายชื่อต้องมาจากสัญญาที่ active ไม่ใช่จากแถวในตาราง — คนที่เงียบสนิทต้องโผล่ในหน้าจอ
 *      เพราะเป็นคนที่ต้องตามมากที่สุด ถ้าหายไปจะไม่มีใครรู้ว่าหายไป
 *
 * ⚠️ เทสต์ไฟล์อื่นใช้ fixture ชุดเดียวกันและถูก import ก่อนเทสต์เริ่มรัน — ทุกอย่างที่ไฟล์นี้สร้าง/แก้
 * ต้องคืนค่าให้ครบใน test.after เสมอ (เจอจริงมาแล้วว่าทำให้ไฟล์อื่นแดงแบบไล่ต้นตอยากมาก)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@obs/db';

import { seedFixtures, CONTRACT } from './helpers/testDb.js';
import { listTimesheetSubmissions } from '../src/lib/submissionLogService.js';

await seedFixtures();

const EMP_A = 'EMP-0042';
const EMP_B = 'EMP-0018';
const TODAY = '2026-03-15'; // รอบปัจจุบัน = 2026-03 → นับรอบ 2026-01..2026-03

const ORIGINAL_LINE_ID = (await prisma.employee.findUnique({ where: { id: EMP_A } }))?.lineUserId ?? null;

test.after(async () => {
  await prisma.timesheetSubmission.deleteMany({ where: { employeeId: { in: [EMP_A, EMP_B] } } });
  await prisma.employee.update({ where: { id: EMP_A }, data: { lineUserId: ORIGINAL_LINE_ID } });
  await prisma.$disconnect();
});

async function putSubmission(employeeId: string, period: string, data: Record<string, unknown>) {
  const now = '2026-03-10T03:00:00.000Z';
  await prisma.timesheetSubmission.upsert({
    where: { employeeId_period: { employeeId, period } },
    create: { id: `TSS-${employeeId}-${period}`, employeeId, period, contractId: CONTRACT.id, createdAt: now, updatedAt: now, ...data },
    update: { updatedAt: now, ...data },
  });
}

const rowFor = (res: Awaited<ReturnType<typeof listTimesheetSubmissions>>, employeeId: string, period: string) =>
  res.rows.find((r) => r.employeeId === employeeId && r.period === period);

test('รายชื่อมาจากสัญญาที่ active ไม่ใช่จากแถวในตาราง — คนที่ไม่เคยกดอะไรเลยต้องโผล่', async () => {
  await prisma.timesheetSubmission.deleteMany({ where: { employeeId: { in: [EMP_A, EMP_B] } } });

  const res = await listTimesheetSubmissions({ today: TODAY });

  // 2 พนักงาน × 3 รอบ (ม.ค.–มี.ค.) ทั้งที่ไม่มีแถวใน timesheet_submissions เลยสักแถว
  assert.equal(res.rows.length, 6);
  assert.ok(rowFor(res, EMP_A, '2026-03'), 'คนที่เงียบสนิทต้องมีแถวของรอบปัจจุบัน');
  assert.equal(rowFor(res, EMP_A, '2026-03')?.status, 'not_submitted');
  // ไม่นับรอบอนาคต — ขึ้นว่า "ยังไม่ส่ง" สำหรับเดือนที่ยังไม่ถึงกำหนดไม่มีความหมาย
  assert.equal(rowFor(res, EMP_A, '2026-04'), undefined);
});

test('มีไฟล์ใน timesheets แล้วชนะเสมอ แม้ไม่มีใครกดอะไรในระบบใหม่เลย', async () => {
  await prisma.timesheetSubmission.deleteMany({ where: { employeeId: { in: [EMP_A, EMP_B] } } });

  const res = await listTimesheetSubmissions({ today: TODAY, period: '2026-01' });
  const row = rowFor(res, EMP_A, '2026-01');

  assert.ok(row?.timesheetId, 'fixture มี timesheet ของรอบ 2026-01 อยู่แล้ว');
  assert.ok(row?.status === 'confirmed' || row?.status === 'pending_review');
  assert.notEqual(row?.status, 'not_submitted', 'มีไฟล์แล้วต้องไม่ขึ้นว่ายังไม่ส่ง');
});

test('ไฟล์จริงชนะช่องทางที่พนักงานกดไว้ — กันหน้าจอค้างอยู่ที่ "ส่งแล้ว" ทั้งที่ตรวจเสร็จแล้ว', async () => {
  await putSubmission(EMP_A, '2026-01', { method: 'self_email', methodChosenAt: '2026-02-01T02:00:00.000Z' });

  const row = rowFor(await listTimesheetSubmissions({ today: TODAY, period: '2026-01' }), EMP_A, '2026-01');
  assert.notEqual(row?.status, 'submitted', 'สถานะต้องมาจากไฟล์จริง ไม่ใช่จากสิ่งที่พนักงานกดไว้');
  assert.equal(row?.method, 'self_email', 'แต่ช่องทางที่เขาเลือกยังต้องแสดงอยู่');
});

test('เลือกช่องทางแล้วแต่ไฟล์ยังไม่เข้าระบบ = ส่งแล้ว (รอตรวจ)', async () => {
  await putSubmission(EMP_A, '2026-02', { method: 'proxy_email', methodChosenAt: '2026-03-01T02:00:00.000Z', actedBy: 'ผู้ดูแล ก.' });

  const row = rowFor(await listTimesheetSubmissions({ today: TODAY, period: '2026-02' }), EMP_A, '2026-02');
  assert.equal(row?.status, 'submitted');
  assert.equal(row?.actedBy, 'ผู้ดูแล ก.', 'ผู้ดำเนินการต้องแยกจากผู้ตรวจ');
});

test('กดขอเลื่อน = ยังไม่ส่ง แต่ต้องแยกออกจากคนที่เงียบสนิทได้', async () => {
  await putSubmission(EMP_A, '2026-03', { deferredAt: '2026-03-12T02:00:00.000Z' });

  const res = await listTimesheetSubmissions({ today: TODAY, period: '2026-03' });
  const deferred = rowFor(res, EMP_A, '2026-03');
  const silent = rowFor(res, EMP_B, '2026-03');

  assert.equal(deferred?.status, 'not_submitted', 'ยังนับรวมในยอด "ยังไม่ส่ง" ตามที่ตกลงกับหน้าเว็บ');
  assert.equal(deferred?.deferredAt, '2026-03-12T02:00:00.000Z', 'แต่ต้องรู้ได้ว่าเขาตอบแล้ว');
  assert.equal(silent?.deferredAt, null, 'ส่วนคนที่เงียบสนิทต้องไม่มีค่านี้');
  assert.equal(deferred?.method, null, 'ขอเลื่อนไม่ใช่ช่องทางการส่ง');
});

test('คนตรวจทำเครื่องหมาย "มีปัญหา" ไว้ ต้องไม่ถูกกลบเมื่อพนักงานกดปุ่มใหม่', async () => {
  await putSubmission(EMP_B, '2026-02', { reviewStatus: 'problem', reviewedBy: 'บัญชี ข.', reviewedAt: '2026-03-02T02:00:00.000Z' });

  const row = rowFor(await listTimesheetSubmissions({ today: TODAY, period: '2026-02' }), EMP_B, '2026-02');
  assert.equal(row?.status, 'problem');
  assert.equal(row?.reviewedBy, 'บัญชี ข.');
});

test('แยก "ยืนยันว่ายังไม่ส่ง" ออกจาก "ระบบไม่มีทางรู้เพราะยังไม่ผูก LINE"', async () => {
  await prisma.timesheetSubmission.deleteMany({ where: { employeeId: { in: [EMP_A, EMP_B] } } });
  await prisma.employee.update({ where: { id: EMP_A }, data: { lineUserId: 'Uline-test-001' } });

  const res = await listTimesheetSubmissions({ today: TODAY, period: '2026-03' });

  assert.equal(rowFor(res, EMP_A, '2026-03')?.canReceiveLineUpdates, true);
  assert.equal(rowFor(res, EMP_B, '2026-03')?.canReceiveLineUpdates, false);
  assert.equal(res.unknownDueToNoLineLink, 1, 'ต้องนับเฉพาะคนที่ยังไม่ส่ง "และ" ไม่ได้ผูก LINE');
});

test('role พนักงาน เห็นเฉพาะของตัวเอง และตัวเลขสรุปต้องตรงกับแถวที่กรองแล้ว', async () => {
  const res = await listTimesheetSubmissions({ today: TODAY, restrictToEmployeeId: EMP_B });

  assert.ok(res.rows.length > 0);
  assert.ok(res.rows.every((r) => r.employeeId === EMP_B), 'ต้องไม่หลุดข้อมูลคนอื่นออกไป');
  const totalled = Object.values(res.summary).reduce((a, b) => a + b, 0);
  assert.equal(totalled, res.rows.length, 'ยอดรวมของการ์ดสรุปต้องเท่ากับจำนวนแถวที่แสดงจริง');
});
