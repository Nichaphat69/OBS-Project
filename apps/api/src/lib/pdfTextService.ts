/**
 * ดึงชั้นข้อความออกจาก PDF โดยตรง — ไม่ต้องแปลงเป็นรูปและไม่ต้องใช้โมเดล vision — ported from
 * src/extract/pdfText.js.
 *
 * เอกสารส่วนใหญ่ export มาจาก Excel จึงมีชั้นข้อความอยู่แล้ว ดึงออกมาได้ในไม่กี่ร้อยมิลลิวินาที และแม่น
 * กว่าการให้โมเดล vision มองรูปมาก ฉบับที่เป็นภาพสแกนจริงจะได้ข้อความน้อยมาก — ตัวเรียกต้องเช็ค hasText
 * แล้วถอยไปใช้ทางโมเดล vision แทน (ดู extractionService.ts)
 */
// ต่ำกว่านี้ถือว่าไม่มีชั้นข้อความจริง — ไฟล์สแกนมักได้เศษข้อความจากลายน้ำหรือหัวกระดาษติดมาบ้าง
const MIN_CHARS_PER_PAGE = 150;

export interface PdfTextResult {
  pages: string[];
  hasText: boolean;
  totalChars: number;
}

export async function extractPdfText(pdfBuffer: Buffer | Uint8Array): Promise<PdfTextResult> {
  // โหลดตอนใช้จริงเท่านั้น — pdfjs-dist เป็นก้อนหลายสิบ MB และมีแค่ฟังก์ชันนี้ฟังก์ชันเดียวในไฟล์ที่ใช้มัน
  // ส่วนที่เหลือ (employeeNameIn/periodIn/dayRowsIn/signatureNamesIn) เป็นการแปลงสตริงล้วน
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await getDocument({
    data: new Uint8Array(pdfBuffer),
    useSystemFonts: true,
    verbosity: 0,
  }).promise;

  try {
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i += 1) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      pages.push(joinTextItems(content.items as any[]));
    }

    const totalChars = pages.join('').replace(/\s/g, '').length;
    return {
      pages,
      totalChars,
      hasText: totalChars >= MIN_CHARS_PER_PAGE * doc.numPages,
    };
  } finally {
    await (doc as any).destroy?.();
  }
}

/**
 * ต่อชิ้นข้อความให้กลับมาเป็นบรรทัด — pdfjs คืนข้อความมาเป็นชิ้นๆ พร้อมพิกัด ไม่ได้แบ่งบรรทัดให้
 * ใช้พิกัดแนวตั้ง (transform[5]) ตัดบรรทัด และใช้ hasEOL ที่ pdfjs บอกมาช่วยอีกทาง
 */
function joinTextItems(items: any[]): string {
  const lines: string[] = [];
  let current: string[] = [];
  let lastY: number | null = null;

  for (const item of items) {
    if (!item.str) {
      if (item.hasEOL && current.length) { lines.push(current.join(' ')); current = []; }
      continue;
    }
    const y = item.transform?.[5];
    if (lastY !== null && y !== undefined && Math.abs(y - lastY) > 2 && current.length) {
      lines.push(current.join(' '));
      current = [];
    }
    current.push(item.str);
    if (y !== undefined) lastY = y;
    if (item.hasEOL) { lines.push(current.join(' ')); current = []; }
  }
  if (current.length) lines.push(current.join(' '));

  return lines
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

const NAME_PATTERNS = [
  /Employee\s*Name\s*:?\s*([^\n]{2,60})/i,
  /Resource\s*Name\s*:?\s*([^\n]{2,60})/i,
  /Outsource\s*Name\s*:?\s*([^\n]{2,60})/i,
  /ชื่อ\s*-?\s*สกุล\s*:?\s*([^\n]{2,60})/,
  /(?:^|\n)\s*Name\s*:?\s*([^\n]{2,60})/i,
];

/** อ่านชื่อพนักงานตรงจากหัวเอกสารของหน้านี้ — เชื่อถือได้กว่าที่โมเดลตอบมา เพราะเป็นตัวอักษรตรงๆ ที่ดึง
 * จากชั้นข้อความ ไม่ต้องผ่านการเดาของโมเดล ใช้ทับ employeeName ที่โมเดลอ่านมาได้ */
export function employeeNameIn(text: string): string | null {
  for (const re of NAME_PATTERNS) {
    const m = text.match(re);
    if (!m) continue;
    const raw = m[1].split(/\s{2,}|\s(?=(?:Project\s+)?(?:Name|Role|Position)\s*:)|\s(?=ตำแหน|ตําแหน)/)[0];
    const name = raw.replace(/[:\-|]+$/, '').trim();
    if (name.length >= 2) return name;
  }
  return null;
}

const EN_MONTH_ABBR: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/** อ่านเดือน/ปีตรงจากหัวเอกสารฟอร์มไทย "เดือน / ปี : Jul-26" — คืนค่าเป็น "YYYY-MM" หรือ null ถ้าไม่เจอ
 * รูปแบบที่รู้จัก (ปีที่เขียนเป็น 2 หลักท้ายหมายถึง ค.ศ. เสมอ ไม่ใช่ พ.ศ.) */
export function periodIn(text: string): string | null {
  const m = text.match(/เดือน\s*\/?\s*ป.{0,2}:?\s*([A-Za-z]{3})-(\d{2})/);
  if (!m) return null;
  const month = EN_MONTH_ABBR[m[1].toLowerCase()];
  if (!month) return null;
  return `20${m[2]}-${month}`;
}

function daysInMonth(period: string | null): number | null {
  const m = period?.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]), 0).getDate();
}

