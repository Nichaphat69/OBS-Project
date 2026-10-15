/**
 * ลูกค้า & สัญญา — ported from service.js's `createContract`/`updateContract`/`deleteContract`/
 * `updateContractWhtRate`/`listFlowAccountCompanies`. Backs the "ข้อมูลหลัก → ลูกค้า & สัญญา" tab
 * (5.5.6). `setActiveContract`/`deactivateContract` already live in dashboardService.ts (ported
 * in 5.5.1) — not duplicated here.
 */
import { prisma, Prisma } from '@obs/db';
import { round2 } from '@obs/domain';
import { getActiveContract, getSetting, listContracts, type ContractSummary } from './dashboardService.js';
import { FlowAccountClient, resolveDocumentType } from './flowaccountClient.js';
import { logAudit } from './audit.js';
import {
  FA_FIELD_LABELS,
  changedLockedKeys,
  effectiveLockedKeys,
  sanitizeLockedKeys,
  serializeLockedKeys,
} from './faLockedFields.js';

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
            quantity: emp.quantity,
            unitName: emp.unitName,
          },
        });
        created.push(emp.nameTh);
      } else if (
        round2(existing.monthlyRate) !== round2(emp.monthlyRate) ||
        existing.employee.invoicePosition !== emp.invoicePosition
      ) {
        await tx.assignment.update({
          where: { id: existing.id },
          data: { monthlyRate: round2(emp.monthlyRate), quotationNo: company.quotationNo, quantity: emp.quantity, unitName: emp.unitName },
        });
        await tx.employee.update({ where: { id: existing.employeeId }, data: { invoicePosition: emp.invoicePosition } });
        updated.push(emp.nameTh);
      } else {
        // เรท/ตำแหน่งเหมือนเดิม — แต่จำนวน/หน่วยอาจเปลี่ยน อัปเดตเงียบๆ ไม่นับเป็นการเปลี่ยนแปลงของพนักงาน
        await tx.assignment.update({ where: { id: existing.id }, data: { quantity: emp.quantity, unitName: emp.unitName } });
        unchanged += 1;
      }
    }

    // ข้อมูลอ้างอิงจากใบเสนอราคาล่าสุดของสัญญา (เลขที่อ้างอิง/วันที่/พนักงานขาย/หมายเหตุ/ยอด) — ซิงก์ทับได้ เพราะไม่ใช่ค่าที่
    // ใช้คิดเงินและไม่ใช่ค่าที่คนตั้งเอง · PO/วันที่สัญญา/เครดิต/VAT/หัก ณ ที่จ่ายไม่แตะ เพราะคนอาจแก้ให้ต่างจากใบเสนอราคาโดยตั้งใจ
    await tx.contract.update({
      where: { id: contractId },
      data: {
        faReference: company.reference,
        quotationDate: company.quotationDate,
        priceIncludesVat: company.isVatInclusive,
        salesName: company.salesName,
        remarks: company.remarks,
        internalNotes: company.internalNotes,
        quotationSubTotal: company.subTotal,
        quotationDiscount: company.discountAmount,
        quotationGrandTotal: company.grandTotal,
      },
    });

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
    documentType: 'invoice' as const,
  });
  return new FlowAccountClient({ mode: (settings as any).mode, documentType: resolveDocumentType((settings as any).documentType) });
}

export interface FlowAccountEmployeeLine {
  nameTh: string;
  invoicePosition: string;
  monthlyRate: number;
  /** จำนวน/หน่วย/ส่วนลด/VAT ของบรรทัดในใบเสนอราคา (5 ต.ค. 69) — เก็บอ้างอิง ยังไม่ใช้คิดเงิน */
  quantity: number | null;
  unitName: string | null;
  discountAmount: number | null;
  vatRate: number | null;
}

