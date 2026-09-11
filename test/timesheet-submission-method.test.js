/**
 * ทดสอบ Milestone 3 — เลือกวิธีส่ง Timesheet แบบโต้ตอบ (OBS / Email / ให้ผู้ดูแลส่งแทน)
 * (8 ก.ย. 69 ตามที่ขอ, แบบ mockup "2. Timesheet Submission Flow")
 *
 * กติกา M2 ไม่เปลี่ยน — การกดเลือกวิธีส่งไม่ได้บันทึก Timesheet จริงเข้าระบบ ระบบยังต้องเตือนซ้ำทุกวัน
 * จนกว่าจะมีแถวจริงในตาราง timesheets (ดู overdueTimesheets ใน overdue-timesheet.test.js) — ไฟล์นี้เทสต์
 * เฉพาะฝั่งปุ่มเลือกวิธี/การ์ดยืนยัน/แจ้งฝ่ายบัญชี ไม่แตะ overdueTimesheets() ซ้ำ
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const DB = join(tmpdir(), `obs-timesheet-method-test-${process.pid}.sqlite`);
process.env.DB_PATH = DB;
process.env.LINE_CHANNEL_ACCESS_TOKEN = '';
process.env.LINE_CHANNEL_SECRET = '';
process.env.LINE_APPROVER_TARGET = '';

await import('../src/db/seed.js');
const svc = await import('../src/service.js');
const { closeDb, run } = await import('../src/db/index.js');
const { buildTimesheetMethodPostback, parseTimesheetMethodPostback, buildOverdueReminderFlex } = await import(
  '../src/integrations/line.js'
);

test.after(() => {
  closeDb();
  for (const suffix of ['', '-wal', '-shm']) {
    try { rmSync(DB + suffix); } catch { /* ไม่มีไฟล์ก็ข้าม */ }
  }
});

class FakeLineClient {
  constructor() {
    this.replies = []; this.flexReplies = []; this.broadcasts = [];
  }
  async reply(replyToken, text, quickReply) { this.replies.push({ replyToken, text, quickReply }); return {}; }
  async replyFlex(replyToken, altText, contents, quickReply) {
    this.flexReplies.push({ replyToken, altText, contents, quickReply });
    return {};
  }
  async pushToAll(list, messages) { this.broadcasts.push({ list, messages }); return {}; }
}

function signedWebhookBody(events, secret = 'test-secret') {
  const raw = Buffer.from(JSON.stringify({ events }), 'utf8');
  const signature = createHmac('sha256', secret).update(raw).digest('base64');
  return { raw, signature };
}

const CONTRACT_ID = 'CT-26B0113';
const PERIOD = '2026-03';

test('buildTimesheetMethodPostback / parseTimesheetMethodPostback ย้อนกลับกันได้ตรง ปฏิเสธ data แปลกปลอม', () => {
  assert.deepEqual(
    parseTimesheetMethodPostback(buildTimesheetMethodPostback('self_obs', CONTRACT_ID, PERIOD)),
    { method: 'self_obs', contractId: CONTRACT_ID, period: PERIOD },
  );
  assert.deepEqual(
    parseTimesheetMethodPostback(buildTimesheetMethodPostback('proxy_email', CONTRACT_ID, PERIOD)),
    { method: 'proxy_email', contractId: CONTRACT_ID, period: PERIOD },
  );
  assert.equal(parseTimesheetMethodPostback('garbage'), null);
  assert.equal(parseTimesheetMethodPostback('tsmethod:not_a_method:CT-26B0113:2026-03'), null);
  assert.equal(parseTimesheetMethodPostback(''), null);
});

test('buildOverdueReminderFlex มีปุ่ม postback ครบ 4 ปุ่มตาม mockup ไม่ใช่ URI แล้ว', () => {
  const flex = buildOverdueReminderFlex({
    customerName: 'บริษัท ไทยประกันชีวิต จำกัด (มหาชน)', projectName: 'Outsource for BAU Project',
    periodLabel: 'มีนาคม 2569', dueDate: '3 เม.ย. 2569', contractId: CONTRACT_ID, period: PERIOD,
  });
  const actions = flex.footer.contents.map((b) => b.action);
  assert.equal(actions.length, 4);
  assert.deepEqual(actions.map((a) => a.label), ['ส่งผ่านระบบ OBS', 'ส่งผ่าน Email', 'ให้ผู้ดูแลเป็นคนส่ง', 'ส่งภายหลัง']);
  for (const action of actions) {
    assert.equal(action.type, 'postback');
    assert.match(action.data, /^tsmethod:/);
  }
});

