/**
 * Ported from test/abbyy.test.js (assertions preserved exactly) → apps/api/src/lib/abbyyClient.ts
 *
 * ต่างจากต้นฉบับจุดเดียว: พอร์ต TS ไม่รับ `fetchImpl` เข้า constructor (ใช้ global fetch ตรงๆ)
 * จึงสลับ global fetch แทน — ดู helpers/fakeFetch.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { AbbyyClient, AbbyyError, hasAbbyyCredentials, mapAbbyyResult, toCanonicalFieldMap } from '../src/lib/abbyyClient.js';
import { withFetch, type FakeFetch } from './helpers/fakeFetch.js';

const BASE = 'https://vantage-au.abbyy.com';

function client() {
  return new AbbyyClient({
    baseUrl: BASE, clientId: 'cid', clientSecret: 'csecret', skillId: 'skill-1',
  });
}

function jsonResponse(body: unknown, { ok = true, status = 200 } = {}) {
  return { ok, status, text: async () => JSON.stringify(body) };
}

test('hasAbbyyCredentials คืน false ถ้ายังใส่ค่าไม่ครบ 4 ตัว', () => {
  const prev = { ...process.env };
  delete process.env.ABBYY_BASE_URL;
  delete process.env.ABBYY_CLIENT_ID;
  delete process.env.ABBYY_CLIENT_SECRET;
  delete process.env.ABBYY_SKILL_ID;
  assert.equal(hasAbbyyCredentials(), false);
  Object.assign(process.env, prev);
});

test('getAccessToken ขอ token ด้วย Client Credentials Flow แล้ว cache ไว้ใช้ซ้ำ', async () => {
  let tokenCalls = 0;
  const fetchImpl: FakeFetch = async (url, opts) => {
    if (url === `${BASE}/auth2/connect/token`) {
      tokenCalls += 1;
      assert.equal(opts.method, 'POST');
      const params = new URLSearchParams(opts.body);
      assert.equal(params.get('grant_type'), 'client_credentials');
      assert.equal(params.get('client_id'), 'cid');
      assert.equal(params.get('client_secret'), 'csecret');
      return jsonResponse({ access_token: 'tok-123', expires_in: 3600 });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  await withFetch(fetchImpl, async () => {
    const c = client();
    const t1 = await c.getAccessToken();
    const t2 = await c.getAccessToken();
    assert.equal(t1, 'tok-123');
    assert.equal(t2, 'tok-123');
    assert.equal(tokenCalls, 1, 'ต้องขอ token แค่ครั้งเดียว เพราะ cache ไว้ใช้ซ้ำ');
  });
});

test('extractDocument: launch -> poll จน Processed -> โหลดไฟล์ผลลัพธ์', async () => {
  let statusCallCount = 0;
  const fetchImpl: FakeFetch = async (url, opts) => {
    if (url === `${BASE}/auth2/connect/token`) {
      return jsonResponse({ access_token: 'tok-123', expires_in: 3600 });
    }
    if (String(url).startsWith(`${BASE}/api/publicapi/v1/transactions/launch`)) {
      assert.match(String(url), /skillId=skill-1/);
      assert.equal(opts.method, 'POST');
      return jsonResponse({ transactionId: 'txn-1' }, { status: 201 });
    }
    if (url === `${BASE}/api/publicapi/v1/transactions/txn-1`) {
      statusCallCount += 1;
      // หน้าแรกยังไม่เสร็จ (New) หน้าที่สองเสร็จแล้ว (Processed) — ทดสอบว่า poll ทำงานจริง
      const status = statusCallCount === 1 ? 'New' : 'Processed';
      return jsonResponse({
        id: 'txn-1',
        status,
        manualReviewLink: null,
        documents: status === 'Processed'
          ? [{ id: 'doc-1', resultFiles: [{ fileId: 'file-1', fileName: 'result.json', type: 'Json' }] }]
          : [],
      });
    }
    if (url === `${BASE}/api/publicapi/v1/transactions/txn-1/files/file-1/download`) {
      return jsonResponse({ employeeName: 'Somchai Jaidee', period: '2026-05' });
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  const originalSetTimeout = globalThis.setTimeout;
  // ตัดเวลารอระหว่าง poll ออกให้เทสต์รันเร็ว ไม่ต้องรอ 1.5 วินาทีจริง
  globalThis.setTimeout = ((fn: any) => originalSetTimeout(fn, 0)) as typeof globalThis.setTimeout;
  try {
    await withFetch(fetchImpl, async () => {
      const result = await client().extractDocument(Buffer.from('%PDF-1.4 fake'), 'test.pdf');
      assert.equal(result.transactionId, 'txn-1');
      assert.deepEqual(result.rawResult, { employeeName: 'Somchai Jaidee', period: '2026-05' });
      assert.equal(statusCallCount, 2, 'ต้อง poll สถานะ 2 ครั้งก่อนเจอ Processed');
    });
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
});

test('extractDocument โยน AbbyyError ถ้าสถานะ Failed', async () => {
  const fetchImpl: FakeFetch = async (url) => {
    if (url === `${BASE}/auth2/connect/token`) return jsonResponse({ access_token: 'tok', expires_in: 3600 });
    if (String(url).includes('/launch')) return jsonResponse({ transactionId: 'txn-2' }, { status: 201 });
    if (url === `${BASE}/api/publicapi/v1/transactions/txn-2`) {
      return jsonResponse({ id: 'txn-2', status: 'Failed', documents: [] });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  await withFetch(fetchImpl, async () => {
    await assert.rejects(
      () => client().extractDocument(Buffer.from('x'), 'a.pdf'),
      (err: unknown) => err instanceof AbbyyError && /ไม่สำเร็จ/.test(err.message),
    );
  });
});

test('getAccessToken โยน AbbyyError ถ้า ABBYY ตอบกลับมาไม่มี access_token', async () => {
  await withFetch(async () => jsonResponse({}), async () => {
    await assert.rejects(
      () => client().getAccessToken(),
      (err: unknown) => err instanceof AbbyyError && /access_token/.test(err.message),
    );
  });
});

/* Timesheet2 ยัง train ฟิลด์ไม่ครบพร้อมกันในชีวิตจริง (ดูคอมเมนต์หัวไฟล์ abbyy.js) เทสต์นี้จึงสร้าง
   ข้อมูลจำลองแทนการ snapshot ผลจริง — กัน flaky เวลา ABBYY publish ฟิลด์เพิ่มแล้ว fixture เก่าล้าสมัย
   สมมติว่า train ครบทุกฟิลด์ของ Timesheet2 แล้ว (Position, Total Work days, Month Year, Leave
   Sick ฯลฯ) เพื่อยืนยันว่า mapAbbyyResult() อ่านชื่อฟิลด์เหล่านี้ถูกต้อง */
