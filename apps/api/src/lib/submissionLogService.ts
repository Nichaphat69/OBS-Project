/**
 * หน้า "บันทึกการส่ง" — ตอบว่า "รอบบิลนี้ พนักงานคนไหนส่ง Timesheet แล้วหรือยัง ผ่านช่องทางไหน
 * เมื่อไหร่ ตอนนี้อยู่ขั้นไหน" โดยดูย้อนหลังได้ทุกรอบ (สถานะผูกกับ พนักงาน + รอบบิล ไม่ใช่ต่อคน)
 *
 * แยกไฟล์จาก timesheetSubmissionService.ts โดยตั้งใจ — ไฟล์นั้นเป็นฝั่ง "เขียน/แจ้งเตือน"
 * (เลือกช่องทางผ่าน LINE, เตือนคนที่เลยกำหนด) ส่วนไฟล์นี้เป็นฝั่ง "อ่าน" ล้วน
 *
 * ── หลักการสำคัญสองข้อ ────────────────────────────────────────────────────────
 *
 * 1. **สถานะคำนวณจากของจริงเสมอ ไม่เก็บไว้ในตาราง** — ตาราง `timesheet_submissions` เก็บเฉพาะ
 *    ข้อเท็จจริงที่อนุมานเอาเองไม่ได้ (พนักงานเลือกช่องทางไหน กดเลื่อนเมื่อไหร่ ใครตรวจ) ส่วนสถานะ
 *    ที่แสดงคำนวณสดทุกครั้งโดยให้ `timesheets` ชนะเสมอ ถ้าเก็บสถานะไว้แล้วรอให้มีคนมากดอัปเดต
 *    หน้าจอจะโกหกทันทีที่มีคนอัปโหลดไฟล์เข้ามาทางอื่น
 *
 * 2. **รายชื่อมาจากสัญญาที่ active ในรอบนั้น ไม่ใช่จากแถวในตาราง** — ถ้าไล่จากแถวที่มีอยู่ คนที่
 *    เงียบสนิท (ไม่เคยกดอะไรเลย) จะไม่มีแถวและหายไปจากหน้าจอ ทั้งที่เป็นคนที่ต้องตามมากที่สุด
 *
 * ⚠️ ข้อจำกัดที่ต้องรู้ก่อนอ่านตัวเลขในหน้านี้ (ตรวจจริงบนเซิร์ฟเวอร์ 17 ก.ย. 69): ช่องทางที่พนักงาน
 * เลือกจะไหลเข้ามาก็ต่อเมื่อ LINE webhook ชี้มาที่สแต็กนี้ และพนักงานผูกบัญชี LINE แล้วเท่านั้น ตอนนี้
 * webhook ยังชี้สแต็กเก่าและพนักงานผูก LINE 0 คน — `canReceiveLineUpdates` จึงมีไว้แยก "ยืนยันว่ายัง
 * ไม่ส่ง" ออกจาก "ระบบไม่มีทางรู้" ไม่ให้หน้าจอกล่าวหาพนักงานว่าไม่ส่งงานทั้งที่เราแค่ไม่เคยได้ยินอะไร
 */
import { prisma } from '@obs/db';
import { thaiMonth } from '@obs/domain';
import { isoToday, enumeratePeriods } from './dashboardService.js';
import { timesheetDueDate } from './timesheetSubmissionService.js';

/** ตรงกับที่เจ้าของระบบระบุไว้ 5 สถานะ — "ขอเลื่อน" ไม่ใช่สถานะแยก แต่เป็นป้ายบนแถวที่ยังไม่ส่ง */
export type SubmissionStatus = 'not_submitted' | 'submitted' | 'pending_review' | 'confirmed' | 'problem';

/** ช่องทางการส่งมีสามค่าเท่านั้นตามที่เจ้าของระบบย้ำ — LINE ไม่ใช่ช่องทางส่ง และการกดเลื่อนก็ไม่ใช่
 * (คนกดเลื่อนยังไม่ได้เลือกช่องทางเลย ดู deferredAt แทน) */
