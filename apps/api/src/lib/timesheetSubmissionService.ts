/**
 * เลือกช่องทางส่ง Timesheet + เตือน Timesheet ยังไม่ส่ง — ported from service.js's
 * `pendingSubmissionFor`/`overdueTimesheets`/`sendOverdueTimesheetReminders`/`timesheetDueDate`.
 *
 * `handleTimesheetMethodPostback` (the `tsmethod:` postback handler) lives in
 * lineWebhookService.ts alongside handleTicketPostback, matching that file's existing shape.
 *
 * Important divergence from ingestion: choosing a method here (self_obs/self_email/proxy_email/
 * snooze) writes **only an audit_log row** — it never touches `timesheets.submission_method` or
 * creates a timesheet row. It's pure employee intent, informational to accounting via LINE push.
 * `overdueTimesheets()` keeps re-deriving from real `timesheets` rows every run regardless of what
 * method was chosen, exactly like the original (see service.js's own comment on this).
 */
import { prisma } from '@obs/db';
import { addDays, nextPeriod, thaiMonth, thaiDate } from '@obs/domain';
import { isoToday, enumeratePeriods } from './dashboardService.js';
import { logAudit } from './audit.js';
import { recordSubmissionResponse } from './submissionRecordService.js';
import {
  LineClient,
  buildOverdueReminderFlex,
  buildTimesheetEmailConfirmFlex,
  buildTimesheetProxyConfirmFlex,
  buildTimesheetMethodNotifyFlex,
  EMPLOYEE_QUICK_REPLY,
} from './lineClient.js';
import { lineApproverTargets, notificationEmailTargets } from './notificationRecipientsService.js';
import { storeFile } from './fileStorage.js';

/** ported from service.js appBase()/uploadLink() — WEB_BASE_URL คือของสแต็กใหม่ (Next.js web app)
 * แยกจาก APP_BASE_URL เดิมซึ่งชี้ไปที่แอปเก่า (คนละพอร์ต/คนละหน้า) ไม่ตั้งไว้ = ไม่มีลิงก์ในการ์ด
 * (ลิงก์เสียแย่กว่าไม่มีลิงก์เลย — เหมือนต้นฉบับ) */
export function webBase(): string | null {
  const base = process.env.WEB_BASE_URL;
  return base ? base.replace(/\/+$/, '') : null;
}

function uploadLink(): string | null {
  const base = webBase();
  return base ? `${base}/upload` : null;
}

/** ported from service.js myProgressLink() — ลิงก์แนบท้ายการ์ดตอบคำสั่ง "สถานะ" ให้กดดูรายละเอียด
 * ทุกรอบที่ผ่านมาต่อได้ (การ์ดเองโชว์ได้แค่รอบปัจจุบัน) */
function myProgressLink(): string | null {
  const base = webBase();
  return base ? `${base}/my-progress` : null;
}

/** ported from service.js timesheetDueDate() — กำหนดส่งเดียวกันทุกคน: วันสุดท้ายของเดือน + 3 วัน */
export function timesheetDueDate(period: string): string {
  const lastDayOfMonth = addDays(`${nextPeriod(period)}-01`, -1);
  return addDays(lastDayOfMonth, 3);
}

export interface PendingSubmission {
  contractId: string;
  customerName: string;
  projectName: string;
  period: string;
  periodLabel: string;
  dueDate: string;
}

/** ported from service.js pendingSubmissionFor() — รอบที่เก่าที่สุดที่ยังไม่มีแถว timesheets เลย
 * (ไม่นับ "ตีกลับ" ว่าค้าง — ต่างจาก overdueTimesheets() ที่นับตีกลับด้วย) ของสัญญาแรกที่เจอ ไม่สนวันครบ
 * กำหนด (ส่งล่วงหน้าได้) */
