/**
 * ไฟล์ที่ n8n ส่งเข้ามาเก็บรอให้คนกดอ่าน — จุดที่ต้องไม่พลาด: ส่งซ้ำแล้วไม่ซ้อน, ไม่รับไฟล์ที่อ่านไม่ได้ (รับ PDF/Excel/CSV/ภาพสแกน),
 * และ "ไม่มีการเรียกโมเดล/Gmail" ระหว่างรับ (ทดสอบโดยไม่ได้ตั้งค่าอะไรไว้เลย ถ้าไปแตะจะพัง)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@obs/db';
import { receiveInboundEmail, InboundEmailError } from '../src/lib/inboundEmailService.js';
import { enqueueFromInbox, ReadQueueError } from '../src/lib/readQueueService.js';
import { gmailInbox, dismissGmailMessage, listDismissedGmailMessages, readTimesheetFromEmail } from '../src/lib/gmailService.js';

const pdf = (text = 'x') => Buffer.from(`%PDF-1.4\n${text}`).toString('base64');

async function clear() {
  await prisma.aiRead.deleteMany({ where: { source: 'gmail' } });
  await prisma.gmailDismissed.deleteMany({});
  await prisma.inboundEmail.deleteMany({});
}

const base = { sourceEmailId: 'mail-1', fileName: 'ts.pdf', fileBase64: pdf(), subject: 'Timesheet ส.ค.', from: 'A <a@client.co.th>', bodyText: 'กรุณาอนุมัติ', receivedAt: '2026-09-30T02:00:00.000Z' };

test('รับไฟล์แล้วโผล่ในรายการรออ่าน โดยไม่ผ่านโมเดล', async () => {
  await clear();
  const r = await receiveInboundEmail(base);
  assert.equal(r.duplicate, false);
  const inbox = await gmailInbox({});
  assert.equal(inbox.messages.length, 1);
  assert.equal(inbox.messages[0].id, 'mail-1');
  assert.equal(inbox.messages[0].subject, 'Timesheet ส.ค.');
  assert.equal(inbox.messages[0].attachments[0].filename, 'ts.pdf');
  assert.ok(inbox.messages[0].attachments[0].size > 0);
});

test('ส่งซ้ำไฟล์เดิมไม่ซ้อนแถว', async () => {
  await clear();
  const a = await receiveInboundEmail(base);
  const b = await receiveInboundEmail(base);
  assert.equal(b.duplicate, true);
  assert.equal(b.id, a.id);
  assert.equal(await prisma.inboundEmail.count(), 1);
});

test('อีเมลเดียวหลายไฟล์ รวมเป็นอีเมลเดียวในรายการ', async () => {
  await clear();
  await receiveInboundEmail(base);
  await receiveInboundEmail({ ...base, fileName: 'ts2.pdf' });
  const inbox = await gmailInbox({});
  assert.equal(inbox.messages.length, 1);
  assert.equal(inbox.messages[0].attachments.length, 2);
});

test('ไม่รับไฟล์ที่อ่านไม่ได้ (Word/ZIP/ไบนารี) และไม่เหลือแถวค้าง', async () => {
  await clear();
  const docx = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('[Content_Types].xml word/document.xml')]);
  for (const [name, bytes] of [
    ['report.docx', docx],
    ['data.bin', Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04])],
    ['x.zip', Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('a.txt')])],
  ] as Array<[string, Buffer]>) {
    await assert.rejects(
      receiveInboundEmail({ ...base, fileName: name, fileBase64: bytes.toString('base64') }),
      (e: any) => e instanceof InboundEmailError && e.status === 422 && /รองรับ|รับเฉพาะ/.test(e.message),
      name,
    );
  }
  assert.equal(await prisma.inboundEmail.count(), 0);
});

test('รับ Excel (xlsx/xls) / CSV / ภาพสแกน โดยตรวจจากเนื้อไฟล์ ไม่ใช่นามสกุล', async () => {
  await clear();
  const xlsx = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('[Content_Types].xml xl/workbook.xml')]);
  const xls = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(64)]);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
  const csv = Buffer.from('วันที่,เวลาเข้า,เวลาออก\n1/9/2026,09:00,18:00\n');
  const cases: Array<[string, Buffer, RegExp]> = [
    ['t.xlsx', xlsx, /spreadsheetml/],
    // นามสกุลหลอก: ชื่อ .pdf แต่เนื้อเป็น xlsx — ต้องจัดตามเนื้อไฟล์
    ['fake.pdf', xlsx, /spreadsheetml/],
    ['t.xls', xls, /ms-excel/],
    ['scan.png', png, /image\/png/],
    ['scan.jpg', jpg, /image\/jpeg/],
    ['t.csv', csv, /text\/csv/],
  ];
  for (const [i, [name, bytes]] of cases.entries()) {
    const r = await receiveInboundEmail({ ...base, sourceEmailId: `mail-kind-${i}`, fileName: name, fileBase64: bytes.toString('base64') });
    assert.equal(r.duplicate, false, name);
  }
  assert.equal(await prisma.inboundEmail.count(), cases.length);
});

test('ขาดข้อมูลจำเป็นต้องถูกปฏิเสธ', async () => {
  await clear();
  await assert.rejects(receiveInboundEmail({ ...base, sourceEmailId: '' }), InboundEmailError);
  await assert.rejects(receiveInboundEmail({ ...base, fileName: undefined }), InboundEmailError);
  await assert.rejects(receiveInboundEmail({ ...base, fileBase64: undefined }), InboundEmailError);
});

test('ซ่อนแล้วหายจากรายการ และดูรายการที่ซ่อนได้พร้อมหัวเรื่อง', async () => {
  await clear();
  await receiveInboundEmail(base);
  await dismissGmailMessage('mail-1', { actor: 'tester' });
  assert.equal((await gmailInbox({})).messages.length, 0);
  const dismissed = await listDismissedGmailMessages();
  assert.equal(dismissed[0].subject, 'Timesheet ส.ค.');
});

test('กดอ่านอีเมลที่ไม่มีในรายการต้องบอก 404 ไม่ใช่ไปถาม Gmail', async () => {
  await clear();
  await assert.rejects(
    readTimesheetFromEmail({ messageId: 'ไม่มีจริง' }),
    (e: any) => e.status === 404,
  );
});

test('เข้าคิวอ่านไฟล์ที่ n8n ส่งมา: สร้างแถว queued ใช้ไฟล์เดิม ไม่ต้องไปโหลดจาก Gmail และซ่อนจากรายการ', async () => {
  await clear();
  await receiveInboundEmail(base);
  const stored = await prisma.inboundEmail.findFirstOrThrow({});
  const [q] = await enqueueFromInbox({ items: [{ messageId: 'mail-1', attachmentFilename: 'ts.pdf' }], readerId: 'abbyy', abbyySkillId: 'skill-1', actor: 'tester' });
  const row = await prisma.aiRead.findUniqueOrThrow({ where: { id: q.id } });
  assert.equal(row.status, 'queued');
  assert.equal(row.source, 'gmail');
  assert.equal(row.sourceEmailId, 'mail-1');
  assert.equal(row.fileKey, stored.fileKey);
  assert.equal(row.requestedReaderId, 'abbyy');
  assert.equal(row.requestedAbbyySkillId, 'skill-1');
  assert.equal(q.subject, 'Timesheet ส.ค.');
  // กำลังอยู่ในคิว → ไม่โผล่ในรายการให้กดซ้ำ
  assert.equal((await gmailInbox({})).messages.length, 0);
});

test('กดเข้าคิวซ้ำไม่เกิดแถวซ้ำ', async () => {
  await clear();
  await receiveInboundEmail(base);
  const a = await enqueueFromInbox({ items: [{ messageId: 'mail-1' }], actor: 't' });
  const b = await enqueueFromInbox({ items: [{ messageId: 'mail-1' }], actor: 't' });
  assert.equal(a[0].id, b[0].id);
  assert.equal(await prisma.aiRead.count({ where: { source: 'gmail' } }), 1);
});

test('ไฟล์ที่อ่านล้มเหลวกลับเข้าคิวได้ที่แถวเดิม และยังโผล่ในรายการให้ลองใหม่', async () => {
  await clear();
  await receiveInboundEmail(base);
  const [a] = await enqueueFromInbox({ items: [{ messageId: 'mail-1' }], actor: 't' });
  await prisma.aiRead.update({ where: { id: a.id }, data: { status: 'failed', errorMessage: 'พัง' } });
  assert.equal((await gmailInbox({})).messages.length, 1, 'แถวที่ failed ต้องกลับมาให้กดลองใหม่');
  const [b] = await enqueueFromInbox({ items: [{ messageId: 'mail-1' }], actor: 't', readerId: 'clear-read' });
  assert.equal(b.id, a.id);
  const row = await prisma.aiRead.findUniqueOrThrow({ where: { id: a.id } });
  assert.equal(row.status, 'queued');
  assert.equal(row.errorMessage, null);
  assert.equal(row.requestedReaderId, 'clear-read');
});

test('เข้าคิวอีเมลที่ไม่มีในรายการต้องบอก 404', async () => {
  await clear();
  await assert.rejects(
    enqueueFromInbox({ items: [{ messageId: 'ไม่มีจริง' }], actor: 't' }),
    (e: any) => e instanceof ReadQueueError && e.status === 404,
  );
});
