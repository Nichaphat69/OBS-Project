/**
 * ทดสอบ src/extract/timesheet.js — โมเดล vision ในเครื่อง (LM Studio/Ollama)
 *
 * ใช้ PDF ขั้นต่ำ 1 หน้าที่สร้างขึ้นเอง (ไม่ต้องพึ่งไฟล์ตัวอย่างจริง) แปลงผ่าน
 * pdf-to-img จริง แล้วจำลองคำตอบของโมเดล vision ด้วย fakeFetch แทนของจริง
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { extractTimesheet, verifyExtraction } from '../src/extract/timesheet.js';

// PDF ขั้นต่ำ 1 หน้า — พอให้ pdf-to-img แปลงเป็นรูปได้จริง เนื้อหาในหน้าไม่สำคัญ
// เพราะการทดสอบนี้ไม่ได้พึ่งความแม่นของโมเดลจริง (จำลองคำตอบด้วย fakeFetch)
const MINIMAL_PDF = Buffer.from(
  '%PDF-1.1\n' +
  '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n' +
  '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n' +
  '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R ' +
  '/Resources << /Font << /F1 5 0 R >> >> >> endobj\n' +
  '4 0 obj << /Length 40 >>\nstream\nBT /F1 24 Tf 20 40 Td (Timesheet) Tj ET\nendstream\nendobj\n' +
  '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n' +
  'xref\n0 6\n0000000000 65535 f \ntrailer << /Size 6 /Root 1 0 R >>\nstartxref\n0\n%%EOF',
);

function fakeTimesheetData(period = '2026-01') {
  return {
    vendor: 'iPassion Co.,Ltd.',
    clientName: 'Thai Life Insurance PCL',
    projectName: 'Outsource for BAU Project',
    employeeName: 'Pongpun Mamak',
    position: 'Developer (Java)',
    period,
    totalWorkDays: 1,
    totalLeaveDays: 0,
    days: [{ date: `${period}-05`, timeIn: '8:30', timeOut: '17:30', label: null, jobDescription: null }],
    leaveDays: [],
    signedByEmployee: true,
    employeeSignatureName: 'Pongpun Mamak',
    signedByProjectManager: true,
    projectManagerSignatureName: 'Somsri Jaidee',
    notes: [],
  };
}

function fakeVisionFetch(content) {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 500, completion_tokens: 100 },
    }),
  });
}

// PDF ขั้นต่ำ 2 หน้า — จำลองเอกสารจริงที่ export จาก Excel แล้วถูกตัดเป็นหลายหน้า
// (ฝั่งซ้าย: ตารางวันที่/เวลา, ฝั่งขวา: ชื่อพนักงาน/ลายเซ็น) ตามที่เจอจริงตอนทดสอบกับ LM Studio
const TWO_PAGE_PDF = Buffer.from(
  '%PDF-1.1\n' +
  '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n' +
  '2 0 obj << /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >> endobj\n' +
  '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R ' +
  '/Resources << /Font << /F1 5 0 R >> >> >> endobj\n' +
  '4 0 obj << /Length 40 >>\nstream\nBT /F1 24 Tf 20 40 Td (Page One) Tj ET\nendstream\nendobj\n' +
  '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n' +
  '6 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 7 0 R ' +
  '/Resources << /Font << /F1 5 0 R >> >> >> endobj\n' +
  '7 0 obj << /Length 40 >>\nstream\nBT /F1 24 Tf 20 40 Td (Page Two) Tj ET\nendstream\nendobj\n' +
  'xref\n0 8\n0000000000 65535 f \ntrailer << /Size 8 /Root 1 0 R >>\nstartxref\n0\n%%EOF',
);

/** fetchImpl ที่ตอบต่างกันไปตามลำดับการเรียก (หน้าที่ 1, 2, 3, ...) */
function fakeVisionFetchSequence(contents) {
  let call = 0;
  return async () => {
    const content = contents[call] ?? contents[contents.length - 1];
    call += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 300, completion_tokens: 80 },
      }),
    };
  };
}

test('extractTimesheet แปลง PDF เป็นรูปแล้วเรียกโมเดล vision ในเครื่อง parse ผลได้', async () => {
  const fetchImpl = fakeVisionFetch(fakeTimesheetData('2026-01'));

  const result = await extractTimesheet(MINIMAL_PDF, { expectedPeriod: '2026-01', fetchImpl });

  assert.equal(result.data.employeeName, 'Pongpun Mamak');
  assert.equal(result.data.period, '2026-01');
  assert.match(result.model, /^local:/);
  assert.equal(result.verification.ok, true);
  assert.ok(result.usage);
});

test('extractTimesheet รับ path ของไฟล์ได้เหมือนกัน (ไม่ใช่แค่ Buffer)', async () => {
  const { writeFileSync, unlinkSync } = await import('node:fs');
  const path = '/tmp/obs-test-timesheet.pdf';
  writeFileSync(path, MINIMAL_PDF);
  try {
    const fetchImpl = fakeVisionFetch(fakeTimesheetData('2026-02'));
    const result = await extractTimesheet(path, { expectedPeriod: '2026-02', fetchImpl });
    assert.equal(result.data.period, '2026-02');
  } finally {
    unlinkSync(path);
  }
});

