/**
 * ปลายทางแจ้งเตือน LINE ของ error ระบบ ต้องแยกจากที่แจ้งฝ่ายบัญชี (24 ก.ย. 69 ตามที่ขอ "error แจ้งเตือน
 * มาให้ admin") — ดู lineAdminTargets() ใน notificationRecipientsService.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@obs/db';

import { seedFixtures } from './helpers/testDb.js';
import { lineAdminTargets, lineApproverTargets, notificationEmailTargets } from '../src/lib/notificationRecipientsService.js';

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

test('บัญชี admin/accounting ที่ผูกไลน์เองแล้ว (User.lineUserId) ต้องชนะ env var เสมอ', async () => {
  const beforeAdmin = process.env.LINE_ADMIN_TARGET;
  const beforeApprover = process.env.LINE_APPROVER_TARGET;
  process.env.LINE_ADMIN_TARGET = 'Uenv-admin';
  process.env.LINE_APPROVER_TARGET = 'Uenv-accounting';

  const now = new Date().toISOString();
  await prisma.user.create({
    data: {
      username: 'test-admin-linked', nameTh: 'แอดมินทดสอบ', role: 'admin', createdAt: now,
      passwordSalt: 'x', passwordHash: 'x', lineUserId: 'Ureal-admin',
    },
  });
  await prisma.user.create({
    data: {
      username: 'test-accounting-linked', nameTh: 'บัญชีทดสอบ', role: 'accounting', createdAt: now,
      passwordSalt: 'x', passwordHash: 'x', lineUserId: 'Ureal-accounting',
    },
  });
  try {
    assert.deepEqual(await lineAdminTargets(), ['Ureal-admin'], 'ผูกไลน์เองแล้ว ต้องใช้อันนี้ ไม่ใช่ env var');
    assert.deepEqual(await lineApproverTargets(), ['Ureal-accounting'], 'ผูกไลน์เองแล้ว ต้องใช้อันนี้ ไม่ใช่ env var');
  } finally {
    await prisma.user.deleteMany({ where: { username: { in: ['test-admin-linked', 'test-accounting-linked'] } } });
    if (beforeAdmin === undefined) delete process.env.LINE_ADMIN_TARGET; else process.env.LINE_ADMIN_TARGET = beforeAdmin;
    if (beforeApprover === undefined) delete process.env.LINE_APPROVER_TARGET; else process.env.LINE_APPROVER_TARGET = beforeApprover;
  }
});

test('notificationEmailTargets อ่านอีเมลปลายทางจาก env NOTIFICATION_EMAIL_TARGETS (หลังเอาหน้าผู้รับแจ้งเตือนออก)', async () => {
  const before = process.env.NOTIFICATION_EMAIL_TARGETS;
  try {
    process.env.NOTIFICATION_EMAIL_TARGETS = ' billing@example.com , ไม่ใช่อีเมล, ops@example.com,billing@example.com ';
    const targets = await notificationEmailTargets();
    assert.ok(targets.includes('billing@example.com'));
    assert.ok(targets.includes('ops@example.com'));
    assert.ok(!targets.includes('ไม่ใช่อีเมล'), 'ข้อความที่ไม่ใช่อีเมลต้องถูกข้าม');
    assert.equal(targets.filter((t) => t === 'billing@example.com').length, 1, 'ซ้ำต้องเหลืออันเดียว');
  } finally {
    if (before === undefined) delete process.env.NOTIFICATION_EMAIL_TARGETS;
    else process.env.NOTIFICATION_EMAIL_TARGETS = before;
  }
});
