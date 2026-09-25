/**
 * อัตราหัก ณ ที่จ่ายปรับได้ละเอียด 0.25% (เจ้าของระบบสั่งคืน 25 ก.ย. 69 เผื่อวันที่ FlowAccount รองรับ
 * เรตทศนิยม — ยังไม่มีเคสจริงที่ต้องใช้) เคยถูกบังคับเป็น % เต็มตั้งแต่ชั้นเก็บข้อมูลใน 61699d4 ทำให้
 * ตั้ง 3.25% แล้วเด้งกลับเป็น 3% ทุกครั้ง
 *
 * เส้นแบ่งที่เทสต์ชุดนี้ล็อกไว้: **เก็บได้ละเอียด แต่คิดเงินที่ % เต็ม** — FlowAccount รับ
 * documentWithholdingTaxPercentage เป็นเลขเต็มแล้วเอาไปคิดยอดใหม่เอง ไม่เชื่อยอดที่เราส่งไปด้วย ถ้า OBS
 * คิดที่ 3.25% ใบแจ้งหนี้จริงจะออกที่ 3% แล้วสองระบบยอดไม่ตรงกัน (เจอจริง 24 ก.ย. 69 ที่ 2.25% vs 2%)
 * การปัดจึงต้องอยู่ที่ชั้นคำนวณเท่านั้น ไฟล์นี้ล็อกฝั่ง "เก็บข้อมูลต้องไม่ปัด" ส่วนฝั่ง "คำนวณต้องปัด" ล็อกไว้
 * แล้วที่ packages/domain/test/invoice.test.ts ("เรทหัก ณ ที่จ่ายที่ไม่ใช่ % เต็ม ต้องถูกปัดก่อนคำนวณเสมอ")
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@obs/db';

import { seedFixtures, CONTRACT } from './helpers/testDb.js';
import { updateContractWhtRate } from '../src/lib/contractsMasterService.js';

await seedFixtures();

const ORIGINAL_RATE = (await prisma.contract.findUnique({ where: { id: CONTRACT.id } }))!.whtRate;

test.after(async () => {
  await prisma.contract.update({ where: { id: CONTRACT.id }, data: { whtRate: ORIGINAL_RATE } });
  await prisma.$disconnect();
});

test('ตั้งเรต 3.25% → เก็บไว้ได้ทั้ง 3.25% ไม่ถูกปัดทิ้งตั้งแต่ตอนเก็บ', async () => {
  const result = await updateContractWhtRate(CONTRACT.id, 0.0325, { actor: 'ทดสอบ' });
  assert.equal(result.whtRate, 0.0325);

  const saved = await prisma.contract.findUnique({ where: { id: CONTRACT.id } });
  assert.equal(saved!.whtRate, 0.0325, 'ค่าที่ผู้ใช้ตั้งต้องอยู่ในฐานข้อมูลตามนั้น ไม่เด้งกลับเป็น 3%');
});

test('ตั้งเรตละเอียดกว่า 0.25% (เช่น 3.3333%) → ปัดเหลือทศนิยม 2 ตำแหน่งของ % พอ', async () => {
  const result = await updateContractWhtRate(CONTRACT.id, 0.033333, { actor: 'ทดสอบ' });
  assert.equal(result.whtRate, 0.0333);
});

test('เรตนอกช่วง 0–30% ยังถูกปฏิเสธเหมือนเดิม', async () => {
  await assert.rejects(() => updateContractWhtRate(CONTRACT.id, 0.31, { actor: 'ทดสอบ' }), /0–30%/);
  await assert.rejects(() => updateContractWhtRate(CONTRACT.id, -0.01, { actor: 'ทดสอบ' }), /0–30%/);
});
