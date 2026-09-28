/**
 * สำรองไฟล์ใน storage container ออกมาเป็นไฟล์จริงบนดิสก์ — รันหนึ่งรอบแล้วจบ (service `storage-backup`
 * ใน docker-compose.prod.yml เป็นคนวนเรียกให้วันละครั้ง เหมือนที่ pg-backup ทำกับฐานข้อมูล)
 *
 * ทำไมต้องมี — ตั้งแต่เลิกเก็บไฟล์เป็น binary ในฐานข้อมูล (28 ก.ย. 69) ไฟล์ไม่ได้ติดไปกับ pg_dump
 * อีกแล้ว ถ้าไม่มีตัวนี้ ไฟล์ทุกใบจะมีสำเนาเดียวอยู่ใน Garage เท่านั้น
 *
 * **คัดลอกเป็นไฟล์จริง ไม่ใช่ dump ของ Garage** เพราะไฟล์สำรองที่กู้ได้ด้วยการ copy เฉยๆ มีค่ากว่ามาก
 * ตอนเกิดเรื่อง — ถ้า Garage เสียหายหรือหายไปทั้งตัว ยังหยิบ PDF ทีละใบส่งให้คนที่ต้องใช้ได้ทันที
 * โดยไม่ต้องกู้ระบบอะไรขึ้นมาก่อน และย้ายไปไว้ที่อื่นก็ได้เพราะเป็นแค่โฟลเดอร์ธรรมดา
 *
 * **ไม่ลบอะไรทั้งสิ้น** — คัดลอกเฉพาะไฟล์ที่ยังไม่มีหรือขนาดไม่ตรง ไฟล์ที่ถูกลบออกจาก storage ไปแล้ว
 * ยังคงอยู่ในที่สำรองต่อไป ตั้งใจให้เป็นแบบนี้ เพราะเหตุที่ต้องใช้ไฟล์สำรองบ่อยที่สุดคือ "ลบผิด"
 * ถ้าตามลบตามด้วยก็จะไม่เหลืออะไรให้กู้
 */
import { createHash } from 'node:crypto';
import { mkdir, rename, stat, writeFile, readdir, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { getObject, hasStorageCredentials, listObjects } from '../lib/s3Client.js';

const DEST = process.env.STORAGE_BACKUP_DIR || '/backup/storage';
const KEEP_DAYS = Number(process.env.BACKUP_KEEP_DAYS || 14);

const log = (msg: string) => { console.log(`[storage-backup] ${msg}`); };

/** กันชื่อ key ที่พาออกนอกโฟลเดอร์ปลายทาง (../) — key มาจากระบบเราเองก็จริง แต่ไม่มีเหตุให้ต้องเชื่อ */
function safeTargetPath(key: string): string | null {
  if (key.split('/').some((seg) => seg === '..' || seg === '')) return null;
  return join(DEST, key);
}

async function existingSize(path: string): Promise<number | null> {
  try {
    return (await stat(path)).size;
  } catch {
    return null;
  }
}

/** เก็บรายชื่อไฟล์ที่มีอยู่ ณ วันนั้น ไว้ดูย้อนหลังว่า "วันนั้นระบบมีไฟล์อะไรบ้าง" */
async function writeManifest(objects: Array<{ key: string; size: number }>): Promise<void> {
  const dir = join(DEST, '_manifest');
  await mkdir(dir, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  const lines = objects.map((o) => `${o.size}\t${o.key}`).sort();
  const body = lines.join('\n') + '\n';
  await writeFile(join(dir, `${day}.txt`), body);

  // เก็บรายชื่อย้อนหลังเท่าที่ตั้งไว้ — ตัวไฟล์ที่คัดลอกมาไม่ลบ ลบแค่รายชื่อเก่าเท่านั้น
  const cutoff = Date.now() - KEEP_DAYS * 86_400_000;
  for (const name of await readdir(dir)) {
    const iso = name.replace(/\.txt$/, '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) continue;
    if (Date.parse(iso) < cutoff) await unlink(join(dir, name));
  }
  log(`รายชื่อไฟล์ของวันนี้: ${objects.length} ไฟล์ · sha256 ${createHash('sha256').update(body).digest('hex').slice(0, 12)}`);
}

async function main(): Promise<void> {
  if (!hasStorageCredentials()) {
    console.error('[storage-backup] ยังไม่ได้ตั้งค่า storage — ไม่มีอะไรให้สำรอง');
    process.exit(1);
  }

  const objects = await listObjects();
  let copied = 0;
  let skipped = 0;
  let failed = 0;
  let bytes = 0;

  for (const obj of objects) {
    const target = safeTargetPath(obj.key);
    if (!target) {
      console.error(`[storage-backup] ข้ามชื่อไฟล์ที่ไม่ปลอดภัย: ${obj.key}`);
      failed += 1;
      continue;
    }
    if ((await existingSize(target)) === obj.size) {
      skipped += 1;
      continue;
    }
    try {
      const data = await getObject(obj.key);
      if (!data) {
        console.error(`[storage-backup] อ่าน ${obj.key} ไม่เจอ (อาจถูกลบระหว่างทาง) ข้ามไปก่อน`);
        failed += 1;
        continue;
      }
      // เขียนลงไฟล์ชั่วคราวก่อนแล้วค่อยเปลี่ยนชื่อ — ถ้าดับกลางคันจะไม่เหลือไฟล์ครึ่งๆ ที่ดูเหมือนสำรองสำเร็จ
      await mkdir(dirname(target), { recursive: true });
      const tmp = `${target}.part`;
      await writeFile(tmp, data);
      await rename(tmp, target);
      copied += 1;
      bytes += data.length;
    } catch (error) {
      console.error(`[storage-backup] คัดลอก ${obj.key} ไม่สำเร็จ:`, error);
      failed += 1;
    }
  }

  await writeManifest(objects);
  log(`เสร็จ — คัดลอกใหม่ ${copied} ไฟล์ (${(bytes / 1048576).toFixed(1)} MB) · มีอยู่แล้ว ${skipped} · ไม่สำเร็จ ${failed}`);

  // ออกด้วยรหัสไม่ปกติเมื่อมีไฟล์ที่คัดลอกไม่ได้ ให้เห็นใน log ว่ารอบนั้นไม่ครบ ไม่ใช่ผ่านเงียบๆ
  if (failed > 0) process.exit(1);
}

await main();
