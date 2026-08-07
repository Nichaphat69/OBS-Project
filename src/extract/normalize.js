/**
 * แปลงค่าที่อ่านมาจาก Timesheet ให้เป็นรูปแบบเดียวกัน — โดยไม่พึ่งโมเดล
 *
 * ทำไมต้องมีไฟล์นี้: ลูกค้าแต่ละรายใช้ฟอร์ม Timesheet คนละแบบกันหมด สำรวจของจริง
 * 14 ฉบับเมื่อ 7 ส.ค. 2569 พบอย่างน้อย 9 รูปแบบ (BigC · CP Axtra · Fujitsu · KBTG ·
 * Locus/NTT Data · T8 · ThaiLife · TSG · อาคเนย์) ต่างกันตั้งแต่ชื่อคอลัมน์ รูปแบบวันที่
 * ไปจนถึงคำที่ใช้เรียกวันหยุด
 *
 * งานแปลงพวกนี้ต้องอยู่ในโค้ด ไม่ใช่ฝากไว้ในคำสั่งของโมเดล เพราะเป็นกฎตายตัวที่ตรวจสอบได้
 * และมีเทสต์คุมได้ — โมเดล vision ขนาดเล็กทำพลาดเรื่องรูปแบบวันที่บ่อยมาก
 * (ทดสอบแล้วว่ามักคัดข้อความในเอกสารมาเป๊ะๆ แทนที่จะแปลงตาม schema)
 */

const MONTHS_EN = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

/* ชื่อเดือนไทยทั้งแบบเต็มและแบบย่อ — ฟอร์มของ T8 เขียนวันที่เป็น "1-ม.ค.-26"
   และหลายฉบับเขียนช่อง Month เป็น "มกราคม" */
const MONTHS_TH = [
  ['มกราคม', 'ม.ค.'], ['กุมภาพันธ์', 'ก.พ.'], ['มีนาคม', 'มี.ค.'], ['เมษายน', 'เม.ย.'],
  ['พฤษภาคม', 'พ.ค.'], ['มิถุนายน', 'มิ.ย.'], ['กรกฎาคม', 'ก.ค.'], ['สิงหาคม', 'ส.ค.'],
  ['กันยายน', 'ก.ย.'], ['ตุลาคม', 'ต.ค.'], ['พฤศจิกายน', 'พ.ย.'], ['ธันวาคม', 'ธ.ค.'],
];

/**
 * แปลงปีให้เป็น ค.ศ. เสมอ
 *   2569 → 2026   (พ.ศ. เต็ม — ลบ 543)
 *   69   → 2026   (พ.ศ. ย่อ — เอกสารไทยเขียน 2 หลักท้ายของ พ.ศ.)
 *   26   → 2026   (ค.ศ. ย่อ)
 * เส้นแบ่งของเลข 2 หลักอยู่ที่ 50 — ต่ำกว่านั้นถือเป็น ค.ศ. สูงกว่าถือเป็น พ.ศ.
 * ใช้ได้จนถึงปี ค.ศ. 2049 ซึ่งเกินอายุการใช้งานระบบนี้ไปมากแล้ว
 */
export function normalizeYear(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n >= 2500) return n - 543;          // พ.ศ. เต็ม
  if (n >= 1900) return n;                // ค.ศ. เต็ม
  if (n >= 50) return 2500 + n - 543;     // พ.ศ. ย่อ เช่น 69 → 2569 → 2026
  return 2000 + n;                        // ค.ศ. ย่อ เช่น 26 → 2026
}

/* คำภาษาไทยหนึ่งคำ — ต้องครอบคลุมทั้งบล็อกอักษรไทย ไม่ใช่แค่ [ก-ฮ] ซึ่งเป็นพยัญชนะล้วน
   "มกราคม" มีสระ า (U+0E32) อยู่กลางคำ ถ้าใช้ [ก-ฮ] จะจับได้แค่ "มกร" แล้วขาด */
const THAI_WORD = '[\\u0E01-\\u0E5B][\\u0E01-\\u0E5B.]*';

