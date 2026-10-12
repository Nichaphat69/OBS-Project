/**
 * เพิ่มพนักงานในสัญญา (เจ้าของระบบสั่ง 12 ต.ค. 69): สัญญาที่ "กรอกเองในระบบ" (ลูกค้าไม่ผูก FlowAccount) เพิ่มพนักงานได้
 * ส่วนสัญญาที่ดึงจาก FlowAccount ยังเพิ่มเองไม่ได้เหมือนเดิม — และหน้าเว็บตัดสินใจแสดงปุ่มจากธง flowaccountLinked ของตัวกรอง PO
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@obs/db';
import { seedFixtures } from './helpers/testDb.js';
import { createCustomer } from '../src/lib/customersService.js';
import { createContract } from '../src/lib/contractsMasterService.js';
import { createEmployee } from '../src/lib/employeesMasterService.js';
import { listFilterOptions } from '../src/lib/scopeService.js';

await seedFixtures();
test.after(async () => {
  await prisma.$disconnect();
});

async function makeContract(suffix: string, flowaccountContactId?: string) {
  const customer = await createCustomer({
    nameTh: `บริษัท เพิ่มพนักงาน ${suffix} จำกัด`,
    taxId: `01056${suffix.padStart(8, '0')}`,
    flowaccountContactId,
    actor: 'ทดสอบ',
  });
  const contract = await createContract({
    customerId: customer.id,
    poNo: `PO-EMP-${suffix}`,
    projectName: 'โครงการทดสอบ',
    startDate: '2026-10-01',
    endDate: '2026-12-31',
    actor: 'ทดสอบ',
  });
  return contract!;
}

const emp = (contractId: string, nameTh: string) => ({
  contractId,
  nameTh,
  invoicePosition: 'Developer',
  monthlyRate: 50000,
  startDate: '2026-10-01',
  actor: 'ทดสอบ',
});

test('สัญญาที่กรอกเองในระบบ: เพิ่มพนักงานได้', async () => {
  const c = await makeContract('1');
  const created = await createEmployee(emp(c.id, 'พนักงาน กรอกเอง'));
  assert.ok(created);
  const assignments = await prisma.assignment.count({ where: { contractId: c.id } });
  assert.equal(assignments, 1);
});

test('สัญญาที่ดึงจาก FlowAccount: เพิ่มพนักงานเองยังถูกปฏิเสธ (409) และไม่มีอะไรเขียนลงฐานข้อมูล', async () => {
  const c = await makeContract('2', 'FA-EMP-2');
  await assert.rejects(
    () => createEmployee(emp(c.id, 'พนักงาน ที่ต้องถูกปฏิเสธ')),
    (e: any) => e.status === 409 && /FlowAccount/.test(e.message),
  );
  assert.equal(await prisma.assignment.count({ where: { contractId: c.id } }), 0);
  assert.equal(await prisma.employee.count({ where: { nameTh: 'พนักงาน ที่ต้องถูกปฏิเสธ' } }), 0);
});

test('ตัวกรอง PO ส่งธง flowaccountLinked ให้หน้าเว็บตัดสินใจแสดงปุ่ม', async () => {
  const manual = await makeContract('3');
  const linked = await makeContract('4', 'FA-EMP-4');
  const { contracts } = await listFilterOptions();
  assert.equal(contracts.find((x) => x.id === manual.id)!.flowaccountLinked, false);
  assert.equal(contracts.find((x) => x.id === linked.id)!.flowaccountLinked, true);
});
