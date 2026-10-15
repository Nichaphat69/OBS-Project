/**
 * แดชบอร์ด — ported from src/service.js (`dashboard()`, `monthlySeries()`, `contractCycles()`,
 * `getCycleStatus()`, `listContracts()`, `listTimesheets()` and their small helpers), rewritten
 * against the Prisma client instead of raw SQL. Field shapes match the original's JSON output
 * exactly so the ported Next.js dashboard page renders real data, not invented placeholders.
 *
 * Only what the read-only GET /api/dashboard endpoint needs is ported here — the rest of
 * service.js (timesheet ingestion, billing cycle actions, LINE/Gmail/FlowAccount/HRDD/ABBYY
 * integrations) stays in src/service.js for now, per MIGRATION_PLAN.md.
 */
import { quotationRefLookup } from './scopeService.js';
import { prisma } from '@obs/db';
import { round2, thaiMonth, money, nextPeriod } from '@obs/domain';
import { SUBMISSION_METHOD_LABEL } from './activityFeedService.js';
import { logAudit } from './audit.js';
import { effectiveLockedKeys } from './faLockedFields.js';

// ── สถานะรอบบิล — ported from service.js CYCLE_STATE / CYCLE_STATE_LABEL ──────
export const CYCLE_STATE = {
  AWAITING: 'awaiting',
  PARTIAL: 'partial',
  MISMATCH: 'mismatch',
  CHECKING: 'checking',
  READY: 'ready',
  BILLED: 'billed',
} as const;
export type CycleState = (typeof CYCLE_STATE)[keyof typeof CYCLE_STATE];

export const CYCLE_STATE_LABEL: Record<CycleState, string> = {
  awaiting: 'รอ Timesheet',
  partial: 'ได้ไม่ครบ',
  mismatch: 'ข้อมูลไม่ตรง',
  // 6 ต.ค. 69 เจ้าของระบบสั่ง: คำว่า "รอคนตรวจ" ทุกที่ในระบบต้องเป็น "ตรวจ Manday" (ตรงกับชื่อเมนู/ขั้นตอนที่ 2) — ป้ายนี้เป็น
  // แหล่งเดียวของคำนั้น หน้าจอทุกจุดดึงไปแสดง (การ์ดรอบบิล ตัวกรอง ป้ายสถานะ หน้ารอบบิล แดชบอร์ด)
  checking: 'ตรวจ Manday',
  ready: 'รออนุมัติ',
  billed: 'ออก INV แล้ว',
};

export const STATUS_LABEL: Record<string, string> = {
  received: 'รับเข้าระบบ',
  extracted: 'อ่านข้อมูลแล้ว',
  verified: 'ตรวจผ่าน',
  mismatch: 'ข้อมูลไม่ตรง',
  approved: 'อนุมัติแล้ว',
  billed: 'ออก INV แล้ว',
  rejected: 'ตีกลับให้แก้ไข',
};

const THAI_MONTH_SHORT = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