export async function pendingSubmissionFor(employeeId: string): Promise<PendingSubmission | null> {
  const assignments = await prisma.assignment.findMany({
    where: { employeeId, status: 'active' },
    include: { contract: { include: { customer: true } } },
  });

  for (const a of assignments) {
    const periods = enumeratePeriods(a.contract.startDate, a.contract.endDate);
    for (const period of periods) {
      const sheet = await prisma.timesheet.findFirst({ where: { contractId: a.contractId, employeeId, period } });
      if (!sheet) {
        return {
          contractId: a.contractId,
          customerName: a.contract.customer.nameTh,
          projectName: a.contract.projectName,
          period,
          periodLabel: thaiMonth(period),
          dueDate: thaiDate(timesheetDueDate(period)),
        };
      }
    }
  }
  return null;
}

/**
 * รอบบิลที่พนักงานเลือกเองจากหน้าอัปโหลด ส่งได้จริงไหม — กติกาเดียวกับกลุ่ม "ต้องลงมือ" ในหน้า
 * "ความคืบหน้าของฉัน" (bucketOf() ใน MyProgressClient.tsx) ให้สองหน้าบอกตรงกัน (25 ก.ย. 69 ตามที่ขอ
 * "role พนักงาน ต้องมีการเลือกเดือนหรือรอบบิลก่อน ถึงจะส่ง Timesheet ได้ ให้สอดคล้องกับหน้าความคืบหน้าของฉัน"):
 * ต้องเป็นสัญญาที่ตัวเองถูกมอบหมายอยู่ รอบอยู่ในอายุสัญญา ไม่ใช่เดือนในอนาคต ยังไม่ออก INV และยังไม่มี
 * Timesheet เข้าระบบ (หรือมีแต่ถูกตีกลับ)
 */
export async function submittablePeriodFor(employeeId: string, contractId: string, period: string): Promise<PendingSubmission> {
  const assignment = await prisma.assignment.findFirst({
    where: { employeeId, contractId, status: 'active' },
    include: { contract: { include: { customer: true } } },
  });
  if (!assignment) throw new SubmitOwnFileError('คุณไม่ได้อยู่ในสัญญานี้ เลือกรอบบิลใหม่', 400);
  if (!enumeratePeriods(assignment.contract.startDate, assignment.contract.endDate).includes(period)) {
    throw new SubmitOwnFileError('รอบบิลนี้ไม่อยู่ในอายุสัญญา เลือกรอบบิลใหม่', 400);
  }
  if (period > isoToday().slice(0, 7)) throw new SubmitOwnFileError('รอบบิลนี้ยังไม่ถึงกำหนดส่ง', 400);

  const invoice = await prisma.invoice.findUnique({ where: { contractId_period: { contractId, period } } });
  if (invoice?.status === 'sent_to_flowaccount') throw new SubmitOwnFileError('รอบบิลนี้ออก INV ไปแล้ว ส่งเพิ่มไม่ได้', 409);
  const sheet = await prisma.timesheet.findFirst({ where: { contractId, employeeId, period }, select: { status: true } });
  if (sheet && sheet.status !== 'rejected') throw new SubmitOwnFileError('รอบบิลนี้มี Timesheet เข้าระบบแล้ว', 409);

  return {
    contractId,
    customerName: assignment.contract.customer.nameTh,
    projectName: assignment.contract.projectName,
    period,
    periodLabel: thaiMonth(period),
    dueDate: thaiDate(timesheetDueDate(period)),
  };
}

/** 8 MB — ให้ต่ำกว่าเพดาน express.json ('15mb') อย่างมีระยะ เพราะ base64 พองขึ้นราว 1 ใน 3
 * ไฟล์ 8 MB จะกลายเป็น payload ~10.7 MB ซึ่งยังผ่าน ถ้าปล่อยถึง 15 MB จะโดนตัดตั้งแต่ชั้น body parser
 * แล้วคนกดส่งจะเห็นแค่ error ดิบๆ ที่ไม่ได้บอกว่าไฟล์ใหญ่เกิน */
