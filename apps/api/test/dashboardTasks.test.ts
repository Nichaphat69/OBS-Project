/**
 * "งานที่ต้องทำ" ในแดชบอร์ด ต้องบอกจำนวน + รายชื่อคนที่ยังไม่ส่ง Timesheet (24 ก.ย. 69 ตามที่ขอ —
 * "หน้า 'รอ timesheet' ไม่บอกจำนวน (เช่น 2/3) และไม่ระบุว่าใครยังไม่ส่ง") ข้อมูล expected/received/
 * missing มีอยู่แล้วใน getCycleStatus() แค่ไม่เคยถูกเอามาขึ้น tasks[] เลยตั้งแต่แรก
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@obs/db';

import { seedFixtures, CONTRACT } from './helpers/testDb.js';
import { dashboard } from '../src/lib/dashboardService.js';

await seedFixtures();

test.after(async () => {
  await prisma.$disconnect();
});

test('รอบที่ยังไม่มีใครส่ง Timesheet เลย ต้องขึ้นเป็นงาน "รอ Timesheet" พร้อมจำนวนและรายชื่อคนที่ยังไม่ส่ง', async () => {
  // fixture: สัญญา CONTRACT.id (ม.ค.–มิ.ย. 2569) มี 2 คน ส่ง Timesheet ครบเฉพาะเดือน ม.ค. เดือน ก.พ.
  // เป็นต้นไปยังไม่มีใครส่งเลย (AWAITING) — expected 2 คนทั้งคู่
  const result = await dashboard(CONTRACT.id);

  const waitingTasks = result.tasks.filter((t: any) => t.title === 'รอ Timesheet');
  assert.ok(waitingTasks.length > 0, 'ต้องมีงาน "รอ Timesheet" อย่างน้อยหนึ่งรอบ (ก.พ. เป็นต้นไปยังไม่มีใครส่ง)');

  const feb = waitingTasks.find((t: any) => t.detail.includes('กุมภาพันธ์'));
  assert.ok(feb, 'ต้องมีรอบเดือนกุมภาพันธ์อยู่ในรายการ (ยังไม่มีใครส่งเลย)');
  assert.match(feb!.detail, /0\/2/, 'ต้องบอกจำนวนส่งแล้ว/ทั้งหมดตรงๆ เช่น 0/2 ไม่ใช่แค่บอกว่า "ยังไม่ครบ"');
  assert.match(feb!.detail, /พงศ์พันธ์ มามาก/, 'ต้องระบุชื่อคนที่ยังไม่ส่งตรงๆ');
  assert.match(feb!.detail, /สุนีย์ มณีเกษมสุข/, 'ต้องระบุชื่อคนที่ยังไม่ส่งตรงๆ (ทั้งสองคน ไม่ใช่แค่คนแรก)');
  assert.equal(feb!.link, null, 'ยังไม่มีหน้าใดให้กดตรงเข้าไปดูรายชื่อคนค้างส่งได้จริง จึงไม่ใส่ลิงก์ปลอมๆ');
});

test('รอบที่ส่งครบแล้ว (ม.ค.) ต้องไม่ขึ้นเป็นงาน "รอ Timesheet"', async () => {
  const result = await dashboard(CONTRACT.id);
  const jan = result.tasks.filter((t: any) => t.title === 'รอ Timesheet' && t.detail.includes('มกราคม'));
  assert.equal(jan.length, 0, 'ม.ค. ทั้งสองคนส่งครบแล้วตาม fixture — ไม่ควรถูกทวงอีก');
});
