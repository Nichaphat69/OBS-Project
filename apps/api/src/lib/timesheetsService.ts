/**
 * ตรวจ Manday — ported from src/service.js (`listTimesheets`, `shapeTimesheetRow`, `getTimesheet`,
 * `rejectTimesheet`, `markTimesheetChecked`, `recomputeTimesheet`), rewritten against Prisma.
 *
 * Deferred (per MIGRATION_PLAN.md):
 * - the matching report (name/position/rate cross-check against employee aliases) and the HRDD
 *   leave comparison — both stay out of scope for the review UI itself (matching is used inside
 *   the ingest pipeline in `ingestService.ts`, just not surfaced as its own report here).
 */
import { prisma } from '@obs/db';
import { SEVERITY, calculateManday, thaiMonth, thaiDate, round2 } from '@obs/domain';
import { checkStamp, getCycleStatus, type CheckStamp } from './dashboardService.js';
import { logAudit } from './audit.js';
import { holidayMap } from './masterData.js';
import { LineClient, buildRejectedFlex } from './lineClient.js';
import { uploadLink } from './timesheetSubmissionService.js';

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
  /** เหมือน leaveDatesText แต่แยกเป็นรายวัน — หน้ารายการโชว์เป็นกล่องข้อความแยกทีละวันแทนที่จะ
   * รวมเป็นบรรทัดเดียวคั่นด้วยจุลภาค (18 ก.ย. 69 ตามที่เจ้าของระบบขอ: อ่านยากเมื่อลาหลายวันในเดือนเดียว) */
  leaveDates: Array<{ date: string; type: string; label: string }>;
  approvedByLabel: string | null;
  /** เครื่องอ่านที่ผลิตตัวเลขในแถวนี้ รูปแบบ `<engine>[:<skill/แม่แบบ>][ · คนยืนยัน]`
   * อยู่ในก้อน extraction อยู่แล้ว ดึงขึ้นมาเป็นฟิลด์เดี่ยวเพราะหน้ารายการต้องกวาดดูทั้งตารางว่า
   * ใบไหนอ่านด้วยเจ้าไหน (ไม่ส่ง extraction ทั้งก้อนมา จะหนักโดยไม่จำเป็น) */
  readModel: string | null;
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
    leaveDates: (computed?.leaveDays ?? []).map((l: any) => ({
      date: l.date,
      type: l.type,
      label: LEAVE_TH[l.type] ?? l.type,
    })),
    approvedByLabel: row.approvedBy ?? null,
    readModel: (row.extraction as any)?.model ?? null,
  };
}

export interface TimesheetListResult {
  items: TimesheetListItem[];
  counts: { needsReview: number; checked: number; all: number; billed: number; rejected: number };
}

/** ช่องที่ shapeTimesheetRow() ใช้จริง — ระบุเป็น select ไม่ใช่ include เฉยๆ ไม่ให้ลากคอลัมน์ที่หน้า
 * รายการไม่ได้ใช้มาทุกครั้งที่เปิดหน้า (เดิมตัวที่หนักคือ `source_file_bytes` ที่เก็บไฟล์ PDF ทั้งไฟล์ —
 * วัดจาก DB dev ได้ 6 แถว = 1.3 MB · ตอนนี้ไฟล์ย้ายไป storage แล้ว เหลือแค่ที่อยู่ไฟล์)
 * ⚠️ เพิ่มช่องใน shapeTimesheetRow() เมื่อไหร่ ต้องเพิ่มที่นี่ด้วย ไม่งั้นจะได้ undefined เงียบๆ */
const LIST_ROW_SELECT = {
  id: true,
  period: true,
  receivedAt: true,
  sourceFile: true,
  status: true,
  statusReason: true,
  employeeId: true,
  contractId: true,
  rawEmployeeName: true,
  rawPosition: true,
  reportedWorkdays: true,
  reportedLeave: true,
  approvedBy: true,
  computed: true,
  extraction: true,
  employee: true,
  contract: { include: { customer: true } },
} as const;

