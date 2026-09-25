/**
 * จับคู่ชื่อและตำแหน่งจาก Timesheet เข้ากับฐานข้อมูลพนักงาน
 *
 * เอกสารชุดเดียวกันเขียนคนเดียวกันไม่เหมือนกัน:
 *   ใบว่าจ้าง 26/B0113   → "พงศ์พันธ์ มามาก"  ตำแหน่ง "Dev"
 *   ใบเสนอราคา QT2025120005 → ตำแหน่ง "Developer"
 *   Timesheet            → "Pongpun Mamak"   ตำแหน่ง "Java Programmer"
 *   ใบแจ้งหนี้ INV2026020006 → ตำแหน่ง "Developer"
 *
 * เทียบข้อความตรงตัวจึงใช้ไม่ได้ ต้องเทียบผ่านตารางชื่อพ้อง
 * และชื่อตำแหน่งที่ขึ้นใบแจ้งหนี้ต้องใช้ค่าจากฐานข้อมูลเสมอ
 *
 * Ported from src/domain/matching.js — logic preserved exactly, types added.
 */

export interface MatchableEmployee {
  id: string;
  nameTh?: string | null;
  nameEn?: string | null;
  aliases?: string[];
  invoicePosition?: string | null;
  monthlyRate?: number | null;
  quotationNo?: string | null;
}

/** ตัดช่องว่างซ้ำ ตัดคำนำหน้า และลดรูปให้เทียบกันได้ */
export function normalizeName(value: string | null | undefined): string {
  if (!value) return '';
  return String(value)
    .normalize('NFC')
    .replace(/[.​]/g, '')
    .replace(/^(นาย|นาง|นางสาว|น\.ส|ดร|mr|mrs|ms|miss|dr)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * ระยะแก้ไข (Levenshtein) — ใช้รับมือการสะกดต่างเล็กน้อย
 * เช่น Mamak / Mamark ต่างกัน 1 ตัวอักษร
 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = row;
  }
  return prev[b.length];
}

/* เกณฑ์ของชั้นจับคู่หลวม — ตั้งจากค่าที่วัดกับชื่อจริงที่โมเดลอ่านผิด ไม่ได้ตั้งลอยๆ
     ชื่อเดียวกันอ่านเพี้ยน   0.72 – 0.80  (Sineee Masamasukiam ↔ Sunee Maneekasemsuk = 0.72)
     คนละคนกันจริง           0.22 – 0.44  (Pongpun Mamak ↔ Sunee Maneekasemsuk = 0.44)
   0.65 อยู่กลางช่องว่างพอดี ห่างจากทั้งสองฝั่งมากพอที่จะไม่พลิกง่ายๆ */
const LOOSE_THRESHOLD = 0.65;

export const MATCH = {
  EXACT: 'exact',
  ALIAS: 'alias',
  FUZZY: 'fuzzy',
  NONE: 'none',
} as const;

export type MatchKind = (typeof MATCH)[keyof typeof MATCH];

export interface MatchResult {
  match: MatchKind;
  employee: MatchableEmployee | null;
  reason: string;
}

/**
 * @param rawName          ชื่อที่อ่านได้จาก Timesheet
 * @param employees        [{ id, nameTh, nameEn, aliases: string[], ... }]
 * @param options.maxDistance  ระยะแก้ไขที่ยอมรับได้ (ค่าเริ่มต้น 2)
 */
