/**
 * ประกอบใบแจ้งหนี้จากผล Manday ของพนักงานทุกคนในรอบบิล
 *
 * ลำดับการคำนวณยึดตาม INV2026020006:
 *   รวมเป็นเงิน            176,363.93
 *   หักส่วนลด               −2,647.20
 *   รวมหลังหักส่วนลด       173,716.73
 *   ภาษีมูลค่าเพิ่ม 7%       12,160.17   ← คิดจากยอดหลังหักส่วนลด
 *   รวมทั้งสิ้น             185,876.90
 *   หักภาษี ณ ที่จ่าย 3%     −5,211.50   ← คิดจากยอดหลังหักส่วนลด ไม่ใช่จากยอดรวมทั้งสิ้น
 *   ยอดรับชำระ             180,665.40
 */

import { round2, thaiDate, addDays } from '../util/money.js';

/* ผังบัญชีรายได้ค่าบริการ — ค่าที่ตัวอย่างใน Postman Collection ของ FlowAccount ใช้
   ต้องให้ฝ่ายบัญชียืนยันว่าตรงกับผังบัญชีจริงของ iPassion ก่อนยิงโหมด live */
const SERVICE_ACCOUNT_CODE = '41210';

export const DEFAULT_VAT_RATE = 0.07;
export const DEFAULT_WHT_RATE = 0.03;

/**
 * @param {object} input
 * @param {string} input.period                  'YYYY-MM'
 * @param {string} input.documentDate            ISO date ที่จะลงในเอกสาร
 * @param {number} input.creditDays
 * @param {object} input.customer                { name, taxId, branch }
 * @param {Array} input.entries                  ผลจาก calculateManday + ข้อมูลพนักงาน
 * @param {number} [input.vatRate]
 * @param {number} [input.whtRate]
 */
export function buildInvoice({
  period,
  documentDate,
  creditDays = 30,
  customer,
  entries,
  vatRate = DEFAULT_VAT_RATE,
  whtRate = DEFAULT_WHT_RATE,
}) {
  const periodStart = entries[0]?.manday.calendar.firstDate ?? `${period}-01`;
  const periodEnd = entries[0]?.manday.calendar.lastDate ?? `${period}-28`;
  const servicePeriod = `${thaiDate(periodStart)} ถึง ${thaiDate(periodEnd)}`;

  /* OT ขึ้นเป็นบรรทัดแยกต่างหาก (ไม่ยัดเข้าไปในรายการเดิมของพนักงานคนนั้น) — ปลอดภัยกว่าการเอา
     ไปหักลบกับ "discount" (ส่วนลดวันลา) เพราะ FlowAccount ไม่มีฟิลด์ "ยอดบวกเพิ่ม" ให้ตรงๆ ในระดับ
     รายการ ยัดใน discountAmount แบบติดลบเสี่ยงเกินไป (ไม่เคยทดสอบว่า FlowAccount รับค่าติดลบได้จริง
     ไหม) ขึ้นเป็นบรรทัดแยกก็ตรงไปตรงมากว่าด้วย — ลูกค้าเห็นชัดว่ามีค่า OT แยกจากค่าจ้างปกติ
     เกิดเฉพาะตอนพนักงานคนนั้นมี OT จริง (otTotal > 0) เท่านั้น ไม่งั้นไม่มีบรรทัดเพิ่ม */
  const items = [];
  for (const entry of entries) {
    items.push({
      seq: items.length + 1,
      /** ชื่อตำแหน่งบนใบแจ้งหนี้ต้องมาจากฐานข้อมูล ไม่ใช่จาก Timesheet */
      name: entry.employee.invoicePosition,
      description: `${entry.employee.nameTh} · ${servicePeriod}`,
      employeeId: entry.employee.id,
      employeeName: entry.employee.nameTh,
      quantity: 1,
      unitName: 'Months',
      pricePerUnit: round2(entry.manday.monthlyRate),
      discount: round2(entry.manday.discount),
      amount: round2(entry.manday.monthlyRate - entry.manday.discount),
      payableDays: entry.manday.payableDays,
      standardWorkingDays: entry.manday.standardWorkingDays,
      leaveCount: entry.manday.leaveCount,
      dailyRate: entry.manday.dailyRate,
      quotationNo: entry.employee.quotationNo,
    });

    const otTotal = round2(entry.manday.otTotal ?? 0);
    if (otTotal > 0) {
      items.push({
        seq: items.length + 1,
        name: `ค่าล่วงเวลา (OT) — ${entry.employee.invoicePosition}`,
        description: `${entry.employee.nameTh} · OT ${entry.manday.otDays.length} วัน · ${servicePeriod}`,
        employeeId: entry.employee.id,
        employeeName: entry.employee.nameTh,
        quantity: 1,
        unitName: 'Job',
        pricePerUnit: otTotal,
        discount: 0,
        amount: otTotal,
        isOvertimeLine: true,
        otDays: entry.manday.otDays,
        quotationNo: entry.employee.quotationNo,
      });
    }
  }

  const total = round2(items.reduce((sum, i) => sum + i.pricePerUnit, 0));
  const discountTotal = round2(items.reduce((sum, i) => sum + i.discount, 0));
  const otGrandTotal = round2(items.filter((i) => i.isOvertimeLine).reduce((sum, i) => sum + i.pricePerUnit, 0));
  const totalAfterDiscount = round2(total - discountTotal);
  const vat = round2(totalAfterDiscount * vatRate);
  const grandTotal = round2(totalAfterDiscount + vat);
  const withholdingTax = round2(totalAfterDiscount * whtRate);
  const paymentAmount = round2(grandTotal - withholdingTax);

  const remark = entries
    .flatMap((entry) => entry.manday.remarkLines)
    .join('\n');

  return {
    period,
    documentDate,
    dueDate: addDays(documentDate, creditDays),
    creditDays,
    customer,
    items,
    totals: {
      total,
      discountTotal,
      otGrandTotal,
      totalAfterDiscount,
      vatRate,
      vat,
      grandTotal,
      whtRate,
      withholdingTax,
      paymentAmount,
    },
    remark,
    servicePeriod,
  };
}

