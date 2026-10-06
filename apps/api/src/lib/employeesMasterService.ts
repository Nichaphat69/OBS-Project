/**
 * พนักงาน & ชื่อพ้อง — ported from service.js's `listEmployees` (full-shape version),
 * `createEmployee`/`updateEmployee`/`removeAssignment`/`addEmployeeAlias`/`removeEmployeeAlias`/
 * `updateAssignmentRate`. Backs the "ข้อมูลหลัก → พนักงาน & ชื่อพ้อง" tab (5.5.6).
 *
 * Deliberately separate from `masterData.ts`'s `listEmployeesBasic()` (`{id, nameTh,
 * customerName}`, used by UsersTab.tsx's employee picker) — that narrow shape stays as-is; this
 * file's `listEmployeesFull()` is the richer join the master-data tab needs (aliases, rate,
 * assignment id, quotation no, dates, contract/po info).
 */
import { prisma } from '@obs/db';
import { round2 } from '@obs/domain';
import { logAudit } from './audit.js';

export class EmployeeMasterError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** ล็อกจำนวนพนักงานในสัญญาที่ผูกกับ FlowAccount แล้ว (customer.flowaccountContactId ตั้งไว้) — ต้อง
 * ยึดจำนวน/รายชื่อจากใบเสนอราคาใน FlowAccount เป็นหลักเท่านั้น (read-only จากฝั่ง OBS) ห้ามเพิ่ม/ลบ
 * พนักงานเองตามใจชอบอีกต่อไป ใช้ syncAssignmentsFromFlowAccount() แทนเมื่อ FlowAccount มีการเปลี่ยนแปลง */
function assertAssignmentsNotFlowAccountLocked(flowaccountContactId: string | null | undefined): void {
  if (flowaccountContactId) {
    throw new EmployeeMasterError(
      'สัญญานี้ผูกกับ FlowAccount แล้ว — เพิ่ม/ลบพนักงานในสัญญาเองไม่ได้ ใช้ปุ่ม "ซิงก์จาก FlowAccount" แทน',
      409,
    );
  }
}

async function nextId(prefix: string): Promise<string> {
  const rows = await prisma.employee.findMany({ where: { id: { startsWith: `${prefix}-` } }, select: { id: true } });
  const max = rows.reduce((m, r) => {
    const suffix = r.id.slice(prefix.length + 1);
    const n = /^\d+$/.test(suffix) ? Number(suffix) : NaN;
    return Number.isInteger(n) && n > m ? n : m;
  }, 0);
  return `${prefix}-${String(max + 1).padStart(4, '0')}`;
}

export interface EmployeeMasterRow {
  id: string;
  nameTh: string;
  nameEn: string | null;
  invoicePosition: string;
  hrddEmployeeCode: string | null;
  assignmentId: string | null;
  contractId: string | null;
  monthlyRate: number | null;
  quotationNo: string | null;
  startDate: string | null;
  endDate: string | null;
  status: string | null;
  poNo: string | null;
  contractNo: string | null;
  customerName: string | null;
  nameAliases: Array<{ alias: string; source: string | null }>;
  /** true = สัญญานี้ผูกกับ FlowAccount แล้ว (customer.flowaccountContactId ตั้งไว้) — แก้ไข/นำออก
   * พนักงานแถวนี้จากหน้า OBS ไม่ได้ ต้องใช้ปุ่ม "ซิงก์จาก FlowAccount" แทน (ดู
   * assertAssignmentsNotFlowAccountLocked ด้านล่าง) */
  flowaccountLocked: boolean;
}

/**
 * ไม่ระบุ contractId = พนักงานทุกบริษัท (หนึ่งแถวต่อหนึ่งอัตราจ้าง — พนักงานที่มีหลายอัตราจ้างพร้อมกัน
 * จะมีหลายแถว ตรงกับ LEFT JOIN ของต้นฉบับ) ระบุ contractId = เฉพาะพนักงานที่มีอัตราจ้างผูกกับสัญญานั้น
 * — หน้า "พนักงาน & ชื่อพ้อง" ต้องกรองด้วยตัวนี้เสมอ ไม่งั้นสลับบริษัทบนแถบบนแล้วยังเห็นพนักงานของ
 * บริษัทอื่นค้างอยู่
 */