export interface FlowAccountCompany {
  flowaccountContactId: string;
  nameTh: string;
  taxId: string;
  branch: string;
  address: string | null;
  zipCode: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  quotationNo: string | null;
  projectName: string | null;
  // ── ฟิลด์ระดับเอกสารที่ดึงเพิ่ม (5 ต.ค. 69 เจ้าของระบบสั่งให้ดึงจาก FlowAccount ให้ครบ) ชื่อตรงกับ API จริงของ
  // FlowAccount ที่ตรวจกับใบเสนอราคาจริง 20 ใบ ──
  /** "เลขที่อ้างอิง" (reference) — น่าจะเป็นที่ที่ใส่เลข PO แต่มีค่าแค่บางใบ ไม่ใช่ทุกใบ ผู้ใช้ต้องตรวจเองก่อนใช้ */
  reference: string | null;
  /** เครดิตเป็นจำนวนวัน (creditDays) — 0 คือ "ไม่มีเครดิต" ไม่ใช่ "ไม่ได้ตั้ง" */
  creditDays: number | null;
  /** วันที่เอกสาร YYYY-MM-DD (publishedOn) */
  quotationDate: string | null;
  /** หัก ณ ที่จ่าย % ระดับเอกสาร (documentWithholdingTaxPercentage) · 0 = ไม่หัก */
  withholdingPercent: number | null;
  /** VAT % ของบรรทัดแรก (items[].vatRate) */
  vatPercent: number | null;
  /** true = ราคารวมภาษีแล้ว (isVatInclusive) ระบบคิดเงินของเรา "ไม่รวมภาษี" เสมอ ต้องเตือนถ้าเป็น true */
  isVatInclusive: boolean;
  remarks: string | null;
  internalNotes: string | null;
  salesName: string | null;
  subTotal: number | null;
  discountAmount: number | null;
  grandTotal: number | null;
  employees: FlowAccountEmployeeLine[];
  /** ฟิลด์ระดับเอกสารที่เหลือของใบเสนอราคา (12 ต.ค. 69 เจ้าของระบบสั่ง "ทุกฟิลด์ต้องมีตามใน FlowAccount") — แสดงอ่านอย่างเดียว
   * ในฟอร์มเพิ่มบริษัท ค่าส่งผ่านตามที่ FlowAccount ตอบมา (ส่วนมากเป็นข้อความตัวเลข) ไม่แปลง/ไม่คำนวณใหม่ */
  quotationExtra: FlowAccountQuotationExtra;
  /** บริษัทนี้มีอยู่ในระบบแล้วไหม (ตรงด้วย FlowAccount contact หรือเลขผู้เสียภาษี+สาขา) — ถ้ามี การเลือกใบเสนอราคานี้จะเพิ่ม "สัญญาใหม่ให้บริษัทเดิม" ไม่สร้างบริษัทซ้ำ */
  existingCustomerId: string | null;
  /** ใบเสนอราคานี้เคยนำเข้าเป็นสัญญาแล้วหรือยัง (มีสัญญาเลข PO = เลขที่อ้างอิง หรือมีอัตราจ้างที่อ้างเลขใบเสนอราคานี้) */
  alreadyImported: boolean;
  /** "ทุกรายการ" ในใบเสนอราคา (ต่างจาก employees ที่กรองเฉพาะบรรทัดที่เป็นคน) — ไว้แสดงหัวข้อรายการให้ครบเหมือนใน FlowAccount */
  quotationItems: FlowAccountQuotationItem[];
}

export interface FlowAccountQuotationExtra {
  status: string | null;
  contactCode: string | null;
  contactGroup: string | null;
  creditType: string | null;
  dueDate: string | null;
  saleChannel: string | null;
  externalDocumentId: string | null;
  isVat: string | null;
  discountType: string | null;
  discountPercentage: string | null;
  totalAfterDiscount: string | null;
  totalWithoutVat: string | null;
  exemptAmount: string | null;
  vatableAmount: string | null;
  vatAmount: string | null;
  showWithholdingTax: string | null;
  withholdingAmount: string | null;
  deductionType: string | null;
  deductionAmount: string | null;
}

export interface FlowAccountQuotationItem {
  name: string | null;
  description: string | null;
  quantity: string | null;
  unitName: string | null;
  pricePerUnit: string | null;
  discountAmount: string | null;
  vatRate: string | null;
  withHeldPerItem: string | null;
  withHeldPerItemValue: string | null;
  total: string | null;
}

const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const textOrNull = (v: unknown): string | null => {
  const t = typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
  return t ? t : null;
};

