/**
 * คำนวณและตรวจสอบ Manday
 *
 * โมเดลคิดเงินของสัญญานี้คือ "เรทรายเดือนเต็มจำนวน หักส่วนลดวันลา"
 * ไม่ใช่ "จำนวนวันทำงาน × เรทรายวัน" — ยืนยันจากใบแจ้งหนี้ INV2026020006
 * ซึ่งลง qty = 1 Months, unit price = เรทเดือน, discount = วันลา × (เรทเดือน ÷ ตัวหาร)
 */

import { buildMonth } from './calendar.js';
import { round2, thaiDateShort } from '../util/money.js';

export const DIVISOR_MODE = {
  /** หารด้วยเลขคงที่ตามสัญญา (ค่าเริ่มต้น — ตรงกับ INV2026020006) */
  FIXED: 'fixed',
  /** หารด้วยวันทำงานจริงของเดือนนั้น */
  ACTUAL_WORKING_DAYS: 'actual_working_days',
};

export const SEVERITY = { PASS: 'pass', WARN: 'warn', FAIL: 'fail' };

/**
 * @param {object} input
 * @param {string} input.period                 'YYYY-MM'
 * @param {number} input.monthlyRate            เรทต่อเดือนตาม PO
 * @param {number} input.reportedWorkDays       Total Work days ที่อ่านได้จาก Timesheet
 * @param {Array<{date:string,type:string}>} input.leaveDays  วันลาที่อ่านได้จาก Timesheet
 * @param {Map<string,string>} input.holidays
 * @param {object} input.divisor                { mode, value }
 * @param {Array<{date:string,label:string}>} [input.reportedDayLabels] ป้ายกำกับรายวันจาก Timesheet
 */
export function calculateManday({
  period,
  monthlyRate,
  reportedWorkDays,
  leaveDays = [],
  holidays = new Map(),
  divisor = { mode: DIVISOR_MODE.FIXED, value: 20 },
  reportedDayLabels = [],
}) {
  const leaveDates = new Set(leaveDays.map((l) => l.date));
  const calendar = buildMonth(period, holidays, leaveDates);

  const leaveCount = leaveDays.length;
  const standardWorkingDays = calendar.standardWorkingDays;
  const payableDays = standardWorkingDays - leaveCount;

  const divisorValue =
    divisor.mode === DIVISOR_MODE.ACTUAL_WORKING_DAYS
      ? standardWorkingDays
      : divisor.value;

  const dailyRate = round2(monthlyRate / divisorValue);
  const discount = round2(leaveCount * dailyRate);
  const lineAmount = round2(monthlyRate - discount);

  const checks = runChecks({
    calendar,
    reportedWorkDays,
    leaveDays,
    standardWorkingDays,
    payableDays,
    reportedDayLabels,
    divisor,
    divisorValue,
  });

  return {
    period,
    calendar,
    standardWorkingDays,
    reportedWorkDays,
    leaveCount,
    leaveDays,
    payableDays,
    divisor: { ...divisor, applied: divisorValue },
    monthlyRate,
    dailyRate,
    discount,
    lineAmount,
    remarkLines: buildRemarkLines({ dailyRate, leaveDays }),
    checks,
    ok: checks.every((c) => c.severity !== SEVERITY.FAIL),
  };
}

/**
 * หมายเหตุท้ายใบแจ้งหนี้ ตามรูปแบบของ INV2026020006
 *   2,647.20 บาทต่อวัน
 *   ส่วนลดเนื่องจากพนักงานลา
 *   วันที่ 29 ม.ค. 69 = 1 วัน
 *   รวม = 1 วัน
 *
 * ใบจริงพิมพ์ปีเป็น "68" ซึ่งควรเป็น "69" — ตัวสร้างนี้คำนวณปี พ.ศ. จากวันที่จริง
 */
function buildRemarkLines({ dailyRate, leaveDays }) {
  if (leaveDays.length === 0) return [];

  const perDate = new Map();
  for (const leave of leaveDays) {
    perDate.set(leave.date, (perDate.get(leave.date) ?? 0) + 1);
  }

  const lines = [
    `${dailyRate.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาทต่อวัน`,
    'ส่วนลดเนื่องจากพนักงานลา',
  ];
  for (const [date, count] of [...perDate.entries()].sort()) {
    lines.push(`วันที่ ${thaiDateShort(date)} = ${count} วัน`);
  }
  lines.push(`รวม = ${leaveDays.length} วัน`);
  return lines;
}

