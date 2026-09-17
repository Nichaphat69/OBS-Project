/**
 * แปลงค่าที่อ่านมาจาก Timesheet ให้เป็นรูปแบบเดียวกัน — โดยไม่พึ่งโมเดล
 * Ported from src/extract/normalize.js — logic preserved exactly, types added.
 */

const MONTHS_EN = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

const MONTHS_TH: Array<[string, string]> = [
  ['มกราคม', 'ม.ค.'], ['กุมภาพันธ์', 'ก.พ.'], ['มีนาคม', 'มี.ค.'], ['เมษายน', 'เม.ย.'],
  ['พฤษภาคม', 'พ.ค.'], ['มิถุนายน', 'มิ.ย.'], ['กรกฎาคม', 'ก.ค.'], ['สิงหาคม', 'ส.ค.'],
  ['กันยายน', 'ก.ย.'], ['ตุลาคม', 'ต.ค.'], ['พฤศจิกายน', 'พ.ย.'], ['ธันวาคม', 'ธ.ค.'],
];

export function normalizeYear(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n >= 2500) return n - 543;
  if (n >= 1900) return n;
  if (n >= 50) return 2500 + n - 543;
  return 2000 + n;
}

const THAI_WORD = '[\\u0E01-\\u0E5B][\\u0E01-\\u0E5B.]*';

export function monthFromWord(word: unknown): number | null {
  if (!word) return null;
  const w = String(word).trim().toLowerCase().replace(/\./g, '');
  if (!w) return null;

  const en = MONTHS_EN.findIndex((m) => m.startsWith(w) || (w.length >= 3 && w.startsWith(m.slice(0, 3))));
  if (en !== -1) return en + 1;

  const raw = String(word).trim().replace(/\./g, '');
  if (!raw) return null;
  const th = MONTHS_TH.findIndex(([full, abbr]) => {
    const a = abbr.replace(/\./g, '');
    return raw === full || raw === a || full.startsWith(raw) || raw.startsWith(a);
  });
  return th === -1 ? null : th + 1;
}

export function normalizePeriod(raw: unknown): string | null {
  if (!raw) return raw as null;
  const value = String(raw).trim();
  if (/^\d{4}-\d{2}$/.test(value)) return value;

  const yearMatch = value.match(/\b(\d{4}|\d{2})\b(?!.*\b\d{4}\b)/);
  const year = normalizeYear(yearMatch?.[1]);
  if (!year) return value;

  const wordMatch = value.match(new RegExp(`[A-Za-z]{3,}|${THAI_WORD}`));
  let month = monthFromWord(wordMatch?.[0]);
  if (!month) {
    const nums = [...value.matchAll(/\d+/g)].map((m) => Number(m[0]));
    month = nums.find((n) => n >= 1 && n <= 12 && n !== Number(yearMatch?.[1])) ?? null;
  }
  if (!month) return value;

  return `${year}-${String(month).padStart(2, '0')}`;
}

export function normalizeDate(raw: unknown, period: string | null = null): string | null {
  if (raw === null || raw === undefined) return null;
  const value = String(raw).trim();
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

  const [py, pm] = /^\d{4}-\d{2}$/.test(period ?? '')
    ? (period as string).split('-').map(Number)
    : [null, null];

  const build = (y: number | null, m: number | null, d: number | null): string | null => {
    if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) return null;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  };

  const nameMatch = value.match(new RegExp(`(\\d{1,2})\\s*[-/\\s]\\s*([A-Za-z]{3,}|${THAI_WORD})\\s*[-/\\s]\\s*(\\d{2,4})`));
  if (nameMatch) {
    const month = monthFromWord(nameMatch[2]);
    if (month) return build(normalizeYear(nameMatch[3]), month, Number(nameMatch[1]));
  }
  const noYear =
    value.match(new RegExp(`(\\d{1,2})\\s*[-/\\s]\\s*([A-Za-z]{3,}|${THAI_WORD})\\s*$`)) ??
    value.match(/^([A-Za-z]{3,})\s*[-/\s]\s*(\d{1,2})$/);
  if (noYear && py) {
    const asDayFirst = monthFromWord(noYear[2]);
    if (asDayFirst) return build(py, asDayFirst, Number(noYear[1]));
    const asMonthFirst = monthFromWord(noYear[1]);
    if (asMonthFirst) return build(py, asMonthFirst, Number(noYear[2]));
  }

  const triple = value.match(/^(\d{1,4})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{2,4})$/);
  if (triple) {
    const [a, b, c] = [Number(triple[1]), Number(triple[2]), normalizeYear(triple[3])];
    if (String(triple[1]).length === 4) return build(normalizeYear(triple[1]), b, c);
    if (pm && b === pm && a !== pm) return build(c, b, a);
    if (pm && a === pm && b !== pm) return build(c, a, b);
    if (a > 12) return build(c, b, a);
    if (b > 12) return build(c, a, b);
    return build(c, b, a);
  }

  const dayOnly = value.match(/^(\d{1,2})(?:\s+[A-Za-z]{3,})?$/);
  if (dayOnly && py && pm) return build(py, pm, Number(dayOnly[1]));

  return null;
}

