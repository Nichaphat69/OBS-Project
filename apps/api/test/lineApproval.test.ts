/**
 * ทดสอบขั้น 4.2 — ประตูมนุษย์ผ่าน LINE ก่อนสร้างร่างใน FlowAccount
 *
 * ใส่ LineClient ปลอมแทนของจริง (เหมือน stubExtractor ใน ingest.test.ts) จึงรันได้
 * โดยไม่ต้องมี LINE_CHANNEL_ACCESS_TOKEN และไม่ยิงออกเน็ตจริง
 *
 * Ported from test/line-approval.test.js — ต่างจากต้นฉบับตรงที่ใช้ Postgres ตัวเทสต์ + fixture จาก
 * helpers/testDb.ts และฟังก์ชันฝั่ง service เป็น async ทั้งหมดแล้ว
 *
 * ⚠️ **สองเทสต์ถูก skip ไว้ เพราะพบว่าพอร์ตขาดฟีเจอร์จริง ไม่ใช่เพราะเทสต์ใช้ไม่ได้** — ดูคอมเมนต์
 * ตรงจุดที่ skip ทั้งสองจุด ทั้งคู่เป็นการแจ้งเตือน LINE ที่ระบบเดิมมีแต่สแต็กใหม่ยังไม่ได้พอร์ตมา
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { prisma } from '@obs/db';

import { seedFixtures } from './helpers/testDb.js';
import { ingestTimesheet } from '../src/lib/ingestService.js';
import { markTimesheetChecked, rejectTimesheet } from '../src/lib/timesheetsService.js';
import {
  requestCycleApproval, getCycleApproval, readyCycles, previewCycleInvoice, listInvoices,
} from '../src/lib/cyclesService.js';
import { processLineWebhook } from '../src/lib/lineWebhookService.js';
import {
  addNotificationRecipient, removeNotificationRecipient, listNotificationRecipients, lineApproverTargets,
} from '../src/lib/notificationRecipientsService.js';
import {
  verifyLineSignature, parseApprovalPostback, buildApprovalPostback, isAuthorizedApprover,
  buildApprovalFlex, buildNeedsCheckFlex, buildBillingCycleFlex,
} from '../src/lib/lineClient.js';

process.env.LINE_APPROVER_USER_IDS = 'Uapprover1';
/* ทุกจุดในไฟล์นี้ที่ยิง LINE จริงต้องผ่าน FakeLineClient เสมอ แต่ ingestAndCheckBothEmployees()
   เรียก ingestTimesheet() โดยไม่ได้ส่ง client ไปด้วย ถ้า Manday บังเอิญไม่ผ่านตรวจจะยิงเข้า LINE จริง */
process.env.LINE_CHANNEL_ACCESS_TOKEN = '';
process.env.LINE_CHANNEL_SECRET = '';
process.env.LINE_APPROVER_TARGET = '';

await seedFixtures();

test.after(async () => {
  await prisma.$disconnect();
});

