/**
 * ไฟล์ที่ n8n ส่งเข้ามาเก็บรอให้คนกดอ่าน — จุดที่ต้องไม่พลาด: ส่งซ้ำแล้วไม่ซ้อน, ไม่รับไฟล์ที่ไม่ใช่ PDF,
 * และ "ไม่มีการเรียกโมเดล/Gmail" ระหว่างรับ (ทดสอบโดยไม่ได้ตั้งค่าอะไรไว้เลย ถ้าไปแตะจะพัง)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@obs/db';
import { receiveInboundEmail, InboundEmailError } from '../src/lib/inboundEmailService.js';
import { gmailInbox, dismissGmailMessage, listDismissedGmailMessages, readTimesheetFromEmail } from '../src/lib/gmailService.js';

const pdf = (text = 'x') => Buffer.from(`%PDF-1.4\n${text}`).toString('base64');

async function clear() {
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

test('ไม่รับไฟล์ที่ไม่ใช่ PDF และไม่เหลือแถวค้าง', async () => {
  await clear();
  await assert.rejects(
    receiveInboundEmail({ ...base, fileBase64: Buffer.from('ไม่ใช่ pdf').toString('base64') }),
    (e: any) => e instanceof InboundEmailError && e.status === 422,
  );
  assert.equal(await prisma.inboundEmail.count(), 0);
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
