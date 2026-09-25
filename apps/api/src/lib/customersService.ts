/** โดเมนอีเมลลูกค้า — ported from service.js's listCustomerDomains/setCustomerEmailDomain/
 * claimCustomerEmailDomain. Read side (activeDomain lookup) already lives in gmailService.ts —
 * this is the write side, for the admin screen and the Gmail-tab "claim on first use" path. */
import { prisma } from '@obs/db';
import { logAudit } from './audit.js';

export class CustomerActionError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export interface CustomerDomainRow {
  id: string;
  name: string;
  emailDomain: string | null;
}

/** ported from abbyySkillsService.ts's nextSkillId() pattern — max+1, zero-padded, all-digit
 * suffix guard (a legacy hand-set id like `CT-26B0113` must never be misparsed as a number). */
async function nextId(prefix: string): Promise<string> {
  const rows = await prisma.customer.findMany({ where: { id: { startsWith: `${prefix}-` } }, select: { id: true } });
  const max = rows.reduce((m, r) => {
    const suffix = r.id.slice(prefix.length + 1);
    const n = /^\d+$/.test(suffix) ? Number(suffix) : NaN;
    return Number.isInteger(n) && n > m ? n : m;
  }, 0);
  return `${prefix}-${String(max + 1).padStart(4, '0')}`;
}

export interface Customer {
  id: string;
  nameTh: string;
  nameEn: string | null;
  taxId: string;
  branch: string | null;
  address: string | null;
  creditDays: number;
  billingPlace: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  flowaccountContactId: string | null;
}

/** ported from service.js createCustomer() — a customer with zero contracts is unusable (no
 * rate, no billing cycle) so the "เพิ่มลูกค้าใหม่" form always calls createContract right after
 * this in the same submit; this function alone never activates anything. */
export async function createCustomer({
  nameTh,
  nameEn = null,
  taxId,
  branch = 'สำนักงานใหญ่',
  address = null,
  creditDays = 30,
  billingPlace = null,
  contactName = null,
  contactPhone = null,
  contactEmail = null,
  flowaccountContactId = null,
  actor,
}: {
  nameTh: string;
  nameEn?: string | null;
  taxId: string;
  branch?: string | null;
  address?: string | null;
  creditDays?: number;
  billingPlace?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  flowaccountContactId?: string | null;
  actor: string;
}): Promise<Customer> {
  if (!nameTh || !taxId) throw new CustomerActionError('ต้องระบุชื่อบริษัทและเลขผู้เสียภาษีให้ครบ');

  /* กันสร้างลูกค้าซ้ำ (25 ก.ย. 69) — เดิมไม่เช็คอะไรเลย กดเพิ่มบริษัทเดิมกี่ครั้งก็ได้แถวใหม่ทุกครั้ง
     จนรายการ "ลูกค้าที่ยังไม่มีสัญญา" มีชื่อเดียวกันซ้อนกันหลายแถว (เจอจริงในระบบ: CP Axtra 2 แถว,
     KMUTNB 2 แถว) เทียบด้วยเลขผู้เสียภาษี + สาขา ไม่ใช่เลขผู้เสียภาษีอย่างเดียว เพราะนิติบุคคลเดียวกัน
     มีได้หลายสาขาจริงๆ และแต่ละสาขาออกบิลแยกใบกัน — ไม่ได้ตั้ง unique ที่ระดับฐานข้อมูลเพราะข้อมูลซ้ำ
     ที่ค้างอยู่ตอนนี้จะทำให้ migration รันไม่ผ่าน ต้องเคลียร์ของเดิมให้หมดก่อนถึงจะตั้งได้ */
  const branchName = branch ?? 'สำนักงานใหญ่';
  const duplicate = await prisma.customer.findFirst({ where: { taxId, branch: branchName } });
  if (duplicate) {
    throw new CustomerActionError(
      `มีลูกค้าเลขผู้เสียภาษี ${taxId} (${branchName}) อยู่แล้วคือ "${duplicate.nameTh}" — เพิ่มสัญญาให้รายเดิมแทนการสร้างใหม่`,
      409,
    );
  }

  const id = await nextId('CUS');
  const row = await prisma.customer.create({
    data: {
      id,
      nameTh,
      nameEn,
      taxId,
      branch,
      address,
      creditDays: Number(creditDays) || 30,
      billingPlace,
      contactName,
      contactPhone,
      contactEmail,
      flowaccountContactId: flowaccountContactId ? String(flowaccountContactId) : null,
      createdAt: new Date().toISOString(),
    },
  });
  await logAudit({ actor, action: 'create_customer', entityType: 'customer', entityId: id, detail: { nameTh, taxId } });
  return row;
}

/** ลูกค้าที่สร้างไว้แล้วแต่ยังไม่มีสัญญาเลยสักฉบับ — ใช้ตอนสร้างลูกค้าใหม่แบบแยกขั้นตอน (กรอกแค่ชื่อ+
 * เลขผู้เสียภาษีก่อน แล้วค่อยกลับมาเพิ่มสัญญาทีหลัง) ลูกค้ากลุ่มนี้ยัง "ใช้งานไม่ได้" ตามคอมเมนต์ของ
 * createCustomer() ด้านบน จึงต้องมีที่ให้กลับมาหาแล้วเพิ่มสัญญาต่อได้ ไม่งั้นจะหายไปจากหน้านี้ถาวร */
