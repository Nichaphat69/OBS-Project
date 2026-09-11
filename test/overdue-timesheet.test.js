/**
 * ทดสอบ Milestone 2 — เตือน "Timesheet ยังไม่ส่ง" เข้าไลน์ส่วนตัวของพนักงาน
 *
 * กติกาที่ตกลงกัน (7 ก.ย. 69): ต้องส่ง Timesheet ภายใน 3 วันหลังวันสิ้นเดือน กติกาเดียวกันทุกคน
 * ถ้าเลยกำหนดแล้วยังไม่ส่ง แจ้งเตือน แล้วแจ้งซ้ำทุกวันถัดไปจนกว่าจะส่งจริงเข้าระบบ OBS
 *
 * ใช้ LineClient ปลอมแทนของจริง (เหมือนไฟล์ทดสอบ LINE อื่นๆ) จึงรันได้โดยไม่ต้องมี
 * LINE_CHANNEL_ACCESS_TOKEN และไม่ยิงออกเน็ตจริง
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const DB = join(tmpdir(), `obs-overdue-test-${process.pid}.sqlite`);
process.env.DB_PATH = DB;
process.env.LINE_CHANNEL_ACCESS_TOKEN = '';
process.env.LINE_CHANNEL_SECRET = '';
process.env.LINE_APPROVER_TARGET = '';

await import('../src/db/seed.js');
const svc = await import('../src/service.js');
const { closeDb, run } = await import('../src/db/index.js');

test.after(() => {
  closeDb();
  for (const suffix of ['', '-wal', '-shm']) {
    try { rmSync(DB + suffix); } catch { /* ไม่มีไฟล์ก็ข้าม */ }
  }
});

class FakeLineClient {
  constructor() { this.flexPushes = []; }
  async pushFlexToUser(userId, altText, contents, quickReply) {
    this.flexPushes.push({ userId, altText, contents, quickReply });
    return {};
  }
}

function stubExtractor(data) {
  return async () => ({ data, verification: { ok: true, issues: [] }, usage: {}, model: 'stub' });
}

function fakeTimesheet({ employeeName, position }) {
  const period = '2026-03';
  const days = [];
  for (let d = 1; d <= 31; d += 1) {
    const date = `2026-03-${String(d).padStart(2, '0')}`;
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (dow === 0 || dow === 6) days.push({ date, timeIn: null, timeOut: null, label: 'Weekend', jobDescription: null });
    else if (date === '2026-03-03') days.push({ date, timeIn: null, timeOut: null, label: 'Holiday', jobDescription: null });
    else days.push({ date, timeIn: '8:30', timeOut: '17:00', label: null, jobDescription: 'งานตามที่ได้รับมอบหมาย' });
  }
  return {
    vendor: 'iPassion Co.,Ltd.', clientName: 'ThaiLife Insurance Public Co.,Ltd.',
    projectName: 'Outsource for BAU Project', employeeName, position, period,
    totalWorkDays: days.filter((d) => d.timeIn).length, totalLeaveDays: 0,
    days, leaveDays: [], signedByEmployee: true, signedByProjectManager: true, notes: [],
  };
}

// รอบ มี.ค. 2569 (สิ้นเดือน 31 มี.ค.) + 3 วัน = ครบกำหนด 3 เม.ย. 2569
const DUE_DATE = '2026-04-03';

test('พนักงานที่ยังไม่ส่ง Timesheet เลยกำหนด 3 วันหลังสิ้นเดือนแล้ว → ต้องอยู่ในรายชื่อค้างส่ง', () => {
  const overdue = svc.overdueTimesheets({ today: DUE_DATE });
  const forMarch = overdue.filter((o) => o.period === '2026-03' && o.contractId === 'CT-26B0113');

  assert.equal(forMarch.length, 2, 'ทั้ง 2 คนของสัญญานี้ยังไม่ส่งรอบ มี.ค. เลย');
  assert.ok(forMarch.every((o) => o.dueDate === DUE_DATE));
  assert.ok(forMarch.some((o) => o.employeeId === 'EMP-0042'));
  assert.ok(forMarch.some((o) => o.employeeId === 'EMP-0018'));
});

test('ยังไม่ครบกำหนด (ก่อนวันครบกำหนด 1 วัน) → ยังไม่ขึ้นในรายชื่อค้างส่ง', () => {
  const overdue = svc.overdueTimesheets({ today: '2026-04-02' });
  const forMarch = overdue.filter((o) => o.period === '2026-03' && o.contractId === 'CT-26B0113');
  assert.equal(forMarch.length, 0, 'ยังไม่เลยกำหนด ไม่ควรเตือน');
});

