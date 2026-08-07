/**
 * ทดสอบตัวแปลงค่าจาก Timesheet หลายรูปแบบ (src/extract/normalize.js)
 *
 * ค่าที่ใช้ทดสอบคัดมาจากเอกสารจริงของลูกค้า 14 ฉบับ รอบ ม.ค. 2026 ที่สำรวจเมื่อ 7 ส.ค. 2569
 * ไม่ได้แต่งขึ้น — แต่ละบรรทัดกำกับไว้ว่ามาจากฟอร์มของใคร
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeYear, monthFromWord, normalizePeriod, normalizeDate,
  classifyDayKind, classifyLeaveType,
} from '../src/extract/normalize.js';

test('normalizeYear แปลง พ.ศ. เป็น ค.ศ. ได้ทั้งแบบเต็มและแบบย่อ', () => {
  assert.equal(normalizeYear(2569), 2026, 'พ.ศ. เต็ม (BigC เขียน 1/1/2569)');
  assert.equal(normalizeYear(69), 2026, 'พ.ศ. ย่อ');
  assert.equal(normalizeYear(26), 2026, 'ค.ศ. ย่อ (ThaiLife เขียน 1-Jan-26)');
  assert.equal(normalizeYear(2026), 2026, 'ค.ศ. เต็ม');
  assert.equal(normalizeYear('ไม่ใช่ตัวเลข'), null);
});

test('monthFromWord อ่านชื่อเดือนได้ทั้งไทยและอังกฤษ เต็มและย่อ', () => {
  assert.equal(monthFromWord('January'), 1);
  assert.equal(monthFromWord('Jan'), 1);
  assert.equal(monthFromWord('Janua'), 1, 'คอลัมน์แคบจนชื่อเดือนถูกตัดกลางคำ');
  assert.equal(monthFromWord('มกราคม'), 1, 'T8 เขียนช่อง Month เป็นภาษาไทย');
  assert.equal(monthFromWord('ม.ค.'), 1, 'T8 เขียนวันที่เป็น 1-ม.ค.-26');
  assert.equal(monthFromWord('ธ.ค.'), 12);
  assert.equal(monthFromWord('พฤษภาคม'), 5);
  assert.equal(monthFromWord('ไม่ใช่เดือน'), null);
});

test('normalizePeriod แปลงช่องเดือนของทุกฟอร์มเป็น YYYY-MM', () => {
  assert.equal(normalizePeriod('2026-01'), '2026-01');
  assert.equal(normalizePeriod('January 2026'), '2026-01', 'ThaiLife · Locus');
  assert.equal(normalizePeriod('Jan 2026'), '2026-01');
  assert.equal(normalizePeriod('Jan-26'), '2026-01', 'TSG · อาคเนย์ เขียน Jan-26');
  assert.equal(normalizePeriod('มกราคม 2026'), '2026-01', 'T8 เขียนเดือนไทย');
  assert.equal(normalizePeriod('1 2026'), '2026-01', 'Fujitsu เขียน MONTH/YEAR: 1 2026');
  assert.equal(normalizePeriod('January’ 2026'), '2026-01', 'T8 Pacharaporn มีอัญประกาศติดมา');
});

test('normalizeDate อ่านวันที่ได้ทุกรูปแบบที่เจอในเอกสารจริง', () => {
  const p = '2026-01';
  assert.equal(normalizeDate('2026-01-18', p), '2026-01-18', 'รูปแบบมาตรฐาน');
  assert.equal(normalizeDate('18-Jan-26', p), '2026-01-18', 'ThaiLife');
  assert.equal(normalizeDate('1-Jan-26', p), '2026-01-01', 'ThaiLife · Locus');
  assert.equal(normalizeDate('1-Jan-2026', p), '2026-01-01', 'TSG · อาคเนย์');
  assert.equal(normalizeDate('1-ม.ค.-26', p), '2026-01-01', 'T8 Pacharaporn เดือนไทยย่อ');
  assert.equal(normalizeDate('01/01/2026', p), '2026-01-01', 'BigC');
  assert.equal(normalizeDate('31/1/2026', p), '2026-01-31', 'CP Axtra · T8');
  assert.equal(normalizeDate('1/1/2569', p), '2026-01-01', 'BigC Sumat เขียนปี พ.ศ.');
  assert.equal(normalizeDate('24/1/2569', p), '2026-01-24', 'BigC Sumat');
  assert.equal(normalizeDate('01', p), '2026-01-01', 'Fujitsu มีแต่เลขวัน');
  assert.equal(normalizeDate('05 Mon', p), '2026-01-05', 'Fujitsu เลขวัน + ชื่อวัน');
  assert.equal(normalizeDate('29 Dec', p), '2026-12-29', 'KBTG เขียนวัน+เดือนไม่มีปี');
});

test('normalizeDate ใช้เดือนของ period ชี้ขาดเมื่อ วัน/เดือน กำกวม', () => {
  // 5/1/2026 อ่านได้ทั้ง 5 ม.ค. และ 1 พ.ค. — ต้องยึดเดือนจาก period
  assert.equal(normalizeDate('5/1/2026', '2026-01'), '2026-01-05');
  assert.equal(normalizeDate('1/5/2026', '2026-05'), '2026-05-01');
  // ส่วนที่เกิน 12 ต้องเป็นวันเสมอ ไม่ต้องพึ่ง period
  assert.equal(normalizeDate('31/1/2026', null), '2026-01-31');
});

test('normalizeDate คืน null เมื่ออ่านไม่ออก แทนที่จะเดา', () => {
  assert.equal(normalizeDate('', '2026-01'), null);
  assert.equal(normalizeDate('Total', '2026-01'), null);
  assert.equal(normalizeDate(null), null);
  assert.equal(normalizeDate('01', null), null, 'มีแต่เลขวันแต่ไม่รู้เดือน → เดาไม่ได้');
});

test('classifyDayKind จัดกลุ่มคำเรียกวันหยุดของทุกฟอร์มให้เหลือ 4 แบบ', () => {
  assert.equal(classifyDayKind('Weekend'), 'weekend');
  assert.equal(classifyDayKind('เสาร์'), 'weekend');
  assert.equal(classifyDayKind('Holiday'), 'holiday', 'ThaiLife · BigC');
  assert.equal(classifyDayKind('Public Holiday'), 'holiday', 'CP Axtra');
  assert.equal(classifyDayKind('Public Holidays'), 'holiday', 'T8 Pacharaporn');
  assert.equal(classifyDayKind('HOLIDAY'), 'holiday', 'TSG เขียนตัวใหญ่');
  assert.equal(classifyDayKind("New Year's Eve"), 'holiday', 'T8 Pacharaporn · KBTG');
  assert.equal(classifyDayKind('Personal Leave'), 'leave', 'BigC');
  assert.equal(classifyDayKind('Vacation Leave'), 'leave', 'BigC Sumat');
  assert.equal(classifyDayKind('ANNUAL LEAVE'), 'leave', 'TSG');
  assert.equal(classifyDayKind('Vacation Leave/'), 'leave', 'Fujitsu มี / ติดท้าย');
  assert.equal(classifyDayKind(null, '', 'Working'), 'work');
  assert.equal(classifyDayKind(null), 'work', 'ไม่มีป้าย = วันทำงาน');
});

test('classifyDayKind ดูป้ายจากหลายคอลัมน์รวมกัน เพราะแต่ละฟอร์มวางไว้คนละที่', () => {
  // TSG เขียน Weekend ไว้คอลัมน์ Remarks ส่วนคอลัมน์อื่นว่าง
  assert.equal(classifyDayKind(null, null, 'Weekend'), 'weekend');
  // CP Axtra เขียน Public Holiday ไว้คอลัมน์ Type
  assert.equal(classifyDayKind('Public Holiday', null, null), 'holiday');
  // เสาร์อาทิตย์ต้องชนะคำว่า leave ที่ติดมาในแถวเดียวกัน
  assert.equal(classifyDayKind('Weekend', 'annual leave'), 'weekend');
});

test('classifyLeaveType แยกประเภทการลาตามคำที่เอกสารเขียน', () => {
  assert.equal(classifyLeaveType('Sick leave'), 'sick');
  assert.equal(classifyLeaveType('ลาป่วย'), 'sick');
  assert.equal(classifyLeaveType('Personal Leave'), 'personal');
  assert.equal(classifyLeaveType('ลากิจ'), 'personal');
  assert.equal(classifyLeaveType('Vacation Leave'), 'vacation');
  assert.equal(classifyLeaveType('ANNUAL LEAVE'), 'vacation');
  assert.equal(classifyLeaveType('Unpaid leave'), 'unpaid');
  assert.equal(classifyLeaveType('Leave'), 'unknown', 'บอกแค่ว่าลา ไม่บอกประเภท → ไม่เดา');
});

/* ── จับคู่ชื่อที่ AI อ่านเพี้ยนแบบสลับตัวอักษร ──────────────────────────
   ค่าจริงที่วัดได้จากการอ่านเอกสารด้วยโมเดล vision — ระยะแก้ไขเกิน 2 ทั้งคู่
   ชั้นจับคู่เดิม (Levenshtein ≤ 2) จึงจับไม่ได้เลย */

