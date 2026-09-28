/**
 * คิวอ่าน Timesheet หลายไฟล์พร้อมกัน (readQueueService.ts, 23 ก.ย. 69) — ยังไม่เคยมีเทสต์เลยตั้งแต่
 * สร้างฟีเจอร์นี้ ทดสอบเฉพาะส่วน "เข้าคิว" (enqueueFiles/enqueueExisting) ซึ่งเป็น DB logic ล้วนๆ
 * ไม่ต้องเรียก ABBYY/Clear Read จริง — ส่วน processQueueOnce (เรียกตัวอ่านจริง) ไม่ครอบคลุมในนี้
 *
 * เรื่องที่ต้องตรึงไว้:
 *   1. enqueueFiles ต้องปฏิเสธไฟล์ว่าง/ชื่อว่าง ก่อนแตะฐานข้อมูล เหมือน submitOwnTimesheetFile
 *   2. enqueueExisting ต้องเลือกเฉพาะแถวที่ยัง 'pending' แบบยังไม่มี extraction เท่านั้น — ถ้าไปคิว
 *      ทับแถวที่มี extraction แล้ว (อ่าน/รีวิวไปแล้ว) จะเสียผลอ่านเดิมทิ้งเงียบๆ
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@obs/db';

import { seedFixtures } from './helpers/testDb.js';
import { enqueueFiles, enqueueExisting, ReadQueueError } from '../src/lib/readQueueService.js';
import { loadFile } from '../src/lib/fileStorage.js';

await seedFixtures();

const EMP = 'EMP-0042';
const FILE_B64 = Buffer.from('%PDF-1.4 fake timesheet').toString('base64');

test.after(async () => {
  await prisma.aiRead.deleteMany({ where: { source: { in: ['batch_upload', 'employee_submit'] }, employeeId: EMP } });
  await prisma.$disconnect();
});

test('enqueueFiles ปฏิเสธเมื่อไม่มีไฟล์ หรือไฟล์ว่าง ก่อนแตะฐานข้อมูล', async () => {
  await assert.rejects(
    () => enqueueFiles({ files: [], actor: 'ทดสอบ' }),
    (e: unknown) => e instanceof ReadQueueError && e.status === 400,
  );
  await assert.rejects(
    () => enqueueFiles({ files: [{ fileBase64: '', fileName: 'a.pdf' }], actor: 'ทดสอบ' }),
    (e: unknown) => e instanceof ReadQueueError && e.status === 400,
  );
});

test('enqueueFiles สร้างแถว ai_reads สถานะ queued ต่อไฟล์ พร้อมเก็บไบต์+ตัวอ่านที่เลือกไว้', async () => {
  const ids = await enqueueFiles({
    files: [
      { fileBase64: FILE_B64, fileName: 'a.pdf' },
      { fileBase64: FILE_B64, fileName: 'b.pdf' },
    ],
    readerId: 'abbyy',
    abbyySkillId: 'SKILL-1',
    actor: 'ทดสอบ',
  });
  assert.equal(ids.length, 2);

  const rows = await prisma.aiRead.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' } });
  assert.equal(rows.length, 2);
  for (const [i, row] of rows.entries()) {
    assert.equal(row.status, 'queued');
    assert.equal(row.source, 'batch_upload');
    assert.equal(row.requestedReaderId, 'abbyy');
    assert.equal(row.requestedAbbyySkillId, 'SKILL-1');
    assert.equal(row.fileName, i === 0 ? 'a.pdf' : 'b.pdf');
    assert.equal((await loadFile(row.fileKey))?.toString('utf8'), '%PDF-1.4 fake timesheet');
  }
});

test('enqueueExisting เข้าคิวเฉพาะแถวที่ pending และยังไม่มี extraction เท่านั้น', async () => {
  const untouched = await prisma.aiRead.create({
    data: { source: 'employee_submit', fileName: 'untouched.pdf', status: 'pending', employeeId: EMP, readAt: new Date().toISOString() },
    select: { id: true },
  });
  const alreadyRead = await prisma.aiRead.create({
    data: {
      source: 'employee_submit', fileName: 'already-read.pdf', status: 'pending', employeeId: EMP,
      readAt: new Date().toISOString(), extraction: { data: { employeeName: 'x' } },
    },
    select: { id: true },
  });
  const confirmed = await prisma.aiRead.create({
    data: { source: 'employee_submit', fileName: 'confirmed.pdf', status: 'confirmed', employeeId: EMP, readAt: new Date().toISOString() },
    select: { id: true },
  });

  const count = await enqueueExisting({ aiReadIds: [untouched.id, alreadyRead.id, confirmed.id], readerId: 'abbyy' });
  assert.equal(count, 1, 'ต้องเข้าคิวได้แค่แถวเดียว (untouched) เท่านั้น');

  const [u, a, c] = await Promise.all([
    prisma.aiRead.findUnique({ where: { id: untouched.id } }),
    prisma.aiRead.findUnique({ where: { id: alreadyRead.id } }),
    prisma.aiRead.findUnique({ where: { id: confirmed.id } }),
  ]);
  assert.equal(u?.status, 'queued');
  assert.equal(u?.requestedReaderId, 'abbyy');
  assert.equal(a?.status, 'pending', 'ห้ามแตะแถวที่มี extraction อยู่แล้ว — จะเสียผลอ่านเดิมทิ้ง');
  assert.equal(c?.status, 'confirmed', 'ห้ามแตะแถวที่ confirmed ไปแล้ว');
});

test('enqueueExisting ปฏิเสธเมื่อไม่ได้ส่งรายการมาเลย', async () => {
  await assert.rejects(
    () => enqueueExisting({ aiReadIds: [] }),
    (e: unknown) => e instanceof ReadQueueError && e.status === 400,
  );
});

test('claim pattern ของ processOne (updateMany + count) กันชนกันได้จริงเมื่อสองฝั่งพยายามหยิบแถวเดียวกันพร้อมกัน', async () => {
  const row = await prisma.aiRead.create({
    data: { source: 'batch_upload', fileName: 'race.pdf', status: 'queued', readAt: new Date().toISOString() },
    select: { id: true },
  });

  const [first, second] = await Promise.all([
    prisma.aiRead.updateMany({ where: { id: row.id, status: 'queued' }, data: { status: 'running' } }),
    prisma.aiRead.updateMany({ where: { id: row.id, status: 'queued' }, data: { status: 'running' } }),
  ]);
  assert.equal(first.count + second.count, 1, 'ต้องมีแค่ฝั่งเดียวเท่านั้นที่หยิบแถวนี้ไปได้สำเร็จ');

  await prisma.aiRead.delete({ where: { id: row.id } });
});