/** แปลงใบเสนอราคา 1 ใบจาก FlowAccount เป็นข้อมูลบริษัท+สัญญาที่ใช้เติมฟอร์ม — แยกเป็นฟังก์ชันล้วนเพื่อให้เทสต์ยิงตรงได้ */
export function mapQuotationToCompany(q: any): FlowAccountCompany {
  const items: any[] = Array.isArray(q.items) ? q.items : [];
  return {
    flowaccountContactId: String(q.contactId),
    nameTh: q.contactName || '',
    taxId: q.contactTaxId || '',
    branch: q.contactBranch || '',
    address: q.contactAddress || null,
    zipCode: textOrNull(q.contactZipCode),
    contactName: q.contactPerson || null,
    contactPhone: q.contactNumber || null,
    contactEmail: q.contactEmail || null,
    quotationNo: q.documentSerial ?? null,
    projectName: q.projectName || null,
    reference: textOrNull(q.reference),
    creditDays: numOrNull(q.creditDays),
    quotationDate: typeof q.publishedOn === 'string' && q.publishedOn.length >= 10 ? q.publishedOn.slice(0, 10) : null,
    withholdingPercent: numOrNull(q.documentWithholdingTaxPercentage),
    vatPercent: numOrNull(items[0]?.vatRate),
    isVatInclusive: q.isVatInclusive === true || q.isVatInclusive === 'true',
    remarks: textOrNull(q.remarks),
    internalNotes: textOrNull(q.internalNotes),
    salesName: textOrNull(q.salesName),
    subTotal: numOrNull(q.subTotal),
    discountAmount: numOrNull(q.discountAmount),
    grandTotal: numOrNull(q.grandTotal),
    employees: items
      .filter((item: any) => (item.description || '').trim() && Number(item.pricePerUnit) > 0)
      .map((item: any) => ({
        nameTh: item.description.trim(),
        invoicePosition: item.name || '',
        monthlyRate: Number(item.pricePerUnit) || 0,
        quantity: numOrNull(item.quantity),
        unitName: textOrNull(item.unitName),
        discountAmount: numOrNull(item.discountAmount),
        vatRate: numOrNull(item.vatRate),
      })),
    existingCustomerId: null,
    alreadyImported: false,
    quotationExtra: {
      status: textOrNull(q.statusString ?? q.status),
      contactCode: textOrNull(q.contactCode),
      contactGroup: textOrNull(q.contactGroup),
      creditType: textOrNull(q.creditType),
      dueDate: textOrNull(q.dueDate),
      saleChannel: textOrNull(q.saleAndPurchaseChannel),
      externalDocumentId: textOrNull(q.externalDocumentId),
      isVat: textOrNull(q.isVat),
      discountType: textOrNull(q.discountType),
      discountPercentage: textOrNull(q.discountPercentage),
      totalAfterDiscount: textOrNull(q.totalAfterDiscount),
      totalWithoutVat: textOrNull(q.totalWithoutVat),
      exemptAmount: textOrNull(q.exemptAmount),
      vatableAmount: textOrNull(q.vatableAmount),
      vatAmount: textOrNull(q.vatAmount),
      showWithholdingTax: textOrNull(q.documentShowWithholdingTax),
      withholdingAmount: textOrNull(q.documentWithholdingTaxAmount),
      deductionType: textOrNull(q.documentDeductionType),
      deductionAmount: textOrNull(q.documentDeductionAmount),
    },
    // ทุกบรรทัดตามลำดับใน FlowAccount (รวมหัวข้อ/บรรทัดที่ราคา 0 ที่ employees กรองทิ้ง)
    quotationItems: items.map((item: any) => ({
      name: textOrNull(item.name),
      description: textOrNull(item.description),
      quantity: textOrNull(item.quantity),
      unitName: textOrNull(item.unitName),
      pricePerUnit: textOrNull(item.pricePerUnit),
      discountAmount: textOrNull(item.discountAmount),
      vatRate: textOrNull(item.vatRate),
      withHeldPerItem: textOrNull(item.withHeldPerItem),
      withHeldPerItemValue: textOrNull(item.withHeldPerItemValue),
      total: textOrNull(item.total),
    })),
  };
}

/** อ่านใบเสนอราคาจาก FlowAccount มาช่วยกรอกฟอร์ม "เพิ่มบริษัทใหม่" — read-only external call ไม่มี audit entry
 *
 * 12 ต.ค. 69 ตามที่สั่ง: คืน "ทุกใบเสนอราคา" ไม่ใช่หนึ่งใบต่อบริษัทอีกต่อไป — บริษัทเดียวกันมีหลายสัญญา/หลาย PO พร้อมกันได้
 * (เช่น นาย A เริ่ม ม.ค. PO 202601 กับนาง B เริ่ม ก.พ. PO 202602 ของบริษัทเดียวกัน) แต่ละใบเสนอราคา = หนึ่งสัญญา
 * เดิมเก็บแค่ใบล่าสุดของแต่ละบริษัท ทำให้ใบอื่นของบริษัทเดียวกันเลือกไม่ได้เลย */
