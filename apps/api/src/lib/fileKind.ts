/**
 * ตรวจชนิดไฟล์ Timesheet จาก "เนื้อไฟล์" (magic bytes) ไม่เชื่อนามสกุล — ไฟล์จริงที่เจอมาชื่อ "...pdf.xlsx"
 * (ดู spreadsheetExtractionService.ts) และอีเมลจากหลายคนแนบนามสกุลไม่ตรงกับเนื้อไฟล์ได้เสมอ
 *
 * ใช้ร่วมกันทั้งตอน "รับไฟล์จากอีเมล" (inboundEmailService.ts) และตอน "อ่านไฟล์" (uploadService.ts) เพื่อให้ทั้งสองจุด
 * ตัดสินตรงกัน — เดิมสองจุดนี้ถือว่าไฟล์ต้องเป็น PDF (รับอีเมล) หรือ "ไม่ใช่ PDF = ตารางเสมอ" (อ่านไฟล์)
 *
 * ชนิดที่อ่านอัตโนมัติได้:
 *   pdf   → เครื่องอ่านเอกสาร (ABBYY / Clear Read / โมเดลในเครื่อง)
 *   xlsx / xls / csv → ตัวอ่านตารางของ iPassion (spreadsheetExtractionService.ts)
 *   image (jpg/png/tiff) → ส่งให้ ABBYY อ่านเป็นภาพสแกน (เฉพาะ ABBYY)
 * ชนิดอื่น (docx, zip, ppt ฯลฯ) = unknown → ปฏิเสธพร้อมข้อความที่บอกว่ารับชนิดไหนได้บ้าง
 */
export type FileKind = 'pdf' | 'xlsx' | 'xls' | 'csv' | 'image' | 'unknown';

export interface DetectedFile {
  kind: FileKind;
  mimeType: string;
  /** ชื่อชนิดที่แสดงให้คนอ่าน เช่น "Word" สำหรับ unknown ที่เดาได้ — ว่างถ้าเดาไม่ได้ */
  label: string;
}

const MIME = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  csv: 'text/csv',
  png: 'image/png',
  jpeg: 'image/jpeg',
  tiff: 'image/tiff',
  webp: 'image/webp',
  bin: 'application/octet-stream',
} as const;

/** นามสกุลที่ n8n/หน้าอัปโหลดควรปล่อยผ่าน — แหล่งเดียวของรายการนี้ ถ้าจะเพิ่มชนิดให้เพิ่มที่นี่แล้วแก้ n8n ตาม */
export const ACCEPTED_EXTENSIONS = ['pdf', 'xlsx', 'xls', 'csv', 'jpg', 'jpeg', 'png', 'tif', 'tiff', 'webp'] as const;

export const SUPPORTED_FILES_TEXT = 'PDF, Excel (xlsx/xls), CSV และภาพสแกน (JPG/PNG/TIFF)';

const startsWith = (b: Buffer, ...bytes: number[]) => b.length >= bytes.length && bytes.every((x, i) => b[i] === x);

/** ข้อความล้วน (CSV/TSV) — ไม่มีไบต์ศูนย์ใน 4KB แรก และ decode เป็น UTF-8 ได้โดยไม่มีตัวอักษรเสีย */
function looksLikeText(b: Buffer): boolean {
  const head = b.subarray(0, 4096);
  if (head.length === 0) return false;
  for (const x of head) if (x === 0) return false;
  const s = head.toString('utf8');
  return !s.includes('�') || startsWith(b, 0xef, 0xbb, 0xbf);
}

export function detectFileKind(bytes: Buffer, fileName?: string | null): DetectedFile {
  const name = (fileName ?? '').toLowerCase();
  const ext = name.match(/\.([a-z0-9]{1,5})$/)?.[1] ?? '';

  if (startsWith(bytes, 0x25, 0x50, 0x44, 0x46, 0x2d)) return { kind: 'pdf', mimeType: MIME.pdf, label: 'PDF' };

  // zip (xlsx / docx / pptx ฯลฯ) — ชื่อโฟลเดอร์ภายในอยู่ใน local header ต้นไฟล์ แยกได้โดยไม่ต้องแตก zip
  if (startsWith(bytes, 0x50, 0x4b, 0x03, 0x04)) {
    const head = bytes.subarray(0, 12000).toString('latin1');
    if (head.includes('word/')) return { kind: 'unknown', mimeType: MIME.bin, label: 'Word' };
    if (head.includes('ppt/')) return { kind: 'unknown', mimeType: MIME.bin, label: 'PowerPoint' };
    if (head.includes('xl/') || ext === 'xlsx' || ext === 'xlsm') return { kind: 'xlsx', mimeType: MIME.xlsx, label: 'Excel' };
    return { kind: 'unknown', mimeType: MIME.bin, label: 'ZIP' };
  }

  // OLE2 (xls เก่า / doc เก่า) — แยกจากนามสกุล เพราะ header เหมือนกัน
  if (startsWith(bytes, 0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)) {
    if (ext === 'doc' || ext === 'ppt') return { kind: 'unknown', mimeType: MIME.bin, label: ext === 'doc' ? 'Word' : 'PowerPoint' };
    return { kind: 'xls', mimeType: MIME.xls, label: 'Excel (xls)' };
  }

  if (startsWith(bytes, 0x89, 0x50, 0x4e, 0x47)) return { kind: 'image', mimeType: MIME.png, label: 'PNG' };
  if (startsWith(bytes, 0xff, 0xd8, 0xff)) return { kind: 'image', mimeType: MIME.jpeg, label: 'JPEG' };
  if (startsWith(bytes, 0x49, 0x49, 0x2a, 0x00) || startsWith(bytes, 0x4d, 0x4d, 0x00, 0x2a)) return { kind: 'image', mimeType: MIME.tiff, label: 'TIFF' };
  if (startsWith(bytes, 0x52, 0x49, 0x46, 0x46) && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return { kind: 'image', mimeType: MIME.webp, label: 'WebP' };

  if (looksLikeText(bytes)) {
    return { kind: 'csv', mimeType: MIME.csv, label: 'CSV' };
  }

  return { kind: 'unknown', mimeType: MIME.bin, label: '' };
}

export function isReadableKind(kind: FileKind): boolean {
  return kind !== 'unknown';
}
