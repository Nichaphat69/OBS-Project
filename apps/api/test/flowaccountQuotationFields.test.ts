/**
 * ฟิลด์ใบเสนอราคา FlowAccount ที่ดึงมาเพิ่ม (5 ต.ค. 69) — รูปร่างข้อมูลด้านล่างอิงจากใบเสนอราคาจริง 20 ใบที่ตรวจเมื่อ 5 ต.ค. 69
 * (ชื่อฟิลด์ตรงกับ API จริง ค่าเป็นข้อมูลสมมติ)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@obs/db';
import { seedFixtures } from './helpers/testDb.js';
import { mapQuotationToCompany, createContract } from '../src/lib/contractsMasterService.js';
import { createCustomer } from '../src/lib/customersService.js';
import { listContracts } from '../src/lib/dashboardService.js';

await seedFixtures();

test.after(async () => {
  await prisma.$disconnect();
});

const quotation = {
  contactId: 987,
  contactName: 'บริษัท ตัวอย่าง จำกัด',
  contactTaxId: '0105500000099',
  contactBranch: 'สำนักงานใหญ่',
  contactAddress: '1 ถนนตัวอย่าง กรุงเทพ',
  contactZipCode: '10110',
  contactPerson: 'คุณตัวอย่าง',
  contactNumber: '0812345678',
  contactEmail: 'a@example.com',
  documentSerial: 'QT2026100001',
  projectName: 'โครงการตัวอย่าง',
  reference: 'AB-1234-5678',
  creditDays: '0',
  publishedOn: '2026-10-05T00:00:00',
  documentWithholdingTaxPercentage: '3',
  isVatInclusive: false,
  remarks: 'หมายเหตุทดสอบ',
  internalNotes: '',
  salesName: 'Abhisak',
  subTotal: '110000',
  discountAmount: '0',
  grandTotal: '117700',
  items: [
    { name: 'Developer', description: 'นายตัวอย่าง หนึ่ง', pricePerUnit: '55000', quantity: '2', unitName: 'Manday', discountAmount: '0', vatRate: '7' },
    { name: 'Tester', description: '  ', pricePerUnit: '1000', quantity: '1', unitName: 'เดือน', discountAmount: '0', vatRate: '7' },
  ],
};

test('แปลงใบเสนอราคา FlowAccount → ได้ทุกฟิลด์ที่ต้องการ (รวมเครดิต 0 ที่ต้องไม่หาย)', () => {
  const c = mapQuotationToCompany(quotation);
  assert.equal(c.zipCode, '10110');
  assert.equal(c.reference, 'AB-1234-5678');
  assert.equal(c.creditDays, 0, 'เครดิต 0 วันต้องยังเป็น 0 ไม่ใช่ null/30');
  assert.equal(c.quotationDate, '2026-10-05');
  assert.equal(c.withholdingPercent, 3);
  assert.equal(c.vatPercent, 7);
  assert.equal(c.isVatInclusive, false);
  assert.equal(c.remarks, 'หมายเหตุทดสอบ');
  assert.equal(c.internalNotes, null, 'ข้อความว่าง → null');
  assert.equal(c.salesName, 'Abhisak');
  assert.equal(c.subTotal, 110000);
  assert.equal(c.grandTotal, 117700);
  // บรรทัดที่ไม่มีชื่อ (description ว่าง) ไม่ใช่พนักงาน — ถูกตัดทิ้งเหมือนเดิม
  assert.equal(c.employees.length, 1);
  assert.deepEqual(
    { q: c.employees[0].quantity, u: c.employees[0].unitName, r: c.employees[0].monthlyRate },
    { q: 2, u: 'Manday', r: 55000 },
  );
});

test('ราคารวมภาษี (isVatInclusive) อ่านเป็น true ได้ทั้ง boolean และข้อความ', () => {
  assert.equal(mapQuotationToCompany({ ...quotation, isVatInclusive: true }).isVatInclusive, true);
  assert.equal(mapQuotationToCompany({ ...quotation, isVatInclusive: 'true' }).isVatInclusive, true);
});

test('ใบที่ไม่มีค่า reference/ฟิลด์ใหม่ → null ทั้งหมด ไม่พัง', () => {
  const c = mapQuotationToCompany({ contactId: 1, contactName: 'x', items: [] });
  assert.equal(c.reference, null);
  assert.equal(c.creditDays, null);
  assert.equal(c.quotationDate, null);
  assert.equal(c.zipCode, null);
  assert.equal(c.employees.length, 0);
});

test('สร้างบริษัท+สัญญาด้วยฟิลด์ใหม่ → เก็บครบ และเครดิต 0 ไม่ถูกเปลี่ยนเป็น 30', async () => {
  const customer = await createCustomer({
    nameTh: 'บริษัท ทดสอบฟิลด์ใหม่ จำกัด',
    taxId: '0105500000077',
    zipCode: '10400',
    creditDays: 0,
    actor: 'ทดสอบ',
  });
  assert.equal(customer.zipCode, '10400');
  assert.equal(customer.creditDays, 0);

  const created = await createContract({
    customerId: customer.id,
    poNo: 'PO-FA-001',
    projectName: 'โครงการทดสอบ',
    startDate: '2026-10-01',
    endDate: '2026-12-31',
    creditDays: 0,
    faReference: 'AB-1234-5678',
    quotationDate: '2026-10-05',
    priceIncludesVat: true,
    salesName: 'Abhisak',
    remarks: 'หมายเหตุ',
    quotationSubTotal: 110000,
    quotationDiscount: 0,
    quotationGrandTotal: 117700,
    actor: 'ทดสอบ',
  });
  assert.ok(created);
  assert.equal(created!.creditDays, 0);

  const row = (await listContracts()).find((c) => c.id === created!.id)!;
  assert.equal(row.faReference, 'AB-1234-5678');
  assert.equal(row.quotationDate, '2026-10-05');
  assert.equal(row.priceIncludesVat, true);
  assert.equal(row.salesName, 'Abhisak');
  assert.equal(row.quotationGrandTotal, 117700);
  assert.equal(row.zipCode, '10400');
});
