/**
 * ตรวจ Manday — ported from src/service.js (`listTimesheets`, `shapeTimesheetRow`, `getTimesheet`,
 * `rejectTimesheet`, `markTimesheetChecked`, `recomputeTimesheet`), rewritten against Prisma.
 *
 * Deferred (per MIGRATION_PLAN.md):
 * - the matching report (name/position/rate cross-check against employee aliases) and the HRDD
 *   leave comparison — both stay out of scope for the review UI itself (matching is used inside
 *   the ingest pipeline in `ingestService.ts`, just not surfaced as its own report here).
 * - the LINE/FlowAccount side effects `markTimesheetChecked` triggers in the original (requesting
 *   cycle approval) — that belongs to the billing-cycle phase, not the review step itself.
 */
import { prisma } from '@obs/db';
import { SEVERITY, calculateManday, thaiMonth, thaiDate } from '@obs/domain';
import { checkStamp, getCycleStatus, type CheckStamp } from './dashboardService.js';
import { logAudit } from './audit.js';
import { holidayMap } from './masterData.js';

const STATUS_LABEL: Record<string, string> = {
  received: 'รับเข้าระบบ',
  extracted: 'อ่านข้อมูลแล้ว',
  verified: 'ตรวจผ่าน',
  mismatch: 'ข้อมูลไม่ตรง',
  approved: 'อนุมัติแล้ว',
  billed: 'วางบิลแล้ว',
  rejected: 'ตีกลับให้แก้ไข',
};

const LEAVE_TH: Record<string, string> = {
  sick: 'ลาป่วย',
  personal: 'ลากิจ',
  vacation: 'ลาพักร้อน',
  unpaid: 'ลาไม่รับค่าจ้าง',
};

export interface TimesheetListItem {
  id: string;
  period: string;
  periodLabel: string;
  receivedAt: string;
  sourceFile: string | null;
  status: string;
  statusLabel: string;
  statusReason: string | null;
  employee: {
    id: string | null;
    nameTh: string | null;
    nameEn: string | null;
    invoicePosition: string | null;
    monthlyRate: number | null;
    quotationNo: string | null;
  };
  rawEmployeeName: string | null;
  rawPosition: string | null;
  reportedWorkDays: number | null;
  reportedLeave: number | null;
  contract: { id: string; poNo: string; contractNo: string | null; projectName: string; customerName: string };
  invoiceNo: string | null;
  invoiceStatus: string | null;
  check: CheckStamp;
  payableDays: number | null;
  discount: number | null;
  lineAmount: number | null;
  checks: Array<{ id: string; severity: string; title: string; detail: string }>;
  standardWorkingDays: number | null;
  dailyRate: number | null;
  leaveDatesText: string;
  approvedByLabel: string | null;
}

async function shapeTimesheetRow(row: any): Promise<TimesheetListItem> {
  const computed: any = row.computed ?? null;

  const assignment = row.employeeId
    ? await prisma.assignment.findUnique({
        where: { contractId_employeeId: { contractId: row.contractId, employeeId: row.employeeId } },
      })
    : null;

  const invoice = await prisma.invoice.findUnique({
    where: { contractId_period: { contractId: row.contractId, period: row.period } },
  });

  return {
    id: row.id,
    period: row.period,
    periodLabel: thaiMonth(row.period),
    receivedAt: row.receivedAt,
    sourceFile: row.sourceFile,
    status: row.status,
    statusLabel: STATUS_LABEL[row.status] ?? row.status,
    statusReason: row.statusReason,
    employee: {
      id: row.employeeId,
      nameTh: row.employee?.nameTh ?? null,
      nameEn: row.employee?.nameEn ?? null,
      invoicePosition: row.employee?.invoicePosition ?? null,
      monthlyRate: assignment?.monthlyRate ?? null,
      quotationNo: assignment?.quotationNo ?? null,
    },
    rawEmployeeName: row.rawEmployeeName,
    rawPosition: row.rawPosition,
    reportedWorkDays: row.reportedWorkdays,
    reportedLeave: row.reportedLeave,
    contract: {
      id: row.contractId,
      poNo: row.contract.poNo,
      contractNo: row.contract.contractNo,
      projectName: row.contract.projectName,
      customerName: row.contract.customer.nameTh,
    },
    invoiceNo: invoice?.documentNo ?? null,
    invoiceStatus: invoice?.status ?? null,
    check: await checkStamp(row.id, computed),
    payableDays: computed?.payableDays ?? null,
    discount: computed?.discount ?? null,
    lineAmount: computed?.lineAmount ?? null,
    checks: computed?.checks ?? [],
    standardWorkingDays: computed?.standardWorkingDays ?? null,
    dailyRate: computed?.dailyRate ?? null,
    leaveDatesText: (computed?.leaveDays ?? [])
      .map((l: any) => `${thaiDate(l.date)}${LEAVE_TH[l.type] ? ` (${LEAVE_TH[l.type]})` : ''}`)
      .join(', '),
    approvedByLabel: row.approvedBy ?? null,
  };
}

