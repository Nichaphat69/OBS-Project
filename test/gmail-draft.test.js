/**
 * ทดสอบขั้น 4.5 — สร้าง **ร่าง** อีเมลวางบิลในกล่อง Drafts ของ Gmail จริง (ไม่ auto-send)
 *
 * `createGmailDraft()` เขียนไว้ใน service.js นานแล้วพร้อม route แต่ไม่มีเทสต์คุมมาก่อน
 * (พบตอนตรวจ checklist กับโค้ดจริง 4 ส.ค. 69) — ใส่ GmailClient ปลอมแทนของจริงเหมือน
 * FakeLineClient ใน test/line-approval.test.js จึงรันได้โดยไม่ต้องมี Gmail credential จริง
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const DB = join(tmpdir(), `obs-gmail-draft-test-${process.pid}.sqlite`);
process.env.DB_PATH = DB;

/* กันไม่ให้ env.js โหลดค่า LINE จริงจาก .env — makeCycleReady() เรียก ingestTimesheet() โดยไม่ได้
   ส่ง lineClient ไปด้วย ถ้า Manday บังเอิญไม่ผ่านตรวจ (ข้อ 2.6) จะยิงเข้า LINE จริงได้ถ้าไม่กันไว้ */
process.env.LINE_CHANNEL_ACCESS_TOKEN = '';
process.env.LINE_CHANNEL_SECRET = '';
process.env.LINE_APPROVER_TARGET = '';

await import('../src/db/seed.js');
const svc = await import('../src/service.js');
const { closeDb, run, get } = await import('../src/db/index.js');
const { GmailClient } = await import('../src/integrations/gmail.js');

test.after(() => {
  closeDb();
  for (const suffix of ['', '-wal', '-shm']) {
    try { rmSync(DB + suffix); } catch { /* ไม่มีไฟล์ก็ข้าม */ }
  }
});

