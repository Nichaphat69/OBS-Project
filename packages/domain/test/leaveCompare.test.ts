/**
 * ทดสอบการเทียบวันลา Timesheet กับ HRDD (packages/domain/src/leaveCompare.ts)
 *
 * ฟังก์ชันล้วน ไม่ต้องมีบัญชี HRDD จริง — ข้อมูลจำลองมีรูปร่างตรงกับ LeaveTransectionResponse
 * จริงของ HRDD ที่ยืนยันจากซอร์สโค้ด (work-dd-service) 11 ส.ค. 69
 *
 * Ported from test/leaveCompare.test.js (assertions preserved exactly).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { compareLeaves, summarizeLeaveComparison } from '../src/leaveCompare.js';

test('วันที่ตรงกันทั้งวันที่และประเภท (ไทย vs ไทย) → ok', () => {
  const rows = compareLeaves(
    [{ date: '2026-01-08', type: 'ลากิจ' }],
    [{ dateFrom: '2026-01-08', dateTo: '2026-01-08', leaveName: 'ลากิจ', leaveCode: 'BUSINESS' }],
  );
  assert.deepEqual(rows, [{ date: '2026-01-08', tsType: 'ลากิจ', hrddType: 'ลากิจ', status: 'ok', hrddHours: null }]);
});

test('วันที่ตรงกันแต่ Timesheet เขียนอังกฤษ HRDD เขียนไทย ยังจัดกลุ่มประเภทตรงกันได้ → ok', () => {
  const rows = compareLeaves(
    [{ date: '2026-01-08', type: 'Sick Leave' }],
    [{ dateFrom: '2026-01-08', dateTo: '2026-01-08', leaveName: 'ลาป่วย' }],
  );
  assert.equal(rows[0].status, 'ok');
});

test('วันที่ตรงกันแต่ประเภทไม่ตรง → warn พร้อมเก็บค่าดิบทั้งสองฝั่งไว้ให้คนตรวจเห็น', () => {
  const rows = compareLeaves(
    [{ date: '2026-01-16', type: 'ลาป่วย' }],
    [{ dateFrom: '2026-01-16', dateTo: '2026-01-16', leaveName: 'ลากิจ' }],
  );
  assert.deepEqual(rows, [{ date: '2026-01-16', tsType: 'ลาป่วย', hrddType: 'ลากิจ', status: 'warn', hrddHours: null }]);
});

test('มีใน HRDD (อนุมัติแล้ว) แต่ไม่มีใน Timesheet → info', () => {
  const rows = compareLeaves(
    [],
    [{ dateFrom: '2026-01-22', dateTo: '2026-01-22', leaveName: 'ลาป่วย' }],
  );
  assert.deepEqual(rows, [{ date: '2026-01-22', tsType: null, hrddType: 'ลาป่วย', status: 'info', hrddHours: null }]);
});

test('มีใน Timesheet แต่ไม่มีใน HRDD → bad', () => {
  const rows = compareLeaves([{ date: '2026-01-29', type: 'ลาป่วย' }], []);
  assert.deepEqual(rows, [{ date: '2026-01-29', tsType: 'ลาป่วย', hrddType: null, status: 'bad', hrddHours: null }]);
});

test('HRDD ลาต่อเนื่องหลายวัน (dateFrom ≠ dateTo) เปิดออกมาเทียบเป็นรายวันให้ครบทุกวัน', () => {
  const rows = compareLeaves(
    [{ date: '2026-01-10', type: 'ลาพักร้อน' }],
    [{ dateFrom: '2026-01-09', dateTo: '2026-01-11', leaveName: 'ลาพักร้อน' }],
  );
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => [r.date, r.status]), [
    ['2026-01-09', 'info'],
    ['2026-01-10', 'ok'],
    ['2026-01-11', 'info'],
  ]);
});

test('ผลลัพธ์เรียงตามวันที่เสมอ ไม่ใช่ตามลำดับที่ส่งเข้ามา', () => {
  const rows = compareLeaves(
    [{ date: '2026-01-29', type: 'ลาป่วย' }, { date: '2026-01-08', type: 'ลากิจ' }],
    [{ dateFrom: '2026-01-08', dateTo: '2026-01-08', leaveName: 'ลากิจ' }],
  );
  assert.deepEqual(rows.map((r) => r.date), ['2026-01-08', '2026-01-29']);
});

test('ไม่มีวันลาเลยทั้งสองฝั่ง → array เปล่า ไม่ error', () => {
  assert.deepEqual(compareLeaves([], []), []);
  assert.deepEqual(compareLeaves(), []);
});

test('HRDD ลาไม่เต็มวัน (amountDay:0, amountHour:3) วันเดียว → ติด hrddHours ไว้ให้เห็น', () => {
  const rows = compareLeaves(
    [{ date: '2026-07-31', type: 'ลาป่วย' }],
    [{ dateFrom: '2026-07-31', dateTo: '2026-07-31', leaveName: 'ลาป่วย', amountDay: 0, amountHour: 3, timeFrom: '09:00:00', timeTo: '12:00:00' }],
  );
  assert.equal(rows[0].hrddHours, 3, 'ลา 3 ชม. ไม่ใช่วันเต็ม ต้องโชว์จำนวนชั่วโมงไว้');
});

test('HRDD ลาเต็มวัน (amountDay:1, amountHour:0) → hrddHours เป็น null เหมือนเดิม', () => {
  const rows = compareLeaves(
    [{ date: '2026-07-31', type: 'ลาป่วย' }],
    [{ dateFrom: '2026-07-31', dateTo: '2026-07-31', leaveName: 'ลาป่วย', amountDay: 1, amountHour: 0, timeFrom: '00:00:00', timeTo: '00:00:00' }],
  );
  assert.equal(rows[0].hrddHours, null);
});

test('HRDD ลาต่อเนื่องหลายวัน (amountDay ≥ 1 ข้ามหลายวัน) แต่ละวันยังนับเต็มวันเหมือนเดิม ไม่ติด hrddHours', () => {
  const rows = compareLeaves(
    [],
    [{ dateFrom: '2026-01-09', dateTo: '2026-01-11', leaveName: 'ลาพักร้อน', amountDay: 3, amountHour: 0 }],
  );
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => r.hrddHours === null), 'ลาต่อเนื่องหลายวัน ไม่ใช่กรณีลาไม่เต็มวันวันเดียว');
});

test('summarizeLeaveComparison นับแต่ละสถานะและรวมจำนวนที่ไม่ตรงกันถูกต้อง', () => {
  const rows = compareLeaves(
    [
      { date: '2026-01-08', type: 'ลากิจ' },   // ok
      { date: '2026-01-16', type: 'ลาป่วย' },   // warn (HRDD ว่าลากิจ)
      { date: '2026-01-29', type: 'ลาป่วย' },   // bad (ไม่มีใน HRDD)
    ],
    [
      { dateFrom: '2026-01-08', dateTo: '2026-01-08', leaveName: 'ลากิจ' },
      { dateFrom: '2026-01-16', dateTo: '2026-01-16', leaveName: 'ลากิจ' },
      { dateFrom: '2026-01-22', dateTo: '2026-01-22', leaveName: 'ลาป่วย' }, // info
    ],
  );
  const summary = summarizeLeaveComparison(rows);
  assert.deepEqual(summary.counts, { ok: 1, warn: 1, info: 1, bad: 1 });
  assert.equal(summary.total, 4);
  assert.equal(summary.mismatched, 3);
});