export function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/** ไล่เดือนตั้งแต่ต้นสัญญาถึงสิ้นสัญญา: '2026-01' … '2026-06' */
export function enumeratePeriods(startIso: string, endIso: string): string[] {
  const out: string[] = [];
  let [year, month] = startIso.split('-').map(Number);
  const [endYear, endMonth] = endIso.split('-').map(Number);
  while (year < endYear || (year === endYear && month <= endMonth)) {
    out.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return out;
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await prisma.setting.findUnique({ where: { key } });
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  const encoded = JSON.stringify(value);
  await prisma.setting.upsert({ where: { key }, create: { key, value: encoded }, update: { value: encoded } });
}

// ── master data ────────────────────────────────────────────

export interface ContractSummary {
  id: string;
  poNo: string;
  poDate: string | null;
  customerId: string;
  customerName: string;
  taxId: string;
  billingPlace: string | null;
  contactName: string | null;
  contactPhone: string | null;
  projectName: string;
  contractNo: string | null;
  startDate: string;
  endDate: string;
  creditDays: number;
  divisorMode: string;
  divisorValue: number;
  vatRate: number;
  whtRate: number;
  abbyySkillId: string | null;
  headcount: number;
  monthlyTotal: number;
  status: string;
  // ฟิลด์จากใบเสนอราคา FlowAccount (5 ต.ค. 69) — null ถ้าสัญญาไม่ได้มาจาก FlowAccount
  zipCode: string | null;
  faReference: string | null;
  quotationDate: string | null;
  priceIncludesVat: boolean;
  salesName: string | null;
  remarks: string | null;
  internalNotes: string | null;
  quotationSubTotal: number | null;
  quotationDiscount: number | null;
  quotationGrandTotal: number | null;
  /** บริษัทของสัญญานี้ผูกกับ FlowAccount แล้วหรือยัง — ถ้าผูกแล้วพนักงาน/เรทแก้เองไม่ได้ ต้องใช้ปุ่ม "ซิงก์จาก FlowAccount" */
  flowaccountLinked: boolean;
  /** ช่องที่ดึงมาจาก FlowAccount — หน้าเว็บล็อกไม่ให้แก้ และ API ปฏิเสธการแก้ (ดู faLockedFields.ts) */
  faLockedFields: string[];
}

/** ported from service.js listContracts() — headcount/monthlyTotal count/sum ALL assignments
 * of the contract regardless of status, matching the original's un-filtered subqueries. Carries
 * the full contract + customer row (not just dashboard-card fields) since this is also the read
 * side of the "ข้อมูลหลัก → ลูกค้า & สัญญา" master-data tab (5.5.6). */
export async function listContracts(): Promise<ContractSummary[]> {
  const contracts = await prisma.contract.findMany({
    include: { customer: true, assignments: true },
    orderBy: { poDate: 'desc' },
  });
  return contracts.map((c) => ({
    id: c.id,
    poNo: c.poNo,
    poDate: c.poDate,
    customerId: c.customerId,
    customerName: c.customer.nameTh,
    taxId: c.customer.taxId,
    billingPlace: c.customer.billingPlace,
    contactName: c.customer.contactName,
    contactPhone: c.customer.contactPhone,
    projectName: c.projectName,
    contractNo: c.contractNo,
    startDate: c.startDate,
    endDate: c.endDate,
    creditDays: c.creditDays,
    divisorMode: c.divisorMode,
    divisorValue: c.divisorValue,
    vatRate: c.vatRate,
    whtRate: c.whtRate,
    abbyySkillId: c.abbyySkillId,
    headcount: c.assignments.length,
    flowaccountLinked: Boolean(c.customer.flowaccountContactId),
    faLockedFields: effectiveLockedKeys(c.faLockedFields, c.customer),
    zipCode: c.customer.zipCode,
    faReference: c.faReference,
    quotationDate: c.quotationDate,
    priceIncludesVat: c.priceIncludesVat,
    salesName: c.salesName,
    remarks: c.remarks,
    internalNotes: c.internalNotes,
    quotationSubTotal: c.quotationSubTotal,
    quotationDiscount: c.quotationDiscount,
    quotationGrandTotal: c.quotationGrandTotal,
    monthlyTotal: round2(c.assignments.reduce((sum, a) => sum + a.monthlyRate, 0)),
    status: c.status,
  }));
}

/** ported from service.js getActiveContract() — สัญญาที่ "กำลังดำเนินการอยู่" ตอนนี้ มีได้ทีละฉบับ
 * เท่านั้น (ตัวเลือกบริษัทบนแถบบนใช้ค่านี้เป็นค่าเริ่มต้น) */
export async function getActiveContract(): Promise<ContractSummary | null> {
  const contracts = await listContracts();
  return contracts.find((c) => c.status === 'active') ?? null;
}

export class ContractActionError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** ported from service.js setActiveContract() — ตั้ง active ใหม่ → ปิดฉบับเดิมอัตโนมัติในทรานแซกชัน
 * เดียวกัน กันเผลอเปิดสองฉบับพร้อมกัน (มีได้ฉบับเดียวทั้งระบบ) */
export async function setActiveContract(contractId: string, { actor }: { actor: string }): Promise<ContractSummary | undefined> {
  const contract = await prisma.contract.findUnique({ where: { id: contractId } });
  if (!contract) throw new ContractActionError('ไม่พบสัญญานี้', 404);

  await prisma.$transaction([
    prisma.contract.updateMany({ where: { status: 'active', id: { not: contractId } }, data: { status: 'inactive' } }),
    prisma.contract.update({ where: { id: contractId }, data: { status: 'active' } }),
  ]);
  await logAudit({ actor, action: 'set_active_contract', entityType: 'contract', entityId: contractId, detail: {} });
  return (await listContracts()).find((c) => c.id === contractId);
}

/** ported from service.js deactivateContract() — ปิดสัญญาฉบับนี้โดยไม่เปิดฉบับอื่นแทน ปล่อยให้
 * "ไม่มีสัญญา active เลย" ได้ชั่วคราว */
export async function deactivateContract(contractId: string, { actor }: { actor: string }): Promise<ContractSummary | undefined> {
  const contract = await prisma.contract.findUnique({ where: { id: contractId } });
  if (!contract) throw new ContractActionError('ไม่พบสัญญานี้', 404);

  await prisma.contract.update({ where: { id: contractId }, data: { status: 'inactive' } });
  await logAudit({ actor, action: 'deactivate_contract', entityType: 'contract', entityId: contractId, detail: {} });
  return (await listContracts()).find((c) => c.id === contractId);
}

export interface CycleStatus {
  contractId: string;
  period: string;
  expected: number;
  received: number;
  complete: boolean;
  missing: string[];
}

/** การมอบหมายงานชิ้นนี้ครอบคลุมรอบบิลนี้ไหม — เทียบระดับเดือน ('YYYY-MM') เพราะรอบบิลเป็นรายเดือน
 * คนที่เข้ากลางเดือน/ออกกลางเดือนยังถือว่าต้องส่ง Timesheet ของเดือนนั้น */
function assignmentCoversPeriod(a: { startDate: string; endDate: string }, period: string): boolean {
  return a.startDate.slice(0, 7) <= period && period <= a.endDate.slice(0, 7);
}

/**
 * ported from service.js getCycleStatus()
 *
 * ⚠️ ต้องกรองด้วยช่วงวันที่ของการมอบหมายงานเสมอ (18 ก.ย. 69) — เดิมนับพนักงานทุกคนที่ผูกกับสัญญาอยู่
 * ตอนนี้ โดยไม่ดู `assignments.start_date/end_date` เลย ทั้งที่แต่ละคนเข้า-ออกโครงการคนละเดือนกันได้
 * คนที่เพิ่งเข้าเดือน มี.ค. จึงถูกนับว่า "ยังไม่ส่ง Timesheet" ของเดือน ม.ค.-ก.พ. ที่เขายังไม่ได้ทำงานด้วยซ้ำ
 * → `complete` เป็น false ตลอดกาล → ติด blocker "ยังได้ Timesheet ไม่ครบ" ใน previewCycleInvoice()
 * ทำให้ออก INV รอบเก่าไม่ได้เลยทั้งที่ข้อมูลครบแล้วจริง และรายชื่อ `missing` ก็ทวงผิดคน
 *
 * อีกสองจุดที่ถามคำถามเดียวกัน (`overdueTimesheets()` กับหน้า "บันทึกการส่ง") ดูช่วงวันที่อยู่แล้วผ่าน
 * `enumeratePeriods(a.startDate, a.endDate)` — จุดนี้เป็นจุดเดียวที่ตอบไม่ตรงกับอีกสองจุด
 */
export async function getCycleStatus(contractId: string, period: string): Promise<CycleStatus> {
  const active = await prisma.assignment.findMany({
    where: { contractId, status: 'active' },
    include: { employee: true },
  });
  const expected = active.filter((a) => assignmentCoversPeriod(a, period));
  const received = await prisma.timesheet.findMany({
    where: { contractId, period, status: { not: 'rejected' } },
    select: { employeeId: true },
    distinct: ['employeeId'],
  });
  const receivedIds = new Set(received.map((r) => r.employeeId).filter((id): id is string => Boolean(id)));

  return {
    contractId,
    period,
    expected: expected.length,
    received: received.length,
    complete: expected.length > 0 && expected.every((e) => receivedIds.has(e.employeeId)),
    missing: expected.filter((e) => !receivedIds.has(e.employeeId)).map((e) => e.employee.nameTh),
  };
}

export interface CheckStamp {
  checked: boolean;
  stale: boolean;
  at: string | null;
  by: string | null;
}

/** ตราประทับ "คนตรวจแล้ว" — เก็บใน audit_log ไม่ใช่คอลัมน์ในตาราง timesheets (ดูคอมเมนต์เดิมใน
 * service.js) ported as an async audit_log lookup instead of a SQL correlated subquery.
 * Exported — also used by timesheetsService.ts's list/detail views. */
export async function checkStamp(timesheetId: string, computed: any): Promise<CheckStamp> {
  const entry = await prisma.auditLog.findFirst({
    where: { entityType: 'timesheet', entityId: timesheetId, action: 'human_checked' },
    orderBy: { id: 'desc' },
  });
  if (!entry) return { checked: false, stale: false, at: null, by: null };

  let stamped: any = null;
  try { stamped = entry.detail ? JSON.parse(entry.detail) : null; } catch { stamped = null; }

  const stale = Boolean(computed && stamped) && (
    stamped.lineAmount !== computed.lineAmount ||
    stamped.payableDays !== computed.payableDays
  );

  return { checked: !stale, stale, at: entry.at, by: entry.actor };
}

/**
 * เลือก Timesheet ที่ "ใช้งานจริง" หนึ่งใบต่อพนักงานในรอบหนึ่ง — ใบที่ตีกลับ (rejected) ไม่นับเลย และถ้าคนเดียวกันมีหลายใบ
 * (เช่นอัปโหลดซ้ำ ก่อนมีกฎแทนที่ตอนรับเข้า) เอาใบที่ออก INV แล้วก่อน ไม่งั้นใบที่รับล่าสุด
 *
 * ใช้ร่วมกันทุกจุดที่รวมยอด/นับสถานะของรอบบิล (หน้ารอบบิล · แดชบอร์ด · ใบแจ้งหนี้) เพื่อให้ตัวเลขตรงกันหมด — เดิมแต่ละจุดหยิบ
 * ทุกใบมารวมกัน ยอดเลยเบิ้ลและรอบบิลค้าง "กำลังตรวจ" เพราะใบตีกลับไม่มีวันถูกกดยืนยัน (QA BILLING-001, 2 ต.ค. 69)
 */
export function pickOnePerEmployee<T extends { id: string; employeeId: string | null; status: string; receivedAt: string; createdAt: string }>(
  rows: T[],
): { kept: T[]; dropped: T[] } {
  const live = rows.filter((r) => r.status !== 'rejected');
  const best = new Map<string, T>();
  const rank = (t: T) => `${t.status === 'billed' ? '1' : '0'}|${t.receivedAt}|${t.createdAt}|${t.id}`;
  for (const t of live) {
    if (!t.employeeId) continue;
    const cur = best.get(t.employeeId);
    if (!cur || rank(t) > rank(cur)) best.set(t.employeeId, t);
  }
  const kept = live.filter((t) => !t.employeeId || best.get(t.employeeId)?.id === t.id);
  const dropped = live.filter((t) => t.employeeId && best.get(t.employeeId)?.id !== t.id);
  return { kept, dropped };
}

export interface CyclePeriod {
  contractId: string;
  poNo: string;
  customerName: string;
  period: string;
  periodLabel: string;
  state: CycleState;
  stateLabel: string;
  expected: number;
  received: number;
  missing: string[];
  uncheckedCount: number;
  expectedBillDate: string;
  overdueToBill: boolean;
  invoiceNo: string | null;
  documentDate: string | null;
  dueDate: string | null;
  overduePayment: boolean;
  paymentAmount: number | null;
  value: number | null;
}

/**
 * กางทุกเดือนตามสัญญา ไม่ใช่แสดงเฉพาะเดือนที่มี Timesheet เข้ามาแล้ว — ported from
 * service.js contractCycles().
 */
export async function contractCycles(contractId: string, today: string = isoToday()): Promise<CyclePeriod[]> {
  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    include: { customer: true },
  });
  if (!contract) return [];

  const rules = await getSetting('billing_rules', { billOnDayOfNextMonth: 2, requireHumanCheck: true });

  const periods = enumeratePeriods(contract.startDate, contract.endDate);
  const out: CyclePeriod[] = [];

  for (const period of periods) {
    const cycle = await getCycleStatus(contractId, period);
    const sheets = pickOnePerEmployee(
      await prisma.timesheet.findMany({
        where: { contractId, period },
        select: { id: true, status: true, computed: true, employeeId: true, receivedAt: true, createdAt: true },
      }),
    ).kept;

    let unchecked = 0;
    for (const s of sheets) {
      const stamp = await checkStamp(s.id, s.computed);
      if (!stamp.checked) unchecked += 1;
    }

    const invoice = await prisma.invoice.findUnique({
      where: { contractId_period: { contractId, period } },
    });

    let state: CycleState;
    if (invoice?.status === 'sent_to_flowaccount') state = CYCLE_STATE.BILLED;
    else if (sheets.some((s) => s.status === 'mismatch')) state = CYCLE_STATE.MISMATCH;
    else if (sheets.length === 0) state = CYCLE_STATE.AWAITING;
    else if (!cycle.complete) state = CYCLE_STATE.PARTIAL;
    else if (rules.requireHumanCheck !== false && unchecked > 0) state = CYCLE_STATE.CHECKING;
    else state = CYCLE_STATE.READY;

    const computedValue = sheets.reduce((sum, s) => {
      const c = s.computed as any;
      return sum + (c?.lineAmount ?? 0);
    }, 0);

    const expectedBillDate = `${nextPeriod(period)}-${String(rules.billOnDayOfNextMonth ?? 2).padStart(2, '0')}`;
    const dueDate = invoice?.dueDate ?? null;

    out.push({
      contractId,
      poNo: contract.poNo,
      customerName: contract.customer.nameTh,
      period,
      periodLabel: thaiMonth(period),
      state,
      stateLabel: CYCLE_STATE_LABEL[state],
      expected: cycle.expected,
      received: cycle.received,
      missing: cycle.missing,
      uncheckedCount: unchecked,
      expectedBillDate,
      overdueToBill: state !== CYCLE_STATE.BILLED && expectedBillDate < today,
      invoiceNo: invoice?.documentNo ?? null,
      documentDate: invoice?.documentDate ?? null,
      dueDate,
      overduePayment: Boolean(dueDate && dueDate < today && state === CYCLE_STATE.BILLED),
      paymentAmount: invoice?.paymentAmount ?? null,
      value: state === CYCLE_STATE.BILLED ? invoice!.paymentAmount : computedValue || null,
    });
  }

  return out;
}