test('mapAbbyyResult อ่านชื่อฟิลด์ของ Timesheet2 ได้ถูกต้องครบ (Position/Total Work days/Month Year/Leave Sick)', () => {
  const data = mapAbbyyResult({
    Transaction: { Documents: [{ ExtractedData: { RootObject: { Fields: [
      { Name: 'Vendor', List: [{ Value: 'iPassion Co.,Ltd.' }] },
      { Name: 'Client Name', List: [{ Value: 'PTT Co.,Ltd.' }] },
      { Name: 'Project Name', List: [{ Value: 'Outsource for PTT Project' }] },
      { Name: 'Month Year', List: [{ Value: 'May 2026' }] },
      { Name: 'Employee Name', List: [{ Value: 'Pitikorn Chumphuchanapai' }] },
      { Name: 'Position', List: [{ Value: 'OutSystems Developer' }] },
      { Name: 'Total Work days', List: [{ Value: '19' }] },
      { Name: 'Leave Sick', List: [{ Value: '2' }] },
      { Name: 'Total Hours', List: [{ Value: '152.00' }] },
      { Name: 'Approver', List: [{ Value: 'Nichaphat Chokrak' }] },
    ] } } }] },
  });

  assert.equal(data.vendor, 'iPassion Co.,Ltd.');
  assert.equal(data.clientName, 'PTT Co.,Ltd.');
  assert.equal(data.projectName, 'Outsource for PTT Project');
  assert.equal(data.employeeName, 'Pitikorn Chumphuchanapai');
  assert.equal(data.position, 'OutSystems Developer');
  assert.equal(data.period, '2026-05');
  assert.equal(data.totalWorkDays, 19);
  assert.equal(data.totalLeaveDays, 2);
  assert.equal(data.totalHours, 152);
  assert.equal(data.projectManagerSignatureName, 'Nichaphat Chokrak');
  assert.equal(data.signedByProjectManager, true);
  assert.equal(data.signedByEmployee, true);
});

test('mapAbbyyResult คืน position/period เป็น null ถ้า ABBYY ยังไม่ส่งฟิลด์นั้นมา (ไม่รองรับชื่อฟิลด์เก่าอีกแล้ว)', () => {
  const data = mapAbbyyResult({
    Transaction: { Documents: [{ ExtractedData: { RootObject: { Fields: [
      { Name: 'Employee Name', List: [{ Value: 'Somchai Jaidee' }] },
      // ชื่อฟิลด์เก่าของ Skill "Timesheet" รุ่นแรก (Role/Man Day/Year) ต้องไม่ถูกอ่านแล้ว
      { Name: 'Role', List: [{ Value: 'Java Programmer' }] },
      { Name: 'Man Day', List: [{ Value: '20' }] },
      { Name: 'Year', List: [{ Value: 'May 2026' }] },
    ] } } }] },
  });
  assert.equal(data.employeeName, 'Somchai Jaidee');
  assert.equal(data.position, null);
  assert.equal(data.totalWorkDays, 0);
  assert.equal(data.period, null);
  assert.deepEqual(data.days, []);
  // ต้นฉบับเขียนชื่อฟิลด์ ("Total Work days"/"Month Year") ลงในโน้ตตรงๆ — พอร์ตนี้ตัดออกโดยตั้งใจ
  // เพราะชื่อฟิลด์ตั้งค่าได้แล้วต่อ Skill ผ่าน fieldMap (ดูคอมเมนต์ใน abbyyClient.ts) ระบุชื่อตายตัว
  // ในข้อความจะกลายเป็นข้อมูลผิดสำหรับ Skill ที่ตั้งชื่อฟิลด์ไว้อย่างอื่น
  assert.match(data.notes.join(' '), /ยังไม่ส่งจำนวนวันทำงานมา/);
  assert.match(data.notes.join(' '), /ยังไม่ส่งรอบเดือนมา/);
});

test('mapAbbyyResult คืน days เป็น [] ถ้าหาวันที่ในตาราง "New Table" ไม่เจอเลยสักแถว (แถวนี้ไม่มีรูปแบบ DD/MM/YY อยู่คอลัมน์ไหนเลย)', () => {
  const data = mapAbbyyResult({
    Transaction: { Documents: [{ ExtractedData: { RootObject: { Fields: [
      { Name: 'Month Year', List: [{ Value: 'May 2026' }] },
      { Name: 'New Table', List: [{ Value: { Fields: [
        { Name: 'Date', List: [{ Value: '5' }] },
        { Name: 'Time In', List: [{ Value: '9:00' }] },
      ] } }] },
    ] } } }] },
  });
  assert.deepEqual(data.days, []);
  assert.match(data.notes.join(' '), /ยังไม่ได้ตารางรายวันมาเลย/);
});