function daysInMonth(period) {
  const [y, m] = period.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

/**
 * สร้างผล extraction ปลอมของเดือนที่ระบุ — ไม่มีวันลา ทำงานครบทุกวันทำงาน
 * ต้องระบุ holidayDates เองถ้าเดือนนั้นมีวันหยุดนักขัตฤกษ์ (ดู HOLIDAYS_2026 ใน seed.js)
 * ไม่งั้นวันทำงานที่นับได้จะมากกว่าวันทำงานมาตรฐานที่ปฏิทินคำนวณ (หักวันหยุดแล้ว) แล้วตรวจไม่ผ่าน
 */
function fakeTimesheet(period, { employeeName, position, holidayDates = [] }) {
  const total = daysInMonth(period);
  const days = [];
  for (let d = 1; d <= total; d += 1) {
    const date = `${period}-${String(d).padStart(2, '0')}`;
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    const weekend = dow === 0 || dow === 6;
    if (weekend) days.push({ date, timeIn: null, timeOut: null, label: 'Weekend', jobDescription: null });
    else if (holidayDates.includes(date)) days.push({ date, timeIn: null, timeOut: null, label: 'Holiday', jobDescription: null });
    else days.push({ date, timeIn: '8:30', timeOut: '17:00', label: null, jobDescription: 'งานตามที่ได้รับมอบหมาย' });
  }
  return {
    vendor: 'iPassion Co.,Ltd.', clientName: 'ThaiLife Insurance Public Co.,Ltd.',
    projectName: 'Outsource for BAU Project', employeeName, position, period,
    totalWorkDays: days.filter((d) => d.timeIn).length, totalLeaveDays: 0,
    days, leaveDays: [], signedByEmployee: true, signedByProjectManager: true, notes: [],
  };
}

function stubExtractor(data) {
  return async () => ({ data, verification: { ok: true, issues: [] }, usage: {}, model: 'stub' });
}

async function makeCycleReady(period, docNoA, docNoB, { holidayDates = [] } = {}) {
  await svc.ingestTimesheet({
    documentNo: docNoA,
    fileBase64: Buffer.from('x').toString('base64'),
    expectedPeriod: period,
    extractor: stubExtractor(fakeTimesheet(period, { employeeName: 'Pongpun Mamak', position: 'Java Programmer', holidayDates })),
  });
  await svc.ingestTimesheet({
    documentNo: docNoB,
    fileBase64: Buffer.from('x').toString('base64'),
    expectedPeriod: period,
    extractor: stubExtractor(fakeTimesheet(period, { employeeName: 'Sunee Maneekasemsuk', position: 'Senior Project Manager', holidayDates })),
  });
  svc.markTimesheetChecked(docNoA, { actor: 'ผู้ตรวจทดสอบ' });
  svc.markTimesheetChecked(docNoB, { actor: 'ผู้ตรวจทดสอบ' });
}

class FakeGmailClient {
  /** @param {object|null} sentMessage  ผลที่ findSentMessage จะคืน — null = ร่างยังไม่ถูกกดส่ง */
  constructor(sentMessage = null) {
    this.created = [];
    this.sentMessage = sentMessage;
    this.lookups = [];
  }

  async createDraft(draft) {
    this.created.push(draft);
    return {
      draftId: 'draft-fake-1',
      messageId: 'msg-fake-1',
      threadId: 'thread-fake-1',
      url: 'https://mail.google.com/mail/?authuser=me#drafts?compose=msg-fake-1',
      attachmentCount: draft.attachments?.length ?? 0,
    };
  }

  async findSentMessage(threadId) {
    this.lookups.push(threadId);
    return this.sentMessage;
  }
}

test('createGmailDraft ปฏิเสธถ้ารอบบิลนี้ยังไม่มีรายการที่วางบิลได้', async () => {
  const gmail = new FakeGmailClient();
  await assert.rejects(
    () => svc.createGmailDraft('CT-26B0113', '2026-04', { actor: 'ทดสอบ', client: gmail }),
    (error) => error.status === 400,
  );
  assert.equal(gmail.created.length, 0);
});

test('เตรียมรอบบิล มี.ค. 2026 ให้พร้อมสร้างร่างอีเมล', async () => {
  await makeCycleReady('2026-03', '2026030201', '2026030200', { holidayDates: ['2026-03-03'] });
  const ready = svc.readyCycles().cycles.find((c) => c.period === '2026-03');
  assert.ok(ready, 'รอบ มี.ค. 2026 ต้องพร้อมวางบิลก่อนจะทดสอบขั้นถัดไปได้');
});

test('createGmailDraft ปฏิเสธถ้าลูกค้ายังไม่มีอีเมลผู้ประสานงานในระบบ', async () => {
  const gmail = new FakeGmailClient();
  await assert.rejects(
    () => svc.createGmailDraft('CT-26B0113', '2026-03', { actor: 'ทดสอบ', client: gmail }),
    (error) => error.status === 400,
  );
  assert.equal(gmail.created.length, 0);
});

test('createGmailDraft สร้างร่างจริงเมื่อมีอีเมลผู้ประสานงานแล้ว — ไม่แตะการส่งเลย', async () => {
  run('UPDATE customers SET contact_email = $email WHERE id = $id',
    { email: 'thanwarat@tli.example.com', id: 'CUS-TLI' });

  const gmail = new FakeGmailClient();
  const result = await svc.createGmailDraft('CT-26B0113', '2026-03', { actor: 'ทดสอบ', client: gmail });

  assert.equal(gmail.created.length, 1, 'ต้องสร้างร่างครั้งเดียว');
  assert.equal(gmail.created[0].to, 'thanwarat@tli.example.com');
  assert.ok(gmail.created[0].subject.length > 0, 'ต้องมีหัวข้ออีเมล');
  assert.ok(gmail.created[0].body.length > 0, 'ต้องมีเนื้ออีเมล');

  /* ยังไม่ได้กดอนุมัติรอบนี้ จึงยังไม่มีใบวางบิลให้แนบ — ได้แค่ Timesheet ตัวจริงของทั้งสองคน
     (เก็บไว้ตอน ingestTimesheet) และ note ต้องบอกตรงๆว่ายังขาดอีกใบ ไม่ใช่เงียบไป */
  const attachments = gmail.created[0].attachments;
  assert.equal(attachments.length, 2, 'ต้องแนบไฟล์ Timesheet ของทั้งสองคน');
  for (const a of attachments) {
    assert.equal(a.mimeType, 'application/pdf');
    assert.equal(Buffer.from(a.content).toString('utf8'), 'x', 'เนื้อไฟล์ต้องตรงกับไฟล์ที่อัปโหลดไว้ตอน ingest');
  }

  assert.equal(result.to, 'thanwarat@tli.example.com');
  assert.equal(result.draftId, 'draft-fake-1');
  assert.match(result.note, /แนบไฟล์ให้แล้ว 2 ใบ/);
  assert.match(result.note, /อีก 1 ใบหาไฟล์ในระบบไม่เจอ/);
});

test('createGmailDraft บันทึก audit log ทุกครั้งที่สร้างร่าง', async () => {
  const log = svc.auditLog({ limit: 5 });
  assert.ok(
    log.some((l) => l.action === 'gmail_draft_created' && l.actor === 'ทดสอบ'),
    'ต้องมีบันทึก gmail_draft_created ของการสร้างร่างครั้งก่อนหน้า',
  );
});

/* ── หลังอนุมัติแล้ว ต้องได้ครบทั้งใบวางบิลและ Timesheet ทุกคน ────────────
   จุดที่คุมไว้: ใบวางบิลตัวจริงถูกดึงจากหน้า share มาเก็บตั้งแต่ตอนอนุมัติ
   แล้วถูกแนบเข้าร่าง Gmail รวมกับ Timesheet — รวมเป็น 3 ไฟล์ในรอบที่มีพนักงาน 2 คน */

const BILL_PDF = Buffer.from('%PDF-1.4\nใบวางบิลจำลอง\n%%EOF');

/** FlowAccount ปลอม — คืนเลขเอกสาร ลิงก์ดูเอกสาร และหน้า share ที่ฝังไฟล์ PDF ไว้เหมือนของจริง */
class FakeFlowAccount {
  constructor() { this.mode = 'sandbox'; }
  async createDraftDocument() {
    return { mode: 'sandbox', ok: true, documentNo: 'BL2026030001', documentId: 300111, status: 'awaiting' };
  }
  async getShareLink() {
    return { mode: 'sandbox', ok: true, link: 'https://doc-api-a.dev.flowaccount.com/api/billingnote/share/html/th/zz9' };
  }
  async fetchSharedPdf(link) {
    if (!link) throw new Error('ต้องมีลิงก์');
    return { mode: 'sandbox', ok: true, bytes: BILL_PDF };
  }
}

test('อนุมัติรอบบิลแล้วเก็บไฟล์ใบวางบิลตัวจริงไว้ในระบบเลย', async () => {
  const result = await svc.approveCycle('CT-26B0113', '2026-03', {
    actor: 'ทดสอบ',
    flowAccount: new FakeFlowAccount(),
  });
  assert.equal(result.documentNo, 'BL2026030001');

  const file = await svc.getInvoiceFile(result.invoiceId);
  assert.ok(file, 'ต้องมีไฟล์ใบวางบิลเก็บไว้หลังอนุมัติ');
  assert.equal(Buffer.from(file.bytes).toString('utf8'), BILL_PDF.toString('utf8'));
  assert.equal(file.filename, 'ใบวางบิล BL2026030001.pdf');
});

test('ร่างอีเมลหลังอนุมัติมีใบวางบิลอยู่ในรายการไฟล์แนบ พร้อม id ให้กดเปิดได้', async () => {
  const detail = svc.previewCycleInvoice('CT-26B0113', '2026-03');
  const attachments = detail.emailDraft.attachments;

  assert.equal(attachments.length, 3, 'ใบวางบิล 1 + Timesheet 2 คน');
  assert.equal(attachments[0].label, 'ใบวางบิล BL2026030001.pdf');
  assert.ok(attachments[0].invoiceId, 'ใบวางบิลต้องมี invoiceId ให้กดโหลดไฟล์ได้');
  assert.ok(attachments.slice(1).every((a) => a.timesheetId), 'Timesheet ทุกใบต้องมี timesheetId');
});

test('createGmailDraft หลังอนุมัติแล้วแนบครบทั้ง 3 ไฟล์ — ใบวางบิล + Timesheet ทั้งสองคน', async () => {
  const gmail = new FakeGmailClient();
  const result = await svc.createGmailDraft('CT-26B0113', '2026-03', { actor: 'ทดสอบ', client: gmail });

  const attachments = gmail.created[0].attachments;
  assert.equal(attachments.length, 3, 'ต้องแนบครบทั้งใบวางบิลและ Timesheet ทั้งสองคน');
  assert.ok(attachments.every((a) => a.mimeType === 'application/pdf'));

  const bill = attachments.find((a) => a.filename === 'ใบวางบิล BL2026030001.pdf');
  assert.ok(bill, 'ต้องมีไฟล์ใบวางบิลอยู่ในร่าง');
  assert.equal(Buffer.from(bill.content).toString('utf8'), BILL_PDF.toString('utf8'));

  const sheets = attachments.filter((a) => a.filename !== bill.filename);
  assert.equal(sheets.length, 2);
  for (const s of sheets) {
    assert.equal(Buffer.from(s.content).toString('utf8'), 'x');
  }

  assert.match(result.note, /แนบไฟล์ให้แล้ว 3 ใบ ครบตามรายการ/);
});

/* ── ปิดรอบเองเมื่อร่างถูกกดส่งจาก Gmail ──────────────────────────────
   เดิมต้องมีคนกดปุ่ม "บันทึกว่าส่งเมลแล้ว" เอง ซึ่งลืมกันประจำ ตอนนี้ดูจาก label SENT แทน */

/** GmailClient ตัวจริงแต่ต่อกับ fetch จำลอง — ใช้ทดสอบการอ่าน response ของ Gmail เอง */
function gmailWithResponses(threadResponse) {
  return new GmailClient({
    clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh',
    fetchImpl: async (url) => {
      if (String(url).includes('oauth2')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: 'tok', expires_in: 3600 }) };
      }
      return threadResponse;
    },
  });
}

