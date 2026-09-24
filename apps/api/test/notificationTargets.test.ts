/**
 * ปลายทางแจ้งเตือน LINE ของ error ระบบ ต้องแยกจากที่แจ้งฝ่ายบัญชี (24 ก.ย. 69 ตามที่ขอ "error แจ้งเตือน
 * มาให้ admin") — ดู lineAdminTargets() ใน notificationRecipientsService.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@obs/db';

import { seedFixtures } from './helpers/testDb.js';
import { lineAdminTargets, lineApproverTargets } from '../src/lib/notificationRecipientsService.js';

await seedFixtures();

test.after(async () => {
  await prisma.$disconnect();
});

test('lineAdminTargets ใช้ LINE_ADMIN_TARGET แยกจาก LINE_APPROVER_TARGET เมื่อตั้งไว้', async () => {
  const beforeAdmin = process.env.LINE_ADMIN_TARGET;
  const beforeApprover = process.env.LINE_APPROVER_TARGET;
  process.env.LINE_ADMIN_TARGET = 'Uadmin-target';
  process.env.LINE_APPROVER_TARGET = 'Uaccounting-target';
  try {
    assert.deepEqual(await lineAdminTargets(), ['Uadmin-target']);
    assert.deepEqual(await lineApproverTargets(), ['Uaccounting-target'], 'ต้องไม่ปนกัน — คนละปลายทาง');
  } finally {
    if (beforeAdmin === undefined) delete process.env.LINE_ADMIN_TARGET; else process.env.LINE_ADMIN_TARGET = beforeAdmin;
    if (beforeApprover === undefined) delete process.env.LINE_APPROVER_TARGET; else process.env.LINE_APPROVER_TARGET = beforeApprover;
  }
});

test('lineAdminTargets ถอยไปใช้ LINE_APPROVER_TARGET ถ้ายังไม่ได้ตั้ง LINE_ADMIN_TARGET แยกไว้', async () => {
  const beforeAdmin = process.env.LINE_ADMIN_TARGET;
  const beforeApprover = process.env.LINE_APPROVER_TARGET;
  delete process.env.LINE_ADMIN_TARGET;
  process.env.LINE_APPROVER_TARGET = 'Ufallback-target';
  try {
    assert.deepEqual(await lineAdminTargets(), ['Ufallback-target'], 'ยังไม่ตั้งแยก ต้องยังแจ้งได้อยู่ ไม่ใช่เงียบไปเลย');
  } finally {
    if (beforeAdmin === undefined) delete process.env.LINE_ADMIN_TARGET; else process.env.LINE_ADMIN_TARGET = beforeAdmin;
    if (beforeApprover === undefined) delete process.env.LINE_APPROVER_TARGET; else process.env.LINE_APPROVER_TARGET = beforeApprover;
  }
});
