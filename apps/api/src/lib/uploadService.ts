/**
 * หน้าอัปโหลด Timesheet (แท็บ "อัปโหลดไฟล์") — ported from src/service.js `readTimesheetFile()`,
 * `confirmTimesheet()`, `logAiRead()`, `markAiReadConfirmed()`.
 *
 * Simplification vs. the original: `readTimesheetFile()` there handles a PDF containing multiple
 * employees' sheets concatenated (via `mergeDocumentsByEmployee`, part of the local-vision
 * pipeline this port doesn't implement — see extractionService.ts). ABBYY's own API processes one
 * PDF as one transaction producing one set of extracted fields, not a documents[] array, so that
 * multi-document splitting doesn't apply to the path this port actually uses — one upload = one
 * reviewed document, matching what ABBYY itself returns.
 */
import { prisma } from '@obs/db';
import { matchEmployee, checkPosition, type MatchableEmployee } from '@obs/domain';
import { employeesForMatching } from './masterData.js';
import { logAudit } from './audit.js';
import { extractTimesheet } from './extractionService.js';
import { extractTimesheetFromSpreadsheet } from './spreadsheetExtractionService.js';
import { getActiveContract } from './dashboardService.js';
import { pendingSubmissionFor } from './timesheetSubmissionService.js';
import { ingestTimesheet, nextDocumentNo, type ExtractedData } from './ingestService.js';

/** เลือก ABBYY Skill ให้ตรงบริษัท (multi-skill) — ใช้สัญญาที่ระบุมาก่อน (ถ้ามี) ไม่งั้น fallback ไป
 * ใช้สัญญาที่ "กำลังดำเนินการอยู่" (ตัวสลับบริษัทบนแถบบน) เพราะตอนอ่านไฟล์ preview ยังไม่รู้ว่าเป็น
 * ของพนักงานสัญญาไหน (จับคู่ชื่อพนักงาน→สัญญาเกิดขึ้น "หลัง" ขั้นตอนนี้) — คืน null ถ้าไม่มีทั้งคู่หรือ
 * สัญญานั้นยังไม่ได้ตั้ง Skill ไว้ ให้ extractTimesheet() ปล่อยไปใช้ ABBYY_SKILL_ID เดิมจาก .env ต่อ
 *
 * ⚠️ ฝั่ง Clear Read ต่างจาก ABBYY: เจ้าของระบบสั่งไว้ 17 ก.ย. 69 ว่าให้ใช้ **แม่แบบเดียวทั้งระบบ**
 * (CLEAR_READ_TEMPLATE_ID ใน .env) และเอาแม่แบบเก่าออกให้หมด จึงคืน null เสมอเพื่อให้ตกไปใช้ค่าจาก
 * .env ไม่ว่าสัญญานั้นเคยตั้ง clearReadTemplateId ไว้ว่าอะไร — คอลัมน์ยังอยู่เพื่อไม่ให้ข้อมูลเดิมหาย
 * แต่ไม่มีผลกับการอ่านแล้ว ถ้าวันหนึ่งกลับมาใช้หลายแม่แบบอีก ให้แก้ที่จุดนี้จุดเดียว */
async function resolveReaderTemplates(
  contractId: string | null,
): Promise<{ abbyySkillId: string | null; clearReadTemplateId: string | null }> {
  const clearReadTemplateId = null;
  if (contractId) {
    const contract = await prisma.contract.findUnique({
      where: { id: contractId },
      select: { abbyySkillId: true },
    });
    return { abbyySkillId: contract?.abbyySkillId ?? null, clearReadTemplateId };
  }
  const active = await getActiveContract();
  return { abbyySkillId: active?.abbyySkillId ?? null, clearReadTemplateId };
}

