/**
 * ทดสอบขั้น 4.2 — ประตูมนุษย์ผ่าน LINE ก่อนสร้างร่างใน FlowAccount
 *
 * ใส่ LineClient ปลอมแทนของจริง (เหมือน stubExtractor ใน ingest.test.js) จึงรันได้
 * โดยไม่ต้องมี LINE_CHANNEL_ACCESS_TOKEN และไม่ยิงออกเน็ตจริง
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const DB = join(tmpdir(), `obs-line-approval-test-${process.pid}.sqlite`);
process.env.DB_PATH = DB;
process.env.LINE_APPROVER_USER_IDS = 'Uapprover1';
/* กันไม่ให้ env.js โหลดค่า LINE จริงจาก .env — ทุกจุดในไฟล์นี้ที่ยิง LINE จริงต้องผ่าน FakeLineClient
   เสมอ แต่ ingestAndCheckBothEmployees() เรียก ingestTimesheet() โดยไม่ได้ส่ง lineClient ไปด้วย
   ถ้า Manday บังเอิญไม่ผ่านตรวจ (ข้อ 2.6) จะยิงเข้า LINE จริงได้ถ้าไม่กันไว้ */
process.env.LINE_CHANNEL_ACCESS_TOKEN = '';
process.env.LINE_CHANNEL_SECRET = '';
process.env.LINE_APPROVER_TARGET = '';

await import('../src/db/seed.js');
const svc = await import('../src/service.js');
const { closeDb } = await import('../src/db/index.js');
const {
  verifyLineSignature, parseApprovalPostback, buildApprovalPostback, isAuthorizedApprover,
} = await import('../src/integrations/line.js');

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

