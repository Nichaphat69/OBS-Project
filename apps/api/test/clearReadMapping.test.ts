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

test('เอกสารไม่มีช่องสรุป — summary ต้องเป็น undefined ห้ามเอายอดที่นับเองไปใส่แทน', () => {
  // (ตั้งแต่ V4 แม่แบบมีช่องสรุปได้แล้ว เทสนี้จึงคุมเฉพาะ "กรณีที่เอกสารไม่มี" ไม่ใช่ว่าเติมไม่ได้เลย
  //  กรณีที่มีช่องสรุปดูเทสกลุ่ม V4 ด้านล่าง)
  const d: any = mapClearReadResult(detailWith([workRow(2), workRow(3)]));
  assert.equal(d.summary, undefined);
  assert.equal(d.totalWorkDays, 2, 'ยอดที่นับเองยังต้องอยู่ที่ totalWorkDays ตามเดิม');
  assert.ok(
    d.notes.some((n: string) => n.includes('ช่องสรุป')),
    'ต้องมีหมายเหตุบอกผู้ใช้ว่าไม่ได้ค่าช่องสรุปมา',
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

// ── Master Template V4 ────────────────────────────────────────────
// V4 มี CORE RULE ว่าชื่อฟิลด์ห้ามซ้ำกันทั้ง schema จึงแยก site/totalHours เป็นระดับเอกสารกับระดับแถว
// เทสกลุ่มนี้ตรึงไว้สองอย่าง: (1) ชื่อ V4 ไปลงคีย์ที่ถูก (2) แม่แบบรุ่นเก่าที่ยังไม่อัปเดตต้องยังอ่านได้
// ข้อ (2) สำคัญเพราะ prompt อยู่ในแม่แบบฝั่ง Clear Read เราบังคับให้อัปพร้อมกันไม่ได้

function docFields(extra: Record<string, unknown>, rows: Array<Record<string, unknown>> = []) {
  return {
    fields: [
      { key_field: 'Employee_Name', value: 'Somchai' },
      { key_field: 'Month_Year', value: 'Feb 2026' },
      ...Object.entries(extra).map(([key_field, value]) => ({ key_field, value })),
      { key_field: 'TimesheetDetails', value: rows },
    ],
  };
}

test('V4: Document_Site ลงคีย์ site ระดับเอกสาร และ Approved_By_Name ลง approverName', () => {
  const d: any = mapClearReadResult(docFields({ Document_Site: 'สำนักงานใหญ่', Approved_By_Name: 'Nichaphat' }));
  assert.equal(d.site, 'สำนักงานใหญ่');
  assert.equal(d.approverName, 'Nichaphat');
});

test('แม่แบบรุ่นเก่า (Site / Approver_Name) ต้องยังอ่านได้ ไม่หายเงียบๆ', () => {
  const d: any = mapClearReadResult(docFields({ Site: 'สาขา 2', Approver_Name: 'Supranee' }));
  assert.equal(d.site, 'สาขา 2', 'แม่แบบที่ยังไม่อัปเป็น V4 ต้องไม่ทำให้ค่าหาย');
  assert.equal(d.approverName, 'Supranee');
});

test('V4: Daily_Site / Daily_Total_Hours ลงคีย์รายวันที่ถูก', () => {
  const d: any = mapClearReadResult(
    docFields({}, [{ Date: '02/02/2026', Daily_Site: 'PTT', Daily_Total_Hours: 8, Normal_Hours: 8 }]),
  );
  assert.equal(d.days[0].dailySite, 'PTT');
  assert.equal(d.days[0].dailyTotalHours, 8);
});

test('แม่แบบรุ่นเก่า (Customer_site / Total_Hours) ต้องยังลงคีย์รายวันเดียวกันได้', () => {
  const d: any = mapClearReadResult(
    docFields({}, [{ Date: '02/02/2026', Customer_site: 'PTT', Total_Hours: 8, Normal_Hours: 8 }]),
  );
  assert.equal(d.days[0].dailySite, 'PTT');
  assert.equal(d.days[0].dailyTotalHours, 8);
});

test('ช่องสรุปลง summary.* ไม่ทับค่าที่ระบบใช้ตั้งบิล', () => {
  const d: any = mapClearReadResult(
    docFields({ Total_Work_Days: 19, Monthly_Total_Hours: 152 }, [
      { Date: '02/02/2026', Normal_Hours: 8 },
      { Date: '03/02/2026', Normal_Hours: 8 },
    ]),
  );
  assert.equal(d.summary.totalWorkDays, 19, 'เลขที่เอกสารพิมพ์ไว้');
  assert.equal(d.totalWorkDays, 2, 'เลขที่ระบบนับเอง ต้องไม่ถูกช่องสรุปทับ');
  assert.equal(d.summary.totalHours, 152, 'Monthly_Total_Hours ต้องลง summary ไม่ใช่ระดับแถว');
});

test('ค่าลารวมช่องเดียว ต้องไม่ถูกกระจายลงช่องลา/ป่วยแยก', () => {
  const d: any = mapClearReadResult(docFields({ Total_Leave_Sick_Days: 2 }));
  assert.equal(d.summary.totalLeaveSickDays, 2);
  assert.equal(d.summary.totalLeaveDays, undefined, 'ห้ามเอาค่ารวมไปใส่ช่องแยก');
  assert.equal(d.summary.totalSickDays, undefined);
});

test('อ่านช่องสรุปได้แล้ว ต้องไม่เตือนว่าอ่านไม่ได้ (เตือนตามสภาพจริง)', () => {
  const withSummary: any = mapClearReadResult(docFields({ Total_Work_Days: 19 }));
  assert.ok(!withSummary.notes.some((n: string) => n.includes('ไม่ได้ค่าช่องสรุป')));

  const without: any = mapClearReadResult(docFields({}));
  assert.ok(without.notes.some((n: string) => n.includes('ไม่ได้ค่าช่องสรุป')));
  assert.equal(without.summary, undefined, 'ไม่รู้ ต้องเป็น undefined ไม่ใช่ 0');
});

test('Working_Time (ฟอร์ม Fujitsu/V-Link) ต้องนับเป็นชั่วโมงทำงานปกติ ไม่งั้นวันทำงานเป็น 0 ทั้งใบ', () => {
  // ค่าจริงจากเอกสาร 2 ใบ: Working_Time="8.00" ส่วน Normal_Hours ว่างทุกแถว
  const d: any = mapClearReadResult(
    detailWith([
      { Date: '03/02/2026', Working_Time: '8.00', Time_In: '9:00', Time_Out: '18:00' },
      { Date: '04/02/2026', Working_Time: '8.00', Time_In: '9:00', Time_Out: '18:00' },
      { Date: '01/02/2026', Working_Time: '0.00' },
    ]),
  );
  assert.equal(d.days[0].normalHours, 8);
  assert.equal(d.totalWorkDays, 2, 'แถวที่ 0.00 ไม่ใช่วันทำงาน — ต้องนับได้ 2 วัน ไม่ใช่ 0');
});

test('ถ้าแม่แบบมีทั้ง Normal_Hours และ Working_Time — ชื่อตามสเปกต้องชนะ ค่าเก่าห้ามมาทับ', () => {
  const d: any = mapClearReadResult(
    detailWith([{ Date: '03/02/2026', Normal_Hours: 7, Working_Time: '8.00' }]),
  );
  assert.equal(d.days[0].normalHours, 7, 'ค่าจากช่องตามสเปกต้องอยู่ ไม่ถูกช่องชื่อเก่าทับ');
});

// ── "มาทำงานไหม" กับ "กี่ชั่วโมง" เป็นคนละคำถาม ─────────────────────
// ฟอร์มหลายเจ้า (T8/TSG/ThaiLife) มีแค่เวลาเข้า-ออก ไม่มีคอลัมน์ชั่วโมงเลย ถ้านับวันทำงานจากชั่วโมง
// อย่างเดียวจะได้ 0 วันทั้งใบ — แต่ห้ามคำนวณชั่วโมงจากเวลาเข้า-ออกมาเติมแทน เพราะไม่รู้เวลาพัก

test('แถวมีแค่เวลาเข้า-ออก ไม่มีคอลัมน์ชั่วโมง — ต้องนับเป็นวันทำงาน', () => {
  const d: any = mapClearReadResult(
    detailWith([
      { Date: '03/02/2026', Time_In: '9:00', Time_Out: '18:00' },
      { Date: '04/02/2026', Time_In: '9:00', Time_Out: '18:00' },
    ]),
  );
  assert.equal(d.totalWorkDays, 2, 'ฟอร์มที่ไม่มีคอลัมน์ชั่วโมงต้องไม่ได้ 0 วันทั้งใบ');
});

test('ห้ามเดาชั่วโมงจากเวลาเข้า-ออก — ต้องปล่อยว่างไว้', () => {
  const d: any = mapClearReadResult(detailWith([{ Date: '03/02/2026', Time_In: '9:00', Time_Out: '18:00' }]));
  // ฟอร์มไม่มีคอลัมน์ชั่วโมงเลย ค่าจึงเป็น undefined (ไม่ใช่ null) — ที่ต้องยืนยันคือ "ไม่มีตัวเลขถูกเดาขึ้นมา"
  assert.equal(typeof d.days[0].normalHours, 'undefined', 'เวลาเข้า-ออกไม่ได้บอกเวลาพัก ตัวเลขที่เดาจะผิดแต่ดูน่าเชื่อถือ');
  assert.equal(d.totalWorkDays, 1, 'ยังต้องนับเป็นวันทำงานได้ แม้ไม่รู้ชั่วโมง');
});

test('เอกสารบอกเองว่า 0 ชั่วโมง — ไม่ใช่วันทำงาน และไม่ตกไปดูเวลาเข้า-ออกต่อ', () => {
  const d: any = mapClearReadResult(
    detailWith([{ Date: '03/02/2026', Normal_Hours: 0, Time_In: '9:00', Time_Out: '18:00' }]),
  );
  assert.equal(d.totalWorkDays, 0, '"0" คือเอกสารบอกว่าไม่ได้ทำงาน ต่างจาก "ไม่รู้"');
});

test('วันลาที่มีเวลาเข้า-ออกติดมาด้วย ต้องไม่ถูกนับเป็นวันทำงาน', () => {
  const d: any = mapClearReadResult(
    detailWith([{ Date: '03/02/2026', Leave_Type: 'Sick Leave', Time_In: '9:00', Time_Out: '18:00' }]),
  );
  assert.equal(d.totalWorkDays, 0);
  assert.equal(d.totalLeaveDays, 1);
});

// ── เขียนกลับแม่แบบ — เฉพาะการเพิ่ม ไม่ทดสอบกับ service จริง ─────────────
// (ไม่มี mock ของ /update/template เพราะยิงจริงเข้าไปครั้งเดียวแล้วยืนยันด้วยมือแล้ว เทสนี้แค่คุม
// ว่า mapping รับ Document_Site ที่เพิ่งเพิ่มเข้าไปในแม่แบบได้ถูกต้อง)
test('Document_Site ที่เพิ่งเพิ่มในแม่แบบ ต้องแมปเข้า site ได้เหมือน Site เดิม', () => {
  const d: any = mapClearReadResult(docFields({ Document_Site: 'สำนักงานใหญ่' }));
  assert.equal(d.site, 'สำนักงานใหญ่');
});

/* ── ชื่อเก่าระดับเอกสารต้องไม่ทับค่าของชื่อตามสเปก (18 ก.ย. 69) ─────────────────────────────────
   แม่แบบ Master Template สะกด `Customer_Site` (S ใหญ่) ไว้ระดับเอกสาร แต่ alias เดิมมีแต่
   `Customer_site` (s เล็ก) ซึ่งเป็นคนละคีย์ ค่าที่อ่านมาได้จึงถูกทิ้งทั้งหมด พอรับเข้ามาลงคีย์เดียวกับ
   `Document_Site` แล้ว ต้องมีด่านกันทับด้วย ไม่งั้นช่องที่ว่างจะลบค่าที่อ่านมาได้ตามลำดับคีย์ใน JSON
   ซึ่งควบคุมไม่ได้ — ฝั่งรายวันมีด่านนี้มาตั้งแต่แรก ระดับเอกสารเพิ่งมี */
test('Customer_Site (S ใหญ่) ต้องอ่านเข้า site ได้ ไม่ใช่ถูกทิ้งเพราะตัวพิมพ์ไม่ตรง alias', () => {
  const d: any = mapClearReadResult(docFields({ Customer_Site: 'สาขาลาดพร้าว' }));
  assert.equal(d.site, 'สาขาลาดพร้าว');
});

test('มีทั้ง Document_Site และ Customer_Site — Document_Site ชนะเสมอ ไม่ว่าคีย์ไหนมาก่อน', () => {
  const specFirst: any = mapClearReadResult(docFields({ Document_Site: 'สำนักงานใหญ่', Customer_Site: 'สาขาลาดพร้าว' }));
  assert.equal(specFirst.site, 'สำนักงานใหญ่');
  const legacyFirst: any = mapClearReadResult(docFields({ Customer_Site: 'สาขาลาดพร้าว', Document_Site: 'สำนักงานใหญ่' }));
  assert.equal(legacyFirst.site, 'สำนักงานใหญ่', 'ลำดับคีย์ใน JSON ต้องไม่เปลี่ยนผลลัพธ์');
});

test('Customer_Site ที่ว่าง ต้องไม่ลบค่าที่ Document_Site อ่านมาได้แล้ว', () => {
  const d: any = mapClearReadResult(docFields({ Document_Site: 'สำนักงานใหญ่', Customer_Site: '' }));
  assert.equal(d.site, 'สำนักงานใหญ่');
});

test('Place ในตารางรายวันต้องอ่านเข้า dailySite และ Daily_Site ชนะเมื่อมีทั้งคู่', () => {
  const only: any = mapClearReadResult(docFields({}, [workRow(2, { Place: 'ไซต์บางนา' })]));
  assert.equal(only.days[0].dailySite, 'ไซต์บางนา');
  const both: any = mapClearReadResult(docFields({}, [workRow(3, { Place: 'ไซต์บางนา', Daily_Site: 'ไซต์พระราม 9' })]));
  assert.equal(both.days[0].dailySite, 'ไซต์พระราม 9');
});
