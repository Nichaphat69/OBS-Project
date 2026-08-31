/**
 * ทดสอบ pipeline รับ Timesheet เข้าระบบ — จุดที่ n8n เรียก
 *
 * ใส่ตัวอ่านไฟล์ปลอม (stub extractor) แทนโมเดล vision ในเครื่อง จึงรันได้โดยไม่ต้องเปิด LM Studio/Ollama
 * และไม่เสียค่า API — ทดสอบเฉพาะส่วนจับคู่ บันทึก คำนวณ และตัดสิน nextAction
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const DB = join(tmpdir(), `obs-ingest-test-${process.pid}.sqlite`);
process.env.DB_PATH = DB;

/* กันไม่ให้ env.js โหลดค่า LINE จริงจาก .env เข้ามา — ingestTimesheet() เรียก LINE จริงถ้า Manday
   ไม่ผ่านตรวจ (ข้อ 2.6) เทสต์ 'fix_mismatch' ด้านล่างจงใจทำให้ไม่ผ่าน ถ้าไม่กันไว้จะยิงเข้า LINE จริง
   (เจอเองครั้งหนึ่งตอนเพิ่มฟีเจอร์นี้ — ต้องกันไว้ก่อน seed.js import env.js) */
process.env.LINE_CHANNEL_ACCESS_TOKEN = '';
process.env.LINE_CHANNEL_SECRET = '';
process.env.LINE_APPROVER_TARGET = '';

// seed.js ทำงานตอน import — ใส่ข้อมูลจากเอกสารจริงลงฐานข้อมูลชั่วคราว
await import('../src/db/seed.js');
const svc = await import('../src/service.js');
const { closeDb } = await import('../src/db/index.js');

test.after(() => {
  closeDb();
  for (const suffix of ['', '-wal', '-shm']) {
    try { rmSync(DB + suffix); } catch { /* ไม่มีไฟล์ก็ข้าม */ }
  }
});

/**
 * สร้างผล extraction ปลอมของเดือน ก.พ. 2026
 * ก.พ. 2026 มี 28 วัน · วันที่ 1 เป็นวันอาทิตย์ · วันธรรมดา 20 วัน · ไม่มีวันหยุดนักขัตฤกษ์
 */
