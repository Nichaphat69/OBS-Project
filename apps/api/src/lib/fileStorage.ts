/**
 * ชั้นกลางระหว่างระบบกับที่เก็บไฟล์ — จุดเดียวที่โค้ดส่วนอื่นต้องรู้จัก
 *
 * เดิมไฟล์ PDF ทุกใบเก็บเป็น `bytea` อยู่ในฐานข้อมูล ทำให้ไฟล์สำรองรายวันลากไฟล์ทุกใบไปด้วยและโตขึ้น
 * เรื่อยๆ ตามการใช้งาน ตัดสินใจ 28 ก.ย. 69 ว่าย้ายไปเก็บใน storage container แยก (Garage) โดยฐานข้อมูล
 * เหลือเก็บแค่ "ที่อยู่ของไฟล์"
 *
 * **ตอนนี้อยู่ในช่วงเขียนลงทั้งสองที่** ตามลำดับที่ตกลงกันไว้ — เขียนลง storage ด้วย และยังเขียนลงคอลัมน์
 * เดิมด้วย ตอนอ่านจะลอง storage ก่อนแล้วค่อยตกมาที่คอลัมน์เดิม ยังไม่เลิกเขียนลงฐานข้อมูลจนกว่าจะย้าย
 * ไฟล์เก่าออกครบและยืนยันว่าอ่านได้ทุกใบ **ห้ามลบคอลัมน์ `*_bytes` จนถึงตอนนั้น**
 *
 * ถ้าเครื่องไหนไม่ได้ตั้งค่า storage ไว้ (เครื่อง dev ของแต่ละคน) ทุกอย่างทำงานเหมือนเดิมทุกประการ —
 * `storeFile()` คืน null แล้วระบบก็ใช้คอลัมน์เดิมต่อไป ไม่ต้องตั้ง storage ถึงจะรันได้
 */
import { randomUUID } from 'node:crypto';
import { getObject, hasStorageCredentials, putObject } from './s3Client.js';

/** โฟลเดอร์ใน storage — แยกตามชนิดเอกสาร ให้ไล่ดูและตั้ง lifecycle rule ทีหลังได้ */
export type FileKind = 'ai-read' | 'timesheet' | 'invoice' | 'support';

const EXT_BY_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xls',
};

function extensionFor(fileName: string | null | undefined, mimeType: string | null | undefined): string {
  const fromName = fileName?.match(/\.([a-z0-9]{1,5})$/i)?.[1]?.toLowerCase();
  if (fromName) return fromName;
  return (mimeType && EXT_BY_MIME[mimeType.toLowerCase()]) || 'bin';
}

/**
 * เก็บไฟล์ลง storage แล้วคืน key ไว้บันทึกในฐานข้อมูล — คืน null เมื่อยังไม่ได้ตั้งค่า storage
 *
 * **ตั้งใจให้ไม่โยน error ออกมา** เพราะช่วงนี้ไบต์ยังถูกเขียนลงคอลัมน์เดิมคู่กันอยู่ ถ้า storage ล่มชั่วคราว
 * ไม่ควรทำให้คนใช้งานอัปโหลดไฟล์ไม่ได้ — แถวนั้นจะไม่มี key แล้วตอนอ่านจะตกไปใช้คอลัมน์เดิมเอง
 * (จะเปลี่ยนเป็นโยน error ตอนเลิกเขียนลงฐานข้อมูลแล้วเท่านั้น)
 */
export async function storeFile(
  kind: FileKind,
  bytes: Buffer,
  { fileName = null, mimeType = null }: { fileName?: string | null; mimeType?: string | null } = {},
): Promise<string | null> {
  if (!hasStorageCredentials()) return null;
  const now = new Date();
  const key =
    `${kind}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/` +
    `${randomUUID()}.${extensionFor(fileName, mimeType)}`;
  try {
    await putObject(key, bytes, mimeType || 'application/octet-stream');
    return key;
  } catch (error) {
    console.error('[fileStorage] เก็บไฟล์ลง storage ไม่สำเร็จ ใช้คอลัมน์เดิมแทน:', error);
    return null;
  }
}

/**
 * อ่านไบต์ของไฟล์ — ลองจาก storage ก่อน ถ้าไม่มี key หรืออ่านไม่ได้ก็ใช้ไบต์จากคอลัมน์เดิม
 * รับ `fileBytes` เป็น Uint8Array ได้ด้วยเพราะ Prisma คืนคอลัมน์ `Bytes` มาแบบนั้น
 */
export async function loadFile(
  { fileKey, fileBytes }: { fileKey?: string | null; fileBytes?: Buffer | Uint8Array | null },
): Promise<Buffer | null> {
  if (fileKey && hasStorageCredentials()) {
    try {
      const bytes = await getObject(fileKey);
      if (bytes) return bytes;
      console.error(`[fileStorage] ไม่พบไฟล์ ${fileKey} ใน storage ใช้คอลัมน์เดิมแทน`);
    } catch (error) {
      console.error(`[fileStorage] อ่าน ${fileKey} จาก storage ไม่สำเร็จ ใช้คอลัมน์เดิมแทน:`, error);
    }
  }
  return fileBytes ? Buffer.from(fileBytes) : null;
}