const MAX_SUBMIT_BYTES = 8 * 1024 * 1024;

export class SubmitOwnFileError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export interface SubmitOwnFileResult {
  period: string;
  periodLabel: string;
  customerName: string;
  projectName: string;
  fileName: string;
  fileId: number;
}

/**
 * พนักงานส่งไฟล์ Timesheet ของตัวเองเข้าระบบ — **เก็บไฟล์ + บันทึกว่าส่งแล้วเท่านั้น ไม่อ่านด้วย OCR**
 *
 * ต่างจากเส้นของฝั่งที่ทำบิล (`POST /api/timesheets/read`) ตรงที่ไม่แตะ ABBYY/Clear Read เลย และ
 * ไม่สร้างแถว `timesheets` — พนักงานมีหน้าที่ "ส่ง" อย่างเดียว ส่วนการอ่านไฟล์/ตรวจ Manday ยังเป็น
 * งานของ admin เหมือนเดิม (เจ้าของระบบสั่ง 18 ก.ย. 69: "เวลาที่ user เพิ่มไฟล์ Timesheet แล้ว
 * จะเป็นการส่งอย่างเดียว")
 *
 * ผลที่ตามมาโดยตั้งใจ: หน้า "บันทึกการส่ง" จะขึ้นสถานะ "ส่งแล้ว" ช่องทาง "ส่งผ่านระบบ OBS" ทันที
 * แต่ยังไม่เข้าคิวตรวจ Manday จนกว่า admin จะเอาไฟล์ไปอ่าน — ตรงกับความจริงว่ามีแค่ไฟล์ ยังไม่มีตัวเลข
 *
 * ไฟล์ผูกกับแถว `ai_reads` (ไม่ใช่ `timesheets`) เพราะแถว `timesheets`
 * ต้องมีการจับคู่ชื่อพนักงาน/รอบ/สัญญาครบก่อน ซึ่งยังไม่มีข้อมูลพวกนั้นเลยตอนนี้ — และเส้นดาวน์โหลด
 * `GET /api/ai-reads/:id/file` กันสิทธิ์ตาม employeeId ให้อยู่แล้ว พนักงานจึงเปิดดูของตัวเองได้ทันที
 */
