/**
 * ทดสอบการป้อน Timesheet ด้วยมือ — เน้นที่ OT เพราะเป็นทางเดียวที่ตัวเลขเงินเพิ่มขึ้นจากการกรอกมือ
 *
 * รอบที่ใช้คือ มิถุนายน 2026 เลือกเพราะครบทั้งสามแบบของวันที่ทำ OT ได้ในเดือนเดียว
 *   2026-06-03 พุธ  — ตั้งเป็นวันหยุดนักขัตฤกษ์ผ่าน holidays
 *   2026-06-08 จันทร์ — วันทำงานปกติ
 *   2026-06-13 เสาร์ — วันหยุดสุดสัปดาห์
 * ทั้งสามแบบต้องกรอก OT ได้เหมือนกัน และคิดเงินด้วยสูตรเดียวกัน (ชั่วโมง ÷ 8 × เรทต่อวัน)
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildManualSheet, ManualSheetError } from '../src/manualSheet.js';
import { calculateManday, DIVISOR_MODE } from '../src/manday.js';

const PERIOD = '2026-06';
const HOLIDAYS = new Map([['2026-06-03', 'วันเฉลิมพระชนมพรรษา']]);

const BASE = {
  employeeName: 'พงศ์พันธ์ มามาก',
  position: 'Developer',
  period: PERIOD,
  holidays: HOLIDAYS,
};

/** เก็บ error ทั้งชุดออกมาดู ไม่ใช่แค่ข้อความแรก เพราะกรอกผิดหลายบรรทัดต้องเห็นครบในรอบเดียว */
function errorsOf(input: Parameters<typeof buildManualSheet>[0]): string[] {
  try {
    buildManualSheet(input);
  } catch (error) {
    assert.ok(error instanceof ManualSheetError, 'ต้องเป็น ManualSheetError');
    return (error as ManualSheetError).errors;
  }
  assert.fail('ควรจะ throw แต่ผ่านไปได้');
}

const dayOf = (sheet: ReturnType<typeof buildManualSheet>, date: string) =>
  sheet.days.find((d) => d.date === date)!;

test('กรอก OT ได้ทั้งวันธรรมดา วันเสาร์ และวันหยุดนักขัตฤกษ์ — ไม่แยกเงื่อนไข', () => {
  const sheet = buildManualSheet({
    ...BASE,
    otDays: [
      { date: '2026-06-08', hours: 2 },
      { date: '2026-06-13', hours: 8 },
      { date: '2026-06-03', hours: 4 },
    ],
  });

  assert.deepEqual(
    [...sheet.otDays].sort((a, b) => a.date.localeCompare(b.date)),
    [
      { date: '2026-06-03', hours: 4 },
      { date: '2026-06-08', hours: 2 },
      { date: '2026-06-13', hours: 8 },
    ],
  );
});

test('ชั่วโมง OT ติดไปกับแถวรายวันด้วย วันที่ไม่มี OT เป็น null', () => {
  const sheet = buildManualSheet({ ...BASE, otDays: [{ date: '2026-06-13', hours: 8 }] });

  assert.equal(dayOf(sheet, '2026-06-13').otHours, 8, 'เสาร์ที่ทำ OT');
  assert.equal(dayOf(sheet, '2026-06-13').label, 'Weekend', 'ยังเป็นวันหยุดสุดสัปดาห์เหมือนเดิม');
  assert.equal(dayOf(sheet, '2026-06-13').timeIn, null, 'ไม่ได้มาทำงานเวลาปกติ');
  assert.equal(dayOf(sheet, '2026-06-08').otHours, null, 'วันทำงานที่ไม่มี OT');
  assert.equal(dayOf(sheet, '2026-06-20').otHours, null, 'เสาร์อื่นที่ไม่มี OT');
});

test('OT ไม่ทำให้จำนวนวันทำงานหรือวันลาเปลี่ยน', () => {
  const plain = buildManualSheet({ ...BASE });
  const withOt = buildManualSheet({
    ...BASE,
    otDays: [{ date: '2026-06-13', hours: 8 }, { date: '2026-06-08', hours: 3 }],
  });

  assert.equal(withOt.totalWorkDays, plain.totalWorkDays, 'ทำ OT เสาร์ไม่ได้แปลว่าวันทำงานเพิ่ม');
  assert.equal(withOt.totalLeaveDays, plain.totalLeaveDays);
});

