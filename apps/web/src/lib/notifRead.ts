/** ported from public/app.js's readIds()/saveReadIds()/markRead() — สถานะ "อ่านแล้ว" ของกระดิ่ง
 * แจ้งเตือน เก็บใน localStorage ของเครื่องนั้นๆ (ไม่ใช่ข้อมูลของระบบ ไม่ต้องเก็บฝั่งเซิร์ฟเวอร์)
 *
 * เปลี่ยนจากเก็บแค่ "รายชื่อ id ที่อ่านแล้ว" เป็น "id → เวลาที่กดอ่าน" (23 ก.ย. 69 ตามที่เจ้าของระบบสั่ง)
 * เพื่อให้รู้ได้ว่าอ่านมานานแค่ไหนแล้ว — ใช้กับกฎ "อ่านแล้วเกิน 30 วันให้หายจากลิสต์ ยังไม่อ่านให้อยู่ตลอด
 * ไม่ว่าจะเก่าแค่ไหน" ผ่าน visibleNotifications() ด้านล่าง */
const READ_KEY = 'obs.notifRead';
const READ_CAP = 500;
const READ_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function readMap(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(READ_KEY) ?? '{}');
    // ของเดิมก่อนรอบนี้เก็บเป็น array ของ id เฉยๆ ไม่มีเวลา — migrate เป็น "อ่านแล้วตอนนี้เลย" แทนการ
    // ทิ้งสถานะอ่านแล้วของทุกคนไปเงียบๆ ตอน deploy โค้ดรุ่นนี้
    if (Array.isArray(raw)) {
      const now = Date.now();
      const migrated: Record<string, number> = {};
      raw.forEach((id: unknown) => {
        migrated[String(id)] = now;
      });
      return migrated;
    }
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

export function readIds(): Set<string> {
  return new Set(Object.keys(readMap()));
}

/** ชื่อ custom event ที่ยิงทุกครั้งหลังบันทึกสถานะอ่านแล้ว — ให้ AppShell (ป้ายกระดิ่งบนเมนู) รู้ตัวและ
 * คำนวณจำนวนที่ยังไม่อ่านใหม่ทันที โดยไม่ต้องรอ pulse โพลรอบถัดไป (60 วิ) หรือ SSE nudge ซึ่งเป็นแค่
 * event ของฝั่งเซิร์ฟเวอร์ ไม่รู้เรื่อง localStorage ของเครื่องนี้เลย */
export const NOTIF_READ_EVENT = 'obs:notifread';

function saveReadMap(map: Record<string, number>): void {
  // ตัดให้เหลือ READ_CAP รายการ เก็บอันที่อ่าน "ล่าสุด" ไว้ก่อน (ตัดอันอ่านมานานสุดทิ้งก่อนถ้าล้น)
  const entries = Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, READ_CAP);
  try {
    localStorage.setItem(READ_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* localStorage เต็ม/ปิดไว้ — ปล่อยผ่าน ไม่ใช่ข้อมูลสำคัญ */
  }
  window.dispatchEvent(new Event(NOTIF_READ_EVENT));
}

export function markRead(ids: Array<string | number>): void {
  const map = readMap();
  const now = Date.now();
  ids.forEach((i) => {
    map[String(i)] = now;
  });
  saveReadMap(map);
}

export function unreadCount(items: Array<{ id: string | number }>): number {
  const map = readMap();
  return items.filter((i) => !(String(i.id) in map)).length;
}

/** กรองรายการที่ "อ่านแล้วเกิน 30 วัน" ออก — ยังไม่อ่านเลยให้อยู่ในลิสต์เสมอไม่ว่าตัวเหตุการณ์เองจะเก่า
 * แค่ไหน (เจ้าของระบบสั่ง 23 ก.ย. 69: "ถ้ายังไม่เปิดอ่าน ก็ยังอยู่ในระบบ") ใช้ตอนจะแสดงผลในหน้า
 * "การแจ้งเตือน" เท่านั้น — ไม่กระทบตัวข้อมูลจริงบนเซิร์ฟเวอร์ (feed คำนวณจาก audit log สดทุกครั้งอยู่แล้ว) */
export function visibleNotifications<T extends { id: string | number }>(items: T[]): T[] {
  const map = readMap();
  const now = Date.now();
  return items.filter((i) => {
    const at = map[String(i.id)];
    return at === undefined || now - at < READ_TTL_MS;
  });
}
