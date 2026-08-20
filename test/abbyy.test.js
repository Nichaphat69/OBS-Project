import test from 'node:test';
import assert from 'node:assert/strict';
import { AbbyyClient, AbbyyError, hasAbbyyCredentials } from '../src/extract/abbyy.js';

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