export async function submitOwnTimesheetFile({
  employeeId,
  actor,
  fileName,
  fileBase64,
  contractId,
  period,
}: {
  employeeId: string;
  actor: string;
  fileName: string;
  fileBase64: string;
  /** รอบที่พนักงานเลือกเอง — ไม่ส่งมา = ถอยไปใช้รอบเก่าสุดที่ค้าง (pendingSubmissionFor) แบบเดิม */
  contractId?: string | null;
  period?: string | null;
}): Promise<SubmitOwnFileResult> {
  const cleanName = String(fileName ?? '').trim();
  if (!cleanName) throw new SubmitOwnFileError('ไม่พบชื่อไฟล์');

  const bytes = Buffer.from(String(fileBase64 ?? ''), 'base64');
  if (bytes.length === 0) throw new SubmitOwnFileError('ไฟล์ว่างหรืออ่านไม่ได้ ลองเลือกไฟล์ใหม่');
  if (bytes.length > MAX_SUBMIT_BYTES) throw new SubmitOwnFileError('ไฟล์ใหญ่เกิน 8 MB');

  const pending = contractId && period ? await submittablePeriodFor(employeeId, contractId, period) : await pendingSubmissionFor(employeeId);
  if (!pending) throw new SubmitOwnFileError('ตอนนี้ไม่มีรอบบิลที่ต้องส่ง', 409);
  const employee = await prisma.employee.findUnique({ where: { id: employeeId }, select: { nameTh: true } });

  const now = new Date().toISOString();
  const fileKey = await storeFile('ai-read', bytes, { fileName: cleanName });
  const saved = await prisma.aiRead.create({
    data: {
      // แยกจาก 'upload'/'gmail' ให้ชัด — สองค่านั้นแปลว่า "ผ่านเครื่องอ่านมาแล้ว" ส่วนค่านี้คือไฟล์ดิบ
      // ที่ยังไม่มีใครอ่าน ถ้าใช้ค่าเดิมปนกัน จะแยกไม่ออกว่าแถวไหนอ่านแล้วแถวไหนแค่ส่งมา
      source: 'employee_submit',
      fileName: cleanName,
      employeeId,
      // เก็บชื่อไว้ด้วย — ทุกจุดที่แสดงแถว ai_reads อ่านจาก employeeName (ดู listAiReads ใน aiReadsService.ts)
      employeeName: employee?.nameTh ?? null,
      period: pending.period,
      fileKey,
      readAt: now,
      readBy: actor,
    },
    select: { id: true },
  });

  await recordSubmissionResponse({
    employeeId,
    period: pending.period,
    contractId: pending.contractId,
    method: 'self_obs',
  });

  /* recordSubmissionResponse() กลืน error ไว้โดยตั้งใจ เพราะออกแบบมาให้เส้น LINE ห้ามล้ม (ดูหัวไฟล์
     submissionRecordService.ts) — แต่ที่นี่เป็นการตอบกลับคนที่เพิ่งกดส่ง ถ้าปล่อยตามนั้นจะกลายเป็น
     "จอขึ้นว่าส่งแล้ว แต่ไม่มีอะไรถูกบันทึก" ซึ่งเป็นบั๊กเงียบแบบที่ระบบนี้โดนมาหลายรอบ จึงอ่านกลับมา
     ยืนยันว่าเขียนลงจริง ไม่เชื่อแค่ว่าเรียกผ่าน */
  const written = await prisma.timesheetSubmission.findUnique({
    where: { employeeId_period: { employeeId, period: pending.period } },
    select: { method: true },
  });
  if (written?.method !== 'self_obs') {
    throw new SubmitOwnFileError('เก็บไฟล์ได้แล้วแต่บันทึกสถานะการส่งไม่สำเร็จ — แจ้งผู้ดูแลระบบ', 500);
  }

  await logAudit({
    actor,
    action: 'employee_submitted_timesheet_file',
    entityType: 'employee',
    entityId: employeeId,
    detail: { period: pending.period, fileName: cleanName, bytes: bytes.length, aiReadId: saved.id },
  });

  return {
    period: pending.period,
    periodLabel: pending.periodLabel,
    customerName: pending.customerName,
    projectName: pending.projectName,
    fileName: cleanName,
    fileId: saved.id,
  };
}

export interface OverdueItem {
  employeeId: string;
  employeeName: string;
  lineUserId: string | null;
  contractId: string;
  customerName: string;
  projectName: string;
  period: string;
  periodLabel: string;
  dueDate: string;
}

/** ported from service.js overdueTimesheets() — รอบที่เลยกำหนดส่งแล้วและยังไม่มี timesheet ที่ไม่ใช่
 * "ตีกลับ" (แถวตีกลับยังนับว่า "ยังไม่ส่ง" — ต่างจาก pendingSubmissionFor) */
export async function overdueTimesheets({ today = isoToday() }: { today?: string } = {}): Promise<OverdueItem[]> {
  const assignments = await prisma.assignment.findMany({
    where: { status: 'active' },
    include: { contract: { include: { customer: true } }, employee: true },
  });

  const out: OverdueItem[] = [];
  for (const a of assignments) {
    const periods = enumeratePeriods(a.startDate, a.endDate);
    for (const period of periods) {
      const dueDate = timesheetDueDate(period);
      if (dueDate > today) break;

      const sheet = await prisma.timesheet.findFirst({
        where: { employeeId: a.employeeId, contractId: a.contractId, period, status: { not: 'rejected' } },
      });
      if (sheet) continue;

      out.push({
        employeeId: a.employeeId,
        employeeName: a.employee.nameTh,
        lineUserId: a.employee.lineUserId,
        contractId: a.contractId,
        customerName: a.contract.customer.nameTh,
        projectName: a.contract.projectName,
        period,
        periodLabel: thaiMonth(period),
        dueDate,
      });
    }
  }
  return out;
}

