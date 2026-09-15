/**
 * ลูกค้า & สัญญา — ported from service.js's `createContract`/`updateContract`/`deleteContract`/
 * `updateContractWhtRate`/`listFlowAccountCompanies`. Backs the "ข้อมูลหลัก → ลูกค้า & สัญญา" tab
 * (5.5.6). `setActiveContract`/`deactivateContract` already live in dashboardService.ts (ported
 * in 5.5.1) — not duplicated here.
 */
import { prisma, Prisma } from '@obs/db';
import { round2 } from '@obs/domain';
import { getActiveContract, getSetting, listContracts, type ContractSummary } from './dashboardService.js';
import { FlowAccountClient } from './flowaccountClient.js';
import { logAudit } from './audit.js';

export class ContractMasterError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** รับ client เป็น optional (เดิม hardcode `prisma` ตัวเดียว) — ต้องรับ `tx` ตอนเรียกจากในทรานแซกชัน
 * เดียวกันของ syncAssignmentsFromFlowAccount() (สร้างพนักงานหลายคนในลูปเดียว) ไม่งั้นแถวใหม่ที่เพิ่ง
 * สร้างในทรานแซกชันเดียวกันจะยังไม่ commit จริง อ่านผ่าน `prisma` ตัวนอกจะไม่เห็น ทำให้คำนวณเลขซ้ำกัน
 * ได้ (แถวที่ 2 เป็นต้นไปในลูปเดียวกันชนกับแถวที่ 1) */
async function nextEmployeeId(client: Prisma.TransactionClient | typeof prisma = prisma): Promise<string> {
  const rows = await client.employee.findMany({ where: { id: { startsWith: 'EMP-' } }, select: { id: true } });
  const max = rows.reduce((m, r) => {
    const suffix = r.id.slice('EMP-'.length);
    const n = /^\d+$/.test(suffix) ? Number(suffix) : NaN;
    return Number.isInteger(n) && n > m ? n : m;
  }, 0);
  return `EMP-${String(max + 1).padStart(4, '0')}`;
}

export interface SyncAssignmentsResult {
  contractId: string;
  quotationNo: string | null;
  created: string[];
  updated: string[];
  deactivated: string[];
  unchanged: number;
}

/** ซิงก์รายชื่อ+เรทพนักงานของสัญญาที่ผูกกับ FlowAccount แล้ว จากใบเสนอราคาล่าสุดของบริษัทนั้นตรงๆ —
 * ทางเดียวที่ทำให้จำนวน/เรทพนักงานในสัญญาเปลี่ยนได้หลังผูก FlowAccount แล้ว (ดู
 * assertAssignmentsNotFlowAccountLocked ใน employeesMasterService.ts ที่ปิดทางเพิ่ม/ลบเองไปแล้ว)
 * จับคู่ด้วยชื่อพนักงาน (ตัดช่องว่างหัวท้าย) — คนที่มีอยู่แล้วอัปเดตเรท/ตำแหน่ง, คนใหม่สร้างเพิ่ม, คนที่
 * หายไปจากใบเสนอราคา **ปิดสถานะเป็น inactive ไม่ลบทิ้ง** (กันประวัติ Timesheet เดิมพัง) */