export class UploadError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export interface ReadResult {
  fileName: string | null;
  model: string;
  usage: unknown;
  data: ExtractedData;
  verification: { ok: boolean; issues: Array<{ severity: string; message: string }> };
  matching: {
    kind: string;
    reason?: string;
    employee: { id: string; nameTh: string; invoicePosition: string } | null;
    position: { ok: boolean; reason?: string } | null;
  };
  contract: {
    id: string;
    poNo: string;
    projectName: string;
    customerName: string;
    monthlyRate: number;
    quotationNo: string | null;
    vatRate: number;
    whtRate: number;
  } | null;
  blockers: string[];
  /** raw response ดิบจาก ABBYY ก่อน map (undefined ถ้าไม่ใช่ไฟล์ PDF/ไม่ได้ผ่าน ABBYY) — เก็บไว้ให้
   * logAiRead() persist ลง DB เพื่อ debug ย้อนหลังเท่านั้น ต้องตัดออกก่อนส่งกลับให้ client เสมอ (ดู
   * routes/timesheets.ts และ routes/gmail.ts's /read handler) ไม่ใช่ข้อมูลที่หน้าเว็บต้องใช้เลย และ
   * อาจมีขนาดใหญ่กว่า fileName/matching ทั่วไปมาก */
  rawResponse?: unknown;
}