export interface ReminderResult {
  today: string;
  checked: number;
  sent: number;
  skipped: Array<OverdueItem & { reason: string }>;
}

/** ported from service.js sendOverdueTimesheetReminders() — ไม่มีการจำสถานะ "เตือนไปแล้ว" เลย
 * รันใหม่ทุกครั้งจะไล่ซ้ำทั้งหมดจนกว่าจะมีแถว timesheets จริง (n8n เรียกทุกวัน) */
export async function sendOverdueTimesheetReminders({ today = isoToday(), client }: { today?: string; client?: LineClient } = {}): Promise<ReminderResult> {
  const items = await overdueTimesheets({ today });
  const line = client ?? new LineClient();
  const skipped: Array<OverdueItem & { reason: string }> = [];
  let sent = 0;

  for (const item of items) {
    if (!item.lineUserId) {
      skipped.push({ ...item, reason: 'ยังไม่ได้ผูกบัญชีไลน์' });
      continue;
    }
    try {
      const flex = buildOverdueReminderFlex({
        customerName: item.customerName,
        projectName: item.projectName,
        periodLabel: item.periodLabel,
        dueDate: thaiDate(item.dueDate),
        contractId: item.contractId,
        period: item.period,
      });
      await line.pushFlexToUser(item.lineUserId, `Timesheet รอบ ${item.periodLabel} ยังไม่ส่ง`, flex, EMPLOYEE_QUICK_REPLY);
      await logAudit({ actor: 'system', action: 'notify_overdue_timesheet', entityType: 'employee', entityId: item.employeeId, detail: { period: item.period, dueDate: item.dueDate } });
      sent += 1;
    } catch (error: any) {
      skipped.push({ ...item, reason: error.message });
      await logAudit({ actor: 'system', action: 'notify_overdue_timesheet_error', entityType: 'employee', entityId: item.employeeId, detail: { period: item.period, message: error.message } });
    }
  }

  return { today, checked: items.length, sent, skipped };
}

export { uploadLink, myProgressLink };

export interface DeclareMethodResult {
  method: 'self_email' | 'proxy_email';
  period: string;
  periodLabel: string;
  customerName: string;
  projectName: string;
  /** ปลายทางอีเมลที่ฝ่ายบัญชีตั้งไว้ — โชว์ให้พนักงานเห็นว่าควรส่งไปที่ไหน (กรณี self_email) */
  emailTargets: string[];
}

/**
 * พนักงานแจ้งจากหน้าเว็บว่ารอบนี้ "ส่งทางอีเมลแล้ว" หรือ "ให้ผู้ดูแลเป็นคนส่ง" (25 ก.ย. 69 ตามที่ขอ
 * "ถ้าส่งด้วยวิธีการอื่นแล้ว เช่น ส่งผ่านอีเมลแล้ว ... หรือมีการให้ผู้ดูแลส่งให้ ให้สอดคล้องกับการแจ้งเตือนใน line")
 *
 * ทำเหมือนกดปุ่ม "ส่งผ่าน Email"/"ให้ผู้ดูแลเป็นคนส่ง" บนการ์ดเตือนในไลน์ทุกอย่าง (handleTimesheetMethodPostback
 * ใน lineWebhookService.ts) — บันทึกช่องทางลง timesheet_submissions (หน้า "บันทึกการส่ง" เห็นเหมือนกัน),
 * แจ้งฝ่ายบัญชี/admin ทางไลน์ด้วยการ์ดใบเดียวกัน และส่งการ์ดยืนยันใบเดียวกันเข้าไลน์ของพนักงานเอง (ถ้าผูกไว้)
 * ไฟล์ไม่ได้มาทางเส้นนี้ — ไม่สร้างแถว timesheets ฝ่ายบัญชีกรอกเข้าระบบเองเมื่อได้รับอีเมล/ส่งแทน
 * ส่งไลน์ไม่สำเร็จไม่ทำให้การบันทึกล้ม (เหมือนเส้นไลน์) แค่เก็บ audit ไว้ตามย้อนได้
 */
