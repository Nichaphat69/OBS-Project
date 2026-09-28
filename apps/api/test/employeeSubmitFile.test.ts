/**
 * พนักงานส่งไฟล์ Timesheet ของตัวเอง (18 ก.ย. 69)
 *
 * เส้นนี้เป็น**เส้นเขียนเส้นแรกที่ role 'user' เรียกได้** จึงต้องตรึงไว้สองเรื่องที่พังแล้วพังเงียบ:
 *   1. ต้องบันทึกว่า "ส่งแล้ว ช่องทาง self_obs" จริง ไม่ใช่แค่เก็บไฟล์ — ถ้าเก็บไฟล์อย่างเดียว
 *      หน้า "บันทึกการส่ง" จะยังขึ้นว่ายังไม่ส่ง ทั้งที่พนักงานส่งมาแล้ว และไม่มีใครรู้ว่าพลาด
 *   2. ต้อง**ไม่**สร้างแถว `timesheets` — พนักงานมีหน้าที่ส่งอย่างเดียว การอ่าน/ตรวจยังเป็นของ admin
 *      ถ้าเผลอสร้างแถวขึ้นมา จะกลายเป็นว่ารอบนั้นถูกนับว่ามีข้อมูลแล้วทั้งที่ยังไม่มีใครอ่านเลย
 *
 * ⚠️ ใช้ fixture ร่วมกับไฟล์อื่น — ทุกอย่างที่สร้างต้องลบคืนใน test.after ให้ครบ
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@obs/db';

import { seedFixtures } from './helpers/testDb.js';
import {
  submitOwnTimesheetFile,
  SubmitOwnFileError,
  pendingSubmissionFor,
  submittablePeriodFor,
  declareOwnSubmissionMethod,
} from '../src/lib/timesheetSubmissionService.js';
import { isoToday, enumeratePeriods } from '../src/lib/dashboardService.js';
import { listAiReads } from '../src/lib/aiReadsService.js';
import { loadFile } from '../src/lib/fileStorage.js';

await seedFixtures();

const EMP = 'EMP-0042';
const FILE_B64 = Buffer.from('%PDF-1.4 fake timesheet').toString('base64');

test.after(async () => {
  await prisma.aiRead.deleteMany({ where: { employeeId: EMP, source: 'employee_submit' } });
  await prisma.timesheetSubmission.deleteMany({ where: { employeeId: EMP } });
  await prisma.$disconnect();
});

test('ไฟล์ว่าง/ชื่อไฟล์ว่าง ต้องถูกปฏิเสธก่อนแตะฐานข้อมูล', async () => {
  await assert.rejects(
    () => submitOwnTimesheetFile({ employeeId: EMP, actor: 'ทดสอบ', fileName: 'a.pdf', fileBase64: '' }),
    (e: unknown) => e instanceof SubmitOwnFileError && e.status === 400,
  );
  await assert.rejects(
    () => submitOwnTimesheetFile({ employeeId: EMP, actor: 'ทดสอบ', fileName: '  ', fileBase64: FILE_B64 }),
    (e: unknown) => e instanceof SubmitOwnFileError && e.status === 400,
  );
});

test('ไฟล์ใหญ่เกิน 8 MB ต้องถูกปฏิเสธ — กันไม่ให้ไปโดน body parser ตัดแล้วได้ error ที่อ่านไม่รู้เรื่อง', async () => {
  const tooBig = Buffer.alloc(8 * 1024 * 1024 + 1).toString('base64');
  await assert.rejects(
    () => submitOwnTimesheetFile({ employeeId: EMP, actor: 'ทดสอบ', fileName: 'big.pdf', fileBase64: tooBig }),
    (e: unknown) => e instanceof SubmitOwnFileError && e.status === 400,
  );
});

test('ส่งสำเร็จ: เก็บไฟล์ + บันทึกช่องทาง self_obs ของรอบที่ค้างอยู่ และไม่สร้างแถว timesheets', async () => {
  const pending = await pendingSubmissionFor(EMP);
  assert.ok(pending, 'fixture ต้องมีรอบที่ยังไม่ส่งอย่างน้อยหนึ่งรอบ ไม่งั้นเทสต์นี้ไม่ได้ทดสอบอะไรเลย');

  const timesheetsBefore = await prisma.timesheet.count({ where: { employeeId: EMP } });

  const result = await submitOwnTimesheetFile({
    employeeId: EMP,
    actor: 'ทดสอบ พนักงาน',
    fileName: 'timesheet.pdf',
    fileBase64: FILE_B64,
  });

  assert.equal(result.period, pending.period);
  assert.equal(result.fileName, 'timesheet.pdf');

  // ไฟล์ต้องอยู่จริงและเป็นไบต์เดิม ไม่ใช่แค่มีแถว
  const stored = await prisma.aiRead.findUnique({
    where: { id: result.fileId },
    select: { fileKey: true, employeeId: true, period: true, source: true, model: true },
  });
  assert.equal(stored?.employeeId, EMP);
  assert.equal(stored?.period, pending.period);
  assert.equal(stored?.source, 'employee_submit');
  assert.equal(stored?.model, null, 'ห้ามมี model เพราะเส้นนี้ไม่ได้อ่านไฟล์');
  assert.equal((await loadFile(stored!.fileKey))?.toString('utf8'), '%PDF-1.4 fake timesheet');

  // หัวใจของฟีเจอร์ — ต้องขึ้นว่าส่งแล้วผ่านระบบ OBS
  const submission = await prisma.timesheetSubmission.findUnique({
    where: { employeeId_period: { employeeId: EMP, period: pending.period } },
    select: { method: true, methodChosenAt: true, contractId: true },
  });
  assert.equal(submission?.method, 'self_obs');
  assert.ok(submission?.methodChosenAt, 'ต้องบันทึกเวลาที่ส่งด้วย ไม่งั้นหน้าบันทึกการส่งจะโชว์ "—"');
  assert.equal(submission?.contractId, pending.contractId);

  assert.equal(
    await prisma.timesheet.count({ where: { employeeId: EMP } }),
    timesheetsBefore,
    'เส้นนี้ต้องไม่สร้างแถว timesheets — การอ่าน/ตรวจยังเป็นงานของ admin',
  );
});

/* ── เลือกรอบบิลเอง (25 ก.ย. 69) — หน้าอัปโหลดของพนักงานบังคับเลือกรอบก่อนส่ง เซิร์ฟเวอร์ต้องเช็คซ้ำ
   ด้วยกติกาเดียวกับหน้า "ความคืบหน้าของฉัน" ไม่เชื่อค่าที่หน้าเว็บส่งมาเฉยๆ ── */

