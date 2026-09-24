/**
 * ทดสอบ pipeline รับ Timesheet เข้าระบบ — จุดที่ n8n เรียก
 *
 * ใส่ตัวอ่านไฟล์ปลอม (stub extractor) แทนโมเดล vision ในเครื่อง จึงรันได้โดยไม่ต้องเปิด LM Studio/Ollama
 * และไม่เสียค่า API — ทดสอบเฉพาะส่วนจับคู่ บันทึก คำนวณ และตัดสิน nextAction
 *
 * Ported from test/ingest.test.js (assertions preserved exactly เว้นที่คอมเมนต์กำกับไว้) — ต่างจาก
 * ต้นฉบับตรงที่ใช้ Postgres ตัวเทสต์ + fixture จาก helpers/testDb.ts แทน SQLite ชั่วคราว + seed.js
 * และฟังก์ชันฝั่ง service เป็น async ทั้งหมดแล้ว (Prisma)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@obs/db';

import { seedFixtures } from './helpers/testDb.js';
import { ingestTimesheet, NEXT_ACTION } from '../src/lib/ingestService.js';
import { listTimesheets, getTimesheet, markTimesheetChecked } from '../src/lib/timesheetsService.js';
import { previewCycleInvoice, readyCycles, listBillingCycles } from '../src/lib/cyclesService.js';
import { contractCycles } from '../src/lib/dashboardService.js';

/* กันไม่ให้ค่า LINE จริงจาก .env หลุดเข้ามา — ingestTimesheet() เรียก LINE จริงถ้าไม่ได้ส่ง client
   ปลอมมาให้ ถ้าไม่กันไว้จะยิงเข้า LINE จริง (เจอเองครั้งหนึ่งตอนเพิ่มฟีเจอร์นี้ในระบบเดิม) */
process.env.LINE_CHANNEL_ACCESS_TOKEN = '';
process.env.LINE_CHANNEL_SECRET = '';
process.env.LINE_APPROVER_TARGET = '';

await seedFixtures();

test.after(async () => {
  await prisma.$disconnect();
});

/**
 * สร้างผล extraction ปลอมของเดือน ก.พ. 2026
 * ก.พ. 2026 มี 28 วัน · วันที่ 1 เป็นวันอาทิตย์ · วันธรรมดา 20 วัน · ไม่มีวันหยุดนักขัตฤกษ์
 */
function fakeFebruary({ employeeName, position, leaveDates = [] }: {
  employeeName: string; position: string; leaveDates?: string[];
}) {
  const days = [];
  for (let d = 1; d <= 28; d += 1) {
    const date = `2026-02-${String(d).padStart(2, '0')}`;
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    const weekend = dow === 0 || dow === 6;
    const onLeave = leaveDates.includes(date);

    if (weekend) days.push({ date, timeIn: null, timeOut: null, label: 'Weekend', jobDescription: null });
    else if (onLeave) days.push({ date, timeIn: null, timeOut: null, label: 'Sick leave', jobDescription: null });
    else days.push({ date, timeIn: '8:30', timeOut: '17:00', label: null, jobDescription: 'งานตามที่ได้รับมอบหมาย' });
  }

  const workDays = days.filter((d) => d.timeIn).length;

  return {
    vendor: 'iPassion Co.,Ltd.',
    clientName: 'ThaiLife Insurance Public Co.,Ltd.',
    projectName: 'Outsource for BAU Project',
    employeeName,
    position,
    period: '2026-02',
    totalWorkDays: workDays,
    totalLeaveDays: leaveDates.length,
    days,
    leaveDays: leaveDates.map((date) => ({ date, type: 'sick', rawLabel: 'Sick leave' })),
    signedByEmployee: true,
    signedByProjectManager: true,
    notes: [],
  };
}

function stubExtractor(data: unknown) {
  return (async () => ({
    data,
    verification: { ok: true, issues: [] },
    usage: { input_tokens: 0, output_tokens: 0 },
    model: 'stub',
  })) as any;
}

