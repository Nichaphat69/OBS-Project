/**
 * ทดสอบการแปลงผลของ Clear Read → รูปกลาง โดยเฉพาะ "การตรวจจับวันลา" (17 ก.ย. 69)
 *
 * ทำไมเทสชุดนี้ถึงสำคัญกว่าที่เห็น: ยอดในใบแจ้งหนี้คือ ค่าจ้างรายเดือน − ส่วนลดวันลา ดังนั้นการอ่าน
 * วันลาไม่เจอ = เก็บเงินลูกค้าเกิน โดยไม่มีอะไรฟ้อง เดิมโค้ดฝั่ง Clear Read ดูแค่ช่อง `Leave_Type`
 * ช่องเดียว ซึ่งแคบกว่าฝั่ง ABBYY ที่ใช้ classifyDayKind() ดูหลายช่อง — ฟอร์มที่เขียนวันลาไว้ที่อื่น
 * จึงเงียบหายไปทั้งใบ เทสพวกนี้ตรึงพฤติกรรมไว้ไม่ให้ถอยกลับไปแบบนั้นอีก
 *
 * ทั้งหมดเป็น unit test ล้วน ป้อน payload ที่มีรูปเดียวกับที่ /inquiry/ocr-detail คืนมาจริง ไม่ยิงไปที่
 * บริการของ Clear Read เลยสักครั้ง (ทั้งเพราะการอ่าน 1 ไฟล์ใช้เวลาหลายนาที+กินเครดิต และเพราะ user
 * สั่งไว้ว่าจะทดสอบกับของจริงเอง)
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { mapClearReadResult } from '../src/lib/clearReadClient.js';

/** payload รูปเดียวกับที่ Clear Read คืนมาจริง — fields เป็น array แบน มี TimesheetDetails หนึ่งรายการ
 * ที่ value เป็น array ของแถว (ดูตัวอย่างจริงในคอมเมนต์หัว clearReadClient.ts) */
function detailWith(rows: Array<Record<string, unknown>>, monthYear = 'Feb 2026') {
  return {
    fields: [
      { key_field: 'Employee_Name', value: 'Korravit Soodnalao' },
      { key_field: 'Month_Year', value: monthYear },
      { key_field: 'TimesheetDetails', value: rows },
    ],
  };
}

const workRow = (day: number, extra: Record<string, unknown> = {}) => ({
  Date: `${String(day).padStart(2, '0')}/02/2026`,
  Normal_Hours: 8,
  Time_In: '09:00',
  Time_Out: '18:00',
  ...extra,
});

test('วันลาอยู่ในช่อง Leave_Type ตามปกติ — นับได้', () => {
  const d: any = mapClearReadResult(detailWith([workRow(3, { Leave_Type: 'Sick Leave', Normal_Hours: null })]));
  assert.equal(d.leaveDays.length, 1);
  assert.equal(d.leaveDays[0].date, '2026-02-03');
  assert.equal(d.leaveDays[0].type, 'sick');
  assert.equal(d.totalLeaveDays, 1);
});

test('วันลาไปอยู่ในช่อง Work_Type แทน (ฟอร์มไม่มีช่อง Leave_Type) — ต้องยังนับได้', () => {
  const d: any = mapClearReadResult(detailWith([workRow(4, { Work_Type: 'Vacation Leave', Normal_Hours: null })]));
  assert.equal(d.leaveDays.length, 1, 'อ่านวันลาจากช่องประเภทวันไม่เจอ = ส่วนลดหายทั้งใบ');
  assert.equal(d.leaveDays[0].type, 'vacation');
});

test('วันลาเขียนเป็นคำไทยล้วนในช่องอื่น ("ลากิจ") — ต้องนับได้', () => {
  const d: any = mapClearReadResult(detailWith([workRow(5, { Activity: 'ลากิจ', Normal_Hours: null })]));
  assert.equal(d.leaveDays.length, 1);
  assert.equal(d.leaveDays[0].type, 'personal');
});

test('ช่องรายละเอียดงานเป็นคำว่าลาพอดีทั้งช่อง — นับได้ (เทียบแบบทั้งช่อง ไม่ใช่ substring)', () => {
  const d: any = mapClearReadResult(detailWith([workRow(6, { Job_Description: 'ลาป่วย', Normal_Hours: null })]));
  assert.equal(d.leaveDays.length, 1);
  assert.equal(d.leaveDays[0].type, 'sick');
});