/** หาเลขเดือนจากคำ — รับทั้งชื่อเต็ม/ย่อ ทั้งไทยและอังกฤษ คืน 1-12 หรือ null */
export function monthFromWord(word) {
  if (!word) return null;
  const w = String(word).trim().toLowerCase().replace(/\./g, '');
  if (!w) return null;

  const en = MONTHS_EN.findIndex((m) => m.startsWith(w) || (w.length >= 3 && w.startsWith(m.slice(0, 3))));
  if (en !== -1) return en + 1;

  /* ไทยเทียบแบบ prefix ด้วย เพราะคอลัมน์แคบทำให้ชื่อเดือนถูกตัดกลางคำได้เหมือนภาษาอังกฤษ
     ตัดจุดออกก่อนเทียบ จะได้รับทั้ง "ม.ค." และ "มค" */
  const raw = String(word).trim().replace(/\./g, '');
  if (!raw) return null;
  const th = MONTHS_TH.findIndex(([full, abbr]) => {
    const a = abbr.replace(/\./g, '');
    return raw === full || raw === a || full.startsWith(raw) || raw.startsWith(a);
  });
  return th === -1 ? null : th + 1;
}

/**
 * แปลงรอบเดือนให้เป็น YYYY-MM เสมอ
 * รับได้ทั้ง "2026-01" · "January 2026" · "Jan-26" · "มกราคม 2026" · "1 2026" (Fujitsu) · "Janua" (ถูกตัดกลางคำ)
 * แปลงไม่ได้ก็คืนค่าเดิม ให้ verifyExtraction() จับว่ารูปแบบผิดต่อไป
 */
export function normalizePeriod(raw) {
  if (!raw) return raw;
  const value = String(raw).trim();
  if (/^\d{4}-\d{2}$/.test(value)) return value;

  const yearMatch = value.match(/\b(\d{4}|\d{2})\b(?!.*\b\d{4}\b)/);
  const year = normalizeYear(yearMatch?.[1]);
  if (!year) return value;

  // ชื่อเดือนก่อน — ถ้าไม่มีค่อยหาเลขเดือนล้วน (ฟอร์ม Fujitsu เขียน "MONTH/YEAR: 1 2026")
  const wordMatch = value.match(new RegExp(`[A-Za-z]{3,}|${THAI_WORD}`));
  let month = monthFromWord(wordMatch?.[0]);
  if (!month) {
    const nums = [...value.matchAll(/\d+/g)].map((m) => Number(m[0]));
    month = nums.find((n) => n >= 1 && n <= 12 && n !== Number(yearMatch?.[1])) ?? null;
  }
  if (!month) return value;

  return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * แปลงวันที่ในตารางให้เป็น YYYY-MM-DD
 *
 * รูปแบบที่เจอในเอกสารจริง
 *   2026-01-18            มาตรฐานที่เราต้องการ
 *   18-Jan-26 / 1-Jan-2026  ThaiLife · Locus
 *   1-ม.ค.-26              T8 (เดือนไทยย่อ)
 *   01/01/2026 / 1/1/2026   BigC · CP Axtra · T8
 *   1/1/2569               BigC (ปี พ.ศ.)
 *   01 / "01 Thu"          Fujitsu (มีแต่เลขวัน ต้องอาศัย period)
 *
 * @param {string|number} raw
 * @param {string} [period]  YYYY-MM ของเอกสาร ใช้เติมเดือน/ปีที่ขาด และใช้ไขว้ตรวจว่าตัวไหนคือวัน
 * @returns {string|null} YYYY-MM-DD หรือ null ถ้าแปลงไม่ได้
 */
export function normalizeDate(raw, period = null) {
  if (raw === null || raw === undefined) return null;
  const value = String(raw).trim();
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

  const [py, pm] = /^\d{4}-\d{2}$/.test(period ?? '')
    ? period.split('-').map(Number)
    : [null, null];

  const build = (y, m, d) => {
    if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) return null;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  };

  /* มีชื่อเดือนอยู่ในสตริง — รูปแบบ วัน-เดือน-ปี เช่น 18-Jan-26 หรือ 1-ม.ค.-26
     จับชื่อเดือนก่อนเสมอ เพราะไม่กำกวมเท่าตัวเลขล้วน */
  const nameMatch = value.match(new RegExp(`(\\d{1,2})\\s*[-/\\s]\\s*([A-Za-z]{3,}|${THAI_WORD})\\s*[-/\\s]\\s*(\\d{2,4})`));
  if (nameMatch) {
    const month = monthFromWord(nameMatch[2]);
    if (month) return build(normalizeYear(nameMatch[3]), month, Number(nameMatch[1]));
  }
  // ชื่อเดือนแต่ไม่มีปี เช่น "29 Dec" (KBTG) — ใช้ปีจาก period
  const noYear = value.match(new RegExp(`(\\d{1,2})\\s*[-/\\s]\\s*([A-Za-z]{3,}|${THAI_WORD})\\s*$`))
    ?? value.match(/^([A-Za-z]{3,})\s*[-/\s]\s*(\d{1,2})$/);
  if (noYear && py) {
    const asDayFirst = monthFromWord(noYear[2]);
    if (asDayFirst) return build(py, asDayFirst, Number(noYear[1]));
    const asMonthFirst = monthFromWord(noYear[1]);
    if (asMonthFirst) return build(py, asMonthFirst, Number(noYear[2]));
  }

  /* ตัวเลขล้วนคั่นด้วย / หรือ - สามส่วน
     เอกสารไทยเขียน วัน/เดือน/ปี แต่ยืนยันด้วย period ก่อนเสมอถ้ามี —
     ส่วนไหนตรงกับเดือนของ period ส่วนนั้นคือเดือน อีกส่วนคือวัน */
  const triple = value.match(/^(\d{1,4})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{2,4})$/);
  if (triple) {
    const [a, b, c] = [Number(triple[1]), Number(triple[2]), normalizeYear(triple[3])];
    if (String(triple[1]).length === 4) return build(normalizeYear(triple[1]), b, c); // YYYY-M-D
    if (pm && b === pm && a !== pm) return build(c, b, a);   // a คือวัน
    if (pm && a === pm && b !== pm) return build(c, a, b);   // เขียนแบบ เดือน/วัน
    if (a > 12) return build(c, b, a);                       // เกิน 12 ต้องเป็นวัน
    if (b > 12) return build(c, a, b);
    return build(c, b, a);                                   // ค่าเริ่มต้น: วัน/เดือน/ปี ตามธรรมเนียมไทย
  }

  // เลขวันล้วน เช่น "01" หรือ "01 Thu" (Fujitsu) — เติมเดือน/ปีจาก period
  const dayOnly = value.match(/^(\d{1,2})(?:\s+[A-Za-z]{3,})?$/);
  if (dayOnly && py && pm) return build(py, pm, Number(dayOnly[1]));

  return null;
}