/* ── ความทนทานเวลา Gmail สะดุด ─────────────────────────────────────────
   ที่คุมไว้: ยิงถี่/Google ล่ม ต้องลองใหม่เอง · อีเมลเสียฉบับเดียวห้ามล้มทั้งกล่อง
   · ข้อความ error ต้องบอกสาเหตุ ไม่ใช่บอกแค่ path ที่พัง */

/** GmailClient ที่ต่อกับ fetch จำลอง — คิวคำตอบไว้ล่วงหน้าทีละคำขอ */
function gmailWithQueue(queue) {
  const calls = [];
  const client = new GmailClient({
    clientId: 'id',
    clientSecret: 'secret',
    refreshToken: 'refresh',
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (String(url).includes('oauth2')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: 'tok', expires_in: 3600 }) };
      }
      const next = queue.shift();
      if (!next) throw new Error('ไม่มีคำตอบจำลองเหลือแล้ว');
      return next;
    },
  });
  return { client, calls };
}

const err = (status, message) => ({
  ok: false, status, text: async () => JSON.stringify({ error: { message, code: status } }),
});
const ok = (obj) => ({ ok: true, status: 200, text: async () => JSON.stringify(obj) });

test('Gmail ตอบ 429 (ยิงถี่เกิน) → ลองใหม่ให้เองแล้วผ่าน ไม่เด้ง error ใส่หน้าคน', async () => {
  const { client, calls } = gmailWithQueue([err(429, 'Rate Limit Exceeded'), ok({ id: 'm1' })]);
  const result = await client.call('/messages/m1');

  assert.equal(result.id, 'm1');
  assert.equal(calls.filter((u) => u.includes('/messages/')).length, 2, 'ต้องยิงซ้ำครั้งที่สอง');
});

