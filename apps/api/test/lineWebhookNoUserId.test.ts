/**
 * ปุ่มใน LINE ที่ไม่มี userId ติดมา ต้องไม่ถูกบันทึกใส่พนักงานคนอื่น (18 ก.ย. 69)
 *
 * เส้นข้อความ (`event.type === 'message'`) กัน userId ว่างไว้แล้ว (`&& userId` ใน processLineWebhook)
 * แต่เส้นปุ่ม (postback) ส่ง `userId` ที่อาจเป็น null ต่อเข้า handler ตรงๆ แล้ว handler ค้นด้วย
 * `where: { lineUserId: userId ?? undefined }` — ซึ่งพอ userId เป็น null จะกลายเป็น `where: {}`
 * คือ **"เอาพนักงานคนไหนก็ได้"** ไม่ใช่ "ไม่เอาใครเลย" ด่าน `if (!employee) return not_linked`
 * ที่เขียนกันไว้แล้วจึงไม่เคยทำงาน
 *
 * ผลคือมีคนกดปุ่มจากที่ที่ LINE ไม่ส่ง userId มา (เช่นในกลุ่มที่ผู้ใช้ยังไม่ได้ยินยอมเปิดเผยตัวตน)
 * แล้วระบบบันทึก "เลือกวิธีส่ง Timesheet" หรือ "เปิดตั๋วแจ้งปัญหา" ใส่พนักงานคนแรกในฐานข้อมูลแทน
 * เงียบๆ ไม่มี error — ข้อมูลผิดคนไหลเข้าหน้า "บันทึกการส่ง" และ audit log
 *
 * ⚠️ ไฟล์นี้ใช้ fixture ร่วมกับไฟล์อื่น — ทุกแถวที่สร้างต้องลบคืนให้หมดใน test.after
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { prisma } from '@obs/db';

import { seedFixtures, CONTRACT } from './helpers/testDb.js';
import { processLineWebhook } from '../src/lib/lineWebhookService.js';
import { buildTimesheetMethodPostback, buildTicketPostback } from '../src/lib/lineClient.js';

process.env.LINE_CHANNEL_ACCESS_TOKEN = '';
process.env.LINE_CHANNEL_SECRET = '';
process.env.LINE_APPROVER_TARGET = '';

await seedFixtures();

const PERIOD = '2026-03';

test.after(async () => {
  await prisma.timesheetSubmission.deleteMany({ where: { period: PERIOD } });
  await prisma.supportTicket.deleteMany({ where: { employeeId: { in: ['EMP-0042', 'EMP-0018'] } } });
  await prisma.$disconnect();
});

class FakeLineClient {
  async reply() { return {}; }
  async replyFlex() { return {}; }
  async pushToUser() { return {}; }
  async pushFlexToUser() { return {}; }
  async pushToAll() { return {}; }
  async pushFlexToAll() { return {}; }
}

/** postback event ที่ source ไม่มี userId — LINE ส่งแบบนี้ได้จริงเมื่อผู้ใช้ยังไม่ยินยอมเปิดเผยตัวตน */
function postbackWithoutUserId(data: string) {
  const events = [{ type: 'postback', source: { type: 'group', groupId: 'Cgroup123' }, postback: { data }, replyToken: 'rt-1' }];
  const raw = Buffer.from(JSON.stringify({ events }), 'utf8');
  return { raw, signature: createHmac('sha256', 'test-secret').update(raw).digest('base64') };
}

test('กดปุ่มเลือกวิธีส่ง โดยไม่มี userId — ต้องไม่บันทึกใส่พนักงานคนไหนเลย', async () => {
  const before = await prisma.timesheetSubmission.count();

  const { raw, signature } = postbackWithoutUserId(buildTimesheetMethodPostback('self_obs', CONTRACT.id, PERIOD));
  const result: any = await processLineWebhook(raw, signature, {
    channelSecret: 'test-secret',
    client: new FakeLineClient() as any,
  });

  assert.equal(
    (await prisma.timesheetSubmission.count()) - before,
    0,
    'ไม่รู้ว่าใครกด ต้องไม่สร้างแถวบันทึกการส่งให้ใครทั้งนั้น',
  );
  assert.equal(result.results?.[0]?.outcome?.outcome, 'not_linked', 'ต้องตอบว่ายังไม่ได้ผูกบัญชี ไม่ใช่ทำสำเร็จ');
});

test('กดปุ่มแจ้งปัญหา โดยไม่มี userId — ต้องไม่เปิดตั๋วใส่พนักงานคนอื่น', async () => {
  const before = await prisma.supportTicket.count();

  const { raw, signature } = postbackWithoutUserId(buildTicketPostback('start', 'timesheet'));
  const result: any = await processLineWebhook(raw, signature, {
    channelSecret: 'test-secret',
    client: new FakeLineClient() as any,
  });

  assert.equal(
    (await prisma.supportTicket.count()) - before,
    0,
    'ไม่รู้ว่าใครกด ต้องไม่เปิดตั๋วแจ้งปัญหาใส่ชื่อใคร',
  );
  assert.equal(result.results?.[0]?.outcome?.outcome, 'not_linked');
});
