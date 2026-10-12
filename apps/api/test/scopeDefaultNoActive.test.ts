/**
 * ไม่ได้เลือก PO + ไม่มีสัญญาไหนเปิดอยู่ (12 ต.ค. 69): แถบบนแสดง "ทุก PO" ข้อมูลฝั่งเซิร์ฟเวอร์ต้องตรงกัน ไม่ใช่ว่างเปล่า
 * (เดิมคืนรายการว่าง ทำให้หน้าข้อมูลหลักไม่เห็นสัญญาใดเลยทั้งที่มีสัญญาอยู่ในระบบ)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@obs/db';
import { seedFixtures } from './helpers/testDb.js';
import { requestScope } from '../src/lib/scopeService.js';

await seedFixtures();
test.after(async () => {
  await prisma.$disconnect();
});

const req = (role: string, cookie?: unknown) => ({ query: {}, cookies: cookie ? { obs_scope: JSON.stringify(cookie) } : {}, user: { role } }) as any;

test('ไม่มีสัญญาที่เปิดอยู่: admin/บัญชี/ผู้บริหารเห็นทุกสัญญา · role อื่นยังว่าง', async () => {
  await prisma.contract.updateMany({ data: { status: 'inactive' } });
  for (const role of ['admin', 'accounting', 'executive']) {
    assert.equal((await requestScope(req(role))).contractIds, null, role);
  }
  assert.deepEqual((await requestScope(req('user'))).contractIds, []);
});

test('มีสัญญาที่เปิดอยู่: ยังใช้สัญญานั้นเป็นค่าเริ่มต้นเหมือนเดิม · เลือก "ทุก PO" เองยังได้ทั้งหมด', async () => {
  const first = await prisma.contract.findFirstOrThrow();
  await prisma.contract.updateMany({ data: { status: 'inactive' } });
  await prisma.contract.update({ where: { id: first.id }, data: { status: 'active' } });
  assert.deepEqual((await requestScope(req('accounting'))).contractIds, [first.id]);
  assert.equal((await requestScope(req('accounting', { all: true }))).contractIds, null);
});