test('mapAbbyyResult ดึง days จากตาราง "New Table" ได้ (25 ส.ค. 69 หลังเทรน Skill ให้กรอก Type/Description '
  + 'ครบทุกแถวไม่เว้นว่าง คอลัมน์เสถียรขึ้น) — ดึงเวลาเข้า-ออก/รายละเอียดงานให้แล้ว', () => {
  const data = mapAbbyyResult({
    Transaction: { Documents: [{ ExtractedData: { RootObject: { Fields: [
      { Name: 'New Table', List: [
        tableRow({
          Date: '1', Day: '01/06/26', Project: '', Type: 'Working', Description: 'แก้บั๊ก A',
          'Time In': '9:00', 'Time Out': '18:00',
        }),
        // วันหยุดสุดสัปดาห์ — ไม่มีเวลาเข้า-ออกเลย (ตรงตามที่ควรเป็น ไม่ใช่แค่ค่าว่าง 2 คอลัมน์บังเอิญ)
        tableRow({ Date: '2', Day: '02/06/26', Project: '', Type: 'Weekend', Description: 'Weekend' }),
      ] },
    ] } } }] },
  });

  assert.equal(data.days.length, 2);
  assert.equal(data.days[0].date, '2026-06-01');
  assert.equal(data.days[0].timeIn, '9:00');
  assert.equal(data.days[0].timeOut, '18:00');
  assert.equal(data.days[0].jobDescription, 'แก้บั๊ก A');
  assert.equal(data.days[1].date, '2026-06-02');
  assert.equal(data.days[1].timeIn, null);
  assert.equal(data.days[1].timeOut, null);
});

test('mapAbbyyResult ดึง dayOfWeek/project/type/ชั่วโมงสรุปจากตาราง "New Table" ได้ครบ (27 ส.ค. 69 ตามที่ขอ) '
  + 'และเชื่อชั่วโมงที่ ABBYY อ่านมาก่อนถ้ามี', () => {
  const data = mapAbbyyResult({
    Transaction: { Documents: [{ ExtractedData: { RootObject: { Fields: [
      { Name: 'New Table', List: [
        tableRow({
          Date: '1', Day: '01/06/26', Project: 'BSCP-AI', Type: 'Working', Description: 'แก้บั๊ก A',
          'Time In': '9:00', 'Time Out': '18:00', Normal: '8.00', OT: '0.00', 'Total per day': '8.00',
        }),
      ] },
    ] } } }] },
  });

  assert.equal(data.days[0].date, '2026-06-01');
  assert.equal(data.days[0].dayOfWeek, 'Mon'); // 1 มิ.ย. 2569 ตรงกับวันจันทร์จริง
  assert.equal(data.days[0].project, 'BSCP-AI');
  assert.equal(data.days[0].type, 'Working');
  assert.equal(data.days[0].normalHours, 8);
  assert.equal(data.days[0].otHours, 0);
  assert.equal(data.days[0].totalHours, 8);
});

test('mapAbbyyResult ดึงเวลา OT In/Out และคำนวณชม.เองเมื่อตารางมี 4 ค่าเวลาในแถวเดียวแต่ไม่มีคอลัมน์ '
  + 'Normal/OT/Total per day สรุปมาให้ (27 ส.ค. 69 ตามที่ขอ — เผื่อพนักงานกรอกแค่เวลาเข้า-ออก)', () => {
  const data = mapAbbyyResult({
    Transaction: { Documents: [{ ExtractedData: { RootObject: { Fields: [
      { Name: 'New Table', List: [
        tableRow({
          Date: '1', Day: '01/06/26', Project: 'BSCP-AI', Type: 'Working', Description: 'ปิดงานด่วน',
          'Time In': '9:00', 'Time Out': '18:00', 'OT In': '19:00', 'OT Out': '21:00',
        }),
      ] },
    ] } } }] },
  });

  assert.equal(data.days[0].otTimeIn, '19:00');
  assert.equal(data.days[0].otTimeOut, '21:00');
  assert.equal(data.days[0].normalHours, 9); // คำนวณเอง 18:00-9:00 เพราะไม่มีคอลัมน์ Normal สรุปมาให้
  assert.equal(data.days[0].otHours, 2);     // คำนวณเอง 21:00-19:00
  assert.equal(data.days[0].totalHours, 11); // รวมเอง 9+2 เพราะไม่มีคอลัมน์ Total per day สรุปมาให้
});

test('mapAbbyyResult ตัดข้อความ Description/Type ที่ ABBYY อ่านซ้ำสองรอบทับกันทิ้ง '
  + '(เจอจริง: "Vacation Leave Vacation Leave" — 27 ส.ค. 69)', () => {
  const data = mapAbbyyResult({
    Transaction: { Documents: [{ ExtractedData: { RootObject: { Fields: [
      { Name: 'New Table', List: [
        tableRow({
          Date: '1', Day: '01/06/26', Type: 'Leave', Description: 'Vacation Leave Vacation Leave',
        }),
      ] },
    ] } } }] },
  });

  assert.equal(data.days[0].jobDescription, 'Vacation Leave');
  assert.equal(data.days[0].type, 'Leave');
});

