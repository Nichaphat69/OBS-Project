import type { Request } from 'express';
import { prisma } from '@obs/db';
import { getActiveContract } from './dashboardService.js';

/**
 * ตัวกรองขอบเขตข้อมูล "site/บริษัท · เลขที่ PO · พนักงาน" บนแถบบน (1 ต.ค. 69 ตามที่เจ้าของระบบขอ)
 *
 * เดิมแถบบนเลือกได้ทีละสัญญาเดียว (ธง status='active' ของสัญญาทั้งระบบ) แต่ site เดียวกันมีพนักงานหลายคน
 * คนละใบว่าจ้าง คนละ PO คนละรอบสัญญา (เช่น นางก. PO 202601 ม.ค.–มี.ค. · นางข. PO 202623 ก.พ.–มิ.ย.) จึงต้อง
 * กรองได้หลายแบบ — ช่องไหนไม่เลือก = "ทั้งหมดของช่องนั้น" ภายใต้ช่องที่เลือกไว้
 *
 * ตัวกรองส่งมาได้สองทาง: query string (customerId/contractId/employeeId — ระบุชัดเจนต่อคำขอ ชนะเสมอ)
 * หรือ cookie `obs_scope` ที่แถบบนตั้งไว้ (ทำให้ทุกหน้า/ทุก endpoint เห็นขอบเขตเดียวกันโดยไม่ต้องแก้ทีละหน้า
 * และฝั่ง server component ก็อ่านได้เพราะส่ง cookie ต่อไปอยู่แล้ว)
 *
 * ⚠️ กติกาเดิมที่ต้องรักษาไว้: "ไม่ได้ระบุ" ต้องแคบลง ไม่ใช่กว้างขึ้น (ดูเหตุการณ์ 17 ก.ย. 69 ใน routes/timesheets.ts)
 * จึงแยก "ไม่ได้เลือก" ออกจาก "เลือกทุกบริษัทอย่างชัดเจน":
 *  · ไม่มีตัวกรองและไม่มี cookie → admin/บัญชีได้สัญญาที่กำลังดำเนินการอยู่ (executive ได้ทุกบริษัท)
 *  · cookie `{"all":true}` (แถบบนตั้งให้เมื่อผู้ใช้กดเลือก "ทุก site/ทุก PO/ทุกคน" จนไม่เหลือตัวกรอง) → ทุกบริษัท
 *    ทุก role ที่เข้าถึงหน้านั้นได้ (1 ต.ค. 69 เจ้าของระบบสั่งให้ admin/บัญชีเลือกตัวกรองได้ทุกกรณี รวมถึงดูทั้งหมด —
 *    เปลี่ยนจากนโยบายเดิมที่ให้ดูข้ามบริษัททั้งหมดเฉพาะ executive)
 */

export const SCOPE_COOKIE = 'obs_scope';

export interface ScopeFilters {
  customerId: string | null;
  contractId: string | null;
  employeeId: string | null;
}

const EMPTY: ScopeFilters = { customerId: null, contractId: null, employeeId: null };

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 && v.length <= 200 ? v : null;
}

/** อ่านจาก cookie — ค่าจาก client เชื่อไม่ได้ จึงรับเฉพาะ string สามช่องที่รู้จักเท่านั้น (ค่าที่ไม่มีจริงในฐานข้อมูล
 * จะไม่ตรงกับสัญญาใดเลย ผลคือรายการว่าง ไม่ใช่ข้อมูลรั่ว) */
export function parseScopeCookie(raw: unknown): ScopeFilters {
  if (typeof raw !== 'string' || !raw) return EMPTY;
  try {
    const o = JSON.parse(raw);
    // employeeId จาก cookie ไม่รับแล้ว — ตัวกรองพนักงานเอาออกจากแถบบน (1 ต.ค. 69) ค่าเก่าที่ค้างอยู่ต้องไม่กรองเงียบๆ
    // (ยังรับผ่าน query string แบบระบุชัดเจนอยู่ เผื่อใช้เรียก API ตรง)
    // รับแค่ contractId จาก cookie — ตัวกรอง Site/พนักงานเอาออกจากแถบบนแล้ว (2 ต.ค. 69) ค่าเก่าที่ค้างอยู่ต้องไม่กรองเงียบๆ
    return { customerId: null, contractId: str(o?.contractId), employeeId: null };
  } catch {
    return EMPTY;
  }
}

export function filtersFromRequest(req: Request): ScopeFilters {
  const q = {
    customerId: str(req.query.customerId),
    contractId: str(req.query.contractId),
    employeeId: str(req.query.employeeId),
  };
  if (q.customerId || q.contractId || q.employeeId) return q;
  return parseScopeCookie(req.cookies?.[SCOPE_COOKIE]);
}

/** ผู้ใช้เลือก "ทุกบริษัท" เองอย่างชัดเจน (ไม่ใช่แค่ยังไม่ได้เลือก) */
export function scopeAllRequested(req: Request): boolean {
  const raw = req.cookies?.[SCOPE_COOKIE];
  if (typeof raw !== 'string') return false;
  try {
    return JSON.parse(raw)?.all === true;
  } catch {
    return false;
  }
}

export const hasAnyFilter = (f: ScopeFilters) => Boolean(f.customerId || f.contractId || f.employeeId);

