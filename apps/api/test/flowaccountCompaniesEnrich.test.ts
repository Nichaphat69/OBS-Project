/** รายการใบเสนอราคาที่ใช้เติมฟอร์ม "เพิ่มบริษัทใหม่": ต้องบอกได้ว่าบริษัทมีอยู่แล้วไหม และใบเสนอราคาใบนั้นนำเข้าแล้วหรือยัง (12 ต.ค. 69) */
import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@obs/db';
import { seedFixtures } from './helpers/testDb.js';
import { createCustomer } from '../src/lib/customersService.js';
import { createContract, enrichFlowAccountCompanies, mapQuotationToCompany } from '../src/lib/contractsMasterService.js';

await seedFixtures();
test.after(async () => {
  await prisma.$disconnect();
});

const quotation = (over: Record<string, unknown>) =>
  mapQuotationToCompany({ contactId: 900, contactName: 'บริษัท เดียวกัน จำกัด', contactTaxId: '0105599999991', contactBranch: 'สำนักงานใหญ่', publishedOn: '2026-10-01', items: [], ...over });

test('บริษัทเดียวกัน หลายใบเสนอราคา: ทุกใบรู้ว่าบริษัทมีอยู่แล้ว และใบที่มี PO ตรงกับสัญญาที่นำเข้าแล้วถูกทำเครื่องหมาย', async () => {
  const customer = await createCustomer({ nameTh: 'บริษัท เดียวกัน จำกัด', taxId: '0105599999991', flowaccountContactId: '900', actor: 'ทดสอบ' });
  await createContract({
    customerId: customer.id, poNo: 'PO202601', projectName: 'โครงการ A', startDate: '2026-01-01', endDate: '2026-12-31', actor: 'ทดสอบ',
  });
  const result = await enrichFlowAccountCompanies([
    quotation({ documentSerial: 'QT-A', reference: 'PO202601' }),
    quotation({ documentSerial: 'QT-B', reference: 'PO202602' }),
  ]);
  assert.equal(result.length, 2, 'ต้องได้ทุกใบ ไม่ยุบเหลือใบเดียวต่อบริษัท');
  assert.ok(result.every((r) => r.existingCustomerId === customer.id));
  assert.equal(result.find((r) => r.quotationNo === 'QT-A')!.alreadyImported, true);
  assert.equal(result.find((r) => r.quotationNo === 'QT-B')!.alreadyImported, false);
});

test('บริษัทที่ยังไม่มีในระบบ: existingCustomerId เป็น null', async () => {
  const [r] = await enrichFlowAccountCompanies([quotation({ contactId: 901, contactName: 'บริษัท ใหม่ จำกัด', contactTaxId: '0105588888881', documentSerial: 'QT-C' })]);
  assert.equal(r.existingCustomerId, null);
  assert.equal(r.alreadyImported, false);
});