export async function declareOwnSubmissionMethod({
  employeeId,
  actor,
  contractId,
  period,
  method,
  client,
}: {
  employeeId: string;
  actor: string;
  contractId: string;
  period: string;
  method: 'self_email' | 'proxy_email';
  client?: LineClient;
}): Promise<DeclareMethodResult> {
  if (method !== 'self_email' && method !== 'proxy_email') throw new SubmitOwnFileError('เลือกวิธีส่งให้ถูกต้อง');
  const target = await submittablePeriodFor(employeeId, contractId, period);
  const employee = await prisma.employee.findUnique({ where: { id: employeeId }, select: { nameTh: true, lineUserId: true } });
  if (!employee) throw new SubmitOwnFileError('ไม่พบพนักงาน', 404);

  await recordSubmissionResponse({ employeeId, period, contractId, method });
  // เหตุผลเดียวกับ submitOwnTimesheetFile — recordSubmissionResponse กลืน error ไว้ อ่านกลับมายืนยันก่อนบอกว่าสำเร็จ
  const written = await prisma.timesheetSubmission.findUnique({
    where: { employeeId_period: { employeeId, period } },
    select: { method: true },
  });
  if (written?.method !== method) throw new SubmitOwnFileError('บันทึกช่องทางการส่งไม่สำเร็จ — แจ้งผู้ดูแลระบบ', 500);

  const line = client ?? new LineClient();
  const emailTargets = method === 'self_email' ? await notificationEmailTargets() : [];

  try {
    const notifyFlex = buildTimesheetMethodNotifyFlex({ employeeName: employee.nameTh, periodLabel: target.periodLabel, method });
    const alt = method === 'proxy_email' ? `ขอมอบหมายส่ง Timesheet แทน — ${employee.nameTh}` : `แจ้งส่ง Timesheet ทางอีเมล — ${employee.nameTh}`;
    await line.pushFlexToAll(notifyFlex, alt, { targets: await lineApproverTargets() });
  } catch (error: any) {
    await logAudit({
      actor: 'system',
      action: method === 'proxy_email' ? 'notify_timesheet_proxy_error' : 'notify_timesheet_self_email_error',
      entityType: 'employee',
      entityId: employeeId,
      detail: { message: error.message },
    });
  }

  if (employee.lineUserId) {
    try {
      if (method === 'self_email') {
        const flex = buildTimesheetEmailConfirmFlex({ customerName: target.customerName, projectName: target.projectName, periodLabel: target.periodLabel, emailTargets });
        await line.pushFlexToUser(employee.lineUserId, 'บันทึกการส่งผ่าน Email เรียบร้อย', flex, EMPLOYEE_QUICK_REPLY);
      } else {
        const flex = buildTimesheetProxyConfirmFlex({ employeeName: employee.nameTh, customerName: target.customerName, projectName: target.projectName, periodLabel: target.periodLabel });
        await line.pushFlexToUser(employee.lineUserId, 'มอบหมายผู้ดูแลระบบเรียบร้อย', flex, EMPLOYEE_QUICK_REPLY);
      }
    } catch {
      /* เงียบไว้เหมือนเส้นไลน์ — บันทึกสำเร็จไปแล้ว หน้าเว็บก็บอกผลเองอยู่แล้ว */
    }
  }

  await logAudit({
    actor,
    action: `timesheet_method_${method}`,
    entityType: 'employee',
    entityId: employeeId,
    detail: { contractId, period, via: 'web' },
  });

  return {
    method,
    period,
    periodLabel: target.periodLabel,
    customerName: target.customerName,
    projectName: target.projectName,
    emailTargets,
  };
}