export interface EmployeeProgressPeriod {
  period: string;
  periodLabel: string;
  timesheetId: string | null;
  timesheetStatus: string;
  timesheetStatusLabel: string;
  receivedAt: string | null;
  submissionMethod: string | null;
  checkedBy: string | null;
  checkedAt: string | null;
  billed: boolean;
  invoiceStatus: string | null;
  invoiceNo: string | null;
  invoiceCreatedAt: string | null;
  documentDate: string | null;
  dueDate: string | null;
  emailSentAt: string | null;
  paymentAmount: number | null;
  billedBy: string | null;
  billedAt: string | null;
}

export interface EmployeeProgressContract {
  contractId: string;
  poNo: string;
  creditDays: number;
  projectName: string;
  customerName: string;
  periods: EmployeeProgressPeriod[];
}

export interface EmployeeProgress {
  employee: { id: string; nameTh: string; nameEn: string | null; position: string; lineLinked: boolean };
  currentPeriod: string;
  currentPeriodLabel: string;
  contracts: EmployeeProgressContract[];
}

/**
 * ความคืบหน้าของ "ตัวเอง" สำหรับบัญชี role 'user' (พนักงาน) — ported from service.js
 * employeeProgress(). ไม่ใช่ตัวเลขเงิน role นี้ดูได้แค่ progress ของตัวเอง ไม่เห็นยอดเงิน/ของคนอื่นใน
 * สัญญาเดียวกัน เห็นทุกรอบบิลของสัญญาตลอดอายุสัญญา (รวมเดือนที่ออก INV ไปแล้วด้วย) แต่ละรอบมีวันที่/เวลา
 * + ชื่อคนอนุมัติสองขั้น: ตรวจ Manday (จาก audit_log action 'human_checked' ผ่าน checkStamp()) และ
 * ออก INV (จาก invoices.approvedBy/approvedAt)
 */