/**
 * `IngestResult` ประกาศ `manday`/`matching`/`cycle` เป็น `unknown` (มีมาตั้งแต่พอร์ตรอบแรก) เทสต์นี้
 * เข้าถึงฟิลด์ข้างในตรงๆ เหมือนต้นฉบับ จึงต้อง cast ที่จุดใช้งาน — ทางแก้ที่ถูกจริงคือประกาศชนิดให้
 * ครบใน ingestService.ts แต่นั่นกระทบผู้เรียกหลายที่ ไม่ควรทำพ่วงมากับการพอร์ตเทสต์
 */
const f = (v: unknown): any => v;

/** จำนวน Timesheet ทั้งหมด — ต้นฉบับ listTimesheets() คืนอาร์เรย์ตรงๆ พอร์ตนี้คืน { items, counts } */
async function timesheetCount(): Promise<number> {
  return (await listTimesheets()).items.length;
}

test('รับ Timesheet คนแรกของรอบ → บันทึกได้ แต่ต้องรอคนที่เหลือ', async () => {
  const data = fakeFebruary({
    employeeName: 'Pongpun Mamak',
    position: 'Java Programmer',
    leaveDates: ['2026-02-17'],
  });

  const result = await ingestTimesheet({
    documentNo: '2026020101',
    fileBytes: Buffer.from('ไฟล์ปลอม'),
    fileName: 'Timesheet-Pongpun_022026.pdf',
    sourceEmailId: 'tli-approval-2026020101',
    receivedAt: '2026-03-01T08:40:00+07:00',
    approvedBy: 'Project Manager (TLI)',
    expectedPeriod: '2026-02',
    extractor: stubExtractor(data),
  });

  assert.equal(result.timesheetId, '2026020101');
  assert.equal(result.created, true);
  assert.equal(result.employee!.id, 'EMP-0042', 'จับคู่ "Pongpun Mamak" ได้');
  assert.equal(f(result.matching).name.kind, 'exact');
  assert.ok(f(result.matching).position.ok, '"Java Programmer" อยู่ในชื่อพ้องของตำแหน่ง');

  assert.equal(f(result.manday).standardWorkingDays, 20, 'ก.พ. 2026 มีวันทำงาน 20 วัน');
  assert.equal(f(result.manday).payableDays, 19);
  assert.equal(f(result.manday).dailyRate, 2647.2);
  assert.equal(f(result.manday).discount, 2647.2);
  assert.equal(f(result.manday).lineAmount, 50296.73);

  assert.equal(result.status, 'verified');
  assert.deepEqual(result.failures, []);
  assert.equal(
    result.nextAction,
    NEXT_ACTION.WAIT_FOR_OTHERS,
    'ยังได้แค่ 1 จาก 2 คน จึงยังวางบิลไม่ได้',
  );
  assert.equal(f(result.cycle).received, 1);
  assert.equal(f(result.cycle).expected, 2);
});

test('รับคนที่สองครบรอบ → บอกให้ n8n วางบิลได้', async () => {
  const data = fakeFebruary({
    employeeName: 'Sunee Maneekasemsuk',
    position: 'Senior Project Manager',
  });

  const result = await ingestTimesheet({
    documentNo: '2026020100',
    fileBytes: Buffer.from('ไฟล์ปลอม'),
    expectedPeriod: '2026-02',
    extractor: stubExtractor(data),
  });

  assert.equal(f(result.manday).payableDays, 20);
  assert.equal(f(result.manday).discount, 0);
  assert.equal(f(result.manday).lineAmount, 123420);
  assert.equal(result.nextAction, NEXT_ACTION.APPROVE_CYCLE);
  assert.equal(f(result.cycle).complete, true);
});

/**
 * ประตูของโหมด manual — เครื่องตรวจผ่านอย่างเดียวยังวางบิลไม่ได้
 * ต้องมีคนเปิดใบนั้นดูแล้วกดยืนยันก่อน (billing_rules.requireHumanCheck)
 */