export function matchEmployee(
  rawName: string | null | undefined,
  employees: MatchableEmployee[],
  { maxDistance = 2 }: { maxDistance?: number } = {},
): MatchResult {
  const target = normalizeName(rawName);
  if (!target) return { match: MATCH.NONE, employee: null, reason: 'ไม่พบชื่อใน Timesheet' };

  // 1. ตรงกับชื่อหลักภาษาไทยหรืออังกฤษ
  for (const employee of employees) {
    if (normalizeName(employee.nameTh) === target || normalizeName(employee.nameEn) === target) {
      return { match: MATCH.EXACT, employee, reason: 'ตรงกับชื่อในฐานข้อมูล' };
    }
  }

  // 2. ตรงกับชื่อพ้องที่บันทึกไว้
  for (const employee of employees) {
    for (const alias of employee.aliases ?? []) {
      if (normalizeName(alias) === target) {
        return {
          match: MATCH.ALIAS,
          employee,
          reason: `ตรงกับชื่อพ้อง "${alias}"`,
        };
      }
    }
  }

  // 3. สะกดต่างเล็กน้อย — คืนค่าพร้อมเหตุผลให้คนตรวจยืนยัน
  let best: { employee: MatchableEmployee; candidate: string; distance: number } | null = null;
  for (const employee of employees) {
    const candidates = [employee.nameTh, employee.nameEn, ...(employee.aliases ?? [])];
    for (const candidate of candidates) {
      const distance = editDistance(target, normalizeName(candidate));
      if (distance <= maxDistance && (!best || distance < best.distance)) {
        best = { employee, candidate: candidate ?? '', distance };
      }
    }
  }
  if (best) {
    return {
      match: MATCH.FUZZY,
      employee: best.employee,
      reason: `สะกดใกล้เคียง "${best.candidate}" (ต่างกัน ${best.distance} ตัวอักษร) — ควรยืนยันและเพิ่มเป็นชื่อพ้อง`,
    };
  }

  /* 4. ชั้นสุดท้าย — ใช้ตัวอักษรที่ซ้ำกัน ไม่ใช่ระยะแก้ไข
     โมเดล vision อ่านชื่อผิดแบบ "สลับ/แทรกตัวอักษร" ซึ่งกินระยะแก้ไขเกิน 2 อย่างรวดเร็ว
     (วัดกับของจริง: "Korawit Khamsuk" → "Korweil Khamsiuk" ต่างกัน 5 · "Sunee Maneekasemsuk"
     → "Sineee Masamasukiam" ต่างกัน 9) ทั้งที่ตัวอักษรที่ใช้แทบเป็นชุดเดียวกัน
     ชั้นนี้จึงจับได้ในกรณีที่ชั้น 3 จับไม่ได้ แต่ตั้งเกณฑ์ไว้สูงและบอกชัดว่าให้คนยืนยันก่อน
     — ไม่ผูกให้เองเงียบๆ เพราะเป็นการเดาที่ผิดได้ */
  let loose: { employee: MatchableEmployee; candidate: string; score: number } | null = null;
  for (const employee of employees) {
    for (const candidate of [employee.nameTh, employee.nameEn, ...(employee.aliases ?? [])]) {
      const score = letterOverlap(target, normalizeName(candidate));
      if (score >= LOOSE_THRESHOLD && (!loose || score > loose.score)) {
        loose = { employee, candidate: candidate ?? '', score };
      }
    }
  }
  if (loose) {
    return {
      match: MATCH.FUZZY,
      employee: loose.employee,
      reason: `น่าจะเป็น "${loose.candidate}" (ตัวอักษรตรงกัน ${Math.round(loose.score * 100)}%) `
        + '— AI อาจอ่านชื่อเพี้ยน ต้องให้คนยืนยันและเพิ่มเป็นชื่อพ้องก่อน',
    };
  }

  return {
    match: MATCH.NONE,
    employee: null,
    reason: `ไม่พบ "${rawName}" ในฐานข้อมูลพนักงาน — เพิ่มพนักงานหรือเพิ่มชื่อพ้องก่อนวางบิล`,
  };
}

export interface PositionCheckResult {
  ok: boolean;
  reason: string;
}

/**
 * ตำแหน่งใน Timesheet ตรงกับตำแหน่งของพนักงานคนนั้นหรือไม่
 * ผลลัพธ์เป็นเพียงคำเตือน — ตำแหน่งบนใบแจ้งหนี้ใช้ค่าจากฐานข้อมูลอยู่แล้ว
 *
 * เดิมเทียบกับ "ตำแหน่งพ้อง" ที่ตั้งค่าไว้ล่วงหน้าด้วย (feature ถูกถอดออก 25 ก.ย. 69 — Clear Read
 * อ่านตำแหน่งได้ตรงจากเอกสารอยู่แล้ว ไม่ต้องมาคอนฟิกล่วงหน้าอีกชั้น) เทียบกับ invoicePosition ตรงๆ พอ
 */
export function checkPosition(
  rawPosition: string | null | undefined,
  employee: MatchableEmployee,
): PositionCheckResult {
  const target = normalizeName(rawPosition);
  if (!target) return { ok: true, reason: 'Timesheet ไม่ได้ระบุตำแหน่ง' };

  const known = [employee.invoicePosition].filter((v): v is string => Boolean(v)).map(normalizeName);

  if (known.includes(target)) {
    return { ok: true, reason: 'ตรงกับตำแหน่งในฐานข้อมูล' };
  }
  return {
    ok: false,
    reason:
      `Timesheet เขียนตำแหน่งว่า "${rawPosition}" ซึ่งไม่อยู่ในรายการของ ${employee.nameTh} ` +
      `(ฐานข้อมูลใช้ "${employee.invoicePosition}") — ใบแจ้งหนี้จะใช้ชื่อตำแหน่งจากฐานข้อมูล`,
  };
}

/**
 * สัดส่วนตัวอักษรที่สองชื่อใช้ร่วมกัน (ไม่สนลำดับ) — 0 ถึง 1
 *
 * ต่างจากระยะแก้ไขตรงที่ไม่สนว่าตัวอักษรอยู่ตำแหน่งไหน จึงทนต่อการอ่านสลับตัว
 * ซึ่งเป็นรูปแบบความผิดพลาดที่โมเดล vision ทำบ่อยที่สุดกับชื่อคน
 */
function letterOverlap(a: string, b: string): number {
  if (!a || !b) return 0;
  const pool = [...b];
  let shared = 0;
  for (const ch of a) {
    const at = pool.indexOf(ch);
    if (at !== -1) { pool.splice(at, 1); shared += 1; }
  }
  return shared / Math.max(a.length, b.length);
}