/** สร้าง row ของ "New Table" ให้ทดสอบง่ายๆ — cols เป็น { ชื่อคอลัมน์: ค่า } */
function tableRow(cols: Record<string, string>) {
  return { Value: { Fields: Object.entries(cols).map(([name, value]) => ({
    Name: name, List: [{ Value: value }],
  })) } };
}

test('mapAbbyyResult ดึงวันลาจากตาราง "New Table" ได้ แม้ป้ายกำกับ "Sick Leave" ไปอยู่คอลัมน์ผิด (จำลองคอลัมน์สลับตำแหน่ง)', () => {
  const data = mapAbbyyResult({
    Transaction: { Documents: [{ ExtractedData: { RootObject: { Fields: [
      { Name: 'New Table', List: [
        tableRow({ Date: '1', Day: '01/06/26', Project: 'Mon', 'Total per day': '0.00' }),
        // ป้าย "Sick Leave" หลุดไปอยู่คอลัมน์ "Project" (ไม่ใช่ "Type") จำลองคอลัมน์สลับตำแหน่ง
        tableRow({ Date: '2', Day: '02/06/26', Project: 'Sick Leave', 'Total per day': '0.00' }),
        tableRow({ Date: '3', Day: '03/06/26', Project: 'Wed', 'Time In': '9:00', 'Time Out': '18:00' }),
        // แถวหัวตาราง/ลายเซ็นที่หลุดมาปน — "Day" ไม่ใช่รูปแบบวันที่ ต้องไม่ถูกนับ
        tableRow({ Date: 'No.', Day: 'Date', Description: 'บริษัท ไทยประกันชีวิต ลาน้ำ' }),
      ] },
    ] } } }] },
  });

  assert.equal(data.leaveDays.length, 1);
  assert.equal(data.leaveDays[0].date, '2026-06-02');
  assert.equal(data.leaveDays[0].type, 'sick');
  assert.equal(data.totalLeaveDays, 1);
  assert.match(data.notes.join(' '), /ตรวจสอบวันที่กับ PDF ต้นฉบับ/);
});

test('mapAbbyyResult ไม่จับ "ลา" ที่แทรกอยู่กลางคำอื่นในคอลัมน์ "Description" ว่าเป็นวันลา (ไม่สแกน Description)', () => {
  const data = mapAbbyyResult({
    Transaction: { Documents: [{ ExtractedData: { RootObject: { Fields: [
      { Name: 'New Table', List: [
        // "ลาน" ("บริเวณลานจอด") อยู่ใน Description เท่านั้น คอลัมน์อื่นบอกว่าเป็นวันทำงานปกติ
        tableRow({
          Date: '5', Day: '05/06/26', Project: 'Fri', Type: 'Working',
          Description: 'ทำงานที่บริเวณลานจอดรถ ติดตั้งกล้อง', 'Time In': '9:00', 'Time Out': '18:00',
        }),
      ] },
    ] } } }] },
  });
  assert.deepEqual(data.leaveDays, []);
});

test('mapAbbyyResult จับวันลาได้แม้ ABBYY แยกคำเป็นคนละคอลัมน์กัน (เจอจริง: Type="Vacation", Description="Leave")', () => {
  const data = mapAbbyyResult({
    Transaction: { Documents: [{ ExtractedData: { RootObject: { Fields: [
      { Name: 'New Table', List: [
        tableRow({ Date: '1', Day: '01/07/26', Project: 'Wed', Type: 'Vacation', Description: 'Leave' }),
      ] },
    ] } } }] },
  });
  assert.equal(data.leaveDays.length, 1);
  assert.equal(data.leaveDays[0].date, '2026-07-01');
  assert.equal(data.leaveDays[0].type, 'vacation');
});

test('mapAbbyyResult ใช้จำนวนวันลาจากตาราง (มีวันที่จริง) แทนฟิลด์สรุป "Leave Sick" ถ้าไม่ตรงกัน พร้อมโน้ตเตือน', () => {
  const data = mapAbbyyResult({
    Transaction: { Documents: [{ ExtractedData: { RootObject: { Fields: [
      { Name: 'Leave Sick', List: [{ Value: '3' }] }, // ฟิลด์สรุปบอกว่ามี 3 วัน
      { Name: 'New Table', List: [
        tableRow({ Date: '2', Day: '02/06/26', Project: 'Personal Leave' }), // ตารางเจอแค่ 1 วัน
      ] },
    ] } } }] },
  });
  assert.equal(data.leaveDays.length, 1);
  assert.equal(data.leaveDays[0].type, 'personal');
  assert.equal(data.totalLeaveDays, 1); // เชื่อตารางที่มีวันที่จริงมากกว่าตัวเลขสรุปเปล่าๆ
  assert.match(data.notes.join(' '), /ไม่ตรงกัน/);
});

test('mapAbbyyResult คืน days เป็น [] ถ้าจำนวนค่าใน Work Hour per Day (ตารางแบบก้อนข้อความเดิม) ไม่ตรงกับจำนวนวันในเดือน', () => {
  const data = mapAbbyyResult({
    Transaction: { Documents: [{ ExtractedData: { RootObject: { Fields: [
      { Name: 'Month Year', List: [{ Value: 'May 2026' }] },
      { Name: 'Work Hour per Day', List: [{ Value: '8.00\n8.00' }] }, // แค่ 2 ค่า ไม่ใช่ 31
      { Name: 'Time In', List: [{ Value: '9:00\n9:00' }] },
      { Name: 'Time Out', List: [{ Value: '18:00\n18:00' }] },
    ] } } }] },
  });
  assert.deepEqual(data.days, []);
  assert.match(data.notes.join(' '), /ไม่ได้ใส่ตารางรายวันให้/);
});

