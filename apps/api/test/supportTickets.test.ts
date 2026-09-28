/**
 * ทดสอบ Milestone 4 — ระบบแจ้งปัญหา (Support Tickets) ผ่าน LINE + หน้าเว็บ (7 ก.ย. 69 ตามที่ขอ)
 *
 * โครงเดียวกับ line-approval.test.js — ใส่ LineClient ปลอมแทนของจริง รันได้โดยไม่ต้องมี
 * LINE_CHANNEL_ACCESS_TOKEN และไม่ยิงออกเน็ตจริง
 *
 * Ported from test/support-tickets.test.js (assertions preserved exactly) — ต่างจากต้นฉบับตรงที่
 * ใช้ฐานข้อมูล Postgres ตัวเทสต์ + fixture จาก helpers/testDb.ts แทน SQLite ชั่วคราว + src/db/seed.js
 * และ listSupportTickets/resolveSupportTicket เป็น async แล้ว (Prisma)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { prisma } from '@obs/db';

import { seedFixtures } from './helpers/testDb.js';
import { processLineWebhook } from '../src/lib/lineWebhookService.js';
import {
  listSupportTickets, resolveSupportTicket, submitSupportTicket, listMySupportTickets,
  getSupportTicketAttachment, SupportTicketError,
} from '../src/lib/supportTicketsService.js';
import { buildTicketPostback, parseTicketPostback, buildTicketCategoryFlex } from '../src/lib/lineClient.js';
import { loadFile } from '../src/lib/fileStorage.js';

process.env.LINE_APPROVER_USER_IDS = 'Uapprover1';
process.env.LINE_CHANNEL_ACCESS_TOKEN = '';
process.env.LINE_CHANNEL_SECRET = '';
process.env.LINE_APPROVER_TARGET = '';

await seedFixtures();

test.after(async () => {
  await prisma.$disconnect();
});

class FakeLineClient {
  replies: any[] = [];
  flexReplies: any[] = [];
  pushes: any[] = [];
  flexPushes: any[] = [];
  broadcasts: any[] = [];
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
  async pushToAll(list: unknown, messages: unknown) { this.broadcasts.push({ list, messages }); return {}; }
}

function signedWebhookBody(events: unknown[], secret = 'test-secret') {
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
  const flex: any = buildTicketCategoryFlex();
  const actions = flex.footer.contents.map((b: any) => b.action);
  assert.equal(actions.length, 4);
  for (const action of actions) {
    assert.equal(action.type, 'postback');
    assert.match(action.data, /^ticket:start:/);
  }
});

test('flow เต็ม: พิมพ์ "แจ้งปัญหา" → เลือกหมวด → พิมพ์รายละเอียด → สร้างตั๋ว + แจ้ง admin', async () => {
  await prisma.employee.update({ where: { id: 'EMP-0042' }, data: { lineUserId: 'Uemployee-ticket-test' } });
  try {
    const line = new FakeLineClient();

    const step1 = signedWebhookBody([
      {
        type: 'message', message: { type: 'text', text: 'แจ้งปัญหา' },
        replyToken: 'reply-1', source: { userId: 'Uemployee-ticket-test' },
      },
    ]);
    const result1: any = await processLineWebhook(step1.raw, step1.signature, {
      channelSecret: 'test-secret', client: line as any,
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
    const result2: any = await processLineWebhook(step2.raw, step2.signature, {
      channelSecret: 'test-secret', client: line as any,
    });
    assert.equal(result2.results[0].outcome.outcome, 'category_selected');
    assert.equal(line.replies.length, 1, 'ต้องตอบข้อความชวนพิมพ์รายละเอียดต่อ');
    assert.match(line.replies[0].text, /รายละเอียด/);
    assert.equal(
      line.replies[0].quickReply, undefined,
      'ห้ามแนบปุ่มลัดตรงนี้ — แตะปุ่มไหนก็จะถูกเก็บเป็นคำอธิบายปัญหาแทนโดยไม่ตั้งใจ',
    );

    const pending = await listSupportTickets({ status: 'open' });
    assert.equal(pending.length, 0, 'ยังไม่สร้างตั๋วจนกว่าจะพิมพ์รายละเอียด');

    const step3 = signedWebhookBody([
      {
        type: 'message', message: { type: 'text', text: 'ระบบขึ้น error ตอนกดยืนยัน Timesheet' },
        replyToken: 'reply-3', source: { userId: 'Uemployee-ticket-test' },
      },
    ]);
    const result3: any = await processLineWebhook(step3.raw, step3.signature, {
      channelSecret: 'test-secret', client: line as any,
    });
    assert.equal(result3.results[0].outcome, 'ticket_created');
    assert.ok(result3.results[0].ticketId, 'ต้องได้เลขที่ตั๋วกลับมา');
    assert.equal(line.replies.length, 2);
    assert.match(line.replies[1].text, /แจ้งปัญหาเรียบร้อย/);
    assert.ok(line.replies[1].quickReply, 'ตั๋วถูกสร้างแล้ว กลับมาแตะปุ่มลัดได้ตามปกติ');

    assert.equal(line.broadcasts.length, 1, 'ต้องแจ้ง admin ผ่าน pushToAll หนึ่งครั้ง');
    const notifyText = JSON.stringify(line.broadcasts[0].messages);
    assert.ok(notifyText.includes('ระบบขึ้น error ตอนกดยืนยัน Timesheet'));
    assert.ok(notifyText.includes('พงศ์พันธ์ มามาก'));

    const tickets = await listSupportTickets();
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
    const denyResult: any = await processLineWebhook(denyAttempt.raw, denyAttempt.signature, {
      channelSecret: 'test-secret', client: line as any,
    });
    assert.equal(denyResult.results[0].outcome.outcome, 'denied');
    assert.equal((await listSupportTickets({ status: 'open' })).some((t) => t.id === created.id), true, 'ยังต้องเปิดอยู่');

    // ── resolve จากผู้อนุมัติที่ถูกต้อง ──
    const resolveAttempt = signedWebhookBody([
      {
        type: 'postback', replyToken: 'reply-resolve', source: { userId: 'Uapprover1' },
        postback: { data: buildTicketPostback('resolve', String(created.id)) },
      },
    ]);
    const resolveResult: any = await processLineWebhook(resolveAttempt.raw, resolveAttempt.signature, {
      channelSecret: 'test-secret', client: line as any,
    });
    assert.equal(resolveResult.results[0].outcome.outcome, 'resolved');

    const afterResolve = (await listSupportTickets()).find((t) => t.id === created.id)!;
    assert.equal(afterResolve.status, 'resolved');
    assert.equal(afterResolve.resolvedBy, 'line:Uapprover1');
    assert.ok(afterResolve.resolvedAt);
  } finally {
    await prisma.employee.update({
      where: { id: 'EMP-0042' },
      data: { lineUserId: null, linePendingTicketCategory: null },
    });
  }
});

/** 25 ก.ย. 69 ตามที่ขอ — เดิม submitSupportTicket() แจ้งไปที่ lineApproverTargets() (ฝ่ายบัญชี) ทั้งที่
 * คนที่มีสิทธิ์เปิด/ปิดตั๋วจริงมีแค่ admin (requireSuperAdmin) เทสต์นี้ยืนยันว่าตอนนี้แจ้งไปที่ admin
 * โดยเฉพาะ ไม่ใช่บัญชี แม้ทั้งสอง role จะผูกไลน์ไว้พร้อมกันก็ตาม (ต้องแยกกันเด็ดขาด ไม่ใช่ fallback
 * มาเจอกันโดยบังเอิญเหมือนตอนไม่มีใครผูกเลย) */