/** ported from service.js readTimesheetFile() — preview only, does NOT write to the DB. */
export async function readTimesheetFile({
  fileBase64,
  fileName = null,
  expectedPeriod,
  contractId = null,
  readerId = null,
  abbyySkillId = null,
}: {
  fileBase64: string;
  fileName?: string | null;
  expectedPeriod?: string;
  contractId?: string | null;
  /** ลองอ่านครั้งนี้ด้วยเครื่องอ่านที่ระบุ โดยไม่เปลี่ยนค่าที่ตั้งไว้ทั้งระบบ */
  readerId?: string | null;
  /** เลือก ABBYY Skill เองสำหรับการอ่านครั้งนี้ — ทับ Skill ที่ผูกไว้กับสัญญา ไม่ได้แก้ค่าของสัญญา
   * (ฝั่ง Clear Read ไม่มีคู่กันเพราะใช้แม่แบบเดียวทั้งระบบ ดู resolveReaderTemplates) */
  abbyySkillId?: string | null;
}): Promise<ReadResult & { fileBytes: Buffer | null }> {
  if (!fileBase64) throw new UploadError('ยังไม่ได้เลือกไฟล์ Timesheet');

  const source = Buffer.from(fileBase64, 'base64');
  // เดารูปแบบไฟล์จากเนื้อไฟล์เอง ไม่เชื่อชื่อไฟล์ (ไฟล์ตัวอย่างจริงที่เจอมาชื่อ "...pdf.xlsx" — ชื่อไฟล์
  // เชื่อไม่ได้) — PDF ขึ้นต้นด้วย "%PDF" เสมอ ที่เหลือ (xlsx/csv) ให้ spreadsheetExtractionService.ts
  // เดาต่อเอง (zip = xlsx, ไม่งั้นถือเป็นข้อความ CSV)
  const isPdf = source.subarray(0, 4).toString('latin1') === '%PDF';
  // Skill ที่คนเลือกเองตอนอัปโหลดชนะ Skill ที่ผูกไว้กับสัญญาเสมอ — ถ้าไม่ได้เลือกค่อยใช้ของสัญญา
  // (เลือกแล้วต้องได้ตัวนั้นจริง ไม่งั้นคนที่กำลังลองเทียบ Skill จะเข้าใจผิดว่าได้ลองไปแล้ว)
  const contractTemplates = await resolveReaderTemplates(contractId);
  const extracted = isPdf
    ? await extractTimesheet(source, {
        expectedPeriod,
        readerId,
        ...contractTemplates,
        ...(abbyySkillId ? { abbyySkillId } : {}),
      })
    : await extractTimesheetFromSpreadsheet(source, { expectedPeriod });
  const { usage, model, verification } = extracted;
  const data = extracted.data;

  const employees = await employeesForMatching();
  const nameMatch = matchEmployee(data.employeeName, employees);
  const employee = (nameMatch.employee as MatchableEmployee | null) ?? null;

  // ⚠️ ใหม่ (15 ก.ย. 69 ตามที่ user ขอ) — จับคู่รอบเดือนอัตโนมัติจากตารางรอบบิลของสัญญา (ดูเหตุผนเต็มที่
  // ingestService.ts's จุดเดียวกัน) เพื่อให้หน้ารีวิว (preview ก่อนกดยืนยัน) เห็นสัญญา/รอบที่ถูกต้องทันที
  // แทนที่จะเห็น blocker "ไม่มีสัญญาที่ครอบรอบ" ตั้งแต่หน้ารีวิวเลยทั้งที่จริงๆจับคู่ได้
  if (employee && !data.period) {
    const pending = await pendingSubmissionFor(employee.id);
    if (pending) {
      data.period = pending.period;
      data.notes = [
        ...(data.notes ?? []),
        `ไม่พบรอบเดือนจากไฟล์ — จับคู่อัตโนมัติกับรอบ ${pending.periodLabel} ของ ${pending.customerName} (รอบเก่าสุดที่ยังไม่ได้ส่ง) ตรวจสอบก่อนยืนยัน`,
      ];
    }
  }

  const assignment = employee
    ? await prisma.assignment.findFirst({
        where: {
          employeeId: employee.id,
          status: 'active',
          startDate: { lte: `${data.period}-01` },
          endDate: { gte: `${data.period}-01` },
        },
        include: { contract: { include: { customer: true } } },
      })
    : null;

  const blockers = [
    ...(employee ? [] : [`จับคู่ชื่อ "${data.employeeName ?? 'ไม่มีข้อมูล'}" กับพนักงานในระบบไม่ได้ — ไปเพิ่มชื่อพ้องที่หน้าข้อมูลหลักก่อน`]),
    ...(employee && !data.period ? [`ไม่พบรอบเดือนจากไฟล์ และหารอบที่ยังไม่ได้ส่งของ ${employee.nameTh} ไม่เจอ (อาจส่งครบทุกรอบแล้ว) — ต้องเลือก "รอบเดือน" เอง`] : []),
    ...(employee && data.period && !assignment ? [`${employee.nameTh} ไม่มีสัญญาที่ครอบรอบ ${data.period}`] : []),
    ...verification.issues.filter((i) => i.severity === 'fail').map((i) => i.message),
  ];

  await logAudit({
    actor: 'llm',
    action: 'read_timesheet_file',
    entityType: 'timesheet',
    entityId: fileName ?? 'อัปโหลด',
    detail: { model, usage, employeeName: data.employeeName, period: data.period, ok: verification.ok },
  });

  return {
    fileName,
    model,
    usage,
    data,
    verification,
    matching: {
      kind: nameMatch.match,
      reason: nameMatch.reason,
      employee: employee ? { id: employee.id, nameTh: employee.nameTh!, invoicePosition: employee.invoicePosition! } : null,
      position: employee ? checkPosition(data.position, employee) : null,
    },
    contract: assignment
      ? {
          id: assignment.contract.id,
          poNo: assignment.contract.poNo,
          projectName: assignment.contract.projectName,
          customerName: assignment.contract.customer.nameTh,
          monthlyRate: assignment.monthlyRate,
          quotationNo: assignment.quotationNo,
          vatRate: assignment.contract.vatRate,
          whtRate: assignment.contract.whtRate,
        }
      : null,
    blockers,
    rawResponse: (extracted as any).rawResponse,
    fileBytes: source,
  };
}

/** ported from service.js logAiRead() — stores the full read result (minus the file bytes, kept
 * in their own column) as the ai_reads.extraction JSON, under a freshly-issued document number. */