test('ครบทุกคนแต่ยังไม่มีคนกดยืนยัน → ยังวางบิลไม่ได้', async () => {
  const preview = await previewCycleInvoice('CT-26B0113', '2026-02');

  assert.equal(preview.cycle.complete, true, 'ได้ Timesheet ครบทั้ง 2 คนแล้ว');
  assert.equal(
    preview.blockers.length, 2,
    'ทั้งสองใบยังไม่มีคนยืนยัน จึงติดคนละหนึ่งข้อ',
  );
  assert.ok(preview.blockers.every((b) => b.includes('ยังไม่มีคนกดยืนยัน')));

  const feb = (await contractCycles('CT-26B0113')).find((c) => c.period === '2026-02')!;
  assert.equal(feb.state, 'checking', 'สถานะรอบบิลต้องเป็น "รอคนตรวจ" ไม่ใช่ "รออนุมัติ"');
  assert.equal(feb.uncheckedCount, 2);

  assert.equal(
    (await readyCycles()).cycles.find((c) => c.period === '2026-02'),
    undefined,
    'n8n ตัวตั้งเวลาต้องยังไม่เห็นรอบนี้',
  );
});

test('คนกดยืนยันครบทุกใบ → รอบบิลพร้อมวางบิล', async () => {
  for (const id of ['2026020101', '2026020100']) {
    const result = (await markTimesheetChecked(id, { actor: 'ผู้ตรวจทดสอบ' }))!;
    assert.equal(result.check.checked, true);
    assert.equal(result.check.by, 'ผู้ตรวจทดสอบ');
  }

  const ready = await readyCycles();
  const feb = ready.cycles.find((c) => c.period === '2026-02');

  assert.ok(feb, 'รอบ ก.พ. 2026 ต้องพร้อมวางบิล');
  assert.equal(feb.canApprove, true);
  assert.equal(feb.headcount, 2);
  // 52,943.93 − 2,647.20 + 123,420.00 = 173,716.73 → +VAT −WHT
  assert.equal(feb.paymentAmount, 180665.4, 'ยอดเดียวกับรอบ ม.ค. เพราะลา 1 วันเหมือนกัน');
});

test('ยิงซ้ำ documentNo เดิม → เขียนทับ ไม่เกิดข้อมูลซ้ำ', async () => {
  const before = await timesheetCount();

  const data = fakeFebruary({
    employeeName: 'Pongpun Mamak',
    position: 'Java Programmer',
    leaveDates: ['2026-02-17', '2026-02-18'],   // แก้เป็นลา 2 วัน
  });

  const result = await ingestTimesheet({
    documentNo: '2026020101',
    fileBytes: Buffer.from('x'),
    expectedPeriod: '2026-02',
    extractor: stubExtractor(data),
  });

  assert.equal(result.created, false);
  assert.equal(result.replaced, true);
  assert.equal(await timesheetCount(), before, 'จำนวนรายการต้องไม่เพิ่ม');
  assert.equal(f(result.manday).leaveCount, 2);
  assert.equal(f(result.manday).discount, 5294.4, '2,647.20 × 2 วัน');
  assert.equal(f(result.manday).payableDays, 18);

  /* ใบนี้เคยมีคนกดยืนยันไปแล้วในเทสต์ก่อนหน้า พอส่งฉบับแก้มาทับจนยอดเปลี่ยน
     ตราที่ประทับไว้ต้องหมดอายุเอง ไม่งั้นจะมีคนอนุมัติยอดที่ไม่มีใครเคยดู */
  const sheet = (await getTimesheet('2026020101'))!;
  assert.equal(sheet.check.stale, true, 'ยอดเปลี่ยนแล้วตราต้องหมดอายุ');
  assert.equal(sheet.check.checked, false);

  const { blockers } = await previewCycleInvoice('CT-26B0113', '2026-02');
  assert.ok(
    blockers.some((b) => b.includes('ยอดเปลี่ยนหลังยืนยัน')),
    'รอบบิลต้องกลับไปติดที่ขั้นตรวจอีกครั้ง',
  );
});

