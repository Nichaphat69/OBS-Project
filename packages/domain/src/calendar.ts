/**
 * ปฏิทินวันทำงาน
 *
 * "วันทำงานมาตรฐานของเดือน" = จำนวนวันจันทร์–ศุกร์ หักวันหยุดที่ตรงกับวันทำงาน
 * ตรวจกับ Timesheet ม.ค. 2026 ของ Pongpun: 22 วันธรรมดา − 2 วันหยุด (1–2 ม.ค.) = 20 วัน
 * ซึ่งตรงกับตัวหาร 20 ที่ใบแจ้งหนี้จริงใช้
 *
 * Ported from src/domain/calendar.js — logic preserved exactly, types added.
 */

export const DAY_KIND = {
  WORKDAY: 'workday',
  WEEKEND: 'weekend',
  HOLIDAY: 'holiday',
  LEAVE: 'leave',
} as const;

export type DayKind = (typeof DAY_KIND)[keyof typeof DAY_KIND];

export interface CalendarDay {
  date: string;
  day: number;
  dayOfWeek: number;
  kind: DayKind;
  label: string | null;
}

export interface MonthCalendar {
  period: string;
  year: number;
  month: number;
  days: CalendarDay[];
  counts: { weekend: number; holiday: number; leave: number; workday: number };
  standardWorkingDays: number;
  firstDate: string;
  lastDate: string;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** 0 = อาทิตย์ … 6 = เสาร์ */
function dayOfWeek(isoDate: string): number {
  return new Date(`${isoDate}T00:00:00Z`).getUTCDay();
}

export function isWeekend(isoDate: string): boolean {
  const dow = dayOfWeek(isoDate);
  return dow === 0 || dow === 6;
}

/**
 * กางปฏิทินหนึ่งเดือน
 * @param period      'YYYY-MM'
 * @param holidays    ISO date → ชื่อวันหยุด
 * @param leaveDates  ISO date ที่พนักงานลา
 */
export function buildMonth(
  period: string,
  holidays: Map<string, string> = new Map(),
  leaveDates: Set<string> = new Set(),
): MonthCalendar {
  const [year, month] = period.split('-').map(Number);
  const total = daysInMonth(year, month);
  const days: CalendarDay[] = [];

  for (let day = 1; day <= total; day += 1) {
    const date = iso(year, month, day);
    const weekend = isWeekend(date);
    const holidayName = holidays.get(date);

    let kind: DayKind;
    if (weekend) kind = DAY_KIND.WEEKEND;
    else if (holidayName) kind = DAY_KIND.HOLIDAY;
    else if (leaveDates.has(date)) kind = DAY_KIND.LEAVE;
    else kind = DAY_KIND.WORKDAY;

    days.push({
      date,
      day,
      dayOfWeek: dayOfWeek(date),
      kind,
      label: holidayName ?? null,
    });
  }

  const counts = {
    weekend: days.filter((d) => d.kind === DAY_KIND.WEEKEND).length,
    holiday: days.filter((d) => d.kind === DAY_KIND.HOLIDAY).length,
    leave: days.filter((d) => d.kind === DAY_KIND.LEAVE).length,
    workday: days.filter((d) => d.kind === DAY_KIND.WORKDAY).length,
  };

  return {
    period,
    year,
    month,
    days,
    counts,
    /** วันทำงานมาตรฐาน — ยังไม่หักวันลา */
    standardWorkingDays: counts.workday + counts.leave,
    firstDate: iso(year, month, 1),
    lastDate: iso(year, month, total),
  };
}

/** เดือนถัดไป: '2026-01' → '2026-02' */
export function nextPeriod(period: string): string {
  const [year, month] = period.split('-').map(Number);
  return month === 12
    ? `${year + 1}-01`
    : `${year}-${String(month + 1).padStart(2, '0')}`;
}