export async function listEmployeesFull({ contractId, contractIds }: { contractId?: string; contractIds?: string[] | null } = {}): Promise<EmployeeMasterRow[]> {
  const employees = await prisma.employee.findMany({
    include: {
      assignments: { include: { contract: { include: { customer: true } } } },
      aliases: true,
    },
  });

  const rows: EmployeeMasterRow[] = [];
  for (const e of employees) {
    const nameAliases = e.aliases.filter((a) => a.kind === 'name').map((a) => ({ alias: a.alias, source: a.source }));
    const base = {
      id: e.id,
      nameTh: e.nameTh,
      nameEn: e.nameEn,
      invoicePosition: e.invoicePosition,
      hrddEmployeeCode: e.hrddEmployeeCode,
      nameAliases,
    };

    if (e.assignments.length === 0) {
      rows.push({ ...base, assignmentId: null, contractId: null, monthlyRate: null, quotationNo: null, startDate: null, endDate: null, status: null, poNo: null, contractNo: null, customerName: null, flowaccountLocked: false });
      continue;
    }
    for (const a of e.assignments) {
      rows.push({
        ...base,
        assignmentId: a.id,
        contractId: a.contractId,
        monthlyRate: a.monthlyRate,
        quotationNo: a.quotationNo,
        startDate: a.startDate,
        endDate: a.endDate,
        status: a.status,
        poNo: a.contract.poNo,
        contractNo: a.contract.contractNo,
        customerName: a.contract.customer.nameTh,
        flowaccountLocked: Boolean(a.contract.customer.flowaccountContactId),
      });
    }
  }

  // contractIds = ขอบเขตจากตัวกรอง PO (หลายสัญญาได้ · null = ทุกสัญญา รวมพนักงานที่ยังไม่ผูกสัญญา) · contractId เดี่ยวคงไว้ให้โค้ดเดิม
  const ids = contractIds ?? (contractId ? [contractId] : null);
  const filtered = ids ? rows.filter((r) => r.contractId !== null && ids.includes(r.contractId)) : rows;
  return filtered.sort((x, y) => (y.monthlyRate ?? 0) - (x.monthlyRate ?? 0));
}

export interface CreateEmployeeInput {
  contractId: string;
  nameTh: string;
  nameEn?: string | null;
  invoicePosition: string;
  hrddEmployeeCode?: string | null;
  quotationNo?: string | null;
  monthlyRate: number;
  startDate: string;
  endDate?: string | null;
  /** จำนวน/หน่วยของบรรทัดในใบเสนอราคา FlowAccount — เก็บอ้างอิง (5 ต.ค. 69) */
  quantity?: number | null;
  unitName?: string | null;
  /** true เฉพาะตอนเรียกจากลูปสร้างพนักงานชุดแรกของ "เพิ่มลูกค้าใหม่จาก FlowAccount" เท่านั้น (ดู
   * CustomersContractsTab.tsx) — ข้าม assertAssignmentsNotFlowAccountLocked() ไปเลย ไม่เชื่อ headcount
   * ปัจจุบันของสัญญา (เดิมเคยลองเช็คว่า assignments.length===0 แทน แต่ลูปสร้างทีละคนตามลำดับทำให้
   * headcount ขยับขึ้นระหว่างลูปเดียวกัน คนแรกผ่านได้แต่คนที่ 2 เป็นต้นไปโดนบล็อกอยู่ดี — บั๊กจริงที่
   * เจอ 14 ก.ย. 69 หลัง fix รอบแรก ต้องใช้ flag ที่ผู้เรียกยืนยันเจตนาแทนการเดาจากสถานะข้อมูล) */
  fromFlowAccountSync?: boolean;
  actor: string;
}

/** ported from service.js createEmployee() — พนักงาน outsource ทุกคนต้องมีอัตราจ้างกับสัญญาใดสัญญา
 * หนึ่งเสมอ (ไม่มีเรท คำนวณ Manday ไม่ได้) จึงสร้างพนักงาน + อัตราจ้างแรกในคราวเดียว */