export type SubmissionMethod = 'self_obs' | 'self_email' | 'proxy_email';

export interface SubmissionLogRow {
  employeeId: string;
  employeeName: string;
  contractId: string;
  customerName: string;
  projectName: string;
  period: string;
  periodLabel: string;
  dueDate: string;
  status: SubmissionStatus;
  method: SubmissionMethod | null;
  methodChosenAt: string | null;
  /** ตอบใน LINE แล้วว่าขอเลื่อน แต่ยังไม่เลือกช่องทาง — ต่างจากเงียบสนิทที่เป็น null */
  deferredAt: string | null;
  actedBy: string | null;
  replyOk: boolean | null;
  replyFailureReason: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  note: string | null;
  timesheetId: string | null;
  timesheetStatus: string | null;
  /** พนักงานคนนี้ผูก LINE แล้วหรือยัง — false แปลว่า "ยังไม่ส่ง" ของแถวนี้เป็นเพราะเราไม่มีทางรู้
   * ไม่ใช่เพราะยืนยันแล้วว่าเขาไม่ส่ง ห้ามเอาไปตามงานโดยไม่ดูค่านี้ */
  canReceiveLineUpdates: boolean;
}

export interface SubmissionLogFilter {
  period?: string | null;
  employeeId?: string | null;
  contractId?: string | null;
  method?: SubmissionMethod | null;
  status?: SubmissionStatus | null;
  /** role 'user' เห็นได้เฉพาะของตัวเอง — บังคับที่ชั้น route ว่าส่งค่าอื่นไม่ได้ */
  restrictToEmployeeId?: string | null;
  today?: string;
}

export interface SubmissionLogResult {
  rows: SubmissionLogRow[];
  summary: Record<SubmissionStatus, number>;
  /** จำนวนแถวที่ระบบไม่มีทางรู้สถานะจริงเพราะพนักงานยังไม่ได้ผูก LINE — แสดงเป็นคำเตือนรวมบนหน้าจอ
   * ได้ ไม่ให้คนอ่านตัวเลข "ยังไม่ส่ง" แล้วเข้าใจว่าทุกคนเงียบจริง */
  unknownDueToNoLineLink: number;
}

const EMPTY_SUMMARY = (): Record<SubmissionStatus, number> => ({
  not_submitted: 0, submitted: 0, pending_review: 0, confirmed: 0, problem: 0,
});

/** timesheet ที่ถูกตีกลับยังนับว่า "ยังไม่ส่ง" — ตรงกับ overdueTimesheets() ที่ใช้เกณฑ์เดียวกันอยู่แล้ว
 * ไม่งั้นสองหน้าจะบอกคนละเรื่องเรื่องคนเดียวกัน */
const REJECTED = 'rejected';

function deriveStatus(
  timesheetStatus: string | null,
  reviewStatus: string | null,
  method: string | null,
): SubmissionStatus {
  // 1. มีไฟล์อยู่ในระบบแล้วชนะทุกอย่าง — ไม่ว่าจะเข้ามาทางไหน หน้าจอต้องสะท้อนทันทีโดยไม่ต้องรอใครกด
  if (timesheetStatus && timesheetStatus !== REJECTED) {
    return timesheetStatus === 'verified' || timesheetStatus === 'billed' ? 'confirmed' : 'pending_review';
  }
  // 2. คนตรวจทำเครื่องหมายว่ามีปัญหาไว้ — ต้องไม่ถูกกลบด้วยการที่พนักงานกดปุ่มใหม่
  if (reviewStatus === 'problem') return 'problem';
  // 3. พนักงานบอกช่องทางแล้วแต่ไฟล์ยังไม่เข้าระบบ = เขาบอกว่าส่งแล้ว (ยังไม่ได้ตรวจ)
  if (method) return 'submitted';
  return 'not_submitted';
}

