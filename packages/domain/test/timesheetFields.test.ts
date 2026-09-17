/**
 * สารบัญฟิลด์กลางต้องเป็นไปตาม Master Template V4
 *
 * เทสชุดนี้มีไว้บังคับ CORE RULE ของสเปก — "ชื่อฟิลด์ต้องไม่ซ้ำกันเลยทั้ง schema" — ให้เป็นกติกาที่
 * ตรวจได้จริง ไม่ใช่ข้อตกลงที่ทุกคนต้องจำเอง สารบัญเดิมละเมิดข้อนี้อยู่สองจุด (`Site` กับ `Total_Hours`
 * ถูกใช้ทั้งระดับเอกสารและระดับแถว) ซึ่งเป็นสองจุดที่เอกสาร V4 เขียนถึงมากที่สุด เทสพวกนี้กันไม่ให้
 * ความซ้ำกลับมาอีกตอนมีคนเพิ่มฟิลด์ใหม่ในอนาคต
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TIMESHEET_HEADER_FIELDS,
  TIMESHEET_DETAIL_FIELDS,
  TIMESHEET_SUMMARY_FIELDS,
  TIMESHEET_SIGNATURE_FIELDS,
  TIMESHEET_DOCUMENT_FIELDS,
  DETAIL_SPEC_KEY_ALIASES,
  HEADER_SPEC_KEY_ALIASES,
  toInternalDetailKey,
  toInternalHeaderKey,
  headerField,
  detailField,
  type TimesheetFieldSpec,
} from '../src/timesheetFields.js';
import { TIMESHEET_MASTER_PROMPT, FORBIDDEN_FIELD_NAMES } from '../src/timesheetPrompt.js';

const ALL_FIELDS: TimesheetFieldSpec[] = [...TIMESHEET_DOCUMENT_FIELDS, ...TIMESHEET_DETAIL_FIELDS];

/** คืนค่าที่ซ้ำพร้อมจำนวน เพื่อให้ข้อความ error บอกได้ว่าซ้ำตัวไหน ไม่ใช่แค่ "ซ้ำ" */
function duplicates(values: string[]): string[] {
  const seen = new Map<string, number>();
  for (const v of values) seen.set(v, (seen.get(v) ?? 0) + 1);
  return [...seen.entries()].filter(([, n]) => n > 1).map(([v, n]) => `${v} (×${n})`);
}

test('CORE RULE ของ V4 — ชื่อฟิลด์ (name) ต้องไม่ซ้ำกันเลยทั้ง schema ข้ามทุกระดับ', () => {
  assert.deepEqual(duplicates(ALL_FIELDS.map((f) => f.name)), []);
});

test('คีย์ภายใน (key) ก็ต้องไม่ซ้ำเช่นกัน ไม่งั้น lookup จะได้ฟิลด์ผิดระดับ', () => {
  assert.deepEqual(duplicates(ALL_FIELDS.map((f) => f.key)), []);
});

test('ชื่อที่ V4 สั่งห้ามใช้ ต้องไม่หลงเหลืออยู่ในสารบัญ', () => {
  for (const [forbidden, replacement] of Object.entries(FORBIDDEN_FIELD_NAMES)) {
    const found = ALL_FIELDS.find((f) => f.name === forbidden);
    assert.equal(found, undefined, `ยังมีฟิลด์ชื่อ "${forbidden}" อยู่ — ต้องใช้ ${replacement} แทน`);
  }
});

test('ฟิลด์ที่แยกจากกันตาม V4 มีอยู่ครบทั้งคู่ และอยู่คนละระดับกันจริง', () => {
  // สถานที่: ระดับเอกสาร vs ระดับแถว
  assert.ok(headerField('documentSite'), 'Document_Site ต้องอยู่ระดับเอกสาร');
  assert.ok(detailField('dailySite'), 'Daily_Site ต้องอยู่ระดับแถว');
  assert.equal(detailField('documentSite'), null, 'Document_Site ต้องไม่โผล่ในระดับแถว');
  assert.equal(headerField('dailySite'), null, 'Daily_Site ต้องไม่โผล่ในระดับเอกสาร');

  // ชั่วโมงรวม: รายวัน vs ทั้งงวด
  assert.ok(detailField('dailyTotalHours'), 'Daily_Total_Hours ต้องอยู่ระดับแถว');
  assert.ok(headerField('monthlyTotalHours'), 'Monthly_Total_Hours ต้องอยู่ระดับเอกสาร');
  assert.equal(headerField('dailyTotalHours'), null);
  assert.equal(detailField('monthlyTotalHours'), null);
});