test('เลือกรอบของสัญญาที่ตัวเองไม่ได้อยู่ ต้องถูกปฏิเสธ', async () => {
  await assert.rejects(
    () => submittablePeriodFor(EMP, 'CT-NOT-MINE', '2026-01'),
    (e: unknown) => e instanceof SubmitOwnFileError && e.status === 400,
  );
});

test('เลือกรอบนอกอายุสัญญา/เดือนในอนาคต ต้องถูกปฏิเสธ', async () => {
  const pending = await pendingSubmissionFor(EMP);
  assert.ok(pending);
  await assert.rejects(
    () => submittablePeriodFor(EMP, pending.contractId, '2999-01'),
    (e: unknown) => e instanceof SubmitOwnFileError && e.status === 400,
  );
});

test('เลือกรอบที่ส่งได้ → ไฟล์ลงรอบที่เลือก ไม่ใช่รอบที่ระบบเดาให้', async () => {
  const assignment = await prisma.assignment.findFirst({ where: { employeeId: EMP, status: 'active' }, include: { contract: true } });
  assert.ok(assignment);
  const current = isoToday().slice(0, 7);
  let chosen: string | null = null;
  // ไล่จากรอบใหม่สุดที่ถึงกำหนดแล้วลงไป — ตั้งใจเลือกคนละรอบกับ pendingSubmissionFor() (ที่เอาเก่าสุด)
  for (const period of enumeratePeriods(assignment.contract.startDate, assignment.contract.endDate).reverse()) {
    if (period > current) continue;
    try {
      await submittablePeriodFor(EMP, assignment.contractId, period);
      chosen = period;
      break;
    } catch {
      /* รอบนี้ส่งไม่ได้ ลองรอบก่อนหน้า */
    }
  }
  assert.ok(chosen, 'fixture ต้องมีรอบที่ถึงกำหนดและยังส่งได้อย่างน้อยหนึ่งรอบ');

  const result = await submitOwnTimesheetFile({
    employeeId: EMP,
    actor: 'ทดสอบ พนักงาน',
    fileName: 'chosen.pdf',
    fileBase64: FILE_B64,
    contractId: assignment.contractId,
    period: chosen,
  });
  assert.equal(result.period, chosen);
});

/* ── แจ้งว่าส่งด้วยวิธีอื่นจากหน้าเว็บ (25 ก.ย. 69) — ต้องทำเหมือนกดปุ่มบนการ์ดเตือนในไลน์ ── */

class FakeLineClient {
  broadcasts: any[] = [];
  personal: any[] = [];
  async pushFlexToAll(contents: unknown, altText: string, { targets }: { targets?: string[] } = {}) {
    this.broadcasts.push({ targets: targets ?? [], altText, contents });
    return {};
  }
  async pushFlexToUser(userId: string | null | undefined, altText: string, contents: unknown) {
    this.personal.push({ userId, altText, contents });
    return {};
  }
}

