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

/** PDF ขั้นต่ำ N หน้า — ใช้ทดสอบไฟล์ที่รวม Timesheet ของหลายคนไว้ในไฟล์เดียว */
function makePdf(pageCount) {
  const kids = [];
  const objs = [];
  let next = 3;
  for (let i = 0; i < pageCount; i++) {
    const pageObj = next;
    const contentObj = next + 1;
    next += 2;
    kids.push(`${pageObj} 0 R`);
    objs.push(
      `${pageObj} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents ${contentObj} 0 R `
      + '/Resources << /Font << /F1 999 0 R >> >> >> endobj\n'
      + `${contentObj} 0 obj << /Length 40 >>\nstream\nBT /F1 18 Tf 20 40 Td (Page ${i + 1}) Tj ET\nendstream\nendobj\n`,
    );
  }
  return Buffer.from(
    '%PDF-1.1\n'
    + '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n'
    + `2 0 obj << /Type /Pages /Kids [${kids.join(' ')}] /Count ${pageCount} >> endobj\n`
    + objs.join('')
    + '999 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n'
    + `xref\n0 ${next}\n0000000000 65535 f \ntrailer << /Size ${next} /Root 1 0 R >>\nstartxref\n0\n%%EOF`,
  );
}

const SIX_PAGE_PDF = makePdf(6);

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

/* ── รองรับฟอร์มของลูกค้าหลายราย ───────────────────────────────────────
   ค่าที่ใช้ทดสอบคัดจากเอกสารจริง 14 ฉบับ รอบ ม.ค. 2026 (BigC · CP Axtra · Fujitsu ·
   T8 · TSG) — จำลองว่าโมเดลคัดข้อความมาตามที่เขียนในเอกสาร แล้วดูว่าโค้ดแปลงต่อได้ถูกไหม */

function pageWith(overrides) {
  return {
    vendor: null, clientName: null, projectName: null, employeeName: null, position: null,
    period: null, totalWorkDays: 0, totalLeaveDays: 0, days: [], leaveDays: [],
    signedByEmployee: false, employeeSignatureName: null,
    signedByProjectManager: false, projectManagerSignatureName: null, notes: [],
    ...overrides,
  };
}

test('อ่านฟอร์ม BigC ได้ — ปี พ.ศ. ในวันที่ และป้ายวันลาอยู่ในแถวรวม', async () => {
  const result = await extractTimesheet(MINIMAL_PDF, {
    fetchImpl: fakeVisionFetch(pageWith({
      employeeName: 'Sumat Suknaisin',
      position: 'Flutter Developer',
      period: 'January 2026',
      totalWorkDays: 19,
      days: [
        { date: '1/1/2569', timeIn: null, timeOut: null, label: 'Holiday', jobDescription: null },
        { date: '2/1/2569', timeIn: null, timeOut: null, label: 'Vacation leave', jobDescription: null },
        { date: '5/1/2569', timeIn: '08:49', timeOut: '18:03', label: null, jobDescription: 'Created unit tests' },
      ],
    })),
  });

  const byDate = Object.fromEntries(result.data.days.map((d) => [d.date, d]));
  assert.deepEqual(Object.keys(byDate), ['2026-01-01', '2026-01-02', '2026-01-05'], 'ปี พ.ศ. ต้องถูกแปลงเป็น ค.ศ.');
  assert.equal(byDate['2026-01-01'].kind, 'holiday');
  assert.equal(byDate['2026-01-02'].kind, 'leave');
  assert.equal(byDate['2026-01-05'].kind, 'work');
  // ฟอร์มนี้ไม่มีตารางวันลาแยก — ต้องเก็บวันลาจากแถวรายวันให้เอง ไม่งั้นคิดส่วนลดขาด
  assert.deepEqual(result.data.leaveDays, [
    { date: '2026-01-02', type: 'vacation', rawLabel: 'Vacation leave' },
  ]);
});

test('อ่านฟอร์ม CP Axtra / T8 ได้ — ป้ายวันหยุดอยู่ในคอลัมน์ Type', async () => {
  const result = await extractTimesheet(MINIMAL_PDF, {
    fetchImpl: fakeVisionFetch(pageWith({
      period: 'มกราคม 2026',
      days: [
        { date: '1/1/2026', timeIn: null, timeOut: null, label: null, type: 'Public Holiday', remark: null, jobDescription: null },
        { date: '3/1/2026', timeIn: null, timeOut: null, label: null, type: 'Weekend', remark: null, jobDescription: null },
        { date: '5/1/2026', timeIn: '8:30', timeOut: '17:30', label: null, type: 'Working', remark: null, jobDescription: '[COD-263] UAT Support' },
      ],
    })),
  });

  assert.equal(result.data.period, '2026-01', 'ช่องเดือนเขียนเป็นภาษาไทยต้องแปลงได้');
  const kinds = result.data.days.map((d) => `${d.date}:${d.kind}`);
  assert.deepEqual(kinds, ['2026-01-01:holiday', '2026-01-03:weekend', '2026-01-05:work']);
});

