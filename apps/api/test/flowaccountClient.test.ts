/**
 * ทดสอบ apps/api/src/lib/flowaccountClient.ts — เฉพาะการแยกฟิลด์จาก response จริงของ FlowAccount
 *
 * ใส่ fetch จำลองแทนของจริง โดยรูปแบบ response อ้างจากผลที่ยิง sandbox จริงเมื่อ 31 ก.ค. 2569
 * (เก็บไว้ใน docs/checklist.md หัวข้อ 8) — เดิมโค้ดอ่านผิดฟิลด์ (เดา documentNumber/documentNo
 * ที่ไม่มีอยู่จริง) ไม่มีเทสต์คุมจุดนี้มาก่อนเพราะเทสต์เดิมมีแต่โหมด dry-run
 *
 * Ported from test/flowaccount.test.js (assertions preserved exactly) — ต่างจากต้นฉบับจุดเดียวคือ
 * พอร์ต TS ไม่รับ `fetchImpl` เข้า constructor จึงสลับ global fetch แทน (ดู helpers/fakeFetch.ts)
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { FlowAccountClient, FlowAccountError } from '../src/lib/flowaccountClient.js';
import { respondByPath, withFetch, type FakeFetch } from './helpers/fakeFetch.js';

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

function client() {
  return new FlowAccountClient({
    mode: 'sandbox',
    clientId: 'id',
    clientSecret: 'secret',
    documentType: 'billing-note',
  });
}

test('createDraftDocument อ่าน documentSerial/documentId จาก data ได้ถูก (ไม่ใช่ documentNumber ที่ไม่มีจริง)', async () => {
  const fetchImpl = respondByPath({
    '/token': { access_token: 'tok', expires_in: 3600 },
    '/billing-notes/inline': REAL_CREATE_RESPONSE,
  });
  const result = await withFetch(fetchImpl, () => client().createDraftDocument(VALID_PAYLOAD));

  assert.equal(result.documentNo, 'BL2026020001');
  assert.equal(result.documentId, 200154);
  assert.equal(result.status, 'awaiting');
  assert.equal(result.mode, 'sandbox');
});

test('createDraftDocument ปฏิเสธ payload ที่ไม่ใช่ InlineDocument ก่อนยิงออกไปเลย', async () => {
  await withFetch(respondByPath({}), async () => {
    await assert.rejects(
      () => client().createDraftDocument({ documentStructureType: 'SimpleDocument' }),
      FlowAccountError,
    );
  });
});

test('โหมด dry-run ไม่มี documentId ให้อ้าง (ขอลิงก์ดูเอกสารต่อไม่ได้)', async () => {
  const c = new FlowAccountClient({ mode: 'dry-run', documentType: 'billing-note' });
  const result = await c.createDraftDocument(VALID_PAYLOAD, { period: '2026-01', sequence: 6 });

  assert.equal(result.documentId, null);
  assert.ok(result.documentNo);
});

test('getShareLink คืนลิงก์จาก data.link', async () => {
  const fetchImpl = respondByPath({
    '/token': { access_token: 'tok', expires_in: 3600 },
    '/billing-notes/sharedocument': REAL_SHARE_RESPONSE,
  });
  const result = await withFetch(fetchImpl, () => client().getShareLink(200154));

  assert.equal(result.link, REAL_SHARE_RESPONSE.data.link);
});

test('getShareLink โหมด dry-run คืน link: null ไม่ยิงออกไปจริง', async () => {
  const c = new FlowAccountClient({ mode: 'dry-run', documentType: 'billing-note' });
  const result = await c.getShareLink(200154);
  assert.equal(result.link, null);
});

test('getShareLink ต้องมี documentId ก่อน ไม่งั้น error ทันทีไม่ยิงออกไป', async () => {
  await withFetch(respondByPath({}), async () => {
    await assert.rejects(() => client().getShareLink(null as any), FlowAccountError);
  });
});

/* ── fetchSharedPdf — ตัดไฟล์ PDF ออกจากหน้า share ────────────────────────
   หน้า share ของจริงฝังไฟล์ทั้งไฟล์มาเป็น base64 ในตัวหน้าเลย แล้วให้ pdf.js วาด
   (ไล่ดูหน้าจริงของ BL2026020002 แล้ว 6 ส.ค. 2569) — โครง HTML ข้างล่างย่อมาจากของจริง */

const SHARE_LINK = 'https://doc-api-a.dev.flowaccount.com/api/billingnote/share/html/th/abc123';

function sharePage(base64: string) {
  return `<html><body><div class="pdf-content"><div id="container"></div></div>
    <script>
      function renderPdf() {
        var pdfAsDataUri = "data:application/pdf;base64,${base64}";
        PDFJS.getDocument(pdfAsDataUri).then(function (pdf) { });
      }
    </script></body></html>`;
}

function htmlClient() {
  return new FlowAccountClient({ mode: 'sandbox', documentType: 'billing-note' });
}

function htmlFetch(body: string, { ok = true, status = 200 } = {}): FakeFetch {
  return async () => ({ ok, status, text: async () => body });
}

test('fetchSharedPdf ตัด base64 ที่ฝังในหน้า share ออกมาเป็นไฟล์ PDF ได้', async () => {
  const pdf = Buffer.from('%PDF-1.4\nไฟล์ใบวางบิลจำลอง\n%%EOF');
  const result = await withFetch(htmlFetch(sharePage(pdf.toString('base64'))), () =>
    htmlClient().fetchSharedPdf(SHARE_LINK),
  );

  assert.ok(Buffer.isBuffer(result.bytes));
  assert.equal(result.bytes.toString('utf8'), pdf.toString('utf8'));
});

test('fetchSharedPdf ต้องมีลิงก์ก่อน ไม่งั้น error ทันทีไม่ยิงออกไป', async () => {
  await withFetch(htmlFetch(''), async () => {
    await assert.rejects(() => htmlClient().fetchSharedPdf(null), FlowAccountError);
  });
});

test('fetchSharedPdf เปิดหน้าไม่ได้ → error พร้อม status', async () => {
  await withFetch(htmlFetch('ไม่พบ', { ok: false, status: 404 }), async () => {
    await assert.rejects(
      () => htmlClient().fetchSharedPdf(SHARE_LINK),
      (error: unknown) => error instanceof FlowAccountError && error.status === 404,
    );
  });
});

test('fetchSharedPdf หน้าเปลี่ยนรูปแบบจนไม่มี base64 ฝังอยู่ → error ไม่คืนไฟล์เปล่า', async () => {
  await withFetch(htmlFetch('<html><body>เอกสารนี้ถูกลบแล้ว</body></html>'), async () => {
    await assert.rejects(() => htmlClient().fetchSharedPdf(SHARE_LINK), FlowAccountError);
  });
});

test('fetchSharedPdf ปฏิเสธถ้าก้อนที่ตัดมาได้ไม่ได้ขึ้นต้นด้วย %PDF', async () => {
  const notPdf = Buffer.from('<html>โดนพาไปหน้า login</html>').toString('base64');
  await withFetch(htmlFetch(sharePage(notPdf)), async () => {
    await assert.rejects(() => htmlClient().fetchSharedPdf(SHARE_LINK), FlowAccountError);
  });
});
