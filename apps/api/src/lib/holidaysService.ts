/**
 * ปฏิทินวันหยุด — ported from service.js's `listHolidays`/`addHoliday`/`removeHoliday`/
 * `officialHolidayYears`/`ensureOfficialHolidays`/`OFFICIAL_THAI_HOLIDAYS`. Backs the "ข้อมูลหลัก
 * → วันหยุด" tab (5.5.6).
 *
 * Note: Postgres does NOT enforce uniqueness across multiple NULL `customerId` rows the way the
 * `@@unique([date, customerId])` constraint's name might suggest (see schema.prisma's own comment
 * on the Holiday model) — so duplicate-prevention here is done with an explicit `findFirst` check
 * before insert, exactly like the original's own explicit `SELECT ... WHERE customer_id IS $c`
 * dup check, not by relying on the DB constraint alone.
 */
import { prisma } from '@obs/db';
import { logAudit } from './audit.js';

export class HolidayError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export interface HolidayRow {
  date: string;
  name: string;
  customerId: string | null;
}

/** ported from service.js listHolidays() */
export async function listHolidays(year?: number): Promise<HolidayRow[]> {
  const rows = await prisma.holiday.findMany({
    where: year ? { date: { startsWith: `${year}-` } } : undefined,
    orderBy: { date: 'asc' },
  });
  return rows.map((r) => ({ date: r.date, name: r.name, customerId: r.customerId }));
}

/** ported from service.js addHoliday() */
export async function addHoliday({ date, name, customerId = null, actor }: { date: string; name: string; customerId?: string | null; actor: string }): Promise<HolidayRow> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) {
    throw new HolidayError('วันที่ต้องเป็นรูปแบบ YYYY-MM-DD');
  }
  const trimmedName = (name ?? '').trim();
  if (!trimmedName) throw new HolidayError('ต้องกรอกชื่อวันหยุด');

  const dup = await prisma.holiday.findFirst({ where: { date, customerId } });
  if (dup) throw new HolidayError(`มีวันหยุดของวันที่ ${date} อยู่แล้ว`, 409);

  await prisma.holiday.create({ data: { date, name: trimmedName, customerId } });
  await logAudit({ actor, action: 'add_holiday', entityType: 'holiday', entityId: date, detail: { name: trimmedName, customerId } });
  return { date, name: trimmedName, customerId };
}

/** ported from service.js removeHoliday() */
export async function removeHoliday({ date, customerId = null, actor }: { date: string; customerId?: string | null; actor: string }): Promise<{ date: string; removed: true }> {
  const found = await prisma.holiday.findFirst({ where: { date, customerId } });
  if (!found) throw new HolidayError(`ไม่พบวันหยุดของวันที่ ${date}`, 404);

  await prisma.holiday.deleteMany({ where: { date, customerId } });
  await logAudit({ actor, action: 'remove_holiday', entityType: 'holiday', entityId: date, detail: { name: found.name, customerId } });
  return { date, removed: true };
}

/**
 * วันหยุดราชการไทยทางการ ปี 2568-2570 — ค้นและตรวจสอบข้ามแหล่งข้อมูลจริง (มติ ครม., Bank of
 * Thailand, ปฏิทิน kapook/thairath) ไม่ใช่เดาเอง เพราะข้อมูลนี้ป้อนเข้าคำนวณ Manday/ใบแจ้งหนี้จริง
 * ผิดวันเดียวกระทบเงินได้ — คัดลอกมาจาก service.js ตรงตัวทุกวันที่/ทุกชื่อ ห้ามพิมพ์ใหม่เอง
 *
 * ปี 2570 (2027) ใส่แค่วันหยุดตายตัว (วันที่เดิมทุกปี) — วันพระ/วันหยุดชดเชย/วันหยุดพิเศษของปีนั้น
 * คณะรัฐมนตรียังไม่ประกาศอย่างเป็นทางการ ณ ตอนที่เขียนโค้ดต้นฉบับ จึงไม่ใส่วันเดา
 */
