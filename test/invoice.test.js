/**
 * ทดสอบกับเอกสารจริงของรอบบิล มกราคม 2026
 *   ใบว่าจ้าง   26/B0113
 *   ใบเสนอราคา  QT2025120005 (Developer), QT2025110015 (Senior PM)
 *   Timesheet   Timesheet-Pongpun_012026.pdf
 *   ใบแจ้งหนี้   INV2026020006
 *
 * ทุกตัวเลขในไฟล์นี้คัดลอกมาจากเอกสาร ไม่ใช่ค่าที่คำนวณเอง
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildMonth } from '../src/domain/calendar.js';
import { calculateManday, DIVISOR_MODE, SEVERITY } from '../src/domain/manday.js';
import { buildInvoice, toFlowAccountPayload } from '../src/domain/invoice.js';
import { matchEmployee, checkPosition, MATCH } from '../src/domain/matching.js';
import { round2, thaiDateShort, thaiDate } from '../src/util/money.js';

const HOLIDAYS_JAN_2026 = new Map([
  ['2026-01-01', 'วันขึ้นปีใหม่'],
  ['2026-01-02', 'วันหยุดพิเศษ'],
]);

const DEV = {
  id: 'EMP-0042',
  nameTh: 'พงศ์พันธ์ มามาก',
  nameEn: 'Pongpun Mamak',
  aliases: ['Pongpun Mamark', 'พงษ์พันธ์ มามาก'],
  invoicePosition: 'Developer',
  positionAliases: ['Dev', 'Java Programmer'],
  monthlyRate: 52943.93,
  quotationNo: 'QT2025120005',
};

const PM = {
  id: 'EMP-0018',
  nameTh: 'สุนีย์ มณีเกษมสุข',
  nameEn: 'Sunee Maneekasemsuk',
  aliases: ['Sunee Maneekasemsook'],
  invoicePosition: 'Senior Project Manager',
  positionAliases: ['PM', 'Senior PM'],
  monthlyRate: 123420.0,
  quotationNo: 'QT2025110015',
};

test('ปฏิทิน มกราคม 2026 ให้วันทำงาน 20 วัน ตรงกับ Timesheet', () => {
  const month = buildMonth('2026-01', HOLIDAYS_JAN_2026, new Set(['2026-01-29']));

  assert.equal(month.days.length, 31);
  assert.equal(month.counts.weekend, 9, 'เสาร์ 3,10,17,24,31 + อาทิตย์ 4,11,18,25');
  assert.equal(month.counts.holiday, 2, '1–2 ม.ค.');
  assert.equal(month.counts.leave, 1, 'ลาป่วย 29 ม.ค.');
  assert.equal(month.counts.workday, 19, 'Total Work days ในไฟล์ Timesheet');
  assert.equal(month.standardWorkingDays, 20, 'ตัวหารที่ใบแจ้งหนี้ใช้');
  assert.equal(
    month.counts.weekend + month.counts.holiday + month.counts.leave + month.counts.workday,
    31,
  );
});

test('Manday ของ Developer ตรงกับใบแจ้งหนี้ INV2026020006', () => {
  const result = calculateManday({
    period: '2026-01',
    monthlyRate: DEV.monthlyRate,
    reportedWorkDays: 19,
    leaveDays: [{ date: '2026-01-29', type: 'sick' }],
    holidays: HOLIDAYS_JAN_2026,
    divisor: { mode: DIVISOR_MODE.FIXED, value: 20 },
  });

  assert.equal(result.standardWorkingDays, 20);
  assert.equal(result.payableDays, 19);
  assert.equal(result.dailyRate, 2647.2, '52,943.93 ÷ 20 = 2,647.1965 → 2,647.20');
  assert.equal(result.discount, 2647.2, 'ช่อง Discount ของรายการที่ 2');
  assert.equal(result.lineAmount, 50296.73, 'ช่อง Amount ของรายการที่ 2');
  assert.ok(result.ok, 'ไม่ควรมีข้อผิดพลาดระดับ fail');
});

test('OT — เงินเดือน 100,000 หาร 20 วัน ทำ OT 2 ชม. วันที่ 13/06/2569 ตามตัวอย่างที่ขอ (25 ส.ค. 69)', () => {
  const result = calculateManday({
    period: '2026-06',
    monthlyRate: 100000,
    reportedWorkDays: 20,
    leaveDays: [],
    otDays: [{ date: '2026-06-13', hours: 2 }],
    divisor: { mode: DIVISOR_MODE.FIXED, value: 20 },
  });

  assert.equal(result.dailyRate, 5000, '100,000 ÷ 20 = 5,000');
  assert.equal(result.otDays.length, 1);
  assert.equal(result.otDays[0].date, '2026-06-13');
  assert.equal(result.otDays[0].hours, 2);
  assert.equal(result.otDays[0].otAmount, 1250, '(2 ÷ 8) × 5,000 = 1,250');
  assert.equal(result.otDays[0].dayAmount, 6250, 'ค่าจ้างวันนั้นรวม OT = 5,000 + 1,250');
  assert.equal(result.otTotal, 1250);
  assert.equal(result.lineAmount, 101250, '100,000 - ส่วนลด 0 + OT 1,250');
});

test('OT หลายวันรวมกันถูกต้อง และไม่กระทบส่วนลดวันลาที่มีอยู่', () => {
  const result = calculateManday({
    period: '2026-06',
    monthlyRate: 100000,
    reportedWorkDays: 18,
    leaveDays: [{ date: '2026-06-01', type: 'sick' }],
    otDays: [{ date: '2026-06-13', hours: 2 }, { date: '2026-06-20', hours: 4 }],
    divisor: { mode: DIVISOR_MODE.FIXED, value: 20 },
  });

  assert.equal(result.discount, 5000, 'ส่วนลดวันลา 1 วัน ไม่เปลี่ยนเพราะมี OT');
  assert.equal(result.otTotal, 1250 + 2500, '(2/8)×5000 + (4/8)×5000');
  assert.equal(result.lineAmount, 100000 - 5000 + 3750);
});

test('Manday ของ Senior PM — ไม่มีวันลา ไม่มีส่วนลด', () => {
  const result = calculateManday({
    period: '2026-01',
    monthlyRate: PM.monthlyRate,
    reportedWorkDays: 20,
    leaveDays: [],
    holidays: HOLIDAYS_JAN_2026,
  });

  assert.equal(result.payableDays, 20);
  assert.equal(result.discount, 0);
  assert.equal(result.lineAmount, 123420.0, 'ช่อง Amount ของรายการที่ 1');
  assert.deepEqual(result.remarkLines, [], 'ไม่มีวันลา จึงไม่มีบรรทัดหมายเหตุ');
});

test('ยอดรวมทั้งใบตรงกับ INV2026020006 ทุกบรรทัด', () => {
  const entries = [PM, DEV].map((employee) => ({
    employee,
    manday: calculateManday({
      period: '2026-01',
      monthlyRate: employee.monthlyRate,
      reportedWorkDays: employee === DEV ? 19 : 20,
      leaveDays: employee === DEV ? [{ date: '2026-01-29', type: 'sick' }] : [],
      holidays: HOLIDAYS_JAN_2026,
    }),
  }));

  const invoice = buildInvoice({
    period: '2026-01',
    documentDate: '2026-02-02',
    creditDays: 30,
    customer: {
      name: 'บริษัท ไทยประกันชีวิต จำกัด (มหาชน)',
      taxId: '0107555000104',
      branch: 'สำนักงานใหญ่',
    },
    entries,
  });

  const t = invoice.totals;
  assert.equal(t.total, 176363.93, 'Total');
  assert.equal(t.discountTotal, 2647.2, 'Discount');
  assert.equal(t.totalAfterDiscount, 173716.73, 'Total after Discount');
  assert.equal(t.vat, 12160.17, 'VAT 7%');
  assert.equal(t.grandTotal, 185876.9, 'Grand Total');
  assert.equal(t.withholdingTax, 5211.5, 'Withholding Tax 3%');
  assert.equal(t.paymentAmount, 180665.4, 'Payment Amount');

  assert.equal(invoice.dueDate, '2026-03-04', 'เครดิต 30 วันจาก 2 ก.พ. 2026');

  // ลำดับรายการตามใบจริง: Senior PM ก่อน Developer
  assert.equal(invoice.items[0].name, 'Senior Project Manager');
  assert.equal(invoice.items[1].name, 'Developer');
  assert.equal(invoice.items[1].discount, 2647.2);
});

test('OT ขึ้นเป็นบรรทัดแยกในใบแจ้งหนี้ ไม่ปนกับรายการปกติของพนักงานคนนั้น (25 ส.ค. 69)', () => {
  const entries = [PM, DEV].map((employee) => ({
    employee,
    manday: calculateManday({
      period: '2026-01',
      monthlyRate: employee.monthlyRate,
      reportedWorkDays: employee === DEV ? 19 : 20,
      leaveDays: employee === DEV ? [{ date: '2026-01-29', type: 'sick' }] : [],
      otDays: employee === DEV ? [{ date: '2026-01-15', hours: 2 }] : [],
      holidays: HOLIDAYS_JAN_2026,
    }),
  }));

  const invoice = buildInvoice({
    period: '2026-01',
    documentDate: '2026-02-02',
    creditDays: 30,
    customer: { name: 'บริษัท ไทยประกันชีวิต จำกัด (มหาชน)', taxId: '0107555000104', branch: 'สำนักงานใหญ่' },
    entries,
  });

  // PM ไม่มี OT: 1 บรรทัดตามเดิม. Developer มี OT: 2 บรรทัด (ปกติ + OT แยก) รวม 3 บรรทัดทั้งใบ
  assert.equal(invoice.items.length, 3);
  assert.equal(invoice.items[0].name, 'Senior Project Manager');
  assert.equal(invoice.items[1].name, 'Developer');
  assert.equal(invoice.items[1].discount, 2647.2, 'บรรทัดปกติของ Developer ยังหักส่วนลดวันลาเหมือนเดิม ไม่ปนกับ OT');
  assert.ok(!invoice.items[1].isOvertimeLine);

  const otItem = invoice.items[2];
  assert.ok(otItem.isOvertimeLine);
  assert.equal(otItem.employeeId, DEV.id);
  assert.equal(otItem.pricePerUnit, round2((2 / 8) * (DEV.monthlyRate / 20)), '(2/8) × เรทต่อวันของ Developer');
  assert.equal(otItem.discount, 0);
  assert.equal(otItem.amount, otItem.pricePerUnit);

  const t = invoice.totals;
  assert.equal(t.otGrandTotal, otItem.pricePerUnit);
  assert.equal(
    t.totalAfterDiscount,
    round2(t.total - t.discountTotal),
    'totalAfterDiscount ต้องรวม OT ด้วย เพราะ OT อยู่ใน total ผ่านการเป็นบรรทัดของตัวเอง',
  );
});

test('ภาษีหัก ณ ที่จ่ายคิดจากยอดหลังหักส่วนลด ไม่ใช่จากยอดรวมทั้งสิ้น', () => {
  const afterDiscount = 173716.73;
  const grandTotal = 185876.9;

  assert.equal(round2(afterDiscount * 0.03), 5211.5, 'ค่าที่ใบจริงพิมพ์ไว้');
  assert.notEqual(
    round2(grandTotal * 0.03),
    5211.5,
    'ถ้าคิดจากยอดรวมทั้งสิ้นจะได้ 5,576.31 ซึ่งผิด',
  );
});

test('หมายเหตุที่ระบบสร้างใช้ปี พ.ศ. ถูกต้อง — ใบจริงพิมพ์ 68 แทน 69', () => {
  const result = calculateManday({
    period: '2026-01',
    monthlyRate: DEV.monthlyRate,
    reportedWorkDays: 19,
    leaveDays: [{ date: '2026-01-29', type: 'sick' }],
    holidays: HOLIDAYS_JAN_2026,
  });

  assert.deepEqual(result.remarkLines, [
    '2,647.20 บาทต่อวัน',
    'ส่วนลดเนื่องจากพนักงานลา',
    'วันที่ 29 ม.ค. 69 = 1 วัน',
    'รวม = 1 วัน',
  ]);
  assert.equal(thaiDateShort('2026-01-29'), '29 ม.ค. 69');
  assert.equal(thaiDate('2026-01-31'), '31 มกราคม 2569');
});

test('ทักวันทำงานที่ไม่ตรงกับปฏิทินแบบ WARN — ไม่บล็อกการยืนยันอีกต่อไป (พนักงานอาจทำงานเสาร์-อาทิตย์/OT จริง)', () => {
  const result = calculateManday({
    period: '2026-01',
    monthlyRate: DEV.monthlyRate,
    reportedWorkDays: 21, // Timesheet รายงานเกินจริง
    leaveDays: [{ date: '2026-01-29', type: 'sick' }],
    holidays: HOLIDAYS_JAN_2026,
  });

  assert.equal(result.ok, true);
  const flagged = result.checks.find((c) => c.id === 'workday_sum');
  assert.equal(flagged.severity, SEVERITY.WARN);
});

test('ตรวจจับวันลาที่ตรงกับวันหยุด', () => {
  const result = calculateManday({
    period: '2026-01',
    monthlyRate: DEV.monthlyRate,
    reportedWorkDays: 20,
    leaveDays: [{ date: '2026-01-01', type: 'sick' }], // วันขึ้นปีใหม่
    holidays: HOLIDAYS_JAN_2026,
  });

  assert.equal(result.ok, false);
  assert.ok(result.checks.some((c) => c.id === 'leave_on_holiday:2026-01-01'));
});

test('ทักเมื่อ Timesheet เขียนวันเสาร์ว่าเป็น Holiday', () => {
  const result = calculateManday({
    period: '2026-01',
    monthlyRate: DEV.monthlyRate,
    reportedWorkDays: 19,
    leaveDays: [{ date: '2026-01-29', type: 'sick' }],
    holidays: HOLIDAYS_JAN_2026,
    reportedDayLabels: [{ date: '2026-01-31', label: 'Holiday' }],
  });

  assert.ok(result.ok, 'ไม่กระทบยอดเงิน จึงไม่ควรเป็น fail');
  const warn = result.checks.find((c) => c.id === 'label_mismatch:2026-01-31');
  assert.equal(warn.severity, SEVERITY.WARN);
});

test('เตือนว่าตัวหาร 20 ยังยืนยันไม่ได้ในเดือนที่มีวันทำงาน 20 วันพอดี', () => {
  const result = calculateManday({
    period: '2026-01',
    monthlyRate: DEV.monthlyRate,
    reportedWorkDays: 19,
    leaveDays: [{ date: '2026-01-29', type: 'sick' }],
    holidays: HOLIDAYS_JAN_2026,
  });

  assert.ok(result.checks.some((c) => c.id === 'divisor_ambiguous'));
});

test('ตัวหารสองแบบให้ผลต่างกันในเดือนที่วันทำงานไม่ใช่ 20', () => {
  // เม.ย. 2026 มีวันธรรมดา 22 วัน สมมติวันหยุดสงกรานต์ 13–15 เม.ย.
  const holidays = new Map([
    ['2026-04-06', 'วันจักรี (ชดเชย)'],
    ['2026-04-13', 'วันสงกรานต์'],
    ['2026-04-14', 'วันสงกรานต์'],
    ['2026-04-15', 'วันสงกรานต์'],
  ]);
  const common = {
    period: '2026-04',
    monthlyRate: DEV.monthlyRate,
    reportedWorkDays: 17,
    leaveDays: [{ date: '2026-04-20', type: 'personal' }],
    holidays,
  };

  const fixed = calculateManday({ ...common, divisor: { mode: DIVISOR_MODE.FIXED, value: 20 } });
  const actual = calculateManday({
    ...common,
    divisor: { mode: DIVISOR_MODE.ACTUAL_WORKING_DAYS },
  });

  assert.equal(fixed.standardWorkingDays, 18);
  assert.equal(fixed.dailyRate, 2647.2, 'หารคงที่ 20');
  assert.equal(actual.dailyRate, round2(DEV.monthlyRate / 18), 'หารด้วยวันทำงานจริง 18');
  assert.notEqual(
    fixed.discount,
    actual.discount,
    'ส่วนลดต่างกัน — ต้องยืนยันเงื่อนไขกับสัญญาก่อนใช้จริง',
  );
});

test('จับคู่ชื่อได้ทั้งไทย อังกฤษ และที่สะกดต่าง', () => {
  const employees = [DEV, PM];

  assert.equal(matchEmployee('Pongpun Mamak', employees).match, MATCH.EXACT);
  assert.equal(matchEmployee('พงศ์พันธ์ มามาก', employees).match, MATCH.EXACT);
  assert.equal(matchEmployee('นาย พงศ์พันธ์ มามาก', employees).match, MATCH.EXACT);
  assert.equal(matchEmployee('Pongpun Mamark', employees).match, MATCH.ALIAS);

  const fuzzy = matchEmployee('Pongpun Mamaak', employees);
  assert.equal(fuzzy.match, MATCH.FUZZY);
  assert.equal(fuzzy.employee.id, 'EMP-0042');

  const none = matchEmployee('Somchai Saikod', employees);
  assert.equal(none.match, MATCH.NONE);
  assert.equal(none.employee, null);
});

test('ตำแหน่งจาก Timesheet ยอมรับได้ผ่านชื่อพ้อง', () => {
  assert.ok(checkPosition('Java Programmer', DEV).ok, 'อยู่ในชื่อพ้อง');
  assert.ok(checkPosition('Dev', DEV).ok, 'ชื่อในใบว่าจ้าง');
  assert.ok(checkPosition('Developer', DEV).ok, 'ชื่อบนใบแจ้งหนี้');
  assert.equal(checkPosition('Business Analyst', DEV).ok, false);
});

test('payload ที่ส่งเข้า FlowAccount ครบทุกฟิลด์ที่ใบจริงมี', () => {
  const entries = [PM, DEV].map((employee) => ({
    employee,
    manday: calculateManday({
      period: '2026-01',
      monthlyRate: employee.monthlyRate,
      reportedWorkDays: employee === DEV ? 19 : 20,
      leaveDays: employee === DEV ? [{ date: '2026-01-29', type: 'sick' }] : [],
      holidays: HOLIDAYS_JAN_2026,
    }),
  }));

  const invoice = buildInvoice({
    period: '2026-01',
    documentDate: '2026-02-02',
    customer: { name: 'บริษัท ไทยประกันชีวิต จำกัด (มหาชน)', taxId: '0107555000104' },
    entries,
  });

  const payload = toFlowAccountPayload(invoice);

  // FlowAccount ไม่มีฟิลด์ status — ร่างเกิดจากการไม่เรียก endpoint อนุมัติ
  assert.equal(payload.status, undefined, 'สเปกจริงไม่มีฟิลด์ status');
  // สามตัวนี้ต้องมาพร้อมกัน ไม่งั้นส่วนลดรายบรรทัดไม่ทำงาน
  assert.equal(payload.documentStructureType, 'InlineDocument');
  assert.equal(payload.useInlineDiscount, true);
  assert.equal(payload.discountType, 1);

  assert.equal(payload.reference, null, 'ใบจริงเว้นช่อง Reference ว่าง');
  assert.equal(payload.publishedOn, '2026-02-02', 'ของจริงชื่อ publishedOn');
  assert.equal(payload.creditType, 1);
  assert.equal(payload.creditDays, 30);

  // ยอดทุกช่องต้องตรงกับใบจริง INV2026020006
  assert.equal(payload.subTotal, 176363.93);
  assert.equal(payload.discountAmount, 2647.2);
  assert.equal(payload.totalAfterDiscount, 173716.73);
  assert.equal(payload.vatAmount, 12160.17);
  assert.equal(payload.grandTotal, 185876.9);
  assert.equal(payload.documentWithholdingTaxPercentage, 3);
  assert.equal(payload.documentWithholdingTaxAmount, 5211.5,
    'WHT คิดจากยอดหลังส่วนลดก่อน VAT และเราต้องส่งไปเอง');
  assert.equal(payload.vatableAmount, 173716.73);

  assert.equal(payload.items.length, 2);
  assert.equal(payload.items[1].pricePerUnit, 52943.93);
  assert.equal(payload.items[1].discountAmount, 2647.2, 'ของจริงชื่อ discountAmount');
  assert.equal(payload.items[1].total, 50296.73, 'total ของบรรทัด = ราคา − ส่วนลด');
  assert.equal(payload.items[1].vatRate, 7);
  assert.equal(payload.items[1].type, 1, '1 = ค่าบริการ');
  assert.match(payload.remarks, /2,647\.20 บาทต่อวัน/);
});

test('payload ส่งข้อมูลลูกค้าเต็มถ้ายังไม่มี flowAccountContactId — ให้ FlowAccount สร้าง contact ใหม่', () => {
  const invoice = buildInvoice({
    period: '2026-01',
    documentDate: '2026-02-02',
    customer: { name: 'บริษัท ไทยประกันชีวิต จำกัด (มหาชน)', taxId: '0107555000104', branch: 'สำนักงานใหญ่' },
    entries: [{ employee: DEV, manday: calculateManday({
      period: '2026-01', monthlyRate: DEV.monthlyRate, reportedWorkDays: 20, leaveDays: [], holidays: HOLIDAYS_JAN_2026,
    }) }],
  });
  const payload = toFlowAccountPayload(invoice);

  assert.equal(payload.contactName, 'บริษัท ไทยประกันชีวิต จำกัด (มหาชน)');
  assert.equal(payload.contactTaxId, '0107555000104');
  assert.equal(payload.contactBranch, 'สำนักงานใหญ่');
  assert.equal(payload.contactId, undefined, 'ยังไม่มี contactId เดิม ห้ามส่งฟิลด์นี้ไป');
});

test('payload ส่งแค่ contactId เปล่าๆถ้ามี flowAccountContactId แล้ว — กัน FlowAccount สร้าง contact ซ้ำ', () => {
  /* ยิง sandbox จริงยืนยันแล้ว 13 ส.ค. 69: ส่ง contactId เปล่าๆ (ไม่ส่งชื่อ/เลขผู้เสียภาษีเลย)
     FlowAccount ผูกเอกสารกับ contact เดิมได้จริง ไม่สร้างซ้ำ — ตรงข้ามกับส่ง contactCode ควบคู่
     กับข้อมูลเต็มที่ลองแล้วไม่ได้ผล (ดูคอมเมนต์หัวไฟล์ flowaccount.js) */
  const invoice = buildInvoice({
    period: '2026-01',
    documentDate: '2026-02-02',
    customer: {
      name: 'บริษัท ไทยประกันชีวิต จำกัด (มหาชน)', taxId: '0107555000104', branch: 'สำนักงานใหญ่',
      flowAccountContactId: '1068292',
    },
    entries: [{ employee: DEV, manday: calculateManday({
      period: '2026-01', monthlyRate: DEV.monthlyRate, reportedWorkDays: 20, leaveDays: [], holidays: HOLIDAYS_JAN_2026,
    }) }],
  });
  const payload = toFlowAccountPayload(invoice);

  assert.equal(payload.contactId, 1068292, 'แปลงเป็นเลขให้ตรงชนิดที่ FlowAccount คาด');
  assert.equal(payload.contactName, undefined, 'ห้ามส่งควบคู่กับ contactId ไม่งั้น FlowAccount สร้าง contact ใหม่อยู่ดี');
  assert.equal(payload.contactTaxId, undefined);
  assert.equal(payload.contactBranch, undefined);
});

test('ยอดใน PO 6 เดือนตรงกับเรทรายเดือนรวม', () => {
  const monthlyTotal = round2(DEV.monthlyRate + PM.monthlyRate);
  assert.equal(monthlyTotal, 176363.93);
  assert.equal(round2(monthlyTotal * 6), 1058183.58, 'ราคารวมก่อนภาษีในใบว่าจ้าง 26/B0113');
});