export async function syncAssignmentsFromFlowAccount(
  contractId: string,
  { actor }: { actor: string },
): Promise<SyncAssignmentsResult> {
  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    include: { customer: true, assignments: { where: { status: 'active' }, include: { employee: true } } },
  });
  if (!contract) throw new ContractMasterError('ไม่พบสัญญานี้', 404);
  if (!contract.customer.flowaccountContactId) {
    throw new ContractMasterError('สัญญานี้ยังไม่ได้ผูกกับบริษัทใน FlowAccount — ไม่มีอะไรให้ซิงก์', 409);
  }

  const companies = await listFlowAccountCompanies();
  const company = companies.find((c) => c.flowaccountContactId === contract.customer.flowaccountContactId);
  if (!company) {
    throw new ContractMasterError('ไม่พบใบเสนอราคาของบริษัทนี้ใน FlowAccount', 404);
  }

  const normalize = (s: string) => s.trim().toLowerCase();
  const currentByName = new Map(contract.assignments.map((a) => [normalize(a.employee.nameTh), a]));
  const targetNames = new Set(company.employees.map((e) => normalize(e.nameTh)));

  const created: string[] = [];
  const updated: string[] = [];
  const deactivated: string[] = [];
  let unchanged = 0;

  // ⚠️ เดิมแต่ละคนในลูปอยู่คนละ $transaction([...]) แยกกัน — ถ้าคนที่ 3 จาก 5 fail กลางทาง (เช่น DB
  // สะดุดชั่วคราว) คนที่ 1-2 commit ไปแล้ว คนที่ 4-5 ไม่ถูกลองเลย และลูป deactivate ท้ายฟังก์ชันก็ไม่มี
  // โอกาสได้รันเลย เพราะ error โยนออกจากฟังก์ชันไปก่อนถึงตรงนั้น — ผลคือซิงก์ค้างครึ่งๆกลางๆแบบไม่มีใคร
  // รู้ตัว (เจอจริง 15 ก.ย. 69 ตอนไล่ตรวจ audit ทั้งระบบ) ครอบทั้งลูปสร้าง/อัปเดต/ปิดสถานะไว้ใน
  // transaction เดียวกันแทน — ถ้าจุดไหน fail ทั้งหมด rollback กลับที่เดิมเป๊ะ ไม่มีทางค้างครึ่งๆกลางๆ
  // (การเรียก listFlowAccountCompanies() ที่ยิง FlowAccount จริงทำไปแล้วก่อนหน้านี้ ไม่อยู่ในทรานแซกชัน
  // นี้ — ไม่ควรถือ DB lock ค้างไว้ระหว่างรอ network call ภายนอกที่อาจช้า)
  await prisma.$transaction(async (tx) => {
    for (const emp of company.employees) {
      const existing = currentByName.get(normalize(emp.nameTh));
      if (!existing) {
        const id = await nextEmployeeId(tx);
        const assignmentId = `ASG-${id.slice('EMP-'.length)}-${contractId}`;
        await tx.employee.create({
          data: { id, nameTh: emp.nameTh, invoicePosition: emp.invoicePosition, createdAt: new Date().toISOString() },
        });
        await tx.assignment.create({
          data: {
            id: assignmentId,
            contractId,
            employeeId: id,
            quotationNo: company.quotationNo,
            monthlyRate: emp.monthlyRate,
            startDate: contract.startDate,
            endDate: contract.endDate,
            status: 'active',
          },
        });
        created.push(emp.nameTh);
      } else if (
        round2(existing.monthlyRate) !== round2(emp.monthlyRate) ||
        existing.employee.invoicePosition !== emp.invoicePosition
      ) {
        await tx.assignment.update({ where: { id: existing.id }, data: { monthlyRate: round2(emp.monthlyRate), quotationNo: company.quotationNo } });
        await tx.employee.update({ where: { id: existing.employeeId }, data: { invoicePosition: emp.invoicePosition } });
        updated.push(emp.nameTh);
      } else {
        unchanged += 1;
      }
    }

    for (const assignment of contract.assignments) {
      if (!targetNames.has(normalize(assignment.employee.nameTh))) {
        await tx.assignment.update({ where: { id: assignment.id }, data: { status: 'inactive', endDate: new Date().toISOString().slice(0, 10) } });
        deactivated.push(assignment.employee.nameTh);
      }
    }
  });

  await logAudit({
    actor,
    action: 'sync_assignments_from_flowaccount',
    entityType: 'contract',
    entityId: contractId,
    detail: { quotationNo: company.quotationNo, created, updated, deactivated, unchanged },
  });

  return { contractId, quotationNo: company.quotationNo, created, updated, deactivated, unchanged };
}

