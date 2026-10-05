/**
 * ช่องที่ "ดึงมาจาก FlowAccount" แก้เองไม่ได้ (เจ้าของระบบสั่ง 5 ต.ค. 69)
 *
 * จุดที่ต้องพิสูจน์: (1) ล็อกจริงที่ API ไม่ใช่แค่หน้าเว็บ — คำขอที่แก้ช่องที่ล็อกถูกปฏิเสธ 409 และ "ฐานข้อมูลไม่เปลี่ยน"
 * (2) ช่องที่ไม่ได้ดึงมายังแก้ได้ตามปกติ (3) ส่งค่าเดิมมาซ้ำผ่าน (หน้าเว็บส่งทุกช่องมาเสมอ) (4) บริษัทที่ไม่ได้ผูก
 * FlowAccount ไม่มีอะไรถูกล็อก (5) สัญญาเก่าที่ไม่มีรายการเก็บไว้ใช้กฎสำรองที่ล็อกชื่อบริษัท+เลขผู้เสียภาษี
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@obs/db';
import { seedFixtures } from './helpers/testDb.js';
import { createCustomer } from '../src/lib/customersService.js';
import { createContract, updateContract, ContractMasterError } from '../src/lib/contractsMasterService.js';
import { listContracts } from '../src/lib/dashboardService.js';
import {
  changedLockedKeys,
  effectiveLockedKeys,
  sameValue,
  sanitizeLockedKeys,
} from '../src/lib/faLockedFields.js';

await seedFixtures();

test.after(async () => {
  await prisma.$disconnect();
});

/* ── ตัวช่วยล้วน (ไม่แตะฐานข้อมูล) ── */

test('sanitizeLockedKeys รับเฉพาะคีย์ที่รู้จัก ไม่ซ้ำ และไม่พังเมื่อได้ค่าแปลก', () => {
  assert.deepEqual(sanitizeLockedKeys(['taxId', 'taxId', 'hack', 7, null, 'projectName']), ['taxId', 'projectName']);
  assert.deepEqual(sanitizeLockedKeys('taxId'), []);
  assert.deepEqual(sanitizeLockedKeys(undefined), []);
});

test('sameValue: ว่าง/null เท่ากัน, ตัวเลขเทียบเชิงตัวเลข, ช่องว่างหัวท้ายไม่นับ', () => {
  assert.equal(sameValue(null, ''), true);
  assert.equal(sameValue(undefined, '  '), true);
  assert.equal(sameValue('  abc ', 'abc'), true);
  assert.equal(sameValue(0.07, '0.07'), true);
  assert.equal(sameValue(30, '30.0'), true);
  assert.equal(sameValue('abc', 'abd'), false);
  assert.equal(sameValue(0.07, 0.03), false);
  assert.equal(sameValue('', 'x'), false);
});

test('changedLockedKeys เทียบเฉพาะคีย์ที่ส่งมา — ไม่ส่งมาไม่นับว่าแก้', () => {
  const current = { taxId: '111', projectName: 'A', creditDays: 30 };
  assert.deepEqual(changedLockedKeys(['taxId', 'projectName'], current, { taxId: '111' }), []);
  assert.deepEqual(changedLockedKeys(['taxId', 'projectName'], current, { taxId: '222', projectName: 'A' }), ['taxId']);
  assert.deepEqual(changedLockedKeys(['creditDays'], current, { creditDays: '45' }), ['creditDays']);
  assert.deepEqual(changedLockedKeys(['creditDays'], current, {}), []);
});

test('effectiveLockedKeys: บริษัทที่ไม่ผูก FlowAccount ไม่มีอะไรล็อก แม้มีรายการเก็บไว้', () => {
  const free = { flowaccountContactId: null, contactName: 'x', contactPhone: 'y' };
  assert.deepEqual(effectiveLockedKeys('["taxId"]', free), []);
  assert.deepEqual(effectiveLockedKeys(null, free), []);
});

