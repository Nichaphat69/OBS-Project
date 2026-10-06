/**
 * ประวัติ AI อ่านไฟล์ ("ที่มาของข้อมูล") — ported from src/service.js's `listAiReads`, `getAiRead`,
 * `dismissAiRead`, `nextDocumentNo`/`logAiRead`/`markAiReadConfirmed` (the latter three live in
 * ingestService.ts alongside the pipeline they support).
 */
import { prisma } from '@obs/db';
import { matchEmployee, thaiMonth } from '@obs/domain';
import { employeesForMatching } from './masterData.js';
import { logAudit } from './audit.js';

export interface AiReadListItem {
  id: number;
  source: string;
  sourceEmailId: string | null;
  fileName: string | null;
  employeeId: string | null;
  employeeName: string | null;
  period: string | null;
  periodLabel: string | null;
  documentNo: string | null;
  status: string;
  model: string | null;
  readAt: string;
  readBy: string | null;
  /** เหตุผลที่อ่านไม่สำเร็จ — มีค่าเฉพาะแถว status === 'failed' จากคิวอ่านหลายไฟล์ (23 ก.ย. 69) */
  errorMessage: string | null;
  /** เฉพาะแถว source === 'employee_submit' — สัญญา/บริษัทที่ไฟล์นี้น่าจะเป็นของ (หา assignment
   * ที่ active ครอบ period ของ employeeId แถวนั้น เหมือน uploadService.ts's readTimesheetFile())
   * แถวอื่นไม่คำนวณให้ เพื่อไม่ต้อง query เพิ่มโดยไม่จำเป็น — จึงเป็น undefined ไม่ใช่ null */
  contract?: { id: string; poNo: string; projectName: string; customerName: string } | null;
}

/** ported from service.js listAiReads() — no contractId = every read; contractId = only reads
 * whose matched employee has an assignment on that contract (unmatched names are excluded when
 * filtering, since there's no way to tell which company they belong to). เพิ่ม `restrictToEmployeeId`
 * (15 ก.ย. 69 ตาม policy ที่ user ยืนยัน) — role "user" ต้องเห็นแค่ของตัวเอง ผูก path นี้ต่างจาก
 * contractId ตรงที่กรองด้วย employeeId ที่บันทึกไว้ตอน ingest ตรงๆ (แม่นกว่า heuristic ชื่อของ
 * contractId ด้านล่างที่ยังคงไว้ให้ admin/accounting ใช้กรองตามบริษัทเหมือนเดิม) */
export async function listAiReads(contractScope?: string | string[] | null, restrictToEmployeeId?: string | null): Promise<AiReadListItem[]> {
  // สัญญาเดียว (ของเดิม) หรือรายการสัญญาจากตัวกรอง PO บนแถบบน — null/ไม่ระบุ = ไม่กรอง
  const scopeIds = Array.isArray(contractScope) ? contractScope : contractScope ? [contractScope] : null;
  const rows = await prisma.aiRead.findMany({
    where: {
      status: { not: 'discarded' },
      ...(restrictToEmployeeId !== undefined ? { employeeId: restrictToEmployeeId } : {}),
    },
    orderBy: { readAt: 'desc' },
    take: 200,
    // ชื่อพนักงานจากตาราง employees — แถวที่พนักงานส่งเอง (employee_submit) มีแค่ employeeId ไม่มี
    // employeeName (ไม่ได้อ่านไฟล์ เลยไม่มีชื่อจากเอกสาร) เดิมหน้า "รอจากพนักงาน" จึงขึ้น "ไม่ทราบชื่อ"
    // ทั้งที่รู้อยู่แล้วว่าใครส่ง (25 ก.ย. 69)
    include: { employee: { select: { nameTh: true } } },
  });

  let filtered = rows;
  if (scopeIds) {
    const employees = await employeesForMatching();
    const belongs = new Map<string, boolean>();
    const out: typeof rows = [];
    for (const r of rows) {
      // รู้ employeeId อยู่แล้ว (เช่น พนักงานส่งเอง) — เช็คสัญญาจาก id ตรงๆ ไม่ต้องเดาจากชื่อ เดิมแถวที่ไม่มี
      // employeeName ถูกทิ้งไปเลย ไฟล์ที่พนักงานส่งมาจึงหายจากรายการตอนเลือกบริษัทไว้
      if (r.employeeId) {
        if (await prisma.assignment.findFirst({ where: { employeeId: r.employeeId, contractId: { in: scopeIds } }, select: { employeeId: true } })) out.push(r);
        continue;
      }
      if (!r.employeeName) continue;
      let ok = belongs.get(r.employeeName);
      if (ok === undefined) {
        const { employee } = matchEmployee(r.employeeName, employees);
        ok = employee
          ? Boolean(await prisma.assignment.findFirst({ where: { employeeId: employee.id, contractId: { in: scopeIds } } }))
          : false;
        belongs.set(r.employeeName, ok);
      }
      if (ok) out.push(r);
    }
    filtered = out;
  }

  const items = await Promise.all(
    filtered.map(async (r) => ({
      id: r.id,
      source: r.source,
      sourceEmailId: r.sourceEmailId,
      fileName: r.fileName,
      employeeId: r.employeeId,
      employeeName: r.employeeName ?? r.employee?.nameTh ?? null,
      period: r.period,
      periodLabel: r.period ? thaiMonth(r.period) : null,
      documentNo: r.documentNo,
      status: r.status,
      model: r.model,
      readAt: r.readAt,
      readBy: r.readBy,
      errorMessage: r.errorMessage,
      contract: r.source === 'employee_submit' ? await contractForEmployeeSubmit(r.employeeId, r.period) : undefined,
    })),
  );
  return items;
}