test('แจ้งปัญหาใหม่ → ไปหา admin ที่ผูกไลน์ไว้ ไม่ใช่บัญชี แม้บัญชีจะผูกไลน์ไว้ด้วยก็ตาม', async () => {
  const now = new Date().toISOString();
  await prisma.user.create({
    data: {
      username: 'test-admin-ticket', nameTh: 'แอดมินทดสอบตั๋ว', role: 'admin', createdAt: now,
      passwordSalt: 'x', passwordHash: 'x', lineUserId: 'Uadmin-ticket-target',
    },
  });
  await prisma.user.create({
    data: {
      username: 'test-accounting-ticket', nameTh: 'บัญชีทดสอบตั๋ว', role: 'accounting', createdAt: now,
      passwordSalt: 'x', passwordHash: 'x', lineUserId: 'Uaccounting-ticket-target',
    },
  });
  const line = new FakeLineClient();
  try {
    await submitSupportTicket({
      employeeId: 'EMP-0042',
      employeeName: 'พงศ์พันธ์ มามาก',
      category: 'bug',
      description: 'ทดสอบว่าแจ้งไปหา admin',
      actor: 'test',
      client: line as any,
    });
    assert.equal(line.broadcasts.length, 1);
    assert.deepEqual(line.broadcasts[0].list, ['Uadmin-ticket-target'], 'ต้องส่งหา admin เท่านั้น ไม่ใช่บัญชี');
  } finally {
    await prisma.user.deleteMany({ where: { username: { in: ['test-admin-ticket', 'test-accounting-ticket'] } } });
    await prisma.supportTicket.deleteMany({ where: { employeeId: 'EMP-0042', description: 'ทดสอบว่าแจ้งไปหา admin' } });
  }
});