test('effectiveLockedKeys: สัญญาเก่า (ไม่มีรายการ) ของบริษัทที่ผูก ล็อกชื่อ+เลขภาษี และผู้ประสานงานถ้ามีค่า', () => {
  const linked = { flowaccountContactId: '99', contactName: null, contactPhone: '0812345678' };
  assert.deepEqual(effectiveLockedKeys(null, linked), ['customerNameTh', 'taxId', 'contactPhone']);
  assert.deepEqual(effectiveLockedKeys('["projectName"]', linked), ['projectName'], 'มีรายการเก็บไว้ใช้ตามนั้น');
  assert.deepEqual(effectiveLockedKeys('ไม่ใช่ json', linked), [], 'json เสีย = ไม่ล็อกอะไร ไม่ล้ม');
});

/* ── ผ่านฐานข้อมูลจริง ── */

async function makeLinked(suffix: string, lockedFields: unknown) {
  const customer = await createCustomer({
    nameTh: `บริษัท ล็อกฟิลด์ ${suffix} จำกัด`,
    taxId: `01055${suffix.padStart(8, '0')}`,
    contactName: 'คุณผู้ประสาน',
    contactPhone: '0811111111',
    flowaccountContactId: `FA-${suffix}`,
    actor: 'ทดสอบ',
  });
  const contract = await createContract({
    customerId: customer.id,
    poNo: `PO-LOCK-${suffix}`,
    projectName: 'โครงการจาก FlowAccount',
    startDate: '2026-10-01',
    endDate: '2026-12-31',
    creditDays: 45,
    vatRate: 0.07,
    whtRate: 0.03,
    faLockedFields: lockedFields,
    actor: 'ทดสอบ',
  });
  return { customer, contract: contract! };
}

const basePatch = (c: { id: string }, over: Record<string, unknown> = {}) => ({
  contractId: c.id,
  poNo: 'ไม่ล็อก-PO',
  contractNo: 'C-1',
  projectName: 'โครงการจาก FlowAccount',
  startDate: '2026-10-01',
  endDate: '2026-12-31',
  creditDays: 45,
  vatRate: 0.07,
  whtRate: 0.03,
  customerNameTh: undefined as unknown as string,
  taxId: undefined as unknown as string,
  contactName: 'คุณผู้ประสาน',
  contactPhone: '0811111111',
  billingPlace: null,
  actor: 'ทดสอบ',
  ...over,
});

test('สร้างสัญญาแล้วเก็บรายการช่องที่ล็อก และส่งออกทาง listContracts', async () => {
  const { contract } = await makeLinked('1', ['customerNameTh', 'taxId', 'projectName', 'bogus']);
  assert.deepEqual(contract.faLockedFields, ['customerNameTh', 'taxId', 'projectName'], 'คีย์แปลกต้องถูกตัดทิ้ง');
  const row = (await listContracts()).find((c) => c.id === contract.id)!;
  assert.deepEqual(row.faLockedFields, ['customerNameTh', 'taxId', 'projectName']);
});

test('แก้ช่องที่ล็อก → ปฏิเสธ 409 และฐานข้อมูลไม่เปลี่ยนเลย', async () => {
  const { customer, contract } = await makeLinked('2', ['customerNameTh', 'taxId', 'projectName', 'creditDays']);
  const before = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });

  await assert.rejects(
    () => updateContract(basePatch(contract, { customerNameTh: 'ชื่อที่แก้เอง', taxId: before.taxId })),
    (e: any) => e instanceof ContractMasterError && e.status === 409 && /ชื่อบริษัท/.test(e.message) && /FlowAccount/.test(e.message),
  );
  await assert.rejects(
    () => updateContract(basePatch(contract, { customerNameTh: before.nameTh, taxId: before.taxId, projectName: 'ชื่อโครงการใหม่' })),
    (e: any) => e instanceof ContractMasterError && e.status === 409 && /ชื่อโครงการ/.test(e.message),
  );
  await assert.rejects(
    () => updateContract(basePatch(contract, { customerNameTh: before.nameTh, taxId: before.taxId, creditDays: 60 })),
    (e: any) => e instanceof ContractMasterError && e.status === 409 && /เครดิต/.test(e.message),
  );

  const afterCustomer = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
  const afterContract = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
  assert.equal(afterCustomer.nameTh, before.nameTh);
  assert.equal(afterContract.projectName, 'โครงการจาก FlowAccount');
  assert.equal(afterContract.creditDays, 45);
  assert.equal(afterContract.poNo, `PO-LOCK-2`, 'คำขอที่ถูกปฏิเสธต้องไม่เขียนช่องอื่นไปครึ่งทาง');
});