test('buildOverdueReminderFlex ใช้ไล่สีฟ้าที่หัวการ์ด ไม่มีสีแดงหลุดออกมาแล้ว (8 ก.ย. 69 ตามที่ขอ)', () => {
  const flex = buildOverdueReminderFlex({
    customerName: 'บริษัท ปตท. จำกัด (มหาชน)', projectName: 'โครงการจัดหาและติดตั้งระบบซอฟต์แวร์',
    periodLabel: 'สิงหาคม 2569', dueDate: '3 กันยายน 2569', contractId: CONTRACT_ID, period: PERIOD,
  });
  assert.equal(flex.header.background.type, 'linearGradient', 'หัวการ์ดต้องเป็นไล่สี ไม่ใช่สีทึบสีเดียว');
  assert.ok(!JSON.stringify(flex).includes('BA1A1A'), 'ห้ามมีสีแดงหลุดออกมาในการ์ดนี้แล้ว');
});

test('กด "ส่งผ่านระบบ OBS" → การ์ดยืนยันมีลิงก์อัปโหลดจริง', async () => {
  run("UPDATE employees SET line_user_id = 'Uemployee-tsmethod-obs' WHERE id = 'EMP-0042'");
  try {
    const line = new FakeLineClient();
    const { raw, signature } = signedWebhookBody([
      {
        type: 'postback', replyToken: 'reply-obs', source: { userId: 'Uemployee-tsmethod-obs' },
        postback: { data: buildTimesheetMethodPostback('self_obs', CONTRACT_ID, PERIOD) },
      },
    ]);
    const result = await svc.processLineWebhook(raw, signature, { channelSecret: 'test-secret', client: line });

    assert.equal(result.results[0].outcome.outcome, 'self_obs');
    assert.equal(line.flexReplies.length, 1);
    assert.ok(line.flexReplies[0].quickReply, 'ต้องแนบปุ่มลัดมาตรฐานมาด้วย');

    const { contents } = line.flexReplies[0];
    const button = contents.footer.contents[0];
    assert.equal(button.action.type, 'uri');
    assert.ok(button.action.uri, 'ต้องมีลิงก์จริงไปหน้าอัปโหลด');
    assert.ok(JSON.stringify(contents).includes('พงศ์พันธ์ มามาก'), 'ต้องมีชื่อพนักงาน');
  } finally {
    run("UPDATE employees SET line_user_id = NULL WHERE id = 'EMP-0042'");
  }
});

test('กด "ส่งผ่าน Email" → การ์ดยืนยันมีอีเมลปลายทางตรงกับที่ตั้งไว้ + ฝ่ายบัญชีได้รับแจ้ง', async () => {
  const recipient = svc.addNotificationRecipient({
    channel: 'email', label: 'ฝ่ายบัญชี', target: 'billing-account@ipassion.co.th', actor: 'ทดสอบ',
  });
  run("UPDATE employees SET line_user_id = 'Uemployee-tsmethod-email' WHERE id = 'EMP-0042'");
  try {
    const line = new FakeLineClient();
    const { raw, signature } = signedWebhookBody([
      {
        type: 'postback', replyToken: 'reply-email', source: { userId: 'Uemployee-tsmethod-email' },
        postback: { data: buildTimesheetMethodPostback('self_email', CONTRACT_ID, PERIOD) },
      },
    ]);
    const result = await svc.processLineWebhook(raw, signature, { channelSecret: 'test-secret', client: line });

    assert.equal(result.results[0].outcome.outcome, 'self_email');
    assert.equal(line.flexReplies.length, 1);
    assert.ok(
      JSON.stringify(line.flexReplies[0].contents).includes('billing-account@ipassion.co.th'),
      'ต้องบอกอีเมลปลายทางที่ตั้งไว้จริง',
    );

    assert.equal(line.broadcasts.length, 1, 'ต้องแจ้งฝ่ายบัญชีผ่าน pushToAll หนึ่งครั้ง');
    assert.deepEqual(line.broadcasts[0].list, svc.lineApproverTargets());
    assert.ok(JSON.stringify(line.broadcasts[0].messages).includes('พงศ์พันธ์ มามาก'));
  } finally {
    run("UPDATE employees SET line_user_id = NULL WHERE id = 'EMP-0042'");
    svc.removeNotificationRecipient(recipient.id, { actor: 'ทดสอบ' });
  }
});

