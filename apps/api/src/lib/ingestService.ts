/**
 * รับ Timesheet เข้าระบบ — ported from src/service.js `ingestTimesheet()` and
 * `enterTimesheetManually()`, rewritten against Prisma.
 *
 * Simplification vs. the original: the original's `filePath`/`fileBase64` split exists because
 * n8n calls this with a path on its own filesystem while the web upload path sends base64 — this
 * port only supports `fileBytes` directly (from an uploaded file, a decoded `fileBase64`, or none
 * for manual entry). `filePath` isn't supported — n8n and this Dockerized stack don't share a
 * filesystem, so that variant never applies here (see routes/timesheets.ts's public `/ingest`
 * route, Phase 5.6).
 *
 * All LINE notifications the original fires after ingest (`notifyCheckFailed`/`notifyNeedsCheck`)
 * and the auto-triggered `requestCycleApproval` when a cycle completes are now ported (Phase
 * 5.6, alongside the billing-approval gate in cyclesService.ts).
 */
import { prisma } from '@obs/db';
import {
  SEVERITY,
  MATCH,
  matchEmployee,
  checkPosition,
  buildManualSheet,
  manualExtractor,
  thaiMonth,
  type MatchableEmployee,
} from '@obs/domain';
import { recomputeTimesheet } from './timesheetsService.js';
import { getCycleStatus } from './dashboardService.js';
import { employeesForMatching, holidayMap } from './masterData.js';
import { logAudit } from './audit.js';
import { LineClient, buildNeedsCheckFlex, buildCheckFailedFlex } from './lineClient.js';
import { lineApproverTargets } from './notificationRecipientsService.js';
import { requestCycleApproval, queueLink } from './cyclesService.js';
import { pendingSubmissionFor } from './timesheetSubmissionService.js';

/**
 * ข้อ 2.6 — แจ้งทีมบัญชีทาง LINE ทันทีที่ Manday ไม่ผ่านตรวจตอนอ่านไฟล์เข้าระบบ ส่งให้ทุกคนในรายชื่อ
 * ผู้รับแจ้งเตือนช่องทาง LINE (หรือ env ถ้ายังไม่มีใครเพิ่มไว้) — ตั้งใจไม่ให้ error ของ LINE ไปพังการ
 * อ่านไฟล์ที่เพิ่งสำเร็จ จึงจับ error ไว้เอง ไม่โยนต่อ — ported from service.js notifyCheckFailed()
 */
async function notifyCheckFailed({
  documentNo,
  employeeName,
  period,
  failures,
  client,
}: {
  documentNo: string;
  employeeName: string;
  period: string;
  failures: string[];
  client?: LineClient;
}): Promise<void> {
  const line = client ?? new LineClient();
  const targets = await lineApproverTargets();
  const link = queueLink();
  const bubble = buildCheckFailedFlex({
    employeeName,
    periodLabel: thaiMonth(period),
    documentNo,
    failures,
    queueUrl: link,
  });
  const altText = `ตรวจ Manday ไม่ผ่าน — ${employeeName} เอกสาร ${documentNo} ประจำเดือน ${thaiMonth(period)}`;

  try {
    await line.pushFlexToAll(bubble, altText, { targets });
    await logAudit({ actor: 'system', action: 'notify_line_check_failed', entityType: 'timesheet', entityId: documentNo, detail: { failures } });
  } catch (error: any) {
    await logAudit({ actor: 'system', action: 'notify_line_check_failed_error', entityType: 'timesheet', entityId: documentNo, detail: { message: error.message } });
  }
}

/**
 * แจ้งทีมบัญชีทาง LINE ว่ามี Timesheet ใบใหม่รอตรวจ Manday — แจ้งทีละใบต่อการแจ้งเตือนหนึ่งครั้ง —
 * ported from service.js notifyNeedsCheck()
 */
async function notifyNeedsCheck({
  documentNo,
  contractId,
  period,
  client,
}: {
  documentNo: string;
  contractId: string;
  period: string;
  client?: LineClient;
}): Promise<void> {
  const contract = await prisma.contract.findUnique({ where: { id: contractId }, include: { customer: true } });

  const line = client ?? new LineClient();
  const targets = await lineApproverTargets();
  const bubble = buildNeedsCheckFlex({
    customerName: contract?.customer.nameTh ?? '—',
    projectName: contract?.projectName ?? null,
    documentNos: [documentNo],
    periodLabel: thaiMonth(period),
    queueUrl: queueLink(),
  });
  const altText = `ตรวจ Manday — ${contract?.customer.nameTh ?? '—'} เอกสาร ${documentNo} ประจำเดือน ${thaiMonth(period)}`;

  try {
    await line.pushNeedsCheck({ bubbles: [bubble], altText, targets });
    await logAudit({ actor: 'system', action: 'notify_line_needs_check', entityType: 'timesheet', entityId: documentNo, detail: { contractId, period } });
  } catch (error: any) {
    await logAudit({ actor: 'system', action: 'notify_line_needs_check_error', entityType: 'timesheet', entityId: documentNo, detail: { message: error.message } });
  }
}