/**
 * แปลงใบแจ้งหนี้ของเราเป็น request body ของ FlowAccount
 *
 * ชื่อฟิลด์ทุกตัวยืนยันจาก Postman Collection ตัวจริงของ FlowAccount
 * (OpenAPI - Collection → Tax Invoices (INV) → Create-INV-Inline) เมื่อ 29 ก.ค. 2569
 * ไม่ใช่การเดาชื่อฟิลด์อีกแล้ว
 *
 * ต้องใช้ตัว "inline" เพราะโมเดลคิดเงินของเราหักส่วนลดวันลา **รายบรรทัด**
 * ตัว Simple (POST /tax-invoices) มีแต่ส่วนลดระดับเอกสาร ใช้กับงานนี้ไม่ได้
 * การเปิดส่วนลดรายบรรทัดต้องส่งครบสามตัว:
 *   documentStructureType: 'InlineDocument' · useInlineDiscount: true · discountType: 1
 *
 * **ไม่มีฟิลด์ status ในของจริง** — เอกสารที่สร้างจาก POST เป็นร่างอยู่แล้วโดยปริยาย
 * การอนุมัติเป็น endpoint แยก (POST /tax-invoices/{id}/status/awaiting) ซึ่งระบบนี้
 * ไม่มีโค้ดเรียกเลย นั่นคือที่มาของหลักประกัน "สร้างเป็นร่างเท่านั้น"
 *
 * เรื่อง contact ซ้ำ (ดูคอมเมนต์หัวไฟล์ flowaccount.js ข้อ 2) — ยิง sandbox จริงยืนยันแล้ว 13 ส.ค. 69
 * ว่าถ้าส่ง **contactId เปล่าๆ** (อ้างถึง contact ที่มีอยู่แล้ว) โดยไม่ส่ง contactName/contactTaxId/
 * contactBranch เลย FlowAccount จะผูกเอกสารกับ contact เดิมได้จริง ไม่สร้างซ้ำ (ก่อนหน้านี้ลองส่ง
 * contactCode ควบคู่กับชื่อ/เลขผู้เสียภาษีแล้วไม่ได้ผล เพราะ FlowAccount ยังอ่านเป็น "สร้างใหม่" อยู่ดี
 * ต่างจากการส่ง contactId เปล่าๆแบบนี้) จึงส่ง contactId เท่านั้นถ้ามีลูกค้ารายนี้ในระบบ FlowAccount
 * อยู่แล้ว (customers.flowaccount_contact_id) ถ้ายังไม่มีค่อยส่งข้อมูลเต็มแบบเดิมให้สร้างใหม่ครั้งแรก
 */
export function toFlowAccountPayload(invoice, { reference = null } = {}) {
  const { totals } = invoice;
  const contactFields = invoice.customer.flowAccountContactId
    ? { contactId: Number(invoice.customer.flowAccountContactId) }
    : {
        contactName: invoice.customer.name,
        contactTaxId: invoice.customer.taxId,
        contactBranch: invoice.customer.branch ?? 'สำนักงานใหญ่',
      };
  return {
    recordId: 0,
    ...contactFields,
    contactGroup: 1,                       // 1 = ลูกค้า
    publishedOn: invoice.documentDate,     // ของจริงชื่อ publishedOn ไม่ใช่ documentDate
    creditType: 1,                         // 1 = เครดิตเป็นจำนวนวัน
    creditDays: invoice.creditDays,
    dueDate: invoice.dueDate,
    reference,                             // ใบจริง INV2026020006 เว้นว่าง
    isVatInclusive: false,
    useReceiptDeduction: false,
    subTotal: totals.total,
    discountPercentage: 0,
    discountAmount: totals.discountTotal,
    totalAfterDiscount: totals.totalAfterDiscount,
    isVat: true,
    vatAmount: totals.vat,
    grandTotal: totals.grandTotal,
    documentShowWithholdingTax: true,
    documentWithholdingTaxPercentage: Math.round(totals.whtRate * 100),
    documentWithholdingTaxAmount: totals.withholdingTax,
    documentDeductionType: 0,
    documentDeductionAmount: 0,
    remarks: invoice.remark,
    showSignatureOrStamp: true,
    documentStructureType: 'InlineDocument',
    saleAndPurchaseChannel: 0,
    discountType: 1,
    useInlineDiscount: true,
    useInlineVat: false,
    exemptAmount: 0,
    vatableAmount: totals.totalAfterDiscount,
    items: invoice.items.map((item) => ({
      type: 1,                             // 1 = ค่าบริการ
      name: item.name,
      description: item.description,
      quantity: item.quantity,
      unitName: item.unitName,
      pricePerUnit: item.pricePerUnit,
      total: round2(item.pricePerUnit * item.quantity - item.discount),
      discountAmount: item.discount,
      vatRate: Math.round(totals.vatRate * 100),
      sellChartOfAccountCode: SERVICE_ACCOUNT_CODE,
    })),
  };
}
