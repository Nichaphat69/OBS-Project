/**
 * การปัดเศษเงินของระบบนี้ต้องตรงกับ FlowAccount และใบแจ้งหนี้ตัวอย่าง INV2026020006
 * ตรวจแล้วว่า 52943.93 / 20 = 2647.1965 → 2647.20 และ 173716.73 * 7% = 12160.17
 *
 * Ported from src/util/money.js — logic preserved exactly, types added.
 */

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function money(value: number): string {
  return round2(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

const THAI_MONTHS_SHORT = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

/** '2026-01-31' → '31 มกราคม 2569' — รับ timestamp เต็มรูปแบบ ('...T10:30:00Z') ได้ด้วย ตัดเอาแค่วันที่ */
export function thaiDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${d} ${THAI_MONTHS[m - 1]} ${y + 543}`;
}

/** '2026-01-29' → '29 ม.ค. 69' — รูปแบบที่ใช้ใน Remark ของใบแจ้งหนี้ (รับ timestamp เต็มได้เหมือน thaiDate) */
export function thaiDateShort(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${d} ${THAI_MONTHS_SHORT[m - 1]} ${String(y + 543).slice(-2)}`;
}

/** '2026-01' → 'มกราคม 2569' */
export function thaiMonth(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return `${THAI_MONTHS[m - 1]} ${y + 543}`;
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