export async function employeeProgress(employeeId: string): Promise<EmployeeProgress | null> {
  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) return null;

  const currentPeriod = isoToday().slice(0, 7);
  const assignments = await prisma.assignment.findMany({
    where: { employeeId, status: 'active' },
    include: { contract: { include: { customer: true } } },
  });

  // พนักงานกดส่งไฟล์ผ่าน "ส่งผ่านระบบ" แล้ว (submitOwnTimesheetFile()) แต่ยังไม่ผ่านคิวอ่าน/ยืนยันเป็นแถว
  // timesheets จริง — ตั้งใจไม่สร้างแถว timesheets เอง (ดู timesheetSubmissionService.ts) ถ้าไม่เช็คตรงนี้
  // ด้วย หน้านี้จะบอกว่า "ยังไม่ได้ส่ง" ทั้งที่ส่งไปแล้วจริง (เจ้าของระบบเจอจริง 25 ก.ย. 69 — ส่ง Timesheet
  // เดือน มิ.ย. ไปแล้วแต่หน้ายังขึ้นค้างเหมือนไม่เคยส่ง) ใช้ตรรกะเดียวกับ submissionLogService.ts's
  // deriveStatus() ให้หน้า "บันทึกการส่ง" (ฝั่ง admin) กับหน้านี้ (ฝั่งพนักงาน) ไม่โกหกกันเอง
  const submissions = await prisma.timesheetSubmission.findMany({ where: { employeeId } });
  const submissionByPeriod = new Map(submissions.map((s) => [s.period, s]));

  const contracts: EmployeeProgressContract[] = [];
  for (const a of assignments) {
    const periods: EmployeeProgressPeriod[] = [];
    for (const period of enumeratePeriods(a.contract.startDate, a.contract.endDate)) {
      const sheet = await prisma.timesheet.findFirst({ where: { contractId: a.contractId, period, employeeId } });
      const invoice = await prisma.invoice.findUnique({
        where: { contractId_period: { contractId: a.contractId, period } },
      });
      const billed = invoice?.status === 'sent_to_flowaccount';
      const stamp = sheet ? await checkStamp(sheet.id, sheet.computed) : null;

      const sub = submissionByPeriod.get(period) ?? null;
      let timesheetStatus: string;
      let timesheetStatusLabel: string;
      if (sheet) {
        timesheetStatus = sheet.status;
        timesheetStatusLabel = STATUS_LABEL[sheet.status] ?? sheet.status;
      } else if (sub?.reviewStatus === 'problem') {
        timesheetStatus = 'rejected';
        timesheetStatusLabel = 'มีปัญหา ต้องส่งใหม่';
      } else if (sub?.method) {
        timesheetStatus = 'submitted';
        timesheetStatusLabel = 'ส่งแล้ว รอตรวจสอบ';
      } else {
        timesheetStatus = 'not_submitted';
        timesheetStatusLabel = 'ยังไม่ได้ส่ง Timesheet';
      }

      periods.push({
        period,
        periodLabel: thaiMonth(period),
        timesheetId: sheet?.id ?? null,
        timesheetStatus,
        timesheetStatusLabel,
        receivedAt: sheet?.receivedAt ?? null,
        submissionMethod: sheet?.submissionMethod ?? null,
        checkedBy: stamp?.by ?? null,
        checkedAt: stamp?.at ?? null,
        billed,
        invoiceStatus: invoice?.status ?? null,
        invoiceNo: invoice?.documentNo ?? null,
        invoiceCreatedAt: invoice?.createdAt ?? null,
        documentDate: invoice?.documentDate ?? null,
        dueDate: invoice?.dueDate ?? null,
        emailSentAt: invoice?.emailSentAt ?? null,
        paymentAmount: billed ? invoice!.paymentAmount : null,
        billedBy: billed ? invoice!.approvedBy : null,
        billedAt: billed ? invoice!.approvedAt : null,
      });
    }
    periods.sort((x, y) => y.period.localeCompare(x.period)); // ล่าสุดขึ้นก่อน

    contracts.push({
      contractId: a.contractId,
      poNo: a.contract.poNo,
      creditDays: a.contract.creditDays,
      projectName: a.contract.projectName,
      customerName: a.contract.customer.nameTh,
      periods,
    });
  }

  return {
    employee: {
      id: employee.id,
      nameTh: employee.nameTh,
      nameEn: employee.nameEn,
      position: employee.invoicePosition,
      lineLinked: Boolean(employee.lineUserId),
    },
    currentPeriod,
    currentPeriodLabel: thaiMonth(currentPeriod),
    contracts,
  };
}