test('ชื่อที่สะกดต่างเล็กน้อย → จับคู่ได้แบบ fuzzy พร้อมขอให้คนยืนยัน', async () => {
  const data = fakeFebruary({ employeeName: 'Pongpun Mamaak', position: 'Developer' });

  const result = await ingestTimesheet({
    documentNo: '2026020199',
    fileBytes: Buffer.from('x'),
    expectedPeriod: '2026-02',
    extractor: stubExtractor(data),
  });

  assert.equal(result.employee!.id, 'EMP-0042');
  assert.equal(f(result.matching).name.kind, 'fuzzy');
  assert.match(f(result.matching).name.reason, /ยืนยัน/);
});

test('ชื่อที่ไม่มีในระบบ → ไม่บันทึก และบอกให้ไปเพิ่มชื่อพ้อง', async () => {
  const before = await timesheetCount();
  const data = fakeFebruary({ employeeName: 'Somchai Saikod', position: 'Developer' });

  const result = await ingestTimesheet({
    documentNo: '2026020999',
    fileBytes: Buffer.from('x'),
    expectedPeriod: '2026-02',
    extractor: stubExtractor(data),
  });

  assert.equal(result.timesheetId, null);
  assert.equal(result.created, false);
  assert.equal(result.nextAction, NEXT_ACTION.NEEDS_MATCH);
  assert.match(result.reason!, /ไม่พบ/);
  assert.equal(await timesheetCount(), before, 'ต้องไม่บันทึกอะไรลงฐานข้อมูล');
});

class FakeLineClient {
  sent: string[] = [];
  flex: any[] = [];
  async pushPlainText(text: string) { this.sent.push(text); return { sentTo: 'fake-target' }; }
  async pushNeedsCheck(message: any) { this.flex.push(message); return { sentTo: 'fake-target' }; }
}

/** ข้อความทุกบรรทัดในบับเบิล — ใช้เช็คว่าเลขเอกสาร/เดือนโผล่ในนั้นจริง โดยไม่ต้องไล่โครง JSON เอง */
function bubbleTexts(bubble: unknown): string[] {
  const out: string[] = [];
  const walk = (node: any) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object') return;
    if (node.type === 'text' && node.text) out.push(node.text);
    if (node.action?.label) out.push(node.action.label);
    for (const value of Object.values(node)) if (typeof value === 'object') walk(value);
  };
  walk(bubble);
  return out;
}

test('Timesheet ที่ตัวเลขไม่ตรงปฏิทิน → ไม่บล็อกอีกต่อไป (workday_sum เป็น WARN) แต่ยังทักไว้ให้เห็น', async () => {
  const data = fakeFebruary({ employeeName: 'Pongpun Mamak', position: 'Developer' });
  data.totalWorkDays = 25;          // รายงานเกินจริง — เช่นทำงานเสาร์-อาทิตย์/OT จริง

  const line = new FakeLineClient();
  const result = await ingestTimesheet({
    documentNo: '2026020102',
    fileBytes: Buffer.from('x'),
    expectedPeriod: '2026-02',
    extractor: stubExtractor(data),
    client: line as any,
  });

  assert.equal(result.status, 'verified');
  assert.notEqual(result.nextAction, NEXT_ACTION.FIX_MISMATCH);
  assert.equal(result.failures!.length, 0, 'workday_sum ไม่ใช่ FAIL แล้ว จึงไม่มีในรายการ failures');

  assert.equal(line.sent.length, 0, 'ต้องไม่ใช่ข้อความ "ตรวจไม่ผ่าน" แบบเดิมอีกแล้ว');
  assert.equal(line.flex.length, 1, 'ยังต้องแจ้ง LINE ตามปกติ (สรุปคิวที่รอตรวจแบบบับเบิล) แม้ตัวเลขไม่ตรงปฏิทิน');
});