export async function listFlowAccountCompanies(): Promise<FlowAccountCompany[]> {
  const client = await newFlowAccountClient();
  const result = await client.listDocuments({ type: 'quotations' });
  const rows: any[] = ((result as any).data?.list ?? []).filter((q: any) => q.contactId && q.isDelete !== true);

  rows.sort(
    (a, b) =>
      (a.contactName ?? '').localeCompare(b.contactName ?? '') || String(b.publishedOn ?? '').localeCompare(String(a.publishedOn ?? '')),
  );
  return enrichFlowAccountCompanies(rows.map(mapQuotationToCompany));
}

/** เติมสถานะเทียบกับข้อมูลในระบบเรา: บริษัทนี้มีอยู่แล้วไหม + ใบเสนอราคานี้นำเข้าแล้วหรือยัง */
export async function enrichFlowAccountCompanies(companies: FlowAccountCompany[]): Promise<FlowAccountCompany[]> {
  if (companies.length === 0) return companies;
  const customers = await prisma.customer.findMany({ select: { id: true, taxId: true, branch: true, flowaccountContactId: true } });
  const poNos = new Set((await prisma.contract.findMany({ select: { poNo: true } })).map((c) => c.poNo.trim()));
  const quotedNos = new Set(
    (await prisma.assignment.findMany({ where: { quotationNo: { not: null } }, select: { quotationNo: true } })).map((a) => String(a.quotationNo)),
  );
  return companies.map((c) => {
    const norm = (v: string | null | undefined) => (v ?? '').trim();
    const customer =
      customers.find((x) => x.flowaccountContactId && x.flowaccountContactId === c.flowaccountContactId) ??
      customers.find((x) => norm(x.taxId) === norm(c.taxId) && norm(x.branch || 'สำนักงานใหญ่') === (norm(c.branch) || 'สำนักงานใหญ่'));
    const imported = (c.reference ? poNos.has(norm(c.reference)) : false) || (c.quotationNo ? quotedNos.has(c.quotationNo) : false);
    return { ...c, existingCustomerId: customer?.id ?? null, alreadyImported: imported };
  });
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
  // ฟิลด์จากใบเสนอราคา FlowAccount (5 ต.ค. 69) — ว่างได้ทั้งหมด
  faReference?: string | null;
  quotationDate?: string | null;
  priceIncludesVat?: boolean;
  salesName?: string | null;
  remarks?: string | null;
  internalNotes?: string | null;
  quotationSubTotal?: number | null;
  quotationDiscount?: number | null;
  quotationGrandTotal?: number | null;
  /** ช่องที่ดึงมาจาก FlowAccount (หน้าเว็บส่งมาตอนเลือกบริษัทจากใบเสนอราคา) — แก้เองไม่ได้ ดู faLockedFields.ts */
  faLockedFields?: unknown;
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
  faReference = null,
  quotationDate = null,
  priceIncludesVat = false,
  salesName = null,
  remarks = null,
  internalNotes = null,
  quotationSubTotal = null,
  quotationDiscount = null,
  quotationGrandTotal = null,
  faLockedFields = null,
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
      // เครดิต 0 วันเป็นค่าที่ถูกต้อง (FlowAccount 13 จาก 20 ใบเป็น 0) — เดิม `|| 30` ทำให้ 0 กลายเป็น 30 เงียบๆ
      creditDays: Number.isFinite(Number(creditDays)) ? Number(creditDays) : 30,
      divisorMode,
      divisorValue: Number(divisorValue) || 20,
      vatRate: Number(vatRate),
      whtRate: Number(whtRate),
      status,
      abbyySkillId: abbyySkillId?.trim() || null,
      faReference: faReference?.trim() || null,
      quotationDate: quotationDate || null,
      priceIncludesVat: Boolean(priceIncludesVat),
      salesName: salesName?.trim() || null,
      remarks: remarks?.trim() || null,
      internalNotes: internalNotes?.trim() || null,
      quotationSubTotal: quotationSubTotal ?? null,
      quotationDiscount: quotationDiscount ?? null,
      quotationGrandTotal: quotationGrandTotal ?? null,
      // ล็อกได้เฉพาะบริษัทที่ผูก FlowAccount จริง — คนอื่นส่งรายการมาก็ไม่เก็บ (ไม่มีอะไรให้ล็อก)
      faLockedFields: customer.flowaccountContactId ? serializeLockedKeys(sanitizeLockedKeys(faLockedFields)) : null,
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
 * กับตอน "เพิ่มลูกค้าใหม่" ที่สร้างทั้งคู่พร้อมกันอยู่แล้ว)
 *
 * ⚠️ `abbyySkillId` ต่างจากฟิลด์อื่นในฟังก์ชันนี้ — **ไม่ส่งคีย์นี้มา = ไม่แตะค่าเดิม** ไม่ใช่ "ล้างเป็น
 * null" ตั้งใจแยกสองสถานะนี้ออกจากกันเพราะหน้าเว็บถอดช่องเลือก Skill ออกจากฟอร์มแก้สัญญาแล้ว (17 ก.ย.
 * 69) ถ้าใช้ค่า default เป็น null แบบฟิลด์อื่น ค่าที่ตั้งไว้จะถูกล้างทิ้งเงียบๆ ตอนมีคนกดแก้สัญญาครั้ง
 * ถัดไป — และเส้น Gmail ที่ดึงไฟล์เข้ามาเองยังใช้ค่านี้เป็นค่าตั้งต้นอยู่ จะกลายเป็นอ่านด้วย Skill ผิดตัว
 * โดยไม่มีอะไรเตือน ส่ง `abbyySkillId: null` มาตรงๆ ยังล้างได้ตามปกติถ้าตั้งใจ */