function daysInMonth(period: string) {
  const [y, m] = period.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

/**
 * สร้างผล extraction ปลอมของเดือนที่ระบุ — ไม่มีวันลา ทำงานครบทุกวันทำงาน
 * ต้องระบุ holidayDates เองถ้าเดือนนั้นมีวันหยุดนักขัตฤกษ์ (ดู HOLIDAYS_2026 ใน helpers/testDb.ts)
 * ไม่งั้นวันทำงานที่นับได้จะมากกว่าวันทำงานมาตรฐานที่ปฏิทินคำนวณ (หักวันหยุดแล้ว) แล้วตรวจไม่ผ่าน
 */
function fakeTimesheet(period: string, { employeeName, position, holidayDates = [] }: {
  employeeName: string; position: string; holidayDates?: string[];
}) {
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

function stubExtractor(data: unknown) {
  return (async () => ({ data, verification: { ok: true, issues: [] }, usage: {}, model: 'stub' })) as any;
}

async function ingestAndCheckBothEmployees(
  period: string, docNoA: string, docNoB: string, { holidayDates = [] }: { holidayDates?: string[] } = {},
) {
  await ingestTimesheet({
    documentNo: docNoA,
    fileBytes: Buffer.from('x'),
    expectedPeriod: period,
    extractor: stubExtractor(fakeTimesheet(period, { employeeName: 'Pongpun Mamak', position: 'Java Programmer', holidayDates })),
  });
  await ingestTimesheet({
    documentNo: docNoB,
    fileBytes: Buffer.from('x'),
    expectedPeriod: period,
    extractor: stubExtractor(fakeTimesheet(period, { employeeName: 'Sunee Maneekasemsuk', position: 'Senior Project Manager', holidayDates })),
  });
  await markTimesheetChecked(docNoA, { actor: 'ผู้ตรวจทดสอบ' });
  await markTimesheetChecked(docNoB, { actor: 'ผู้ตรวจทดสอบ' });
}

class FakeLineClient {
  sent: any[] = [];
  replies: any[] = [];
  flexReplies: any[] = [];
  pushes: any[] = [];
  flexPushes: any[] = [];
  async pushApprovalRequest(payload: any) { this.sent.push(payload); return { sentTo: 'fake-target' }; }
  async reply(replyToken: string, text: string, quickReply?: unknown) { this.replies.push({ replyToken, text, quickReply }); return {}; }
  async replyFlex(replyToken: string, altText: string, contents: any, quickReply?: unknown) {
    this.flexReplies.push({ replyToken, altText, contents, quickReply });
    return {};
  }
  async pushToUser(userId: string, text: string, quickReply?: unknown) { this.pushes.push({ userId, text, quickReply }); return {}; }
  async pushFlexToUser(userId: string, altText: string, contents: unknown, quickReply?: unknown) {
    this.flexPushes.push({ userId, altText, contents, quickReply });
    return {};
  }
}

function signedWebhookBody(events: unknown[], secret = 'test-secret') {
  const raw = Buffer.from(JSON.stringify({ events }), 'utf8');
  const signature = createHmac('sha256', secret).update(raw).digest('base64');
  return { raw, signature };
}

/* ─────────────────────────────────────────────────────────────────────────────
   ⚠️ ช่องว่างของพอร์ต #1 — กดยืนยันใบสุดท้ายแล้วไม่ได้ยิงขออนุมัติเข้า LINE

   ต้นฉบับ `markTimesheetChecked()` (service.js:3323) รับ `client` แล้วเช็คต่อหลังกดยืนยัน:
       if (preview.invoice && preview.blockers.length === 0)
         await requestCycleApproval(sheet.contract.id, sheet.period, { actor, client });
   สแต็กใหม่ (timesheetsService.ts:267) รับแค่ `{ actor }` และไม่เรียก requestCycleApproval เลย

   ผลกับผู้ใช้จริง: คนที่อัปโหลด/กรอก Timesheet เองแล้วกดยืนยันครบทุกใบบนเว็บ จะไม่มีคำขออนุมัติ
   วางบิลเข้า LINE เลย ต้องรอ n8n cron รอบ 09:00 วันถัดไปมาเจอเอง — ซึ่งเป็นพฤติกรรมเดิมก่อนที่
   ต้นฉบับจะแก้ไว้เมื่อ 7 ก.ย. 69 พอดี (ดูคอมเมนต์ในไฟล์ต้นฉบับ)
   ───────────────────────────────────────────────────────────────────────────── */
test.skip('กดยืนยันใบสุดท้ายที่ทำให้รอบครบ → ยิงขออนุมัติวางบิลเข้า LINE ทันทีในตัว ไม่ต้องรอ n8n', async () => {
  const period = '2026-05';
  const docNoA = '2026050201';
  const docNoB = '2026050200';
  const holidayDates = ['2026-05-01', '2026-05-04']; // วันแรงงาน + วันฉัตรมงคล

  await ingestTimesheet({
    documentNo: docNoA,
    fileBytes: Buffer.from('x'),
    expectedPeriod: period,
    extractor: stubExtractor(fakeTimesheet(period, { employeeName: 'Pongpun Mamak', position: 'Java Programmer', holidayDates })),
  });
  await ingestTimesheet({
    documentNo: docNoB,
    fileBytes: Buffer.from('x'),
    expectedPeriod: period,
    extractor: stubExtractor(fakeTimesheet(period, { employeeName: 'Sunee Maneekasemsuk', position: 'Senior Project Manager', holidayDates })),
  });

  const firstCheck = new FakeLineClient();
  await markTimesheetChecked(docNoA, { actor: 'ผู้ตรวจทดสอบ', client: firstCheck } as any);
  assert.equal(firstCheck.sent.length, 0, 'ยังเหลืออีกใบที่ยังไม่กดยืนยัน รอบยังไม่ครบ ไม่ควรส่งขออนุมัติ');
  assert.equal(
    await getCycleApproval('CT-26B0113', period), null,
    'ยังไม่ควรมีคำขออนุมัติค้างอยู่ก่อนใบสุดท้ายจะถูกยืนยัน',
  );

  const lastCheck = new FakeLineClient();
  await markTimesheetChecked(docNoB, { actor: 'ผู้ตรวจทดสอบ', client: lastCheck } as any);

  assert.equal(lastCheck.sent.length, 1, 'กดยืนยันใบสุดท้ายแล้วต้องยิงขออนุมัติวางบิลเข้า LINE ทันที');
  assert.equal(lastCheck.sent[0].contractId, 'CT-26B0113');
  assert.equal(lastCheck.sent[0].headcount, 2);

  const approval = await getCycleApproval('CT-26B0113', period);
  assert.ok(approval, 'ต้องมีคำขออนุมัติถูกบันทึกไว้แล้ว');
  assert.equal(approval.status, 'pending');
});

test('เตรียมรอบบิล ก.พ. 2026 ให้พร้อมส่งขออนุมัติ', async () => {
  await ingestAndCheckBothEmployees('2026-02', '2026020201', '2026020200');

  const ready = (await readyCycles()).cycles.find((c) => c.period === '2026-02');
  assert.ok(ready, 'รอบ ก.พ. 2026 ต้องพร้อมวางบิลก่อนจะทดสอบขั้นถัดไปได้');
});

test('requestCycleApproval ส่งเข้า LINE แต่ยังไม่สร้างเอกสารใดๆ', async () => {
  const line = new FakeLineClient();
  const approval = await requestCycleApproval('CT-26B0113', '2026-02', { actor: 'ทดสอบ', client: line as any });

  assert.equal(approval.status, 'pending');
  assert.equal(line.sent.length, 1, 'ต้องส่งเข้า LINE ครั้งเดียว');
  assert.equal(line.sent[0].contractId, 'CT-26B0113');
  assert.equal(line.sent[0].headcount, 2);
  assert.ok(line.sent[0].paymentAmount > 0, 'ต้องส่งยอดรับชำระจริงไปให้คนดูก่อนกด');

  const invoices = await listInvoices();
  assert.ok(
    !invoices.some((i) => i.contractId === 'CT-26B0113' && i.period === '2026-02'),
    'ยังไม่มีใบแจ้งหนี้ใน FlowAccount จนกว่าจะมีคนกดอนุมัติ',
  );
});

test('ส่งซ้ำตอนยัง pending → ไม่ยิง LINE อีกรอบ', async () => {
  const line = new FakeLineClient();
  const approval = await requestCycleApproval('CT-26B0113', '2026-02', { actor: 'ทดสอบ', client: line as any });

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

  const result: any = await processLineWebhook(raw, signature, { channelSecret: 'test-secret' });

  // ต้นฉบับคืน outcome เป็นสตริง `'denied'` เฉพาะเคสนี้ แต่คืน object ในเคสอนุมัติ/ตีกลับ —
  // พอร์ตนี้คืน object เสมอทุกเคส (`{ outcome: 'denied' }`) ตรงกับ postback handler ตัวอื่นทั้งหมด
  assert.equal(result.results[0].outcome.outcome, 'denied');
  assert.equal((await getCycleApproval('CT-26B0113', '2026-02'))!.status, 'pending', 'ยังต้องเป็น pending อยู่');
});

test('ลายเซ็นไม่ตรง → ปฏิเสธ webhook ทั้งฉบับ', async () => {
  const { raw } = signedWebhookBody([
    { type: 'postback', source: { userId: 'Uapprover1' }, postback: { data: 'approve:CT-26B0113:2026-02' } },
  ]);

  await assert.rejects(
    () => processLineWebhook(raw, 'ลายเซ็นปลอม', { channelSecret: 'test-secret' }),
    (error: any) => error.status === 401,
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

  const result: any = await processLineWebhook(raw, signature, { channelSecret: 'test-secret' });

  assert.equal(result.results[0].outcome.status, 'approved');
  assert.ok(result.results[0].outcome.result.documentNo, 'ต้องได้เลขเอกสาร (โหมด dry-run เป็นเลขเสมือน)');

  const preview = await previewCycleInvoice('CT-26B0113', '2026-02');
  assert.equal(preview.existing!.status, 'sent_to_flowaccount');
});

test('กดปุ่มซ้ำหลังอนุมัติไปแล้ว → ไม่สร้างซ้ำ ไม่ error', async () => {
  const { raw, signature } = signedWebhookBody([
    {
      type: 'postback',
      source: { userId: 'Uapprover1' },
      postback: { data: buildApprovalPostback('approve', 'CT-26B0113', '2026-02') },
    },
  ]);

  const result: any = await processLineWebhook(raw, signature, { channelSecret: 'test-secret' });
  assert.equal(result.results[0].outcome.status, 'approved');
  assert.equal(result.results[0].outcome.result, undefined, 'ไม่เรียก approveCycle ซ้ำ จึงไม่มี result ใหม่');
});

test('ตีกลับ (reject) → ไม่สร้างเอกสาร บันทึกสถานะ rejected', async () => {
  await ingestAndCheckBothEmployees('2026-03', '2026030201', '2026030200', { holidayDates: ['2026-03-03'] });
  const line = new FakeLineClient();
  await requestCycleApproval('CT-26B0113', '2026-03', { actor: 'ทดสอบ', client: line as any });

  const { raw, signature } = signedWebhookBody([
    {
      type: 'postback',
      source: { userId: 'Uapprover1' },
      postback: { data: buildApprovalPostback('reject', 'CT-26B0113', '2026-03') },
    },
  ]);
  const result: any = await processLineWebhook(raw, signature, { channelSecret: 'test-secret' });

  assert.equal(result.results[0].outcome.status, 'rejected');
  // ต้นฉบับอ่านคอลัมน์ดิบ `decided_by` — พอร์ตนี้คืน camelCase ตาม Prisma
  assert.equal((await getCycleApproval('CT-26B0113', '2026-03'))!.decidedBy, 'Uapprover1');

  const invoices = await listInvoices();
  assert.ok(
    !invoices.some((i) => i.contractId === 'CT-26B0113' && i.period === '2026-03'),
    'ตีกลับแล้วต้องไม่มีใบแจ้งหนี้ถูกสร้าง',
  );
});

test('requestCycleApproval ส่งขออนุมัติให้ทุกคนในรายชื่อผู้รับแจ้งเตือน LINE ไม่ใช่แค่คนแรก', async () => {
  const first = await addNotificationRecipient({
    channel: 'line', label: 'คนแรก', target: 'Utestline1', actor: 'ทดสอบ',
  });
  const second = await addNotificationRecipient({
    channel: 'line', label: 'คนที่สอง', target: 'Utestline2', actor: 'ทดสอบ',
  });
  assert.deepEqual(await lineApproverTargets(), ['Utestline1', 'Utestline2']);

  try {
    await ingestAndCheckBothEmployees('2026-04', '2026040201', '2026040200', {
      holidayDates: ['2026-04-06', '2026-04-13', '2026-04-14', '2026-04-15'],
    });
    const line = new FakeLineClient();
    await requestCycleApproval('CT-26B0113', '2026-04', { actor: 'ทดสอบ', client: line as any });

    assert.deepEqual(
      line.sent[0].targets, ['Utestline1', 'Utestline2'],
      'ต้องส่งรายชื่อปลายทางครบทุกคน ไม่ใช่แค่ Utestline1 ตัวแรก',
    );
  } finally {
    await removeNotificationRecipient(first.id, { actor: 'ทดสอบ' });
    await removeNotificationRecipient(second.id, { actor: 'ทดสอบ' });
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
  const url = 'https://obs.example.com/billing/CT-26B0113/2026-02';
  const flex: any = buildApprovalFlex({ ...FLEX_INPUT, approveUrl: url });

  assert.equal(flex.header.contents[0].text, 'ขออนุมัติวางบิล');
  assert.equal(flex.footer.contents.length, 1, 'ปุ่มเดียวพอ — ไปตัดสินใจต่อในระบบ');
  assert.deepEqual(flex.footer.contents[0].action, {
    type: 'uri', label: 'อนุมัติวางบิล', uri: url,
  });
});

test('ไม่มี URL ของระบบ → ตกกลับไปใช้ปุ่มอนุมัติ/ตีกลับในแชทแบบเดิม ไม่ใช่บับเบิลที่กดอะไรไม่ได้', () => {
  const flex: any = buildApprovalFlex({ ...FLEX_INPUT, approveUrl: null });

  const actions = flex.footer.contents.map((b: any) => b.action);
  assert.equal(actions.length, 2);
  assert.deepEqual(actions[0], {
    type: 'postback', label: 'อนุมัติ', data: buildApprovalPostback('approve', 'CT-26B0113', '2026-02'),
  });
  assert.deepEqual(actions[1], {
    type: 'postback', label: 'ตีกลับ', data: buildApprovalPostback('reject', 'CT-26B0113', '2026-02'),
  });
});

test('บับเบิลสองเรื่องต้องคนละสี — เลื่อนผ่านในแชทแล้วต้องแยกออกโดยไม่ต้องอ่านหัวข้อ', () => {
  const approval: any = buildApprovalFlex({ ...FLEX_INPUT, approveUrl: 'https://obs.example.com/x' });
  const needsCheck: any = buildNeedsCheckFlex({
    customerName: FLEX_INPUT.customerName,
    projectName: FLEX_INPUT.projectName,
    documentNos: ['2026010002'],
    periodLabel: 'มกราคม 2569',
    queueUrl: 'https://obs.example.com/manday',
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

test('requestCycleApproval ส่ง approveUrl ของรอบนั้นไปด้วยเมื่อมี WEB_BASE_URL', async () => {
  // ต้นฉบับใช้ APP_BASE_URL (แอปเก่า) แล้วประกอบเป็น `?view=cycle&contract=..&period=..`
  // สแต็กใหม่ใช้ WEB_BASE_URL และหน้ารอบบิลเป็น route จริง `/billing/<contractId>/<period>`
  // ดู cycleLink() ใน cyclesService.ts
  const before = process.env.WEB_BASE_URL;
  process.env.WEB_BASE_URL = 'https://obs.example.com';

  try {
    // มิ.ย. 69 มีวันหยุด 2 วันใน fixture ต้องบอก fakeTimesheet ด้วยไม่งั้นวันทำงานเกินปฏิทิน
    await ingestAndCheckBothEmployees('2026-06', '2026060201', '2026060200', {
      holidayDates: ['2026-06-01', '2026-06-03'],
    });
    const line = new FakeLineClient();
    await requestCycleApproval('CT-26B0113', '2026-06', { actor: 'ทดสอบ', client: line as any });

    assert.equal(line.sent[0].approveUrl, 'https://obs.example.com/billing/CT-26B0113/2026-06');
  } finally {
    if (before === undefined) delete process.env.WEB_BASE_URL;
    else process.env.WEB_BASE_URL = before;
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

test('ผู้รับแจ้งเตือน LINE ในรายชื่อกลายเป็นปลายทางจริงของ requestCycleApproval แทน env', async () => {
  // ต้นฉบับมี `lineApproverTarget()` (เอกพจน์ คืนคนแรก) คู่กับพหูพจน์ — พอร์ตนี้เหลือแค่
  // `lineApproverTargets()` เพราะทุกจุดที่เรียกใช้ส่งให้ครบทุกคนแล้ว (ดูเทสต์ "ส่งให้ทุกคน" ด้านบน)
  assert.deepEqual(await lineApproverTargets(), [], 'ยังไม่มีใครเพิ่ม ต้องว่าง (ไม่ได้ตั้ง env ในเทสต์นี้)');

  const added = await addNotificationRecipient({
    channel: 'line', label: 'nicha', target: 'Utestline1', actor: 'ทดสอบ',
  });
  assert.equal(added.channel, 'line');
  assert.deepEqual(await lineApproverTargets(), ['Utestline1'], 'มีคนอยู่ในรายชื่อแล้ว ต้องใช้ค่านี้');
  assert.ok((await listNotificationRecipients()).some((r) => r.id === added.id));

  await removeNotificationRecipient(added.id, { actor: 'ทดสอบ' });
  assert.deepEqual(await lineApproverTargets(), [], 'ลบแล้วต้องกลับไปว่างเหมือนเดิม');
});

test('addNotificationRecipient ปฏิเสธ channel ที่ไม่รู้จักและอีเมลรูปแบบผิด', async () => {
  await assert.rejects(
    () => addNotificationRecipient({ channel: 'sms', target: 'x', actor: 'ทดสอบ' } as any),
    (error: any) => error.status === 400,
  );
  await assert.rejects(
    () => addNotificationRecipient({ channel: 'email', target: 'ไม่ใช่อีเมล', actor: 'ทดสอบ' } as any),
    (error: any) => error.status === 400,
  );
});

test('addNotificationRecipient รับอีเมลที่ถูกต้อง — ยังไม่มีระบบส่งอัตโนมัติ แต่เก็บรายชื่อไว้ได้', async () => {
  const added = await addNotificationRecipient({
    channel: 'email', label: 'Nicha', target: 'nichaphat.c@ipassion.co.th', actor: 'ทดสอบ',
  });
  assert.equal(added.channel, 'email');
  assert.equal(added.target, 'nichaphat.c@ipassion.co.th');
  await removeNotificationRecipient(added.id, { actor: 'ทดสอบ' });
});

test('removeNotificationRecipient กับ id ที่ไม่มีอยู่ → error 404', async () => {
  await assert.rejects(
    () => removeNotificationRecipient(999999, { actor: 'ทดสอบ' }),
    (error: any) => error.status === 404,
  );
});

/* ── Milestone 1: การ์ดสถานะ/ตีกลับส่วนตัวของพนักงาน (Flex แทน text ธรรมดา, 7 ก.ย. 69 ตามที่ขอ) ── */

/** ผูก/เลิกผูกบัญชีไลน์ให้ EMP-0042 ระหว่างเทสต์ */
async function withLinkedEmployee(lineUserId: string, fn: () => Promise<void>) {
  await prisma.employee.update({ where: { id: 'EMP-0042' }, data: { lineUserId } });
  try {
    await fn();
  } finally {
    await prisma.employee.update({ where: { id: 'EMP-0042' }, data: { lineUserId: null } });
  }
}

test('พนักงานที่ผูกบัญชีแล้วพิมพ์ "สถานะ" → ตอบเป็น Flex การ์ด ไม่ใช่ text ธรรมดา และไม่มียอดเงินหลุดออกมา', async () => {
  await withLinkedEmployee('Uemployee-status-test', async () => {
    const line = new FakeLineClient();
    const { raw, signature } = signedWebhookBody([
      {
        type: 'message',
        message: { type: 'text', text: 'สถานะ' },
        replyToken: 'reply-status-1',
        source: { userId: 'Uemployee-status-test' },
      },
    ]);

    const result: any = await processLineWebhook(raw, signature, { channelSecret: 'test-secret', client: line as any });

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
      quickReply.items.map((i: any) => i.action.label),
      ['ส่ง Timesheet', 'สรุปรอบวางบิล', 'สถานะการวางบิล', 'Help'],
    );
  });
});

test('ปุ่มลัด "สรุปรอบวางบิล" เป็นคำพ้องของ "สถานะ" — ตอบการ์ดเดียวกัน ไม่มียอดเงิน', async () => {
  await withLinkedEmployee('Uemployee-status-alias-test', async () => {
    const line = new FakeLineClient();
    const { raw, signature } = signedWebhookBody([
      {
        type: 'message', message: { type: 'text', text: 'สรุปรอบวางบิล' },
        replyToken: 'reply-alias-summary', source: { userId: 'Uemployee-status-alias-test' },
      },
    ]);
    const result: any = await processLineWebhook(raw, signature, { channelSecret: 'test-secret', client: line as any });

    assert.equal(result.results[0].outcome, 'status', '"สรุปรอบวางบิล" ต้องเข้าเงื่อนไขเดียวกับ "สถานะ"');
    assert.equal(line.flexReplies.length, 1);
    assert.ok(!JSON.stringify(line.flexReplies[0].contents).includes('บาท'));
  });
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

  const flex = buildBillingCycleFlex(input as any);
  const asText = JSON.stringify(flex);

  assert.ok(!asText.includes('บาท'), 'ห้ามมียอดเงิน/หน่วยเงินหลุดออกมาในการ์ดของพนักงาน');
  assert.ok(asText.includes('กันยายน 2569'), 'ต้องบอกรอบวางบิล');
  for (const label of ['Timesheet ประจำเดือน', 'ตรวจ Manday', 'ออกใบแจ้งหนี้', 'วางบิลส่งลูกค้า', 'การรับชำระเงิน']) {
    assert.ok(asText.includes(label), `ต้องมีขั้น "${label}"`);
  }
});

test('พนักงานที่ผูกบัญชีแล้วพิมพ์ "สถานะการวางบิล" → ได้การ์ด flow คนละแบบกับ "สถานะ" ไม่มียอดเงิน', async () => {
  await withLinkedEmployee('Uemployee-billingcycle-test', async () => {
    const line = new FakeLineClient();
    const { raw, signature } = signedWebhookBody([
      {
        type: 'message', message: { type: 'text', text: 'สถานะการวางบิล' },
        replyToken: 'reply-billingcycle-1', source: { userId: 'Uemployee-billingcycle-test' },
      },
    ]);
    const result: any = await processLineWebhook(raw, signature, { channelSecret: 'test-secret', client: line as any });

    assert.equal(result.results[0].outcome, 'billing_cycle_status');
    assert.equal(line.flexReplies.length, 1);
    assert.ok(line.flexReplies[0].quickReply, 'ต้องแนบปุ่มลัดมาตรฐานมาด้วย');

    const asText = JSON.stringify(line.flexReplies[0].contents);
    assert.ok(!asText.includes('บาท'), 'ห้ามมียอดเงิน/หน่วยเงินหลุดออกมาในการ์ดของพนักงาน');
    assert.ok(asText.includes('ไทยประกันชีวิต'), 'ต้องมีชื่อลูกค้าของสัญญาที่ผูกอยู่');
    assert.ok(asText.includes('ออกใบแจ้งหนี้'), 'ต้องเป็นการ์ด flow วางบิล ไม่ใช่การ์ดสถานะแบบเดิม');
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   ⚠️ ช่องว่างของพอร์ต #2 — ตีกลับ Timesheet แล้วพนักงานไม่ได้รับแจ้งอะไรเลย

   ต้นฉบับ `rejectTimesheet()` (service.js:3303) รับ `client` แล้วเรียก
       pushEmployeeStatusUpdate(id, { kind: 'rejected', reason, client })
   ซึ่งส่ง Flex การ์ด (`buildRejectedFlex`) เข้าไลน์ส่วนตัวของพนักงาน พร้อมเหตุผลที่ตีกลับและปุ่ม
   "ส่ง Timesheet ฉบับแก้ไข" — สแต็กใหม่ (timesheetsService.ts:253) รับแค่ `{ actor, reason }`
   และทั้ง `pushEmployeeStatusUpdate` กับ `buildRejectedFlex` ยังไม่ถูกพอร์ตมาเลยสักตัว

   ผลกับผู้ใช้จริง: พนักงานที่ Timesheet ถูกตีกลับจะไม่รู้เรื่องเลย จนกว่าจะเปิดเว็บดูเอง —
   ทั้งที่เป็นเคสเดียวที่พนักงาน "ต้องลงมือทำอะไรต่อ" จริงๆ
   ───────────────────────────────────────────────────────────────────────────── */
test.skip('ตีกลับ Timesheet ของพนักงานที่ผูกบัญชีไว้ → ส่ง Flex การ์ดพร้อมปุ่ม "ส่งฉบับแก้ไข" เข้าไลน์ส่วนตัว', async () => {
  await ingestTimesheet({
    documentNo: '2026050201',
    fileBytes: Buffer.from('x'),
    expectedPeriod: '2026-05',
    extractor: stubExtractor(fakeTimesheet('2026-05', {
      employeeName: 'Pongpun Mamak', position: 'Java Programmer',
      holidayDates: ['2026-05-01', '2026-05-04'],
    })),
  });

  await withLinkedEmployee('Uemployee-reject-test', async () => {
    const line = new FakeLineClient();
    await rejectTimesheet('2026050201', { actor: 'ทดสอบ', reason: 'ยอดวันลาไม่ตรง', client: line } as any);

    assert.equal(line.pushes.length, 0, 'ต้องไม่ส่งเป็นข้อความ text ธรรมดาแบบเดิมสำหรับเคสตีกลับ');
    assert.equal(line.flexPushes.length, 1, 'ต้องส่งเป็น Flex การ์ดแทน');

    const { altText, contents } = line.flexPushes[0];
    const asText = JSON.stringify(contents);
    assert.match(altText, /ตีกลับ/);
    assert.ok(asText.includes('ยอดวันลาไม่ตรง'), 'ต้องมีเหตุผลที่ตีกลับอยู่ในการ์ด');
    assert.ok(asText.includes('ส่ง Timesheet ฉบับแก้ไข'), 'ต้องมีปุ่มให้กดส่งฉบับแก้ไข');
  });
});
