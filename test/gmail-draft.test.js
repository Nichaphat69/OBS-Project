/**
 * ทดสอบขั้น 4.5 — สร้าง **ร่าง** อีเมลวางบิลในกล่อง Drafts ของ Gmail จริง (ไม่ auto-send)
 *
 * `createGmailDraft()` เขียนไว้ใน service.js นานแล้วพร้อม route แต่ไม่มีเทสต์คุมมาก่อน
 * (พบตอนตรวจ checklist กับโค้ดจริง 4 ส.ค. 69) — ใส่ GmailClient ปลอมแทนของจริงเหมือน
 * FakeLineClient ใน test/line-approval.test.js จึงรันได้โดยไม่ต้องมี Gmail credential จริง
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const DB = join(tmpdir(), `obs-gmail-draft-test-${process.pid}.sqlite`);
process.env.DB_PATH = DB;

/* กันไม่ให้ env.js โหลดค่า LINE จริงจาก .env — makeCycleReady() เรียก ingestTimesheet() โดยไม่ได้
   ส่ง lineClient ไปด้วย ถ้า Manday บังเอิญไม่ผ่านตรวจ (ข้อ 2.6) จะยิงเข้า LINE จริงได้ถ้าไม่กันไว้ */
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

async function makeCycleReady(period, docNoA, docNoB, { holidayDates = [] } = {}) {
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

class FakeGmailClient {
  constructor() { this.created = []; }
  async createDraft(draft) {
    this.created.push(draft);
    return { draftId: 'draft-fake-1', messageId: 'msg-fake-1', url: 'https://mail.google.com/mail/u/0/#drafts?compose=msg-fake-1', attachmentCount: draft.attachments?.length ?? 0 };
  }
}

test('createGmailDraft ปฏิเสธถ้ารอบบิลนี้ยังไม่มีรายการที่วางบิลได้', async () => {
  const gmail = new FakeGmailClient();
  await assert.rejects(
    () => svc.createGmailDraft('CT-26B0113', '2026-04', { actor: 'ทดสอบ', client: gmail }),
    (error) => error.status === 400,
  );
  assert.equal(gmail.created.length, 0);
});

test('เตรียมรอบบิล มี.ค. 2026 ให้พร้อมสร้างร่างอีเมล', async () => {
  await makeCycleReady('2026-03', '2026030201', '2026030200', { holidayDates: ['2026-03-03'] });
  const ready = svc.readyCycles().cycles.find((c) => c.period === '2026-03');
  assert.ok(ready, 'รอบ มี.ค. 2026 ต้องพร้อมวางบิลก่อนจะทดสอบขั้นถัดไปได้');
});

test('createGmailDraft ปฏิเสธถ้าลูกค้ายังไม่มีอีเมลผู้ประสานงานในระบบ', async () => {
  const gmail = new FakeGmailClient();
  await assert.rejects(
    () => svc.createGmailDraft('CT-26B0113', '2026-03', { actor: 'ทดสอบ', client: gmail }),
    (error) => error.status === 400,
  );
  assert.equal(gmail.created.length, 0);
});

test('createGmailDraft สร้างร่างจริงเมื่อมีอีเมลผู้ประสานงานแล้ว — ไม่แตะการส่งเลย', async () => {
  run('UPDATE customers SET contact_email = $email WHERE id = $id',
    { email: 'thanwarat@tli.example.com', id: 'CUS-TLI' });

  const gmail = new FakeGmailClient();
  const result = await svc.createGmailDraft('CT-26B0113', '2026-03', { actor: 'ทดสอบ', client: gmail });

  assert.equal(gmail.created.length, 1, 'ต้องสร้างร่างครั้งเดียว');
  assert.equal(gmail.created[0].to, 'thanwarat@tli.example.com');
  assert.ok(gmail.created[0].subject.length > 0, 'ต้องมีหัวข้ออีเมล');
  assert.ok(gmail.created[0].body.length > 0, 'ต้องมีเนื้ออีเมล');

  // แนบไฟล์ Timesheet ตัวจริงของทั้งสองคนให้แล้ว (เก็บไว้ตอน ingestTimesheet) — ใบแจ้งหนี้ยังแนบเองไม่ได้ (รอ 4.3)
  const attachments = gmail.created[0].attachments;
  assert.equal(attachments.length, 2, 'ต้องแนบไฟล์ Timesheet ของทั้งสองคน');
  for (const a of attachments) {
    assert.equal(a.mimeType, 'application/pdf');
    assert.equal(Buffer.from(a.content).toString('utf8'), 'x', 'เนื้อไฟล์ต้องตรงกับไฟล์ที่อัปโหลดไว้ตอน ingest');
  }

  assert.equal(result.to, 'thanwarat@tli.example.com');
  assert.equal(result.draftId, 'draft-fake-1');
  assert.match(result.note, /แนบไฟล์ Timesheet 2 ใบให้แล้ว/);
});

test('createGmailDraft บันทึก audit log ทุกครั้งที่สร้างร่าง', async () => {
  const log = svc.auditLog({ limit: 5 });
  assert.ok(
    log.some((l) => l.action === 'gmail_draft_created' && l.actor === 'ทดสอบ'),
    'ต้องมีบันทึก gmail_draft_created ของการสร้างร่างครั้งก่อนหน้า',
  );
});
