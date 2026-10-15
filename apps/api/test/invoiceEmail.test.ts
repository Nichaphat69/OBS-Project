/**
 * ทดสอบอีเมล INV — createGmailDraft() / syncEmailSent() (17 ก.ย. 69)
 *
 * Ported from test/gmail-draft.test.js (assertions ตั้งแต่บรรทัด 111 เก็บความหมายไว้ครบ) ต่างจาก
 * ต้นฉบับตรงที่ใช้ฐานข้อมูลเทสต์ Postgres + fixture จาก helpers/testDb.ts แทน SQLite ชั่วคราว และใช้
 * GmailClient ปลอมแทนของจริง — ไม่ยิงออกเน็ตเลยสักครั้ง
 *
 * ⚠️ เทสที่สำคัญที่สุดในไฟล์นี้คือตัวที่ยืนยันว่า **ไม่มีการส่งอีเมลจริง** อีเมลฝั่งธุรกิจต้องเป็นแค่ร่างให้
 * คนกดส่งเองเสมอ ถ้าวันหนึ่งมีคนเผลอเปลี่ยนไปเรียก sendMessage() เทสตัวนั้นต้องแดง
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@obs/db';

import { seedFixtures, CUSTOMER, CONTRACT } from './helpers/testDb.js';
import { createGmailDraft, syncEmailSent, InvoiceEmailError } from '../src/lib/invoiceEmailService.js';
import { storeFile } from '../src/lib/fileStorage.js';

/** GmailClient ปลอม — บันทึกทุกอย่างที่ถูกเรียก เพื่อยืนยันว่าแตะเฉพาะร่าง ไม่แตะการส่ง */
class FakeGmailClient {
  created: any[] = [];
  sendCalls = 0;
  sentMessage: any = null;
  throwOnFind: Error | null = null;

  async createDraft(args: any) {
    this.created.push(args);
    return { draftId: 'draft-fake-1', threadId: 'thread-fake-1', messageId: 'msg-fake-1' };
  }

  /** ถ้าเส้นทางไหนเผลอเรียกตัวนี้ = ผิดกติกาทันที */
  async sendMessage() {
    this.sendCalls += 1;
    throw new Error('เส้นทางออก INV ห้ามส่งอีเมลจริง — ต้องเป็นร่างเท่านั้น');
  }

  async findSentMessage() {
    if (this.throwOnFind) throw this.throwOnFind;
    return this.sentMessage;
  }
}

const PERIOD = '2026-01';

async function withContactEmail(email: string | null) {
  await prisma.customer.update({ where: { id: CUSTOMER.id }, data: { contactEmail: email } });
}

/** ใส่ไฟล์ต้นฉบับให้ Timesheet เหมือนตอน ingest จริง — fixture ไม่ได้ใส่มาให้ */
async function giveTimesheetFiles(ids: string[]) {
  for (const id of ids) {
    const sourceFileKey = await storeFile('timesheet', Buffer.from('x'), { fileName: `${id}.pdf` });
    await prisma.timesheet.update({ where: { id }, data: { sourceFileKey } });
  }
}

test('createGmailDraft ปฏิเสธถ้ารอบบิลนี้ยังไม่มีรายการที่ออก INV ได้', async () => {
  await seedFixtures();
  const gmail = new FakeGmailClient();
  await assert.rejects(
    () => createGmailDraft(CONTRACT.id, '2026-04', { actor: 'ทดสอบ', client: gmail as any }),
    (error: any) => error instanceof InvoiceEmailError && error.status === 400,
  );
  assert.equal(gmail.created.length, 0, 'ปฏิเสธแล้วต้องไม่ไปแตะ Gmail เลย');
});

test('createGmailDraft ปฏิเสธถ้าลูกค้ายังไม่มีอีเมลผู้ประสานงานในระบบ', async () => {
  await seedFixtures();
  await withContactEmail(null);
  const gmail = new FakeGmailClient();
  await assert.rejects(
    () => createGmailDraft(CONTRACT.id, PERIOD, { actor: 'ทดสอบ', client: gmail as any }),
    (error: any) => error instanceof InvoiceEmailError && error.status === 400,
  );
  assert.equal(gmail.created.length, 0);
});

test('createGmailDraft สร้างร่างจริงเมื่อมีอีเมลแล้ว — และไม่แตะการส่งเลย', async () => {
  await seedFixtures();
  await withContactEmail('thanwarat@tli.example.com');
  await giveTimesheetFiles(['2026010090', '2026010091']);

  const gmail = new FakeGmailClient();
  const result: any = await createGmailDraft(CONTRACT.id, PERIOD, { actor: 'ทดสอบ', client: gmail as any });

  assert.equal(gmail.created.length, 1, 'ต้องสร้างร่างครั้งเดียว');
  assert.equal(gmail.sendCalls, 0, 'ห้ามส่งอีเมลจริงเด็ดขาด — ต้องเป็นร่างเท่านั้น');
  assert.equal(gmail.created[0].to, 'thanwarat@tli.example.com');
  assert.ok(gmail.created[0].subject.length > 0, 'ต้องมีหัวข้ออีเมล');
  assert.ok(gmail.created[0].body.length > 0, 'ต้องมีเนื้ออีเมล');
  assert.equal(result.to, 'thanwarat@tli.example.com');
  assert.equal(result.draftId, 'draft-fake-1');
});

