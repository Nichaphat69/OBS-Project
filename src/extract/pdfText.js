/**
 * ดึงชั้นข้อความออกจาก PDF โดยตรง — ไม่ต้องแปลงเป็นรูปและไม่ต้องใช้โมเดล vision
 *
 * ทำไมถึงคุ้ม: สำรวจเอกสารจริง 15 ฉบับเมื่อ 10 ส.ค. 2569 พบว่า **14 ฉบับมีชั้นข้อความอยู่แล้ว**
 * (export มาจาก Excel ไม่ใช่ไฟล์สแกน) ดึงออกมาได้ใน 30–150 มิลลิวินาที
 * ขณะที่การให้โมเดล vision มองรูปใช้เวลา ~54 วินาทีต่อหน้า และอ่านชื่อผิดบ่อย
 *
 * วัดเทียบกับเอกสารเดียวกันแล้ว (CP Axtra Korawit):
 *   ให้โมเดลมองรูป  → "Korweil Khamsiuk" · "PSQL Developer" · "CP Astra"      ผิดหมด
 *   ส่งชั้นข้อความ  → "Korawit Khamsuk" · "PL/SQL Developer" · "CP Axtra"     ถูกหมด
 *
 * ใช้ pdfjs-dist ที่ติดมากับ pdf-to-img อยู่แล้ว ไม่ต้องเพิ่ม dependency
 * ฉบับที่เป็นภาพสแกนจริง (เช่นภาพหน้าจอเว็บของ KBTG) จะได้ข้อความน้อยมาก
 * ตัวเรียกต้องเช็ค hasText แล้วถอยไปใช้ทางโมเดล vision แทน
 */

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

/* ต่ำกว่านี้ถือว่าไม่มีชั้นข้อความจริง — ไฟล์สแกนมักได้เศษข้อความจากลายน้ำหรือหัวกระดาษติดมาบ้าง
   ตั้งจากของจริง: ฉบับที่มีข้อความได้ 2,200–18,700 ตัว ส่วนภาพหน้าจอของ KBTG ได้ 175 ตัว */
const MIN_CHARS_PER_PAGE = 150;

/**
 * @param {Buffer|Uint8Array} pdfBuffer
 * @returns {Promise<{pages: string[], hasText: boolean, totalChars: number}>}
 *   pages  ข้อความของแต่ละหน้า เรียงตามลำดับหน้า
 */
export async function extractPdfText(pdfBuffer) {
  const doc = await getDocument({
    data: new Uint8Array(pdfBuffer),
    useSystemFonts: true,
    // ปิดเสียงเตือนของ pdfjs ที่ไม่เกี่ยวกับความถูกต้องของข้อความ
    verbosity: 0,
  }).promise;

  try {
    const pages = [];
    for (let i = 1; i <= doc.numPages; i += 1) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      pages.push(joinTextItems(content.items));
    }

    const totalChars = pages.join('').replace(/\s/g, '').length;
    return {
      pages,
      totalChars,
      hasText: totalChars >= MIN_CHARS_PER_PAGE * doc.numPages,
    };
  } finally {
    await doc.destroy?.();
  }
}

/**
 * ต่อชิ้นข้อความให้กลับมาเป็นบรรทัด
 *
 * pdfjs คืนข้อความมาเป็นชิ้นๆ พร้อมพิกัด ไม่ได้แบ่งบรรทัดให้ — ถ้าต่อกันดื้อๆ ทั้งตาราง
 * จะกลายเป็นบรรทัดเดียวยาวเหยียด อ่านไม่ออกว่าค่าไหนอยู่แถวเดียวกัน
 * ใช้พิกัดแนวตั้ง (transform[5]) ตัดบรรทัด และใช้ hasEOL ที่ pdfjs บอกมาช่วยอีกทาง
 */