export const NEXT_ACTION = {
  APPROVE_CYCLE: 'approve_cycle',
  WAIT_FOR_OTHERS: 'wait_for_others',
  FIX_MISMATCH: 'fix_mismatch',
  NEEDS_MATCH: 'needs_match',
  ALREADY_BILLED: 'already_billed',
} as const;

/** หนึ่งแถวรายวัน — คีย์ตรงกับ TIMESHEET_DETAIL_FIELDS ใน @obs/domain (สเปกกลาง Clear Read AI Master
 * Timesheet Template) ยกเว้น 3 ชื่อที่มีอยู่ก่อนสเปกและยังคงชื่อเดิมไว้เพื่อไม่ให้ตัวอ่าน/หน้าจอที่ใช้อยู่
 * พังทั้งระบบ — `dayOfWeek` = สเปก `day`, `remark` = สเปก `remarks`, `type` = สเปก `workType`
 * (ส่วน `label` ไม่มีในสเปก เป็นค่าจัดประเภทวันภายในของเราเอง ใช้คำนวณ manday/ปฏิทิน) */
export interface ExtractedDay {
  date: string;
  dayOfWeek?: string | null;
  project?: string | null;
  timeIn?: string | null;
  timeOut?: string | null;
  otTimeIn?: string | null;
  otTimeOut?: string | null;
  type?: string | null;
  label?: string | null;
  jobDescription?: string | null;
  remark?: string | null;
  normalHours?: number | null;
  otHours?: number | null;
  totalHours?: number | null;
  // เพิ่ม 16 ก.ย. 69 ตามสเปกกลาง — ฟอร์มของลูกค้าบางเจ้า (Fujitsu/Virtual Link/T8) มีช่องพวกนี้จริง
  // ของเดิมอ่านมาได้ก็ตกหล่นหายไปเพราะ type กลางไม่มีที่ให้เก็บ ทุกช่องเป็น optional ตัวอ่านเจ้าไหน
  // ไม่มีก็ปล่อยว่างได้ตามเดิม
  rowNumber?: string | null;
  site?: string | null;
  workLocation?: string | null;
  breakHours?: number | null;
  otBreakHours?: number | null;
  additionalHours?: number | null;
  activity?: string | null;
  leaveType?: string | null;
  leaveDays?: number | null;
}

/** ฟิลด์หัวเอกสาร — คีย์ตรงกับ TIMESHEET_HEADER_FIELDS ใน @obs/domain
 * หมายเหตุ `employeeId` ที่นี่คือ "รหัสพนักงานที่พิมพ์อยู่บนเอกสาร" (เช่น EMP001) ตามสเปกกลาง ไม่ใช่
 * `Employee.id` ภายในระบบเรา — ตอนบันทึกลง DB จึงลงคอลัมน์ `raw_employee_id` ไม่ใช่ `employee_id`
 * (คอลัมน์หลังเป็น FK ที่ได้จากการจับคู่ชื่อ คนละค่ากันคนละที่มา) ดู timesheet.create() ด้านล่าง
 * `period` เป็นค่าที่ normalize แล้วของเราเอง (YYYY-MM) ส่วน `monthYear`/`reportingPeriod` เก็บตามรูป
 * ที่เอกสารเขียนไว้จริงตามกติกาของสเปก ("ห้ามแปลง/ห้ามเดา" — การแปลงเป็นหน้าที่ชั้น normalize) */
