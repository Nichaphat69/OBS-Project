/**
 * ตัวเดาชื่อฟิลด์จาก Timesheet ตัวอย่าง — ยิงเข้าตัวจับคู่ตรงๆ ด้วย "ป้ายที่อ่านได้จากเอกสาร"
 * ไม่ต้องมีไฟล์ PDF จริง
 *
 * ป้ายในเทสต์นี้ไม่ได้แต่งขึ้น — คัดมาจากฟอร์มจริงของลูกค้าที่เคยอ่านมาแล้วทั้ง 7 แบบ รวมถึงคำที่
 * เขาสะกดผิดแล้วยังใช้อยู่จริง (`Vender`, `Job Discription`) เพราะนั่นคือสิ่งที่ตัวเดาต้องเจอของจริง
 *
 * เหตุที่ต้องมีเทสต์ชุดนี้ — ของเดิมเทียบแค่ชื่อตามสเปกกับป้ายไทย ฟอร์ม CP Axtra เลยเดาได้ 2 จาก 67
 * ฟิลด์ (เจ้าของระบบเจอเองเมื่อ 29 ก.ย. 69) ถ้าไม่ตรึงด้วยเทสต์ ของแบบนี้พังเงียบได้อีก
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { TIMESHEET_DOCUMENT_FIELDS, TIMESHEET_DETAIL_FIELDS } from '@obs/domain';
import { matchFieldLabels } from '../src/lib/fieldMapSuggestService.js';

/** จับคู่ทุกกลุ่มพร้อมกันเหมือนที่ suggestFieldMap ทำจริง แล้วคืนเป็น key → ป้ายที่เดาได้ */
function suggest(labels: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of matchFieldLabels([...TIMESHEET_DOCUMENT_FIELDS, ...TIMESHEET_DETAIL_FIELDS], labels)) {
    if (f.found) out[f.key] = f.found;
  }
  return out;
}

test('CP Axtra (Lotus) — ฟอร์มที่เดิมเดาได้แค่ 2 จาก 67', () => {
  const got = suggest([
    'Vender:', 'Project Name:', 'Resource Name:', 'Project/Team:', 'Month:', 'Year:', 'Contract Role:',
    'NO.', 'Date', 'Type', 'Job Discription', 'Time in', 'Time out', 'Base hours*', 'Additional hours', 'Remark',
  ]);
  assert.equal(got.vendorName, 'Vender:', 'สะกดผิดว่า Vender ก็ต้องจับได้');
  assert.equal(got.employeeName, 'Resource Name:');
  assert.equal(got.projectName, 'Project Name:');
  assert.equal(got.projectTeam, 'Project/Team:');
  assert.equal(got.role, 'Contract Role:');
  assert.equal(got.monthYear, 'Month:');
  assert.equal(got.rowNumber, 'NO.');
  assert.equal(got.date, 'Date');
  assert.equal(got.workType, 'Type');
  assert.equal(got.jobDescription, 'Job Discription', 'สะกดผิดว่า Discription ก็ต้องจับได้');
  assert.equal(got.timeIn, 'Time in');
  assert.equal(got.timeOut, 'Time out');
  assert.equal(got.normalHours, 'Base hours*');
  assert.equal(got.additionalHours, 'Additional hours');
  assert.equal(got.remarks, 'Remark');
  assert.ok(Object.keys(got).length >= 15, `ควรเดาได้อย่างน้อย 15 ฟิลด์ แต่ได้ ${Object.keys(got).length}`);
});

test('BigC — หัวเอกสารใช้แค่ Name: เฉยๆ', () => {
  const got = suggest([
    'Vender:', 'Project Name:', 'Name:', 'Contract Role:',
    'NO.', 'Date', 'Job Discription', 'Time in', 'Time out', 'Base hours*', 'Additional hours', 'Location',
  ]);
  assert.equal(got.employeeName, 'Name:', 'Name เปล่าๆ ต้องเดาเป็นชื่อพนักงาน');
  assert.equal(got.vendorName, 'Vender:');
  assert.equal(got.role, 'Contract Role:');
  assert.equal(got.normalHours, 'Base hours*');
});