test('Timesheet ที่ตรวจผ่าน → แจ้ง LINE เฉพาะใบนี้ใบเดียว (ไม่ใช่ข้อความตรวจไม่ผ่าน)', async () => {
  const data = fakeFebruary({ employeeName: 'Pongpun Mamak', position: 'Developer' });

  const line = new FakeLineClient();
  const result = await ingestTimesheet({
    documentNo: '2026020103',
    fileBytes: Buffer.from('x'),
    expectedPeriod: '2026-02',
    extractor: stubExtractor(data),
    client: line as any,
  });

  assert.notEqual(result.nextAction, NEXT_ACTION.FIX_MISMATCH);
  assert.equal(line.sent.length, 0, 'ต้องไม่ใช่ข้อความเปล่าๆ — ของรอตรวจส่งเป็นบับเบิลที่มีปุ่ม');
  assert.equal(line.flex.length, 1, 'ตรวจผ่านแล้วก็ยังต้องแจ้งว่ามีของใหม่รอคนกดยืนยัน');

  const message = line.flex[0];
  // แจ้งทีละใบต่อการแจ้งเตือนหนึ่งครั้ง (31 ส.ค. 69 ตามที่ขอ) — ไม่รวมยอดทั้งคิวเหมือนเดิมอีกแล้ว
  assert.match(
    message.altText, /ตรวจ Manday — .*2026020103.*กุมภาพันธ์ 2569/,
    'altText ต้องอ่านรู้เรื่องบนหน้า lock screen และบอกได้ว่าเป็นใบไหน',
  );
  assert.equal(message.bubbles.length, 1, 'แจ้งเตือนหนึ่งครั้งต้องมีแค่บับเบิลเดียวของใบนี้');

  const texts = message.bubbles.flatMap(bubbleTexts);
  assert.ok(texts.includes('ตรวจ Manday'), 'หัวบับเบิลต้องเป็น "ตรวจ Manday"');
  assert.ok(texts.includes('2026020103'), 'ต้องมีเลขเอกสารของใบที่เพิ่งเข้ามา');
  assert.ok(texts.some((t: string) => t.includes('บริษัท ไทยประกันชีวิต')), 'ต้องบอกด้วยว่าเป็นของลูกค้าราย');
  assert.ok(texts.some((t: string) => t.includes('กุมภาพันธ์ 2569')), 'ต้องบอกรอบเดือน');
  assert.ok(
    !texts.some((t: string) => t.includes('ไม่ผ่าน')),
    'ต้องเป็นบับเบิล "รอตรวจ" ไม่ใช่ข้อความตรวจไม่ผ่านของ notifyCheckFailed',
  );
});

test('บับเบิลรอตรวจมีแค่ใบเดียว และปุ่มพาเข้าหน้ารายละเอียดใบนั้นตรงๆ', async () => {
  // เจ้าของระบบสั่ง 24 ก.ย. 69 ("กด filter จากการแจ้งเตือนแล้วไม่พาไปหน้าปลายทางที่ควรไป") — เดิมปุ่มนี้
  // พาไปหน้ารายการทั้งหมด `/manday` (queueLink()) ทั้งที่ข้อความพูดถึงเอกสารใบเดียวเป๊ะๆ แก้ให้พาเข้า
  // `/manday/<documentNo>` ตรงๆ แทน (documentNo คือ timesheet.id อยู่แล้ว) ดู documentLink() ใน
  // cyclesService.ts
  const before = process.env.WEB_BASE_URL;
  process.env.WEB_BASE_URL = 'https://obs.example.com/';

  try {
    const line = new FakeLineClient();
    await ingestTimesheet({
      documentNo: '2026020104',
      fileBytes: Buffer.from('x'),
      expectedPeriod: '2026-02',
      extractor: stubExtractor(fakeFebruary({ employeeName: 'Sunee Maneekasemsuk', position: 'Senior Project Manager' })),
      client: line as any,
    });

    const { bubbles } = line.flex[0];
    // แจ้งทีละใบต่อการแจ้งเตือนหนึ่งครั้ง (31 ส.ค. 69) — ไม่รวมของค้างเก่าเข้าบับเบิลเดียวกันอีกแล้ว
    assert.equal(bubbles.length, 1, 'แจ้งเตือนหนึ่งครั้งต้องมีแค่บับเบิลเดียวของใบนี้');

    const button = bubbles[0].footer.contents[0];
    assert.equal(button.action.type, 'uri', 'ต้องเป็นปุ่มเปิดเว็บ ไม่ใช่ลิงก์เปล่าในข้อความ');
    assert.equal(button.action.label, 'ตรวจ Manday');
    assert.equal(button.action.uri, 'https://obs.example.com/manday/2026020104');
  } finally {
    if (before === undefined) delete process.env.WEB_BASE_URL;
    else process.env.WEB_BASE_URL = before;
  }
});