test('Gmail ตอบ 503 (ฝั่ง Google ล่ม) → ลองใหม่เช่นกัน', async () => {
  const { client } = gmailWithQueue([err(503, 'Backend Error'), ok({ id: 'm2' })]);
  assert.equal((await client.call('/messages/m2')).id, 'm2');
});

test('Gmail ตอบ 404 → ไม่ลองซ้ำ เพราะลองกี่ครั้งก็ได้ผลเดิม', async () => {
  const { client, calls } = gmailWithQueue([err(404, 'Requested entity was not found.')]);
  await assert.rejects(() => client.call('/messages/หาย'), (e) => e.status === 404);
  assert.equal(calls.filter((u) => u.includes('/messages/')).length, 1, 'ต้องยิงครั้งเดียวพอ');
});

test('ข้อความ error บอกสาเหตุและทางแก้ ไม่ใช่บอกแค่ path ที่พัง', async () => {
  const { client } = gmailWithQueue([err(401, 'Invalid Credentials')]);
  await assert.rejects(() => client.call('/messages/m3'), (e) => {
    assert.match(e.message, /401/, 'ต้องมีรหัสสถานะ');
    assert.match(e.message, /gmail:auth/, 'ต้องบอกว่าต้องทำอะไรต่อ');
    assert.match(e.message, /Invalid Credentials/, 'ต้องยกคำที่ Google แจ้งมาด้วย');
    return true;
  });
});