test('วันลา 3 ช่องของ V4 มีครบ — ช่องรวม แยกจากช่องลา และช่องป่วย', () => {
  for (const key of ['totalLeaveSickDays', 'totalLeaveDays', 'totalSickDays']) {
    assert.ok(headerField(key), `ขาดช่องสรุป ${key}`);
  }
  // ช่องรวมต้องบอกชัดในคำอธิบายว่าห้ามแตกลงสองช่อง เพราะนี่คือข้อที่ทำให้ตัวเลขวันลาเพี้ยนได้
  assert.match(headerField('totalLeaveSickDays')!.description, /Do not split/i);
});

test('ทุกฟิลด์มีคำอธิบายที่ส่งให้เครื่องอ่านจริง ไม่ปล่อยว่าง', () => {
  for (const f of ALL_FIELDS) {
    assert.ok(f.description.trim().length > 20, `${f.name} คำอธิบายสั้นเกินไปจนใช้สั่งเครื่องอ่านไม่ได้`);
    assert.ok(f.label.trim().length > 0, `${f.name} ไม่มีป้ายภาษาไทย`);
    assert.ok(['text', 'number'].includes(f.type), `${f.name} type ไม่ถูกต้อง`);
  }
});

test('ตารางแปลงคีย์สเปก→ชื่อที่ระบบเก็บจริง ชี้ไปยังคีย์ที่มีอยู่จริงในสารบัญ', () => {
  for (const specKey of Object.keys(DETAIL_SPEC_KEY_ALIASES)) {
    assert.ok(detailField(specKey), `คีย์ตามสเปก "${specKey}" ไม่มีอยู่ใน TIMESHEET_DETAIL_FIELDS`);
  }
  for (const specKey of Object.keys(HEADER_SPEC_KEY_ALIASES)) {
    assert.ok(headerField(specKey), `คีย์ตามสเปก "${specKey}" ไม่มีอยู่ในฟิลด์ระดับเอกสาร`);
  }
});

test('คีย์ที่ไม่ได้อยู่ในตารางแปลง ต้องคืนค่าเดิม ไม่ใช่ undefined', () => {
  assert.equal(toInternalDetailKey('timeIn'), 'timeIn');
  assert.equal(toInternalHeaderKey('employeeName'), 'employeeName');
  // สองจุดที่ V4 เปลี่ยนชื่อ แต่คอลัมน์ในฐานข้อมูลยังชื่อเดิม
  assert.equal(toInternalDetailKey('dailySite'), 'site');
  assert.equal(toInternalDetailKey('dailyTotalHours'), 'totalHours');
  assert.equal(toInternalHeaderKey('documentSite'), 'site');
  assert.equal(toInternalHeaderKey('monthlyTotalHours'), 'totalHours');
  assert.equal(toInternalHeaderKey('approvedByName'), 'approverName');
});

test('ฟิลด์ระดับเอกสารรวมครบทั้งสามหมวด — หัวเอกสาร ช่องสรุป และลายเซ็น', () => {
  assert.equal(
    TIMESHEET_DOCUMENT_FIELDS.length,
    TIMESHEET_HEADER_FIELDS.length + TIMESHEET_SUMMARY_FIELDS.length + TIMESHEET_SIGNATURE_FIELDS.length,
  );
  assert.ok(headerField('employeeSignatureName'), 'ฟิลด์ลายเซ็นต้องหาเจอผ่าน headerField()');
});

test('prompt กลางมีกติกาที่เป็นหัวใจของ V4 ครบ — ถ้าใครตัดทิ้งต้องรู้ตัว', () => {
  for (const rule of [
    'Never use the field name Total_Hours',
    'Do not use the field name Site',
    'Do not infer leave from blank hours',
    'Do not copy one combined Leave/Sick value',
    'Work_Location is reserved for working arrangement',
  ]) {
    assert.ok(TIMESHEET_MASTER_PROMPT.includes(rule), `prompt กลางขาดกติกา: "${rule}"`);
  }
});

test('ชื่อฟิลด์ที่ prompt อ้างถึง ต้องมีอยู่จริงในสารบัญ ไม่งั้นสั่งให้อ่านลงช่องที่ไม่มี', () => {
  const names = new Set(ALL_FIELDS.map((f) => f.name));
  // ชื่อที่ prompt ระบุเป็นปลายทางของการ map (ฝั่งขวาของลูกศร) ต้องมีอยู่จริงทุกตัว
  for (const target of [
    'Time_In', 'Time_Out', 'Normal_Hours', 'OT_Hours', 'Daily_Total_Hours', 'Total_OT_Hours',
    'Monthly_Total_Hours', 'Total_Normal_Hours', 'Total_Leave_Sick_Days', 'Total_Leave_Days',
    'Total_Sick_Days', 'Daily_Site', 'Document_Site', 'Work_Location', 'Approved_By_Name',
    'Employee_Signature_Name', 'Job_Description',
  ]) {
    assert.ok(names.has(target), `prompt อ้างถึงฟิลด์ "${target}" แต่สารบัญไม่มี`);
  }
});
