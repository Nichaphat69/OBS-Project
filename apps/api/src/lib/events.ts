/**
 * ตัวกระจายข่าวภายในกระบวนการเดียว — ported from src/events.js. มีไว้ให้ชั้นข้อมูล (audit.ts) บอก
 * SSE route ได้ว่า "มีอะไรเปลี่ยนแล้ว" โดยไม่ต้องรู้จัก res ของ HTTP เลย
 */
type Listener = (reason: string | null) => void;

const listeners = new Set<Listener>();

/** ขอรับข่าว — คืนฟังก์ชันสำหรับเลิกรับ */
export function onChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** แจ้งว่าข้อมูลเปลี่ยน — ผู้รับรายหนึ่งพังต้องไม่ลากให้รายอื่นพลาดข่าว/ทำให้คนเรียกพัง */
export function emitChange(reason: string | null = null): void {
  for (const listener of listeners) {
    try {
      listener(reason);
    } catch (error) {
      console.error('[events] ผู้รับข่าวพัง —', error);
    }
  }
}