export interface TimesheetListResult {
  items: TimesheetListItem[];
  counts: { needsReview: number; checked: number; all: number; billed: number; rejected: number };
}

export async function listTimesheets({ contractId }: { contractId?: string } = {}): Promise<TimesheetListResult> {
  const rows = await prisma.timesheet.findMany({
    where: contractId ? { contractId } : undefined,
    include: { employee: true, contract: { include: { customer: true } } },
    orderBy: { receivedAt: 'desc' },
  });

  const items = await Promise.all(rows.map(shapeTimesheetRow));

  const counts = {
    all: items.length,
    billed: items.filter((i) => i.status === 'billed').length,
    rejected: items.filter((i) => i.status === 'rejected').length,
    checked: items.filter((i) => i.check.checked && i.status !== 'billed' && i.status !== 'rejected').length,
    needsReview: items.filter(
      (i) => i.status !== 'billed' && i.status !== 'rejected' && !i.check.checked,
    ).length,
  };

  return { items, counts };
}

export interface TimesheetDetail extends TimesheetListItem {
  approvedAt: string | null;
  sourceEmailId: string | null;
  sourceEmailSubject: string | null;
  extraction: any;
  manday: any;
  leaveDays: Array<{ date: string; leaveType: string }>;
  dayLabels: Array<{
    date: string;
    dayOfWeek: string | null;
    project: string | null;
    label: string | null;
    type: string | null;
    timeIn: string | null;
    timeOut: string | null;
    otTimeIn: string | null;
    otTimeOut: string | null;
    jobDesc: string | null;
    remark: string | null;
    normalHours: number | null;
    otHours: number | null;
    totalHours: number | null;
  }>;
  contractDetail: {
    customerId: string;
    taxId: string;
    billingPlace: string | null;
    contactName: string | null;
    divisorMode: string;
    divisorValue: number;
    startDate: string;
    endDate: string;
    creditDays: number;
    vatRate: number;
    whtRate: number;
  };
  audit: Array<{ at: string; actor: string; action: string; detail: any }>;
}