test('แนบไฟล์ Timesheet ที่มีจริงให้ครบ และบอกตรงๆว่าขาดอีกกี่ใบ ไม่เงียบ', async () => {
  await seedFixtures();
  await withContactEmail('thanwarat@tli.example.com');
  await giveTimesheetFiles(['2026010090', '2026010091']);

  const gmail = new FakeGmailClient();
  const result: any = await createGmailDraft(CONTRACT.id, PERIOD, { actor: 'ทดสอบ', client: gmail as any });

  // ยังไม่ได้อนุมัติรอบนี้ จึงยังไม่มีINV ให้แนบ — ได้แค่ Timesheet ของทั้งสองคน
  const attachments = gmail.created[0].attachments;
  assert.equal(attachments.length, 2, 'ต้องแนบ Timesheet ของทั้งสองคน');
  for (const a of attachments) {
    assert.equal(a.mimeType, 'application/pdf');
    assert.equal(Buffer.from(a.content).toString('utf8'), 'x', 'เนื้อไฟล์ต้องตรงกับที่เก็บไว้ตอน ingest');
  }
  assert.match(result.note, /แนบไฟล์ให้แล้ว 2 ใบ/);
  assert.match(result.note, /อีก 1 ใบหาไฟล์ในระบบไม่เจอ/);
});

test('ไฟล์แนบหาไม่เจอสักใบ ต้องยังสร้างร่างได้ ไม่ล้มทั้งฉบับ', async () => {
  await seedFixtures();
  await withContactEmail('thanwarat@tli.example.com');
  // ไม่ใส่ไฟล์ต้นฉบับให้ใครเลย

  const gmail = new FakeGmailClient();
  const result: any = await createGmailDraft(CONTRACT.id, PERIOD, { actor: 'ทดสอบ', client: gmail as any });

  assert.equal(gmail.created.length, 1, 'ยังต้องสร้างร่างได้แม้ไม่มีไฟล์แนบเลย');
  assert.equal(gmail.created[0].attachments.length, 0);
  assert.match(result.note, /ยังไม่มีไฟล์ในระบบเลย/);
});

test('createGmailDraft บันทึก audit log ทุกครั้งที่สร้างร่าง', async () => {
  await seedFixtures();
  await withContactEmail('thanwarat@tli.example.com');
  const gmail = new FakeGmailClient();
  await createGmailDraft(CONTRACT.id, PERIOD, { actor: 'ทดสอบ', client: gmail as any });

  const log = await prisma.auditLog.findMany({ where: { action: 'gmail_draft_created' } });
  assert.equal(log.length, 1);
  assert.equal(log[0].actor, 'ทดสอบ');
});

// ── syncEmailSent ────────────────────────────────────────────────

/** ใบแจ้งหนี้ขั้นต่ำสำหรับทดสอบการตามดูว่าถูกกดส่งหรือยัง */
async function makeInvoice(fields: Record<string, unknown> = {}) {
  return prisma.invoice.create({
    data: {
      id: 'INV-TEST-1',
      contractId: CONTRACT.id,
      period: PERIOD,
      documentNo: 'BL2026010001',
      documentDate: '2026-02-01',
      total: 100, discountTotal: 0, totalAfterDiscount: 100,
      vat: 7, grandTotal: 107, withholdingTax: 3, paymentAmount: 104,
      status: 'sent_to_flowaccount',
      createdAt: '2026-02-01T00:00:00+07:00',
      ...fields,
    },
  });
}

test('syncEmailSent บันทึกเวลาส่งให้เองเมื่อเจอว่าร่างถูกกดส่งแล้ว', async () => {
  await seedFixtures();
  await makeInvoice({ gmailThreadId: 'thread-fake-1' });

  const gmail = new FakeGmailClient();
  gmail.sentMessage = { messageId: 'm1', sentAt: '2026-02-02T09:00:00+07:00', to: 'thanwarat@tli.example.com' };

  assert.equal(await syncEmailSent('INV-TEST-1', { client: gmail as any }), true);
  const inv = await prisma.invoice.findUnique({ where: { id: 'INV-TEST-1' } });
  assert.equal(inv?.emailSentAt, '2026-02-02T09:00:00+07:00');
  assert.match(inv?.emailSentBy ?? '', /thanwarat@tli.example.com/);
});

test('syncEmailSent ไม่ไปกวน Gmail ซ้ำถ้าใบนั้นบันทึกว่าส่งแล้ว', async () => {
  await seedFixtures();
  await makeInvoice({ gmailThreadId: 'thread-fake-1', emailSentAt: '2026-02-02T09:00:00+07:00' });

  let called = false;
  const gmail = { async findSentMessage() { called = true; return null; } };
  assert.equal(await syncEmailSent('INV-TEST-1', { client: gmail as any }), false);
  assert.equal(called, false, 'ใบที่ปิดไปแล้วต้องไม่ยิงถาม Gmail อีก');
});

test('syncEmailSent ออกทันทีถ้ายังไม่มี threadId ผูกไว้', async () => {
  await seedFixtures();
  await makeInvoice({ gmailThreadId: null });

  let called = false;
  const gmail = { async findSentMessage() { called = true; return null; } };
  assert.equal(await syncEmailSent('INV-TEST-1', { client: gmail as any }), false);
  assert.equal(called, false);
});

test('Gmail ล่มต้องไม่ทำให้พัง — คืน false แล้วบันทึกไว้ตามดูย้อนหลัง', async () => {
  await seedFixtures();
  await makeInvoice({ gmailThreadId: 'thread-fake-1' });

  const gmail = new FakeGmailClient();
  gmail.throwOnFind = new Error('Gmail API ล่ม');

  // ต้องไม่ throw ออกมา ไม่งั้นหน้ารอบบิลจะเปิดไม่ได้เลยตอน Gmail มีปัญหา
  assert.equal(await syncEmailSent('INV-TEST-1', { client: gmail as any }), false);
  const log = await prisma.auditLog.findMany({ where: { action: 'email_sent_check_failed' } });
  assert.equal(log.length, 1);
});