export async function updateContract(input: UpdateContractInput): Promise<ContractSummary | undefined> {
  const {
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
    actor,
  } = input;
  const contract = await prisma.contract.findUnique({ where: { id: contractId } });
  if (!contract) throw new ContractMasterError('ไม่พบสัญญานี้', 404);
  if (!poNo || !projectName || !startDate || !endDate) {
    throw new ContractMasterError('ต้องระบุเลขที่ใบว่าจ้าง ชื่อโครงการ และช่วงสัญญาให้ครบ');
  }
  if (!customerNameTh || !taxId) {
    throw new ContractMasterError('ต้องระบุชื่อบริษัทและเลขผู้เสียภาษีให้ครบ');
  }

  // ช่องที่ดึงมาจาก FlowAccount แก้เองไม่ได้ (5 ต.ค. 69) — ตรวจก่อนเขียนอะไรลงฐานข้อมูล ไม่ใช่แค่ล็อกที่หน้าเว็บ
  // เทียบเฉพาะคีย์ที่ส่งมาจริง · ค่าเท่าเดิมผ่าน (หน้าเว็บส่งทุกช่องมาเสมอ ช่องที่ล็อกจึงมาด้วยค่าเดิม)
  const customerRow = await prisma.customer.findUnique({ where: { id: contract.customerId } });
  if (customerRow) {
    const locked = effectiveLockedKeys(contract.faLockedFields, customerRow);
    const changed = changedLockedKeys(
      locked,
      {
        customerNameTh: customerRow.nameTh,
        taxId: customerRow.taxId,
        contactName: customerRow.contactName,
        contactPhone: customerRow.contactPhone,
        projectName: contract.projectName,
        vatRate: contract.vatRate,
        whtRate: contract.whtRate,
        creditDays: contract.creditDays,
      },
      {
        customerNameTh,
        taxId,
        ...('contactName' in input ? { contactName } : {}),
        ...('contactPhone' in input ? { contactPhone } : {}),
        projectName,
        ...('vatRate' in input ? { vatRate } : {}),
        ...('whtRate' in input ? { whtRate } : {}),
        ...('creditDays' in input ? { creditDays } : {}),
      },
    );
    if (changed.length > 0) {
      throw new ContractMasterError(
        `แก้ไม่ได้ — ช่อง ${changed.map((k) => FA_FIELD_LABELS[k]).join(', ')} ดึงมาจาก FlowAccount ` +
          'ถ้าข้อมูลไม่ตรง ให้แก้ที่ FlowAccount แล้วซิงก์ใหม่',
        409,
      );
    }
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
        // มีคีย์มา = ตั้งค่าตามนั้น (null = ล้าง) / ไม่มีคีย์ = ไม่ใส่ลง data เลย ค่าเดิมจึงอยู่ครบ
        ...('abbyySkillId' in input ? { abbyySkillId: input.abbyySkillId?.trim() || null } : {}),
      },
    }),
  ]);
  await logAudit({ actor, action: 'update_contract', entityType: 'contract', entityId: contractId, detail: { poNo, projectName, customerNameTh } });
  return (await listContracts()).find((c) => c.id === contractId);
}