/* คำที่แต่ละฟอร์มใช้เรียกวันที่ไม่ได้ทำงาน — รวบมาจากเอกสารจริงทั้ง 14 ฉบับ
   เทียบแบบตัวพิมพ์เล็กและตัดช่องว่าง เพราะเอกสารเขียนไม่เหมือนกันสักฉบับ */
const KIND_PATTERNS = [
  ['weekend', [/weekend/i, /^sat$/i, /^sun$/i, /เสาร์/, /อาทิตย์/]],
  ['holiday', [/public\s*holiday/i, /holiday/i, /วันหยุด/, /นักขัตฤกษ์/, /new\s*year/i]],
  ['leave', [/leave/i, /ลา(ป่วย|กิจ|พักร้อน)?/, /absent/i]],
];

const LEAVE_TYPES = [
  ['sick', [/sick/i, /ลาป่วย/]],
  ['personal', [/personal/i, /business\s*leave/i, /ลากิจ/]],
  ['vacation', [/vacation/i, /annual/i, /ลาพักร้อน/]],
  ['unpaid', [/unpaid/i, /without\s*pay/i, /ไม่รับค่าจ้าง/]],
];

/**
 * จัดกลุ่มป้ายกำกับของแถวให้เหลือ 4 แบบ — 'work' | 'weekend' | 'holiday' | 'leave'
 *
 * ป้ายอาจอยู่คนละคอลัมน์ในแต่ละฟอร์ม (ในช่อง Job Description ของ ThaiLife,
 * คอลัมน์ Type ของ CP Axtra/T8, คอลัมน์ Remarks ของ TSG/อาคเนย์) จึงรับหลายค่ามาดูรวมกัน
 * เรียงลำดับสำคัญ: เสาร์อาทิตย์ก่อน แล้ววันหยุด แล้ววันลา — เพราะฟอร์มที่เขียนว่า
 * "Weekend" ในช่อง Remarks ของแถวที่มีคำว่า leave อยู่ด้วย ต้องนับเป็นเสาร์อาทิตย์
 */
export function classifyDayKind(...labels) {
  const text = labels.filter(Boolean).join(' ');
  if (!text.trim()) return 'work';
  for (const [kind, patterns] of KIND_PATTERNS) {
    if (patterns.some((re) => re.test(text))) return kind;
  }
  return 'work';
}

/** ประเภทการลาจากคำที่เขียนไว้ — ไม่เข้าพวกไหนเลยคืน 'unknown' ไม่เดา */
export function classifyLeaveType(label) {
  const text = String(label ?? '');
  for (const [type, patterns] of LEAVE_TYPES) {
    if (patterns.some((re) => re.test(text))) return type;
  }
  return 'unknown';
}
