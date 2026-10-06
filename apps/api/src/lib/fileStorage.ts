/**
 * ชั้นกลางระหว่างระบบกับที่เก็บไฟล์ — จุดเดียวที่โค้ดส่วนอื่นต้องรู้จัก
 *
 * เดิมไฟล์ PDF ทุกใบเก็บเป็น `bytea` อยู่ในฐานข้อมูล ทำให้ไฟล์สำรองรายวันลากไฟล์ทุกใบไปด้วยและโตขึ้น
 * เรื่อยๆ ตามการใช้งาน ย้ายมาเก็บใน storage container แยก (Garage) เมื่อ 28 ก.ย. 69 โดยฐานข้อมูล
 * เหลือเก็บแค่ "ที่อยู่ของไฟล์" ในคอลัมน์ `*_key` — **คอลัมน์ `*_bytes` ถูกลบทิ้งแล้ว**
 * (เจ้าของระบบยืนยันวันเดียวกันว่าข้อมูลบนเครื่อง production ตอนนั้นเป็นข้อมูลตัวอย่างทั้งหมด)
 *
 * เพราะไม่มีสำเนาในฐานข้อมูลให้ตกกลับไปใช้แล้ว `storeFile()` จึง **โยน error เมื่อเก็บไม่สำเร็จ**
 * ไม่กลืนเงียบเหมือนตอนที่ยังเขียนลงสองที่ — ถ้ากลืน ไฟล์จะหายโดยไม่มีใครรู้
 */
import { randomUUID } from 'node:crypto';
import { getObject, hasStorageCredentials, putObject } from './s3Client.js';

/** โฟลเดอร์ใน storage — แยกตามชนิดเอกสาร ให้ไล่ดูและตั้ง lifecycle rule ทีหลังได้ */
export type FileKind = 'ai-read' | 'timesheet' | 'invoice' | 'support';

export class FileStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileStorageError';
  }
}

/**
 * ที่เก็บในหน่วยความจำสำหรับเทสต์เท่านั้น — เปิดด้วย STORAGE_DRIVER=memory (ตั้งไว้ใน
 * test/helpers/useTestDb.ts) เพื่อให้ชุดเทสต์รันได้โดยไม่ต้องมีคอนเทนเนอร์ storage
 * **ห้ามใช้ตอนรันจริง** — ข้อมูลหายทุกครั้งที่รีสตาร์ท
 */
const memoryStore = new Map<string, Buffer>();
const useMemoryDriver = () => process.env.STORAGE_DRIVER === 'memory';

const EXT_BY_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xls',
  'text/csv': 'csv',
  'image/tiff': 'tiff',
  'image/webp': 'webp',
};

function extensionFor(fileName: string | null | undefined, mimeType: string | null | undefined): string {
  const fromName = fileName?.match(/\.([a-z0-9]{1,5})$/i)?.[1]?.toLowerCase();
  if (fromName) return fromName;
  return (mimeType && EXT_BY_MIME[mimeType.toLowerCase()]) || 'bin';
}

/** เก็บไฟล์ลง storage แล้วคืน key ไว้บันทึกในฐานข้อมูล — โยน error ถ้าเก็บไม่ได้ */
export async function storeFile(
  kind: FileKind,
  bytes: Buffer,
  { fileName = null, mimeType = null }: { fileName?: string | null; mimeType?: string | null } = {},
): Promise<string> {
  const now = new Date();
  const key =
    `${kind}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/` +
    `${randomUUID()}.${extensionFor(fileName, mimeType)}`;

  if (useMemoryDriver()) {
    memoryStore.set(key, Buffer.from(bytes));
    return key;
  }
  if (!hasStorageCredentials()) {
    throw new FileStorageError(
      'ยังไม่ได้ตั้งค่าที่เก็บไฟล์ — ต้องมี STORAGE_ENDPOINT, STORAGE_ACCESS_KEY และ STORAGE_SECRET_KEY ' +
        '(เครื่องพัฒนาสั่ง `docker compose up -d storage` แล้วคัดค่าจาก .env.example ได้)',
    );
  }
  await putObject(key, bytes, mimeType || 'application/octet-stream');
  return key;
}

/** อ่านไบต์ของไฟล์จาก key — คืน null เมื่อแถวนั้นไม่มีไฟล์ หรือหาไฟล์ใน storage ไม่เจอ */
export async function loadFile(fileKey: string | null | undefined): Promise<Buffer | null> {
  if (!fileKey) return null;
  if (useMemoryDriver()) return memoryStore.get(fileKey) ?? null;
  if (!hasStorageCredentials()) {
    throw new FileStorageError('ยังไม่ได้ตั้งค่าที่เก็บไฟล์ จึงอ่านไฟล์ที่บันทึกไว้ไม่ได้');
  }
  return getObject(fileKey);
}