export interface ExtractedData {
  employeeName: string;
  position: string;
  period: string;
  totalWorkDays: number;
  totalLeaveDays: number;
  days: ExtractedDay[];
  leaveDays: Array<{ date: string; type: string; rawLabel?: string }>;
  otDays?: Array<{ date: string; hours: number }>;
  signedByEmployee?: boolean;
  signedByProjectManager?: boolean;
  notes?: string[];
  // เพิ่ม 16 ก.ย. 69 ตามสเปกกลาง — mapAbbyyResult() คืน vendor/clientName/projectName มาอยู่แล้วแต่
  // type กลางเดิมไม่มีที่ให้ลง เลยถูกทิ้งทั้งที่อ่านมาได้
  //
  // ⚠️ ตัวอ่านสามในสี่เจ้าคืนช่องนี้ในชื่อ `vendor` (ABBYY, โมเดลในเครื่อง, ป้อนด้วยมือ) มีแต่ Clear Read
  // ที่คืนเป็น `vendorName` ตอนเพิ่มฟิลด์นี้จึงรับไว้ชื่อเดียวแล้วอ่านไม่เจอจากสามเจ้าแรก — ผลคือ
  // `timesheets.vendor_name` เป็น null ทุกแถวตั้งแต่วันที่เพิ่มมา (ตรวจจากข้อมูลจริง 17 ก.ย. 69 พบว่า
  // ว่างทั้ง 6 แถว ทุกเครื่องอ่าน) รับทั้งสองชื่อไว้ที่จุดรวมนี้จุดเดียว จะได้ไม่ต้องไปไล่แก้ตัวอ่านสี่ไฟล์
  // และไม่ทำให้ข้อมูลที่ Clear Read เคยเขียนไว้เสียด้วย
  vendor?: string | null;
  vendorName?: string | null;
  clientName?: string | null;
  projectName?: string | null;
  employeeId?: string | null;
  role?: string | null;
  department?: string | null;
  monthYear?: string | null;
  reportingPeriod?: string | null;
  supervisorName?: string | null;
  approverName?: string | null;
  site?: string | null;
  projectTeam?: string | null;
  /** ช่องสรุปท้ายเอกสาร ตาม TIMESHEET_SUMMARY_FIELDS — "สิ่งที่เอกสารพิมพ์ไว้" ล้วนๆ ว่างได้ถ้าฟอร์มนั้น
   * ไม่มีช่องสรุป (กติกาสเปก: ห้ามนับจากตารางมาเติมให้)
   *
   * ⚠️ จงใจแยกจาก `totalWorkDays`/`totalLeaveDays` ด้านบนที่ชื่อซ้ำกันแต่คนละความหมาย — ตัวด้านบนคือ
   * "ค่าที่ระบบใช้ตั้งบิลจริง" ซึ่งมาจากช่องสรุปถ้ามี ไม่มีก็นับจากตารางรายวันแทน สองค่านี้ตรงกันเกือบทุก
   * ครั้ง และต่างกันพอดีตอนฟอร์มไม่มีช่องสรุป ซึ่งเป็นเคสที่ fallback มีไว้รองรับ ถ้ายุบเป็นค่าเดียวจะแยก
   * ไม่ออกอีกต่อไปว่า "เอกสารบอกมา 19" กับ "เรานับเองได้ 19" ต่างกันตรงไหน — เป็นข้อมูลที่ต้องใช้ตอนไล่
   * เทียบเลขไม่ตรงกันระหว่างแท็บ (เคส Big-C 15 ก.ย. 69 ที่ช่องสรุปบอก 19 แต่นับจากตารางได้ 14) */
  summary?: {
    totalWorkDays?: number | null;
    totalLeaveDays?: number | null;
    totalHours?: number | null;
  };
}

export interface ExtractorResult {
  data: ExtractedData;
  verification: { ok: boolean; issues: Array<{ severity: string; message: string }> };
  usage: unknown;
  model: string;
  /** ใหม่ (15 ก.ย. 69) — raw response ดิบจาก ABBYY ก่อน map (undefined สำหรับ extractor อื่นที่ไม่ใช่
   * ABBYY) เก็บไว้ในนี้เพื่อให้ uploadService.ts's logAiRead() persist ลง ai_reads.extraction ต่อไป —
   * เดิมไม่เก็บอะไรเลย พอเจอบั๊กแล้วต้องไล่หา raw response ย้อนหลังทำไม่ได้ (ต้องไปยิง ABBYY API ตรงๆ
   * เพื่อดู schema ของ Skill แทน) มีไว้ debug รอบต่อไปจะได้เร็วกว่านี้ */
  rawResponse?: unknown;
}

export type Extractor = (
  source: unknown,
  /* แม่แบบ/Skill แยกตามเครื่องอ่าน — ส่งมาทั้งคู่ได้ ตัวที่ถูกเลือกจะหยิบเฉพาะของตัวเองไปใช้
     (ส่งค่าของ ABBYY ให้ Clear Read ใช้ไม่ได้ เป็นคนละระบบกัน) */
  opts: { expectedPeriod?: string; abbyySkillId?: string | null; clearReadTemplateId?: string | null; readerId?: string | null },
) => Promise<ExtractorResult>;

