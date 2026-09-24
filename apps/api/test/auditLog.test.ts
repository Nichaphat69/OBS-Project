/**
 * ทดสอบการแบ่งหน้า (pagination) ของ auditLog() — เดิมดึงทีเดียว 200 แถวสุดท้ายแล้วจบ ไม่มีทางดูแถวเก่า
 * กว่านั้นได้เลย (เจ้าของระบบสั่ง 24 ก.ย. 69 "ตาราง activity ต้องทำ lazy loading เพื่อ performance")
 * เปลี่ยนเป็นแบ่งหน้าจริงแบบเดียวกับ apiActivityLogService.ts's listApiActivity()
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@obs/db';

import { resetDb } from './helpers/testDb.js';
import { auditLog } from '../src/lib/auditLogService.js';

test.before(resetDb);
test.after(async () => {
  await prisma.$disconnect();
});

test('auditLog() แบ่งหน้าได้จริง — หน้าถัดไปเห็นแถวที่เก่ากว่า ไม่ใช่แถวซ้ำ', async () => {
  await resetDb();
  // แทรก 5 แถว — id จะไล่ 1..5 ตามลำดับที่แทรก (ล่าสุด = id สูงสุด)
  for (let i = 1; i <= 5; i += 1) {
    await prisma.auditLog.create({ data: { at: `2026-02-0${i}T00:00:00.000Z`, actor: 'system', action: `test_action_${i}` } });
  }

  const page1 = await auditLog({ page: 1, pageSize: 2 });
  assert.equal(page1.total, 5);
  assert.deepEqual(page1.rows.map((r) => r.action), ['test_action_5', 'test_action_4'], 'ล่าสุดขึ้นบนก่อน');

  const page2 = await auditLog({ page: 2, pageSize: 2 });
  assert.equal(page2.total, 5);
  assert.deepEqual(page2.rows.map((r) => r.action), ['test_action_3', 'test_action_2'], 'หน้าถัดไปต้องเป็นแถวถัดไป ไม่ใช่แถวซ้ำหน้าแรก');

  const page3 = await auditLog({ page: 3, pageSize: 2 });
  assert.equal(page3.rows.length, 1, 'หน้าสุดท้ายเหลือแถวเดียว');
  assert.equal(page3.rows[0].action, 'test_action_1');
});

test('auditLog() ไม่ใส่ pageSize มา ใช้ค่าเริ่มต้นและไม่พังถ้าไม่มีข้อมูล', async () => {
  await resetDb();
  const result = await auditLog();
  assert.deepEqual(result, { rows: [], total: 0 });
});
