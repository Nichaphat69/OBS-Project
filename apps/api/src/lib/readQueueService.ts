/**
 * คิวอ่าน Timesheet หลายไฟล์พร้อมกัน (เจ้าของระบบสั่ง 23 ก.ย. 69 — ฟีเจอร์ที่เคยตกลงกันไว้ตั้งแต่การประชุม
 * ก่อนหน้า อ้างอิงหน้าตา/ขั้นตอนจากเว็บของ Clear Read เอง: เลือกหลายไฟล์ + เลือกตัวอ่าน/Skill ครั้งเดียว +
 * กด "Process" แล้วอ่านเข้าคิวเบื้องหลัง เห็นสถานะ Queued/Running/Succeeded/Failed)
 *
 * ต่อยอดตาราง `ai_reads` เดิมแทนสร้างตารางคู่ขนาน — เพิ่มสถานะใหม่ **ก่อนหน้า** `pending` เดิมเท่านั้น:
 * `queued` → `running` → `pending` (สำเร็จ พร้อมรีวิว ความหมายเดิมทุกอย่าง) หรือ `failed` (พัง) — โค้ดเก่า
 * ทุกจุดที่กรอง `status: 'pending'` ยังถูกต้อง 100% เพราะแถวจะมาถึง pending ก็ต่อเมื่ออ่านสำเร็จจริงเท่านั้น
 *
 * ⚠️ Clear Read ถูกล็อกให้ใช้แม่แบบเดียวทั้งระบบโดยตั้งใจ (คำสั่งเจ้าของระบบ 17 ก.ย. 69 — ดู
 * uploadService.ts's resolveReaderTemplates()) จึงไม่มี "เลือกแม่แบบ Clear Read ต่อคิว" ในนี้เลย —
 * requestedAbbyySkillId ใช้ได้เฉพาะตอนตัวอ่านที่ขอคือ ABBYY เท่านั้น ฝั่ง Clear Read ไม่ต้องส่งอะไรมา
 * ก็ใช้แม่แบบเดียวที่ตั้งไว้ในระบบเสมออยู่แล้ว (resolveReaderTemplates คืน null เสมอ)
 *
 * ไม่มี rate limit ฝั่ง ABBYY/Clear Read เขียนไว้ในโค้ดเดิมเลย และ Clear Read คิดเครดิตต่อครั้ง + ช้ามาก
 * (~2.8 นาที/หน้า) จึงจำกัดจำนวนที่อ่านพร้อมกันจริงในโค้ดนี้เอง (MAX_CONCURRENT) ไม่ปล่อยยิงพร้อมกันทั้งหมด
 *
 * ⚠️ เจ้าของระบบสั่ง 24 ก.ย. 69 ให้อ่านทีละไฟล์เท่านั้น (ไม่ใช่ 2 ไฟล์พร้อมกันแบบเดิม) — ต้องอ่านไฟล์แรก
 * เสร็จก่อน ถึงจะเริ่มอ่านไฟล์ถัดไปในคิว จึงล็อก MAX_CONCURRENT ไว้ที่ 1 ตายตัว
 */
import { prisma, Prisma } from '@obs/db';
import { readTimesheetFile, UploadError } from './uploadService.js';
import { nextDocumentNo } from './ingestService.js';
import { emitChange } from './events.js';
import { logAudit } from './audit.js';
import { loadFile, storeFile } from './fileStorage.js';

const MAX_CONCURRENT = 1;
const POLL_INTERVAL_MS = 1500;

export class ReadQueueError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** เข้าคิวไฟล์ใหม่ (ยังไม่เคยมีแถว ai_reads มาก่อน) — เก็บไบต์ไฟล์ทันทีเหมือนที่
 * timesheetSubmissionService.ts's submitOwnTimesheetFile() ทำอยู่แล้ว แค่สถานะเริ่มเป็น 'queued' */
export async function enqueueFiles({
  files,
  readerId,
  abbyySkillId,
  actor,
}: {
  files: Array<{ fileBase64: string; fileName: string }>;
  readerId?: string | null;
  abbyySkillId?: string | null;
  actor: string;
}): Promise<number[]> {
  if (files.length === 0) throw new ReadQueueError('ยังไม่ได้เลือกไฟล์');

  const ids: number[] = [];
  for (const f of files) {
    const bytes = Buffer.from(f.fileBase64, 'base64');
    if (bytes.length === 0) throw new ReadQueueError(`ไฟล์ "${f.fileName}" ว่างหรืออ่านไม่ได้`);
    const row = await prisma.aiRead.create({
      data: {
        source: 'batch_upload',
        fileName: f.fileName,
        fileKey: await storeFile('ai-read', bytes, { fileName: f.fileName }),
        status: 'queued',
        requestedReaderId: readerId ?? null,
        requestedAbbyySkillId: abbyySkillId ?? null,
        readAt: new Date().toISOString(),
        readBy: actor,
      },
      select: { id: true },
    });
    ids.push(row.id);
  }

  await logAudit({ actor, action: 'enqueue_read_batch', entityType: 'ai_read', entityId: ids.join(','), detail: { count: ids.length, readerId, abbyySkillId } });
  emitChange('read-queue');
  return ids;
}