test('กด "ส่งผ่าน Email" แต่ยังไม่มีใครตั้งอีเมลปลายทางไว้เลย → การ์ดขึ้น fallback ไม่ error', async () => {
  run("UPDATE employees SET line_user_id = 'Uemployee-tsmethod-noemail' WHERE id = 'EMP-0042'");
  try {
    const line = new FakeLineClient();
    const { raw, signature } = signedWebhookBody([
      {
        type: 'postback', replyToken: 'reply-noemail', source: { userId: 'Uemployee-tsmethod-noemail' },
        postback: { data: buildTimesheetMethodPostback('self_email', CONTRACT_ID, PERIOD) },
      },
    ]);
    const result = await svc.processLineWebhook(raw, signature, { channelSecret: 'test-secret', client: line });

    assert.equal(result.results[0].outcome.outcome, 'self_email');
    assert.ok(
      JSON.stringify(line.flexReplies[0].contents).includes('ยังไม่ได้ตั้งอีเมลปลายทาง'),
      'ต้องมีข้อความ fallback แทนที่จะพังหรือโชว์อีเมลว่างเปล่า',
    );
  } finally {
    run("UPDATE employees SET line_user_id = NULL WHERE id = 'EMP-0042'");
  }
});

test('กด "ให้ผู้ดูแลเป็นคนส่ง" → การ์ดยืนยันมอบหมาย + ฝ่ายบัญชีได้รับแจ้งให้ไปกรอกเอง', async () => {
  run("UPDATE employees SET line_user_id = 'Uemployee-tsmethod-proxy' WHERE id = 'EMP-0042'");
  try {
    const line = new FakeLineClient();
    const { raw, signature } = signedWebhookBody([
      {
        type: 'postback', replyToken: 'reply-proxy', source: { userId: 'Uemployee-tsmethod-proxy' },
        postback: { data: buildTimesheetMethodPostback('proxy_email', CONTRACT_ID, PERIOD) },
      },
    ]);
    const result = await svc.processLineWebhook(raw, signature, { channelSecret: 'test-secret', client: line });

    assert.equal(result.results[0].outcome.outcome, 'proxy_email');
    assert.ok(JSON.stringify(line.flexReplies[0].contents).includes('มอบหมายผู้ดูแลระบบเรียบร้อย'));

    assert.equal(line.broadcasts.length, 1);
    assert.ok(JSON.stringify(line.broadcasts[0].messages).includes('กรอกเอง'));
  } finally {
    run("UPDATE employees SET line_user_id = NULL WHERE id = 'EMP-0042'");
  }
});

test('กด "ส่งภายหลัง" → ตอบข้อความสั้นๆ ไม่มีอะไรเปลี่ยนในระบบ ไม่ปิดการเตือน', async () => {
  run("UPDATE employees SET line_user_id = 'Uemployee-tsmethod-snooze' WHERE id = 'EMP-0042'");
  try {
    const line = new FakeLineClient();
    const { raw, signature } = signedWebhookBody([
      {
        type: 'postback', replyToken: 'reply-snooze', source: { userId: 'Uemployee-tsmethod-snooze' },
        postback: { data: buildTimesheetMethodPostback('snooze', CONTRACT_ID, PERIOD) },
      },
    ]);
    const result = await svc.processLineWebhook(raw, signature, { channelSecret: 'test-secret', client: line });

    assert.equal(result.results[0].outcome.outcome, 'snoozed');
    assert.equal(line.replies.length, 1);
    assert.match(line.replies[0].text, /พรุ่งนี้/);
    assert.equal(line.flexReplies.length, 0, 'ปุ่มส่งภายหลังไม่ต้องมีการ์ด แค่ตอบข้อความสั้นๆ');
    assert.equal(line.broadcasts.length, 0, 'ไม่ควรแจ้งฝ่ายบัญชีอะไรตอนกดส่งภายหลัง');
  } finally {
    run("UPDATE employees SET line_user_id = NULL WHERE id = 'EMP-0042'");
  }
});