export async function logAiRead({
  source,
  sourceEmailId = null,
  fileName = null,
  result,
  actor = null,
}: {
  source: string;
  sourceEmailId?: string | null;
  fileName?: string | null;
  result: any;
  actor?: string | null;
}): Promise<string> {
  const documentNo = await nextDocumentNo();
  const data: any = result?.data ?? {};
  // ไฟล์ต้นฉบับเก็บแยกไว้ในคอลัมน์ file_bytes ของตัวเอง — ห้ามปนไปกับ extraction JSON
  const { fileBytes, ...resultWithoutBytes } = result ?? {};
  // เพิ่ม 15 ก.ย. 69 — ผูก employeeId จากผลจับคู่ชื่อจริง (result.matching.employee.id) ไม่ใช่แค่ชื่อ
  // free-text ใช้จำกัดสิทธิ์ role "user" ตอนดูประวัติ (ดู aiReadsService.ts/routes/aiReads.ts)
  const employeeId: string | null = result?.matching?.employee?.id ?? null;

  await prisma.aiRead.create({
    data: {
      source,
      sourceEmailId,
      fileName: fileName ?? (result?.fileName as string | undefined) ?? null,
      employeeId,
      employeeName: data.employeeName ?? null,
      period: data.period ?? null,
      documentNo,
      model: (result?.model as string | undefined) ?? null,
      extraction: resultWithoutBytes as any,
      fileBytes: fileBytes ?? undefined,
      readAt: new Date().toISOString(),
      readBy: actor,
    },
  });

  return documentNo;
}

async function markAiReadConfirmed(documentNo: string) {
  const pending = await prisma.aiRead.findFirst({
    where: { documentNo, status: 'pending' },
    orderBy: { readAt: 'desc' },
  });
  if (pending) await prisma.aiRead.update({ where: { id: pending.id }, data: { status: 'confirmed' } });
}

/** ported from service.js confirmTimesheet() — saves the human-reviewed (possibly edited)
 * extraction; the LINE push to the employee on successful self-upload is deferred. */
export async function confirmTimesheet({
  documentNo,
  extraction,
  fileName = null,
  sourceEmailId = null,
  sourceEmailSubject = null,
  approvedBy = null,
  approvedAt = null,
  readModel = null,
  actor,
  submissionMethod = 'self_obs',
  restrictToEmployeeId = null,
}: {
  documentNo: string;
  extraction: Partial<ExtractedData> & { employeeName?: string; period?: string };
  fileName?: string | null;
  sourceEmailId?: string | null;
  sourceEmailSubject?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  readModel?: string | null;
  actor: string;
  submissionMethod?: string;
  /** ใส่ session.employeeId เมื่อ role เป็น 'user' เท่านั้น — ส่งต่อให้ ingestTimesheet() บังคับว่าชื่อ
   * ที่ยืนยันต้องเป็นพนักงานคนนี้เท่านั้น กัน 'user' ยืนยัน Timesheet แทนคนอื่น */
  restrictToEmployeeId?: string | null;
}) {
  if (!documentNo) throw new UploadError('ต้องระบุเลขที่เอกสารจากใบ Timesheet');
  if (!extraction?.employeeName || !extraction?.period) {
    throw new UploadError('ข้อมูลที่อ่านได้ไม่ครบ — ต้องมีอย่างน้อยชื่อพนักงานและรอบเดือน');
  }

  const data: ExtractedData = {
    ...(extraction as ExtractedData),
    days: extraction.days ?? [],
    leaveDays: extraction.leaveDays ?? [],
    totalWorkDays: Number(extraction.totalWorkDays ?? 0),
    totalLeaveDays: Number(extraction.totalLeaveDays ?? (extraction.leaveDays ?? []).length),
    notes: extraction.notes ?? [],
  };

  const stamped = readModel ? `${readModel} · คนยืนยัน` : 'ป้อนด้วยมือ';

  const pendingRead = await prisma.aiRead.findFirst({
    where: { documentNo, status: 'pending' },
    orderBy: { readAt: 'desc' },
  });

  const result = await ingestTimesheet({
    documentNo,
    fileName: fileName ?? `อัปโหลดด้วยมือ · ${data.period}`,
    fileBytes: pendingRead?.fileBytes ?? null,
    sourceEmailId,
    sourceEmailSubject,
    approvedBy,
    approvedAt,
    expectedPeriod: data.period,
    actor,
    submissionMethod,
    restrictToEmployeeId,
    extractor: async () => ({
      data,
      verification: { ok: true, issues: [] },
      usage: { input_tokens: 0, output_tokens: 0 },
      model: stamped,
    }),
  });

  if (result.timesheetId) await markAiReadConfirmed(documentNo);

  return result;
}
