/**
 * คำนวณและตรวจสอบ Manday
 *
 * โมเดลคิดเงินของสัญญานี้คือ "เรทรายเดือนเต็มจำนวน หักส่วนลดวันลา"
 * ไม่ใช่ "จำนวนวันทำงาน × เรทรายวัน" — ยืนยันจากใบแจ้งหนี้ INV2026020006
 * ซึ่งลง qty = 1 Months, unit price = เรทเดือน, discount = วันลา × (เรทเดือน ÷ ตัวหาร)
 *
 * Ported from src/domain/manday.js — logic preserved exactly, types added.
 */

import { buildMonth, type MonthCalendar } from './calendar.js';
import { round2, thaiDateShort } from './money.js';

export const DIVISOR_MODE = {
  /** หารด้วยเลขคงที่ตามสัญญา (ค่าเริ่มต้น — ตรงกับ INV2026020006) */
  FIXED: 'fixed',
  /** หารด้วยวันทำงานจริงของเดือนนั้น */
  ACTUAL_WORKING_DAYS: 'actual_working_days',
} as const;

export type DivisorMode = (typeof DIVISOR_MODE)[keyof typeof DIVISOR_MODE];

export const SEVERITY = { PASS: 'pass', WARN: 'warn', FAIL: 'fail' } as const;
export type Severity = (typeof SEVERITY)[keyof typeof SEVERITY];

/** สมมติฐานชั่วโมงทำงานปกติต่อวัน — ใช้เป็นตัวหารคำนวณค่าจ้าง OT เพิ่ม (25 ส.ค. 69 ตามที่ขอ)
 * ตัวอย่างที่ให้มา: เงินเดือน 100,000 หาร 20 วัน = วันละ 5,000 ทำ OT 2 ชม. (รวมวันนั้น 8+2=10 ชม.)
 * → (10/8) × 5,000 = 6,250 — ยังไม่มีที่ตั้งค่าต่อสัญญา ถ้าสัญญาไหนวันทำงานไม่ใช่ 8 ชม.จริง ต้องมาทำ
 * ให้ตั้งค่าได้ต่อสัญญาทีหลัง ตอนนี้ยึดค่านี้ทุกสัญญาเหมือนกันก่อนตามตัวอย่างที่ขอมา */
const STANDARD_WORK_HOURS_PER_DAY = 8;

export interface LeaveDayInput {
  date: string;
  type: string;
}

export interface OtDayInput {
  date: string;
  hours: number;
}

export interface DivisorInput {
  mode: DivisorMode;
  value: number;
}

export interface ReportedDayLabel {
  date: string;
  label?: string | null;
}

export interface MandayCheck {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
}

export interface MandayInput {
  period: string;
  monthlyRate: number;
  reportedWorkDays: number;
  leaveDays?: LeaveDayInput[];
  otDays?: OtDayInput[];
  holidays?: Map<string, string>;
  divisor?: DivisorInput;
  reportedDayLabels?: ReportedDayLabel[];
}

export interface OtBreakdown {
  date: string;
  hours: number;
  otAmount: number;
  dayAmount: number;
}

export interface MandayResult {
  period: string;
  calendar: MonthCalendar;
  standardWorkingDays: number;
  reportedWorkDays: number;
  leaveCount: number;
  leaveDays: LeaveDayInput[];
  payableDays: number;
  divisor: DivisorInput & { applied: number };
  monthlyRate: number;
  dailyRate: number;
  discount: number;
  otDays: OtBreakdown[];
  otTotal: number;
  lineAmount: number;
  remarkLines: string[];
  checks: MandayCheck[];
  ok: boolean;
}

/**
 * @param input.period                 'YYYY-MM'
 * @param input.monthlyRate            เรทต่อเดือนตาม PO
 * @param input.reportedWorkDays       Total Work days ที่อ่านได้จาก Timesheet
 * @param input.leaveDays              วันลาที่อ่านได้จาก Timesheet
 * @param input.otDays                 OT รายวันที่อ่านได้จาก Timesheet
 * @param input.holidays
 * @param input.divisor                { mode, value }
 * @param input.reportedDayLabels      ป้ายกำกับรายวันจาก Timesheet
 */
export function calculateManday({
  period,
  monthlyRate,
  reportedWorkDays,
  leaveDays = [],
  otDays = [],
  holidays = new Map(),
  divisor = { mode: DIVISOR_MODE.FIXED, value: 20 },
  reportedDayLabels = [],
}: MandayInput): MandayResult {
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

  // ค่าจ้าง OT เพิ่ม — ต่อวันที่มี OT: (ชั่วโมง OT ÷ 8) × เรทต่อวัน บวกเพิ่มจากยอดปกติ (ไม่ใช่ส่วนลด)
  const otBreakdown: OtBreakdown[] = otDays.map((o) => {
    const otAmount = round2((o.hours / STANDARD_WORK_HOURS_PER_DAY) * dailyRate);
    return { date: o.date, hours: o.hours, otAmount, dayAmount: round2(dailyRate + otAmount) };
  });
  const otTotal = round2(otBreakdown.reduce((sum, o) => sum + o.otAmount, 0));

  const lineAmount = round2(monthlyRate - discount + otTotal);

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
    otDays: otBreakdown,
    otTotal,
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
function buildRemarkLines({
  dailyRate,
  leaveDays,
}: {
  dailyRate: number;
  leaveDays: LeaveDayInput[];
}): string[] {
  if (leaveDays.length === 0) return [];

  const perDate = new Map<string, number>();
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
}: {
  calendar: MonthCalendar;
  reportedWorkDays: number;
  leaveDays: LeaveDayInput[];
  standardWorkingDays: number;
  payableDays: number;
  reportedDayLabels: ReportedDayLabel[];
  divisor: DivisorInput;
  divisorValue: number;
}): MandayCheck[] {
  const checks: MandayCheck[] = [];

  // 1. วันทำงานที่ Timesheet รายงาน + วันลา ต้องเท่ากับวันทำงานของเดือน
  // เดิมเช็คนี้เป็น FAIL (บล็อกปุ่ม "ยืนยันว่าตรวจแล้ว") — ปรับเป็น WARN ตามที่ขอ เพราะพนักงาน
  // บางคนทำงานวันเสาร์-อาทิตย์/OT จริง ทำให้ยอดเกินวันทำงานปฏิทินได้โดยไม่ใช่ข้อมูลผิด ยังคงโชว์
  // ให้เห็นไว้เผื่อดูประกอบ แต่ไม่บล็อกการยืนยันอีกต่อไป (คนตรวจรับผิดชอบดูตัวเลขเองแทน)
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
          severity: SEVERITY.WARN,
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