/** ported from service.js newFlowAccountClient() — same pattern already used privately in
 * cyclesService.ts (settings override once saved, else .env fallback). */
async function newFlowAccountClient(): Promise<FlowAccountClient> {
  const settings = await getSetting('flowaccount', {
    mode: process.env.FLOWACCOUNT_MODE ?? 'dry-run',
    documentType: 'billing-note' as const,
  });
  return new FlowAccountClient({ mode: (settings as any).mode, documentType: (settings as any).documentType });
}

export interface FlowAccountCompany {
  flowaccountContactId: string;
  nameTh: string;
  taxId: string;
  branch: string;
  address: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  quotationNo: string | null;
  projectName: string | null;
  employees: Array<{ nameTh: string; invoicePosition: string; monthlyRate: number }>;
}

/** ported from service.js listFlowAccountCompanies() — reads existing quotations from
 * FlowAccount to autofill "เพิ่มลูกค้าใหม่" (name/tax id/contact/project + a ready-made employee
 * list from the quotation's line items). Read-only external call, no audit entry (matches
 * original). Dedupes by contactId keeping the most recently published quotation per company. */
export async function listFlowAccountCompanies(): Promise<FlowAccountCompany[]> {
  const client = await newFlowAccountClient();
  const result = await client.listDocuments({ type: 'quotations' });
  const rows: any[] = (result as any).data?.list ?? [];

  const byContact = new Map<string, any>();
  for (const q of rows) {
    if (!q.contactId) continue;
    const existing = byContact.get(q.contactId);
    if (existing && existing.publishedOn >= q.publishedOn) continue;
    byContact.set(q.contactId, q);
  }

  return [...byContact.values()]
    .sort((a, b) => (a.contactName ?? '').localeCompare(b.contactName ?? ''))
    .map((q) => ({
      flowaccountContactId: String(q.contactId),
      nameTh: q.contactName || '',
      taxId: q.contactTaxId || '',
      branch: q.contactBranch || 'สำนักงานใหญ่',
      address: q.contactAddress || null,
      contactName: q.contactPerson || null,
      contactPhone: q.contactNumber || null,
      contactEmail: q.contactEmail || null,
      quotationNo: q.documentSerial ?? null,
      projectName: q.projectName || null,
      employees: (q.items ?? [])
        .filter((item: any) => (item.description || '').trim() && Number(item.pricePerUnit) > 0)
        .map((item: any) => ({
          nameTh: item.description.trim(),
          invoicePosition: item.name || '',
          monthlyRate: Number(item.pricePerUnit) || 0,
        })),
    }));
}

/** ported from abbyySkillsService.ts's nextSkillId() pattern */
async function nextId(prefix: string): Promise<string> {
  const rows = await prisma.contract.findMany({ where: { id: { startsWith: `${prefix}-` } }, select: { id: true } });
  const max = rows.reduce((m, r) => {
    const suffix = r.id.slice(prefix.length + 1);
    const n = /^\d+$/.test(suffix) ? Number(suffix) : NaN;
    return Number.isInteger(n) && n > m ? n : m;
  }, 0);
  return `${prefix}-${String(max + 1).padStart(4, '0')}`;
}

export interface CreateContractInput {
  customerId: string;
  poNo: string;
  contractNo?: string | null;
  projectName: string;
  poDate?: string | null;
  startDate: string;
  endDate: string;
  creditDays?: number;
  divisorMode?: string;
  divisorValue?: number;
  vatRate?: number;
  whtRate?: number;
  abbyySkillId?: string | null;
  actor: string;
}

/** ported from service.js createContract() — สัญญาใหม่เริ่มเป็น 'inactive' เสมอ ยกเว้นระบบยังไม่มี
 * สัญญา active เลยสักฉบับ (กรณีนั้นตั้งให้ active ทันที ไม่งั้นแดชบอร์ดจะไม่มีอะไรให้แสดงเลย) */