export class IngestError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export interface IngestResult {
  timesheetId: string | null;
  created: boolean;
  replaced?: boolean;
  nextAction: (typeof NEXT_ACTION)[keyof typeof NEXT_ACTION];
  reason?: string;
  extraction?: ExtractedData;
  verification?: unknown;
  matching?: unknown;
  status?: string;
  contractId?: string;
  period?: string;
  employee?: { id: string; nameTh: string; position: string };
  manday?: unknown;
  failures?: string[];
  warnings?: string[];
  cycle?: unknown;
}

/** ported from service.js ingestTimesheet() */
export async function ingestTimesheet({
  documentNo,
  fileBytes = null,
  fileName = null,
  sourceEmailId = null,
  sourceEmailSubject = null,
  receivedAt = new Date().toISOString(),
  approvedBy = null,
  approvedAt = null,
  expectedPeriod,
  actor = 'system',
  extractor,
  submissionMethod = 'self_obs',
  client,
  restrictToEmployeeId = null,
}: {
  documentNo: string;
  fileBytes?: Buffer | null;
  fileName?: string | null;
  sourceEmailId?: string | null;
  sourceEmailSubject?: string | null;
  receivedAt?: string;
  approvedBy?: string | null;
  approvedAt?: string | null;
  expectedPeriod?: string;
  actor?: string;
  extractor: Extractor;
  submissionMethod?: string;
  client?: LineClient;
  /** ใส่ session.employeeId เมื่อ role เป็น 'user' เท่านั้น — บังคับว่าชื่อที่จับคู่ได้ในเอกสารต้องเป็น
   * พนักงานคนนี้เท่านั้น กัน 'user' ส่ง Timesheet แทนคนอื่น (ดูเหตุผลเต็มที่จุดเช็คด้านล่าง) */
  restrictToEmployeeId?: string | null;
}): Promise<IngestResult> {
  if (!documentNo) throw new IngestError('ต้องระบุ documentNo (เลขเอกสาร)');

  const { data, verification, usage, model } = await extractor(fileBytes, { expectedPeriod });

  await logAudit({
    actor: 'llm',
    action: 'extract_timesheet',
    entityType: 'timesheet',
    entityId: documentNo,
    detail: { model, usage, employeeName: data.employeeName, period: data.period, ok: verification.ok, issues: verification.issues.length },
  });

  const employees = await employeesForMatching();
  const nameMatch = matchEmployee(data.employeeName, employees);

  if (nameMatch.match === MATCH.NONE) {
    await logAudit({
      actor,
      action: 'ingest_failed_no_match',
      entityType: 'timesheet',
      entityId: documentNo,
      detail: { rawName: data.employeeName, reason: nameMatch.reason },
    });
    return {
      timesheetId: null,
      created: false,
      nextAction: NEXT_ACTION.NEEDS_MATCH,
      reason: nameMatch.reason,
      extraction: data,
      verification,
      matching: { name: { raw: data.employeeName, ...nameMatch } },
    };
  }

  const employee = nameMatch.employee as MatchableEmployee;
  let period = data.period;

  // ⚠️ ใหม่ (15 ก.ย. 69 ตามที่ user ขอ) — ถ้าไฟล์/Skill ไม่ได้บอกรอบเดือนมาเลย (ABBYY บาง Skill ไม่มี
  // ฟิลด์ Month Year ที่มั่นใจพอ) เดิมจะเอา `${undefined}-01` ไปเทียบหาสัญญาตรงๆ ซึ่งไม่มีทางเจอ พังด้วย
  // ข้อความ "ไม่มีสัญญาที่ครอบคลุมรอบ null" ที่งงๆ — สัญญามี startDate/endDate/divisorValue กำหนดรอบบิล
  // ไว้อยู่แล้วตั้งแต่ตอนสร้าง ไม่ต้องให้ user กรอกซ้ำ ใช้ pendingSubmissionFor() ตัวเดียวกับที่ฝั่ง LINE
  // "ส่ง Timesheet" ใช้อยู่แล้ว (เอารอบเก่าสุดที่ยังไม่มี Timesheet ของสัญญาแรกที่พนักงานคนนี้ยังทำอยู่ —
  // นโยบายเดียวกับที่ตกลงกันไว้แล้วสำหรับ LINE ไม่ใช่ concept ใหม่) มาจับคู่แทนแค่ตอนที่ extraction ไม่รู้
  // รอบเดือนเองเท่านั้น — ถ้า ABBYY อ่านรอบเดือนมาได้ถูกต้องอยู่แล้วไม่แตะเลย
  let autoMatchedPeriod = false;
  if (!period) {
    const pending = await pendingSubmissionFor(employee.id);
    if (pending) {
      period = pending.period;
      autoMatchedPeriod = true;
      data.period = period;
      data.notes = [
        ...(data.notes ?? []),
        `ไม่พบรอบเดือนจากไฟล์ — จับคู่อัตโนมัติกับรอบ ${pending.periodLabel} ของ ${pending.customerName} (รอบเก่าสุดที่ยังไม่ได้ส่ง) ตรวจสอบก่อนยืนยัน`,
      ];
    }
  }

  // ⚠️ เดิมไม่เช็คเลยว่าชื่อที่จับคู่ได้เป็นของคนที่กำลังส่งจริงไหม — role 'user' (พนักงาน) ส่งชื่อคนอื่น
  // เข้ามาทาง "กรอกเอง"/"ยืนยัน" ได้ ระบบจะสร้าง Timesheet ผูกกับพนักงานคนนั้นให้เฉยๆ (เจอจริง 15 ก.ย. 69
  // ตามที่ user ชี้แจงเพิ่มเติม) — ผู้เรียก (route) ต้องส่ง restrictToEmployeeId = req.user.employeeId
  // มาเมื่อ role เป็น 'user' เท่านั้น (role อื่นไม่ผูก จึงส่ง null/undefined ได้ตามปกติ)
  if (restrictToEmployeeId && employee.id !== restrictToEmployeeId) {
    await logAudit({
      actor,
      action: 'ingest_blocked_wrong_employee',
      entityType: 'timesheet',
      entityId: documentNo,
      detail: { rawName: data.employeeName, matchedEmployeeId: employee.id, sessionEmployeeId: restrictToEmployeeId },
    });
    throw new IngestError('ส่ง Timesheet แทนพนักงานคนอื่นไม่ได้ — ชื่อในเอกสารไม่ตรงกับบัญชีของคุณ', 403);
  }

  // ไม่รู้รอบเดือนเลยทั้งจากไฟล์และจาก pendingSubmissionFor() (เช่นพนักงานคนนี้ส่งครบทุกรอบของทุก
  // สัญญาไปแล้ว ไม่มีรอบไหนค้างให้จับคู่เลย) — เดิมโค้ดจะเอา `${undefined}-01` ไปเทียบหาสัญญาต่อเงียบๆ
  // จนพังด้วยข้อความงงๆ "ไม่มีสัญญาที่ครอบคลุมรอบ null" กันไว้ตรงนี้แทนด้วยข้อความที่อธิบายจริง
  if (!period) {
    await logAudit({ actor, action: 'ingest_failed_no_period', entityType: 'timesheet', entityId: documentNo, detail: { employeeId: employee.id } });
    return {
      timesheetId: null,
      created: false,
      nextAction: NEXT_ACTION.NEEDS_MATCH,
      reason: `ไม่พบรอบเดือนจากไฟล์ และหารอบที่ยังไม่ได้ส่งของ ${employee.nameTh} ไม่เจอ (อาจส่งครบทุกรอบแล้ว) — ต้องเลือก "รอบเดือน" เอง`,
      extraction: data,
      verification,
    };
  }

  const assignment = await prisma.assignment.findFirst({
    where: {
      employeeId: employee.id,
      status: 'active',
      startDate: { lte: `${period}-01` },
      endDate: { gte: `${period}-01` },
    },
  });

  if (!assignment) {
    await logAudit({
      actor,
      action: 'ingest_failed_no_contract',
      entityType: 'timesheet',
      entityId: documentNo,
      detail: { employeeId: employee.id, period },
    });
    return {
      timesheetId: null,
      created: false,
      nextAction: NEXT_ACTION.NEEDS_MATCH,
      reason: `${employee.nameTh} ไม่มีสัญญาที่ครอบคลุมรอบ ${period}`,
      extraction: data,
      verification,
    };
  }

  const existing = await prisma.timesheet.findUnique({ where: { id: documentNo } });
  if (existing?.status === 'billed') {
    return {
      timesheetId: documentNo,
      created: false,
      nextAction: NEXT_ACTION.ALREADY_BILLED,
      reason: `เอกสาร ${documentNo} วางบิลไปแล้ว ไม่เขียนทับ`,
    };
  }

  const billedOther = await prisma.timesheet.findFirst({
    where: { contractId: assignment.contractId, employeeId: employee.id, period, id: { not: documentNo }, status: 'billed' },
  });
  if (billedOther) {
    await logAudit({
      actor,
      action: 'ingest_failed_already_billed',
      entityType: 'timesheet',
      entityId: documentNo,
      detail: { employeeId: employee.id, period, existingId: billedOther.id },
    });
    return {
      timesheetId: null,
      created: false,
      nextAction: NEXT_ACTION.ALREADY_BILLED,
      reason:
        `${employee.nameTh} รอบ ${period} วางบิลไปแล้ว (เลขที่ ${billedOther.id}) — ` +
        'ต้องลบใบแจ้งหนี้เดิมที่หน้า "ใบแจ้งหนี้" ก่อน ถึงจะส่ง Timesheet รอบนี้เข้ามาใหม่ได้',
      extraction: data,
      verification,
    };
  }

  const positionCheck = checkPosition(data.position, employee);

  await prisma.$transaction(async (tx) => {
    await tx.leaveDay.deleteMany({ where: { timesheetId: documentNo } });
    await tx.timesheetDay.deleteMany({ where: { timesheetId: documentNo } });
    await tx.overtimeDay.deleteMany({ where: { timesheetId: documentNo } });
    await tx.timesheet.deleteMany({ where: { id: documentNo } });

    await tx.timesheet.create({
      data: {
        id: documentNo,
        contractId: assignment.contractId,
        employeeId: employee.id,
        period,
        sourceEmailId,
        sourceEmailSubject,
        sourceFile: fileName,
        sourceFileBytes: fileBytes ?? undefined,
        receivedAt,
        approvedBy,
        approvedAt: approvedAt ?? (data.signedByProjectManager ? `${period}-28` : null),
        rawEmployeeName: data.employeeName,
        rawPosition: data.position,
        reportedWorkdays: data.totalWorkDays,
        reportedLeave: data.totalLeaveDays,
        // ฟิลด์หัวเอกสารที่เหลือตามสเปกกลาง — ตัวอ่านเจ้าไหนไม่มีก็เป็น null ตามเดิม
        vendorName: data.vendorName ?? data.vendor ?? null,
        clientName: data.clientName ?? null,
        projectName: data.projectName ?? null,
        rawEmployeeId: data.employeeId ?? null,
        role: data.role ?? null,
        department: data.department ?? null,
        monthYear: data.monthYear ?? null,
        reportingPeriod: data.reportingPeriod ?? null,
        supervisorName: data.supervisorName ?? null,
        approverName: data.approverName ?? null,
        site: data.site ?? null,
        projectTeam: data.projectTeam ?? null,
        summaryTotalWorkDays: data.summary?.totalWorkDays ?? null,
        summaryTotalLeaveDays: data.summary?.totalLeaveDays ?? null,
        summaryTotalHours: data.summary?.totalHours ?? null,
        status: 'extracted',
        submissionMethod,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        extraction: {
          source: 'llm',
          model,
          verification,
          positionCheck,
          notes: data.notes ?? [],
          signedByEmployee: data.signedByEmployee,
          signedByProjectManager: data.signedByProjectManager,
        } as any,
      },
    });

    for (const leave of data.leaveDays ?? []) {
      await tx.leaveDay.create({ data: { timesheetId: documentNo, date: leave.date, leaveType: leave.type } });
    }

    for (const day of data.days ?? []) {
      // เดิมเก็บเฉพาะแถวที่มี label หรือเวลาเข้า — พอสเปกกลางเพิ่มช่องรายวันมา แถวที่มีแต่ข้อมูลลา/
      // กิจกรรม/ชั่วโมง (ไม่มีทั้ง label และเวลาเข้า) จะถูกทิ้งทั้งแถวทั้งที่อ่านมาได้จริง จึงนับว่ามีข้อมูล
      // ถ้าช่องใดช่องหนึ่งที่มีความหมายมีค่า — เงื่อนไขนี้ "เก็บเพิ่ม" เท่านั้น ไม่เคยทำให้แถวที่เคยเก็บหายไป
      const hasContent =
        day.label ||
        day.timeIn ||
        day.leaveType ||
        day.activity ||
        day.jobDescription ||
        day.type ||
        day.normalHours != null ||
        day.otHours != null ||
        day.totalHours != null ||
        day.additionalHours != null ||
        day.leaveDays != null;
      if (!hasContent) continue;
      await tx.timesheetDay.create({
        data: {
          timesheetId: documentNo,
          date: day.date,
          dayOfWeek: day.dayOfWeek ?? null,
          project: day.project ?? null,
          timeIn: day.timeIn ?? null,
          timeOut: day.timeOut ?? null,
          otTimeIn: day.otTimeIn ?? null,
          otTimeOut: day.otTimeOut ?? null,
          type: day.type ?? null,
          label: day.label ?? null,
          jobDesc: day.jobDescription ?? null,
          // เดิมมีคอลัมน์ remark อยู่แล้วแต่ไม่เคยเขียนลงเลย (ตกหล่นมาแต่ต้น) — เก็บให้ครบในคราวเดียวกัน
          remark: day.remark ?? null,
          normalHours: day.normalHours ?? null,
          otHours: day.otHours ?? null,
          totalHours: day.totalHours ?? null,
          rowNumber: day.rowNumber ?? null,
          site: day.site ?? null,
          workLocation: day.workLocation ?? null,
          breakHours: day.breakHours ?? null,
          otBreakHours: day.otBreakHours ?? null,
          additionalHours: day.additionalHours ?? null,
          activity: day.activity ?? null,
          leaveType: day.leaveType ?? null,
          leaveDays: day.leaveDays ?? null,
        },
      });
    }

    for (const ot of data.otDays ?? []) {
      await tx.overtimeDay.create({ data: { timesheetId: documentNo, date: ot.date, hours: Number(ot.hours) } });
    }
  });

  await logAudit({
    actor,
    action: existing ? 'ingest_timesheet_replaced' : 'ingest_timesheet',
    entityType: 'timesheet',
    entityId: documentNo,
    detail: { employeeId: employee.id, period, matchKind: nameMatch.match, workdays: data.totalWorkDays, leave: data.totalLeaveDays, submissionMethod },
  });

  const manday: any = await recomputeTimesheet(documentNo, { actor });
  const cycle = await getCycleStatus(assignment.contractId, period);

  let nextAction: IngestResult['nextAction'];
  if (!manday.ok) nextAction = NEXT_ACTION.FIX_MISMATCH;
  else if (cycle.complete) nextAction = NEXT_ACTION.APPROVE_CYCLE;
  else nextAction = NEXT_ACTION.WAIT_FOR_OTHERS;

  const failures = manday.checks.filter((c: any) => c.severity === SEVERITY.FAIL).map((c: any) => c.title);

  if (nextAction === NEXT_ACTION.FIX_MISMATCH) {
    await notifyCheckFailed({ documentNo, employeeName: employee.nameTh!, period, failures, client });
  } else {
    await notifyNeedsCheck({ documentNo, contractId: assignment.contractId, period, client });
  }

  if (nextAction === NEXT_ACTION.APPROVE_CYCLE) {
    try {
      await requestCycleApproval(assignment.contractId, period, { actor, client });
    } catch (error: any) {
      await logAudit({
        actor: 'system',
        action: 'request_line_approval_error',
        entityType: 'cycle',
        entityId: `${assignment.contractId}-${period}`,
        detail: { message: error.message },
      });
    }
  }

  return {
    timesheetId: documentNo,
    created: !existing,
    replaced: Boolean(existing),
    nextAction,
    status: manday.status,
    contractId: assignment.contractId,
    period,
    employee: { id: employee.id, nameTh: employee.nameTh!, position: employee.invoicePosition! },
    matching: {
      name: { raw: data.employeeName, kind: nameMatch.match, reason: nameMatch.reason },
      position: { raw: data.position, ...positionCheck },
    },
    verification,
    manday: {
      standardWorkingDays: manday.standardWorkingDays,
      payableDays: manday.payableDays,
      leaveCount: manday.leaveCount,
      dailyRate: manday.dailyRate,
      discount: manday.discount,
      lineAmount: manday.lineAmount,
    },
    failures,
    warnings: manday.checks.filter((c: any) => c.severity === SEVERITY.WARN).map((c: any) => c.title),
    cycle,
  };
}