/** เข้าคิวแถว ai_reads ที่มีอยู่แล้ว (ไฟล์ที่พนักงานส่งเองผ่านระบบ ยังไม่เคยอ่าน) — ใช้กับแท็บ "ส่งผ่านระบบ"
 * ที่เลือกได้หลายรายการพร้อมกัน เฉพาะแถวที่ยัง 'pending' แบบยังไม่มี extraction (ไม่งั้นจะไปอ่านทับของที่
 * อ่านและรีวิวไปแล้ว) — เช็คจาก extraction เป็น null เท่านั้นที่ปิดคิวได้ */
export async function enqueueExisting({
  aiReadIds,
  readerId,
  abbyySkillId,
}: {
  aiReadIds: number[];
  readerId?: string | null;
  abbyySkillId?: string | null;
}): Promise<number> {
  if (aiReadIds.length === 0) throw new ReadQueueError('ยังไม่ได้เลือกรายการ');
  const result = await prisma.aiRead.updateMany({
    where: { id: { in: aiReadIds }, status: 'pending', extraction: { equals: Prisma.DbNull } },
    data: { status: 'queued', requestedReaderId: readerId ?? null, requestedAbbyySkillId: abbyySkillId ?? null },
  });
  if (result.count > 0) emitChange('read-queue');
  return result.count;
}

/** หยิบแถว 'queued' ไม่เกินจำนวนที่ยังว่างจาก cap ปัจจุบัน มาอ่านจริง — เรียกซ้ำทุก POLL_INTERVAL_MS
 * จาก startQueueWorker() ด้านล่าง แต่ละแถวอ่านเสร็จ/พังแล้วอัปเดตสถานะ + ปลุก SSE ทันที ไม่รอครบทุกแถว */
export async function processQueueOnce(): Promise<void> {
  const runningCount = await prisma.aiRead.count({ where: { status: 'running' } });
  const slots = MAX_CONCURRENT - runningCount;
  if (slots <= 0) return;

  const next = await prisma.aiRead.findMany({
    where: { status: 'queued' },
    orderBy: { id: 'asc' },
    take: slots,
  });
  if (next.length === 0) return;

  await Promise.all(next.map((row) => processOne(row.id)));
}

async function processOne(id: number): Promise<void> {
  const claimed = await prisma.aiRead.updateMany({ where: { id, status: 'queued' }, data: { status: 'running' } });
  if (claimed.count === 0) return; // มีตัวอื่นหยิบไปแล้ว (กันชนกันเผื่อ interval ทับกัน)
  emitChange('read-queue');

  const row = await prisma.aiRead.findUnique({ where: { id } });
  const bytes = await loadFile(row?.fileKey);
  if (!row || !bytes) {
    await prisma.aiRead.update({ where: { id }, data: { status: 'failed', errorMessage: 'ไม่พบไฟล์ต้นฉบับ' } });
    emitChange('read-queue');
    return;
  }

  try {
    const result = await readTimesheetFile({
      fileBytes: bytes,
      fileName: row.fileName,
      readerId: row.requestedReaderId,
      abbyySkillId: row.requestedAbbyySkillId,
    });
    const documentNo = await nextDocumentNo();
    const { fileBytes: _omit, ...resultWithoutBytes } = result;
    await prisma.aiRead.update({
      where: { id },
      data: {
        status: 'pending',
        documentNo,
        model: result.model,
        extraction: resultWithoutBytes as any,
        employeeId: result.matching?.employee?.id ?? null,
        employeeName: result.data?.employeeName ?? null,
        period: result.data?.period ?? null,
        readAt: new Date().toISOString(),
        errorMessage: null,
      },
    });
  } catch (error) {
    const message = error instanceof UploadError ? error.message : (error as Error).message || 'อ่านไฟล์ไม่สำเร็จ';
    await prisma.aiRead.update({ where: { id }, data: { status: 'failed', errorMessage: message } });
  }
  emitChange('read-queue');
}

let workerStarted = false;

/** เริ่ม worker ครั้งเดียวตอน server boot (server.ts) — ก่อนเริ่ม ให้รีเซ็ตแถวที่ค้าง 'running' จาก
 * server restart กลางคันกลับเป็น 'queued' ก่อน ไม่งั้นแถวเหล่านั้นจะค้างสถานะ running ตลอดไปเงียบๆ */
export async function startQueueWorker(): Promise<void> {
  if (workerStarted) return;
  workerStarted = true;

  await prisma.aiRead.updateMany({ where: { status: 'running' }, data: { status: 'queued' } });

  setInterval(() => {
    processQueueOnce().catch((error) => console.error('[readQueueService] processQueueOnce พัง —', error));
  }, POLL_INTERVAL_MS).unref();
}