function joinTextItems(items) {
  const lines = [];
  let current = [];
  let lastY = null;

  for (const item of items) {
    if (!item.str) {
      if (item.hasEOL && current.length) { lines.push(current.join(' ')); current = []; }
      continue;
    }
    const y = item.transform?.[5];
    // ขยับแนวตั้งเกิน 2 หน่วย = ขึ้นบรรทัดใหม่ (ตัวอักษรในตารางสูงราว 8-10 หน่วย)
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

/* ชื่อช่องที่แต่ละฟอร์มใช้เรียกชื่อพนักงาน — รวบจากเอกสารจริงทั้ง 9 รูปแบบ
 * "ชื่อ - สกุล" เป็นฟอร์มภาษาไทย (รายงานการปฏิบัติงาน) — เจอจริงว่า pdfjs ดึงเว้นวรรครอบขีดมาด้วย
 * ("ชื่อ - สกุล" ไม่ใช่ "ชื่อ-สกุล" ตรงๆ) จึงต้องรับช่องว่างรอบขีดด้วย */
const NAME_PATTERNS = [
  /Employee\s*Name\s*:?\s*([^\n]{2,60})/i,
  /Resource\s*Name\s*:?\s*([^\n]{2,60})/i,
  /Outsource\s*Name\s*:?\s*([^\n]{2,60})/i,
  /ชื่อ\s*-?\s*สกุล\s*:?\s*([^\n]{2,60})/,
  /(?:^|\n)\s*Name\s*:?\s*([^\n]{2,60})/i,
];

/**
 * อ่านชื่อพนักงานตรงจากหัวเอกสารของหน้านี้ — เชื่อถือได้กว่าที่โมเดลตอบมา เพราะเป็นตัวอักษร
 * ตรงๆ ที่ดึงจากชั้นข้อความ ไม่ต้องผ่านการเดาของโมเดล ใช้ทับ employeeName ที่โมเดลอ่านมาได้
 *
 * @returns {string|null}
 */
export function employeeNameIn(text) {
  for (const re of NAME_PATTERNS) {
    const m = text.match(re);
    if (!m) continue;
    /* ตัดค่าของช่องถัดไปที่ต่อท้ายมาในบรรทัดเดียวกันออก เช่น
       "Sunee Maneekasemsuk  Project Name : ..." → เอาแค่ชื่อ
       ฟอร์มไทย "ชื่อ - สกุล" มักเขียนตำแหน่งต่อในบรรทัดเดียวกันแบบไม่มีวรรคซ้ำ ("...chumphuchanapai
       ตำแหน่ง Developer") ต้องตัดตรงคำว่าตำแหน่งด้วย

       จับแค่ "ตำแหน" (ไม่ต้องมี ง ต่อท้าย) เพราะฟอนต์บางฟอนต์ในเอกสารจริงมี glyph พัง — pdfjs ดึง
       ตัวอักษรระหว่าง "น" กับ "ง" ออกมาเป็นโค้ดในช่วง Private Use Area (เจอจริง U+F70A ที่ดึงจาก
       "2026_07 - O291-Pitikorn chumphuchanapai.pdf") ทำให้สตริง "ตำแหน่ง" เทียบตรงตัวไม่ติดเลย
       ไม่ว่าจะสะกดแบบไหน ("ตำแหน่ง" ปกติ หรือ "ตําแหนง" ที่วรรณยุกต์/สระหายไปบางส่วน) ตัดที่ "ตำแหน"
       ก่อนถึงตัวอักษรที่พังจึงกันปัญหานี้ได้ตรงจุดกว่าการไล่เดารูปสะกดที่เพี้ยนได้ไม่รู้จบ

       ป้ายฝั่งอังกฤษที่ตัดต้องเป็นคำระบุฟิลด์ตรงๆ ("Project"/"Name"/"Role"/"Position") ห้ามรับ
       คำนำหน้าใดๆก่อนคำเหล่านี้แบบเดิม (/[A-Z][a-z]+\s*(?:Name|Role|Position)\s*:/) เพราะนามสกุล
       จริงที่ขึ้นต้นด้วยตัวใหญ่ (เช่น "Khamsuk") ก็ผ่าน [A-Z][a-z]+ ได้เหมือนกัน ถ้าบังเอิญมีป้าย
       ฟิลด์ตามหลังมาแบบวรรคเดียว จะโดนตัดทิ้งทั้งที่เป็นส่วนหนึ่งของชื่อจริง (เจอจริงตอนเขียนเทสต์) */
    const raw = m[1].split(/\s{2,}|\s(?=(?:Project\s+)?(?:Name|Role|Position)\s*:)|\s(?=ตำแหน|ตําแหน)/)[0];
    const name = raw.replace(/[:\-|]+$/, '').trim();
    if (name.length >= 2) return name;
  }
  return null;
}

const EN_MONTH_ABBR = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/**
 * อ่านเดือน/ปีตรงจากหัวเอกสารฟอร์มไทย "เดือน / ปี : Jul-26" — เชื่อถือได้กว่าที่โมเดลตอบมา เพราะเป็น
 * ตัวอักษรตรงๆ ไม่ต้องผ่านการเดา ใช้ทับ period ที่โมเดลอ่านมาได้ คืนค่าเป็น "YYYY-MM" หรือ null
 * ถ้าไม่เจอรูปแบบที่รู้จัก
 *
 * ".{0,2}" หลัง "ป" กันฟอนต์พังตัวเดียวกับที่ทำให้ employeeNameIn ต้องตัดที่ "ตำแหน" — เจอจริงว่า
 * "ี" ของคำว่า "ปี" ถูก pdfjs ดึงมาเป็นโค้ด Private Use Area (U+F702) ในไฟล์เดียวกับที่ "ตำแหน่ง"
 * พัง (U+F70A) จึงไม่ยึดสะกดคำว่า "ปี" ตรงตัว
 *
 * ปีที่เขียนเป็น 2 หลักท้าย ("26") หมายถึง ค.ศ. 2026 ไม่ใช่ พ.ศ. — ยืนยันจากชื่อไฟล์จริงที่ขึ้นต้น
 * ด้วย "2026_07" คู่กับ "Jul-26" ในเนื้อไฟล์ (2026_07 - O291-Pitikorn chumphuchanapai.pdf)
 *
 * @returns {string|null}
 */
export function periodIn(text) {
  const m = text.match(/เดือน\s*\/?\s*ป.{0,2}:?\s*([A-Za-z]{3})-(\d{2})/);
  if (!m) return null;
  const month = EN_MONTH_ABBR[m[1].toLowerCase()];
  if (!month) return null;
  return `20${m[2]}-${month}`;
}