test('ไม่ตั้ง WEB_BASE_URL → บับเบิลยังส่งได้ แค่ไม่มีปุ่มให้กด', async () => {
  const before = process.env.WEB_BASE_URL;
  delete process.env.WEB_BASE_URL;

  try {
    const line = new FakeLineClient();
    await ingestTimesheet({
      documentNo: '2026020105',
      fileBytes: Buffer.from('x'),
      expectedPeriod: '2026-02',
      extractor: stubExtractor(fakeFebruary({ employeeName: 'Pongpun Mamak', position: 'Developer' })),
      client: line as any,
    });

    const { bubbles } = line.flex[0];
    assert.equal(bubbles[0].footer, undefined, 'ไม่มีปุ่มก็ต้องไม่มี footer เลย — LINE ไม่รับ footer ที่ contents ว่าง');
    assert.ok(bubbleTexts(bubbles[0]).includes('2026020105'), 'เนื้อหายังต้องครบเหมือนเดิม');
  } finally {
    if (before !== undefined) process.env.WEB_BASE_URL = before;
  }
});

test('เอกสารที่วางบิลแล้ว → ไม่เขียนทับ', async () => {
  const data = fakeFebruary({ employeeName: 'Pongpun Mamak', position: 'Developer' });

  // รอบ ม.ค. ในข้อมูลตั้งต้นยังไม่ได้วางบิล จึงจำลองว่าวางบิลแล้ว
  await prisma.timesheet.update({ where: { id: '2026010091' }, data: { status: 'billed' } });

  const result = await ingestTimesheet({
    documentNo: '2026010091',
    fileBytes: Buffer.from('x'),
    extractor: stubExtractor(data),
  });

  assert.equal(result.nextAction, NEXT_ACTION.ALREADY_BILLED);
  assert.equal(result.created, false);
});

test('รอบที่วางบิลแล้ว ส่งใบใหม่มาด้วยเลขที่เอกสารคนละเลข → ต้องปฏิเสธเหมือนกัน ไม่ใช่แค่กันเขียนทับเลขเดิม', async () => {
  const data = fakeFebruary({ employeeName: 'Pongpun Mamak', position: 'Developer' });

  // ใบ 2026020101 (รอบ ก.พ. ของพนักงานคนเดียวกัน สร้างไว้แล้วในเทสต์ก่อนหน้า) จำลองว่าวางบิลไปแล้ว
  await prisma.timesheet.update({ where: { id: '2026020101' }, data: { status: 'billed' } });

  const before = await timesheetCount();
  const result = await ingestTimesheet({
    documentNo: '2026020199',   // เลขที่เอกสารใหม่ ไม่ใช่ 2026020101 — จำลอง n8n ยิงซ้ำด้วยเลขต่างออกไป
    fileBytes: Buffer.from('x'),
    extractor: stubExtractor(data),
  });

  assert.equal(result.nextAction, NEXT_ACTION.ALREADY_BILLED);
  assert.equal(result.created, false);
  assert.equal(result.timesheetId, null);
  assert.equal(await timesheetCount(), before, 'ต้องไม่มีแถวใหม่เกิดขึ้น');
});

test('ไม่ส่ง documentNo มาเลย → ปฏิเสธพร้อมบอกเหตุผล', async () => {
  // ต้นฉบับเช็คสองอย่าง: ต้องมี documentNo และต้องมี filePath/fileBase64 อย่างใดอย่างหนึ่ง
  // พอร์ตนี้เหลือเช็ค documentNo อย่างเดียว เพราะ `filePath` ถูกตัดทิ้งตั้งแต่ Phase 5.6 (n8n กับ
  // คอนเทนเนอร์ไม่ได้แชร์ filesystem กัน) ส่วน "ไม่มีไฟล์" ย้ายไปเป็นหน้าที่ของ extractor แทน —
  // extractTimesheet() โยน 'ต้องมีไฟล์ PDF ให้อ่าน' เองถ้าได้ค่าที่ไม่ใช่ Buffer (เทสต์ด้านล่าง)
  await assert.rejects(
    () => ingestTimesheet({ fileBytes: Buffer.from('x'), extractor: stubExtractor({}) } as any),
    /documentNo/,
  );
});

