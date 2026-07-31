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
 */

/** ตัดช่องว่างซ้ำ ตัดคำนำหน้า และลดรูปให้เทียบกันได้ */
export function normalizeName(value) {
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
export function editDistance(a, b) {
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

export const MATCH = {
  EXACT: 'exact',
  ALIAS: 'alias',
  FUZZY: 'fuzzy',
  NONE: 'none',
};

/**
 * @param {string} rawName          ชื่อที่อ่านได้จาก Timesheet
 * @param {Array} employees         [{ id, nameTh, nameEn, aliases: string[], ... }]
 * @param {object} [options]
 * @param {number} [options.maxDistance]  ระยะแก้ไขที่ยอมรับได้ (ค่าเริ่มต้น 2)
 */
export function matchEmployee(rawName, employees, { maxDistance = 2 } = {}) {
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
  let best = null;
  for (const employee of employees) {
    const candidates = [employee.nameTh, employee.nameEn, ...(employee.aliases ?? [])];
    for (const candidate of candidates) {
      const distance = editDistance(target, normalizeName(candidate));
      if (distance <= maxDistance && (!best || distance < best.distance)) {
        best = { employee, candidate, distance };
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

  return {
    match: MATCH.NONE,
    employee: null,
    reason: `ไม่พบ "${rawName}" ในฐานข้อมูลพนักงาน — เพิ่มพนักงานหรือเพิ่มชื่อพ้องก่อนวางบิล`,
  };
}

/**
 * ตำแหน่งใน Timesheet ตรงกับตำแหน่งของพนักงานคนนั้นหรือไม่
 * ผลลัพธ์เป็นเพียงคำเตือน — ตำแหน่งบนใบแจ้งหนี้ใช้ค่าจากฐานข้อมูลอยู่แล้ว
 */
export function checkPosition(rawPosition, employee) {
  const target = normalizeName(rawPosition);
  if (!target) return { ok: true, reason: 'Timesheet ไม่ได้ระบุตำแหน่ง' };

  const known = [employee.invoicePosition, ...(employee.positionAliases ?? [])]
    .filter(Boolean)
    .map(normalizeName);

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