/** ported from service.js nextDocumentNo() — sequential OBS{year}{seq} numbers, the sequence
 * persisted in the settings table (keyed doc_seq_{year}), recovered from the max existing
 * ai_reads.document_no on the first call of a new year. */
/** ⚠️ เดิมอ่าน `setting.value` แล้วค่อย `upsert` แยกกันเป็นสองคำสั่ง (read-then-write) — สอง request
 * ที่เรียกพร้อมกันพอดีอ่านค่าเดิมได้เท่ากัน แล้วเขียนทับด้วยเลขซ้ำกันได้ (เจอจริง 15 ก.ย. 69 ตอนไล่ตรวจ
 * audit ทั้งระบบ) เลขเอกสารซ้ำ = `Timesheet.id` ซ้ำ = `ingestTimesheet()`'s "แทนที่ไฟล์เดิม"
 * (`deleteMany` แล้ว `create`) ไปลบ Timesheet ของอีกคนทิ้งเงียบๆ โดยไม่มี error เตือนเลยทั้งสองฝั่ง —
 * แก้ด้วย `UPDATE ... RETURNING` ประโยคเดียว (Postgres ล็อกแถวนั้นให้เองระดับ row จน commit เสร็จ
 * request ที่มาทีหลังจะรอ lock แล้วเห็นค่าที่เพิ่งอัปเดตไปแล้วเสมอ ไม่มีทางได้เลขซ้ำกันอีก) ทางช้า
 * (กู้เลขเริ่มต้นจาก ai_reads) ยังเกิดแค่ครั้งแรกของปีเหมือนเดิม เพื่อไม่ต้อง scan ai_reads ทุกครั้ง */
