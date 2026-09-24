/**
 * ลาไม่เต็มวัน (ครึ่งวัน/เป็นชั่วโมง) — 24 ก.ย. 69 ตามที่ขอ ยืนยันจาก HRDD จริงที่ส่ง amountDay/
 * amountHour แยกกันมาให้ (ไม่ใช่หน่วยวันอย่างเดียว) ระบบต้องหักเงินตามสัดส่วน ไม่ใช่หักเต็มวันเสมอ
 *
 * ใช้เรทจริงจากใบแจ้งหนี้ INV2026020006 (Developer, monthlyRate 52,943.93 → dailyRate 2,647.20)
 * เป็นฐาน เหมือน invoice.test.ts เพื่อให้ผลลัพธ์ตรวจสอบย้อนกลับกับของจริงได้ง่าย
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateManday, DIVISOR_MODE } from '../src/manday.js';

const HOLIDAYS_JAN_2026 = new Map([
  ['2026-01-01', 'วันขึ้นปีใหม่'],
  ['2026-01-02', 'วันหยุดพิเศษ'],
]);
const MONTHLY_RATE = 52943.93; // ตรงกับ DEV ใน invoice.test.ts

test('ลาเต็มวัน (ไม่ระบุ hours) ต้องได้ผลเดิมทุกประการ — ไม่กระทบพฤติกรรมเดิมเลย', () => {
  const result = calculateManday({
    period: '2026-01',
    monthlyRate: MONTHLY_RATE,
    reportedWorkDays: 19,
    leaveDays: [{ date: '2026-01-29', type: 'sick' }],
    holidays: HOLIDAYS_JAN_2026,
    divisor: { mode: DIVISOR_MODE.FIXED, value: 20 },
  });
  assert.equal(result.leaveCount, 1);
  assert.equal(result.payableDays, 19);
  assert.equal(result.discount, 2647.2);
  assert.equal(result.lineAmount, 50296.73);
});

test('ลาครึ่งวัน (hours: 4 จาก 8) ต้องหักเงินแค่ครึ่งเดียว ไม่ใช่เต็มวัน', () => {
  const result = calculateManday({
    period: '2026-01',
    monthlyRate: MONTHLY_RATE,
    reportedWorkDays: 19,
    leaveDays: [{ date: '2026-01-29', type: 'sick', hours: 4 }],
    holidays: HOLIDAYS_JAN_2026,
    divisor: { mode: DIVISOR_MODE.FIXED, value: 20 },
  });
  assert.equal(result.dailyRate, 2647.2);
  assert.equal(result.leaveCount, 0.5, 'ลา 4 ชม. จาก 8 ชม. = ครึ่งวัน');
  assert.equal(result.payableDays, 19.5, '20 - 0.5 = 19.5 วัน');
  assert.equal(result.discount, 1323.6, '2,647.20 × 0.5 = 1,323.60 — หักครึ่งเดียว ไม่ใช่เต็ม 2,647.20');
  assert.equal(result.lineAmount, 51620.33, '52,943.93 - 1,323.60');
});

test('ลาเป็นชั่วโมงล้วนๆ (hours: 3) หักตามสัดส่วนจริง ไม่ปัดขึ้นเป็นครึ่ง/เต็มวัน', () => {
  const result = calculateManday({
    period: '2026-01',
    monthlyRate: MONTHLY_RATE,
    reportedWorkDays: 20,
    leaveDays: [{ date: '2026-01-29', type: 'sick', hours: 3 }],
    holidays: HOLIDAYS_JAN_2026,
    divisor: { mode: DIVISOR_MODE.FIXED, value: 20 },
  });
  assert.equal(result.leaveCount, 0.38, '3 ÷ 8 = 0.375 → ปัด 2 ตำแหน่ง = 0.38');
  assert.equal(result.discount, 1005.94, '2,647.20 × 0.38 (leaveCount ที่ปัดแล้ว) = 1,005.936 → 1,005.94');
});

test('ลาผสม: เต็มวัน 1 วัน + ครึ่งวัน 1 วัน ในรอบเดียวกัน รวมถูกต้อง', () => {
  const result = calculateManday({
    period: '2026-01',
    monthlyRate: MONTHLY_RATE,
    reportedWorkDays: 18,
    leaveDays: [
      { date: '2026-01-29', type: 'sick' },
      { date: '2026-01-28', type: 'personal', hours: 4 },
    ],
    holidays: HOLIDAYS_JAN_2026,
    divisor: { mode: DIVISOR_MODE.FIXED, value: 20 },
  });
  assert.equal(result.leaveCount, 1.5, '1 เต็มวัน + 0.5 ครึ่งวัน = 1.5');
  assert.equal(result.payableDays, 18.5);
  assert.equal(result.discount, 3970.8, '2,647.20 × 1.5 = 3,970.80');
});

test('หมายเหตุท้ายใบแจ้งหนี้ (remarkLines) โชว์วันที่ลาไม่เต็มวันถูกต้อง ไม่โกหกว่าหักเต็มวัน', () => {
  const result = calculateManday({
    period: '2026-01',
    monthlyRate: MONTHLY_RATE,
    reportedWorkDays: 19,
    leaveDays: [{ date: '2026-01-29', type: 'sick', hours: 4 }],
    holidays: HOLIDAYS_JAN_2026,
    divisor: { mode: DIVISOR_MODE.FIXED, value: 20 },
  });
  assert.ok(result.remarkLines.some((l) => l.includes('0.5 วัน')), 'ต้องโชว์ 0.5 วัน ไม่ใช่ 1 วัน');
  assert.equal(result.remarkLines.at(-1), 'รวม = 0.5 วัน');
});

test('OT ในวันเดียวกับที่ลาครึ่งวัน ยังคำนวณแยกจากกันถูกต้อง ไม่ปนกัน', () => {
  const result = calculateManday({
    period: '2026-01',
    monthlyRate: MONTHLY_RATE,
    reportedWorkDays: 19,
    leaveDays: [{ date: '2026-01-29', type: 'sick', hours: 4 }],
    otDays: [{ date: '2026-01-30', hours: 2 }],
    holidays: HOLIDAYS_JAN_2026,
    divisor: { mode: DIVISOR_MODE.FIXED, value: 20 },
  });
  assert.equal(result.discount, 1323.6);
  assert.equal(result.otTotal, 661.8, '(2 ÷ 8) × 2,647.20 = 661.80');
  assert.equal(result.lineAmount, 52282.13, '52,943.93 - 1,323.60 + 661.80');
});