test('ส่งค่าเดิมของช่องที่ล็อกมาซ้ำ + แก้ช่องที่ไม่ล็อก → ผ่าน และช่องที่ไม่ล็อกเปลี่ยนจริง', async () => {
  const { customer, contract } = await makeLinked('3', ['customerNameTh', 'taxId', 'projectName']);
  const c = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
  const updated = await updateContract(
    basePatch(contract, { customerNameTh: c.nameTh, taxId: c.taxId, poNo: 'PO-แก้ได้', contractNo: 'C-999', contactName: 'ชื่อผู้ประสานใหม่' }),
  );
  assert.equal(updated!.poNo, 'PO-แก้ได้');
  const after = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
  assert.equal(after.contactName, 'ชื่อผู้ประสานใหม่', 'ช่องที่ไม่ได้ดึงจาก FlowAccount ต้องแก้ได้');
});

test('บริษัทที่ไม่ผูก FlowAccount: ส่งรายการล็อกมาก็ไม่เก็บ และแก้ได้ทุกช่อง', async () => {
  const customer = await createCustomer({ nameTh: 'บริษัท ไม่ผูก จำกัด', taxId: '0105500000501', actor: 'ทดสอบ' });
  const contract = await createContract({
    customerId: customer.id,
    poNo: 'PO-FREE-1',
    projectName: 'โครงการอิสระ',
    startDate: '2026-10-01',
    endDate: '2026-12-31',
    faLockedFields: ['customerNameTh', 'taxId', 'projectName'],
    actor: 'ทดสอบ',
  });
  const stored = await prisma.contract.findUniqueOrThrow({ where: { id: contract!.id } });
  assert.equal(stored.faLockedFields, null);
  assert.deepEqual(contract!.faLockedFields, []);
  const updated = await updateContract(
    basePatch(contract!, { customerNameTh: 'ชื่อใหม่ได้', taxId: '0105500000502', projectName: 'ชื่อโครงการใหม่ได้' }),
  );
  assert.equal(updated!.projectName, 'ชื่อโครงการใหม่ได้');
});

test('สัญญาเก่าของบริษัทที่ผูก FlowAccount (ไม่มีรายการเก็บไว้): ล็อกชื่อบริษัท+เลขภาษี แต่ชื่อโครงการยังแก้ได้', async () => {
  const { customer, contract } = await makeLinked('4', undefined);
  const stored = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
  assert.equal(stored.faLockedFields, null);
  assert.ok(contract.faLockedFields.includes('customerNameTh') && contract.faLockedFields.includes('taxId'));
  const c = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });

  await assert.rejects(
    () => updateContract(basePatch(contract, { customerNameTh: c.nameTh, taxId: '0000000000000' })),
    (e: any) => e instanceof ContractMasterError && e.status === 409,
  );
  const ok = await updateContract(basePatch(contract, { customerNameTh: c.nameTh, taxId: c.taxId, projectName: 'เปลี่ยนชื่อโครงการได้' }));
  assert.equal(ok!.projectName, 'เปลี่ยนชื่อโครงการได้');
});