function runChecks({
  calendar,
  reportedWorkDays,
  leaveDays,
  standardWorkingDays,
  payableDays,
  reportedDayLabels,
  divisor,
  divisorValue,
}) {
  const checks = [];

  // 1. วันทำงานที่ Timesheet รายงาน + วันลา ต้องเท่ากับวันทำงานของเดือน
  const sum = reportedWorkDays + leaveDays.length;
  checks.push(
    sum === standardWorkingDays
      ? {
          id: 'workday_sum',
          severity: SEVERITY.PASS,
          title: 'วันทำงานบวกวันลาเท่ากับวันทำงานของเดือน',
          detail: `${reportedWorkDays} + ${leaveDays.length} = ${standardWorkingDays} ตรงกัน`,
        }
      : {
          id: 'workday_sum',
          severity: SEVERITY.FAIL,
          title: 'วันทำงานบวกวันลาไม่เท่ากับวันทำงานของเดือน',
          detail: `Timesheet รายงาน ${reportedWorkDays} + ลา ${leaveDays.length} = ${sum} แต่ปฏิทินคำนวณได้ ${standardWorkingDays} วัน`,
        },
  );

  // 2. วันที่ลาต้องเป็นวันทำงาน ไม่ใช่เสาร์-อาทิตย์หรือวันหยุด
  const byDate = new Map(calendar.days.map((d) => [d.date, d]));
  for (const leave of leaveDays) {
    const day = byDate.get(leave.date);
    if (!day) {
      checks.push({
        id: `leave_out_of_period:${leave.date}`,
        severity: SEVERITY.FAIL,
        title: 'วันลาไม่อยู่ในรอบบิล',
        detail: `${leave.date} ไม่ได้อยู่ในเดือน ${calendar.period}`,
      });
    } else if (day.kind === 'weekend') {
      checks.push({
        id: `leave_on_weekend:${leave.date}`,
        severity: SEVERITY.FAIL,
        title: 'วันลาตรงกับวันเสาร์–อาทิตย์',
        detail: `${leave.date} เป็นวันหยุดสุดสัปดาห์ ไม่ควรนับเป็นวันลา`,
      });
    } else if (day.kind === 'holiday') {
      checks.push({
        id: `leave_on_holiday:${leave.date}`,
        severity: SEVERITY.FAIL,
        title: 'วันลาตรงกับวันหยุดนักขัตฤกษ์',
        detail: `${leave.date} เป็น${day.label ?? 'วันหยุด'} ไม่ควรนับเป็นวันลา`,
      });
    }
  }

  // 3. ป้ายกำกับรายวันใน Timesheet ตรงกับปฏิทินหรือไม่
  //    ใบจริงเขียน 31 ม.ค. (วันเสาร์) ว่า "Holiday" — ไม่กระทบยอดเงิน แต่ควรทัก
  for (const row of reportedDayLabels) {
    const day = byDate.get(row.date);
    if (!day) continue;
    const label = String(row.label ?? '').toLowerCase();
    if (label.includes('holiday') && day.kind === 'weekend') {
      checks.push({
        id: `label_mismatch:${row.date}`,
        severity: SEVERITY.WARN,
        title: 'ป้ายกำกับวันใน Timesheet ไม่ตรงกับปฏิทิน',
        detail: `${row.date} เป็นวันเสาร์–อาทิตย์ แต่ Timesheet เขียนว่า Holiday — ไม่กระทบยอดเงิน`,
      });
    }
  }

  // 4. ตัวหารยังยืนยันไม่ได้เมื่อวันทำงานของเดือนเท่ากับตัวหารคงที่พอดี
  if (
    divisor.mode === DIVISOR_MODE.FIXED &&
    standardWorkingDays === divisor.value
  ) {
    checks.push({
      id: 'divisor_ambiguous',
      severity: SEVERITY.WARN,
      title: 'ตัวหารยังยืนยันไม่ได้',
      detail:
        `เดือนนี้มีวันทำงาน ${standardWorkingDays} วัน เท่ากับตัวหารคงที่ ${divisor.value} พอดี ` +
        'จึงยังแยกไม่ออกว่าสัญญาใช้ตัวหารคงที่หรือวันทำงานจริง — ควรขอใบแจ้งหนี้อีกเดือนที่วันทำงานไม่เท่ากันมาเทียบ',
    });
  } else if (divisor.mode === DIVISOR_MODE.FIXED && divisorValue !== standardWorkingDays) {
    checks.push({
      id: 'divisor_differs',
      severity: SEVERITY.WARN,
      title: 'ตัวหารคงที่ต่างจากวันทำงานจริงของเดือน',
      detail:
        `ระบบใช้ตัวหารคงที่ ${divisorValue} แต่เดือนนี้มีวันทำงานจริง ${standardWorkingDays} วัน ` +
        'อัตราต่อวันจะต่างจากการหารด้วยวันทำงานจริง — ยืนยันเงื่อนไขในสัญญาก่อนวางบิล',
    });
  }

  if (payableDays < 0) {
    checks.push({
      id: 'payable_negative',
      severity: SEVERITY.FAIL,
      title: 'วันที่วางบิลได้ติดลบ',
      detail: `วันลา ${leaveDays.length} วัน มากกว่าวันทำงานของเดือน ${standardWorkingDays} วัน`,
    });
  }

  return checks;
}
