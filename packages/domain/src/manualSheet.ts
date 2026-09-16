/**
 * ประกอบข้อมูล Timesheet จากที่คนกรอกด้วยมือ
 *
 * คนกรอกแค่ 5 อย่าง: เลขเอกสาร · ชื่อกับตำแหน่งตามที่เขียนในใบ · รอบเดือน · วันที่ลา · วันที่ทำ OT
 * ตารางรายวันทั้งเดือนระบบสร้างเองจากปฏิทิน ไม่ต้องนั่งกรอก 31 แถว — คืนโครงข้อมูลหน้าตาเดียวกับ
 * ที่โมเดล vision/ABBYY อ่านจาก PDF ออกมา เพื่อให้ไหลผ่านเส้น ingest เดิมได้ทั้งเส้น
 *
 * Ported from src/domain/manual-sheet.js — logic preserved exactly, types added.
 */
import { buildMonth, DAY_KIND } from './calendar.js';

export const LEAVE_TYPES = ['sick', 'personal', 'vacation', 'other'] as const;
export type ManualLeaveType = (typeof LEAVE_TYPES)[number];

const LEAVE_LABEL: Record<ManualLeaveType, string> = {
  sick: 'Sick leave',
  personal: 'Personal leave',
  vacation: 'Annual leave',
  other: 'Leave',
};

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface ManualLeaveDayInput {
  date: string;
  type?: string;
}

/** hours รับ string ด้วย เพราะช่องกรอกในฟอร์มส่งค่ามาเป็น string เสมอ */
export interface ManualOtDayInput {
  date: string;
  hours: number | string;
}

/** ชั่วโมงสูงสุดที่เป็นไปได้ใน 1 วัน — ใช้กันพิมพ์ผิดแบบ 8 เป็น 80 ซึ่งจะบวกเงินเกินเป็นสิบเท่า */
const MAX_OT_HOURS_PER_DAY = 24;

export interface BuildManualSheetInput {
  employeeName: string;
  position: string;
  period: string;
  leaveDays?: Array<ManualLeaveDayInput | string>;
  otDays?: ManualOtDayInput[];
  holidays?: Map<string, string>;
  signedByEmployee?: boolean;
  signedByProjectManager?: boolean;
  clientName?: string | null;
  projectName?: string | null;
}

export class ManualSheetError extends Error {
  status = 400;
  errors: string[];
  constructor(errors: string[]) {
    super(errors[0]);
    this.errors = errors;
  }
}