const KIND_PATTERNS: Array<[string, RegExp[]]> = [
  ['weekend', [/weekend/i, /^sat$/i, /^sun$/i, /เสาร์/, /อาทิตย์/]],
  ['holiday', [/public\s*holiday/i, /holiday/i, /วันหยุด/, /นักขัตฤกษ์/, /new\s*year/i]],
  ['leave', [/leave/i, /ลา(?!น)(ป่วย|กิจ|พักร้อน)?/, /absent/i]],
];

const LEAVE_TYPES: Array<[string, RegExp[]]> = [
  ['sick', [/sick/i, /ลาป่วย/]],
  ['personal', [/personal/i, /business\s*leave/i, /ลากิจ/]],
  ['vacation', [/vacation/i, /annual/i, /ลาพักร้อน/]],
  ['unpaid', [/unpaid/i, /without\s*pay/i, /ไม่รับค่าจ้าง/]],
];

export function classifyDayKind(...labels: Array<string | null | undefined>): 'work' | 'weekend' | 'holiday' | 'leave' {
  const text = labels.filter(Boolean).join(' ');
  if (!text.trim()) return 'work';
  for (const [kind, patterns] of KIND_PATTERNS) {
    if (patterns.some((re) => re.test(text))) return kind as 'weekend' | 'holiday' | 'leave';
  }
  return 'work';
}

export function classifyLeaveType(label: string | null | undefined): 'sick' | 'personal' | 'vacation' | 'unpaid' | 'unknown' {
  const text = String(label ?? '');
  for (const [type, patterns] of LEAVE_TYPES) {
    if (patterns.some((re) => re.test(text))) return type as 'sick' | 'personal' | 'vacation' | 'unpaid';
  }
  return 'unknown';
}

/**
 * แถวรายวันนี้ถือว่า "มาทำงาน" หรือไม่ — ใช้นับจำนวนวันทำงาน ไม่ใช่ใช้บอกจำนวนชั่วโมง
 *
 * ตั้งใจแยกสองคำถามนี้ออกจากกัน (17 ก.ย. 69): **"มาทำงานไหม" ตอบได้จากเวลาเข้า-ออก** แต่ **"กี่ชั่วโมง"
 * ตอบไม่ได้** เพราะเวลาเข้า-ออกไม่ได้บอกเวลาพัก (เจอจริง: ฟอร์ม V-Link เข้า 9:00 ออก 18:00 = 9 ชม.
 * แต่เอกสารเขียนเองว่า 8.00 คือหักพัก 1 ชม.แล้ว) การคำนวณชั่วโมงเองจึงได้ตัวเลขที่ผิดแต่ดูน่าเชื่อถือ
 * ซึ่งแย่กว่าปล่อยว่างไว้ให้รู้ว่าไม่รู้ — และสเปกกลางก็เขียนห้ามคำนวณเองไว้ตรงๆ
 *
 * อยู่ที่นี่เพื่อให้ตัวอ่านทุกเจ้าตัดสินเรื่องเดียวกันด้วยกติกาเดียวกัน — ความต่างระหว่างตัวอ่านแปลงเป็นเงิน
 * ได้ทันที (เคยเกิดมาแล้วสองรอบ: การตรวจจับวันลา และการนับชั่วโมง)
 *
 * `normalHours` เป็น 0 แปลว่า "เอกสารบอกว่าไม่ได้ทำงานวันนั้น" ไม่ใช่ "ไม่รู้" จึงไม่ตกไปดูเวลาเข้า-ออกต่อ
 */
export function isWorkedRow(row: {
  normalHours?: number | null;
  timeIn?: string | null;
  timeOut?: string | null;
}): boolean {
  if (typeof row.normalHours === 'number') return row.normalHours > 0;
  return Boolean(row.timeIn && row.timeOut);
}