export async function getTimesheet(id: string): Promise<TimesheetDetail | null> {
  const row = await prisma.timesheet.findUnique({
    where: { id },
    include: { employee: true, contract: { include: { customer: true } } },
  });
  if (!row) return null;

  const base = await shapeTimesheetRow(row);

  const [leave, dayLabels, auditRows] = await Promise.all([
    prisma.leaveDay.findMany({ where: { timesheetId: id }, orderBy: { date: 'asc' } }),
    prisma.timesheetDay.findMany({ where: { timesheetId: id }, orderBy: { date: 'asc' } }),
    prisma.auditLog.findMany({
      where: { entityType: 'timesheet', entityId: id },
      orderBy: { id: 'asc' },
    }),
  ]);

  return {
    ...base,
    approvedAt: row.approvedAt,
    sourceEmailId: row.sourceEmailId,
    sourceEmailSubject: row.sourceEmailSubject,
    extraction: row.extraction ?? null,
    manday: row.computed ?? null,
    leaveDays: leave.map((l) => ({ date: l.date, leaveType: l.leaveType })),
    dayLabels,
    contractDetail: {
      customerId: row.contract.customerId,
      taxId: row.contract.customer.taxId,
      billingPlace: row.contract.customer.billingPlace,
      contactName: row.contract.customer.contactName,
      divisorMode: row.contract.divisorMode,
      divisorValue: row.contract.divisorValue,
      startDate: row.contract.startDate,
      endDate: row.contract.endDate,
      creditDays: row.contract.creditDays,
      vatRate: row.contract.vatRate,
      whtRate: row.contract.whtRate,
    },
    audit: auditRows.map((a) => ({
      at: a.at,
      actor: a.actor,
      action: a.action,
      detail: a.detail ? JSON.parse(a.detail) : null,
    })),
  };
}

export class TimesheetActionError extends Error {
  status: number;
  blockers?: string[];
  constructor(message: string, status: number, blockers?: string[]) {
    super(message);
    this.status = status;
    this.blockers = blockers;
  }
}

/** ported from service.js rejectTimesheet() — LINE push to the employee is deferred (Phase 4). */
export async function rejectTimesheet(id: string, { actor, reason }: { actor: string; reason?: string }) {
  const existing = await prisma.timesheet.findUnique({ where: { id } });
  if (!existing) throw new TimesheetActionError(`ไม่พบ Timesheet ${id}`, 404);

  await prisma.timesheet.update({
    where: { id },
    data: { status: 'rejected', statusReason: reason ?? null, updatedAt: new Date().toISOString() },
  });
  await logAudit({ actor, action: 'reject_timesheet', entityType: 'timesheet', entityId: id, detail: { reason: reason ?? null } });
  return getTimesheet(id);
}

/** ported from service.js markTimesheetChecked() — the cycle-approval-request/LINE cascade after a
 * successful check is deferred to the billing-cycle phase (Phase 2 of MIGRATION_PLAN.md). */
export async function markTimesheetChecked(id: string, { actor }: { actor: string }) {
  const sheet = await getTimesheet(id);
  if (!sheet) throw new TimesheetActionError(`ไม่พบ Timesheet ${id}`, 404);

  if (!sheet.manday) {
    throw new TimesheetActionError('ยังไม่ได้คำนวณ Manday — กดคำนวณก่อนจึงจะยืนยันได้', 400);
  }
  if (sheet.status === 'rejected') {
    throw new TimesheetActionError('ใบนี้ถูกตีกลับไปแล้ว ต้องได้ฉบับแก้ไขก่อน', 409);
  }

  const failures = (sheet.manday.checks ?? []).filter((c: any) => c.severity === SEVERITY.FAIL);
  if (failures.length) {
    throw new TimesheetActionError(
      `ยังยืนยันไม่ได้ ตรวจไม่ผ่าน ${failures.length} ข้อ: ${failures.map((f: any) => f.title).join(' · ')}`,
      409,
      failures.map((f: any) => f.title),
    );
  }

  await logAudit({
    actor,
    action: 'human_checked',
    entityType: 'timesheet',
    entityId: id,
    detail: {
      lineAmount: sheet.manday.lineAmount,
      payableDays: sheet.manday.payableDays,
      discount: sheet.manday.discount,
      warnings: (sheet.manday.checks ?? []).filter((c: any) => c.severity === SEVERITY.WARN).length,
    },
  });

  return getTimesheet(id);
}

/** ported from service.js recomputeTimesheet() — re-runs calculateManday() against the
 * timesheet's current stored day/leave/OT rows and the employee's current assignment rate,
 * then re-checks the two orchestration-level rules (contract period, cycle completeness) the
 * original adds on top of calculateManday()'s own 8 checks. */