test('extractor ตัวจริงปฏิเสธเองถ้าไม่ได้ไฟล์ PDF มา', async () => {
  const { extractTimesheet } = await import('../src/lib/extractionService.js');
  await assert.rejects(() => extractTimesheet(null, {}), /ต้องมีไฟล์ PDF ให้อ่าน/);
});

/**
 * กันการพังเงียบซ้ำ — หน้ารอบบิลอ่านฟิลด์เหล่านี้ตรงๆ
 * ถ้าขาดตัวใดตัวหนึ่ง หน้าจะขึ้น "undefined" โดยไม่มี error ให้เห็น
 * เคยเกิดขึ้นจริงตอนแยก billingCycles() ออกมาจาก dashboard() แล้วตัดฟิลด์ทิ้ง
 *
 * ต้นฉบับเรียก `billingCycles()` — พอร์ตนี้ชื่อ `listBillingCycles()` คืนรูปเดียวกัน
 */
test('listBillingCycles() ส่งฟิลด์ครบตามที่หน้ารอบบิลใช้', async () => {
  const data = await listBillingCycles();

  assert.ok(data.contracts.length > 0, 'ต้องมีสัญญาอย่างน้อยหนึ่งฉบับ');
  for (const ct of data.contracts) {
    for (const field of ['poNo', 'customerName', 'projectName', 'startDate', 'endDate'] as const) {
      assert.ok(ct[field], `หัวการ์ดต้องมี ${field}`);
    }
    for (const field of ['monthsTotal', 'monthsBilled', 'contractValue',
                         'billedValue', 'remainingValue', 'progress'] as const) {
      assert.equal(typeof ct[field], 'number', `${field} ต้องเป็นตัวเลข ไม่ใช่ undefined`);
    }
    assert.equal(ct.remainingValue, ct.contractValue - ct.billedValue,
      'คงเหลือต้องเท่ากับมูลค่าสัญญาหักที่วางบิลแล้ว');
  }

  assert.ok(data.cycles.length > 0, 'ต้องมีรอบบิล');
  for (const field of ['contractId', 'period', 'periodLabel', 'state', 'stateLabel',
                       'expected', 'received', 'expectedBillDate'] as const) {
    assert.ok((data.cycles[0] as any)[field] !== undefined, `ตารางรอบบิลต้องมี ${field}`);
  }
});

test('มูลค่าสัญญาใน listBillingCycles() ตรงกับยอดในใบว่าจ้าง 26/B0113', async () => {
  const ct = (await listBillingCycles()).contracts.find((c) => c.poNo === '26/B0113');
  assert.ok(ct, 'ต้องพบสัญญา 26/B0113');
  assert.equal(ct.monthsTotal, 6, 'สัญญา 6 เดือน (ม.ค.–มิ.ย. 69)');
  assert.equal(ct.contractValue, 1058183.58, 'ยอดรวมก่อนภาษีในใบว่าจ้าง');
});

/**
 * ลาไม่เต็มวัน (ครึ่งวัน/เป็นชั่วโมง) — 24 ก.ย. 69 ตามที่ขอ ยืนยันจาก HRDD จริงว่าส่ง amountDay/
 * amountHour แยกกันมาให้ ไม่ใช่หน่วยวันอย่างเดียว ทดสอบ end-to-end ว่า `hours` ที่ส่งมาใน leaveDays
 * ตอน ingest ถูกเก็บลง `leave_days.hours` จริง (ไม่ใช่แค่ที่ชั้นคำนวณล้วนใน @obs/domain ที่เทสต์แยกไว้แล้ว
 * ใน packages/domain/test/manday.test.ts) และคำนวณส่วนลดตามสัดส่วน ไม่ใช่หักเต็มวัน — ใช้รอบ เม.ย. 69
 * (ยังไม่มีเทสต์ไหนแตะรอบนี้มาก่อนในไฟล์นี้ จึงไม่ชนกับสถานะที่เทสต์ก่อนหน้าทำไว้)
 */