test('แจ้งปัญหาจากเว็บพร้อมรูปแนบ (24 ก.ย. 69) — เก็บรูปได้ถูกต้อง เห็นแค่ของตัวเอง และเช็คสิทธิ์ดูรูปแนบ', async () => {
  const line = new FakeLineClient();
  const fakeImageBytes = Buffer.from('fake png bytes');

  const ticket = await submitSupportTicket({
    employeeId: 'EMP-0042',
    employeeName: 'พงศ์พันธ์ มามาก',
    category: 'bug',
    description: 'กดปุ่มยืนยันแล้วหน้าขาว',
    attachments: [{ fileName: 'screenshot.png', mimeType: 'image/png', fileBase64: fakeImageBytes.toString('base64') }],
    actor: 'พงศ์พันธ์ มามาก',
    client: line as any,
  });

  try {
    const mine042 = await listMySupportTickets('EMP-0042');
    const created = mine042.find((t) => t.id === ticket.id);
    assert.ok(created, 'listMySupportTickets ต้องเห็นตั๋วที่เพิ่งสร้าง');
    assert.equal(created!.attachments.length, 1, 'ต้องมีรูปแนบ 1 รูป');
    assert.equal(created!.attachments[0].fileName, 'screenshot.png');

    const mine018 = await listMySupportTickets('EMP-0018');
    assert.equal(mine018.some((t) => t.id === ticket.id), false, 'ห้ามเห็นตั๋วของคนอื่น');

    const attachmentId = created!.attachments[0].id;

    const asOwner = await getSupportTicketAttachment(attachmentId, { viewerEmployeeId: 'EMP-0042', isAdmin: false });
    assert.equal((await loadFile(asOwner.fileKey))?.toString('utf8'), 'fake png bytes', 'ไบต์ที่เก็บต้องตรงกับที่ส่งมาเป๊ะๆ');

    const asAdmin = await getSupportTicketAttachment(attachmentId, { viewerEmployeeId: null, isAdmin: true });
    assert.ok(asAdmin, 'admin ต้องดูรูปแนบของใครก็ได้');

    await assert.rejects(
      () => getSupportTicketAttachment(attachmentId, { viewerEmployeeId: 'EMP-0018', isAdmin: false }),
      (error: unknown) => error instanceof SupportTicketError && error.status === 403,
      'ไม่ใช่เจ้าของตั๋วและไม่ใช่ admin ต้องดูรูปแนบคนอื่นไม่ได้',
    );
  } finally {
    await prisma.supportTicketAttachment.deleteMany({ where: { ticketId: ticket.id } });
    await prisma.supportTicket.delete({ where: { id: ticket.id } });
  }
});

test('resolveSupportTicket กับ id ที่ไม่มีอยู่ → error 404', async () => {
  await assert.rejects(
    () => resolveSupportTicket(999999, { actor: 'ทดสอบ' }),
    (error: any) => error.status === 404,
  );
});

test('พิมพ์ "ตั๋วของฉัน" → เห็นสถานะตั๋วของตัวเองเท่านั้น', async () => {
  await prisma.employee.update({ where: { id: 'EMP-0042' }, data: { lineUserId: 'Uemployee-mytickets-test' } });
  try {
    const line = new FakeLineClient();
    const categoryPrompt = signedWebhookBody([
      {
        type: 'message', message: { type: 'text', text: 'แจ้งปัญหา' },
        replyToken: 'r1', source: { userId: 'Uemployee-mytickets-test' },
      },
    ]);
    await processLineWebhook(categoryPrompt.raw, categoryPrompt.signature, {
      channelSecret: 'test-secret', client: line as any,
    });

    const start = signedWebhookBody([
      {
        type: 'postback', replyToken: 'r2', source: { userId: 'Uemployee-mytickets-test' },
        postback: { data: buildTicketPostback('start', 'suggestion') },
      },
    ]);
    await processLineWebhook(start.raw, start.signature, { channelSecret: 'test-secret', client: line as any });

    const submit = signedWebhookBody([
      {
        type: 'message', message: { type: 'text', text: 'อยากให้เพิ่มปุ่มดาวน์โหลด PDF' },
        replyToken: 'r3', source: { userId: 'Uemployee-mytickets-test' },
      },
    ]);
    await processLineWebhook(submit.raw, submit.signature, { channelSecret: 'test-secret', client: line as any });

    const myTickets = signedWebhookBody([
      {
        type: 'message', message: { type: 'text', text: 'ตั๋วของฉัน' },
        replyToken: 'r4', source: { userId: 'Uemployee-mytickets-test' },
      },
    ]);
    const result: any = await processLineWebhook(myTickets.raw, myTickets.signature, {
      channelSecret: 'test-secret', client: line as any,
    });
    assert.equal(result.results[0].outcome, 'my_tickets');
    const lastReply = line.replies.at(-1);
    assert.match(lastReply.text, /ข้อเสนอแนะ/);
    assert.match(lastReply.text, /รอดำเนินการ/);
  } finally {
    await prisma.employee.update({
      where: { id: 'EMP-0042' },
      data: { lineUserId: null, linePendingTicketCategory: null },
    });
  }
});
