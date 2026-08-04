/**
 * ทดสอบ src/integrations/flowaccount.js — เฉพาะการแยกฟิลด์จาก response จริงของ FlowAccount
 *
 * ใส่ fetch จำลองแทนของจริง โดยรูปแบบ response อ้างจากผลที่ยิง sandbox จริงเมื่อ 31 ก.ค. 2569
 * (เก็บไว้ใน docs/checklist.md หัวข้อ 8) — เดิมโค้ดอ่านผิดฟิลด์ (เดา documentNumber/documentNo
 * ที่ไม่มีอยู่จริง) ไม่มีเทสต์คุมจุดนี้มาก่อนเพราะเทสต์เดิมมีแต่โหมด dry-run
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { FlowAccountClient, FlowAccountError } from '../src/integrations/flowaccount.js';

const VALID_PAYLOAD = { documentStructureType: 'InlineDocument', items: [] };

/** ตอบเลียนแบบของจริงทุกจุดที่โค้ดต้องอ่าน — ตัดฟิลด์ที่ไม่เกี่ยวออกเพื่อให้อ่านง่าย */
const REAL_CREATE_RESPONSE = {
  data: {
    recordId: 200154,
    documentId: 200154,
    documentSerial: 'BL2026020001',
    statusString: 'awaiting',
    grandTotal: '185876.9',
  },
  status: true,
  message: '',
  code: 0,
};

const REAL_SHARE_RESPONSE = {
  data: { link: 'https://doc-api-a.dev.flowaccount.com/api/billingnote/share/html/th/jfto7ye1o06u9c1koe9l6a' },
  status: true,
  message: '',
  code: 0,
};

function fakeFetch(responses) {
  return async (url) => {
    const key = Object.keys(responses).find((k) => url.includes(k));
    if (!key) throw new Error(`ไม่มี response จำลองสำหรับ ${url}`);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(responses[key]),
    };
  };
}

function client(responses) {
  return new FlowAccountClient({
    mode: 'sandbox',
    clientId: 'id',
    clientSecret: 'secret',
    documentType: 'billing-note',
    fetchImpl: fakeFetch(responses),
  });
}

test('createDraftDocument อ่าน documentSerial/documentId จาก data ได้ถูก (ไม่ใช่ documentNumber ที่ไม่มีจริง)', async () => {
  const c = client({ '/token': { access_token: 'tok', expires_in: 3600 }, '/billing-notes/inline': REAL_CREATE_RESPONSE });
  const result = await c.createDraftDocument(VALID_PAYLOAD);

  assert.equal(result.documentNo, 'BL2026020001');
  assert.equal(result.documentId, 200154);
  assert.equal(result.status, 'awaiting');
  assert.equal(result.mode, 'sandbox');
});

test('createDraftDocument ปฏิเสธ payload ที่ไม่ใช่ InlineDocument ก่อนยิงออกไปเลย', async () => {
  const c = client({});
  await assert.rejects(
    () => c.createDraftDocument({ documentStructureType: 'SimpleDocument' }),
    FlowAccountError,
  );
});

test('โหมด dry-run ไม่มี documentId ให้อ้าง (ขอลิงก์ดูเอกสารต่อไม่ได้)', async () => {
  const c = new FlowAccountClient({ mode: 'dry-run', documentType: 'billing-note' });
  const result = await c.createDraftDocument(VALID_PAYLOAD, { period: '2026-01', sequence: 6 });

  assert.equal(result.documentId, null);
  assert.ok(result.documentNo);
});

test('getShareLink คืนลิงก์จาก data.link', async () => {
  const c = client({ '/token': { access_token: 'tok', expires_in: 3600 }, '/billing-notes/sharedocument': REAL_SHARE_RESPONSE });
  const result = await c.getShareLink(200154);

  assert.equal(result.link, REAL_SHARE_RESPONSE.data.link);
});

test('getShareLink โหมด dry-run คืน link: null ไม่ยิงออกไปจริง', async () => {
  const c = new FlowAccountClient({ mode: 'dry-run', documentType: 'billing-note' });
  const result = await c.getShareLink(200154);
  assert.equal(result.link, null);
});

test('getShareLink ต้องมี documentId ก่อน ไม่งั้น error ทันทีไม่ยิงออกไป', async () => {
  const c = client({});
  await assert.rejects(() => c.getShareLink(null), FlowAccountError);
});
