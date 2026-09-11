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
const { closeDb, run } = await import('../src/db/index.js');
const {
  verifyLineSignature, parseApprovalPostback, buildApprovalPostback, isAuthorizedApprover,
  buildApprovalFlex, buildNeedsCheckFlex, buildBillingCycleFlex,
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
  await svc.markTimesheetChecked(docNoA, { actor: 'ผู้ตรวจทดสอบ' });
  await svc.markTimesheetChecked(docNoB, { actor: 'ผู้ตรวจทดสอบ' });
}

class FakeLineClient {
  constructor() {
    this.sent = []; this.replies = []; this.flexReplies = []; this.pushes = []; this.flexPushes = [];
  }
  async pushApprovalRequest(payload) {
    this.sent.push(payload);
    return { sentTo: 'fake-target' };
  }
  async reply(replyToken, text, quickReply) { this.replies.push({ replyToken, text, quickReply }); return {}; }
  async replyFlex(replyToken, altText, contents, quickReply) {
    this.flexReplies.push({ replyToken, altText, contents, quickReply });
    return {};
  }
  async pushToUser(userId, text, quickReply) { this.pushes.push({ userId, text, quickReply }); return {}; }
  async pushFlexToUser(userId, altText, contents, quickReply) {
    this.flexPushes.push({ userId, altText, contents, quickReply });
    return {};
  }
}

function signedWebhookBody(events, secret = 'test-secret') {
  const raw = Buffer.from(JSON.stringify({ events }), 'utf8');
  const signature = createHmac('sha256', secret).update(raw).digest('base64');
  return { raw, signature };
}

/**
 * markTimesheetChecked() ที่เพิ่งเพิ่มมา (7 ก.ย. 69 ตามที่ขอ) — เดิมทางเว็บ (คนอัปโหลด/กรอกเอง
 * แล้วกดยืนยันเอง ไม่ได้ผ่าน n8n) ไม่เคยส่งขั้น "ขออนุมัติวางบิล" เข้า LINE เลยแม้รอบจะครบและ
 * ทุกใบถูกกดยืนยันหมดแล้วก็ตาม ต้องรอ n8n cron 09:00 พรุ่งนี้มาเจอเอง — ตอนนี้กดยืนยันใบสุดท้าย
 * ที่ทำให้รอบครบ (blockers หมด) ต้องยิงขออนุมัติทันทีในตัว ไม่ต้องรอ n8n
 */
test('กดยืนยันใบสุดท้ายที่ทำให้รอบครบ → ยิงขออนุมัติวางบิลเข้า LINE ทันทีในตัว ไม่ต้องรอ n8n', async () => {
  const period = '2026-05';
  const docNoA = '2026050201';
  const docNoB = '2026050200';
  const holidayDates = ['2026-05-01', '2026-05-04']; // วันแรงงาน + วันฉัตรมงคล — ดู HOLIDAYS_2026 ใน seed.js

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

  const firstCheck = new FakeLineClient();
  await svc.markTimesheetChecked(docNoA, { actor: 'ผู้ตรวจทดสอบ', client: firstCheck });
  assert.equal(firstCheck.sent.length, 0, 'ยังเหลืออีกใบที่ยังไม่กดยืนยัน รอบยังไม่ครบ ไม่ควรส่งขออนุมัติ');
  assert.equal(
    svc.getCycleApproval('CT-26B0113', period), null,
    'ยังไม่ควรมีคำขออนุมัติค้างอยู่ก่อนใบสุดท้ายจะถูกยืนยัน',
  );

  const lastCheck = new FakeLineClient();
  await svc.markTimesheetChecked(docNoB, { actor: 'ผู้ตรวจทดสอบ', client: lastCheck });

  assert.equal(lastCheck.sent.length, 1, 'กดยืนยันใบสุดท้ายแล้วต้องยิงขออนุมัติวางบิลเข้า LINE ทันที');
  assert.equal(lastCheck.sent[0].contractId, 'CT-26B0113');
  assert.equal(lastCheck.sent[0].headcount, 2);

  const approval = svc.getCycleApproval('CT-26B0113', period);
  assert.ok(approval, 'ต้องมีคำขออนุมัติถูกบันทึกไว้แล้ว');
  assert.equal(approval.status, 'pending');
});

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

/* ── หน้าตาบับเบิลคำขออนุมัติ ─────────────────────────────────────────── */

const FLEX_INPUT = {
  contractId: 'CT-26B0113',
  period: '2026-02',
  customerName: 'บริษัท ไทยประกันชีวิต จำกัด (มหาชน)',
  projectName: 'Outsource for BAU Project',
  periodLabel: 'กุมภาพันธ์ 2569',
  headcount: 2,
  paymentAmount: 180665.4,
};