/**
 * รายการสถานะการส่งต่อ (พนักงาน × รอบบิล)
 *
 * รอบที่นับ = ทุกรอบของสัญญาที่ active ตั้งแต่เริ่มสัญญาจนถึงรอบปัจจุบัน (ไม่รวมรอบอนาคต เพราะยังไม่ถึง
 * กำหนดส่ง การขึ้นว่า "ยังไม่ส่ง" สำหรับเดือนหน้าไม่มีความหมาย)
 */
export async function listTimesheetSubmissions(filter: SubmissionLogFilter = {}): Promise<SubmissionLogResult> {
  const today = filter.today ?? isoToday();
  const currentPeriod = today.slice(0, 7);
  const employeeId = filter.restrictToEmployeeId ?? filter.employeeId ?? null;

  const assignments = await prisma.assignment.findMany({
    where: {
      status: 'active',
      ...(employeeId ? { employeeId } : {}),
      ...(filter.contractId ? { contractId: filter.contractId } : {}),
    },
    include: { contract: { include: { customer: true } }, employee: true },
  });

  // ดึงทีเดียวแล้ว index ไว้ในหน่วยความจำ — ลูปซ้อนกับ query ต่อแถวจะกลายเป็น N+1 ทันทีที่พนักงานเยอะ
  const employeeIds = [...new Set(assignments.map((a) => a.employeeId))];
  const [sheets, submissions] = await Promise.all([
    prisma.timesheet.findMany({ where: { employeeId: { in: employeeIds } }, select: { id: true, employeeId: true, contractId: true, period: true, status: true } }),
    prisma.timesheetSubmission.findMany({ where: { employeeId: { in: employeeIds } } }),
  ]);
  const sheetByKey = new Map(sheets.map((s) => [`${s.employeeId}|${s.contractId}|${s.period}`, s]));
  const submissionByKey = new Map(submissions.map((s) => [`${s.employeeId}|${s.period}`, s]));

  const rows: SubmissionLogRow[] = [];
  for (const a of assignments) {
    for (const period of enumeratePeriods(a.startDate, a.endDate)) {
      if (period > currentPeriod) break;
      if (filter.period && period !== filter.period) continue;

      const sheet = sheetByKey.get(`${a.employeeId}|${a.contractId}|${period}`) ?? null;
      const sub = submissionByKey.get(`${a.employeeId}|${period}`) ?? null;
      const status = deriveStatus(sheet?.status ?? null, sub?.reviewStatus ?? null, sub?.method ?? null);

      rows.push({
        employeeId: a.employeeId,
        employeeName: a.employee.nameTh,
        contractId: a.contractId,
        customerName: a.contract.customer.nameTh,
        projectName: a.contract.projectName,
        period,
        periodLabel: thaiMonth(period),
        dueDate: timesheetDueDate(period),
        status,
        method: (sub?.method as SubmissionMethod | null) ?? null,
        methodChosenAt: sub?.methodChosenAt ?? null,
        deferredAt: sub?.deferredAt ?? null,
        actedBy: sub?.actedBy ?? null,
        replyOk: sub?.replyOk ?? null,
        replyFailureReason: sub?.replyFailureReason ?? null,
        reviewedBy: sub?.reviewedBy ?? null,
        reviewedAt: sub?.reviewedAt ?? null,
        note: sub?.note ?? null,
        timesheetId: sheet?.id ?? null,
        timesheetStatus: sheet?.status ?? null,
        canReceiveLineUpdates: a.employee.lineUserId !== null,
      });
    }
  }

  // กรองหลังคำนวณสถานะ เพราะ status เป็นค่าคำนวณ ไม่มีอยู่ในฐานข้อมูลให้ query ตรงๆ
  const filtered = rows.filter(
    (r) => (!filter.status || r.status === filter.status) && (!filter.method || r.method === filter.method),
  );

  const summary = EMPTY_SUMMARY();
  for (const r of filtered) summary[r.status] += 1;

  return {
    rows: filtered.sort((a, b) => b.period.localeCompare(a.period) || a.employeeName.localeCompare(b.employeeName, 'th')),
    summary,
    unknownDueToNoLineLink: filtered.filter((r) => r.status === 'not_submitted' && !r.canReceiveLineUpdates).length,
  };
}