export interface DayRow {
  date: string;
  timeIn: string | null;
  timeOut: string | null;
  jobDescription: string | null;
}

/**
 * แยกแต่ละแถวของตาราง Timesheet ฟอร์ม "TIMESHEET" ตรงจากชั้นข้อความ — เชื่อถือได้กว่าที่โมเดลตอบมามาก
 * คืน null ถ้าพาร์สแถวไม่ได้ครบทุกวันในเดือนตาม period ที่ให้มา — ไม่มั่นใจว่าใช่ฟอร์มนี้จริงทั้งหมด ไม่
 * ควร override ครึ่งๆกลางๆ ดีกว่าปล่อยให้โมเดลตอบเองทั้งหมด
 */
export function dayRowsIn(text: string, period: string | null): DayRow[] | null {
  const expectedCount = period ? daysInMonth(period) : null;
  if (!expectedCount) return null;

  const rows: DayRow[] = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\d{1,2}\s+(\d{2})\/(\d{2})\/(\d{2})\s+\p{L}{2,3}\s+(.*)$/u);
    if (!m) continue;
    const [, dd, mm, yy, rest] = m;
    const trail = rest.match(/^(.*?)\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*$/);
    if (!trail) continue;
    const work = trail[1].trim().match(/(\d{1,2}:\d{2})\s+(\d{1,2}:\d{2})\s+[\d.]+\s*(.*)$/);
    rows.push({
      date: `20${yy}-${mm}-${dd}`,
      timeIn: work ? work[1] : null,
      timeOut: work ? work[2] : null,
      jobDescription: work ? (work[3].trim() || null) : null,
    });
  }
  return rows.length === expectedCount ? rows : null;
}

export interface SignatureNames {
  employeeSignatureName: string | null;
  projectManagerSignatureName: string | null;
}

/**
 * อ่านชื่อผู้เซ็นตรงจากท้ายฟอร์ม "TIMESHEET" — ใช้ employeeName ที่อ่านได้แม่นแล้วจากหัวเอกสารเป็นหมุด
 * ตัดหน้า เหลือส่วนท้ายคือชื่อผู้อนุมัติฝั่งลูกค้า (pdfjs ต่อสองคอลัมน์ในบรรทัดชื่อเป็นสตริงเดียว)
 */
export function signatureNamesIn(text: string, employeeName: string | null): SignatureNames {
  const headerIdx = text.search(/Employee'?s?\s*Signature\s+Project\s*Manager'?s?\s*Signature\s*\(TLI\)/i);
  if (headerIdx === -1) return { employeeSignatureName: null, projectManagerSignatureName: null };

  const namesLine = text.slice(headerIdx).split('\n')[1]?.trim();
  if (!namesLine) return { employeeSignatureName: null, projectManagerSignatureName: null };

  if (employeeName && namesLine.toLowerCase().startsWith(employeeName.toLowerCase())) {
    const rest = namesLine.slice(employeeName.length).trim();
    return { employeeSignatureName: employeeName, projectManagerSignatureName: rest || null };
  }
  return { employeeSignatureName: null, projectManagerSignatureName: namesLine || null };
}