export async function createEmployee({
  contractId,
  nameTh,
  nameEn = null,
  invoicePosition,
  hrddEmployeeCode = null,
  quotationNo = null,
  monthlyRate,
  startDate,
  endDate = null,
  quantity = null,
  unitName = null,
  fromFlowAccountSync = false,
  actor,
}: CreateEmployeeInput): Promise<EmployeeMasterRow | undefined> {
  const contract = await prisma.contract.findUnique({ where: { id: contractId }, include: { customer: true } });
  if (!contract) throw new EmployeeMasterError('ไม่พบสัญญานี้', 404);
  if (!nameTh || !invoicePosition || !monthlyRate || !startDate) {
    throw new EmployeeMasterError('ต้องระบุชื่อ ตำแหน่งบนใบแจ้งหนี้ เรทต่อเดือน และวันเริ่มงานให้ครบ');
  }
  if (!fromFlowAccountSync) {
    assertAssignmentsNotFlowAccountLocked(contract.customer.flowaccountContactId);
  }

  const id = await nextId('EMP');
  const assignmentId = `ASG-${id.slice('EMP-'.length)}-${contractId}`;

  await prisma.$transaction([
    prisma.employee.create({ data: { id, nameTh, nameEn, invoicePosition, hrddEmployeeCode, createdAt: new Date().toISOString() } }),
    prisma.assignment.create({
      data: {
        id: assignmentId,
        contractId,
        employeeId: id,
        quotationNo,
        monthlyRate: Number(monthlyRate),
        startDate,
        endDate: endDate || contract.endDate,
        status: 'active',
        quantity: quantity ?? null,
        unitName: unitName?.trim() || null,
      },
    }),
  ]);
  await logAudit({ actor, action: 'create_employee', entityType: 'employee', entityId: id, detail: { nameTh, contractId, invoicePosition, monthlyRate } });
  return (await listEmployeesFull({ contractId })).find((e) => e.id === id);
}

export interface AddExistingEmployeeInput {
  contractId: string;
  employeeId: string;
  quotationNo?: string | null;
  monthlyRate: number;
  startDate: string;
  endDate?: string | null;
  actor: string;
}

/** ใหม่ (ไม่มีในต้นฉบับ) — ผูกพนักงาน**ที่มีอยู่แล้ว**ในระบบเข้ากับสัญญาใหม่/สัญญาเดิม แทนที่จะต้อง
 * สร้างเป็นคนใหม่ทุกครั้งผ่าน createEmployee() (ซึ่งสร้าง employee row ใหม่เสมอ) — จำเป็นเพราะพนักงาน
 * ที่ถูกเอาออกจากโครงการ (removeAssignment() ลบแถว assignment ทิ้งจริง) ไม่มีทางถูกผูกกลับเข้าสัญญาไหน
 * ได้อีกเลยถ้าไม่มี endpoint นี้ (เจอจริง 15 ก.ย. 69 ตามที่ session1 แจ้งมา) — ประวัติ Timesheet/ชื่อพ้อง
 * เดิมของพนักงานคนนั้นยังอยู่ครบเพราะ id เดิมไม่เปลี่ยน
 *
 * `Assignment.@@unique([contractId, employeeId])` ทำให้สร้างแถวใหม่ซ้ำคู่เดิมไม่ได้ตรงๆ — ถ้าเคยมี
 * assignment กับสัญญานี้มาก่อนแล้วถูกปิดสถานะ (inactive, จาก syncAssignmentsFromFlowAccount()'s
 * deactivate ไม่ใช่ removeAssignment() ที่ลบทิ้งจริง) ต้อง reactivate แถวเดิมแทนสร้างใหม่ */