/** สัญญา/บริษัทของไฟล์ที่พนักงานส่งเอง — หา assignment ที่ active ครอบ period ของพนักงานคนนั้น
 * (โค้ดเดียวกับที่ uploadService.ts's readTimesheetFile() ใช้ตอน preview ไฟล์อัปโหลด) */
async function contractForEmployeeSubmit(
  employeeId: string | null,
  period: string | null,
): Promise<AiReadListItem['contract']> {
  if (!employeeId || !period) return null;
  const assignment = await prisma.assignment.findFirst({
    where: {
      employeeId,
      status: 'active',
      startDate: { lte: `${period}-01` },
      endDate: { gte: `${period}-01` },
    },
    include: { contract: { include: { customer: true } } },
  });
  if (!assignment) return null;
  return {
    id: assignment.contract.id,
    poNo: assignment.contract.poNo,
    projectName: assignment.contract.projectName,
    customerName: assignment.contract.customer.nameTh,
  };
}

/** ported from service.js getAiRead() — หน้ารีวิวใช้แค่ extraction JSON ไม่ต้องใช้ตัวไฟล์
 * (เดิมที่นี่ตัดคอลัมน์ file_bytes ออก ตอนนี้ไฟล์ไม่ได้อยู่ในฐานข้อมูลแล้ว เหลือแค่ file_key) */
export async function getAiRead(id: number) {
  const row = await prisma.aiRead.findUnique({
    where: { id },
    select: {
      id: true,
      source: true,
      sourceEmailId: true,
      fileName: true,
      employeeId: true,
      employeeName: true,
      period: true,
      documentNo: true,
      status: true,
      model: true,
      extraction: true,
      readAt: true,
      readBy: true,
    },
  });
  if (!row) return null;
  return row;
}

export class AiReadError extends Error {
  status: number;
  constructor(message: string, status = 404) {
    super(message);
    this.status = status;
  }
}

/** ported from service.js dismissAiRead() — soft delete (status='discarded'), row stays for
 * later SQL-level inspection but drops out of listAiReads(). */
export async function dismissAiRead(id: number, { actor }: { actor: string }) {
  const row = await prisma.aiRead.findUnique({ where: { id } });
  if (!row) throw new AiReadError('ไม่พบรายการนี้ในประวัติ');
  await prisma.aiRead.update({ where: { id }, data: { status: 'discarded' } });
  await logAudit({ actor, action: 'discard_ai_read', entityType: 'ai_read', entityId: String(id), detail: {} });
}
