/**
 * ทดสอบ deleteContract() — เดิมไม่มีเทสต์คลุมฟังก์ชันนี้เลยสักตัว (เจอบั๊กจริง 25 ก.ย. 69: ลบสัญญาที่มี
 * พนักงานเคยแจ้งปัญหา (support ticket) ไว้ → Postgres โยน foreign key error ดิบๆ ("Invalid
 * prisma.employee.delete() invocation...") หลุดไปให้ผู้ใช้เห็นตรงๆ ทั้งที่ผู้ใช้แค่ต้องการลบ "สัญญา"
 * ไม่เกี่ยวกับตั๋วแจ้งปัญหาของพนักงานเลย)
 *
 * ใช้ข้อมูลทดสอบของตัวเอง ไม่พึ่ง seedFixtures() ของ testDb.ts (มี timesheet/invoice ผูกไว้ซับซ้อน
 * อยู่แล้ว ควบคุมเงื่อนไขที่จะทดสอบตรงนี้ยากกว่าสร้างเองใหม่ทั้งชุด)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@obs/db';

import { resetDb } from './helpers/testDb.js';
import { deleteContract, ContractMasterError } from '../src/lib/contractsMasterService.js';

test.after(async () => {
  await prisma.$disconnect();
});

const NOW = new Date().toISOString();

async function makeCustomer(id: string) {
  return prisma.customer.create({
    data: { id, nameTh: `ลูกค้าทดสอบ ${id}`, taxId: '0000000000000', createdAt: NOW },
  });
}

async function makeContract(id: string, customerId: string) {
  return prisma.contract.create({
    data: {
      id, customerId, poNo: `PO-${id}`, projectName: 'โปรเจกต์ทดสอบ',
      startDate: '2026-01-01', endDate: '2026-12-31', createdAt: NOW,
    },
  });
}

async function makeEmployee(id: string) {
  return prisma.employee.create({
    data: { id, nameTh: `พนักงานทดสอบ ${id}`, invoicePosition: 'Tester', createdAt: NOW },
  });
}

async function makeAssignment(id: string, contractId: string, employeeId: string) {
  return prisma.assignment.create({
    data: { id, contractId, employeeId, monthlyRate: 30000, startDate: '2026-01-01', endDate: '2026-12-31' },
  });
}

test('ลบสัญญาที่พนักงานไม่มีประวัติอื่นผูกอยู่เลย → ลบพนักงานทิ้งไปด้วยตามเดิม', async () => {
  await resetDb();
  await makeCustomer('CUS-DEL1');
  await makeContract('CT-DEL1', 'CUS-DEL1');
  await makeEmployee('EMP-DEL1');
  await makeAssignment('ASG-DEL1', 'CT-DEL1', 'EMP-DEL1');

  const result = await deleteContract('CT-DEL1', { actor: 'ทดสอบ' });
  assert.equal(result.deleted, true);

  const employee = await prisma.employee.findUnique({ where: { id: 'EMP-DEL1' } });
  assert.equal(employee, null, 'พนักงานที่ไม่มีสัญญา/ประวัติอื่นเหลือแล้วต้องถูกลบทิ้งไปด้วย เหมือนพฤติกรรมเดิม');
});

test('ลบสัญญาที่พนักงานเคยแจ้งปัญหาไว้ (support ticket) → ลบสัญญาสำเร็จ ไม่ throw FK error ดิบ แต่เก็บพนักงานไว้', async () => {
  await resetDb();
  await makeCustomer('CUS-DEL2');
  await makeContract('CT-DEL2', 'CUS-DEL2');
  await makeEmployee('EMP-DEL2');
  await makeAssignment('ASG-DEL2', 'CT-DEL2', 'EMP-DEL2');
  await prisma.supportTicket.create({
    data: { employeeId: 'EMP-DEL2', category: 'bug', description: 'ทดสอบ', status: 'open', createdAt: NOW },
  });

  const result = await deleteContract('CT-DEL2', { actor: 'ทดสอบ' });
  assert.equal(result.deleted, true, 'ต้องลบสัญญาสำเร็จ — ตั๋วแจ้งปัญหาของพนักงานไม่ควรเกี่ยวกับการลบสัญญาเลย');

  const employee = await prisma.employee.findUnique({ where: { id: 'EMP-DEL2' } });
  assert.ok(employee, 'พนักงานที่มีตั๋วแจ้งปัญหาผูกอยู่ต้องไม่ถูกลบ (กันชน foreign key error ดิบๆ)');

  const contract = await prisma.contract.findUnique({ where: { id: 'CT-DEL2' } });
  assert.equal(contract, null);
});

test('ลบสัญญาที่เคยออกใบแจ้งหนี้แล้ว → ปฏิเสธด้วยข้อความปกติ (พฤติกรรมเดิม ไม่เปลี่ยน)', async () => {
  await resetDb();
  await makeCustomer('CUS-DEL3');
  await makeContract('CT-DEL3', 'CUS-DEL3');
  await prisma.invoice.create({
    data: {
      id: 'INV-DEL3', contractId: 'CT-DEL3', period: '2026-01', documentDate: '2026-02-01', dueDate: '2026-03-01',
      total: 0, discountTotal: 0, totalAfterDiscount: 0, vat: 0,
      grandTotal: 0, withholdingTax: 0, paymentAmount: 0, status: 'sent_to_flowaccount', createdAt: NOW,
    },
  });

  await assert.rejects(
    () => deleteContract('CT-DEL3', { actor: 'ทดสอบ' }),
    (error: unknown) => error instanceof ContractMasterError && /เคยออกใบแจ้งหนี้ไปแล้ว/.test(error.message),
  );
});