test('รายละเอียดงานยาวๆที่บังเอิญมีคำว่า leave ปนอยู่ — ต้องไม่นับเป็นวันลา', () => {
  const d: any = mapClearReadResult(
    detailWith([workRow(9, { Job_Description: '1. Daily meeting\n2. Prepare leave policy document for HR' })]),
  );
  assert.equal(d.leaveDays.length, 0, 'ข้อความงานที่พูดถึงเรื่องลา ไม่ใช่วันลาของพนักงานคนนี้');
  assert.equal(d.totalWorkDays, 1);
});

test('วันหยุดนักขัตฤกษ์ต้องไม่ถูกนับเป็นวันลา (วันหยุดมาก่อนวันลาเสมอ)', () => {
  const d: any = mapClearReadResult(
    detailWith([workRow(10, { Work_Type: 'Public Holiday', Job_Description: 'วันแรงงานแห่งชาติ', Normal_Hours: null })]),
  );
  assert.equal(d.leaveDays.length, 0);
});

test('เสาร์-อาทิตย์ไม่ถูกนับเป็นวันลา', () => {
  const d: any = mapClearReadResult(detailWith([workRow(7, { Day: 'Sat', Work_Type: 'Weekend', Normal_Hours: null })]));
  assert.equal(d.leaveDays.length, 0);
});

test('วันทำงานปกติไม่ถูกนับเป็นวันลา และนับเป็นวันทำงาน', () => {
  const d: any = mapClearReadResult(detailWith([workRow(2), workRow(3)]));
  assert.equal(d.leaveDays.length, 0);
  assert.equal(d.totalWorkDays, 2);
});

test('summary.* ต้องว่างเสมอ — Clear Read อ่านช่องสรุปท้ายเอกสารไม่ได้ ห้ามเอายอดที่นับเองไปใส่แทน', () => {
  const d: any = mapClearReadResult(detailWith([workRow(2), workRow(3)]));
  assert.equal(d.summary, undefined);
  assert.equal(d.totalWorkDays, 2, 'ยอดที่นับเองยังต้องอยู่ที่ totalWorkDays ตามเดิม');
  assert.ok(
    d.notes.some((n: string) => n.includes('ช่องสรุป')),
    'ต้องมีหมายเหตุบอกผู้ใช้ว่าอ่านช่องสรุปไม่ได้',
  );
});

test('อ่านตารางได้แต่ไม่มีชั่วโมงเลยสักแถว — ต้องเตือน ไม่ปล่อยให้ 0 ผ่านไปเงียบๆ', () => {
  const d: any = mapClearReadResult(detailWith([workRow(2, { Normal_Hours: null, Time_In: null, Time_Out: null })]));
  assert.equal(d.totalWorkDays, 0);
  assert.ok(d.notes.some((n: string) => n.includes('ไม่มีแถวไหนมีชั่วโมงทำงานปกติเลย')));
});

test('ปีเพี้ยนจากการอ่านผิด (1900) ถูกทิ้งทั้งแถว ไม่ไปทำให้การนับวันเพี้ยน', () => {
  const d: any = mapClearReadResult(
    detailWith([workRow(2), { Date: '26/01/1900', Normal_Hours: 8 }]),
  );
  assert.equal(d.days.length, 1);
  assert.equal(d.totalWorkDays, 1);
});

test('แปลงรอบเดือนจากภาษาไทยได้ และคีย์รายวันเป็นชื่อตามสเปกกลาง', () => {
  // ตัวย่อเดือนไทยมีจุดคั่นกลาง ("พ.ค.") ซึ่งเคยตัดคำผิดจนอ่านรอบเดือนไม่ออกมาก่อน
  const d: any = mapClearReadResult(
    detailWith([workRow(2, { Work_Type: 'Working', Day: 'Mon', Remarks: 'ok' })], 'พ.ค. - 2026'),
  );
  assert.equal(d.period, '2026-05');
  // คีย์ตามสเปก — extractionService.normalizeDetailKeys() เป็นคนแปลงเป็น dayOfWeek/remark/type ทีหลัง
  const keys = Object.keys(d.days[0]);
  for (const spec of ['workType', 'day', 'remarks']) {
    assert.ok(keys.includes(spec), `ต้องปล่อยออกเป็นคีย์สเปก "${spec}" ไม่ใช่คีย์ภายใน`);
  }
  for (const internal of ['type', 'dayOfWeek', 'remark']) {
    assert.ok(!keys.includes(internal), `ยังไม่ควรมีคีย์ภายใน "${internal}" ที่ชั้นนี้`);
  }
});