interface DashboardSheet {
  id: string;
  status: string;
  statusReason: string | null;
  period: string;
  periodLabel: string;
  employeeName: string;
  payableDays: number | null;
  discount: number;
  lineAmount: number | null;
  check: CheckStamp;
  // 1 ต.ค. 69 — ขอบเขตหลายสัญญาพร้อมกัน (ตัวกรอง site/PO/พนักงาน) ต้องบอกได้ว่ารายการเป็นของ site/PO ไหน
  customerName: string;
  poNo: string;
}

/** ported from service.js listTimesheets()/shapeTimesheetRow() — narrowed to only the fields
 * the dashboard endpoint reads (full CRUD timesheet listing stays in src/service.js for now). */
async function listTimesheetsForDashboard(contractIds: string[] | null): Promise<DashboardSheet[]> {
  const rows = await prisma.timesheet.findMany({
    where: contractIds ? { contractId: { in: contractIds } } : undefined,
    include: { employee: true, contract: { include: { customer: true } } },
    orderBy: { receivedAt: 'desc' },
  });

  const out: DashboardSheet[] = [];
  for (const row of rows) {
    const computed = row.computed as any;
    const stamp = await checkStamp(row.id, computed);
    out.push({
      id: row.id,
      status: row.status,
      statusReason: row.statusReason,
      period: row.period,
      periodLabel: thaiMonth(row.period),
      employeeName: row.employee?.nameTh ?? row.rawEmployeeName ?? '—',
      payableDays: computed?.payableDays ?? null,
      discount: computed?.discount ?? 0,
      lineAmount: computed?.lineAmount ?? null,
      check: stamp,
      customerName: row.contract.customer.nameTh,
      poNo: row.contract.poNo,
    });
  }
  return out;
}