test('ขอ token พร้อมกันหลายคำขอ → ยิงขอจริงครั้งเดียว ไม่ไปกระตุ้นให้ Google ตอบ 429', async () => {
  const { client, calls } = gmailWithQueue([ok({ id: 'a' }), ok({ id: 'b' }), ok({ id: 'c' })]);
  await Promise.all([client.call('/messages/a'), client.call('/messages/b'), client.call('/messages/c')]);

  assert.equal(calls.filter((u) => u.includes('oauth2')).length, 1, 'ต้องขอ token ครั้งเดียว');
});

test('อีเมลเสียฉบับเดียว → ข้ามฉบับนั้น ที่เหลือยังใช้ได้ ไม่ล้มทั้งกล่อง', async () => {
  const { client } = gmailWithQueue([
    ok({ messages: [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }] }),
    ok({ id: 'm1', payload: { headers: [], body: {} } }),
    err(404, 'Requested entity was not found.'),   // m2 ถูกลบไปพอดีหลังได้รายการมา
    ok({ id: 'm3', payload: { headers: [], body: {} } }),
  ]);

  const { messages, skipped } = await client.searchMessages({ query: 'x' });
  assert.equal(messages.length, 2, 'อีก 2 ฉบับต้องยังได้มา');
  assert.deepEqual(messages.map((m) => m.id), ['m1', 'm3']);
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].id, 'm2');
  assert.match(skipped[0].reason, /404/);
});

test('findSentMessage อ่าน label SENT + เวลา + ผู้รับ จาก response ของ Gmail ได้ถูก', async () => {
  const gmail = gmailWithResponses({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      messages: [
        { id: 'm1', labelIds: ['DRAFT'], payload: { headers: [] } },
        {
          id: 'm2',
          labelIds: ['SENT', 'INBOX'],
          internalDate: '1775444100000',
          payload: { headers: [{ name: 'To', value: 'thanwarat@tli.example.com' }, { name: 'Subject', value: 'วางบิล' }] },
        },
      ],
    }),
  });

  const sent = await gmail.findSentMessage('thread-1');
  assert.equal(sent.messageId, 'm2', 'ต้องหยิบฉบับที่มี label SENT ไม่ใช่ฉบับร่าง');
  assert.equal(sent.to, 'thanwarat@tli.example.com');
  assert.equal(sent.sentAt, new Date(1775444100000).toISOString());
});

test('findSentMessage คืน null เมื่อสนทนามีแต่ร่าง ยังไม่มีฉบับที่ส่งออก', async () => {
  const gmail = gmailWithResponses({
    ok: true, status: 200,
    text: async () => JSON.stringify({ messages: [{ id: 'm1', labelIds: ['DRAFT'] }] }),
  });
  assert.equal(await gmail.findSentMessage('thread-1'), null);
});

/* ยิงกับ Gmail จริงแล้วเจอว่า id ที่ผิดรูปแบบได้ 400 "Invalid id value" ไม่ใช่ 404 อย่างที่คิดไว้ตอนแรก
   ถ้าไม่ดักไว้ จะโยน error ทุกครั้งที่มีคนเปิดหน้ารอบบิลที่เก็บ threadId เสียไว้ */
for (const status of [400, 404]) {
  test(`findSentMessage คืน null เมื่อ Gmail ตอบ ${status} — ตามสนทนานั้นต่อไม่ได้แล้ว ไม่ใช่ error`, async () => {
    const gmail = gmailWithResponses({
      ok: false, status, text: async () => JSON.stringify({ error: { message: 'Invalid id value' } }),
    });
    assert.equal(await gmail.findSentMessage('thread-เสีย'), null);
  });
}

test('สร้างร่างแล้วต้องผูก threadId ไว้กับใบแจ้งหนี้ — ไม่งั้นตามต่อไม่ได้ว่าถูกกดส่งหรือยัง', async () => {
  const invoiceId = svc.previewCycleInvoice('CT-26B0113', '2026-03').existing.id;
  const row = get('SELECT gmail_draft_id, gmail_thread_id FROM invoices WHERE id = $id', { id: invoiceId });

  assert.equal(row.gmail_draft_id, 'draft-fake-1');
  assert.equal(row.gmail_thread_id, 'thread-fake-1');
});

