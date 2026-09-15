/** ported from public/app.js's readIds()/saveReadIds()/markRead() — สถานะ "อ่านแล้ว" ของกระดิ่ง
 * แจ้งเตือน เก็บใน localStorage ของเครื่องนั้นๆ (ไม่ใช่ข้อมูลของระบบ ไม่ต้องเก็บฝั่งเซิร์ฟเวอร์) */
const READ_KEY = 'obs.notifRead';
const READ_CAP = 500;

export function readIds(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(READ_KEY) ?? '[]'));
  } catch {
    return new Set();
  }
}

/** ชื่อ custom event ที่ยิงทุกครั้งหลังบันทึกสถานะอ่านแล้ว — ให้ AppShell (ป้ายกระดิ่งบนเมนู) รู้ตัวและ
 * คำนวณจำนวนที่ยังไม่อ่านใหม่ทันที โดยไม่ต้องรอ pulse โพลรอบถัดไป (60 วิ) หรือ SSE nudge ซึ่งเป็นแค่
 * event ของฝั่งเซิร์ฟเวอร์ ไม่รู้เรื่อง localStorage ของเครื่องนี้เลย */
export const NOTIF_READ_EVENT = 'obs:notifread';

export function saveReadIds(set: Set<string>): void {
  const keep = [...set].sort((a, b) => Number(b) - Number(a)).slice(0, READ_CAP);
  try {
    localStorage.setItem(READ_KEY, JSON.stringify(keep));
  } catch {
    /* localStorage เต็ม/ปิดไว้ — ปล่อยผ่าน ไม่ใช่ข้อมูลสำคัญ */
  }
  window.dispatchEvent(new Event(NOTIF_READ_EVENT));
}

export function markRead(ids: Array<string | number>): void {
  const set = readIds();
  ids.forEach((i) => set.add(String(i)));
  saveReadIds(set);
}

export function unreadCount(items: Array<{ id: string | number }>): number {
  const read = readIds();
  return items.filter((i) => !read.has(String(i.id))).length;
}