function fakeAprilWithLeave({ employeeName, position, leaveEntries }: {
  employeeName: string; position: string; leaveEntries: Array<{ date: string; hours?: number | null }>;
}) {
  const leaveByDate = new Map(leaveEntries.map((l) => [l.date, l.hours ?? null]));
  const days = [];
  for (let d = 1; d <= 30; d += 1) {
    const date = `2026-04-${String(d).padStart(2, '0')}`;
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    const weekend = dow === 0 || dow === 6;
    const onLeave = leaveByDate.has(date);

    if (weekend) days.push({ date, timeIn: null, timeOut: null, label: 'Weekend', jobDescription: null });
    else if (onLeave) days.push({ date, timeIn: null, timeOut: null, label: 'Sick leave', jobDescription: null });
    else days.push({ date, timeIn: '8:30', timeOut: '17:00', label: null, jobDescription: 'งานตามที่ได้รับมอบหมาย' });
  }

  const workDays = days.filter((d) => d.timeIn).length;

  return {
    vendor: 'iPassion Co.,Ltd.',
    clientName: 'ThaiLife Insurance Public Co.,Ltd.',
    projectName: 'Outsource for BAU Project',
    employeeName,
    position,
    period: '2026-04',
    totalWorkDays: workDays,
    totalLeaveDays: leaveEntries.length,
    days,
    leaveDays: leaveEntries.map((l) => ({ date: l.date, type: 'sick', rawLabel: 'Sick leave', hours: l.hours ?? null })),
    signedByEmployee: true,
    signedByProjectManager: true,
    notes: [],
  };
}

test('ลาครึ่งวัน (hours: 4) ตอน ingest → เก็บ leave_days.hours จริง และหักเงินแค่ครึ่งวัน ไม่ใช่เต็มวัน', async () => {
  const data = fakeAprilWithLeave({
    employeeName: 'Pongpun Mamak',
    position: 'Developer',
    leaveEntries: [{ date: '2026-04-09', hours: 4 }],
  });

  const result = await ingestTimesheet({
    documentNo: '2026040199',
    fileBytes: Buffer.from('ไฟล์ปลอม'),
    expectedPeriod: '2026-04',
    extractor: stubExtractor(data),
  });

  assert.equal(result.created, true);
  assert.equal(f(result.manday).leaveCount, 0.5, 'ลา 4 ชม. จาก 8 ชม. = ครึ่งวัน');
  assert.equal(f(result.manday).discount, 1323.6, '2,647.20 × 0.5 = 1,323.60 — หักครึ่งเดียว ไม่ใช่เต็ม 2,647.20');

  const rows = await prisma.leaveDay.findMany({ where: { timesheetId: result.timesheetId! } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].hours, 4, 'ต้องเก็บจำนวนชั่วโมงจริงลง DB ไม่ใช่ null (ซึ่งจะแปลว่าลาเต็มวัน)');

  const sheet = (await getTimesheet(result.timesheetId!))!;
  assert.equal(sheet.leaveDays[0].hours, 4, 'อ่านกลับผ่าน getTimesheet() ต้องเห็นชั่วโมงเดียวกัน');
});

test('ลาเต็มวัน (ไม่ส่ง hours) ตอน ingest → leave_days.hours เป็น null เหมือนพฤติกรรมเดิมทุกประการ', async () => {
  const data = fakeAprilWithLeave({
    employeeName: 'Sunee Maneekasemsuk',
    position: 'Senior Project Manager',
    leaveEntries: [{ date: '2026-04-09' }],
  });

  const result = await ingestTimesheet({
    documentNo: '2026040198',
    fileBytes: Buffer.from('ไฟล์ปลอม'),
    expectedPeriod: '2026-04',
    extractor: stubExtractor(data),
  });

  assert.equal(f(result.manday).leaveCount, 1);

  const rows = await prisma.leaveDay.findMany({ where: { timesheetId: result.timesheetId! } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].hours, null);
});
