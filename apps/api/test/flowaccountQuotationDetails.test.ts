/** ใบเสนอราคา FlowAccount → ข้อมูลเติมฟอร์ม: ต้องส่งฟิลด์ระดับเอกสารที่เหลือและ "ทุกรายการ" ออกไปให้หน้าเว็บแสดงครบ (12 ต.ค. 69) */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mapQuotationToCompany } from '../src/lib/contractsMasterService.js';

const quotation = {
  contactId: 7, contactName: 'บริษัท ตัวอย่าง จำกัด', contactTaxId: '0105500000000', documentSerial: 'QT2026100003',
  statusString: 'อนุมัติ', contactCode: 'C001', contactGroup: '1', creditType: '1', creditDays: '30', dueDate: '2026-11-04',
  saleAndPurchaseChannel: 'Online', externalDocumentId: 'EXT-9', isVat: '1',
  discountType: 'percent', discountPercentage: '5', discountAmount: '1000.00', totalAfterDiscount: '19000.00', totalWithoutVat: '19000.00',
  exemptAmount: '0.00', vatableAmount: '19000.00', vatAmount: '1330.00', grandTotal: '20330.00', subTotal: '20000.00',
  documentShowWithholdingTax: '0', documentWithholdingTaxAmount: null, documentDeductionType: '1', documentDeductionAmount: '0.00',
  items: [
    { name: 'Developer', description: 'สมชาย ใจดี', quantity: '1', unitName: 'คน', pricePerUnit: '50000.00', total: '50000.00', discountAmount: '0.00', vatRate: '7', withHeldPerItem: 'None', withHeldPerItemValue: '0' },
    { name: 'ค่าบริการอื่น', description: '', quantity: '2', unitName: 'ครั้ง', pricePerUnit: '0', total: '0.00', discountAmount: '0', vatRate: '7' },
  ],
};

test('ส่งฟิลด์ระดับเอกสารที่เหลือครบ และไม่มีค่าเสียรูป', () => {
  const c = mapQuotationToCompany(quotation);
  assert.equal(c.quotationNo, 'QT2026100003');
  assert.equal(c.quotationExtra.status, 'อนุมัติ');
  assert.equal(c.quotationExtra.contactCode, 'C001');
  assert.equal(c.quotationExtra.dueDate, '2026-11-04');
  assert.equal(c.quotationExtra.vatAmount, '1330.00');
  assert.equal(c.quotationExtra.totalAfterDiscount, '19000.00');
  assert.equal(c.quotationExtra.withholdingAmount, null, 'null จาก FlowAccount ต้องเป็น null ไม่ใช่ข้อความ "null"');
});

test('quotationItems มีทุกบรรทัดตามลำดับ (รวมบรรทัดที่ไม่ใช่คน) ขณะที่ employees ยังกรองเฉพาะบรรทัดที่เป็นคนเหมือนเดิม', () => {
  const c = mapQuotationToCompany(quotation);
  assert.equal(c.quotationItems.length, 2);
  assert.equal(c.quotationItems[0].name, 'Developer');
  assert.equal(c.quotationItems[0].pricePerUnit, '50000.00');
  assert.equal(c.quotationItems[1].name, 'ค่าบริการอื่น');
  assert.equal(c.quotationItems[1].description, null);
  assert.equal(c.employees.length, 1, 'employees ต้องไม่เปลี่ยน — กรองบรรทัดที่ไม่มีชื่อ/ราคา 0 เหมือนเดิม');
});

test('ใบเสนอราคาไม่มี items → รายการว่าง ไม่พัง', () => {
  const c = mapQuotationToCompany({ contactId: 1, contactName: 'x' });
  assert.deepEqual(c.quotationItems, []);
  assert.equal(c.quotationExtra.status, null);
});