test('Thailife — เว้นวรรคหน้าเครื่องหมาย และหัวคอลัมน์ซ้อนสองชั้น', () => {
  const got = suggest([
    'Vendor :', 'Client Name :', 'Project Name :', 'Month / Year :', 'Employee Name',
    'No', 'Date', 'Working Hrs.', 'In', 'Out', 'Job Description', 'Remark',
  ]);
  assert.equal(got.vendorName, 'Vendor :');
  assert.equal(got.clientName, 'Client Name :');
  assert.equal(got.employeeName, 'Employee Name');
  assert.equal(got.monthYear, 'Month / Year :');
  assert.equal(got.timeIn, 'In');
  assert.equal(got.timeOut, 'Out');
  assert.equal(got.normalHours, 'Working Hrs.');
});

test('TSG / อาคเนย์ — คอลัมน์พิมพ์ใหญ่ทั้งคำ', () => {
  const got = suggest(['Site', 'Clock-In', 'Clock-Out', 'CONTENT', 'Work', 'OT', 'Leave', 'Remarks']);
  assert.equal(got.timeIn, 'Clock-In');
  assert.equal(got.timeOut, 'Clock-Out');
  assert.equal(got.jobDescription, 'CONTENT');
  assert.equal(got.normalHours, 'Work');
  assert.equal(got.otHours, 'OT');
  assert.equal(got.leaveType, 'Leave');
  assert.equal(got.remarks, 'Remarks');
});

test('Fujitsu — Total เป็นคอลัมน์รายวัน ไม่ใช่ยอดรวมทั้งงวด', () => {
  const got = suggest([
    'MONTH/YEAR:', 'DATE', 'Working Time', 'IN', 'OUT', 'BREAK', 'Total', 'OverTime',
    'Adjust OT', 'OT Approval', 'Place', 'ACTIVITY',
  ]);
  assert.equal(got.date, 'DATE');
  assert.equal(got.timeIn, 'IN');
  assert.equal(got.timeOut, 'OUT');
  assert.equal(got.breakHours, 'BREAK');
  assert.equal(got.otHours, 'OverTime');
  assert.equal(got.otApproval, 'OT Approval');
  assert.equal(got.activity, 'ACTIVITY');
  assert.notEqual(got.monthlyTotalHours, 'Total', 'ช่องสรุปทั้งงวดห้ามคว้าคอลัมน์รายวันไป');
});

test('T8 / ISV — มีทั้ง Date และ Day ในฟอร์มเดียวกัน', () => {
  const got = suggest([
    'Project:', 'Company:', 'Outsource Name:', 'Position:',
    'Date', 'Day', 'Type', 'Logged Hours', 'OT Hours', 'Notes',
  ]);
  assert.equal(got.date, 'Date', 'ต้องไม่สลับกับคอลัมน์ Day');
  assert.equal(got.day, 'Day');
  assert.equal(got.employeeName, 'Outsource Name:');
  assert.equal(got.position, 'Position:');
  assert.equal(got.normalHours, 'Logged Hours');
  assert.equal(got.otHours, 'OT Hours');
});

test('CP Axtra ฟอร์มไทย — ป้ายเป็นภาษาไทยล้วน', () => {
  const got = suggest(['วันที่', 'ปกติ', 'ล่วงเวลา', 'รายละเอียด', 'เวลาเข้า', 'เวลาออก', 'หมายเหตุ']);
  assert.equal(got.date, 'วันที่');
  assert.equal(got.timeIn, 'เวลาเข้า');
  assert.equal(got.timeOut, 'เวลาออก');
  assert.equal(got.jobDescription, 'รายละเอียด');
  assert.equal(got.remarks, 'หมายเหตุ');
  assert.equal(got.normalHours, 'ปกติ');
  assert.equal(got.otHours, 'ล่วงเวลา');
});

test('ป้ายเดียวใช้ได้กับฟิลด์เดียว ไม่แจกซ้ำ', () => {
  const got = suggest(['Date', 'Remark']);
  const used = Object.values(got);
  assert.equal(new Set(used).size, used.length, 'ห้ามมีป้ายไหนถูกใช้ซ้ำสองฟิลด์');
});

test('ฟอร์มที่ไม่มีอะไรตรงเลย ต้องปล่อยว่าง ไม่ใช่เดามั่ว', () => {
  const got = suggest(['ก', 'ข', 'zzzz', '1234']);
  assert.deepEqual(got, {}, 'เดาไม่ออกต้องไม่เติมอะไรเลย');
});
