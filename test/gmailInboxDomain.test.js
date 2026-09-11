/**
 * ทดสอบ senderDomain() ใน src/service.js — ตัวกรองชั้นที่สองของการกรองกล่อง Gmail ตามโดเมนบริษัท
 *
 * ทำไมต้องมีเทสต์นี้: คำค้นของ Gmail (ชั้นที่หนึ่ง) เป็น full-text search — เจอคำว่าโดเมนที่ไหนในอีเมล
 * ก็ถือว่าตรง (เช่น อยู่ใน CC/ลายเซ็นอ้างอิง/หัวอีเมลที่ถูก forward มา) พบจริงว่ามีอีเมลคนละโดเมนเล็ดลอด
 * ผ่านมาได้ (4 ก.ย. 69) senderDomain() คือด่านที่สองที่กันเคสนี้ไว้จริง ๆ ด้วยการเทียบโดเมนของ "ผู้ส่งจริง"
 * (From) เท่านั้น — พังจุดนี้ = อีเมลบริษัทอื่นเล็ดลอดเข้ามาปนในรายการที่กรองไว้อีกครั้ง
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { senderDomain } from '../src/service.js';

test('senderDomain ดึงโดเมนจาก "ชื่อ <user@domain.com>" ได้', () => {
  assert.equal(senderDomain('Supranee Suwannates <supranee.s@ipassion.co.th>'), 'ipassion.co.th');
});

test('senderDomain ดึงโดเมนจากที่อยู่เปล่า ๆ ไม่มีชื่อกำกับได้เหมือนกัน', () => {
  assert.equal(senderDomain('test@example.com'), 'example.com');
});

test('senderDomain ตัดพิมพ์เล็ก/ใหญ่ให้เทียบกันได้เสมอ', () => {
  assert.equal(senderDomain('Someone <User@ExAmple.COM>'), 'example.com');
});

test('senderDomain คืน null ถ้าไม่มี "@" เลย (กันพัง ไม่ใช่โดเมนปลอม)', () => {
  assert.equal(senderDomain('ไม่มีอีเมลอยู่ในนี้เลย'), null);
});

test('senderDomain คืน null ถ้าไม่ได้ส่งค่ามาเลย (null/undefined)', () => {
  assert.equal(senderDomain(null), null);
  assert.equal(senderDomain(undefined), null);
});

/* เคสจริงที่พบ (4 ก.ย. 69): กรองบริษัท ipassion.co.th อยู่ แต่มีอีเมลจากโดเมนอื่น (มหาวิทยาลัย) เล็ดลอด
   เข้ามาเพราะคำว่า "ipassion.co.th" ไปโผล่อยู่ที่อื่นในอีเมลฉบับนั้น (เช่น ถูก CC หรือถูกอ้างถึงในเนื้อหา) —
   senderDomain() ต้องตัดสินจาก "ผู้ส่งจริง" เท่านั้น ไม่ใช่จากที่คำค้นไปเจอมา */
test('เคสจริง: อีเมลจากโดเมนมหาวิทยาลัยต้องไม่ถูกนับว่าเป็นของบริษัทที่กรองไว้ แม้ Gmail search จะเจอมาก็ตาม', () => {
  const from = 'NICHAPHAT CHOKRAK <s6607012663077@email.kmutnb.ac.th>';
  assert.notEqual(senderDomain(from), 'ipassion.co.th');
  assert.equal(senderDomain(from), 'email.kmutnb.ac.th');
});
