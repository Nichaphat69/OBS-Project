/**
 * ตัวกระจายข่าวภายในกระบวนการเดียว
 *
 * มีไว้ให้ชั้นข้อมูลบอกชั้น HTTP ได้ว่า "มีอะไรเปลี่ยนแล้ว" โดยที่ db/service
 * ไม่ต้องรู้จัก res ของ HTTP เลย และไม่เกิด import วนกันระหว่าง db กับ server
 *
 * เล็กพอที่จะไม่ใช้ EventEmitter ของ node — ต้องการแค่ปุ่มเดียวคือ "มีของใหม่"
 */

const listeners = new Set();

/** ขอรับข่าว — คืนฟังก์ชันสำหรับเลิกรับ */
export function onChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * แจ้งว่าข้อมูลเปลี่ยน
 * ผู้รับรายหนึ่งพังต้องไม่ลากให้รายอื่นพลาดข่าว และต้องไม่ทำให้คนที่เรียกพัง
 * เพราะคนที่เรียกกำลังกลางงานสำคัญอย่างการบันทึกลงฐานข้อมูลอยู่
 */
export function emitChange(reason = null) {
  for (const listener of listeners) {
    try {
      listener(reason);
    } catch (error) {
      console.error('[events] ผู้รับข่าวพัง —', error);
    }
  }
}
