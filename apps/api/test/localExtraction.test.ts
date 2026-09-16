/**
 * ทดสอบ verifyExtraction() ใน apps/api/src/lib/localExtractionService.ts — ตัวตรวจความสอดคล้อง
 * ภายในเอกสารหลังโมเดลอ่านเสร็จ
 *
 * Ported from test/timesheet.test.js (assertions preserved exactly) — **พอร์ตเฉพาะ 5 เทสต์ของ
 * verifyExtraction** จากทั้งหมด 34 เทสต์ในไฟล์ต้นฉบับ เหตุผลของอีก 29 เทสต์ที่ยังไม่พอร์ต:
 *
 * - 27 เทสต์เรียก `extractTimesheet()` ซึ่งแปลง PDF จริงผ่าน `pdf-to-img` — บนเครื่องที่โฟลเดอร์
 *   sync กับ iCloud การ import `pdf-to-img` ค้างไม่จบ (วัดแล้ว ไม่ใช่แค่ช้า) ไม่ใช่ข้อจำกัดของโค้ด
 *   พอร์ตได้ทันทีที่รันบนเครื่องที่ไม่ติดปัญหานี้
 * - 2 เทสต์เรียก `mergeDocumentsByEmployee()` ซึ่ง **ตัดสโคปโดยตั้งใจ** ตั้งแต่ Phase 5.7 —
 *   พอร์ตนี้รองรับ Timesheet หนึ่งคนต่อหนึ่งไฟล์เท่านั้น ตรงกับ `Extractor` interface และตรงกับ
 *   ที่ทาง ABBYY ตัดสโคปเดียวกันไว้ตั้งแต่ Phase 5.1 (ดูหัวไฟล์ localExtractionService.ts)
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { verifyExtraction } from '../src/lib/localExtractionService.js';

function fakeTimesheetData(period: string | null = '2026-01'): any {
  return {
    vendor: 'iPassion Co.,Ltd.',
    clientName: 'Thai Life Insurance PCL',
    projectName: 'Outsource for BAU Project',
    employeeName: 'Pongpun Mamak',
    position: 'Developer (Java)',
    period,
    documentNo: null,
    approvalStatus: null,
    totalWorkDays: 1,
    totalLeaveDays: 0,
    totalHours: null,
    days: [{ date: `${period}-05`, timeIn: '8:30', timeOut: '17:30', label: null, jobDescription: null }],
    leaveDays: [],
    signedByEmployee: true,
    employeeSignatureName: 'Pongpun Mamak',
    signedByProjectManager: true,
    projectManagerSignatureName: 'Somsri Jaidee',
    notes: [],
  };
}

test('verifyExtraction จับได้เมื่อรอบเดือนไม่ตรงกับที่ระบบคาดไว้', () => {
  const data = fakeTimesheetData('2026-01');
  const result = verifyExtraction(data, { expectedPeriod: '2026-02' });

  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i: any) => i.severity === 'fail' && /รอบ 2026-01/.test(i.message)));
});

test('verifyExtraction ผ่านเมื่อข้อมูลสอดคล้องกันทุกจุดและมีลายเซ็นครบ', () => {
  const data = fakeTimesheetData('2026-01');
  const result = verifyExtraction(data, { expectedPeriod: '2026-01' });

  assert.equal(result.ok, true);
});

test('verifyExtraction เจอวันลาที่ไม่มีแถวในตาราง → fail', () => {
  const data = fakeTimesheetData('2026-01');
  data.totalLeaveDays = 1;
  data.leaveDays = [{ date: '2026-01-10', type: 'sick', rawLabel: 'Sick leave' }];
  // ไม่มีแถว 2026-01-10 ใน days เลย

  const result = verifyExtraction(data, { expectedPeriod: '2026-01' });

  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i: any) => /ไม่มีแถวในตาราง/.test(i.message)));
});

test('verifyExtraction ไม่ฟ้อง "ไม่มีแถวในตาราง" ถ้า days ว่างเปล่าทั้งตาราง (เจอจริงกับ ABBYY '
  + 'แบบตารางใหม่ — days ว่างเปล่าโดยตั้งใจ ตรวจไม่ได้จริงอยู่แล้ว ไม่ใช่แค่ขาดแถวของวันนั้น)', () => {
  const data = fakeTimesheetData('2026-01');
  data.days = [];
  data.totalLeaveDays = 1;
  data.leaveDays = [{ date: '2026-01-10', type: 'sick', rawLabel: 'Sick leave' }];

  const result = verifyExtraction(data, { expectedPeriod: '2026-01' });

  assert.ok(!result.issues.some((i: any) => /ไม่มีแถวในตาราง/.test(i.message)));
});

test('verifyExtraction ไม่ฟ้องวันที่ซ้ำทุกแถวถ้ารอบเดือนเองก็ผิดรูปแบบอยู่แล้ว', () => {
  // โมเดลบางครั้งคืนสตริง "null" ที่ nullifyLiteralNullStrings แปลงเป็น null จริงแล้วก่อนถึงจุดนี้
  const data = fakeTimesheetData('2026-01');
  data.period = null;
  data.days = [
    { date: '2026-01-05', timeIn: '8:30', timeOut: '17:30', label: null, jobDescription: null },
    { date: '2026-01-06', timeIn: '8:30', timeOut: '17:30', label: null, jobDescription: null },
    { date: '2026-01-07', timeIn: '8:30', timeOut: '17:30', label: null, jobDescription: null },
  ];

  const result = verifyExtraction(data, {});

  const periodIssues = result.issues.filter((i: any) => /รูปแบบเดือนไม่ถูกต้อง/.test(i.message));
  const dateIssues = result.issues.filter((i: any) => /ไม่อยู่ในเดือน/.test(i.message));
  assert.equal(periodIssues.length, 1, 'ฟ้องรอบเดือนผิดแค่ครั้งเดียว');
  assert.equal(dateIssues.length, 0, 'ไม่ต้องฟ้องซ้ำทุกแถวอีก เพราะข้อบนฟ้องแล้ว');
});