export async function addExistingEmployeeToContract({
  contractId,
  employeeId,
  quotationNo = null,
  monthlyRate,
  startDate,
  endDate = null,
  actor,
}: AddExistingEmployeeInput): Promise<EmployeeMasterRow | undefined> {
  if (!contractId || !employeeId) throw new EmployeeMasterError('ต้องระบุสัญญาและพนักงานให้ครบ');

  const contract = await prisma.contract.findUnique({ where: { id: contractId }, include: { customer: true } });
  if (!contract) throw new EmployeeMasterError('ไม่พบสัญญานี้', 404);

  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) throw new EmployeeMasterError('ไม่พบพนักงานนี้', 404);

  if (!startDate) throw new EmployeeMasterError('ต้องระบุวันเริ่มงานให้ครบ');
  const rate = Number(monthlyRate);
  if (!Number.isFinite(rate) || rate <= 0) throw new EmployeeMasterError('เรทต่อเดือนต้องเป็นจำนวนเงินที่มากกว่า 0');

  // สัญญาที่ผูก FlowAccount แล้วต้องใช้ "ซิงก์จาก FlowAccount" เท่านั้น เหมือน createEmployee() —
  // ผูกพนักงานเก่ากลับเข้าสัญญาแบบนี้เองไม่ได้ ถึงจะเป็นคนที่เคยอยู่ในระบบมาก่อนแล้วก็ตาม
  assertAssignmentsNotFlowAccountLocked(contract.customer.flowaccountContactId);

  const existing = await prisma.assignment.findUnique({
    where: { contractId_employeeId: { contractId, employeeId } },
  });

  if (existing) {
    if (existing.status === 'active') {
      throw new EmployeeMasterError(`${employee.nameTh} มีอัตราจ้างกับสัญญานี้อยู่แล้ว — แก้เรทได้ที่ปุ่ม "แก้เรท" แทน`, 409);
    }
    await prisma.assignment.update({
      where: { id: existing.id },
      data: { status: 'active', monthlyRate: round2(rate), quotationNo, startDate, endDate: endDate || contract.endDate },
    });
    await logAudit({
      actor,
      action: 'reactivate_assignment',
      entityType: 'assignment',
      entityId: existing.id,
      detail: { employeeId, nameTh: employee.nameTh, contractId, monthlyRate: rate },
    });
  } else {
    const assignmentId = `ASG-${employeeId.slice('EMP-'.length)}-${contractId}`;
    await prisma.assignment.create({
      data: {
        id: assignmentId,
        contractId,
        employeeId,
        quotationNo,
        monthlyRate: round2(rate),
        startDate,
        endDate: endDate || contract.endDate,
        status: 'active',
      },
    });
    await logAudit({
      actor,
      action: 'add_existing_employee_to_contract',
      entityType: 'assignment',
      entityId: assignmentId,
      detail: { employeeId, nameTh: employee.nameTh, contractId, monthlyRate: rate },
    });
  }

  return (await listEmployeesFull({ contractId })).find((e) => e.id === employeeId);
}

export interface UpdateEmployeeInput {
  employeeId: string;
  assignmentId?: string | null;
  nameTh: string;
  nameEn?: string | null;
  invoicePosition: string;
  hrddEmployeeCode?: string | null;
  quotationNo?: string | null;
  monthlyRate: number;
  startDate: string;
  endDate: string;
  actor: string;
}

/** ported from service.js updateEmployee() — แก้ทั้งข้อมูลตัวพนักงาน (ชื่อ/ตำแหน่ง/รหัส HRDD) และ
 * อัตราจ้างของสัญญาที่ระบุ (assignmentId) ในคราวเดียว ต่างจาก updateAssignmentRate() ที่แก้ได้แค่
 * monthly_rate เพียวๆ */
