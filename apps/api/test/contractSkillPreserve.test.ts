/**
 * กันค่าที่ตั้งไว้ถูกล้างเงียบๆ ตอนแก้สัญญา (17 ก.ย. 69)
 *
 * หน้าเว็บถอดช่องเลือก Skill ABBYY ออกจากฟอร์มแก้สัญญาแล้ว ฟอร์มจึงไม่ส่ง `abbyySkillId` ขึ้นมาอีก
 * ถ้า updateContract() ยังใช้ค่า default เป็น null แบบฟิลด์อื่น ค่าที่ตั้งไว้จะหายทันทีที่มีคนกดแก้
 * สัญญาครั้งถัดไป โดยไม่มีอะไรเตือน — และเส้น Gmail ที่ดึงไฟล์เข้ามาเองยังใช้ค่านี้เป็นค่าตั้งต้นอยู่
 * จึงจะกลายเป็นอ่านด้วย Skill ผิดตัวเงียบๆ
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@obs/db';

import { seedFixtures, CONTRACT, CUSTOMER } from './helpers/testDb.js';
import { updateContract } from '../src/lib/contractsMasterService.js';

await seedFixtures();

/** เทสต์ไฟล์อื่นใช้สัญญา CT-26B0113 ตัวเดียวกันนี้ และทุกไฟล์ถูก import ก่อนเทสต์จะเริ่มรัน — ค่าที่
 * ไฟล์นี้แก้จึงค้างไปถึงไฟล์อื่น ต้องเก็บค่าเดิมไว้แล้วคืนให้ครบเสมอ ไม่งั้นไฟล์อื่นพังแบบไล่ต้นตอยาก
 * (เจอจริงตอนเขียนเทสต์นี้: เทสต์ไฟล์อื่นแดง 12-17 เคสโดยไม่เกี่ยวกับโค้ดที่แก้เลย) */
const ORIGINAL = await prisma.contract.findUnique({ where: { id: CONTRACT.id } });

test.after(async () => {
  await prisma.contract.update({
    where: { id: CONTRACT.id },
    data: { abbyySkillId: ORIGINAL?.abbyySkillId ?? null, projectName: ORIGINAL?.projectName ?? CONTRACT.projectName },
  });
  await prisma.$disconnect();
});

/** ฟิลด์บังคับของ updateContract() — เทสต์นี้สนใจแค่ abbyySkillId ที่เหลือส่งค่าเดิมไปให้ครบ */
function baseInput() {
  return {
    contractId: CONTRACT.id,
    poNo: CONTRACT.poNo,
    contractNo: CONTRACT.contractNo,
    projectName: CONTRACT.projectName,
    startDate: CONTRACT.startDate,
    endDate: CONTRACT.endDate,
    customerNameTh: CUSTOMER.nameTh,
    taxId: CUSTOMER.taxId,
    actor: 'เทสต์',
  };
}

test('แก้สัญญาโดยไม่ส่ง abbyySkillId มา ต้องไม่ล้างค่าที่ตั้งไว้', async () => {
  await prisma.contract.update({ where: { id: CONTRACT.id }, data: { abbyySkillId: 'skill-bigc-123' } });

  await updateContract({ ...baseInput(), projectName: 'แก้ชื่อโครงการ' });

  const after = await prisma.contract.findUnique({ where: { id: CONTRACT.id } });
  assert.equal(after?.abbyySkillId, 'skill-bigc-123', 'ค่าที่ตั้งไว้ต้องอยู่ครบเมื่อฟอร์มไม่ได้ส่งฟิลด์นี้มา');
  assert.equal(after?.projectName, 'แก้ชื่อโครงการ', 'ฟิลด์อื่นต้องยังแก้ได้ตามปกติ');
});

test('ส่ง abbyySkillId มาตรงๆ ยังตั้งค่าและล้างค่าได้ตามเดิม', async () => {
  await prisma.contract.update({ where: { id: CONTRACT.id }, data: { abbyySkillId: 'skill-เดิม' } });

  await updateContract({ ...baseInput(), abbyySkillId: 'skill-ใหม่' });
  assert.equal((await prisma.contract.findUnique({ where: { id: CONTRACT.id } }))?.abbyySkillId, 'skill-ใหม่');

  // ส่ง null มาตรงๆ = ตั้งใจล้าง ต้องล้างได้จริง (ต่างจาก "ไม่ส่งคีย์มาเลย")
  await updateContract({ ...baseInput(), abbyySkillId: null });
  assert.equal((await prisma.contract.findUnique({ where: { id: CONTRACT.id } }))?.abbyySkillId, null);
});
