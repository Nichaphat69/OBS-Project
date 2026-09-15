/**
 * เทียบวันลาที่ Timesheet รายงานกับวันลาที่อนุมัติแล้วใน HRDD — ฟังก์ชันล้วน (pure) ไม่แตะ
 * เครือข่าย/ฐานข้อมูลเลย จึงเทสต์ได้ด้วยข้อมูลจำลองโดยไม่ต้องมีบัญชี HRDD จริง
 *
 * ใช้ classifyLeaveType() ตัวเดียวกับที่ normalize.js ใช้จัดกลุ่มวันลาจาก Timesheet เทียบ "ประเภท"
 * ทั้งสองฝั่ง (ไม่เทียบสตริงดิบตรงๆ) เพราะ Timesheet เขียน "Sick Leave" ส่วน HRDD เขียน "ลาป่วย"
 * แต่ทั้งคู่ควรจัดกลุ่มลงที่ 'sick' เหมือนกัน
 *
 * 4 สถานะ ตรงกับ mockup ที่ทีมออกแบบไว้ (ok/warn/info/bad):
 *   ok   ตรงกันทั้งวันที่และประเภท
 *   warn มีวันลาวันเดียวกันทั้งสองฝั่ง แต่ประเภทไม่ตรง
 *   info มีใน HRDD (อนุมัติแล้ว) แต่ไม่มีใน Timesheet — อาจตกหล่นจากตาราง Timesheet
 *   bad  มีใน Timesheet แต่ไม่มีใน HRDD — พนักงานอาจยังไม่ได้ยื่นคำขอลาในระบบเช็คชื่อ
 *
 * Ported from src/domain/leaveCompare.js — logic preserved exactly, types added.
 * classifyLeaveType() now lives in ./normalize.ts (the full port of src/extract/normalize.js) —
 * this module used to carry its own inline copy before that port existed.
 */
import { classifyLeaveType } from './normalize.js';

export interface TsLeave {
  date: string;
  type?: string | null;
}

export interface HrddLeave {
  dateFrom: string;
  dateTo: string;
  leaveName?: string | null;
  leaveCode?: string | null;
}

export type LeaveCompareStatus = 'ok' | 'warn' | 'info' | 'bad';

export interface LeaveCompareRow {
  date: string;
  tsType: string | null;
  hrddType: string | null;
  status: LeaveCompareStatus;
}

/** เปิดช่วงวันที่ dateFrom..dateTo ของ HRDD (ลาต่อเนื่องหลายวัน) ออกเป็นวันละแถว
 * เพราะ Timesheet บันทึกวันลาเป็นรายวัน เทียบกันตรงๆไม่ได้ถ้าไม่เปิดช่วงก่อน */
function expandHrddLeave(leave: HrddLeave): Array<{ date: string; leaveName: string | null; leaveCode?: string | null }> {
  const days: Array<{ date: string; leaveName: string | null; leaveCode?: string | null }> = [];
  let d = new Date(`${leave.dateFrom}T00:00:00Z`);
  const end = new Date(`${leave.dateTo}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || Number.isNaN(end.getTime())) return days;
  while (d <= end) {
    days.push({ date: d.toISOString().slice(0, 10), leaveName: leave.leaveName ?? null, leaveCode: leave.leaveCode });
    d = new Date(d.getTime() + 86_400_000);
  }
  return days;
}

/**
 * @param tsLeaves        วันลาจาก Timesheet (date: 'YYYY-MM-DD')
 * @param hrddLeaves      วันลาที่อนุมัติแล้วจาก HRDD (กรองเฉพาะ employeeCode ที่ต้องการไว้แล้วก่อนเรียกฟังก์ชันนี้)
 * @returns เรียงตามวันที่
 */
export function compareLeaves(
  tsLeaves: TsLeave[] = [],
  hrddLeaves: HrddLeave[] = [],
): LeaveCompareRow[] {
  const tsByDate = new Map<string, string | null>(tsLeaves.map((l) => [l.date, l.type ?? null]));
  const hrddByDate = new Map<string, string | null>();
  for (const leave of hrddLeaves) {
    for (const day of expandHrddLeave(leave)) hrddByDate.set(day.date, day.leaveName ?? null);
  }

  const allDates = new Set([...tsByDate.keys(), ...hrddByDate.keys()]);

  return [...allDates].sort().map((date) => {
    const tsType = tsByDate.get(date) ?? null;
    const hrddType = hrddByDate.get(date) ?? null;

    let status: LeaveCompareStatus;
    if (tsType && hrddType) {
      status = classifyLeaveType(tsType) === classifyLeaveType(hrddType) ? 'ok' : 'warn';
    } else if (hrddType) {
      status = 'info';
    } else {
      status = 'bad';
    }

    return { date, tsType, hrddType, status };
  });
}

export interface LeaveCompareSummary {
  counts: Record<LeaveCompareStatus, number>;
  total: number;
  mismatched: number;
}

/** สรุปสำหรับแถบแบนเนอร์/สถิติด้านบนตาราง — ใช้ทั้งฝั่ง backend (ตัดสินใจ) และ frontend (แสดงผล) */
export function summarizeLeaveComparison(rows: LeaveCompareRow[]): LeaveCompareSummary {
  const counts: Record<LeaveCompareStatus, number> = { ok: 0, warn: 0, info: 0, bad: 0 };
  for (const row of rows) counts[row.status] += 1;
  return { counts, total: rows.length, mismatched: rows.length - counts.ok };
}