test('userId ที่ไม่ได้ผูกบัญชีกด postback ใดๆ → outcome not_linked ไม่ throw ไม่มีอะไรถูกส่งออกไป', async () => {
  const line = new FakeLineClient();
  const { raw, signature } = signedWebhookBody([
    {
      type: 'postback', replyToken: 'reply-unlinked', source: { userId: 'Uintruder-tsmethod' },
      postback: { data: buildTimesheetMethodPostback('self_obs', CONTRACT_ID, PERIOD) },
    },
  ]);
  const result = await svc.processLineWebhook(raw, signature, { channelSecret: 'test-secret', client: line });

  assert.equal(result.results[0].outcome.outcome, 'not_linked');
  assert.equal(line.replies.length, 0);
  assert.equal(line.flexReplies.length, 0);
  assert.equal(line.broadcasts.length, 0);
});

/* ── ปุ่มลัด "ส่ง Timesheet" — เรียกดูการ์ดเลือกวิธีส่งได้เองตลอด ไม่ต้องรอเลยกำหนด (8 ก.ย. 69 ตามที่ขอ) ── */

test('พิมพ์ "ส่ง Timesheet" → ได้การ์ดเลือกวิธีส่งของรอบที่เก่าที่สุดที่ยังไม่ส่ง', async () => {
  run("UPDATE employees SET line_user_id = 'Uemployee-send-timesheet-test' WHERE id = 'EMP-0042'");
  try {
    const line = new FakeLineClient();
    const { raw, signature } = signedWebhookBody([
      {
        type: 'message', message: { type: 'text', text: 'ส่ง Timesheet' },
        replyToken: 'reply-send-ts', source: { userId: 'Uemployee-send-timesheet-test' },
      },
    ]);
    const result = await svc.processLineWebhook(raw, signature, { channelSecret: 'test-secret', client: line });

    assert.equal(result.results[0].outcome, 'submission_prompt');
    assert.equal(line.flexReplies.length, 1);
    assert.ok(line.flexReplies[0].quickReply, 'ต้องแนบปุ่มลัดมาตรฐานมาด้วย');

    const asText = JSON.stringify(line.flexReplies[0].contents);
    assert.ok(asText.includes('กุมภาพันธ์ 2569'), 'EMP-0042 ส่งแล้วแค่ ม.ค. 2569 (มาจาก seed) รอบถัดไปที่ยังไม่ส่งคือ ก.พ. 2569');
    assert.ok(asText.includes('ส่งผ่านระบบ OBS'));
  } finally {
    run("UPDATE employees SET line_user_id = NULL WHERE id = 'EMP-0042'");
  }
});

test('พนักงานที่ไม่มีสัญญาที่ active เลย พิมพ์ "ส่ง Timesheet" → แจ้งว่าไม่มีรอบที่ต้องส่ง ไม่ error', async () => {
  run(
    `INSERT INTO employees (id, name_th, invoice_position, line_user_id)
     VALUES ('EMP-9999', 'ทดสอบ ไม่มีสัญญา', 'Tester', 'Uemployee-send-timesheet-none')`,
  );
  try {
    const line = new FakeLineClient();
    const { raw, signature } = signedWebhookBody([
      {
        type: 'message', message: { type: 'text', text: 'ส่ง Timesheet' },
        replyToken: 'reply-send-ts-none', source: { userId: 'Uemployee-send-timesheet-none' },
      },
    ]);
    const result = await svc.processLineWebhook(raw, signature, { channelSecret: 'test-secret', client: line });

    assert.equal(result.results[0].outcome, 'submission_prompt');
    assert.equal(line.flexReplies.length, 0, 'ไม่มีรอบให้เลือกส่ง ต้องตกไปใช้ข้อความ text ธรรมดา');
    assert.equal(line.replies.length, 1);
    assert.match(line.replies[0].text, /ไม่มี Timesheet ที่ต้องส่ง/);
  } finally {
    run("DELETE FROM employees WHERE id = 'EMP-9999'");
  }
});