export async function recomputeTimesheet(id: string, { actor = 'system' }: { actor?: string } = {}) {
  const row = await prisma.timesheet.findUnique({ where: { id }, include: { contract: true } });
  if (!row) throw new TimesheetActionError(`ไม่พบ Timesheet ${id}`, 404);

  const assignment = row.employeeId
    ? await prisma.assignment.findUnique({
        where: { contractId_employeeId: { contractId: row.contractId, employeeId: row.employeeId } },
      })
    : null;

  const [leave, dayLabels, overtime] = await Promise.all([
    prisma.leaveDay.findMany({ where: { timesheetId: id } }),
    prisma.timesheetDay.findMany({ where: { timesheetId: id }, select: { date: true, label: true } }),
    prisma.overtimeDay.findMany({ where: { timesheetId: id } }),
  ]);

  const holidays = await holidayMap(row.contract.customerId);

  const manday: any = calculateManday({
    period: row.period,
    monthlyRate: assignment?.monthlyRate ?? 0,
    reportedWorkDays: row.reportedWorkdays ?? 0,
    leaveDays: leave.map((l) => ({ date: l.date, type: l.leaveType })),
    otDays: overtime.map((o) => ({ date: o.date, hours: o.hours })),
    holidays,
    divisor: { mode: row.contract.divisorMode as any, value: row.contract.divisorValue },
    reportedDayLabels: dayLabels.map((d) => ({ date: d.date, label: d.label ?? undefined })),
  });

  const periodStart = manday.calendar.firstDate;
  const periodEnd = manday.calendar.lastDate;
  const inContract = periodStart >= row.contract.startDate && periodEnd <= row.contract.endDate;
  manday.checks.push(
    inContract
      ? {
          id: 'contract_period',
          severity: SEVERITY.PASS,
          title: 'รอบบิลอยู่ในช่วงสัญญา',
          detail: `${thaiDate(periodStart)} – ${thaiDate(periodEnd)} อยู่ในช่วง ${thaiDate(row.contract.startDate)} – ${thaiDate(row.contract.endDate)}`,
        }
      : {
          id: 'contract_period',
          severity: SEVERITY.FAIL,
          title: 'รอบบิลอยู่นอกช่วงสัญญา',
          detail: `${thaiDate(periodStart)} – ${thaiDate(periodEnd)} ไม่อยู่ในช่วง ${thaiDate(row.contract.startDate)} – ${thaiDate(row.contract.endDate)}`,
        },
  );

  const cycle = await getCycleStatus(row.contractId, row.period);
  manday.checks.push(
    cycle.complete
      ? {
          id: 'cycle_complete',
          severity: SEVERITY.PASS,
          title: 'Timesheet ครบทุกคนในใบว่าจ้าง',
          detail: `ได้รับ ${cycle.received}/${cycle.expected} คน`,
        }
      : {
          id: 'cycle_complete',
          severity: SEVERITY.WARN,
          title: 'ยังได้ Timesheet ไม่ครบทุกคน',
          detail: `ได้รับ ${cycle.received}/${cycle.expected} คน — ${cycle.missing.join(', ')} ยังไม่ส่ง`,
        },
  );

  const ok = manday.checks.every((c: any) => c.severity !== SEVERITY.FAIL);
  const status = ok ? 'verified' : 'mismatch';
  const reason = ok
    ? null
    : manday.checks.filter((c: any) => c.severity === SEVERITY.FAIL).map((c: any) => c.title).join(' · ');

  await prisma.timesheet.update({
    where: { id },
    data: {
      computed: { ...manday, ok },
      status,
      statusReason: reason,
      updatedAt: new Date().toISOString(),
    },
  });

  await logAudit({
    actor,
    action: 'recompute_manday',
    entityType: 'timesheet',
    entityId: id,
    detail: {
      payableDays: manday.payableDays,
      discount: manday.discount,
      status,
      failures: manday.checks.filter((c: any) => c.severity === SEVERITY.FAIL).map((c: any) => c.id),
    },
  });

  return { ...manday, ok, status };
}