async function ingestAndCheckBothEmployees(period, docNoA, docNoB, { holidayDates = [] } = {}) {
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

class FakeLineClient {
  constructor() { this.sent = []; }
  async pushApprovalRequest(payload) {
    this.sent.push(payload);
    return { sentTo: 'fake-target' };
  }
}

function signedWebhookBody(events, secret = 'test-secret') {
  const raw = Buffer.from(JSON.stringify({ events }), 'utf8');
  const signature = createHmac('sha256', secret).update(raw).digest('base64');
  return { raw, signature };
}

test('เตรียมรอบบิล ก.พ. 2026 ให้พร้อมส่งขออนุมัติ', async () => {
  await ingestAndCheckBothEmployees('2026-02', '2026020201', '2026020200');

  const ready = svc.readyCycles().cycles.find((c) => c.period === '2026-02');
  assert.ok(ready, 'รอบ ก.พ. 2026 ต้องพร้อมวางบิลก่อนจะทดสอบขั้นถัดไปได้');
});

test('requestCycleApproval ส่งเข้า LINE แต่ยังไม่สร้างเอกสารใดๆ', async () => {
  const line = new FakeLineClient();
  const approval = await svc.requestCycleApproval('CT-26B0113', '2026-02', { actor: 'ทดสอบ', client: line });

  assert.equal(approval.status, 'pending');
  assert.equal(line.sent.length, 1, 'ต้องส่งเข้า LINE ครั้งเดียว');
  assert.equal(line.sent[0].contractId, 'CT-26B0113');
  assert.equal(line.sent[0].headcount, 2);
  assert.ok(line.sent[0].paymentAmount > 0, 'ต้องส่งยอดรับชำระจริงไปให้คนดูก่อนกด');

  const invoices = svc.listInvoices();
  assert.ok(
    !invoices.some((i) => i.contract_id === 'CT-26B0113' && i.period === '2026-02'),
    'ยังไม่มีใบแจ้งหนี้ใน FlowAccount จนกว่าจะมีคนกดอนุมัติ',
  );
});

test('ส่งซ้ำตอนยัง pending → ไม่ยิง LINE อีกรอบ', async () => {
  const line = new FakeLineClient();
  const approval = await svc.requestCycleApproval('CT-26B0113', '2026-02', { actor: 'ทดสอบ', client: line });

  assert.equal(approval.status, 'pending');
  assert.equal(line.sent.length, 0, 'มีคำขอ pending ค้างอยู่แล้ว ไม่ควรส่งซ้ำ');
});

test('userId ที่ไม่อยู่ในรายชื่อผู้อนุมัติ กดอนุมัติไม่ได้', async () => {
  const { raw, signature } = signedWebhookBody([
    {
      type: 'postback',
      source: { userId: 'Uintruder' },
      postback: { data: buildApprovalPostback('approve', 'CT-26B0113', '2026-02') },
    },
  ]);

  const result = await svc.processLineWebhook(raw, signature, { channelSecret: 'test-secret' });

  assert.equal(result.results[0].outcome, 'denied');
  assert.equal(svc.getCycleApproval('CT-26B0113', '2026-02').status, 'pending', 'ยังต้องเป็น pending อยู่');
});

test('ลายเซ็นไม่ตรง → ปฏิเสธ webhook ทั้งฉบับ', async () => {
  const { raw } = signedWebhookBody([
    { type: 'postback', source: { userId: 'Uapprover1' }, postback: { data: 'approve:CT-26B0113:2026-02' } },
  ]);

  await assert.rejects(
    () => svc.processLineWebhook(raw, 'ลายเซ็นปลอม', { channelSecret: 'test-secret' }),
    (error) => error.status === 401,
  );
});

test('ผู้อนุมัติที่ถูกต้องกดปุ่ม "อนุมัติ" → สร้างร่างใน FlowAccount จริง', async () => {
  const { raw, signature } = signedWebhookBody([
    {
      type: 'postback',
      source: { userId: 'Uapprover1' },
      postback: { data: buildApprovalPostback('approve', 'CT-26B0113', '2026-02') },
    },
  ]);

  const result = await svc.processLineWebhook(raw, signature, { channelSecret: 'test-secret' });

  assert.equal(result.results[0].outcome.status, 'approved');
  assert.ok(result.results[0].outcome.result.documentNo, 'ต้องได้เลขเอกสาร (โหมด dry-run เป็นเลขเสมือน)');

  const preview = svc.previewCycleInvoice('CT-26B0113', '2026-02');
  assert.equal(preview.existing.status, 'sent_to_flowaccount');
});

test('กดปุ่มซ้ำหลังอนุมัติไปแล้ว → ไม่สร้างซ้ำ ไม่ error', async () => {
  const { raw, signature } = signedWebhookBody([
    {
      type: 'postback',
      source: { userId: 'Uapprover1' },
      postback: { data: buildApprovalPostback('approve', 'CT-26B0113', '2026-02') },
    },
  ]);

  const result = await svc.processLineWebhook(raw, signature, { channelSecret: 'test-secret' });
  assert.equal(result.results[0].outcome.status, 'approved');
  assert.equal(result.results[0].outcome.result, undefined, 'ไม่เรียก approveCycle ซ้ำ จึงไม่มี result ใหม่');
});

test('ตีกลับ (reject) → ไม่สร้างเอกสาร บันทึกสถานะ rejected', async () => {
  await ingestAndCheckBothEmployees('2026-03', '2026030201', '2026030200', { holidayDates: ['2026-03-03'] });
  const line = new FakeLineClient();
  await svc.requestCycleApproval('CT-26B0113', '2026-03', { actor: 'ทดสอบ', client: line });

  const { raw, signature } = signedWebhookBody([
    {
      type: 'postback',
      source: { userId: 'Uapprover1' },
      postback: { data: buildApprovalPostback('reject', 'CT-26B0113', '2026-03') },
    },
  ]);
  const result = await svc.processLineWebhook(raw, signature, { channelSecret: 'test-secret' });

  assert.equal(result.results[0].outcome.status, 'rejected');
  assert.equal(svc.getCycleApproval('CT-26B0113', '2026-03').decided_by, 'Uapprover1');

  const invoices = svc.listInvoices();
  assert.ok(
    !invoices.some((i) => i.contract_id === 'CT-26B0113' && i.period === '2026-03'),
    'ตีกลับแล้วต้องไม่มีใบแจ้งหนี้ถูกสร้าง',
  );
});

test('requestCycleApproval ส่งขออนุมัติให้ทุกคนในรายชื่อผู้รับแจ้งเตือน LINE ไม่ใช่แค่คนแรก', async () => {
  const first = svc.addNotificationRecipient({
    channel: 'line', label: 'คนแรก', target: 'Utestline1', actor: 'ทดสอบ',
  });
  const second = svc.addNotificationRecipient({
    channel: 'line', label: 'คนที่สอง', target: 'Utestline2', actor: 'ทดสอบ',
  });
  assert.deepEqual(svc.lineApproverTargets(), ['Utestline1', 'Utestline2']);

  try {
    await ingestAndCheckBothEmployees('2026-04', '2026040201', '2026040200', {
      holidayDates: ['2026-04-06', '2026-04-13', '2026-04-14', '2026-04-15'],
    });
    const line = new FakeLineClient();
    await svc.requestCycleApproval('CT-26B0113', '2026-04', { actor: 'ทดสอบ', client: line });

    assert.deepEqual(
      line.sent[0].targets, ['Utestline1', 'Utestline2'],
      'ต้องส่งรายชื่อปลายทางครบทุกคน ไม่ใช่แค่ Utestline1 ตัวแรก',
    );
  } finally {
    svc.removeNotificationRecipient(first.id, { actor: 'ทดสอบ' });
    svc.removeNotificationRecipient(second.id, { actor: 'ทดสอบ' });
  }
});

test('buildApprovalPostback / parseApprovalPostback ย้อนกลับกันได้ตรง', () => {
  const data = buildApprovalPostback('reject', 'CT-26B0113', '2026-05');
  assert.deepEqual(parseApprovalPostback(data), {
    decision: 'rejected', contractId: 'CT-26B0113', period: '2026-05',
  });
  assert.equal(parseApprovalPostback('garbage'), null);
});

test('isAuthorizedApprover ปิดรับทุกคนถ้ายังไม่ตั้งรายชื่อ', () => {
  const original = process.env.LINE_APPROVER_USER_IDS;
  process.env.LINE_APPROVER_USER_IDS = '';
  assert.equal(isAuthorizedApprover('Uanyone'), false);
  process.env.LINE_APPROVER_USER_IDS = original;
});

test('verifyLineSignature ปฏิเสธเมื่อไม่มี signature หรือ secret', () => {
  assert.equal(verifyLineSignature(Buffer.from('x'), null, 'secret'), false);
  assert.equal(verifyLineSignature(Buffer.from('x'), 'sig', ''), false);
});

test('ผู้รับแจ้งเตือน LINE คนแรกในรายชื่อกลายเป็นปลายทางจริงของ requestCycleApproval แทน env', () => {
  const fallback = process.env.LINE_APPROVER_TARGET ?? null;
  assert.equal(svc.lineApproverTarget(), fallback, 'ยังไม่มีใครเพิ่ม ต้อง fallback ไป env');

  const added = svc.addNotificationRecipient({
    channel: 'line', label: 'nicha', target: 'Utestline1', actor: 'ทดสอบ',
  });
  assert.equal(added.channel, 'line');
  assert.equal(svc.lineApproverTarget(), 'Utestline1', 'มีคนอยู่ในรายชื่อแล้ว ต้องใช้ค่านี้แทน env');
  assert.ok(svc.listNotificationRecipients().some((r) => r.id === added.id));

  svc.removeNotificationRecipient(added.id, { actor: 'ทดสอบ' });
  assert.equal(svc.lineApproverTarget(), fallback, 'ลบแล้วต้องกลับไปใช้ env เหมือนเดิม');
});

test('addNotificationRecipient ปฏิเสธ channel ที่ไม่รู้จักและอีเมลรูปแบบผิด', () => {
  assert.throws(
    () => svc.addNotificationRecipient({ channel: 'sms', target: 'x' }),
    (error) => error.status === 400,
  );
  assert.throws(
    () => svc.addNotificationRecipient({ channel: 'email', target: 'ไม่ใช่อีเมล' }),
    (error) => error.status === 400,
  );
});

test('addNotificationRecipient รับอีเมลที่ถูกต้อง — ยังไม่มีระบบส่งอัตโนมัติ แต่เก็บรายชื่อไว้ได้', () => {
  const added = svc.addNotificationRecipient({
    channel: 'email', label: 'Nicha', target: 'nichaphat.c@ipassion.co.th', actor: 'ทดสอบ',
  });
  assert.equal(added.channel, 'email');
  assert.equal(added.target, 'nichaphat.c@ipassion.co.th');
  svc.removeNotificationRecipient(added.id, { actor: 'ทดสอบ' });
});

test('removeNotificationRecipient กับ id ที่ไม่มีอยู่ → error 404', () => {
  assert.throws(
    () => svc.removeNotificationRecipient(999999),
    (error) => error.status === 404,
  );
});