export async function nextDocumentNo(): Promise<string> {
  const year = new Date().getFullYear();
  const key = `doc_seq_${year}`;
  const prefix = `OBS${year}`;

  const updated = await prisma.$queryRaw<Array<{ value: string }>>`
    UPDATE settings SET value = ((value::int) + 1)::text WHERE key = ${key} RETURNING value
  `;
  if (updated.length > 0) {
    return `${prefix}${String(Number(updated[0].value)).padStart(2, '0')}`;
  }

  // ยังไม่มีแถวของปีนี้เลย (ครั้งแรกของปี) — กู้เลขเริ่มต้นจาก document_no สูงสุดที่มีอยู่จริงใน ai_reads
  // เหมือนเดิม แล้ว INSERT ... ON CONFLICT DO UPDATE ในคำสั่งเดียวกัน กันกรณีมีอีก request แทรก insert
  // แถวเดียวกันเข้ามาระหว่างที่ UPDATE ด้านบน "ไม่เจอแถว" กับตอนนี้พอดี (หน้าต่างแคบมาก เกิดได้แค่ปีละ
  // ครั้งแรก แต่ยังต้องกันให้ครบ)
  const rows = await prisma.aiRead.findMany({
    where: { documentNo: { startsWith: prefix } },
    select: { documentNo: true },
  });
  const seed = rows.reduce((max, r) => {
    const n = Number(r.documentNo!.slice(prefix.length));
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);

  const inserted = await prisma.$queryRaw<Array<{ value: string }>>`
    INSERT INTO settings (key, value) VALUES (${key}, ${JSON.stringify(seed + 1)})
    ON CONFLICT (key) DO UPDATE SET value = ((settings.value::int) + 1)::text
    RETURNING value
  `;
  return `${prefix}${String(Number(inserted[0].value)).padStart(2, '0')}`;
}

/** ported from service.js enterTimesheetManually() — builds the calendar-derived synthetic
 * extraction via packages/domain's buildManualSheet(), then runs it through the same
 * ingestTimesheet() pipeline as an OCR'd document. */
export async function enterTimesheetManually({
  documentNo,
  employeeName,
  position,
  period,
  leaveDays = [],
  otDays = [],
  approvedBy,
  approvedAt,
  customerId = null,
  actor = 'system',
  submissionMethod = 'self_email',
  restrictToEmployeeId = null,
}: {
  documentNo?: string;
  employeeName: string;
  position: string;
  period: string;
  leaveDays?: Array<{ date: string; type?: string }>;
  otDays?: Array<{ date: string; hours: number | string }>;
  approvedBy: string;
  approvedAt: string;
  customerId?: string | null;
  actor?: string;
  submissionMethod?: string;
  restrictToEmployeeId?: string | null;
}): Promise<IngestResult> {
  const holidays = await holidayMap(customerId);
  const data = buildManualSheet({ employeeName, position, period, leaveDays, otDays, holidays });
  const docNo = documentNo ?? (await nextDocumentNo());

  return ingestTimesheet({
    documentNo: docNo,
    fileName: `ป้อนด้วยมือ · ${period}`,
    approvedBy,
    approvedAt,
    expectedPeriod: period,
    actor,
    extractor: manualExtractor(data) as unknown as Extractor,
    submissionMethod,
    restrictToEmployeeId,
  });
}
