/**
 * ช่องที่ "ดึงมาจาก FlowAccount" ต้องแก้เองไม่ได้ (เจ้าของระบบสั่ง 5 ต.ค. 69)
 *
 * ตอนเลือกบริษัทจากใบเสนอราคาในฟอร์ม "เพิ่มบริษัทใหม่" ช่องไหนที่ได้ค่ามาจริง (ไม่ว่าง) จะถูกล็อก หน้าเว็บส่งรายชื่อช่องที่
 * ล็อกมาพร้อมคำขอสร้างสัญญา แล้วเก็บไว้กับสัญญา (contracts.fa_locked_fields) เพื่อให้ฟอร์ม "แก้ไขสัญญา" ล็อกช่องเดิมต่อ
 * และให้ API ปฏิเสธการแก้ช่องเหล่านั้นด้วย — ล็อกแค่หน้าเว็บไม่พอ เพราะเรียก API ตรงก็แก้ได้
 *
 * ขอบเขต: ล็อกเฉพาะ "การแก้ใน OBS" ไม่ได้กันการแก้ใน FlowAccount เอง และการซิงก์จาก FlowAccount (ระบบอัปเดตเอง) ไม่ผ่านด่านนี้
 */

/** ช่องที่ล็อกได้ — ชื่อตรงกับคีย์ที่หน้าเว็บส่งมา (รับเฉพาะรายการนี้ ไม่รับคีย์แปลกๆ ที่ใครส่งมา) */
export const FA_LOCKABLE_KEYS = [
  'customerNameTh',
  'taxId',
  'branch',
  'address',
  'zipCode',
  'contactName',
  'contactPhone',
  'contactEmail',
  'projectName',
  'vatRate',
  'whtRate',
  'creditDays',
  'faReference',
  'quotationDate',
  'salesName',
  'remarks',
  'internalNotes',
  'priceIncludesVat',
] as const;

export type FaLockableKey = (typeof FA_LOCKABLE_KEYS)[number];

const KEY_SET = new Set<string>(FA_LOCKABLE_KEYS);

/** ชื่อช่องภาษาไทยไว้ใช้ในข้อความ error */
export const FA_FIELD_LABELS: Record<FaLockableKey, string> = {
  customerNameTh: 'ชื่อบริษัท',
  taxId: 'เลขผู้เสียภาษี',
  branch: 'สาขา',
  address: 'ที่อยู่',
  zipCode: 'รหัสไปรษณีย์',
  contactName: 'ผู้ประสานงาน',
  contactPhone: 'เบอร์ผู้ประสานงาน',
  contactEmail: 'อีเมลผู้ประสานงาน',
  projectName: 'ชื่อโครงการ',
  vatRate: 'VAT',
  whtRate: 'หัก ณ ที่จ่าย',
  creditDays: 'เครดิต (วัน)',
  faReference: 'เลขที่อ้างอิง',
  quotationDate: 'วันที่ใบเสนอราคา',
  salesName: 'พนักงานขาย',
  remarks: 'หมายเหตุ',
  internalNotes: 'บันทึกภายใน',
  priceIncludesVat: 'ราคารวมภาษี',
};

/** รับค่าอะไรก็ได้จากคำขอ → รายการคีย์ที่ถูกต้องและไม่ซ้ำเท่านั้น */
export function sanitizeLockedKeys(input: unknown): FaLockableKey[] {
  if (!Array.isArray(input)) return [];
  const out: FaLockableKey[] = [];
  for (const k of input) {
    if (typeof k === 'string' && KEY_SET.has(k) && !out.includes(k as FaLockableKey)) out.push(k as FaLockableKey);
  }
  return out;
}

export function serializeLockedKeys(keys: FaLockableKey[]): string | null {
  return keys.length > 0 ? JSON.stringify(keys) : null;
}

export function parseLockedKeys(raw: string | null | undefined): FaLockableKey[] {
  if (!raw) return [];
  try {
    return sanitizeLockedKeys(JSON.parse(raw));
  } catch {
    return [];
  }
}

export interface FaLockCustomer {
  flowaccountContactId: string | null;
  contactName: string | null;
  contactPhone: string | null;
}

/**
 * ช่องที่ล็อกจริงของสัญญานี้
 *  - สัญญาที่สร้างหลังมีฟีเจอร์นี้: ตามรายการที่เก็บไว้ (เฉพาะบริษัทที่ผูก FlowAccount — บริษัทที่ไม่ได้ผูกไม่มีอะไรให้ล็อก)
 *  - สัญญาเก่า (ไม่มีรายการเก็บไว้) ของบริษัทที่ผูก FlowAccount: ล็อกชื่อบริษัทกับเลขผู้เสียภาษี (สองช่องนี้มาจาก
 *    ใบเสนอราคาเสมอ) และผู้ประสานงาน/เบอร์ถ้ามีค่า — ไม่ล็อกช่องอื่นเพราะบอกไม่ได้ว่าใครกรอกเอง
 */
export function effectiveLockedKeys(raw: string | null | undefined, customer: FaLockCustomer): FaLockableKey[] {
  if (!customer.flowaccountContactId) return [];
  if (raw) return parseLockedKeys(raw);
  const legacy: FaLockableKey[] = ['customerNameTh', 'taxId'];
  if (customer.contactName) legacy.push('contactName');
  if (customer.contactPhone) legacy.push('contactPhone');
  return legacy;
}

const norm = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());

/** เทียบค่าเดิมกับค่าที่ส่งมา — ข้อความว่าง/null ถือว่าเท่ากัน ตัวเลขเทียบเชิงตัวเลข */
export function sameValue(a: unknown, b: unknown): boolean {
  const na = norm(a);
  const nb = norm(b);
  if (na === nb) return true;
  const fa = Number(na);
  const fb = Number(nb);
  return na !== '' && nb !== '' && Number.isFinite(fa) && Number.isFinite(fb) && Math.abs(fa - fb) < 1e-9;
}

/** ช่องที่ล็อกอยู่แต่ค่าที่ส่งมาต่างจากค่าเดิม — เทียบเฉพาะคีย์ที่ส่งมาจริง (ไม่ส่งมา = ไม่แตะ ไม่นับว่าแก้) */
export function changedLockedKeys(
  locked: FaLockableKey[],
  current: Partial<Record<FaLockableKey, unknown>>,
  incoming: Partial<Record<FaLockableKey, unknown>>,
): FaLockableKey[] {
  return locked.filter((k) => k in incoming && incoming[k] !== undefined && !sameValue(current[k], incoming[k]));
}
