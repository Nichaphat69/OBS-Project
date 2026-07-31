/**
 * ประกอบข้อมูล Timesheet จากที่คนกรอกด้วยมือ
 *
 * ระบบตั้งใจให้ใช้งานแบบ manual ได้เต็มรูปแบบก่อน แล้วค่อยต่อ n8n ทีหลัง
 * ตัวนี้จึงคืนโครงข้อมูลหน้าตาเดียวกับที่ Claude อ่านจาก PDF ออกมา
 * เพื่อให้ไหลผ่าน ingestTimesheet() ตัวเดิมได้ทั้งเส้น — จับคู่ชื่อ · ตรวจปฏิทิน ·
 * ตรวจ Manday 8 แบบ · คิดส่วนลด — ไม่ต้องเขียนตรรกะซ้ำและไม่มีทางคิดต่างกัน
 *
 * คนกรอกแค่ 4 อย่าง: เลขเอกสาร · ชื่อกับตำแหน่งตามที่เขียนในใบ · รอบเดือน · วันที่ลา
 * ตารางรายวันทั้งเดือนระบบสร้างเองจากปฏิทิน ไม่ต้องนั่งกรอก 31 แถว
 */

import { buildMonth, DAY_KIND } from './calendar.js';

/** ประเภทการลาที่รับ — ตรงกับที่ AI อ่านออกมาจากใบจริง */
export const LEAVE_TYPES = ['sick', 'personal', 'vacation', 'other'];

const LEAVE_LABEL = {
  sick: 'Sick leave',
  personal: 'Personal leave',
  vacation: 'Annual leave',
  other: 'Leave',
};

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @param {object} input
 * @param {string} input.employeeName   ชื่อตามที่เขียนในใบ (ยังไม่ต้องตรงกับฐานข้อมูล)
 * @param {string} input.position       ตำแหน่งตามที่เขียนในใบ
 * @param {string} input.period         'YYYY-MM'
 * @param {Array}  [input.leaveDays]    [{ date, type }]
 * @param {Map}    [input.holidays]     ปฏิทินวันหยุด date → ชื่อวันหยุด
 * @param {boolean}[input.signedByEmployee]
 * @param {boolean}[input.signedByProjectManager]
 * @param {string} [input.clientName]
 * @param {string} [input.projectName]
 * @returns {object} โครงข้อมูลเดียวกับผลของ extractTimesheet()
 */
export function buildManualSheet({
  employeeName,
  position,
  period,
  leaveDays = [],
  holidays = new Map(),
  signedByEmployee = true,
  signedByProjectManager = true,
  clientName = null,
  projectName = null,
}) {
  const errors = [];

  if (!employeeName?.trim()) errors.push('ต้องกรอกชื่อพนักงานตามที่เขียนในใบ Timesheet');
  if (!position?.trim()) errors.push('ต้องกรอกตำแหน่งตามที่เขียนในใบ Timesheet');
  if (!PERIOD_RE.test(period ?? '')) errors.push('รอบเดือนต้องเป็นรูปแบบ YYYY-MM เช่น 2026-01');

  /* ตรวจวันลาให้ครบก่อน แล้วรายงานทีเดียว ไม่ใช่หยุดที่ข้อผิดแรก
     คนกรอกจะได้แก้รอบเดียวจบ ไม่ต้องยิงซ้ำหลายรอบเพื่อไล่เจอปัญหาทีละข้อ */
  const seen = new Set();
  const normalised = [];
  for (const raw of leaveDays) {
    const date = typeof raw === 'string' ? raw : raw?.date;
    const type = (typeof raw === 'string' ? 'other' : raw?.type) ?? 'other';

    if (!DATE_RE.test(date ?? '')) {
      errors.push(`วันที่ลา "${date ?? ''}" ไม่ใช่รูปแบบ YYYY-MM-DD`);
      continue;
    }
    if (!date.startsWith(`${period}-`)) {
      errors.push(`วันที่ลา ${date} ไม่ได้อยู่ในรอบ ${period}`);
      continue;
    }
    if (!LEAVE_TYPES.includes(type)) {
      errors.push(`ประเภทการลา "${type}" ไม่รู้จัก — ใช้ได้: ${LEAVE_TYPES.join(', ')}`);
      continue;
    }
    if (seen.has(date)) {
      errors.push(`วันที่ลา ${date} ถูกกรอกซ้ำ`);
      continue;
    }
    seen.add(date);
    normalised.push({ date, type });
  }

  if (errors.length) {
    throw Object.assign(new Error(errors[0]), { status: 400, errors });
  }

  /* สร้างตารางรายวันจากปฏิทินจริง — วันหยุดสุดสัปดาห์ วันหยุดนักขัตฤกษ์
     และวันลาถูกกำหนดจากที่นี่ที่เดียว จึงเป็นชุดข้อมูลเดียวกับที่ตัวตรวจ Manday ใช้ */
  const month = buildMonth(period, holidays, seen);

  const days = month.days.map((d) => {
    if (d.kind === DAY_KIND.WORKDAY) {
      return {
        date: d.date, timeIn: '8:30', timeOut: '17:00',
        label: null, jobDescription: 'งานตามที่ได้รับมอบหมาย',
      };
    }
    const leave = normalised.find((l) => l.date === d.date);
    return {
      date: d.date, timeIn: null, timeOut: null,
      label: d.kind === DAY_KIND.WEEKEND ? 'Weekend'
        : d.kind === DAY_KIND.HOLIDAY ? (d.label ?? 'Holiday')
          : LEAVE_LABEL[leave?.type ?? 'other'],
      jobDescription: null,
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
    leaveDays: normalised.map((l) => ({
      date: l.date, type: l.type, rawLabel: LEAVE_LABEL[l.type],
    })),
    signedByEmployee,
    signedByProjectManager,
    notes: [],
  };
}

/**
 * ตัวอ่านไฟล์ปลอมสำหรับงานป้อนมือ — เสียบแทน extractTimesheet() ใน ingestTimesheet()
 * ตั้ง model เป็น 'manual' เพื่อให้บันทึกการทำงานแยกออกจากที่ AI อ่านได้ชัด
 */
export function manualExtractor(data) {
  return async () => ({
    data,
    verification: { ok: true, issues: [] },
    usage: { input_tokens: 0, output_tokens: 0 },
    model: 'manual',
  });
}