test('ร่างยังไม่ถูกกดส่ง → รอบบิลยังไม่ปิด ไม่มีแถบ "ส่งเมลแล้ว"', async () => {
  const gmail = new FakeGmailClient(null);
  const detail = await svc.cycleDetail('CT-26B0113', '2026-03', { client: gmail });

  assert.equal(gmail.lookups[0], 'thread-fake-1', 'ต้องไปเช็คสนทนาที่ผูกไว้');
  assert.equal(detail.existing.email_sent_at, null);
});

test('เจอ message ที่มี label SENT → ปิดรอบให้เองพร้อมเวลาและผู้รับจริงจาก Gmail', async () => {
  const gmail = new FakeGmailClient({
    messageId: 'msg-sent-9',
    to: 'thanwarat@tli.example.com',
    subject: 'วางบิลค่าบริการ',
    sentAt: '2026-04-02T03:15:00.000Z',
  });

  const detail = await svc.cycleDetail('CT-26B0113', '2026-03', { client: gmail });

  assert.equal(detail.existing.email_sent_at, '2026-04-02T03:15:00.000Z', 'ต้องใช้เวลาที่ Gmail บอก ไม่ใช่เวลาที่เปิดหน้า');
  assert.match(detail.existing.email_sent_by, /thanwarat@tli\.example\.com/, 'ต้องบอกด้วยว่าส่งถึงใครจริง');

  const log = svc.auditLog({ limit: 20 });
  assert.ok(
    log.some((l) => l.action === 'email_sent_detected'),
    'ต้องบันทึกไว้ว่าระบบเป็นคนตรวจเจอเอง ไม่ใช่คนกดบอก',
  );
});

test('ปิดรอบไปแล้ว → ไม่ไปกวน Gmail ซ้ำอีก', async () => {
  const gmail = new FakeGmailClient({ messageId: 'x', to: 'a@b.c', sentAt: '2026-04-02T03:15:00.000Z' });
  await svc.cycleDetail('CT-26B0113', '2026-03', { client: gmail });

  assert.equal(gmail.lookups.length, 0, 'ใบที่ปิดแล้วต้องออกจากฟังก์ชันก่อนเรียก Gmail');
});

test('Gmail ล่มตอนเช็ค → เปิดหน้ารอบบิลได้ตามปกติ ไม่พังทั้งหน้า', async () => {
  const invoiceId = svc.previewCycleInvoice('CT-26B0113', '2026-03').existing.id;
  // ย้อนใบกลับไปเป็น "ยังไม่ส่ง" เพื่อให้ syncEmailSent ทำงานอีกรอบ
  run('UPDATE invoices SET email_sent_at = NULL, email_sent_by = NULL WHERE id = $id', { id: invoiceId });

  const broken = new FakeGmailClient();
  broken.findSentMessage = async () => { throw new Error('Gmail API ล่ม'); };

  const detail = await svc.cycleDetail('CT-26B0113', '2026-03', { client: broken });
  assert.equal(detail.existing.email_sent_at, null, 'ยังไม่ปิดรอบ');
  assert.ok(detail.invoice, 'แต่หน้ารอบบิลต้องยังเปิดดูได้');
});

test('ใบเก่าที่ยังไม่มีไฟล์เก็บไว้ ไปดึงจากหน้า share ให้ตอนมีคนขอครั้งแรก แล้วเก็บไว้ใช้ครั้งต่อไป', async () => {
  const invoiceId = svc.previewCycleInvoice('CT-26B0113', '2026-03').existing.id;
  // จำลองใบที่สร้างไว้ก่อนมีคอลัมน์นี้ — มีแต่ลิงก์ ยังไม่มีไฟล์
  run('UPDATE invoices SET document_pdf = NULL WHERE id = $id', { id: invoiceId });

  const fa = new FakeFlowAccount();
  let calls = 0;
  fa.fetchSharedPdf = async () => { calls += 1; return { ok: true, bytes: BILL_PDF }; };

  const first = await svc.getInvoiceFile(invoiceId, { client: fa });
  assert.equal(Buffer.from(first.bytes).toString('utf8'), BILL_PDF.toString('utf8'));
  assert.equal(calls, 1, 'ครั้งแรกต้องออกไปดึงจาก FlowAccount');

  await svc.getInvoiceFile(invoiceId, { client: fa });
  assert.equal(calls, 1, 'ครั้งที่สองต้องอ่านจากฐานข้อมูล ไม่ออกไปดึงซ้ำ');
});