test('อ่านฟอร์ม TSG / อาคเนย์ ได้ — ป้ายอยู่ในคอลัมน์ Remarks', async () => {
  const result = await extractTimesheet(MINIMAL_PDF, {
    fetchImpl: fakeVisionFetch(pageWith({
      period: 'Jan-26',
      days: [
        { date: '1-Jan-2026', timeIn: null, timeOut: null, label: null, type: null, remark: 'HOLIDAY', jobDescription: null },
        { date: '23-Jan-2026', timeIn: null, timeOut: null, label: null, type: null, remark: 'ANNUAL LEAVE', jobDescription: null },
      ],
    })),
  });

  assert.equal(result.data.period, '2026-01');
  const byDate = Object.fromEntries(result.data.days.map((d) => [d.date, d]));
  assert.equal(byDate['2026-01-01'].kind, 'holiday');
  assert.equal(byDate['2026-01-23'].kind, 'leave');
  assert.equal(result.data.leaveDays[0].type, 'vacation', 'ANNUAL LEAVE = ลาพักร้อน');
});

test('อ่านฟอร์ม Fujitsu ได้ — วันที่มีแต่เลขวัน ต้องเติมเดือนจากรอบเอกสาร', async () => {
  const result = await extractTimesheet(MINIMAL_PDF, {
    fetchImpl: fakeVisionFetch(pageWith({
      period: '1 2026',
      totalHours: 140,
      days: [
        { date: '02 Fri', timeIn: null, timeOut: null, label: 'Vacation Leave/', jobDescription: null },
        { date: '05 Mon', timeIn: '8:00', timeOut: '17:00', label: null, jobDescription: 'Modify program' },
      ],
    })),
  });

  assert.equal(result.data.period, '2026-01');
  assert.deepEqual(result.data.days.map((d) => d.date), ['2026-01-02', '2026-01-05']);
  assert.equal(result.data.totalHours, 140, 'ฟอร์มที่สรุปเป็นชั่วโมงต้องเก็บไว้ได้');
});

test('เก็บเลขที่เอกสารกับสถานะจากหน้าอีเมลแจ้งอนุมัติที่แนบท้ายไฟล์', async () => {
  const result = await extractTimesheet(MINIMAL_PDF, {
    fetchImpl: fakeVisionFetch(pageWith({
      documentNo: '2026010087',
      approvalStatus: 'อนุมัติ',
      period: 'January 2026',
    })),
  });

  assert.equal(result.data.documentNo, '2026010087');
  assert.equal(result.data.approvalStatus, 'อนุมัติ');
});

test('แถวที่อ่านวันที่ไม่ออก ถูกข้ามและบันทึกไว้ใน notes ไม่เดาวันที่ขึ้นมาเอง', async () => {
  const result = await extractTimesheet(MINIMAL_PDF, {
    fetchImpl: fakeVisionFetch(pageWith({
      period: 'January 2026',
      days: [
        { date: '5-Jan-26', timeIn: '8:30', timeOut: '17:30', label: null, jobDescription: 'งาน' },
        { date: 'Total', timeIn: null, timeOut: null, label: null, jobDescription: null },
      ],
    })),
  });

  assert.equal(result.data.days.length, 1, 'แถวสรุปท้ายตารางต้องไม่กลายเป็นวันทำงาน');
  assert.ok(result.data.notes.some((n) => n.includes('อ่านวันที่ไม่ออก')), 'ต้องบอกไว้ว่าข้ามแถวไหนไป');
});