test('ชั่วโมงที่ส่งมาเป็น string (ค่าจากช่องกรอกในฟอร์ม) อ่านเป็นตัวเลขได้ รวมทศนิยม', () => {
  const sheet = buildManualSheet({ ...BASE, otDays: [{ date: '2026-06-08', hours: '2.5' }] });
  assert.deepEqual(sheet.otDays, [{ date: '2026-06-08', hours: 2.5 }]);
});

test('ไม่กรอก OT เลย — otDays ว่าง ไม่มี otHours ในแถวไหน', () => {
  const sheet = buildManualSheet({ ...BASE });
  assert.deepEqual(sheet.otDays, []);
  assert.equal(sheet.days.every((d) => d.otHours === null), true);
});

test('วันที่ทำ OT ผิดรูปแบบ / นอกรอบ / ซ้ำ → ตีกลับพร้อมบอกว่าบรรทัดไหน', () => {
  assert.match(errorsOf({ ...BASE, otDays: [{ date: '13/06/2026', hours: 8 }] })[0], /ไม่ใช่รูปแบบ YYYY-MM-DD/);
  assert.match(errorsOf({ ...BASE, otDays: [{ date: '2026-07-13', hours: 8 }] })[0], /ไม่ได้อยู่ในรอบ 2026-06/);
  assert.match(
    errorsOf({ ...BASE, otDays: [{ date: '2026-06-13', hours: 4 }, { date: '2026-06-13', hours: 4 }] })[0],
    /ถูกกรอกซ้ำ/,
  );
});

test('ชั่วโมง OT ที่เป็นไปไม่ได้ → ตีกลับ ไม่ปล่อยให้ไปโผล่เป็นยอดเงิน', () => {
  for (const hours of [0, -2, 'แปด', '']) {
    assert.match(
      errorsOf({ ...BASE, otDays: [{ date: '2026-06-08', hours: hours as number | string }] })[0],
      /ต้องเป็นตัวเลขมากกว่า 0/,
      `hours = ${JSON.stringify(hours)}`,
    );
  }
  // พิมพ์ 8 เป็น 80 จะบวกเงินเกินไปสิบเท่าโดยไม่มีอะไรมาดัก จึงตัดที่ 24 ชั่วโมงซึ่งเป็นเพดานจริงของ 1 วัน
  assert.match(errorsOf({ ...BASE, otDays: [{ date: '2026-06-08', hours: 80 }] })[0], /เกิน 24 ชั่วโมงใน 1 วัน/);
});

test('วันเดียวกันเป็นทั้งวันลาและวัน OT → ตีกลับ เพราะเงินจะขยับสองทางโดยไม่มีใครอธิบายได้', () => {
  const errors = errorsOf({
    ...BASE,
    leaveDays: [{ date: '2026-06-08', type: 'sick' }],
    otDays: [{ date: '2026-06-08', hours: 2 }],
  });
  assert.match(errors[0], /ถูกกรอกเป็นวันลาไว้แล้ว/);
});

test('OT จากการกรอกมือคิดเงินด้วยสูตรเดียวกับที่อ่านจาก PDF ไม่ว่าจะทำวันไหน', () => {
  const sheet = buildManualSheet({
    ...BASE,
    otDays: [
      { date: '2026-06-08', hours: 2 },  // จันทร์
      { date: '2026-06-13', hours: 4 },  // เสาร์
      { date: '2026-06-03', hours: 2 },  // วันหยุดนักขัตฤกษ์
    ],
  });

  const manday = calculateManday({
    period: PERIOD,
    monthlyRate: 100_000,
    reportedWorkDays: sheet.totalWorkDays,
    leaveDays: sheet.leaveDays,
    otDays: sheet.otDays,
    holidays: HOLIDAYS,
    divisor: { mode: DIVISOR_MODE.FIXED, value: 20 },
  });

  assert.equal(manday.dailyRate, 5000, '100,000 ÷ 20');
  // สูตรเดียวกันหมด: (ชั่วโมง ÷ 8) × 5,000 — วันหยุดไม่มีตัวคูณพิเศษ
  assert.equal(manday.otTotal, 1250 + 2500 + 1250, '(2/8 + 4/8 + 2/8) × 5,000');
  assert.equal(manday.lineAmount, 100_000 + 5000, 'ไม่มีวันลา ยอดจึงเป็นเรทเดือนบวก OT');
  assert.equal(manday.otDays.length, 3);
});
