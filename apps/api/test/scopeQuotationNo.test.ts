/** ตัวกรอง PO บนแถบบนแสดงเลขใบเสนอราคา FlowAccount (QT…) แทนเลข PO เมื่อสัญญามาจากใบเสนอราคา (12 ต.ค. 69) */
import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@obs/db';
import { seedFixtures } from './helpers/testDb.js';
import { createCustomer } from '../src/lib/customersService.js';
import { createContract } from '../src/lib/contractsMasterService.js';
import { createEmployee } from '../src/lib/employeesMasterService.js';
import { contractQuotationNo, listFilterOptions } from '../src/lib/scopeService.js';

await seedFixtures();
test.after(async () => {
  await prisma.$disconnect();
});

test('contractQuotationNo: เลือกใบที่พบบ่อยสุด ตัดค่าว่าง · ไม่มี = null', () => {
  assert.equal(contractQuotationNo([{ quotationNo: 'QT-1' }, { quotationNo: 'QT-2' }, { quotationNo: 'QT-1' }, { quotationNo: null }, { quotationNo: ' ' }]), 'QT-1');
  assert.equal(contractQuotationNo([{ quotationNo: null }]), null);
  assert.equal(contractQuotationNo([]), null);
});

test('listFilterOptions ส่ง quotationNo ของสัญญา: มีเลข QT เมื่อพนักงานอ้างใบเสนอราคา · กรอกเอง = null', async () => {
  const customer = await createCustomer({ nameTh: 'บริษัท คิวที จำกัด', taxId: '0105577777771', actor: 'ทดสอบ' });
  const withQt = await createContract({ customerId: customer.id, poNo: 'PO-QT-1', projectName: 'โครงการมี QT', startDate: '2026-10-01', endDate: '2026-12-31', actor: 'ทดสอบ' });
  const manual = await createContract({ customerId: customer.id, poNo: 'PO-QT-2', projectName: 'โครงการกรอกเอง', startDate: '2026-10-01', endDate: '2026-12-31', actor: 'ทดสอบ' });
  await createEmployee({ contractId: withQt!.id, nameTh: 'พนักงาน คิวที', invoicePosition: 'Dev', monthlyRate: 1000, startDate: '2026-10-01', quotationNo: 'QT2026090099', actor: 'ทดสอบ' });
  const { contracts } = await listFilterOptions();
  assert.equal(contracts.find((c) => c.id === withQt!.id)!.quotationNo, 'QT2026090099');
  assert.equal(contracts.find((c) => c.id === manual!.id)!.quotationNo, null);
});