/* ── fieldMap ต่อ Skill: รูปเก่า (แบน) / รูปกลาง (TimesheetFieldMap) / คอลัมน์ตารางรายวัน ────────── */

/** ค่าจริงที่ตั้งไว้กับ Skill "Big-C" บนเครื่อง production (SKL-0002, อ่านมาเมื่อ 16 ก.ย. 69) — pin ไว้
 * เป็นเทสต์เพราะแถวนี้ยังเป็นรูปเก่าอยู่จริง ถ้าการแปลงรูปเก่า→รูปกลางพัง ลูกค้ารายนี้จะอ่านผิดเงียบๆ */
const BIGC_LEGACY_FIELD_MAP = {
  year: 'Year', month: 'Month', position: 'Position', monthYear: 'Month_Year',
  tableName: 'New Table', employeeName: 'Name', totalWorkDays: 'Total work day',
};

function docFields(fields: Array<{ Name: string; Value: unknown }>) {
  return {
    Transaction: { Documents: [{ ExtractedData: { RootObject: {
      Fields: fields.map((f) => ({ Name: f.Name, List: [{ Value: f.Value }] })),
    } } }] },
  };
}

test('fieldMap รูปเก่า (แบน) ยังใช้ได้เหมือนเดิม — ค่าจริงของ Skill Big-C บน production', () => {
  const data = mapAbbyyResult(docFields([
    { Name: 'Name', Value: 'Iptisam Samaheng' },
    { Name: 'Position', Value: 'Java Programmer' },
    { Name: 'Month_Year', Value: 'May 2026' },
    { Name: 'Total work day', Value: '19' },
  ]), BIGC_LEGACY_FIELD_MAP);

  assert.equal(data.employeeName, 'Iptisam Samaheng');
  assert.equal(data.position, 'Java Programmer');
  assert.equal(data.period, '2026-05');
  assert.equal(data.totalWorkDays, 19);
});

test('fieldMap รูปเก่า: month+year แยกสองฟิลด์ (Lotus/Big-C) ย้ายมาเป็น monthYearSplit ให้อัตโนมัติ', () => {
  const data = mapAbbyyResult(docFields([
    { Name: 'Name', Value: 'Somchai Jaidee' },
    { Name: 'Month', Value: 'May' },
    { Name: 'Year', Value: '2026' },
  ]), BIGC_LEGACY_FIELD_MAP);

  assert.equal(data.period, '2026-05');
});

test('fieldMap รูปกลาง: อ่านฟิลด์หัวเอกสารตามชื่อที่ Skill ตั้งไว้เอง + ฟิลด์ใหม่ตามสารบัญกลาง', () => {
  const data = mapAbbyyResult(docFields([
    { Name: 'ชื่อ-สกุล', Value: 'Sunee Maneekasemsuk' },
    { Name: 'รหัสพนักงาน', Value: 'EMP001' },
    { Name: 'หน่วยงาน', Value: 'Digital Transformation' },
    { Name: 'Month Year', Value: 'January 2026' },
  ]), {
    header: { employeeName: 'ชื่อ-สกุล', employeeId: 'รหัสพนักงาน', department: 'หน่วยงาน', position: null },
  });

  assert.equal(data.employeeName, 'Sunee Maneekasemsuk');
  assert.equal(data.employeeId, 'EMP001');
  assert.equal(data.department, 'Digital Transformation');
  assert.equal(data.period, '2026-01');
  // position: null = Skill นี้ไม่มีฟิลด์นี้จริงๆ ต้องไม่ไปหยิบค่า default "Position" มาใช้
  assert.equal(data.position, null);
});

test('fieldMap รูปกลาง: คอลัมน์เวลาที่ map ไว้ชัดเจน ต้องชนะการเดาจากการเรียงเวลา (กะดึก 22:00→06:00)', () => {
  const nightShift = docFields([
    { Name: 'Month Year', Value: 'May 2026' },
    { Name: 'New Table', Value: { Fields: [
      { Name: 'Date', List: [{ Value: '05/05/26' }] },
      { Name: 'เข้างาน', List: [{ Value: '22:00' }] },
      { Name: 'ออกงาน', List: [{ Value: '06:00' }] },
    ] } },
  ]);

  // ไม่ตั้ง mapping = เดาแบบเดิม (เรียงเวลาน้อยไปมาก) → สลับกัน เพราะ 06:00 มาก่อน 22:00
  const guessed = mapAbbyyResult(nightShift);
  assert.equal(guessed.days[0].timeIn, '06:00');
  assert.equal(guessed.days[0].timeOut, '22:00');
  assert.equal(guessed.days[0].normalHours, 16);

  // ตั้ง mapping ไว้ = เชื่อคอลัมน์ ไม่เดา → ได้กะดึกที่ถูกต้อง 8 ชม.
  const mapped = mapAbbyyResult(nightShift, { detail: { timeIn: 'เข้างาน', timeOut: 'ออกงาน' } });
  assert.equal(mapped.days[0].timeIn, '22:00');
  assert.equal(mapped.days[0].timeOut, '06:00');
  assert.equal(mapped.days[0].normalHours, 8);
});