export async function createContract({
  customerId,
  poNo,
  contractNo = null,
  projectName,
  poDate = null,
  startDate,
  endDate,
  creditDays = 30,
  divisorMode = 'fixed',
  divisorValue = 20,
  vatRate = 0.07,
  whtRate = 0.03,
  abbyySkillId = null,
  actor,
}: CreateContractInput): Promise<ContractSummary | undefined> {
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) throw new ContractMasterError('ไม่พบลูกค้ารายนี้', 404);
  if (!poNo || !projectName || !startDate || !endDate) {
    throw new ContractMasterError('ต้องระบุเลขที่ใบว่าจ้าง ชื่อโครงการ และช่วงสัญญาให้ครบ');
  }

  const id = await nextId('CT');
  const hasActive = Boolean(await getActiveContract());
  const status = hasActive ? 'inactive' : 'active';

  await prisma.contract.create({
    data: {
      id,
      customerId,
      poNo,
      contractNo,
      projectName,
      poDate,
      startDate,
      endDate,
      creditDays: Number(creditDays) || 30,
      divisorMode,
      divisorValue: Number(divisorValue) || 20,
      vatRate: Number(vatRate),
      whtRate: Number(whtRate),
      status,
      abbyySkillId: abbyySkillId?.trim() || null,
      createdAt: new Date().toISOString(),
    },
  });
  await logAudit({ actor, action: 'create_contract', entityType: 'contract', entityId: id, detail: { customerId, poNo, projectName, status } });
  return (await listContracts()).find((c) => c.id === id);
}

export interface UpdateContractInput {
  contractId: string;
  poNo: string;
  contractNo?: string | null;
  projectName: string;
  startDate: string;
  endDate: string;
  creditDays?: number;
  divisorMode?: string;
  divisorValue?: number;
  vatRate?: number;
  whtRate?: number;
  customerNameTh: string;
  taxId: string;
  contactName?: string | null;
  contactPhone?: string | null;
  billingPlace?: string | null;
  abbyySkillId?: string | null;
  actor: string;
}

/** ported from service.js updateContract() — แก้ทั้ง customers + contracts ในคราวเดียว (ฟอร์มเดียว
 * กับตอน "เพิ่มลูกค้าใหม่" ที่สร้างทั้งคู่พร้อมกันอยู่แล้ว) */
export async function updateContract({
  contractId,
  poNo,
  contractNo = null,
  projectName,
  startDate,
  endDate,
  creditDays = 30,
  divisorMode = 'fixed',
  divisorValue = 20,
  vatRate = 0.07,
  whtRate = 0.03,
  customerNameTh,
  taxId,
  contactName = null,
  contactPhone = null,
  billingPlace = null,
  abbyySkillId = null,
  actor,
}: UpdateContractInput): Promise<ContractSummary | undefined> {
  const contract = await prisma.contract.findUnique({ where: { id: contractId } });
  if (!contract) throw new ContractMasterError('ไม่พบสัญญานี้', 404);
  if (!poNo || !projectName || !startDate || !endDate) {
    throw new ContractMasterError('ต้องระบุเลขที่ใบว่าจ้าง ชื่อโครงการ และช่วงสัญญาให้ครบ');
  }
  if (!customerNameTh || !taxId) {
    throw new ContractMasterError('ต้องระบุชื่อบริษัทและเลขผู้เสียภาษีให้ครบ');
  }

  await prisma.$transaction([
    prisma.customer.update({
      where: { id: contract.customerId },
      data: { nameTh: customerNameTh, taxId, contactName, contactPhone, billingPlace },
    }),
    prisma.contract.update({
      where: { id: contractId },
      data: {
        poNo,
        contractNo,
        projectName,
        startDate,
        endDate,
        creditDays: Number(creditDays) || 30,
        divisorMode,
        divisorValue: Number(divisorValue) || 20,
        vatRate: Number(vatRate),
        whtRate: Number(whtRate),
        abbyySkillId: abbyySkillId?.trim() || null,
      },
    }),
  ]);
  await logAudit({ actor, action: 'update_contract', entityType: 'contract', entityId: contractId, detail: { poNo, projectName, customerNameTh } });
  return (await listContracts()).find((c) => c.id === contractId);
}