test('มี URL ของระบบ → ปุ่มเดียว "อนุมัติวางบิล" พาเข้าหน้าวางบิลของรอบนั้นโดยตรง', () => {
  const url = 'https://obs.example.com/?view=cycle&contract=CT-26B0113&period=2026-02';
  const flex = buildApprovalFlex({ ...FLEX_INPUT, approveUrl: url });

  assert.equal(flex.header.contents[0].text, 'ขออนุมัติวางบิล');
  assert.equal(flex.footer.contents.length, 1, 'ปุ่มเดียวพอ — ไปตัดสินใจต่อในระบบ');
  assert.deepEqual(flex.footer.contents[0].action, {
    type: 'uri', label: 'อนุมัติวางบิล', uri: url,
  });
});

test('ไม่มี URL ของระบบ → ตกกลับไปใช้ปุ่มอนุมัติ/ตีกลับในแชทแบบเดิม ไม่ใช่บับเบิลที่กดอะไรไม่ได้', () => {
  const flex = buildApprovalFlex({ ...FLEX_INPUT, approveUrl: null });

  const actions = flex.footer.contents.map((b) => b.action);
  assert.equal(actions.length, 2);
  assert.deepEqual(actions[0], {
    type: 'postback', label: 'อนุมัติ', data: buildApprovalPostback('approve', 'CT-26B0113', '2026-02'),
  });
  assert.deepEqual(actions[1], {
    type: 'postback', label: 'ตีกลับ', data: buildApprovalPostback('reject', 'CT-26B0113', '2026-02'),
  });
});

test('บับเบิลสองเรื่องต้องคนละสี — เลื่อนผ่านในแชทแล้วต้องแยกออกโดยไม่ต้องอ่านหัวข้อ', () => {
  const approval = buildApprovalFlex({ ...FLEX_INPUT, approveUrl: 'https://obs.example.com/x' });
  const needsCheck = buildNeedsCheckFlex({
    customerName: FLEX_INPUT.customerName,
    projectName: FLEX_INPUT.projectName,
    documentNos: ['2026010002'],
    periodLabel: 'มกราคม 2569',
    queueUrl: 'https://obs.example.com/?view=queue',
  });

  // หัวการ์ดเป็นไล่สี (background: linearGradient) แล้ว ไม่ใช่สีทึบเดี่ยวๆ แบบเดิม (8 ก.ย. 69 ตามที่ขอ
  // "ไล่สีอ่อนสีเข้มสวยๆ") — เช็คที่ endColor แทน backgroundColor เดิม
  assert.equal(approval.header.background.type, 'linearGradient');
  assert.equal(approval.header.background.endColor, '#0078D4', 'เรื่องเงิน/วางบิลใช้สีน้ำเงินตามเว็บ');
  assert.equal(needsCheck.header.background.endColor, '#1B998B', 'เรื่องตรวจสอบใช้เขียวเข้ม');
  assert.notEqual(approval.header.background.endColor, needsCheck.header.background.endColor);

  // ปุ่มต้องไล่สีเดียวกับแถบหัวของใบตัวเอง ไม่ใช่หัวสีหนึ่งปุ่มอีกสีหนึ่ง — ปุ่มตอนนี้เป็น box ไล่สี
  // (gradientButton) ไม่ใช่ type:'button' สีทึบแบบเดิมแล้ว
  assert.equal(approval.footer.contents[0].background.endColor, approval.header.background.endColor);
  assert.equal(needsCheck.footer.contents[0].background.endColor, needsCheck.header.background.endColor);
});