test('fieldMap รูปกลาง: ตั้งชื่อคอลัมน์ตารางรายวันเองได้ครบ (โครงการ/ประเภท/ชั่วโมง/รายละเอียด)', () => {
  const data = mapAbbyyResult(docFields([
    { Name: 'Month Year', Value: 'May 2026' },
    { Name: 'ตารางรายวัน', Value: { Fields: [
      { Name: 'วันที่', List: [{ Value: '06/05/26' }] },
      { Name: 'โครงการ', List: [{ Value: 'PRJ26050' }] },
      { Name: 'ประเภท', List: [{ Value: 'Working' }] },
      { Name: 'ชม.ปกติ', List: [{ Value: '8' }] },
      { Name: 'ชม.โอที', List: [{ Value: '2' }] },
      { Name: 'งานที่ทำ', List: [{ Value: 'แก้บั๊กหน้าจอรายงาน' }] },
    ] } },
  ]), {
    tableName: 'ตารางรายวัน',
    detail: {
      date: 'วันที่', project: 'โครงการ', workType: 'ประเภท',
      normalHours: 'ชม.ปกติ', otHours: 'ชม.โอที', jobDescription: 'งานที่ทำ',
    },
  });

  assert.equal(data.days.length, 1);
  assert.equal(data.days[0].date, '2026-05-06');
  assert.equal(data.days[0].project, 'PRJ26050');
  assert.equal(data.days[0].type, 'Working');
  assert.equal(data.days[0].normalHours, 8);
  assert.equal(data.days[0].otHours, 2);
  assert.equal(data.days[0].jobDescription, 'แก้บั๊กหน้าจอรายงาน');
  assert.equal(data.totalWorkDays, 1);
  assert.deepEqual(data.otDays, [{ date: '2026-05-06', hours: 2 }]);
});

test('fieldMap รูปกลาง: tableName เป็น null = Skill นี้ไม่มีตารางรายวันเลย (ต่างจากไม่ได้ตั้งค่า)', () => {
  const data = mapAbbyyResult(docFields([
    { Name: 'Month Year', Value: 'May 2026' },
    { Name: 'New Table', Value: { Fields: [
      { Name: 'Date', List: [{ Value: '05/05/26' }] },
    ] } },
  ]), { tableName: null });

  assert.deepEqual(data.days, []);
});

test('toCanonicalFieldMap: แปลงรูปเก่าเป็นรูปกลางให้หน้าตั้งค่า (ไม่เติมค่า default ลงไป)', () => {
  const canonical = toCanonicalFieldMap(BIGC_LEGACY_FIELD_MAP);

  // ⚠️ ต้องเช็คค่าที่ "ต้องไม่มี" ก่อน assert.deepEqual() เสมอ — deepEqual ของ node:assert เป็น
  // assertion function (`asserts actual is T`) ที่ narrow ตัวแปรให้แคบลงเหลือแค่รูปที่คาดไว้ พอผ่าน
  // บรรทัดนั้นไปแล้ว TypeScript จะมองว่าคีย์อื่นไม่มีอยู่จริงและ error ตอน typecheck (ไม่ใช่ตอนรัน)
  // ห้ามมีค่า default โผล่มา ไม่งั้นหน้าตั้งค่าจะเข้าใจผิดว่าแอดมินตั้งค่าพวกนี้ไว้เอง แล้วบันทึกทับเป็นค่าจริง
  assert.equal(canonical?.header?.vendorName, undefined);
  assert.equal(canonical?.detail, undefined);

  assert.deepEqual(canonical, {
    header: { employeeName: 'Name', position: 'Position', monthYear: 'Month_Year', totalWorkDays: 'Total work day' },
    monthYearSplit: { month: 'Month', year: 'Year' },
    tableName: 'New Table',
  });
});

test('toCanonicalFieldMap: รูปกลางส่งผ่านตรงๆ และ null คือยังไม่ได้ตั้งค่าเลย', () => {
  const already = { header: { employeeName: 'ชื่อ-สกุล' }, detail: { timeIn: 'เข้า' } };
  assert.deepEqual(toCanonicalFieldMap(already), already);
  assert.equal(toCanonicalFieldMap(null), null);
  assert.equal(toCanonicalFieldMap(undefined), null);
});

/** เคสที่ frontend เจอตอนทดสอบ guard: map ว่างเปล่า `{}` แยกไม่ออกว่าเป็นรูปเก่าหรือรูปกลาง — ฝั่งนี้
 * ต้องไม่สนใจว่าตัดสินเป็นรูปไหน เพราะแปลงออกมาต้องได้ผลเดียวกัน (Skill ที่ยังไม่ตั้งค่า = ใช้ default
 * ทั้งหมด) เช่นเดียวกับ map ที่มีแต่ `tableName` ซึ่งเป็นคีย์เดียวที่มีเหมือนกันทั้งสองรูป */
test('fieldMap ว่างเปล่า / มีแต่ tableName: แปลงได้ผลเดียวกันไม่ว่าจะถูกตัดสินเป็นรูปไหน', () => {
  const doc = docFields([
    { Name: 'Employee Name', Value: 'Somchai Jaidee' },
    { Name: 'Month Year', Value: 'May 2026' },
  ]);

  // {} = ยังไม่ตั้งค่าอะไรเลย ต้องเท่ากับไม่ส่ง fieldMap มาเลย (ใช้ default ของ OBS Timesheet2)
  assert.deepEqual(mapAbbyyResult(doc, {}), mapAbbyyResult(doc));
  assert.equal(mapAbbyyResult(doc, {}).employeeName, 'Somchai Jaidee');

  // ตั้งแต่ tableName อย่างเดียว ก็ยังต้องอ่านฟิลด์หัวเอกสารด้วย default ได้ตามปกติ
  const tableOnly = mapAbbyyResult(doc, { tableName: 'New Table' });
  assert.equal(tableOnly.employeeName, 'Somchai Jaidee');
  assert.equal(tableOnly.period, '2026-05');

  // และแปลงไปรูปกลางสำหรับหน้าตั้งค่าแล้วต้องไม่กลายเป็น null/หายไป
  assert.deepEqual(toCanonicalFieldMap({}), { header: {} });
  assert.deepEqual(toCanonicalFieldMap({ tableName: null }), { header: {}, tableName: null });
});