async function firstSubmittable(): Promise<{ contractId: string; period: string }> {
  const assignment = await prisma.assignment.findFirst({ where: { employeeId: EMP, status: 'active' }, include: { contract: true } });
  assert.ok(assignment);
  const current = isoToday().slice(0, 7);
  for (const period of enumeratePeriods(assignment.contract.startDate, assignment.contract.endDate)) {
    if (period > current) continue;
    try {
      await submittablePeriodFor(EMP, assignment.contractId, period);
      return { contractId: assignment.contractId, period };
    } catch {
      /* ลองรอบถัดไป */
    }
  }
  throw new Error('fixture ต้องมีรอบที่ส่งได้');
}

test('แจ้ง "ส่งผ่าน Email" จากเว็บ → บันทึกเป็น self_email + แจ้งฝ่ายบัญชี + ยืนยันเข้าไลน์พนักงาน', async () => {
  const { contractId, period } = await firstSubmittable();
  const before = await prisma.employee.findUnique({ where: { id: EMP }, select: { lineUserId: true } });
  await prisma.employee.update({ where: { id: EMP }, data: { lineUserId: 'U-test-web-declare' } });
  try {
    const line = new FakeLineClient();
    const result = await declareOwnSubmissionMethod({ employeeId: EMP, actor: 'ทดสอบ', contractId, period, method: 'self_email', client: line as any });
    assert.equal(result.method, 'self_email');
    assert.equal(result.period, period);

    const row = await prisma.timesheetSubmission.findUnique({ where: { employeeId_period: { employeeId: EMP, period } }, select: { method: true } });
    assert.equal(row?.method, 'self_email');

    assert.equal(line.broadcasts.length, 1, 'ต้องแจ้งฝ่ายบัญชี/admin ด้วยการ์ดใบเดียวกับเส้นไลน์');
    assert.match(line.broadcasts[0].altText, /แจ้งส่ง Timesheet ทางอีเมล/);
    assert.equal(line.personal.length, 1, 'ผูกไลน์ไว้ ต้องได้การ์ดยืนยันเข้าไลน์ตัวเองด้วย');
    assert.equal(line.personal[0].userId, 'U-test-web-declare');
  } finally {
    await prisma.employee.update({ where: { id: EMP }, data: { lineUserId: before?.lineUserId ?? null } });
  }
});

test('แจ้ง "ให้ผู้ดูแลเป็นคนส่ง" → proxy_email และไม่สร้างแถว timesheets', async () => {
  const { contractId, period } = await firstSubmittable();
  const timesheetsBefore = await prisma.timesheet.count({ where: { employeeId: EMP } });
  const line = new FakeLineClient();
  await declareOwnSubmissionMethod({ employeeId: EMP, actor: 'ทดสอบ', contractId, period, method: 'proxy_email', client: line as any });
  const row = await prisma.timesheetSubmission.findUnique({ where: { employeeId_period: { employeeId: EMP, period } }, select: { method: true } });
  assert.equal(row?.method, 'proxy_email');
  assert.match(line.broadcasts[0].altText, /ขอมอบหมายส่ง Timesheet แทน/);
  assert.equal(await prisma.timesheet.count({ where: { employeeId: EMP } }), timesheetsBefore);
});

test('แจ้งวิธีส่งของรอบที่ส่งไม่ได้ (นอกสัญญา) ต้องถูกปฏิเสธ ไม่บันทึกอะไร', async () => {
  await assert.rejects(
    () => declareOwnSubmissionMethod({ employeeId: EMP, actor: 'ทดสอบ', contractId: 'CT-NOT-MINE', period: '2026-01', method: 'self_email', client: new FakeLineClient() as any }),
    (e: unknown) => e instanceof SubmitOwnFileError && e.status === 400,
  );
});

test('ไฟล์ที่พนักงานส่งเอง ต้องขึ้นชื่อพนักงานในรายการ "รอจากพนักงาน" และไม่หายตอนกรองตามสัญญา (25 ก.ย. 69)', async () => {
  const { contractId, period } = await firstSubmittable();
  const emp = await prisma.employee.findUnique({ where: { id: EMP }, select: { nameTh: true } });
  const result = await submitOwnTimesheetFile({ employeeId: EMP, actor: 'ทดสอบ', fileName: 'name-check.pdf', fileBase64: FILE_B64, contractId, period });

  const all = await listAiReads();
  const row = all.find((r) => r.id === result.fileId);
  assert.equal(row?.employeeName, emp?.nameTh, 'ต้องไม่เป็น null — ไม่งั้นหน้าเว็บขึ้น "ไม่ทราบชื่อ"');

  const filtered = await listAiReads(contractId);
  assert.ok(filtered.some((r) => r.id === result.fileId), 'กรองตามสัญญาของพนักงานคนนั้นแล้วต้องยังเห็นไฟล์นี้');
});