interface InvoiceRow {
  contractId: string;
  status: string;
  paymentAmount: number;
}

/** ported from service.js invoiceRows() */
async function invoiceRows(contractIds: string[] | null): Promise<InvoiceRow[]> {
  const rows = await prisma.invoice.findMany({
    where: contractIds ? { contractId: { in: contractIds } } : undefined,
    orderBy: { documentDate: 'desc' },
  });
  return rows.map((r) => ({ contractId: r.contractId, status: r.status, paymentAmount: r.paymentAmount }));
}

interface MonthlySeriesEntry {
  contractId: string;
  period: string;
  periodLabel: string;
  monthShort: string;
  planned: number;
  billed: number;
  pending: number;
  state: CycleState;
}

/** ported from service.js monthlySeries() */
async function monthlySeries(): Promise<MonthlySeriesEntry[]> {
  const out: MonthlySeriesEntry[] = [];
  const contracts = await listContracts();
  for (const contract of contracts) {
    const cycles = await contractCycles(contract.id);
    for (const cycle of cycles) {
      const sheets = await prisma.timesheet.findMany({
        where: { contractId: contract.id, period: cycle.period, status: 'verified' },
        select: { computed: true },
      });
      const pending = round2(
        sheets.reduce((sum, s) => {
          const computed = s.computed as any;
          return sum + (computed?.lineAmount ?? 0);
        }, 0),
      );

      out.push({
        contractId: contract.id,
        period: cycle.period,
        periodLabel: thaiMonth(cycle.period),
        monthShort: THAI_MONTH_SHORT[Number(cycle.period.split('-')[1]) - 1],
        planned: round2(contract.monthlyTotal ?? 0),
        billed: cycle.state === CYCLE_STATE.BILLED ? round2(cycle.paymentAmount ?? 0) : 0,
        pending,
        state: cycle.state,
      });
    }
  }
  return out;
}

