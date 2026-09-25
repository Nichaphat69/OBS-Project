/**
 * ยอดประมาณในการ์ดตรวจสอบหน้าอัปโหลด (25 ก.ย. 69) — ต้องคิดด้วยสูตรเดียวกับใบแจ้งหนี้จริงทุกขั้น
 * เดิมการ์ดคิดจากเรทรายเดือนดิบๆ ไม่หักวันลา ไม่รวม VAT ตัวเลขไม่ตรงกับใบแจ้งหนี้ที่ออกจริง
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@obs/db';
import { buildInvoice, calculateManday } from '@obs/domain';

import { seedFixtures, CONTRACT } from './helpers/testDb.js';
import { estimateTimesheetAmount } from '../src/lib/timesheetsService.js';
import { holidayMap } from '../src/lib/masterData.js';

await seedFixtures();

test.after(async () => {
  await prisma.$disconnect();
});

test('ยอดประมาณ = ตัวเลขเดียวกับ buildInvoice() ของพนักงานคนนั้น (หักวันลา + VAT + หัก ณ ที่จ่ายปัดเป็น % เต็ม)', async () => {
  const assignment = await prisma.assignment.findFirst({ where: { contractId: CONTRACT.id, status: 'active' }, include: { contract: true, employee: true } });
  assert.ok(assignment);
  const period = assignment.startDate.slice(0, 7);
  // หาวันธรรมดาสองวันแรกของเดือน — ไม่ให้ตกวันหยุดแล้วเทสต์ไม่ได้ทดสอบการหักจริง
  const days: string[] = [];
  for (let d = 1; days.length < 2 && d <= 28; d++) {
    const iso = `${period}-${String(d).padStart(2, '0')}`;
    const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) days.push(iso);
  }
  const leaveDays = days.map((date) => ({ date, type: 'sick' }));

  const est = await estimateTimesheetAmount({ contractId: CONTRACT.id, employeeId: assignment.employeeId, period, leaveDays, whtRate: 0.0225 });
  assert.ok(est);

  const holidays = await holidayMap(assignment.contract.customerId);
  const manday = calculateManday({
    period,
    monthlyRate: assignment.monthlyRate,
    reportedWorkDays: 0,
    leaveDays: leaveDays.map((l) => ({ ...l, type: l.type as any })),
    holidays,
    divisor: { mode: assignment.contract.divisorMode as any, value: assignment.contract.divisorValue },
  });
  const invoice = buildInvoice({
    period,
    documentDate: `${period}-28`,
    customer: { name: 'x', taxId: 'x' },
    entries: [{ employee: { id: assignment.employeeId, nameTh: 'x', invoicePosition: 'x' }, manday }],
    vatRate: assignment.contract.vatRate,
    whtRate: 0.0225,
  });

  assert.ok(est.discount > 0, 'ต้องหักวันลาจริง ไม่ใช่คิดจากเรทเต็มเดือน');
  assert.equal(est.subtotal, invoice.totals.totalAfterDiscount);
  assert.equal(est.vat, invoice.totals.vat);
  assert.equal(est.whtRate, 0.02, 'เรต 2.25% ต้องปัดเป็น 2% เหมือนใบแจ้งหนี้');
  assert.equal(est.withholdingTax, invoice.totals.withholdingTax);
  assert.equal(est.paymentAmount, invoice.totals.paymentAmount);
});

test('พนักงานที่ไม่ได้อยู่ในสัญญานี้ → null (หน้าเว็บจะบอกว่าคำนวณไม่ได้ ไม่โชว์ตัวเลขมั่ว)', async () => {
  assert.equal(await estimateTimesheetAmount({ contractId: CONTRACT.id, employeeId: 'EMP-NOPE', period: '2026-01', leaveDays: [] }), null);
});
