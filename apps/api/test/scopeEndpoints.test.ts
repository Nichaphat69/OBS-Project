/**
 * ทุกหน้าที่เกี่ยวข้องต้องเปลี่ยนตาม PO ที่เลือกบนแถบบน (6 ต.ค. 69)
 *
 * เดิมหลายหน้า (ข้อมูลหลักพนักงาน/สัญญา, ใบแจ้งหนี้, บันทึกการส่ง, ตัวเลขบนเมนู, ฟีดแจ้งเตือน, ประวัติอ่านไฟล์) ใช้ธง "สัญญากำลังดำเนินการ"
 * ของทั้งระบบแทน จึงไม่เปลี่ยนตามที่ผู้ใช้เลือก — เทสต์นี้ยิงชั้นบริการด้วยรายการสัญญา (contractIds) ให้ครบทุกจุด
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@obs/db';
import { seedFixtures } from './helpers/testDb.js';
import { listEmployeesFull } from '../src/lib/employeesMasterService.js';
import { listTimesheetSubmissions } from '../src/lib/submissionLogService.js';
import { listAiReads } from '../src/lib/aiReadsService.js';
import { listInvoices } from '../src/lib/cyclesService.js';
import { activityFeed } from '../src/lib/activityFeedService.js';
import { pulse } from '../src/lib/pulseService.js';
import { createCustomer } from '../src/lib/customersService.js';
import { createContract } from '../src/lib/contractsMasterService.js';

await seedFixtures();

test.after(async () => {
  await prisma.$disconnect();
});

async function twoContractsWithEmployees() {
  let contracts = await prisma.contract.findMany({ include: { assignments: true }, orderBy: { id: 'asc' } });
  let withPeople = contracts.filter((c) => c.assignments.length > 0);
  if (withPeople.length < 2) {
    // ฟิกซ์เจอร์มีสัญญาที่มีพนักงานไม่ถึงสองสัญญา — สร้างสัญญาที่สองพร้อมพนักงานคนละคนของตัวเอง
    const customer = await createCustomer({ nameTh: 'บริษัท ขอบเขตทดสอบ จำกัด', taxId: '0105500000555', actor: 'ทดสอบ' });
    const created = await createContract({
      customerId: customer.id, poNo: 'PO-SCOPE-2', projectName: 'โครงการขอบเขตทดสอบ', startDate: '2026-01-01', endDate: '2026-12-31', actor: 'ทดสอบ',
    });
    await prisma.employee.create({ data: { id: 'EMP-SCOPE-2', nameTh: 'พนักงาน ขอบเขตสอง', invoicePosition: 'Tester', createdAt: new Date().toISOString() } });
    await prisma.assignment.create({
      data: { id: 'ASG-SCOPE-2', contractId: created!.id, employeeId: 'EMP-SCOPE-2', monthlyRate: 40000, startDate: '2026-01-01', endDate: '2026-12-31', status: 'active' },
    });
    contracts = await prisma.contract.findMany({ include: { assignments: true }, orderBy: { id: 'asc' } });
    withPeople = contracts.filter((c) => c.assignments.length > 0);
  }
  assert.ok(withPeople.length >= 2, 'ต้องมีอย่างน้อย 2 สัญญาที่มีพนักงาน');
  return withPeople;
}

test('พนักงาน (ข้อมูลหลัก): เลือกสัญญาเดียวเห็นแต่ของสัญญานั้น · null เห็นทั้งหมด', async () => {
  const [a, b] = await twoContractsWithEmployees();
  const onlyA = await listEmployeesFull({ contractIds: [a.id] });
  assert.ok(onlyA.length > 0 && onlyA.every((r) => r.contractId === a.id));
  const both = await listEmployeesFull({ contractIds: [a.id, b.id] });
  assert.ok(both.every((r) => r.contractId === a.id || r.contractId === b.id));
  const all = await listEmployeesFull({ contractIds: null });
  assert.ok(all.length >= both.length);
  const none = await listEmployeesFull({ contractIds: [] });
  assert.equal(none.length, 0, 'ไม่มีสัญญาในขอบเขต = ไม่เห็นอะไร ไม่ใช่เห็นทั้งหมด');
});

test('บันทึกการส่ง: กรองตามรายการสัญญา', async () => {
  const [a] = await twoContractsWithEmployees();
  const scoped = await listTimesheetSubmissions({ contractIds: [a.id] });
  assert.ok(scoped.rows.every((r) => r.contractId === a.id));
  const empty = await listTimesheetSubmissions({ contractIds: [] });
  assert.equal(empty.rows.length, 0);
});

test('ประวัติอ่านไฟล์ (แท็บรอจากพนักงาน/ประวัติ): กรองตามพนักงานในสัญญาที่เลือก', async () => {
  const [a, b] = await twoContractsWithEmployees();
  const empA = a.assignments[0].employeeId;
  const empB = b.assignments.find((x) => x.employeeId !== empA)?.employeeId ?? b.assignments[0].employeeId;
  const mk = (employeeId: string, fileName: string) =>
    prisma.aiRead.create({ data: { source: 'upload', fileName, employeeId, period: '2026-02', status: 'pending', readAt: new Date().toISOString() } });
  await mk(empA, 'scope-test-A.pdf');
  await mk(empB, 'scope-test-B.pdf');

  const names = (rows: Array<{ fileName: string | null }>) => rows.map((r) => r.fileName).filter((n) => n?.startsWith('scope-test-'));
  const onlyA = names(await listAiReads([a.id]));
  assert.ok(onlyA.includes('scope-test-A.pdf'));
  assert.ok(!onlyA.includes('scope-test-B.pdf') || a.assignments.some((x) => x.employeeId === empB), 'ไฟล์ของพนักงานสัญญาอื่นต้องไม่ติดมา');
  const all = names(await listAiReads(null));
  assert.ok(all.includes('scope-test-A.pdf') && all.includes('scope-test-B.pdf'));
});

test('ใบแจ้งหนี้: รับรายการสัญญา · ว่าง = ไม่เห็นอะไร', async () => {
  const [a] = await twoContractsWithEmployees();
  const scoped = await listInvoices([a.id]);
  assert.ok(scoped.every((r) => r.contractId === a.id));
  assert.equal((await listInvoices([])).length, 0);
});

test('ฟีดแจ้งเตือน: กรองตามรายการสัญญา (รายการที่ไม่ผูกสัญญายังอยู่)', async () => {
  const [a] = await twoContractsWithEmployees();
  const scoped = await activityFeed({ limit: 50, contractIds: [a.id] });
  const all = await activityFeed({ limit: 50, contractIds: null });
  assert.ok(scoped.items.length <= all.items.length);
});

test('ตัวเลขบนเมนู (pulse): นับตามขอบเขตที่เลือก ไม่ใช่สัญญา "กำลังดำเนินการ"', async () => {
  const [a] = await twoContractsWithEmployees();
  const scoped = await pulse({ role: 'admin', contractIds: [a.id] });
  const all = await pulse({ role: 'admin', contractIds: null });
  assert.ok(scoped.waitingCheck <= all.waitingCheck);
  assert.ok(scoped.needsAction <= all.needsAction);
  const none = await pulse({ role: 'admin', contractIds: [] });
  assert.equal(none.waitingCheck, 0);
  assert.equal(none.readyToApprove, 0);
});