function fakeFebruary({ employeeName, position, leaveDates = [] }) {
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

function stubExtractor(data) {
  return async () => ({
    data,
    verification: { ok: true, issues: [] },
    usage: { input_tokens: 0, output_tokens: 0 },
    model: 'stub',
  });
}

test('รับ Timesheet คนแรกของรอบ → บันทึกได้ แต่ต้องรอคนที่เหลือ', async () => {
  const data = fakeFebruary({
    employeeName: 'Pongpun Mamak',
    position: 'Java Programmer',
    leaveDates: ['2026-02-17'],
  });

  const result = await svc.ingestTimesheet({
    documentNo: '2026020101',
    fileBase64: Buffer.from('ไฟล์ปลอม').toString('base64'),
    fileName: 'Timesheet-Pongpun_022026.pdf',
    sourceEmailId: 'tli-approval-2026020101',
    receivedAt: '2026-03-01T08:40:00+07:00',
    approvedBy: 'Project Manager (TLI)',
    expectedPeriod: '2026-02',
    extractor: stubExtractor(data),
  });

  assert.equal(result.timesheetId, '2026020101');
  assert.equal(result.created, true);
  assert.equal(result.employee.id, 'EMP-0042', 'จับคู่ "Pongpun Mamak" ได้');
  assert.equal(result.matching.name.kind, 'exact');
  assert.ok(result.matching.position.ok, '"Java Programmer" อยู่ในชื่อพ้องของตำแหน่ง');

  assert.equal(result.manday.standardWorkingDays, 20, 'ก.พ. 2026 มีวันทำงาน 20 วัน');
  assert.equal(result.manday.payableDays, 19);
  assert.equal(result.manday.dailyRate, 2647.2);
  assert.equal(result.manday.discount, 2647.2);
  assert.equal(result.manday.lineAmount, 50296.73);

  assert.equal(result.status, 'verified');
  assert.deepEqual(result.failures, []);
  assert.equal(
    result.nextAction,
    svc.NEXT_ACTION.WAIT_FOR_OTHERS,
    'ยังได้แค่ 1 จาก 2 คน จึงยังวางบิลไม่ได้',
  );
  assert.equal(result.cycle.received, 1);
  assert.equal(result.cycle.expected, 2);
});

test('รับคนที่สองครบรอบ → บอกให้ n8n วางบิลได้', async () => {
  const data = fakeFebruary({
    employeeName: 'Sunee Maneekasemsuk',
    position: 'Senior Project Manager',
  });

  const result = await svc.ingestTimesheet({
    documentNo: '2026020100',
    fileBase64: Buffer.from('ไฟล์ปลอม').toString('base64'),
    expectedPeriod: '2026-02',
    extractor: stubExtractor(data),
  });

  assert.equal(result.manday.payableDays, 20);
  assert.equal(result.manday.discount, 0);
  assert.equal(result.manday.lineAmount, 123420);
  assert.equal(result.nextAction, svc.NEXT_ACTION.APPROVE_CYCLE);
  assert.equal(result.cycle.complete, true);
});

/**
 * ประตูของโหมด manual — เครื่องตรวจผ่านอย่างเดียวยังวางบิลไม่ได้
 * ต้องมีคนเปิดใบนั้นดูแล้วกดยืนยันก่อน (billing_rules.requireHumanCheck)
 */
test('ครบทุกคนแต่ยังไม่มีคนกดยืนยัน → ยังวางบิลไม่ได้', () => {
  const preview = svc.previewCycleInvoice('CT-26B0113', '2026-02');

  assert.equal(preview.cycle.complete, true, 'ได้ Timesheet ครบทั้ง 2 คนแล้ว');
  assert.equal(
    preview.blockers.length, 2,
    'ทั้งสองใบยังไม่มีคนยืนยัน จึงติดคนละหนึ่งข้อ',
  );
  assert.ok(preview.blockers.every((b) => b.includes('ยังไม่มีคนกดยืนยัน')));

  const feb = svc.contractCycles('CT-26B0113').find((c) => c.period === '2026-02');
  assert.equal(feb.state, 'checking', 'สถานะรอบบิลต้องเป็น "รอคนตรวจ" ไม่ใช่ "รออนุมัติ"');
  assert.equal(feb.uncheckedCount, 2);

  assert.equal(
    svc.readyCycles().cycles.find((c) => c.period === '2026-02'),
    undefined,
    'n8n ตัวตั้งเวลาต้องยังไม่เห็นรอบนี้',
  );
});

test('คนกดยืนยันครบทุกใบ → รอบบิลพร้อมวางบิล', () => {
  for (const id of ['2026020101', '2026020100']) {
    const result = svc.markTimesheetChecked(id, { actor: 'ผู้ตรวจทดสอบ' });
    assert.equal(result.check.checked, true);
    assert.equal(result.check.by, 'ผู้ตรวจทดสอบ');
  }

  const ready = svc.readyCycles();
  const feb = ready.cycles.find((c) => c.period === '2026-02');

  assert.ok(feb, 'รอบ ก.พ. 2026 ต้องพร้อมวางบิล');
  assert.equal(feb.canApprove, true);
  assert.equal(feb.headcount, 2);
  // 52,943.93 − 2,647.20 + 123,420.00 = 173,716.73 → +VAT −WHT
  assert.equal(feb.paymentAmount, 180665.4, 'ยอดเดียวกับรอบ ม.ค. เพราะลา 1 วันเหมือนกัน');
});

test('ยิงซ้ำ documentNo เดิม → เขียนทับ ไม่เกิดข้อมูลซ้ำ', async () => {
  const before = svc.listTimesheets().length;

  const data = fakeFebruary({
    employeeName: 'Pongpun Mamak',
    position: 'Java Programmer',
    leaveDates: ['2026-02-17', '2026-02-18'],   // แก้เป็นลา 2 วัน
  });

  const result = await svc.ingestTimesheet({
    documentNo: '2026020101',
    fileBase64: Buffer.from('x').toString('base64'),
    expectedPeriod: '2026-02',
    extractor: stubExtractor(data),
  });

  assert.equal(result.created, false);
  assert.equal(result.replaced, true);
  assert.equal(svc.listTimesheets().length, before, 'จำนวนรายการต้องไม่เพิ่ม');
  assert.equal(result.manday.leaveCount, 2);
  assert.equal(result.manday.discount, 5294.4, '2,647.20 × 2 วัน');
  assert.equal(result.manday.payableDays, 18);

  /* ใบนี้เคยมีคนกดยืนยันไปแล้วในเทสต์ก่อนหน้า พอส่งฉบับแก้มาทับจนยอดเปลี่ยน
     ตราที่ประทับไว้ต้องหมดอายุเอง ไม่งั้นจะมีคนอนุมัติยอดที่ไม่มีใครเคยดู */
  const sheet = svc.getTimesheet('2026020101');
  assert.equal(sheet.check.stale, true, 'ยอดเปลี่ยนแล้วตราต้องหมดอายุ');
  assert.equal(sheet.check.checked, false);

  const blockers = svc.previewCycleInvoice('CT-26B0113', '2026-02').blockers;
  assert.ok(
    blockers.some((b) => b.includes('ยอดเปลี่ยนหลังยืนยัน')),
    'รอบบิลต้องกลับไปติดที่ขั้นตรวจอีกครั้ง',
  );
});

test('ชื่อที่สะกดต่างเล็กน้อย → จับคู่ได้แบบ fuzzy พร้อมขอให้คนยืนยัน', async () => {
  const data = fakeFebruary({ employeeName: 'Pongpun Mamaak', position: 'Developer' });

  const result = await svc.ingestTimesheet({
    documentNo: '2026020199',
    fileBase64: Buffer.from('x').toString('base64'),
    expectedPeriod: '2026-02',
    extractor: stubExtractor(data),
  });

  assert.equal(result.employee.id, 'EMP-0042');
  assert.equal(result.matching.name.kind, 'fuzzy');
  assert.match(result.matching.name.reason, /ยืนยัน/);
});

test('ชื่อที่ไม่มีในระบบ → ไม่บันทึก และบอกให้ไปเพิ่มชื่อพ้อง', async () => {
  const before = svc.listTimesheets().length;
  const data = fakeFebruary({ employeeName: 'Somchai Saikod', position: 'Developer' });

  const result = await svc.ingestTimesheet({
    documentNo: '2026020999',
    fileBase64: Buffer.from('x').toString('base64'),
    expectedPeriod: '2026-02',
    extractor: stubExtractor(data),
  });

  assert.equal(result.timesheetId, null);
  assert.equal(result.created, false);
  assert.equal(result.nextAction, svc.NEXT_ACTION.NEEDS_MATCH);
  assert.match(result.reason, /ไม่พบ/);
  assert.equal(svc.listTimesheets().length, before, 'ต้องไม่บันทึกอะไรลงฐานข้อมูล');
});

class FakeLineClient {
  constructor() { this.sent = []; this.flex = []; }
  async pushPlainText(text) { this.sent.push(text); return { sentTo: 'fake-target' }; }
  async pushNeedsCheck(message) { this.flex.push(message); return { sentTo: 'fake-target' }; }
}

/** ข้อความทุกบรรทัดในบับเบิล — ใช้เช็คว่าเลขเอกสาร/เดือนโผล่ในนั้นจริง โดยไม่ต้องไล่โครง JSON เอง */
function bubbleTexts(bubble) {
  const out = [];
  const walk = (node) => {
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
  const result = await svc.ingestTimesheet({
    documentNo: '2026020102',
    fileBase64: Buffer.from('x').toString('base64'),
    expectedPeriod: '2026-02',
    extractor: stubExtractor(data),
    lineClient: line,
  });

  assert.equal(result.status, 'verified');
  assert.notEqual(result.nextAction, svc.NEXT_ACTION.FIX_MISMATCH);
  assert.equal(result.failures.length, 0, 'workday_sum ไม่ใช่ FAIL แล้ว จึงไม่มีในรายการ failures');

  assert.equal(line.sent.length, 0, 'ต้องไม่ใช่ข้อความ "ตรวจไม่ผ่าน" แบบเดิมอีกแล้ว');
  assert.equal(line.flex.length, 1, 'ยังต้องแจ้ง LINE ตามปกติ (สรุปคิวที่รอตรวจแบบบับเบิล) แม้ตัวเลขไม่ตรงปฏิทิน');
});

test('Timesheet ที่ตรวจผ่าน → แจ้ง LINE เฉพาะใบนี้ใบเดียว (ไม่ใช่ข้อความตรวจไม่ผ่าน)', async () => {
  const data = fakeFebruary({ employeeName: 'Pongpun Mamak', position: 'Developer' });

  const line = new FakeLineClient();
  const result = await svc.ingestTimesheet({
    documentNo: '2026020103',
    fileBase64: Buffer.from('x').toString('base64'),
    expectedPeriod: '2026-02',
    extractor: stubExtractor(data),
    lineClient: line,
  });

  assert.notEqual(result.nextAction, svc.NEXT_ACTION.FIX_MISMATCH);
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
  assert.ok(texts.some((t) => t.includes('บริษัท ไทยประกันชีวิต')), 'ต้องบอกด้วยว่าเป็นของลูกค้าราย');
  assert.ok(texts.some((t) => t.includes('กุมภาพันธ์ 2569')), 'ต้องบอกรอบเดือน');
  assert.ok(
    !texts.some((t) => t.includes('ไม่ผ่าน')),
    'ต้องเป็นบับเบิล "รอตรวจ" ไม่ใช่ข้อความตรวจไม่ผ่านของ notifyCheckFailed',
  );
});

test('บับเบิลรอตรวจมีแค่ใบเดียว และปุ่มพาเข้าหน้าตรวจ Manday แนบ contractId ของสัญญานั้นไปด้วย', async () => {
  const before = process.env.APP_BASE_URL;
  process.env.APP_BASE_URL = 'https://obs.example.com/';

  try {
    const line = new FakeLineClient();
    await svc.ingestTimesheet({
      documentNo: '2026020104',
      fileBase64: Buffer.from('x').toString('base64'),
      expectedPeriod: '2026-02',
      extractor: stubExtractor(fakeFebruary({ employeeName: 'Sunee Maneekasemsuk', position: 'Senior Project Manager' })),
      lineClient: line,
    });

    const { bubbles } = line.flex[0];
    // แจ้งทีละใบต่อการแจ้งเตือนหนึ่งครั้ง (31 ส.ค. 69) — ไม่รวมของค้างเก่าเข้าบับเบิลเดียวกันอีกแล้ว
    assert.equal(bubbles.length, 1, 'แจ้งเตือนหนึ่งครั้งต้องมีแค่บับเบิลเดียวของใบนี้');

    const button = bubbles[0].footer.contents[0];
    assert.equal(button.action.type, 'uri', 'ต้องเป็นปุ่มเปิดเว็บ ไม่ใช่ลิงก์เปล่าในข้อความ');
    assert.equal(button.action.label, 'ตรวจ Manday');
    assert.equal(
      button.action.uri, 'https://obs.example.com/?view=queue&contract=CT-26B0113',
      'ต้องแนบ contractId ของสัญญานี้ไปด้วย ให้เว็บสลับบริษัทที่กำลังดำเนินการอยู่ให้ตรงกันตอนกดเข้ามา',
    );
  } finally {
    if (before === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = before;
  }
});

test('ไม่ตั้ง APP_BASE_URL → บับเบิลยังส่งได้ แค่ไม่มีปุ่มให้กด', async () => {
  const before = process.env.APP_BASE_URL;
  delete process.env.APP_BASE_URL;

  try {
    const line = new FakeLineClient();
    await svc.ingestTimesheet({
      documentNo: '2026020105',
      fileBase64: Buffer.from('x').toString('base64'),
      expectedPeriod: '2026-02',
      extractor: stubExtractor(fakeFebruary({ employeeName: 'Pongpun Mamak', position: 'Developer' })),
      lineClient: line,
    });

    const { bubbles } = line.flex[0];
    assert.equal(bubbles[0].footer, undefined, 'ไม่มีปุ่มก็ต้องไม่มี footer เลย — LINE ไม่รับ footer ที่ contents ว่าง');
    assert.ok(bubbleTexts(bubbles[0]).includes('2026020105'), 'เนื้อหายังต้องครบเหมือนเดิม');
  } finally {
    if (before !== undefined) process.env.APP_BASE_URL = before;
  }
});

test('เอกสารที่วางบิลแล้ว → ไม่เขียนทับ', async () => {
  const data = fakeFebruary({ employeeName: 'Pongpun Mamak', position: 'Developer' });

  // รอบ ม.ค. ในข้อมูลตั้งต้นยังไม่ได้วางบิล จึงจำลองว่าวางบิลแล้ว
  const { run } = await import('../src/db/index.js');
  run("UPDATE timesheets SET status = 'billed' WHERE id = '2026010091'");

  const result = await svc.ingestTimesheet({
    documentNo: '2026010091',
    fileBase64: Buffer.from('x').toString('base64'),
    extractor: stubExtractor(data),
  });

  assert.equal(result.nextAction, svc.NEXT_ACTION.ALREADY_BILLED);
  assert.equal(result.created, false);
});

test('ไม่ส่งไฟล์มาเลย → ปฏิเสธพร้อมบอกเหตุผล', async () => {
  await assert.rejects(
    () => svc.ingestTimesheet({ documentNo: 'X1', extractor: stubExtractor({}) }),
    /filePath หรือ fileBase64/,
  );
  await assert.rejects(
    () => svc.ingestTimesheet({ fileBase64: 'x', extractor: stubExtractor({}) }),
    /documentNo/,
  );
});

/**
 * กันการพังเงียบซ้ำ — หน้ารอบบิลอ่านฟิลด์เหล่านี้ตรงๆ
 * ถ้าขาดตัวใดตัวหนึ่ง หน้าจะขึ้น "undefined" โดยไม่มี error ให้เห็น
 * เคยเกิดขึ้นจริงตอนแยก billingCycles() ออกมาจาก dashboard() แล้วตัดฟิลด์ทิ้ง
 */
test('billingCycles() ส่งฟิลด์ครบตามที่หน้ารอบบิลใช้', () => {
  const data = svc.billingCycles();

  assert.ok(data.contracts.length > 0, 'ต้องมีสัญญาอย่างน้อยหนึ่งฉบับ');
  for (const ct of data.contracts) {
    for (const field of ['poNo', 'customerName', 'projectName', 'startDate', 'endDate']) {
      assert.ok(ct[field], `หัวการ์ดต้องมี ${field}`);
    }
    for (const field of ['monthsTotal', 'monthsBilled', 'contractValue',
                         'billedValue', 'remainingValue', 'progress']) {
      assert.equal(typeof ct[field], 'number', `${field} ต้องเป็นตัวเลข ไม่ใช่ undefined`);
    }
    assert.equal(ct.remainingValue, ct.contractValue - ct.billedValue,
      'คงเหลือต้องเท่ากับมูลค่าสัญญาหักที่วางบิลแล้ว');
  }

  assert.ok(data.cycles.length > 0, 'ต้องมีรอบบิล');
  for (const field of ['contractId', 'period', 'periodLabel', 'state', 'stateLabel',
                       'expected', 'received', 'expectedBillDate']) {
    assert.ok(data.cycles[0][field] !== undefined, `ตารางรอบบิลต้องมี ${field}`);
  }
});

test('มูลค่าสัญญาใน billingCycles() ตรงกับยอดในใบว่าจ้าง 26/B0113', () => {
  const ct = svc.billingCycles().contracts.find((c) => c.poNo === '26/B0113');
  assert.ok(ct, 'ต้องพบสัญญา 26/B0113');
  assert.equal(ct.monthsTotal, 6, 'สัญญา 6 เดือน (ม.ค.–มิ.ย. 69)');
  assert.equal(ct.contractValue, 1058183.58, 'ยอดรวมก่อนภาษีในใบว่าจ้าง');
});