/** ported from service.js deleteContract() — กันลบทับประวัติวางบิลจริงโดยเผลอ: ถ้าสัญญานี้เคยออก
 * ใบแจ้งหนี้ไปแล้วแม้แต่ใบเดียว ห้ามลบทั้งหมด (ไม่ใช่ลบได้บางส่วน) พนักงานที่ผูกกับสัญญานี้เพียง
 * อย่างเดียวลบทิ้งไปด้วย แต่ถ้ามีอัตราจ้างกับสัญญาอื่นด้วย เก็บไว้ */
export async function deleteContract(contractId: string, { actor }: { actor: string }): Promise<{ deleted: true; contractId: string }> {
  const contract = await prisma.contract.findUnique({ where: { id: contractId } });
  if (!contract) throw new ContractMasterError('ไม่พบสัญญานี้', 404);

  const invoiceCount = await prisma.invoice.count({ where: { contractId } });
  if (invoiceCount > 0) {
    throw new ContractMasterError(`ลบไม่ได้ — สัญญานี้เคยออกใบแจ้งหนี้ไปแล้ว ${invoiceCount} ใบ`);
  }

  await prisma.$transaction(async (tx) => {
    // timesheets → cascades to timesheet_days/leave_days/overtime_days automatically (schema.prisma)
    await tx.timesheet.deleteMany({ where: { contractId } });
    await tx.cycleApproval.deleteMany({ where: { contractId } });

    const assignments = await tx.assignment.findMany({ where: { contractId }, select: { employeeId: true } });
    await tx.assignment.deleteMany({ where: { contractId } });

    for (const { employeeId } of assignments) {
      const stillAssigned = await tx.assignment.count({ where: { employeeId } });
      if (stillAssigned === 0) {
        await tx.employeeAlias.deleteMany({ where: { employeeId } });
        await tx.employee.delete({ where: { id: employeeId } });
      }
    }

    await tx.contract.delete({ where: { id: contractId } });
  });

  await logAudit({ actor, action: 'delete_contract', entityType: 'contract', entityId: contractId, detail: { poNo: contract.poNo, projectName: contract.projectName } });
  return { deleted: true, contractId };
}

/** ported from service.js updateContractWhtRate() — แก้เฉพาะอัตราหัก ณ ที่จ่าย แยกจาก
 * updateContract() ตรงๆ เพราะ updateContract() เป็น full-replace ต้องมีครบทุกฟิลด์ ใช้จากหน้าตรวจ
 * Timesheet (ตัวเลือกประเภทหัก ณ ที่จ่าย) ไม่ใช่จากแท็บ "ข้อมูลหลัก" โดยตรง */
export async function updateContractWhtRate(contractId: string, whtRate: number, { actor }: { actor: string }): Promise<{ contractId: string; whtRate: number }> {
  const contract = await prisma.contract.findUnique({ where: { id: contractId } });
  if (!contract) throw new ContractMasterError('ไม่พบสัญญานี้', 404);
  const rate = Number(whtRate);
  if (!Number.isFinite(rate) || rate < 0 || rate > 0.3) {
    throw new ContractMasterError('อัตราหัก ณ ที่จ่ายต้องอยู่ระหว่าง 0–30%');
  }
  await prisma.contract.update({ where: { id: contractId }, data: { whtRate: rate } });
  await logAudit({ actor, action: 'update_contract_wht_rate', entityType: 'contract', entityId: contractId, detail: { whtRate: rate } });
  return { contractId, whtRate: rate };
}