const OFFICIAL_THAI_HOLIDAYS: Record<number, [string, string][]> = {
  2025: [
    ['2025-01-01', 'วันขึ้นปีใหม่'],
    ['2025-02-24', 'วันมาฆบูชา'],
    ['2025-04-06', 'วันจักรี'],
    ['2025-04-13', 'วันสงกรานต์'],
    ['2025-04-14', 'วันสงกรานต์'],
    ['2025-04-15', 'วันสงกรานต์'],
    ['2025-04-16', 'วันหยุดชดเชยวันสงกรานต์'],
    ['2025-05-01', 'วันแรงงานแห่งชาติ'],
    ['2025-05-04', 'วันฉัตรมงคล'],
    ['2025-05-11', 'วันวิสาขบูชา'],
    ['2025-05-12', 'วันหยุดชดเชยวันวิสาขบูชา'],
    ['2025-06-02', 'วันหยุดราชการกรณีพิเศษ'],
    ['2025-06-03', 'วันเฉลิมพระชนมพรรษาสมเด็จพระนางเจ้าฯ พระบรมราชินี'],
    ['2025-07-10', 'วันอาสาฬหบูชา'],
    ['2025-07-11', 'วันเข้าพรรษา'],
    ['2025-07-28', 'วันเฉลิมพระชนมพรรษาพระบาทสมเด็จพระเจ้าอยู่หัว'],
    ['2025-08-11', 'วันหยุดราชการกรณีพิเศษ'],
    ['2025-08-12', 'วันแม่แห่งชาติ'],
    ['2025-10-13', 'วันนวมินทรมหาราช'],
    ['2025-10-23', 'วันปิยมหาราช'],
    ['2025-12-05', 'วันพ่อแห่งชาติ'],
    ['2025-12-10', 'วันรัฐธรรมนูญ'],
    ['2025-12-31', 'วันสิ้นปี'],
  ],
  2026: [
    ['2026-01-01', 'วันขึ้นปีใหม่'],
    ['2026-01-02', 'วันหยุดราชการกรณีพิเศษ'],
    ['2026-03-03', 'วันมาฆบูชา'],
    ['2026-04-06', 'วันจักรี'],
    ['2026-04-13', 'วันสงกรานต์'],
    ['2026-04-14', 'วันสงกรานต์'],
    ['2026-04-15', 'วันสงกรานต์'],
    ['2026-05-01', 'วันแรงงานแห่งชาติ'],
    ['2026-05-04', 'วันฉัตรมงคล'],
    ['2026-05-31', 'วันวิสาขบูชา'],
    ['2026-06-01', 'วันหยุดชดเชยวันวิสาขบูชา'],
    ['2026-06-03', 'วันเฉลิมพระชนมพรรษาสมเด็จพระนางเจ้าฯ พระบรมราชินี'],
    ['2026-07-28', 'วันเฉลิมพระชนมพรรษาพระบาทสมเด็จพระเจ้าอยู่หัว'],
    ['2026-07-29', 'วันอาสาฬหบูชา'],
    ['2026-07-30', 'วันเข้าพรรษา'],
    ['2026-08-12', 'วันแม่แห่งชาติ'],
    ['2026-10-13', 'วันนวมินทรมหาราช'],
    ['2026-10-23', 'วันปิยมหาราช'],
    ['2026-12-05', 'วันพ่อแห่งชาติ'],
    ['2026-12-10', 'วันรัฐธรรมนูญ'],
    ['2026-12-31', 'วันสิ้นปี'],
  ],
  2027: [
    ['2027-01-01', 'วันขึ้นปีใหม่'],
    ['2027-04-06', 'วันจักรี'],
    ['2027-04-13', 'วันสงกรานต์'],
    ['2027-04-14', 'วันสงกรานต์'],
    ['2027-04-15', 'วันสงกรานต์'],
    ['2027-05-01', 'วันแรงงานแห่งชาติ'],
    ['2027-05-04', 'วันฉัตรมงคล'],
    ['2027-06-03', 'วันเฉลิมพระชนมพรรษาสมเด็จพระนางเจ้าฯ พระบรมราชินี'],
    ['2027-07-28', 'วันเฉลิมพระชนมพรรษาพระบาทสมเด็จพระเจ้าอยู่หัว'],
    ['2027-08-12', 'วันแม่แห่งชาติ'],
    ['2027-10-13', 'วันนวมินทรมหาราช'],
    ['2027-10-23', 'วันปิยมหาราช'],
    ['2027-12-05', 'วันพ่อแห่งชาติ'],
    ['2027-12-10', 'วันรัฐธรรมนูญ'],
    ['2027-12-31', 'วันสิ้นปี'],
  ],
};