test('ช่องสรุปที่อ่านได้เกินจำนวนวันในเดือน ถูกย้ายไปเป็นชั่วโมงพร้อมเตือน', async () => {
  // เจอจริงกับฟอร์ม CP Axtra: ช่อง man-day 21.00 กับช่องชั่วโมง 168.00 วางติดกัน
  // โมเดลหยิบ 168 มาใส่ช่องวัน ถ้าปล่อยไว้จะกลายเป็นวางบิล 168 วัน
  const result = await extractTimesheet(MINIMAL_PDF, {
    fetchImpl: fakeVisionFetch(pageWith({ period: 'January 2026', totalWorkDays: 168 })),
  });

  assert.equal(result.data.totalWorkDays, 0, 'ต้องไม่ปล่อยตัวเลขที่เป็นไปไม่ได้ผ่านไป');
  assert.equal(result.data.totalHours, 168, 'ย้ายไปช่องชั่วโมงแทน');
  assert.ok(result.data.notes.some((n) => n.includes('เกินจำนวนวันในเดือน')), 'ต้องเตือนให้คนตรวจ');
});

/* ── ไฟล์เดียวมี Timesheet ของหลายคน ─────────────────────────────────
   เจอจริงกับ ThaiLife 1-2026.pdf (8 หน้า): หน้า 1-4 ของ Sunee · หน้า 5 อีเมลอนุมัติของ Sunee
   · หน้า 6-7 ของ Pongpun · หน้า 8 อีเมลอนุมัติของ Pongpun
   เดิมระบบยุบทุกหน้าเป็นคนเดียว ทำให้วันของสองคนปนกันและยอดสรุปผิด */

test('แยกไฟล์ที่มี Timesheet ของสองคนออกเป็นสองฉบับ ไม่ยุบรวมเป็นคนเดียว', async () => {
  const sunee = (days, extra = {}) => pageWith({
    employeeName: 'Sunee Maneekasemsuk', position: 'Senior Project Manager',
    period: 'January 2026', days, ...extra,
  });
  const pongpun = (days, extra = {}) => pageWith({
    employeeName: 'Pongpun Mamak', position: 'Java Programmer',
    period: 'January 2026', days, ...extra,
  });

  const fetchImpl = fakeVisionFetchSequence([
    sunee([{ date: '5-Jan-26', timeIn: '8:30', timeOut: '17:30', label: null, jobDescription: 'งาน' }]),
    sunee([], { totalWorkDays: 20 }),
    // หน้าอีเมลแจ้งอนุมัติของ Sunee — ไม่มีชื่อพนักงาน ต้องไปอยู่กลุ่มเดียวกับหน้าก่อนหน้า
    pageWith({ documentNo: '2026010087', approvalStatus: 'อนุมัติ' }),
    pongpun([{ date: '6-Jan-26', timeIn: '8:30', timeOut: '17:00', label: null, jobDescription: 'งาน' }]),
    pongpun([], { totalWorkDays: 19 }),
    pageWith({ documentNo: '2026010091', approvalStatus: 'อนุมัติ' }),
  ]);

  const result = await extractTimesheet(SIX_PAGE_PDF, { expectedPeriod: '2026-01', fetchImpl });

  assert.equal(result.documents.length, 2, 'ต้องแยกได้ 2 ฉบับ');

  const [a, b] = result.documents;
  assert.equal(a.data.employeeName, 'Sunee Maneekasemsuk');
  assert.equal(a.data.totalWorkDays, 20);
  assert.equal(a.data.documentNo, '2026010087', 'เลขเอกสารจากหน้าอีเมลต้องผูกกับคนที่ถูก');
  assert.deepEqual(a.data.days.map((d) => d.date), ['2026-01-05'], 'ห้ามมีวันของอีกคนปนมา');

  assert.equal(b.data.employeeName, 'Pongpun Mamak');
  assert.equal(b.data.totalWorkDays, 19);
  assert.equal(b.data.documentNo, '2026010091');
  assert.deepEqual(b.data.days.map((d) => d.date), ['2026-01-06']);

  // ฉบับแรกยังวางไว้ที่ result.data ด้วย เพื่อให้โค้ดเดิมทำงานได้เหมือนเดิม
  assert.equal(result.data.employeeName, 'Sunee Maneekasemsuk');
});

test('ชื่อที่โมเดลอ่านเพี้ยนระหว่างหน้า ยังถือเป็นคนเดียวกัน ไม่แตกเป็นหลายฉบับ', async () => {
  const fetchImpl = fakeVisionFetchSequence([
    pageWith({ employeeName: 'Sunee Maneekasemsuk', period: 'January 2026' }),
    // หน้าถัดมาโมเดลอ่านเพี้ยน — เกิดขึ้นจริงกับเอกสารตัวหนังสือเล็ก
    pageWith({ employeeName: 'Sunee Maneekasemsuh', period: 'January 2026', totalWorkDays: 20 }),
  ]);

  const result = await extractTimesheet(TWO_PAGE_PDF, { expectedPeriod: '2026-01', fetchImpl });
  assert.equal(result.documents.length, 1, 'ชื่อเพี้ยนเล็กน้อยต้องไม่ทำให้แตกเป็นสองฉบับ');
  assert.equal(result.data.totalWorkDays, 20);
});