/** รูปแบบ "เดือน/ปี" ที่พบจริงในฟอร์มลูกค้า — สองแบบล่าง ("8 2026", "08/2026") เป็นตัวอย่างในสารบัญ
 * กลางเองแต่เดิมอ่านไม่ออกเลย ส่วนปี พ.ศ. เดิมให้ผลผิดแบบเงียบๆ ("May 2569" → "2569-05") ซึ่งอันตราย
 * กว่าอ่านไม่ออก เพราะรอบเดือนที่ไม่มีอยู่จริงจะไหลต่อไปถึงการวางบิลโดยไม่มีอะไรเตือน */
test('resolvePeriod: อ่านรูปแบบเดือน/ปีได้หลากหลาย และแปลงปี พ.ศ. เป็น ค.ศ. ให้เสมอ', () => {
  const period = (value: string) => mapAbbyyResult(docFields([{ Name: 'Month Year', Value: value }])).period;

  assert.equal(period('May 2026'), '2026-05');
  assert.equal(period('January 2026'), '2026-01');
  assert.equal(period('Jan 2026'), '2026-01');
  assert.equal(period('8 2026'), '2026-08');
  assert.equal(period('08/2026'), '2026-08');
  assert.equal(period('พฤษภาคม 2569'), '2026-05');
  assert.equal(period('May 2569'), '2026-05');

  // ต้องไม่เผลอตีความค่าที่ไม่ใช่รอบเดือนให้กลายเป็นรอบเดือน
  assert.equal(period('01/08/2026 - 31/08/2026'), null);
  assert.equal(period(''), null);
});

/** ลำดับความสำคัญจริงของ period: ฟิลด์รวมมาก่อน แต่ "มาก่อน" ไม่ได้แปลว่าฟิลด์แยกเป็นของตาย — ถ้า
 * ฟิลด์รวมไม่มีในเอกสารหรืออ่านไม่ออก ฟิลด์แยกจะทำงานแทนทันที (Skill Big-C ตั้งไว้ทั้งสองแบบ) */
test('resolvePeriod: ฟิลด์แยก month+year เป็นตัวสำรองจริงตอนฟิลด์รวมอ่านไม่ออก ไม่ใช่ config ที่ตายแล้ว', () => {
  const both = (combined: string | null) => mapAbbyyResult(
    docFields([
      ...(combined === null ? [] : [{ Name: 'Month_Year', Value: combined }]),
      { Name: 'Month', Value: 'August' },
      { Name: 'Year', Value: '2026' },
    ]),
    BIGC_LEGACY_FIELD_MAP,
  ).period;

  assert.equal(both('May 2026'), '2026-05');   // ฟิลด์รวมอ่านออก → ชนะ
  assert.equal(both(null), '2026-08');         // ไม่มีฟิลด์รวมในเอกสาร → ใช้ฟิลด์แยก
  assert.equal(both('ไม่ใช่เดือน'), '2026-08'); // มีฟิลด์รวมแต่อ่านไม่ออก → ใช้ฟิลด์แยก
});

/** การตั้งค่าต้องไม่ทำให้ผลแย่ลงกว่าไม่ตั้ง — คนตั้งค่ามักตั้งแค่เวลาเข้า-ออกก่อน (เป็นคู่ที่เห็นชัดสุด)
 * ถ้าแค่นั้นทำให้ OT ที่เคยตรวจเจอหายไป ค่าจ้าง OT จะหายจากบิลเงียบๆ ไม่มี error ให้เห็น */
test('fieldMap: ตั้งค่าเฉพาะเวลาเข้า-ออก ต้องยังตรวจเจอ OT จากคอลัมน์ที่เหลือเหมือนตอนไม่ได้ตั้งค่า', () => {
  const row = docFields([
    { Name: 'Month Year', Value: 'May 2026' },
    { Name: 'New Table', Value: { Fields: [
      { Name: 'Date', List: [{ Value: '05/05/26' }] },
      { Name: 'เข้า', List: [{ Value: '8:30' }] },
      { Name: 'ออก', List: [{ Value: '17:30' }] },
      { Name: 'คอลัมน์ OT 1', List: [{ Value: '18:00' }] },
      { Name: 'คอลัมน์ OT 2', List: [{ Value: '20:00' }] },
    ] } },
  ]);

  const unmapped = mapAbbyyResult(row).days[0];
  assert.equal(unmapped.otTimeIn, '18:00');
  assert.equal(unmapped.otTimeOut, '20:00');
  assert.equal(unmapped.otHours, 2);

  // ตั้งแค่เวลาเข้า-ออก: เข้า-ออกต้องมาจากคอลัมน์ที่ตั้งไว้ และ OT ต้องยังเจอจากคอลัมน์ที่เหลือ
  const partial = mapAbbyyResult(row, { detail: { timeIn: 'เข้า', timeOut: 'ออก' } }).days[0];
  assert.equal(partial.timeIn, '8:30');
  assert.equal(partial.timeOut, '17:30');
  assert.equal(partial.otTimeIn, '18:00');
  assert.equal(partial.otTimeOut, '20:00');
  assert.equal(partial.otHours, 2);

  // ตั้งครบทั้งสี่ช่อง: เชื่อคอลัมน์ที่ตั้งไว้ล้วนๆ
  const full = mapAbbyyResult(row, {
    detail: { timeIn: 'เข้า', timeOut: 'ออก', otTimeIn: 'คอลัมน์ OT 1', otTimeOut: 'คอลัมน์ OT 2' },
  }).days[0];
  assert.equal(full.otTimeIn, '18:00');
  assert.equal(full.otTimeOut, '20:00');
});