export function buildManualSheet({
  employeeName,
  position,
  period,
  leaveDays = [],
  otDays = [],
  holidays = new Map(),
  signedByEmployee = true,
  signedByProjectManager = true,
  clientName = null,
  projectName = null,
}: BuildManualSheetInput) {
  const errors: string[] = [];

  if (!employeeName?.trim()) errors.push('ต้องกรอกชื่อพนักงานตามที่เขียนในใบ Timesheet');
  if (!position?.trim()) errors.push('ต้องกรอกตำแหน่งตามที่เขียนในใบ Timesheet');
  if (!PERIOD_RE.test(period ?? '')) errors.push('รอบเดือนต้องเป็นรูปแบบ YYYY-MM เช่น 2026-01');

  const seen = new Set<string>();
  const normalised: Array<{ date: string; type: ManualLeaveType }> = [];
  for (const raw of leaveDays) {
    const date = typeof raw === 'string' ? raw : raw?.date;
    const type = ((typeof raw === 'string' ? 'other' : raw?.type) ?? 'other') as ManualLeaveType;

    if (!DATE_RE.test(date ?? '')) {
      errors.push(`วันที่ลา "${date ?? ''}" ไม่ใช่รูปแบบ YYYY-MM-DD`);
      continue;
    }
    if (!date!.startsWith(`${period}-`)) {
      errors.push(`วันที่ลา ${date} ไม่ได้อยู่ในรอบ ${period}`);
      continue;
    }
    if (!LEAVE_TYPES.includes(type)) {
      errors.push(`ประเภทการลา "${type}" ไม่รู้จัก — ใช้ได้: ${LEAVE_TYPES.join(', ')}`);
      continue;
    }
    if (seen.has(date!)) {
      errors.push(`วันที่ลา ${date} ถูกกรอกซ้ำ`);
      continue;
    }
    seen.add(date!);
    normalised.push({ date: date!, type });
  }

  // OT กรอกได้ทุกวันในรอบ — วันธรรมดา เสาร์-อาทิตย์ หรือวันหยุดนักขัตฤกษ์ ไม่แยกเงื่อนไข เพราะสูตรคิดเงิน
  // OT เป็นสูตรเดียวกันหมด (ชั่วโมง ÷ 8 × เรทต่อวัน) ไม่ได้คิดตัวคูณตามชนิดของวัน
  const otSeen = new Set<string>();
  const normalisedOt: Array<{ date: string; hours: number }> = [];
  for (const raw of otDays) {
    const date = raw?.date;
    const hours = typeof raw?.hours === 'string' ? Number(raw.hours.trim()) : raw?.hours;

    if (!DATE_RE.test(date ?? '')) {
      errors.push(`วันที่ทำ OT "${date ?? ''}" ไม่ใช่รูปแบบ YYYY-MM-DD`);
      continue;
    }
    if (!date!.startsWith(`${period}-`)) {
      errors.push(`วันที่ทำ OT ${date} ไม่ได้อยู่ในรอบ ${period}`);
      continue;
    }
    if (otSeen.has(date!)) {
      errors.push(`วันที่ทำ OT ${date} ถูกกรอกซ้ำ — รวมชั่วโมงของวันเดียวกันไว้บรรทัดเดียว`);
      continue;
    }
    if (!Number.isFinite(hours) || (hours as number) <= 0) {
      errors.push(`ชั่วโมง OT ของวันที่ ${date} ต้องเป็นตัวเลขมากกว่า 0`);
      continue;
    }
    if ((hours as number) > MAX_OT_HOURS_PER_DAY) {
      errors.push(`ชั่วโมง OT ของวันที่ ${date} กรอกไว้ ${hours} ชั่วโมง ซึ่งเกิน ${MAX_OT_HOURS_PER_DAY} ชั่วโมงใน 1 วัน`);
      continue;
    }
    // วันลาแล้วมี OT วันเดียวกันขัดกันเอง และขยับเงินสองทาง (หักค่าจ้าง 1 วัน + บวก OT) โดยไม่มีอะไรมาดักต่อ
    // จึงตีกลับให้คนกรอกตัดสินใจ แทนที่จะปล่อยผ่านแล้วได้ยอดที่ไม่มีใครอธิบายได้
    if (seen.has(date!)) {
      errors.push(`วันที่ ${date} ถูกกรอกเป็นวันลาไว้แล้ว จะมี OT วันเดียวกันไม่ได้ — ถ้าวันนั้นมาทำงาน ให้เอาออกจากรายการวันลาก่อน`);
      continue;
    }
    otSeen.add(date!);
    normalisedOt.push({ date: date!, hours: Number(hours) });
  }

  if (errors.length) throw new ManualSheetError(errors);

  const month = buildMonth(period, holidays, seen);
  const otByDate = new Map(normalisedOt.map((o) => [o.date, o.hours]));

  const days = month.days.map((d) => {
    // ชั่วโมง OT ติดไปกับแถวรายวันด้วย ไม่ใช่แค่ใน otDays เพื่อให้ตารางรายวันในหน้าตรวจ Manday
    // แสดงให้เห็นว่าวันไหนมี OT กี่ชั่วโมง ตรวจทานกับใบต้นฉบับได้
    const otHours = otByDate.get(d.date) ?? null;
    if (d.kind === DAY_KIND.WORKDAY) {
      return {
        date: d.date,
        timeIn: '8:30',
        timeOut: '17:00',
        otHours,
        label: null as string | null,
        jobDescription: 'งานตามที่ได้รับมอบหมาย' as string | null,
      };
    }
    const leave = normalised.find((l) => l.date === d.date);
    return {
      date: d.date,
      timeIn: null as string | null,
      timeOut: null as string | null,
      otHours,
      label:
        d.kind === DAY_KIND.WEEKEND
          ? 'Weekend'
          : d.kind === DAY_KIND.HOLIDAY
            ? (d.label ?? 'Holiday')
            : LEAVE_LABEL[leave?.type ?? 'other'],
      jobDescription: null as string | null,
    };
  });

  return {
    vendor: 'iPassion Co.,Ltd.',
    clientName,
    projectName,
    employeeName: employeeName.trim(),
    position: position.trim(),
    period,
    totalWorkDays: month.counts.workday,
    totalLeaveDays: normalised.length,
    days,
    leaveDays: normalised.map((l) => ({ date: l.date, type: l.type, rawLabel: LEAVE_LABEL[l.type] })),
    otDays: normalisedOt,
    signedByEmployee,
    signedByProjectManager,
    notes: [] as string[],
  };
}

export type ManualSheetData = ReturnType<typeof buildManualSheet>;

/** ตัวอ่านไฟล์ปลอมสำหรับงานป้อนมือ — เสียบแทน extractTimesheet() ใน ingestTimesheet() */
export function manualExtractor(data: ManualSheetData) {
  return async () => ({
    data,
    verification: { ok: true, issues: [] as Array<{ severity: string; message: string }> },
    usage: { input_tokens: 0, output_tokens: 0 },
    model: 'manual',
  });
}