const { matchEmployee, MATCH } = await import('../src/domain/matching.js');

const ROSTER = [
  { id: 'EMP-0018', nameTh: 'สุนีย์ มณีเกษมสุข', nameEn: 'Sunee Maneekasemsuk', aliases: [] },
  { id: 'EMP-0042', nameTh: 'พงศ์พันธ์ มามาก', nameEn: 'Pongpun Mamak', aliases: [] },
];

test('ชื่อที่โมเดลอ่านสลับตัวอักษร ยังจับคู่ได้ แต่ต้องบอกให้คนยืนยัน', () => {
  const r = matchEmployee('Sineee Masamasukiam', ROSTER);
  assert.equal(r.match, MATCH.FUZZY);
  assert.equal(r.employee.id, 'EMP-0018');
  assert.match(r.reason, /ต้องให้คนยืนยัน/, 'ห้ามผูกให้เองเงียบๆ');
});

test('คนละคนกันจริงๆ ต้องไม่ถูกจับคู่มั่ว', () => {
  const r = matchEmployee('Pongpun Mamak', ROSTER);
  assert.equal(r.employee.id, 'EMP-0042', 'ต้องได้พงศ์พันธ์ ไม่ใช่สุนีย์');

  const stranger = matchEmployee('Thanaphon Obboon', ROSTER);
  assert.equal(stranger.match, MATCH.NONE, 'ชื่อที่ไม่มีในระบบต้องไม่ถูกยัดให้ใครสักคน');
});