test('requestCycleApproval ส่ง approveUrl ของรอบนั้นไปด้วยเมื่อมี APP_BASE_URL', async () => {
  const before = process.env.APP_BASE_URL;
  process.env.APP_BASE_URL = 'https://obs.example.com';

  try {
    // มิ.ย. 69 มีวันหยุด 2 วันในข้อมูลตั้งต้น ต้องบอก fakeTimesheet ด้วยไม่งั้นวันทำงานเกินปฏิทิน
    await ingestAndCheckBothEmployees('2026-06', '2026060201', '2026060200', {
      holidayDates: ['2026-06-01', '2026-06-03'],
    });
    const line = new FakeLineClient();
    await svc.requestCycleApproval('CT-26B0113', '2026-06', { actor: 'ทดสอบ', client: line });

    assert.equal(
      line.sent[0].approveUrl,
      'https://obs.example.com/?view=cycle&contract=CT-26B0113&period=2026-06',
    );
  } finally {
    if (before === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = before;
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

/* ── Milestone 1: การ์ดสถานะ/ตีกลับส่วนตัวของพนักงาน (Flex แทน text ธรรมดา, 7 ก.ย. 69 ตามที่ขอ) ── */

test('พนักงานที่ผูกบัญชีแล้วพิมพ์ "สถานะ" → ตอบเป็น Flex การ์ด ไม่ใช่ text ธรรมดา และไม่มียอดเงินหลุดออกมา', async () => {
  run("UPDATE employees SET line_user_id = 'Uemployee-status-test' WHERE id = 'EMP-0042'");
  try {
    const line = new FakeLineClient();
    const { raw, signature } = signedWebhookBody([
      {
        type: 'message',
        message: { type: 'text', text: 'สถานะ' },
        replyToken: 'reply-status-1',
        source: { userId: 'Uemployee-status-test' },
      },
    ]);

    const result = await svc.processLineWebhook(raw, signature, { channelSecret: 'test-secret', client: line });

    assert.equal(result.results[0].outcome, 'status');
    assert.equal(line.replies.length, 0, 'ต้องไม่ตอบด้วยข้อความ text ธรรมดาแบบเดิม');
    assert.equal(line.flexReplies.length, 1, 'ต้องตอบด้วย Flex การ์ดแทน');

    const { contents } = line.flexReplies[0];
    const asText = JSON.stringify(contents);
    assert.ok(asText.includes('ไทยประกันชีวิต'), 'ต้องมีชื่อลูกค้าของสัญญาที่ผูกอยู่');
    assert.ok(!asText.includes('บาท'), 'ห้ามมียอดเงิน/หน่วยเงินหลุดออกมาในการ์ดของพนักงาน');
    assert.ok(!asText.includes('50,000'), 'ห้ามมีตัวเลขเรทค่าบริการ (เงินเดือน) หลุดออกมา');

    const { quickReply } = line.flexReplies[0];
    assert.equal(quickReply.items.length, 4, 'ต้องมีปุ่มลัด 4 ปุ่มแนบมาด้วยตามที่ขอ');
    assert.deepEqual(
      quickReply.items.map((i) => i.action.label),
      ['ส่ง Timesheet', 'สรุปรอบวางบิล', 'สถานะการวางบิล', 'Help'],
    );
  } finally {
    run("UPDATE employees SET line_user_id = NULL WHERE id = 'EMP-0042'");
  }
});

test('ปุ่มลัด "สรุปรอบวางบิล" เป็นคำพ้องของ "สถานะ" — ตอบการ์ดเดียวกัน ไม่มียอดเงิน', async () => {
  run("UPDATE employees SET line_user_id = 'Uemployee-status-alias-test' WHERE id = 'EMP-0042'");
  try {
    const line = new FakeLineClient();
    const { raw, signature } = signedWebhookBody([
      {
        type: 'message', message: { type: 'text', text: 'สรุปรอบวางบิล' },
        replyToken: 'reply-alias-summary', source: { userId: 'Uemployee-status-alias-test' },
      },
    ]);
    const result = await svc.processLineWebhook(raw, signature, { channelSecret: 'test-secret', client: line });

    assert.equal(result.results[0].outcome, 'status', '"สรุปรอบวางบิล" ต้องเข้าเงื่อนไขเดียวกับ "สถานะ"');
    assert.equal(line.flexReplies.length, 1);
    assert.ok(!JSON.stringify(line.flexReplies[0].contents).includes('บาท'));
  } finally {
    run("UPDATE employees SET line_user_id = NULL WHERE id = 'EMP-0042'");
  }
});

/* ── "สถานะการวางบิล" — flow 5 ขั้นของรอบบิล (8 ก.ย. 69 ตามที่ขอ แบบ mockup) ────────────────────── */

test('buildBillingCycleFlex เรียงลำดับ done/current/future ถูกต้อง และไม่มียอดเงินหลุดออกมา', () => {
  const input = {
    contracts: [{
      customerName: 'บริษัท ไทยประกันชีวิต จำกัด (มหาชน)', projectName: 'Outsource for BAU Project',
      periodLabel: 'กันยายน 2569', progressPercent: 75,
      steps: [
        { label: 'Timesheet ประจำเดือน', sub: 'พนักงานส่งเองทางอีเมล', dateLabel: '25 ก.ย. 69', done: true, state: 'done' },
        { label: 'ตรวจ Manday', sub: 'ตรวจแล้ว', dateLabel: '26 ก.ย. 69', done: true, state: 'done' },
        { label: 'ออกใบแจ้งหนี้ (FlowAccount)', sub: 'Drafted', dateLabel: '26 ก.ย. 69', done: true, state: 'done' },
        { label: 'วางบิลส่งลูกค้า', sub: 'รอส่งลูกค้า (ร่างอีเมลและเอกสารแนบ)', dateLabel: 'กำหนดส่ง: 30 กันยายน 2569', done: false, state: 'current' },
        { label: 'การรับชำระเงิน', sub: 'รอรับชำระ (คาดการณ์รับเงิน 30 ตุลาคม 2569)', dateLabel: 'Term 30 วัน', done: false, state: 'future' },
      ],
    }],
  };

  const flex = buildBillingCycleFlex(input);
  const asText = JSON.stringify(flex);

  assert.ok(!asText.includes('บาท'), 'ห้ามมียอดเงิน/หน่วยเงินหลุดออกมาในการ์ดของพนักงาน');
  assert.ok(asText.includes('กันยายน 2569'), 'ต้องบอกรอบวางบิล');
  for (const label of ['Timesheet ประจำเดือน', 'ตรวจ Manday', 'ออกใบแจ้งหนี้', 'วางบิลส่งลูกค้า', 'การรับชำระเงิน']) {
    assert.ok(asText.includes(label), `ต้องมีขั้น "${label}"`);
  }
});

test('พนักงานที่ผูกบัญชีแล้วพิมพ์ "สถานะการวางบิล" → ได้การ์ด flow คนละแบบกับ "สถานะ" ไม่มียอดเงิน', async () => {
  run("UPDATE employees SET line_user_id = 'Uemployee-billingcycle-test' WHERE id = 'EMP-0042'");
  try {
    const line = new FakeLineClient();
    const { raw, signature } = signedWebhookBody([
      {
        type: 'message', message: { type: 'text', text: 'สถานะการวางบิล' },
        replyToken: 'reply-billingcycle-1', source: { userId: 'Uemployee-billingcycle-test' },
      },
    ]);
    const result = await svc.processLineWebhook(raw, signature, { channelSecret: 'test-secret', client: line });

    assert.equal(result.results[0].outcome, 'billing_cycle_status');
    assert.equal(line.flexReplies.length, 1);
    assert.ok(line.flexReplies[0].quickReply, 'ต้องแนบปุ่มลัดมาตรฐานมาด้วย');

    const asText = JSON.stringify(line.flexReplies[0].contents);
    assert.ok(!asText.includes('บาท'), 'ห้ามมียอดเงิน/หน่วยเงินหลุดออกมาในการ์ดของพนักงาน');
    assert.ok(asText.includes('ไทยประกันชีวิต'), 'ต้องมีชื่อลูกค้าของสัญญาที่ผูกอยู่');
    assert.ok(asText.includes('ออกใบแจ้งหนี้'), 'ต้องเป็นการ์ด flow วางบิล ไม่ใช่การ์ดสถานะแบบเดิม');
  } finally {
    run("UPDATE employees SET line_user_id = NULL WHERE id = 'EMP-0042'");
  }
});

test('ตีกลับ Timesheet ของพนักงานที่ผูกบัญชีไว้ → ส่ง Flex การ์ดพร้อมปุ่ม "ส่งฉบับแก้ไข" เข้าไลน์ส่วนตัว', () => {
  // ใช้ใบ 2026050201 ที่เทสต์ "กดยืนยันใบสุดท้ายที่ทำให้รอบครบ" ด้านบนสร้าง+ยืนยันไว้แล้ว (ยังอยู่ใน
  // สถานะ verified) ไม่ต้อง ingest ซ้ำ — เลขเอกสารนี้ผูกกับ EMP-0042 (Pongpun) อยู่แล้ว
  run("UPDATE employees SET line_user_id = 'Uemployee-reject-test' WHERE id = 'EMP-0042'");
  try {
    const line = new FakeLineClient();
    svc.rejectTimesheet('2026050201', { actor: 'ทดสอบ', reason: 'ยอดวันลาไม่ตรง', client: line });

    assert.equal(line.pushes.length, 0, 'ต้องไม่ส่งเป็นข้อความ text ธรรมดาแบบเดิมสำหรับเคสตีกลับ');
    assert.equal(line.flexPushes.length, 1, 'ต้องส่งเป็น Flex การ์ดแทน');

    const { altText, contents } = line.flexPushes[0];
    const asText = JSON.stringify(contents);
    assert.match(altText, /ตีกลับ/);
    assert.ok(asText.includes('ยอดวันลาไม่ตรง'), 'ต้องมีเหตุผลที่ตีกลับอยู่ในการ์ด');
    assert.ok(asText.includes('ส่ง Timesheet ฉบับแก้ไข'), 'ต้องมีปุ่มให้กดส่งฉบับแก้ไข');
  } finally {
    run("UPDATE employees SET line_user_id = NULL WHERE id = 'EMP-0042'");
  }
});