/** ปีที่มีข้อมูลวันหยุดทางการพร้อมให้เติมอัตโนมัติ — ใช้ทำตัวเลือกปีในหน้า "ปฏิทินวันหยุด" */
export function officialHolidayYears(): number[] {
  return Object.keys(OFFICIAL_THAI_HOLIDAYS).map(Number).sort((a, b) => a - b);
}

/**
 * ปีที่เลือกดูได้ในหน้า "วันหยุด" — กว้างกว่าปีที่ฝังวันหยุดราชการไว้ในโค้ด (เจ้าของระบบสั่ง 27 ก.ย. 69
 * "อยากให้เลือกปีได้ทุกปี พอคลิกก็เห็นวันหยุดในปีที่เลือกทั้งหมด") เดิมหน้าเว็บให้เลือกได้แค่ 3 ปีที่มี
 * OFFICIAL_THAI_HOLIDAYS อยู่ ทั้งที่ตารางเก็บวันหยุดของปีไหนก็ได้
 *
 * = ปีที่มีข้อมูลจริงในตาราง ∪ ปีที่มีวันหยุดราชการฝังไว้ ∪ ช่วง 3 ปีรอบปีปัจจุบัน — ปีที่ไม่มีข้อมูลเลย
 * ยังเลือกได้ (ได้ตารางว่าง) ไม่ได้ซ่อนทิ้งเหมือนเดิม
 */
export async function selectableHolidayYears(): Promise<number[]> {
  const rows = await prisma.holiday.findMany({ select: { date: true } });
  const years = new Set<number>(officialHolidayYears());
  for (const r of rows) {
    const y = Number(String(r.date).slice(0, 4));
    if (Number.isFinite(y) && y > 0) years.add(y);
  }
  const now = new Date().getFullYear();
  for (let y = now - 3; y <= now + 3; y += 1) years.add(y);
  return [...years].sort((a, b) => a - b);
}

/** ported from service.js ensureOfficialHolidays() — เติมวันหยุดทางการของปีนี้เข้าตาราง ถ้ายังไม่เคย
 * มีเลยสักวันในปีนั้น (customer_id ทั้งหมด) — เติมครั้งเดียวต่อปี ไม่ทับซ้ำถ้าเคยเติม/แก้ไขไปแล้ว */
export async function ensureOfficialHolidays(year: number, actor: string): Promise<{ seeded: boolean; count?: number }> {
  const list = OFFICIAL_THAI_HOLIDAYS[year];
  if (!list) return { seeded: false };

  const already = await prisma.holiday.findFirst({ where: { date: { startsWith: `${year}-` } } });
  if (already) return { seeded: false };

  await prisma.holiday.createMany({ data: list.map(([date, name]) => ({ date, name, customerId: null })) });
  await logAudit({ actor, action: 'seed_official_holidays', entityType: 'holiday', entityId: String(year), detail: { year, count: list.length } });
  return { seeded: true, count: list.length };
}