/** สัญญาที่ตรงกับ "ทุกช่องที่เลือก" พร้อมกัน — พนักงานนับจาก assignment ใดก็ได้ในสัญญา (แม้หมดช่วงแล้ว
 * ก็ยังต้องเห็นประวัติของสัญญานั้น) */
export async function resolveScopeIds(f: ScopeFilters): Promise<string[]> {
  const rows = await prisma.contract.findMany({
    where: {
      ...(f.customerId ? { customerId: f.customerId } : {}),
      ...(f.contractId ? { id: f.contractId } : {}),
      ...(f.employeeId ? { assignments: { some: { employeeId: f.employeeId } } } : {}),
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

export interface RequestScope {
  filters: ScopeFilters;
  /** null = ทุกสัญญา (เฉพาะ executive ที่ไม่เลือกตัวกรอง หรือ `?all=1` ที่ route อนุญาต) */
  contractIds: string[] | null;
}

export async function requestScope(req: Request, opts: { allowAll?: boolean } = {}): Promise<RequestScope> {
  const filters = filtersFromRequest(req);
  if (hasAnyFilter(filters)) {
    return { filters, contractIds: await resolveScopeIds(filters) };
  }
  const wantsAll = req.query.all === '1' || req.query.all === 'true';
  if (req.user?.role === 'executive' || scopeAllRequested(req) || (wantsAll && opts.allowAll)) {
    return { filters, contractIds: null };
  }
  const active = await getActiveContract();
  // ไม่ได้เลือกอะไร + ไม่มีสัญญาไหนเปิดอยู่เลย: แถบบนแสดงว่า "ทุก PO" (ดู ScopeProvider ฝั่งเว็บ: ไม่มีสัญญาที่เปิดอยู่ = ไม่มีตัวกรอง)
  // ฝั่งข้อมูลต้องตรงกัน — เดิมคืนรายการว่างทั้งที่แถบบอกว่าดูทุก PO ทำให้หน้าข้อมูลหลัก/พนักงานว่างเปล่าทั้งที่มีสัญญาอยู่ (12 ต.ค. 69)
  // เฉพาะ admin/บัญชีที่เลือกดูทุก PO เองได้อยู่แล้ว role อื่นยังได้รายการว่างเหมือนเดิม
  if (!active && (req.user?.role === 'admin' || req.user?.role === 'accounting')) return { filters, contractIds: null };
  return { filters, contractIds: active ? [active.id] : [] };
}

export interface FilterOptionContract {
  id: string;
  poNo: string;
  contractNo: string | null;
  projectName: string;
  customerId: string;
  customerName: string;
  startDate: string;
  endDate: string;
  status: string;
  /** true = บริษัทของสัญญานี้ผูกกับ FlowAccount (ดึงมาจากใบเสนอราคา) — เพิ่ม/ลบพนักงานเองไม่ได้ · false = สัญญาที่กรอกเองในระบบ เพิ่มพนักงานได้ */
  flowaccountLinked: boolean;
  /** เลขใบเสนอราคา FlowAccount (QT…) ของสัญญานี้ — มาจากอัตราจ้างของสัญญา (ทุกคนในสัญญาอ้างใบเดียวกัน) · null = สัญญาที่กรอกเอง */
  quotationNo: string | null;
  employees: Array<{ id: string; nameTh: string; position: string }>;
}

/** เลขใบเสนอราคาที่พบบ่อยที่สุดในอัตราจ้างของสัญญา (ว่างถ้าไม่มี) */
export function contractQuotationNo(assignments: Array<{ quotationNo: string | null }>): string | null {
  const count = new Map<string, number>();
  for (const a of assignments) {
    const q = (a.quotationNo ?? '').trim();
    if (q) count.set(q, (count.get(q) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const [q, n] of count) if (best === null || n > (count.get(best) ?? 0)) best = q;
  return best;
}

/** ตัวเลือกของตัวกรองทั้งสามช่อง ในก้อนเดียว — ให้หน้าเว็บทำ cascading (เลือกช่องหนึ่งแล้วอีกสองช่องเหลือเฉพาะที่
 * เกี่ยวกัน) เองโดยไม่ต้องยิงซ้ำทุกครั้งที่เลือก */
export async function listFilterOptions(): Promise<{ contracts: FilterOptionContract[]; activeContractId: string | null }> {
  const rows = await prisma.contract.findMany({
    include: { customer: true, assignments: { include: { employee: true } } },
    orderBy: [{ startDate: 'desc' }],
  });
  const contracts: FilterOptionContract[] = rows.map((c) => ({
    id: c.id,
    poNo: c.poNo,
    contractNo: c.contractNo,
    projectName: c.projectName,
    customerId: c.customerId,
    customerName: c.customer.nameTh,
    startDate: c.startDate,
    endDate: c.endDate,
    status: c.status,
    flowaccountLinked: Boolean(c.customer.flowaccountContactId),
    quotationNo: contractQuotationNo(c.assignments),
    employees: c.assignments.map((a) => ({ id: a.employeeId, nameTh: a.employee.nameTh, position: a.employee.invoicePosition })),
  }));
  return { contracts, activeContractId: rows.find((c) => c.status === 'active')?.id ?? null };
}