export async function updateEmployee({
  employeeId,
  assignmentId = null,
  nameTh,
  nameEn = null,
  invoicePosition,
  hrddEmployeeCode = null,
  quotationNo = null,
  monthlyRate,
  startDate,
  endDate,
  actor,
}: UpdateEmployeeInput): Promise<EmployeeMasterRow | undefined> {
  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) throw new EmployeeMasterError('ไม่พบพนักงานนี้', 404);
  if (!nameTh || !invoicePosition || !monthlyRate || !startDate || !endDate) {
    throw new EmployeeMasterError('ต้องระบุชื่อ ตำแหน่งบนใบแจ้งหนี้ เรทต่อเดือน และช่วงวันที่ให้ครบ');
  }
  if (assignmentId) {
    const assignment = await prisma.assignment.findFirst({
      where: { id: assignmentId, employeeId },
      include: { contract: { include: { customer: true } } },
    });
    if (!assignment) throw new EmployeeMasterError('ไม่พบอัตราจ้างนี้', 404);
    // แก้ไขพนักงาน/อัตราจ้างของสัญญาที่ผูก FlowAccount แล้วเองไม่ได้ เหมือน createEmployee()/
    // removeAssignment() — ข้อมูลต้องยึดจากใบเสนอราคาใน FlowAccount เป็นหลักเท่านั้น (25 ก.ย. 69)
    assertAssignmentsNotFlowAccountLocked(assignment.contract.customer.flowaccountContactId);
  }

  if (assignmentId) {
    await prisma.$transaction([
      prisma.employee.update({ where: { id: employeeId }, data: { nameTh, nameEn, invoicePosition, hrddEmployeeCode } }),
      prisma.assignment.update({ where: { id: assignmentId }, data: { quotationNo, monthlyRate: Number(monthlyRate), startDate, endDate } }),
    ]);
  } else {
    await prisma.employee.update({ where: { id: employeeId }, data: { nameTh, nameEn, invoicePosition, hrddEmployeeCode } });
  }

  await logAudit({ actor, action: 'update_employee', entityType: 'employee', entityId: employeeId, detail: { nameTh, invoicePosition, monthlyRate } });

  /* ต้นฉบับคืนค่าด้วย listEmployees({}).find(e => e.id===employeeId && e.assignment_id===assignmentId)
   * — เมื่อ assignmentId เป็น null (แก้แค่ข้อมูลพนักงาน ไม่แตะอัตราจ้าง) predicate นี้หาไม่เจอเลยถ้า
   * พนักงานคนนี้มีอัตราจ้างอยู่จริง (ทุกแถวของเขาจะมี assignment_id เป็นค่าจริงเสมอ ไม่มีทางเป็น null) —
   * คืน undefined ในกรณีนั้น เป็นพฤติกรรมเดิมของต้นฉบับที่หน้าเว็บไม่กระทบ (แค่เรียก renderMaster() ใหม่
   * ไม่ได้ใช้ค่าตอบกลับตรงๆ) คงไว้ตามนี้เพื่อความตรงกับต้นฉบับ ไม่ได้ "แก้บั๊ก" ให้ */
  return (await listEmployeesFull({})).find((e) => e.id === employeeId && e.assignmentId === assignmentId);
}

/** ported from service.js removeAssignment() — ลบแค่ "อัตราจ้าง" ที่ผูกกับสัญญานี้เท่านั้น ไม่ได้ลบตัว
 * พนักงานออกจากระบบ (ชื่อพ้อง/ประวัติ Timesheet เดิมยังอยู่ เผื่อย้ายไปผูกสัญญาอื่นทีหลัง) */
export async function removeAssignment(assignmentId: string, { actor }: { actor: string }): Promise<{ ok: true }> {
  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: { contract: { include: { customer: true } } },
  });
  if (!assignment) throw new EmployeeMasterError('ไม่พบอัตราจ้างนี้', 404);
  assertAssignmentsNotFlowAccountLocked(assignment.contract.customer.flowaccountContactId);

  await prisma.assignment.delete({ where: { id: assignmentId } });
  await logAudit({ actor, action: 'remove_assignment', entityType: 'assignment', entityId: assignmentId, detail: { employeeId: assignment.employeeId, contractId: assignment.contractId } });
  return { ok: true };
}

/** ported from service.js addEmployeeAlias() — kind: 'name' (ชื่อ) เท่านั้น ("ตำแหน่งพ้อง"/kind:
 * 'position' ถูกถอดออก 25 ก.ย. 69 — Clear Read อ่านตำแหน่งได้ตรงจากเอกสารอยู่แล้ว ไม่ต้องคอนฟิกล่วงหน้า) */
