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
import { LineClient, buildOverdueReminderFlex, EMPLOYEE_QUICK_REPLY } from './lineClient.js';

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
