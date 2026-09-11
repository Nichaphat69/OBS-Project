/**
 * ทดสอบ Milestone 4 — ระบบแจ้งปัญหา (Support Tickets) ผ่าน LINE + หน้าเว็บ (7 ก.ย. 69 ตามที่ขอ)
 *
 * โครงเดียวกับ line-approval.test.js — ใส่ LineClient ปลอมแทนของจริง รันได้โดยไม่ต้องมี
 * LINE_CHANNEL_ACCESS_TOKEN และไม่ยิงออกเน็ตจริง
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const DB = join(tmpdir(), `obs-support-tickets-test-${process.pid}.sqlite`);
process.env.DB_PATH = DB;
process.env.LINE_APPROVER_USER_IDS = 'Uapprover1';
process.env.LINE_CHANNEL_ACCESS_TOKEN = '';
process.env.LINE_CHANNEL_SECRET = '';
process.env.LINE_APPROVER_TARGET = '';

await import('../src/db/seed.js');
const svc = await import('../src/service.js');
const { closeDb, run } = await import('../src/db/index.js');
const { buildTicketPostback, parseTicketPostback, buildTicketCategoryFlex } = await import(
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
    this.replies = []; this.flexReplies = []; this.pushes = []; this.flexPushes = []; this.broadcasts = [];
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
  async pushToAll(list, messages) { this.broadcasts.push({ list, messages }); return {}; }
}

function signedWebhookBody(events, secret = 'test-secret') {
  const raw = Buffer.from(JSON.stringify({ events }), 'utf8');
  const signature = createHmac('sha256', secret).update(raw).digest('base64');
  return { raw, signature };
}

test('buildTicketPostback / parseTicketPostback ย้อนกลับกันได้ตรง', () => {
  assert.deepEqual(parseTicketPostback(buildTicketPostback('start', 'bug')), { action: 'start', value: 'bug' });
  assert.deepEqual(parseTicketPostback(buildTicketPostback('resolve', '7')), { action: 'resolve', value: '7' });
  assert.equal(parseTicketPostback('garbage'), null);
  assert.equal(parseTicketPostback(''), null);
});

test('buildTicketCategoryFlex มีปุ่มครบ 4 หมวด เป็น postback ไม่ใช่ URL', () => {
  const flex = buildTicketCategoryFlex();
  const actions = flex.footer.contents.map((b) => b.action);
  assert.equal(actions.length, 4);
  for (const action of actions) {
    assert.equal(action.type, 'postback');
    assert.match(action.data, /^ticket:start:/);
  }
});

test('flow เต็ม: พิมพ์ "แจ้งปัญหา" → เลือกหมวด → พิมพ์รายละเอียด → สร้างตั๋ว + แจ้งฝ่ายบัญชี', async () => {
  run("UPDATE employees SET line_user_id = 'Uemployee-ticket-test' WHERE id = 'EMP-0042'");
  try {
    const line = new FakeLineClient();

    const step1 = signedWebhookBody([
      {
        type: 'message', message: { type: 'text', text: 'แจ้งปัญหา' },
        replyToken: 'reply-1', source: { userId: 'Uemployee-ticket-test' },
      },
    ]);
    const result1 = await svc.processLineWebhook(step1.raw, step1.signature, {
      channelSecret: 'test-secret', client: line,
    });
    assert.equal(result1.results[0].outcome, 'ticket_category_prompt');
    assert.equal(line.flexReplies.length, 1, 'ต้องตอบด้วย Flex การ์ดเลือกหมวด');
    assert.equal(line.flexReplies[0].contents.footer.contents.length, 4);
    assert.ok(line.flexReplies[0].quickReply, 'ตอนนี้ยังไม่ได้เลือกหมวด แตะปุ่มลัดได้ตามปกติ');

    const step2 = signedWebhookBody([
      {
        type: 'postback', replyToken: 'reply-2', source: { userId: 'Uemployee-ticket-test' },
        postback: { data: buildTicketPostback('start', 'bug') },
      },
    ]);
    const result2 = await svc.processLineWebhook(step2.raw, step2.signature, {
      channelSecret: 'test-secret', client: line,
    });
    assert.equal(result2.results[0].outcome.outcome, 'category_selected');
    assert.equal(line.replies.length, 1, 'ต้องตอบข้อความชวนพิมพ์รายละเอียดต่อ');
    assert.match(line.replies[0].text, /รายละเอียด/);
    assert.equal(
      line.replies[0].quickReply, undefined,
      'ห้ามแนบปุ่มลัดตรงนี้ — แตะปุ่มไหนก็จะถูกเก็บเป็นคำอธิบายปัญหาแทนโดยไม่ตั้งใจ',
    );

    const pending = svc.listSupportTickets({ status: 'open' });
    assert.equal(pending.length, 0, 'ยังไม่สร้างตั๋วจนกว่าจะพิมพ์รายละเอียด');

    const step3 = signedWebhookBody([
      {
        type: 'message', message: { type: 'text', text: 'ระบบขึ้น error ตอนกดยืนยัน Timesheet' },
        replyToken: 'reply-3', source: { userId: 'Uemployee-ticket-test' },
      },
    ]);
    const result3 = await svc.processLineWebhook(step3.raw, step3.signature, {
      channelSecret: 'test-secret', client: line,
    });
    assert.equal(result3.results[0].outcome, 'ticket_created');
    assert.ok(result3.results[0].ticketId, 'ต้องได้เลขที่ตั๋วกลับมา');
    assert.equal(line.replies.length, 2);
    assert.match(line.replies[1].text, /แจ้งปัญหาเรียบร้อย/);
    assert.ok(line.replies[1].quickReply, 'ตั๋วถูกสร้างแล้ว กลับมาแตะปุ่มลัดได้ตามปกติ');

    assert.equal(line.broadcasts.length, 1, 'ต้องแจ้งฝ่ายบัญชีผ่าน pushToAll หนึ่งครั้ง');
    const notifyText = JSON.stringify(line.broadcasts[0].messages);
    assert.ok(notifyText.includes('ระบบขึ้น error ตอนกดยืนยัน Timesheet'));
    assert.ok(notifyText.includes('พงศ์พันธ์ มามาก'));

    const tickets = svc.listSupportTickets();
    const created = tickets.find((t) => t.id === result3.results[0].ticketId);
    assert.ok(created, 'listSupportTickets ต้องเห็นตั๋วที่เพิ่งสร้าง');
    assert.equal(created.employeeName, 'พงศ์พันธ์ มามาก');
    assert.equal(created.category, 'bug');
    assert.equal(created.status, 'open');

    // ── ปฏิเสธ resolve จาก userId ที่ไม่อยู่ในรายชื่อผู้อนุมัติ ──
    const denyAttempt = signedWebhookBody([
      {
        type: 'postback', replyToken: 'reply-deny', source: { userId: 'Uintruder' },
        postback: { data: buildTicketPostback('resolve', String(created.id)) },
      },
    ]);
    const denyResult = await svc.processLineWebhook(denyAttempt.raw, denyAttempt.signature, {
      channelSecret: 'test-secret', client: line,
    });
    assert.equal(denyResult.results[0].outcome.outcome, 'denied');
    assert.equal(svc.listSupportTickets({ status: 'open' }).some((t) => t.id === created.id), true, 'ยังต้องเปิดอยู่');

    // ── resolve จากผู้อนุมัติที่ถูกต้อง ──
    const resolveAttempt = signedWebhookBody([
      {
        type: 'postback', replyToken: 'reply-resolve', source: { userId: 'Uapprover1' },
        postback: { data: buildTicketPostback('resolve', String(created.id)) },
      },
    ]);
    const resolveResult = await svc.processLineWebhook(resolveAttempt.raw, resolveAttempt.signature, {
      channelSecret: 'test-secret', client: line,
    });
    assert.equal(resolveResult.results[0].outcome.outcome, 'resolved');

    const afterResolve = svc.listSupportTickets().find((t) => t.id === created.id);
    assert.equal(afterResolve.status, 'resolved');
    assert.equal(afterResolve.resolvedBy, 'line:Uapprover1');
    assert.ok(afterResolve.resolvedAt);
  } finally {
    run("UPDATE employees SET line_user_id = NULL, line_pending_ticket_category = NULL WHERE id = 'EMP-0042'");
  }
});

test('resolveSupportTicket กับ id ที่ไม่มีอยู่ → error 404', () => {
  assert.throws(
    () => svc.resolveSupportTicket(999999, { actor: 'ทดสอบ' }),
    (error) => error.status === 404,
  );
});

test('พิมพ์ "ตั๋วของฉัน" → เห็นสถานะตั๋วของตัวเองเท่านั้น', async () => {
  run("UPDATE employees SET line_user_id = 'Uemployee-mytickets-test' WHERE id = 'EMP-0042'");
  try {
    const line = new FakeLineClient();
    const categoryPrompt = signedWebhookBody([
      {
        type: 'message', message: { type: 'text', text: 'แจ้งปัญหา' },
        replyToken: 'r1', source: { userId: 'Uemployee-mytickets-test' },
      },
    ]);
    await svc.processLineWebhook(categoryPrompt.raw, categoryPrompt.signature, {
      channelSecret: 'test-secret', client: line,
    });

    const start = signedWebhookBody([
      {
        type: 'postback', replyToken: 'r2', source: { userId: 'Uemployee-mytickets-test' },
        postback: { data: buildTicketPostback('start', 'suggestion') },
      },
    ]);
    await svc.processLineWebhook(start.raw, start.signature, { channelSecret: 'test-secret', client: line });

    const submit = signedWebhookBody([
      {
        type: 'message', message: { type: 'text', text: 'อยากให้เพิ่มปุ่มดาวน์โหลด PDF' },
        replyToken: 'r3', source: { userId: 'Uemployee-mytickets-test' },
      },
    ]);
    await svc.processLineWebhook(submit.raw, submit.signature, { channelSecret: 'test-secret', client: line });

    const myTickets = signedWebhookBody([
      {
        type: 'message', message: { type: 'text', text: 'ตั๋วของฉัน' },
        replyToken: 'r4', source: { userId: 'Uemployee-mytickets-test' },
      },
    ]);
    const result = await svc.processLineWebhook(myTickets.raw, myTickets.signature, {
      channelSecret: 'test-secret', client: line,
    });
    assert.equal(result.results[0].outcome, 'my_tickets');
    const lastReply = line.replies.at(-1);
    assert.match(lastReply.text, /ข้อเสนอแนะ/);
    assert.match(lastReply.text, /รอดำเนินการ/);
  } finally {
    run("UPDATE employees SET line_user_id = NULL, line_pending_ticket_category = NULL WHERE id = 'EMP-0042'");
  }
});