export async function listCustomersWithoutContract(): Promise<Customer[]> {
  return prisma.customer.findMany({
    where: { contracts: { none: {} } },
    orderBy: { createdAt: 'desc' },
  });
}

/** ลบลูกค้าที่ยังไม่มีสัญญาทิ้ง (25 ก.ย. 69) — เดิมไม่มีทางลบเลย ลูกค้าที่สร้างค้างไว้ (กรอกชื่อ+เลข
 * ผู้เสียภาษีแล้วไม่ได้เพิ่มสัญญาต่อ) หรือที่สร้างซ้ำ จึงค้างในรายการ "ลูกค้าที่ยังไม่มีสัญญา" ถาวร
 *
 * ลบได้เฉพาะรายที่ไม่มีสัญญาเท่านั้น — มีสัญญาแล้วแปลว่ามี Timesheet/ใบแจ้งหนี้ห้อยอยู่ข้างหลังได้
 * ต้องไปปิดสัญญาก่อน ไม่ใช่ลบลูกค้าทิ้งทั้งราย วันหยุดเฉพาะของลูกค้ารายนั้นลบไปพร้อมกันในทรานแซกชัน
 * เดียว (ไม่มีลูกค้าแล้วปฏิทินเฉพาะรายก็ไม่มีความหมาย และถ้าเหลือไว้ foreign key จะบล็อกการลบ) */
export async function deleteCustomer(customerId: string, { actor }: { actor: string }): Promise<{ ok: true }> {
  const customer = await getCustomerOrThrow(customerId);

  const contracts = await prisma.contract.count({ where: { customerId } });
  if (contracts > 0) {
    throw new CustomerActionError(
      `"${customer.nameTh}" มีสัญญาอยู่ ${contracts} ฉบับ — ลบลูกค้าไม่ได้ ต้องลบสัญญาให้หมดก่อน`,
      409,
    );
  }

  const holidays = await prisma.holiday.count({ where: { customerId } });
  await prisma.$transaction([
    prisma.holiday.deleteMany({ where: { customerId } }),
    prisma.customer.delete({ where: { id: customerId } }),
  ]);
  await logAudit({
    actor,
    action: 'delete_customer',
    entityType: 'customer',
    entityId: customerId,
    detail: { nameTh: customer.nameTh, taxId: customer.taxId, holidaysRemoved: holidays },
  });
  return { ok: true };
}

export async function listCustomerDomains(): Promise<CustomerDomainRow[]> {
  const rows = await prisma.customer.findMany({
    orderBy: { nameTh: 'asc' },
    select: { id: true, nameTh: true, emailDomain: true },
  });
  return rows.map((r) => ({ id: r.id, name: r.nameTh, emailDomain: r.emailDomain }));
}

async function getCustomerOrThrow(customerId: string) {
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) throw new CustomerActionError('ไม่พบลูกค้ารายนี้', 404);
  return customer;
}

/** ported from service.js setCustomerEmailDomain() — admin/accounting only; empty string clears
 * the filter (บริษัทที่ไม่ได้ตั้งไว้จะเห็นทุกฉบับใน Gmail intake) */
export async function setCustomerEmailDomain(customerId: string, domain: string | null, { actor }: { actor: string }): Promise<CustomerDomainRow> {
  await getCustomerOrThrow(customerId);
  const normalized = (domain ?? '').trim().toLowerCase() || null;

  const row = await prisma.customer.update({ where: { id: customerId }, data: { emailDomain: normalized } });
  await logAudit({ actor, action: 'set_customer_email_domain', entityType: 'customer', entityId: customerId, detail: { domain: normalized } });
  return { id: row.id, name: row.nameTh, emailDomain: row.emailDomain };
}

/** ported from service.js claimCustomerEmailDomain() — first-time-only path from the Gmail
 * intake screen (accounting can use this; only admin can overwrite an existing domain). */
export async function claimCustomerEmailDomain(customerId: string, domain: string, { actor }: { actor: string }): Promise<CustomerDomainRow> {
  const customer = await getCustomerOrThrow(customerId);
  const normalized = (domain ?? '').trim().toLowerCase();
  if (!normalized) throw new CustomerActionError('ต้องระบุโดเมนอีเมล');
  if (customer.emailDomain) {
    throw new CustomerActionError('บริษัทนี้มีโดเมนตั้งไว้แล้ว — ให้ admin เป็นคนแก้ที่ "จัดการระบบ → โดเมนอีเมล" แทน', 409);
  }

  const row = await prisma.customer.update({ where: { id: customerId }, data: { emailDomain: normalized } });
  await logAudit({ actor, action: 'claim_customer_email_domain', entityType: 'customer', entityId: customerId, detail: { domain: normalized } });
  return { id: row.id, name: row.nameTh, emailDomain: row.emailDomain };
}