export async function listTimesheets(
  { contractId, contractIds, employeeId }: { contractId?: string; contractIds?: string[] | null; employeeId?: string | null } = {},
): Promise<TimesheetListResult> {
  // contractIds = ขอบเขตจากตัวกรอง site/PO/พนักงาน (หลายสัญญาได้) · contractId = สัญญาเดียวแบบเดิม
  const ids = contractIds ?? (contractId ? [contractId] : null);
  const rows = await prisma.timesheet.findMany({
    where: {
      ...(ids ? { contractId: { in: ids } } : {}),
      ...(employeeId ? { employeeId } : {}),
    },
    select: LIST_ROW_SELECT,
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
  leaveDays: Array<{ date: string; leaveType: string; hours: number | null }>;
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
  submissionMethod: string | null;
  /** เรียงจากล่าสุดไปเก่าสุด (id มากก่อน) — รวมเหตุการณ์ของใบนี้เอง + ของรอบบิลที่ใบนี้อยู่ (ขออนุมัติ
   * ทางไลน์/สร้างใบแจ้งหนี้/ร่างและส่งเมลวางบิล) ให้เห็น process ตั้งแต่รับเข้าจนวางบิลในที่เดียว */
  audit: Array<{ id: number; at: string; actor: string; action: string; entityType: string | null; detail: any }>;
}

export async function getTimesheet(id: string): Promise<TimesheetDetail | null> {
  const row = await prisma.timesheet.findUnique({
    where: { id },
    // เหตุผลเดียวกับ LIST_ROW_SELECT — หน้ารายละเอียดก็ไม่ได้ใช้ไบต์ของไฟล์ PDF เหมือนกัน
    // (ปุ่มดูไฟล์ยิงไป GET /api/timesheets/:id/file ซึ่งโหลดไบต์เองอยู่แล้ว)
    select: { ...LIST_ROW_SELECT, approvedAt: true, sourceEmailId: true, sourceEmailSubject: true, submissionMethod: true },
  });
  if (!row) return null;

  const base = await shapeTimesheetRow(row);

  const [leave, dayLabels, auditRows] = await Promise.all([
    prisma.leaveDay.findMany({ where: { timesheetId: id }, orderBy: { date: 'asc' } }),
    prisma.timesheetDay.findMany({ where: { timesheetId: id }, orderBy: { date: 'asc' } }),
    prisma.auditLog.findMany({
      where: {
        OR: [
          { entityType: 'timesheet', entityId: id },
          // id ของรอบบิล/ใบแจ้งหนี้ตั้งตามแบบเดียวกับ cyclesService.ts (`${contractId}-${period}`,
          // `INV-${contractId}-${period}`) — ร่างเมลก่อนมีใบแจ้งหนี้ใช้ id แบบรอบบิลแทน
          { entityType: 'cycle', entityId: `${row.contractId}-${row.period}` },
          { entityType: 'invoice', entityId: { in: [`INV-${row.contractId}-${row.period}`, `${row.contractId}-${row.period}`] } },
        ],
      },
      orderBy: { id: 'desc' },
    }),
  ]);

  return {
    ...base,
    approvedAt: row.approvedAt,
    sourceEmailId: row.sourceEmailId,
    sourceEmailSubject: row.sourceEmailSubject,
    submissionMethod: row.submissionMethod,
    extraction: row.extraction ?? null,
    manday: row.computed ?? null,
    leaveDays: leave.map((l) => ({ date: l.date, leaveType: l.leaveType, hours: l.hours })),
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
      id: a.id,
      at: a.at,
      actor: a.actor,
      action: a.action,
      entityType: a.entityType,
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

/** ported from service.js rejectTimesheet() */
export async function rejectTimesheet(
  id: string,
  { actor, reason, client }: { actor: string; reason?: string; client?: LineClient },
) {
  const existing = await prisma.timesheet.findUnique({ where: { id } });
  if (!existing) throw new TimesheetActionError(`ไม่พบ Timesheet ${id}`, 404);

  await prisma.timesheet.update({
    where: { id },
    data: { status: 'rejected', statusReason: reason ?? null, updatedAt: new Date().toISOString() },
  });
  await logAudit({ actor, action: 'reject_timesheet', entityType: 'timesheet', entityId: id, detail: { reason: reason ?? null } });
  // แจ้งพนักงานเจ้าของใบทางไลน์ส่วนตัวทันที (ถ้าผูกบัญชีไว้แล้ว) — ไม่รอผล ไม่ทำให้ตีกลับพัง
  // ถ้าไลน์ส่งไม่สำเร็จ · client ส่งต่อได้เพื่อให้เทสต์ฉีด FakeLineClient แทนได้
  await pushRejectedToEmployee(id, { reason: reason ?? null, client });
  return getTimesheet(id);
}

/** ported from service.js pushEmployeeStatusUpdate() — เฉพาะ kind 'rejected' ซึ่งเป็นเคสเดียวที่
 * ต้นฉบับอัปเกรดเป็น Flex การ์ดพร้อมปุ่ม เพราะเป็นเคสเดียวที่พนักงานต้องลงมือทำอะไรต่อจริง
 * (received/verified ของต้นฉบับเป็นแค่ข้อความแจ้งเฉยๆ และไม่มีจุดไหนในสแต็กนี้เรียกใช้) */
async function pushRejectedToEmployee(
  timesheetId: string,
  { reason, client }: { reason: string | null; client?: LineClient },
): Promise<void> {
  try {
    const sheet = await getTimesheet(timesheetId);
    if (!sheet?.employee?.id) return;
    const employee = await prisma.employee.findUnique({ where: { id: sheet.employee.id } });
    if (!employee?.lineUserId) return;

    const line = client ?? new LineClient();
    const flex = buildRejectedFlex({
      customerName: sheet.contract.customerName,
      projectName: sheet.contract.projectName,
      periodLabel: sheet.periodLabel,
      reason,
      uploadUrl: uploadLink(),
    });
    await line.pushFlexToUser(
      employee.lineUserId,
      `Timesheet รอบ ${sheet.periodLabel} ถูกตีกลับให้แก้ไข`,
      flex,
    );
  } catch { /* แจ้งเสริม พลาดได้ ไม่ต้อง throw ต่อ — ตรงกับต้นฉบับ */ }
}

/** ported from service.js markTimesheetChecked() */
export async function markTimesheetChecked(
  id: string,
  { actor, client }: { actor: string; client?: LineClient },
) {
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

  /* นี่มักเป็นจุดที่รอบบิลครบพอดี — ตอน ingestTimesheet() ครบคน (approve_cycle) ใบล่าสุดที่เพิ่งเข้ามา
     ยังไม่มีใครกดยืนยันเลย เลยติด blocker "ยังไม่มีคนกดยืนยัน" เสมอ ส่งขออนุมัติตอนนั้นจึงไม่มีทางสำเร็จ
     จริง — ต้องรอจนกว่าคนตรวจกด "ยืนยันแล้ว" ครบทุกใบก่อน ซึ่งก็คือตรงนี้ ไม่ต้องรอ n8n cron 09:00
     พรุ่งนี้มาเจอเอง ห่อ try/catch ครอบทั้งก้อน (ไม่ใช่แค่ requestCycleApproval) เพราะ previewCycleInvoice()
     เองก็พังได้ เช่น buildInvoice หาอัตราคิดเงินไม่เจอ — เป็นงานเสริมหลังยืนยันสำเร็จแล้ว พังได้ก็แค่ log
     ไม่ควรทำให้การกดยืนยันใบนี้ล้มไปด้วย · requestCycleApproval() กันส่งซ้ำเองอยู่แล้วถ้ามีคำขอค้าง */
  try {
    // import แบบ dynamic เพราะ cyclesService.ts import getTimesheet จากไฟล์นี้อยู่แล้ว — static import
    // จะกลายเป็นวงกลม
    const { previewCycleInvoice, requestCycleApproval } = await import('./cyclesService.js');
    const preview = await previewCycleInvoice(sheet.contract.id, sheet.period);
    if (preview.invoice && preview.blockers.length === 0) {
      await requestCycleApproval(sheet.contract.id, sheet.period, { actor, client });
    }
  } catch (error: any) {
    // blocker ที่ยังเคลียร์ไม่ครบไม่ใช่ความล้มเหลว — เหตุผลเดียวกับใน ingestService.ts (27 ก.ย. 69)
    if (!Array.isArray(error?.blockers) || error.blockers.length === 0) {
      await logAudit({
        actor: 'system', action: 'request_line_approval_error',
        entityType: 'cycle', entityId: `${sheet.contract.id}-${sheet.period}`, detail: { message: error.message },
      });
    }
  }

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
    leaveDays: leave.map((l) => ({ date: l.date, type: l.leaveType, hours: l.hours })),
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

export interface TimesheetEstimate {
  monthlyRate: number;
  leaveCount: number;
  dailyRate: number;
  discount: number;
  subtotal: number;
  vatRate: number;
  vat: number;
  whtRate: number;
  withholdingTax: number;
  paymentAmount: number;
}

/**
 * ยอดประมาณของ Timesheet ใบเดียวก่อนกดยืนยัน (การ์ดตรวจสอบหน้าอัปโหลด) — คิดด้วยสูตรเดียวกับของจริงทุกขั้น
 * (25 ก.ย. 69 — เดิมการ์ดคิดหัก ณ ที่จ่ายจากเรทรายเดือนดิบๆ ไม่หักวันลา ไม่รวม VAT จนต้องมีหมายเหตุ "ยอดประมาณ
 * ... ยังไม่หักวันลาและยังไม่รวม VAT" ตัวเลขไม่ตรงกับใบแจ้งหนี้จริง): ส่วนลดวันลาจาก calculateManday() ด้วย
 * วันหยุด/ตัวหารของสัญญานี้ แล้วต่อด้วยลำดับเดียวกับ buildInvoice() (VAT และหัก ณ ที่จ่ายคิดจากยอดหลังหักส่วนลด
 * หัก ณ ที่จ่ายปัดเรตเป็น % เต็ม) ไม่รวม OT เพราะการ์ดนี้ไม่มีข้อมูล OT
 */
export async function estimateTimesheetAmount({
  contractId,
  employeeId,
  period,
  leaveDays,
  whtRate,
}: {
  contractId: string;
  employeeId: string;
  period: string;
  leaveDays: Array<{ date: string; type: string; hours?: number | null }>;
  whtRate?: number | null;
}): Promise<TimesheetEstimate | null> {
  if (!/^\d{4}-\d{2}$/.test(period)) return null;
  const assignment = await prisma.assignment.findUnique({
    where: { contractId_employeeId: { contractId, employeeId } },
    include: { contract: true },
  });
  if (!assignment) return null;

  const manday = calculateManday({
    period,
    monthlyRate: assignment.monthlyRate,
    reportedWorkDays: 0,
    // เอาเฉพาะวันลาที่อยู่ในรอบนี้จริงและกรอกวันที่แล้ว — แถวที่ยังพิมพ์ไม่เสร็จไม่ควรทำให้ยอดเพี้ยน
    leaveDays: leaveDays
      .filter((l) => typeof l.date === 'string' && l.date.startsWith(`${period}-`))
      .map((l) => ({ date: l.date, type: l.type as any, hours: l.hours ?? null })),
    holidays: await holidayMap(assignment.contract.customerId),
    divisor: { mode: assignment.contract.divisorMode as any, value: assignment.contract.divisorValue },
  });

  const subtotal = round2(assignment.monthlyRate - manday.discount);
  const vatRate = assignment.contract.vatRate;
  const vat = round2(subtotal * vatRate);
  // ปัดเป็น % เต็มเหมือน buildInvoice() เป๊ะๆ — ยอดที่โชว์ในการ์ดตรวจต้องเท่ากับใบแจ้งหนี้จริงเสมอ สัญญา
  // เก็บเรตละเอียดถึง 0.25% ได้ (25 ก.ย. 69) แต่ FlowAccount ยังออกเอกสารด้วย % เต็ม การปัดจึงอยู่ที่ชั้น
  // คำนวณสองจุดนี้ ไม่ใช่ชั้นเก็บข้อมูล — ดู pctRound ใน apps/web ReviewCard.tsx ที่เตือนผู้ใช้เรื่องนี้
  const wht = Math.round((whtRate ?? assignment.contract.whtRate) * 100) / 100;
  const withholdingTax = round2(subtotal * wht);
  return {
    monthlyRate: assignment.monthlyRate,
    leaveCount: manday.leaveCount,
    dailyRate: manday.dailyRate,
    discount: manday.discount,
    subtotal,
    vatRate,
    vat,
    whtRate: wht,
    withholdingTax,
    paymentAmount: round2(subtotal + vat - withholdingTax),
  };
}