export async function addEmployeeAlias({
  employeeId,
  kind,
  alias,
  source = 'ป้อนด้วยมือ',
  actor,
}: {
  employeeId: string;
  kind: string;
  alias: string;
  source?: string;
  actor: string;
}): Promise<{ employeeId: string; employeeName: string; kind: string; alias: string }> {
  if (kind !== 'name') throw new EmployeeMasterError("kind ต้องเป็น 'name'");
  const clean = (alias ?? '').trim();
  if (!clean) throw new EmployeeMasterError('ต้องกรอกชื่อพ้อง');

  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) throw new EmployeeMasterError(`ไม่พบพนักงาน ${employeeId}`, 404);

  const dup = await prisma.employeeAlias.findUnique({ where: { employeeId_kind_alias: { employeeId, kind, alias: clean } } });
  if (dup) throw new EmployeeMasterError(`"${clean}" มีอยู่แล้ว`, 409);

  await prisma.employeeAlias.create({ data: { employeeId, kind, alias: clean, source } });
  await logAudit({ actor, action: 'add_alias', entityType: 'employee', entityId: employeeId, detail: { kind, alias: clean } });
  return { employeeId, employeeName: employee.nameTh, kind, alias: clean };
}

/** ported from service.js removeEmployeeAlias() */
export async function removeEmployeeAlias({
  employeeId,
  kind,
  alias,
  actor,
}: {
  employeeId: string;
  kind: string;
  alias: string;
  actor: string;
}): Promise<{ employeeId: string; kind: string; alias: string; removed: true }> {
  const found = await prisma.employeeAlias.findUnique({ where: { employeeId_kind_alias: { employeeId, kind, alias } } });
  if (!found) throw new EmployeeMasterError('ไม่พบชื่อพ้องนี้', 404);

  await prisma.employeeAlias.delete({ where: { employeeId_kind_alias: { employeeId, kind, alias } } });
  await logAudit({ actor, action: 'remove_alias', entityType: 'employee', entityId: employeeId, detail: { kind, alias } });
  return { employeeId, kind, alias, removed: true };
}

/** ported from service.js updateAssignmentRate() — แก้เรทต่อเดือนของสัญญาจ้างรายคนเพียวๆ (ไม่แตะ
 * ใบแจ้งหนี้ที่ออกไปแล้ว — ใบเก่าเก็บยอดของตัวเองไว้แล้ว) `quotationNo` ไม่ระบุ (undefined/null) =
 * คงค่าเดิมไว้ (เทียบเท่า SQL เดิมที่ใช้ COALESCE($qt, quotation_no)) ระบุเป็นสตริง (รวมสตริงว่าง) =
 * ตั้งเป็นค่านั้นตรงๆ */
export async function updateAssignmentRate({
  assignmentId,
  monthlyRate,
  quotationNo,
  actor,
}: {
  assignmentId: string;
  monthlyRate: number;
  quotationNo?: string | null;
  actor: string;
}): Promise<{ assignmentId: string; employeeName: string; from: number; to: number; note: string }> {
  const rate = Number(monthlyRate);
  if (!Number.isFinite(rate) || rate <= 0) throw new EmployeeMasterError('เรทต่อเดือนต้องเป็นจำนวนเงินที่มากกว่า 0');

  const row = await prisma.assignment.findUnique({ where: { id: assignmentId }, include: { employee: true } });
  if (!row) throw new EmployeeMasterError(`ไม่พบสัญญาจ้าง ${assignmentId}`, 404);

  const newRate = round2(rate);
  await prisma.assignment.update({
    where: { id: assignmentId },
    data: { monthlyRate: newRate, quotationNo: quotationNo == null ? undefined : quotationNo },
  });
  await logAudit({ actor, action: 'update_rate', entityType: 'assignment', entityId: assignmentId, detail: { employee: row.employee.nameTh, from: row.monthlyRate, to: newRate } });
  return {
    assignmentId,
    employeeName: row.employee.nameTh,
    from: row.monthlyRate,
    to: newRate,
    note: 'ใบแจ้งหนี้ที่ออกไปแล้วไม่เปลี่ยน — ต้องสั่งคำนวณ Timesheet ใหม่ถ้าอยากให้ใช้เรทใหม่',
  };
}