test('ส่งแล้ว (สถานะไม่ใช่ rejected) → ไม่นับว่ายังไม่ส่งอีกต่อไป', async () => {
  await svc.ingestTimesheet({
    documentNo: '2026030101',
    fileBase64: Buffer.from('x').toString('base64'),
    expectedPeriod: '2026-03',
    extractor: stubExtractor(fakeTimesheet({ employeeName: 'Pongpun Mamak', position: 'Java Programmer' })),
  });

  const overdue = svc.overdueTimesheets({ today: DUE_DATE });
  const forMarch = overdue.filter((o) => o.period === '2026-03' && o.contractId === 'CT-26B0113');

  assert.equal(forMarch.length, 1, 'เหลือแค่ Sunee ที่ยังไม่ส่ง');
  assert.equal(forMarch[0].employeeId, 'EMP-0018');
});

test('ใบที่ถูกตีกลับ (rejected) ยังนับว่ายังไม่ส่งอยู่ — ต้องรอฉบับแก้ไขที่ระบบยอมรับจริง', () => {
  svc.rejectTimesheet('2026030101', { actor: 'ทดสอบ', reason: 'ยอดวันลาไม่ตรง' });

  const overdue = svc.overdueTimesheets({ today: DUE_DATE });
  const forMarch = overdue.filter((o) => o.period === '2026-03' && o.contractId === 'CT-26B0113');

  assert.equal(forMarch.length, 2, 'Pongpun กลับมานับว่ายังไม่ส่งอีกครั้งเพราะใบที่ส่งไปถูกตีกลับ');
});

test('sendOverdueTimesheetReminders — ไม่มีใครผูกบัญชีไลน์ไว้เลย → ข้ามทุกคน (skipped) ไม่ส่งจริง', async () => {
  const line = new FakeLineClient();
  const result = await svc.sendOverdueTimesheetReminders({ today: DUE_DATE, client: line });

  const forMarch = result.skipped.filter((o) => o.period === '2026-03' && o.contractId === 'CT-26B0113');
  assert.equal(forMarch.length, 2);
  assert.ok(forMarch.every((o) => o.reason.includes('ผูกบัญชี')));
  assert.equal(line.flexPushes.length, 0);
});

test('sendOverdueTimesheetReminders — ผูกบัญชีไลน์ไว้แล้ว → ส่งการ์ดเตือนจริงเข้าไลน์ส่วนตัว', async () => {
  run("UPDATE employees SET line_user_id = 'Uemployee-overdue-test' WHERE id = 'EMP-0018'");
  try {
    const line = new FakeLineClient();
    const result = await svc.sendOverdueTimesheetReminders({ today: DUE_DATE, client: line });

    const push = line.flexPushes.find((p) => p.userId === 'Uemployee-overdue-test');
    assert.ok(push, 'ต้องส่งการ์ดเตือนหา Sunee ที่ผูกบัญชีไว้แล้ว');
    assert.match(push.altText, /ยังไม่ส่ง/);

    const asText = JSON.stringify(push.contents);
    assert.ok(asText.includes('มีนาคม 2569'), 'ต้องบอกรอบเดือนที่ยังไม่ส่ง');
    assert.ok(asText.includes('ส่งผ่านระบบ OBS'), 'ต้องมีปุ่มเลือกวิธีส่งผ่านระบบ OBS (M3)');
    assert.ok(asText.includes('ส่งผ่าน Email'), 'ต้องมีปุ่มเลือกวิธีส่งผ่าน Email (M3)');
    assert.ok(asText.includes('ให้ผู้ดูแลเป็นคนส่ง'), 'ต้องมีปุ่มมอบหมายผู้ดูแลส่งแทน (M3)');
    assert.ok(!asText.includes('บาท'), 'ห้ามมียอดเงินหลุดออกมาในการ์ดเตือนของพนักงาน');
    assert.ok(push.quickReply, 'ต้องแนบปุ่มลัดมาตรฐานมาด้วย');

    // Pongpun ยังไม่ได้ผูกบัญชี ต้องยังอยู่ในฝั่ง skipped ไม่ใช่ sent
    assert.ok(result.skipped.some((o) => o.employeeId === 'EMP-0042'));
    assert.ok(!result.skipped.some((o) => o.employeeId === 'EMP-0018'));
  } finally {
    run("UPDATE employees SET line_user_id = NULL WHERE id = 'EMP-0018'");
  }
});
