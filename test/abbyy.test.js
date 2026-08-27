import test from 'node:test';
import assert from 'node:assert/strict';
import { AbbyyClient, AbbyyError, hasAbbyyCredentials, mapAbbyyResult } from '../src/extract/abbyy.js';

const BASE = 'https://vantage-au.abbyy.com';

function client(fetchImpl) {
  return new AbbyyClient({
    baseUrl: BASE, clientId: 'cid', clientSecret: 'csecret', skillId: 'skill-1', fetchImpl,
  });
}

function jsonResponse(body, { ok = true, status = 200 } = {}) {
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
  const fetchImpl = async (url, opts) => {
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
  const c = client(fetchImpl);
  const t1 = await c.getAccessToken();
  const t2 = await c.getAccessToken();
  assert.equal(t1, 'tok-123');
  assert.equal(t2, 'tok-123');
  assert.equal(tokenCalls, 1, 'ต้องขอ token แค่ครั้งเดียว เพราะ cache ไว้ใช้ซ้ำ');
});

test('extractDocument: launch -> poll จน Processed -> โหลดไฟล์ผลลัพธ์', async () => {
  const calls = [];
  let statusCallCount = 0;
  const fetchImpl = async (url, opts) => {
    calls.push(url);
    if (url === `${BASE}/auth2/connect/token`) {
      return jsonResponse({ access_token: 'tok-123', expires_in: 3600 });
    }
    if (url.startsWith(`${BASE}/api/publicapi/v1/transactions/launch`)) {
      assert.match(url, /skillId=skill-1/);
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

  const c = client(fetchImpl);
  const originalSetTimeout = global.setTimeout;
  // ตัดเวลารอระหว่าง poll ออกให้เทสต์รันเร็ว ไม่ต้องรอ 1.5 วินาทีจริง
  global.setTimeout = (fn) => originalSetTimeout(fn, 0);
  try {
    const result = await c.extractDocument(Buffer.from('%PDF-1.4 fake'), 'test.pdf');
    assert.equal(result.transactionId, 'txn-1');
    assert.deepEqual(result.rawResult, { employeeName: 'Somchai Jaidee', period: '2026-05' });
    assert.equal(statusCallCount, 2, 'ต้อง poll สถานะ 2 ครั้งก่อนเจอ Processed');
  } finally {
    global.setTimeout = originalSetTimeout;
  }
});

test('extractDocument โยน AbbyyError ถ้าสถานะ Failed', async () => {
  const fetchImpl = async (url) => {
    if (url === `${BASE}/auth2/connect/token`) return jsonResponse({ access_token: 'tok', expires_in: 3600 });
    if (url.includes('/launch')) return jsonResponse({ transactionId: 'txn-2' }, { status: 201 });
    if (url === `${BASE}/api/publicapi/v1/transactions/txn-2`) {
      return jsonResponse({ id: 'txn-2', status: 'Failed', documents: [] });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  const c = client(fetchImpl);
  await assert.rejects(
    () => c.extractDocument(Buffer.from('x'), 'a.pdf'),
    (err) => err instanceof AbbyyError && /ไม่สำเร็จ/.test(err.message),
  );
});

test('getAccessToken โยน AbbyyError ถ้า ABBYY ตอบกลับมาไม่มี access_token', async () => {
  const fetchImpl = async () => jsonResponse({});
  const c = client(fetchImpl);
  await assert.rejects(
    () => c.getAccessToken(),
    (err) => err instanceof AbbyyError && /access_token/.test(err.message),
  );
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
  assert.match(data.notes.join(' '), /Total Work days/);
  assert.match(data.notes.join(' '), /Month Year/);
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

/** สร้าง row ของ "New Table" ให้ทดสอบง่ายๆ — cols เป็น { ชื่อคอลัมน์: ค่า } */
function tableRow(cols) {
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
