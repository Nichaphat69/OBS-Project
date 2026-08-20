import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { AbbyyClient, AbbyyError, hasAbbyyCredentials, mapAbbyyResult } from '../src/extract/abbyy.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

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

/* ยืนยันด้วยการรันตรงกับผลจริงจาก ABBYY Skill "Timesheet" (17 ส.ค. 69) กับไฟล์จริง
   "Timesheet_Pitikorn_Chumphuchanapai_May_2026.pdf" — fixture นี้ตัดเฉพาะ Fields/List/Value
   ออกมาจากผลจริง (ตัด Annotations/ImageRegions/DocumentDefinition ที่ไม่เกี่ยวกับการ map ทิ้ง
   เพื่อลดขนาดไฟล์ ไม่ได้แก้ไขค่าจริงเลยสักตัว) */
test('mapAbbyyResult แปลผลจริงจาก ABBYY ได้ถูกต้องครบ — ชื่อ/ตำแหน่ง/รอบเดือน/ผู้อนุมัติ/ตารางรายวัน', async () => {
  const raw = JSON.parse(await readFile(join(FIXTURES, 'abbyy-timesheet-may2026.json'), 'utf8'));
  const data = mapAbbyyResult(raw);

  assert.equal(data.employeeName, 'Pitikorn Chumphuchanapai');
  assert.equal(data.position, 'OutSystems Developer');
  assert.equal(data.period, '2026-05');
  assert.equal(data.vendor, 'iPassion Co.,Ltd.');
  assert.equal(data.clientName, 'PTT Co.,Ltd.');
  assert.equal(data.totalWorkDays, 19);
  assert.equal(data.totalHours, 152);
  assert.equal(data.projectManagerSignatureName, 'Nichaphat Chokrak');
  assert.equal(data.signedByProjectManager, true);
  assert.equal(data.signedByEmployee, true);
  assert.equal(data.leaveDays.length, 0);

  // ตารางรายวัน: 19 วันทำงานจริง จับคู่ตำแหน่งกับ "Work Hour per Day" ที่มีครบ 31 วัน
  assert.equal(data.days.length, 19);
  const byDate = Object.fromEntries(data.days.map((d) => [d.date, d]));
  // เวลาเข้า-ออกส่วนใหญ่ 9:00-18:00 ยกเว้น 4 วันที่ในไฟล์จริงเลื่อนเวลาไปทีละชั่วโมง
  assert.deepEqual(byDate['2026-05-05'], {
    date: '2026-05-05', timeIn: '9:00', timeOut: '18:00',
    label: null, type: null, remark: null, jobDescription: null,
  });
  assert.equal(byDate['2026-05-12'].timeIn, '10:00');
  assert.equal(byDate['2026-05-12'].timeOut, '19:00');
  assert.equal(byDate['2026-05-13'].timeIn, '11:00');
  assert.equal(byDate['2026-05-14'].timeIn, '12:00');
  assert.equal(byDate['2026-05-15'].timeIn, '13:00');
  // วันหยุด/เสาร์-อาทิตย์ (เช่น 1, 2, 9, 10) ต้องไม่มีแถวใน days เลย
  assert.equal(byDate['2026-05-01'], undefined);
  assert.equal(byDate['2026-05-09'], undefined);
});

test('mapAbbyyResult คืน days เป็น [] ถ้าไม่พบฟิลด์ "Year" (ไม่รู้รอบเดือน จับคู่ตำแหน่งไม่ได้)', () => {
  const data = mapAbbyyResult({
    Transaction: { Documents: [{ ExtractedData: { RootObject: { Fields: [
      { Name: 'Employee Name', List: [{ Value: 'Somchai Jaidee' }] },
    ] } } }] },
  });
  assert.equal(data.employeeName, 'Somchai Jaidee');
  assert.deepEqual(data.days, []);
});

test('mapAbbyyResult คืน days เป็น [] ถ้าจำนวนค่าใน Work Hour per Day ไม่ตรงกับจำนวนวันในเดือน (ไม่มั่นใจว่าจับคู่ถูกแถว)', () => {
  const data = mapAbbyyResult({
    Transaction: { Documents: [{ ExtractedData: { RootObject: { Fields: [
      { Name: 'Year', List: [{ Value: 'May 2026' }] },
      { Name: 'Work Hour per Day', List: [{ Value: '8.00\n8.00' }] }, // แค่ 2 ค่า ไม่ใช่ 31
      { Name: 'Time In', List: [{ Value: '9:00\n9:00' }] },
      { Name: 'Time Out', List: [{ Value: '18:00\n18:00' }] },
    ] } } }] },
  });
  assert.deepEqual(data.days, []);
  assert.match(data.notes[0], /ไม่ได้ใส่ตารางรายวันให้/);
});