test('ไฟล์ปกติของคนเดียว ยังได้ผลเป็นฉบับเดียวเหมือนเดิม', async () => {
  const result = await extractTimesheet(MINIMAL_PDF, {
    fetchImpl: fakeVisionFetch(fakeTimesheetData()),
  });
  assert.equal(result.documents.length, 1);
  assert.equal(result.documents[0].data.employeeName, 'Pongpun Mamak');
});

/* ── โหวตชื่อจากทุกหน้า ──────────────────────────────────────────────
   หัวเอกสาร (ชื่อคน/ตำแหน่ง/ลูกค้า) พิมพ์ซ้ำอยู่ทุกหน้าของ Timesheet ฉบับเดียวกัน
   เท่ากับได้อ่านค่าเดิมหลายรอบ — เดิมหยิบค่าจากหน้าแรกเท่านั้น หน้าแรกเพี้ยนคือผิดทั้งฉบับ */

test('หน้าแรกอ่านชื่อเพี้ยน แต่หน้าอื่นอ่านตรงกัน → ใช้ชื่อที่เสียงข้างมากอ่านได้', async () => {
  const fetchImpl = fakeVisionFetchSequence([
    pageWith({ employeeName: 'Sineee Masamasukiam', position: 'Senior Project Manager', period: 'January 2026' }),
    pageWith({ employeeName: 'Sunee Maneekasemsuk', position: 'Senior Project Manager', period: 'January 2026' }),
    pageWith({ employeeName: 'Sunee Maneekasemsuk', position: 'Senior Project Manager', period: 'January 2026' }),
    pageWith({ employeeName: 'Sunee Maneekasemsuk', period: 'January 2026', totalWorkDays: 20 }),
  ]);

  const result = await extractTimesheet(makePdf(4), { expectedPeriod: '2026-01', fetchImpl });
  assert.equal(result.data.employeeName, 'Sunee Maneekasemsuk', '3 เสียงต้องชนะ 1 เสียง');
  assert.equal(result.documents.length, 1, 'ชื่อเพี้ยนหน้าเดียวต้องไม่ทำให้แตกเป็นสองฉบับ');
});

test('ชื่อข้างลายเซ็นเป็นอีกเสียงหนึ่ง — ช่วยชี้ขาดเมื่อหัวเอกสารอ่านได้ไม่ตรงกัน', async () => {
  const fetchImpl = fakeVisionFetchSequence([
    pageWith({ employeeName: 'Sunee Maneekasemsuk', period: 'January 2026' }),
    pageWith({
      employeeName: 'Sunee Maneekasemsuh', period: 'January 2026',
      signedByEmployee: true, employeeSignatureName: 'Sunee Maneekasemsuk',
    }),
  ]);

  const result = await extractTimesheet(TWO_PAGE_PDF, { expectedPeriod: '2026-01', fetchImpl });
  assert.equal(result.data.employeeName, 'Sunee Maneekasemsuk');
});

test('เสียงเท่ากัน → เลือกค่าที่ยาวกว่า เพราะมักเป็นอันที่ไม่ถูกตัดกลางคำ', async () => {
  const fetchImpl = fakeVisionFetchSequence([
    pageWith({ clientName: 'ThaiLife Insurance', period: 'January 2026' }),
    pageWith({ clientName: 'ThaiLife Insurance Public Co.,Ltd.', period: 'January 2026' }),
  ]);

  const result = await extractTimesheet(TWO_PAGE_PDF, { expectedPeriod: '2026-01', fetchImpl });
  assert.equal(result.data.clientName, 'ThaiLife Insurance Public Co.,Ltd.');
});

test('ตัวพิมพ์เล็กใหญ่และช่องว่างต่างกัน นับเป็นเสียงเดียวกัน', async () => {
  const fetchImpl = fakeVisionFetchSequence([
    pageWith({ position: 'Java Programmer', period: 'January 2026' }),
    pageWith({ position: 'java  programmer', period: 'January 2026' }),
    pageWith({ position: 'PL/SQL Developer', period: 'January 2026' }),
  ]);

  const result = await extractTimesheet(makePdf(3), { expectedPeriod: '2026-01', fetchImpl });
  assert.equal(result.data.position, 'Java Programmer', '2 เสียง (นับรวมที่พิมพ์ต่างกัน) ต้องชนะ 1 เสียง');
});