/** ported from service.js deleteContract() — กันลบทับประวัติออก INV จริงโดยเผลอ: ถ้าสัญญานี้เคยออก
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
      if (stillAssigned > 0) continue;

      // ไม่มีอัตราจ้างกับสัญญาไหนเหลือแล้ว — ปกติควรลบทิ้งไปด้วยตามที่ comment บนบอก แต่ถ้ายังมีประวัติ
      // อื่นผูกอยู่ (ตั๋วแจ้งปัญหา/Timesheet เก่า/รายการในใบแจ้งหนี้เก่า/บัญชีล็อกอิน/ประวัติอ่านไฟล์/
      // ช่องทางส่ง Timesheet) ต้องข้ามไปเก็บพนักงานไว้แทนที่จะลบ — ไม่งั้น Postgres จะ throw foreign key
      // error ดิบๆ ("Invalid prisma.employee.delete() invocation...") ทำให้การลบ "สัญญา" (สิ่งที่คน
      // ตั้งใจจะลบจริงๆ) พังไปด้วยทั้งที่ไม่เกี่ยวกันเลย (เจ้าของระบบเจอจริง 25 ก.ย. 69 — พนักงานที่เคย
      // แจ้งปัญหาไว้ทำให้ลบสัญญาไม่ได้) เก็บพนักงานไว้เฉยๆ ไม่เสียหายอะไร ไปลบเองทีหลังได้จากหน้า
      // "ข้อมูลหลัก → พนักงาน" ถ้าต้องการจริงๆ
      const [tickets, timesheets, invoiceItems, users, aiReads, submissions] = await Promise.all([
        tx.supportTicket.count({ where: { employeeId } }),
        tx.timesheet.count({ where: { employeeId } }),
        tx.invoiceItem.count({ where: { employeeId } }),
        tx.user.count({ where: { employeeId } }),
        tx.aiRead.count({ where: { employeeId } }),
        tx.timesheetSubmission.count({ where: { employeeId } }),
      ]);
      if (tickets + timesheets + invoiceItems + users + aiReads + submissions > 0) continue;

      await tx.employeeAlias.deleteMany({ where: { employeeId } });
      await tx.employee.delete({ where: { id: employeeId } });
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
  // เก็บละเอียดถึง 0.25% ได้ (เจ้าของระบบสั่งคืน 25 ก.ย. 69 เผื่อวันที่ FlowAccount รองรับเรตทศนิยม) —
  // เคยบังคับเป็น % เต็มตอนเก็บใน 61699d4 ทำให้ค่าที่ตั้งไว้เด้งกลับทุกครั้ง ตั้ง 3.25% ไม่เคยติด
  // การปัดเพื่อกันยอดไม่ตรงกับ FlowAccount ยังอยู่ครบที่ชั้นคำนวณ (buildInvoice()/estimateTimesheetAmount())
  // ไม่ใช่ที่ชั้นเก็บข้อมูล — วันที่ FlowAccount รองรับ ถอดการปัดสองจุดนั้นออกได้เลยโดยไม่ต้องแก้ข้อมูลเดิม
  const rate = Math.round(Number(whtRate) * 10000) / 10000;
  if (!Number.isFinite(rate) || rate < 0 || rate > 0.3) {
    throw new ContractMasterError('อัตราหัก ณ ที่จ่ายต้องอยู่ระหว่าง 0–30%');
  }
  await prisma.contract.update({ where: { id: contractId }, data: { whtRate: rate } });
  await logAudit({ actor, action: 'update_contract_wht_rate', entityType: 'contract', entityId: contractId, detail: { whtRate: rate } });
  return { contractId, whtRate: rate };
}
