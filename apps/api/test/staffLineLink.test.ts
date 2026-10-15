/**
 * ผูกไลน์ของบัญชี admin/accounting เอง (24 ก.ย. 69 ตามที่ขอ — "เชื่อมต่อ LINE ครั้งแรก จะได้รู้ว่าคนที่
 * แอดไลน์มาเป็น role อะไร รับแจ้งเตือนอะไรบ้าง") คนละกลไกกับ employeeLineLinkService.ts (คนละคอลัมน์:
 * User.lineUserId ไม่ใช่ Employee.lineUserId) — ดู staffLineLinkService.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomInt } from 'node:crypto';
import { prisma } from '@obs/db';

import { seedFixtures } from './helpers/testDb.js';
import { processLineWebhook } from '../src/lib/lineWebhookService.js';
import {
  startStaffLineLink, getStaffLineLinkStatus, unlinkStaffLine, linkStaffLineViaLogin, StaffLineLinkError,
} from '../src/lib/staffLineLinkService.js';
import { lineAdminTargets, lineApproverTargets } from '../src/lib/notificationRecipientsService.js';

process.env.LINE_CHANNEL_ACCESS_TOKEN = '';
process.env.LINE_CHANNEL_SECRET = '';
process.env.LINE_APPROVER_TARGET = '';
delete process.env.LINE_ADMIN_TARGET;

await seedFixtures();

class FakeLineClient {
  replies: any[] = [];
  async reply(replyToken: string, text: string, quickReply?: unknown) { this.replies.push({ replyToken, text, quickReply }); return {}; }
}

function signedWebhookBody(events: unknown[], secret = 'test-secret') {
  const raw = Buffer.from(JSON.stringify({ events }), 'utf8');
  const signature = createHmac('sha256', secret).update(raw).digest('base64');
  return { raw, signature };
}

async function makeTestUser(username: string, role: string) {
  await prisma.user.create({
    data: { username, nameTh: `ทดสอบ ${role}`, role, createdAt: new Date().toISOString(), passwordSalt: 'x', passwordHash: 'x' },
  });
}

test.after(async () => {
  await prisma.$disconnect();
});

test('startStaffLineLink ออกรหัสให้ แล้วผูกได้จริงผ่านฟังก์ชัน service ตรงๆ', async () => {
  await makeTestUser('test-staff-svc', 'admin');
  try {
    const status0 = await getStaffLineLinkStatus('test-staff-svc');
    assert.equal(status0.linked, false);

    const start = await startStaffLineLink('test-staff-svc');
    assert.equal(start.alreadyLinked, false);
    assert.match(start.code!, /^LINK-\d{6}$/);

    await linkStaffLineViaLogin('test-staff-svc', 'Utest-staff-svc');
    const status1 = await getStaffLineLinkStatus('test-staff-svc');
    assert.equal(status1.linked, true);

    const again = await startStaffLineLink('test-staff-svc');
    assert.equal(again.alreadyLinked, true, 'ผูกแล้วต้องไม่ออกรหัสซ้ำ');

    await unlinkStaffLine('test-staff-svc');
    assert.equal((await getStaffLineLinkStatus('test-staff-svc')).linked, false);
  } finally {
    await prisma.user.deleteMany({ where: { username: 'test-staff-svc' } });
  }
});

test('linkStaffLineViaLogin ปฏิเสธถ้าบัญชีไลน์นั้นถูกผูกกับคนอื่นไปแล้ว', async () => {
  await makeTestUser('test-staff-a', 'admin');
  await makeTestUser('test-staff-b', 'accounting');
  try {
    await linkStaffLineViaLogin('test-staff-a', 'Ushared-line-id');
    await assert.rejects(
      () => linkStaffLineViaLogin('test-staff-b', 'Ushared-line-id'),
      (error: unknown) => error instanceof StaffLineLinkError && error.status === 409,
    );
  } finally {
    await prisma.user.deleteMany({ where: { username: { in: ['test-staff-a', 'test-staff-b'] } } });
  }
});

test('พิมพ์รหัสที่ได้จากหน้าเว็บส่งเข้า LINE → ผูกบัญชี admin ให้อัตโนมัติ พร้อมบอกว่าจะได้แจ้งเตือนอะไร', async () => {
  await makeTestUser('test-webhook-admin', 'admin');
  try {
    const { code } = await startStaffLineLink('test-webhook-admin');
    const line = new FakeLineClient();

    const webhook = signedWebhookBody([
      { type: 'message', message: { type: 'text', text: code }, replyToken: 'r1', source: { userId: 'Uwebhook-admin-test' } },
    ]);
    const result: any = await processLineWebhook(webhook.raw, webhook.signature, { channelSecret: 'test-secret', client: line as any });

    assert.equal(result.results[0].outcome, 'staff_linked');
    assert.equal(result.results[0].role, 'admin');
    assert.equal(line.replies.length, 1);
    assert.match(line.replies[0].text, /ระบบมีปัญหา/, 'ต้องบอกว่า role admin จะได้รับแจ้งเตือนอะไร');

    const user = await prisma.user.findUnique({ where: { username: 'test-webhook-admin' } });
    assert.equal(user?.lineUserId, 'Uwebhook-admin-test');

    // ตอนนี้ผูกแล้ว — lineAdminTargets() ต้องเห็นและใช้ปลายทางนี้จริง
    assert.deepEqual(await lineAdminTargets(), ['Uwebhook-admin-test']);
  } finally {
    await prisma.user.deleteMany({ where: { username: 'test-webhook-admin' } });
  }
});

test('พิมพ์รหัสของบัญชี accounting → บอกว่าจะได้รับแจ้งเตือนขออนุมัติ/ตั๋วแจ้งปัญหา', async () => {
  await makeTestUser('test-webhook-acct', 'accounting');
  try {
    const { code } = await startStaffLineLink('test-webhook-acct');
    const line = new FakeLineClient();
    const webhook = signedWebhookBody([
      { type: 'message', message: { type: 'text', text: code }, replyToken: 'r1', source: { userId: 'Uwebhook-acct-test' } },
    ]);
    const result: any = await processLineWebhook(webhook.raw, webhook.signature, { channelSecret: 'test-secret', client: line as any });

    assert.equal(result.results[0].outcome, 'staff_linked');
    assert.equal(result.results[0].role, 'accounting');
    assert.match(line.replies[0].text, /ขออนุมัติออก INV และตั๋วแจ้งปัญหา/);

    assert.deepEqual(await lineApproverTargets(), ['Uwebhook-acct-test']);
  } finally {
    await prisma.user.deleteMany({ where: { username: 'test-webhook-acct' } });
  }
});

test('รหัสหมดอายุแล้ว → ไม่ผูกให้ ไม่ error แค่เงียบ (ปล่อยให้ตกไปเป็นข้อความไม่รู้จัก)', async () => {
  await makeTestUser('test-webhook-expired', 'admin');
  try {
    const expiredCode = `LINK-${String(randomInt(0, 1_000_000)).padStart(6, '0')}`;
    await prisma.user.update({
      where: { username: 'test-webhook-expired' },
      data: { lineLinkCode: expiredCode, lineLinkCodeExpiresAt: new Date(Date.now() - 60_000).toISOString() },
    });
    const line = new FakeLineClient();
    const webhook = signedWebhookBody([
      { type: 'message', message: { type: 'text', text: expiredCode }, replyToken: 'r1', source: { userId: 'Uwebhook-expired-test' } },
    ]);
    await processLineWebhook(webhook.raw, webhook.signature, { channelSecret: 'test-secret', client: line as any });

    const user = await prisma.user.findUnique({ where: { username: 'test-webhook-expired' } });
    assert.equal(user?.lineUserId, null, 'รหัสหมดอายุแล้ว ต้องไม่ผูกให้');
  } finally {
    await prisma.user.deleteMany({ where: { username: 'test-webhook-expired' } });
  }
});