/** map คอลัมน์ "ประเภทการลา" = บอกว่าให้ดูช่องไหน ไม่ใช่บอกว่าช่องนั้นมีค่าแปลว่าลา — ตัวจำแนกยังเป็น
 * ตัวเดิม ฟอร์มที่พิมพ์ "-" ในวันทำงานปกติจึงต้องไม่กลายเป็นวันลาทั้งเดือน */
test('fieldMap: map leaveType แล้วต้องช่วยจำแนกได้แม่นขึ้น โดยไม่นับค่าที่ไม่ใช่การลาเป็นวันลา', () => {
  const row = (cells: Array<[string, unknown]>) => docFields([
    { Name: 'Month Year', Value: 'May 2026' },
    { Name: 'New Table', Value: { Fields: cells.map(([Name, Value]) => ({ Name, List: [{ Value }] })) } },
  ]);

  // "-" ในช่องประเภทการลาของวันทำงานปกติ ต้องไม่ถูกนับเป็นวันลา
  const working = mapAbbyyResult(row([
    ['Date', '05/05/26'], ['ประเภทการลา', '-'], ['Normal', '8'],
  ]), { detail: { leaveType: 'ประเภทการลา' } });
  assert.deepEqual(working.leaveDays, []);
  assert.equal(working.totalLeaveDays, 0);

  // ช่องที่ตั้งไว้บอกว่าลาป่วย → นับเป็นวันลา และได้ประเภทจากช่องนั้นตรงๆ
  const sick = mapAbbyyResult(row([
    ['Date', '06/05/26'], ['ประเภทการลา', 'ลาป่วย'], ['Description', 'หยุดพักรักษาตัว'],
  ]), { detail: { leaveType: 'ประเภทการลา' } });
  assert.equal(sick.leaveDays.length, 1);
  assert.equal(sick.leaveDays[0].type, 'sick');

  // ไม่ได้ตั้งค่า = พฤติกรรมเดิมทุกประการ (ยังเดาจากคอลัมน์อื่นได้เหมือนเดิม)
  const unmapped = mapAbbyyResult(row([
    ['Date', '06/05/26'], ['Type', 'Sick Leave'],
  ]));
  assert.equal(unmapped.leaveDays.length, 1);
  assert.equal(unmapped.leaveDays[0].type, 'sick');
});

/** ฟอร์ม Lotus เก็บเวลาเข้า-ออกรวมช่องเดียวเป็นช่วง "08.00 - 17.00" — ต้องแยกเป็นเวลาเข้า/ออกได้
 * โดยเก็บรูปแบบเดิมของเอกสารไว้ (ไม่แปลง "." เป็น ":") ตามกติกาของสารบัญกลาง */
test('fieldMap: ช่องเวลาที่เป็นช่วง "13.00 - 19.00" ต้องแยกเป็นเวลาเข้า/ออกได้ (ฟอร์มแบบ Lotus)', () => {
  const row = (cells: Array<[string, unknown]>) => docFields([
    { Name: 'Month Year', Value: 'March 2026' },
    { Name: 'New Table', Value: { Fields: cells.map(([Name, Value]) => ({ Name, List: [{ Value }] })) } },
  ]);

  // ใส่ชื่อคอลัมน์เดียวกันทั้งเวลาเข้าและเวลาออก = บอกว่าสองค่าอยู่ในช่องเดียวกัน
  const d = mapAbbyyResult(row([
    ['Date', '02/03/26'],
    ['Time', '13.00 - 19.00'],
    ['Time (OT)', '19.30 - 21.30'],
    ['Hrs', '6'],
  ]), {
    tableName: 'New Table',
    detail: { date: 'Date', timeIn: 'Time', timeOut: 'Time', otTimeIn: 'Time (OT)', otTimeOut: 'Time (OT)', normalHours: 'Hrs' },
  }).days[0];

  assert.equal(d.timeIn, '13.00');
  assert.equal(d.timeOut, '19.00');
  assert.equal(d.otTimeIn, '19.30');
  assert.equal(d.otTimeOut, '21.30');
  assert.equal(d.normalHours, 6);

  // ใส่แค่ช่องเวลาเข้าช่องเดียวก็แยกให้เหมือนกัน
  const onlyIn = mapAbbyyResult(row([['Date', '03/03/26'], ['Time', '08:00 - 17:00']]), {
    tableName: 'New Table', detail: { date: 'Date', timeIn: 'Time', timeOut: null },
  }).days[0];
  assert.equal(onlyIn.timeIn, '08:00');
  assert.equal(onlyIn.timeOut, '17:00');

  // ค่าที่ไม่ใช่ช่วงเวลา ต้องไม่ถูกแตะ
  const plain = mapAbbyyResult(row([['Date', '04/03/26'], ['เข้า', '9:00'], ['ออก', '18:00']]), {
    tableName: 'New Table', detail: { date: 'Date', timeIn: 'เข้า', timeOut: 'ออก' },
  }).days[0];
  assert.equal(plain.timeIn, '9:00');
  assert.equal(plain.timeOut, '18:00');
});