test('extractTimesheet โยน error ที่อ่านออกถ้าโมเดลตอบขาดคีย์ที่จำเป็น', async () => {
  const fetchImpl = fakeVisionFetch({ employeeName: 'ไม่ครบ' });

  await assert.rejects(
    () => extractTimesheet(MINIMAL_PDF, { fetchImpl }),
    /ขาดคีย์/,
  );
});

test('extractTimesheet โยน error ที่อ่านออกถ้าเชื่อมต่อ local server ไม่ได้', async () => {
  const fetchImpl = async () => {
    throw new Error('connect ECONNREFUSED');
  };

  await assert.rejects(
    () => extractTimesheet(MINIMAL_PDF, { fetchImpl }),
    /เชื่อมต่อโมเดลในเครื่องไม่ได้/,
  );
});

test('extractTimesheet อ่านทีละหน้าแล้วรวมข้อมูลจากหลายหน้าเข้าด้วยกัน (ฝั่งซ้าย/ฝั่งขวาของเอกสารจริง)', async () => {
  // หน้า 1: เห็นแค่ตารางวันที่/เวลา (ฝั่งซ้าย) — ไม่เห็นชื่อพนักงานเลยในหน้านี้
  const page1 = {
    vendor: 'iPassion Co.,Ltd.', clientName: 'Thai Life Insurance PCL', projectName: 'Outsource for BAU Project',
    employeeName: null, position: null, period: '2026-01',
    totalWorkDays: 0, totalLeaveDays: 0,
    days: [{ date: '2026-01-05', timeIn: '8:30', timeOut: '17:30', label: null, jobDescription: 'งาน A' }],
    leaveDays: [],
    signedByEmployee: false, employeeSignatureName: null,
    signedByProjectManager: false, projectManagerSignatureName: null, notes: [],
  };
  // หน้า 2: เห็นแค่ชื่อพนักงาน/ตำแหน่ง/สรุปยอด/ลายเซ็น (ฝั่งขวา) — ไม่เห็นตารางวันที่เลย
  const page2 = {
    vendor: null, clientName: null, projectName: null,
    employeeName: 'Pongpun Mamak', position: 'Developer (Java)', period: null,
    totalWorkDays: 1, totalLeaveDays: 0,
    days: [], leaveDays: [],
    signedByEmployee: true, employeeSignatureName: 'Pongpun Mamak',
    signedByProjectManager: true, projectManagerSignatureName: 'Somsri Jaidee',
    notes: ['ลายเซ็นชัดเจน'],
  };

  const fetchImpl = fakeVisionFetchSequence([page1, page2]);
  const result = await extractTimesheet(TWO_PAGE_PDF, { expectedPeriod: '2026-01', fetchImpl });

  // ฟิลด์หัวเอกสารต้องมาจากคนละหน้าแต่รวมกันได้ครบ
  assert.equal(result.data.employeeName, 'Pongpun Mamak');
  assert.equal(result.data.position, 'Developer (Java)');
  assert.equal(result.data.vendor, 'iPassion Co.,Ltd.');
  assert.equal(result.data.period, '2026-01');
  // ตารางวันที่มาจากหน้า 1 เท่านั้น แต่ยังอยู่ครบ
  assert.equal(result.data.days.length, 1);
  assert.equal(result.data.days[0].date, '2026-01-05');
  // ลายเซ็นมาจากหน้า 2 — ต้องเป็น true แม้หน้า 1 จะรายงาน false
  assert.equal(result.data.signedByEmployee, true);
  assert.equal(result.data.signedByProjectManager, true);
  // ชื่อที่เขียนกำกับข้างลายเซ็นก็ต้องรวมมาจากหน้า 2 ด้วยเหมือนกัน
  assert.equal(result.data.employeeSignatureName, 'Pongpun Mamak');
  assert.equal(result.data.projectManagerSignatureName, 'Somsri Jaidee');
  assert.equal(result.verification.ok, true);
});

test('extractTimesheet ทนได้ถ้าอ่านบางหน้าไม่สำเร็จ — ใช้ข้อมูลจากหน้าที่เหลือ + บันทึกโน้ต', async () => {
  let call = 0;
  const fetchImpl = async () => {
    call += 1;
    if (call === 1) throw new Error('connect ECONNREFUSED');
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{
          message: { content: JSON.stringify(fakeTimesheetData('2026-01')) },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 300, completion_tokens: 80 },
      }),
    };
  };

  const result = await extractTimesheet(TWO_PAGE_PDF, { expectedPeriod: '2026-01', fetchImpl });

  assert.equal(result.data.employeeName, 'Pongpun Mamak');
  assert.ok(result.data.notes.some((n) => /หน้า 1 ไม่สำเร็จ/.test(n)));
});

test('extractTimesheet โยน error รวมถ้าทุกหน้าอ่านไม่สำเร็จเลย', async () => {
  const fetchImpl = async () => {
    throw new Error('connect ECONNREFUSED');
  };

  await assert.rejects(
    () => extractTimesheet(TWO_PAGE_PDF, { fetchImpl }),
    /ไม่สำเร็จเลยสักหน้า/,
  );
});

test('verifyExtraction จับได้เมื่อรอบเดือนไม่ตรงกับที่ระบบคาดไว้', () => {
  const data = fakeTimesheetData('2026-01');
  const result = verifyExtraction(data, { expectedPeriod: '2026-02' });

  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => i.severity === 'fail' && /รอบ 2026-01/.test(i.message)));
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
  assert.ok(result.issues.some((i) => /ไม่มีแถวในตาราง/.test(i.message)));
});