/** เปอร์เซ็นต์เปลี่ยนแปลงเทียบเดือนก่อน — null เมื่อเทียบไม่ได้ — ported from service.js trend() */
function trend(current: number, previous: number | null): number | null {
  if (previous === null || previous === undefined || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export interface DashboardResult {
  today: string;
  counts: {
    total: number;
    waitingCheck: number;
    readyToBill: number;
    mismatch: number;
    billed: number;
    rejected: number;
  };
  waitingCheckValue: number;
  readyValue: number;
  leaveDeduction: number;
  invoiceCount: number;
  billedAmount: number;
  series: MonthlySeriesEntry[];
  trends: { billed: number | null; latestPeriodLabel: string | null; previousPeriodLabel: string | null };
  contracts: Array<ContractSummary & {
    monthsTotal: number;
    monthsBilled: number;
    contractValue: number;
    billedValue: number;
    remainingValue: number;
    progress: number;
    periods: CyclePeriod[];
  }>;
  toChase: CyclePeriod[];
  tasks: Array<{ step: number; level: string; title: string; detail: string; link: unknown }>;
  cycles: CyclePeriod[];
  recentSubmissions: Array<{
    id: string;
    at: string;
    employeeName: string;
    customerName: string;
    period: string;
    periodLabel: string;
    method: string | null;
    methodLabel: string | null;
  }>;
}

/**
 * ภาพรวมทั้งระบบ — ported from service.js dashboard(). ไม่ระบุ contractId = รวมทุกสัญญา
 * ระบุ contractId = กรองเหลือแค่สัญญาของ "บริษัทที่กำลังดำเนินการอยู่" ที่เลือกจากแถบบน
 */
export async function dashboard(scope?: string | string[] | null): Promise<DashboardResult> {
  // รับได้ทั้งสัญญาเดียว (ของเดิม) และรายการสัญญา (ตัวกรอง site/PO/พนักงาน) — null = ทุกสัญญา
  const contractIds: string[] | null = Array.isArray(scope) ? scope : scope ? [scope] : null;
  const today = isoToday();
  const sheets = await listTimesheetsForDashboard(contractIds);
  const invoices = await invoiceRows(contractIds);

  const byStatus: Record<string, number> = {};
  for (const sheet of sheets) byStatus[sheet.status] = (byStatus[sheet.status] ?? 0) + 1;

  const waitingCheck = sheets.filter((s) => s.status === 'verified' && !s.check.checked);
  const checkedWaitingBill = sheets.filter((s) => s.status === 'verified' && s.check.checked);
  const leaveDeduction = sheets.reduce((sum, s) => sum + (s.discount ?? 0), 0);

  const allContracts = await listContracts();
  const filteredContracts = allContracts.filter((c) => (contractIds ? contractIds.includes(c.id) : true));

  const contracts = [];
  for (const contract of filteredContracts) {
    const periods = await contractCycles(contract.id, today);
    const billed = periods.filter((p) => p.state === CYCLE_STATE.BILLED);
    const contractValue = round2((contract.monthlyTotal ?? 0) * periods.length);
    const billedValue = round2(billed.reduce((sum, p) => sum + (p.paymentAmount ?? 0), 0));

    contracts.push({
      ...contract,
      monthsTotal: periods.length,
      monthsBilled: billed.length,
      contractValue,
      billedValue,
      remainingValue: round2(contractValue - billedValue),
      progress: periods.length ? Math.round((billed.length / periods.length) * 100) : 0,
      periods,
    });
  }

  const series = (await monthlySeries()).filter((s) => (contractIds ? contractIds.includes(s.contractId) : true));
  const billedSeries = series.filter((s) => s.billed > 0);
  const latest = billedSeries[billedSeries.length - 1] ?? null;
  const previous = billedSeries[billedSeries.length - 2] ?? null;

  const allPeriods = contracts.flatMap((c) => c.periods);
  const toChase = allPeriods
    .filter((p) => p.state === CYCLE_STATE.AWAITING || p.state === CYCLE_STATE.PARTIAL)
    .sort((a, b) => a.period.localeCompare(b.period));

  // ไฟล์ที่พนักงานส่งเองผ่านเว็บ ยังไม่มีใครเปิดอ่าน (แท็บ "รอจากพนักงาน" หน้าอัปโหลด) — กรองตามสัญญาด้วย
  // assignment ของพนักงานคนนั้นที่ครอบรอบนั้น (กติกาเดียวกับ contractForEmployeeSubmit ใน aiReadsService.ts)
  const employeeFiles = await prisma.aiRead.findMany({
    where: { source: 'employee_submit', status: 'pending' },
    include: { employee: true },
    orderBy: { readAt: 'desc' },
  });
  const employeeFileTasks = [];
  for (const f of employeeFiles) {
    if (contractIds) {
      if (!f.employeeId || !f.period) continue;
      const inContract = await prisma.assignment.findFirst({
        where: { employeeId: f.employeeId, contractId: { in: contractIds }, status: 'active', startDate: { lte: `${f.period}-01` }, endDate: { gte: `${f.period}-01` } },
        select: { employeeId: true },
      });
      if (!inContract) continue;
    }
    employeeFileTasks.push({
      step: 1, level: 'info',
      title: 'Timesheet เข้ามาใหม่ รอเปิดตรวจ',
      detail: `${f.employee?.nameTh ?? f.employeeName ?? '—'}${f.period ? ` รอบ ${thaiMonth(f.period)}` : ''} — ส่งไฟล์ ${f.fileName}`,
      link: { view: 'employeeQueue' },
    });
  }

  /* "งานที่ต้องทำ" = งานที่ลงมือได้เลยตอนนี้ เรียงตามลำดับขั้น แต่ละแถวกดเปิดเข้าไปทำต่อได้ (25 ก.ย. 69 ตามที่ขอ
     "แสดงเฉพาะงานที่ต้องทำล่าสุด เช่น พนักงานคนนี้ส่ง Timesheet มาแล้ว เข้าไปเปิดตรวจ, พนักงานคนนี้ รอบบิลนี้
     รอตรวจ Manday หรือรออนุมัติออก INV สามารถกดเข้าไปตรวจได้เลย") — เดิม "รอ Timesheet" ขึ้นก่อนและนับรวม
     รอบในอนาคตด้วย (ก.ย. ยังไม่จบก็ทวง ต.ค.–ธ.ค. แล้ว) จนงานจริงจมหายอยู่ท้ายรายการ ตอนนี้ทวงเฉพาะรอบที่ถึง
     เดือนแล้ว และย้ายไปท้ายสุด ล่าสุดขึ้นก่อน */
  const currentPeriod = today.slice(0, 7);
  const refOf = await quotationRefLookup(); // ชื่อเรียกสัญญาในงานที่ต้องทำ: QT… ถ้ามี ไม่งั้น PO
  const tasks = [
    ...employeeFileTasks,
    ...sheets
      .filter((s) => s.status === 'mismatch')
      .map((s) => ({
        step: 2, level: 'critical',
        title: 'Timesheet ตรวจไม่ผ่าน',
        detail: `${s.employeeName} · ${s.customerName} · ${refOf(s.poNo, s.customerName)} · รอบ ${s.periodLabel} — ${s.statusReason ?? 'ข้อมูลไม่ตรงปฏิทิน'}`,
        link: { view: 'detail', id: s.id },
      })),
    ...waitingCheck.map((s) => ({
      step: 2, level: 'warn',
      title: 'รอตรวจ Manday',
      detail: `${s.employeeName} · ${s.customerName} · ${refOf(s.poNo, s.customerName)} · รอบ ${s.periodLabel} — ${money(s.lineAmount ?? 0)} บาท`,
      link: { view: 'detail', id: s.id },
    })),
    ...allPeriods
      .filter((p) => p.state === CYCLE_STATE.READY)
      .sort((a, b) => b.period.localeCompare(a.period))
      .map((p) => ({
        step: 3, level: 'info',
        title: 'รออนุมัติออก INV',
        detail: `${p.customerName} · ${refOf(p.poNo, p.customerName)} · รอบ ${p.periodLabel} — ตรวจและยืนยันครบ ${p.received}/${p.expected} คนแล้ว`,
        link: { view: 'cycle', contractId: p.contractId, period: p.period },
      })),
    // รอ Timesheet — บอกจำนวน (ส่งแล้ว/ทั้งหมด) + รายชื่อคนที่ยังไม่ส่งตรงๆ (เจ้าของระบบสั่ง 24 ก.ย. 69)
    // ไม่ใส่ link เพราะยังไม่มีหน้าไหนแสดง "ใครยังไม่ส่งของรอบนี้" ให้กดตรงเข้าไปได้ ข้ามรอบที่ยังไม่มีใคร
    // ถูกมอบหมาย (expected=0) และรอบที่ยังไม่ถึงเดือน
    ...toChase
      .filter((p) => p.expected > 0 && p.period <= currentPeriod)
      .sort((a, b) => b.period.localeCompare(a.period))
      .map((p) => ({
        step: 1, level: 'warn',
        title: 'รอ Timesheet',
        detail: `${p.customerName} · ${refOf(p.poNo, p.customerName)} · รอบ ${p.periodLabel} — ส่งแล้ว ${p.received}/${p.expected} คน${p.missing.length ? ` · ยังไม่ส่ง: ${p.missing.join(', ')}` : ''}`,
        link: null,
      })),
  ];

  // "กิจกรรมล่าสุด" — เดิมดึง audit_log ทั้งระบบดิบๆ (set_active_contract, delete_contract, llm ฯลฯ ของทุก
  // บริษัทปนกัน) เปลี่ยนเป็น "Timesheet ที่เข้ามาในสัญญานี้" ว่าใครส่ง รอบบิลไหน ช่องทางไหน (24 ก.ย. 69
  // ตามที่ขอ "แสดงกิจกรรมของสัญญานี้เท่านั้น ว่ามีพนักงานคนไหนส่ง Timesheet รอบบิลไหนเข้ามาแล้วบ้าง")
  const recentSheets = await prisma.timesheet.findMany({
    where: contractIds ? { contractId: { in: contractIds } } : undefined,
    include: { employee: true, contract: { include: { customer: true } } },
    orderBy: { receivedAt: 'desc' },
    take: 12,
  });
  const recentSubmissions = recentSheets.map((r) => ({
    id: r.id,
    at: r.receivedAt,
    employeeName: r.employee?.nameTh ?? r.rawEmployeeName ?? '—',
    customerName: r.contract.customer.nameTh,
    period: r.period,
    periodLabel: thaiMonth(r.period),
    method: r.submissionMethod,
    methodLabel: r.submissionMethod ? SUBMISSION_METHOD_LABEL[r.submissionMethod] ?? null : null,
  }));

  return {
    today,
    counts: {
      total: sheets.length,
      waitingCheck: waitingCheck.length,
      readyToBill: checkedWaitingBill.length,
      mismatch: byStatus.mismatch ?? 0,
      billed: byStatus.billed ?? 0,
      rejected: byStatus.rejected ?? 0,
    },
    waitingCheckValue: round2(waitingCheck.reduce((sum, s) => sum + (s.lineAmount ?? 0), 0)),
    readyValue: round2(checkedWaitingBill.reduce((sum, s) => sum + (s.lineAmount ?? 0), 0)),
    leaveDeduction: round2(leaveDeduction),
    invoiceCount: invoices.length,
    billedAmount: round2(
      invoices
        .filter((i) => i.status === 'sent_to_flowaccount')
        .reduce((sum, i) => sum + i.paymentAmount, 0),
    ),
    series,
    trends: {
      billed: trend(latest?.billed ?? 0, previous?.billed ?? null),
      latestPeriodLabel: latest?.periodLabel ?? null,
      previousPeriodLabel: previous?.periodLabel ?? null,
    },
    contracts,
    toChase,
    tasks,
    cycles: [...allPeriods].sort((a, b) => b.period.localeCompare(a.period)),
    recentSubmissions,
  };
}
