/** ส่งไฟล์ออกให้เบราว์เซอร์ — ชนิดต้องตามนามสกุลจริง (ไม่ยัด pdf ตายตัวแบบเดิม) และ ?dl ต้องเป็น attachment */
import test from 'node:test';
import assert from 'node:assert/strict';
import { contentTypeForName, sendStoredFile } from '../src/lib/fileResponse.js';

test('contentTypeForName: ตามนามสกุล ไม่สนตัวพิมพ์ใหญ่เล็ก', () => {
  assert.equal(contentTypeForName('a.PDF'), 'application/pdf');
  assert.match(contentTypeForName('T8 Panyada 9-2026.pdf.xlsx'), /spreadsheetml/);
  assert.equal(contentTypeForName('Image 2-10-2569 BE at 11.47.jpeg'), 'image/jpeg');
  assert.equal(contentTypeForName('x.xls'), 'application/vnd.ms-excel');
});

test('contentTypeForName: ไม่รู้จักใช้ค่าสำรองที่ส่งมา', () => {
  assert.equal(contentTypeForName('noext', 'application/pdf'), 'application/pdf');
  assert.equal(contentTypeForName('x.zzz'), 'application/octet-stream');
  assert.equal(contentTypeForName(null), 'application/octet-stream');
});

function fakeRes() {
  const out: { headers: Record<string, string>; body?: Buffer } = { headers: {} };
  const res: any = {
    set(h: Record<string, string>) { Object.assign(out.headers, h); return res; },
    send(b: Buffer) { out.body = b; },
  };
  return { res, out };
}

test('sendStoredFile: เปิดดู = inline, ?dl = attachment, ชื่อไทยเข้ารหัส', () => {
  const bytes = Buffer.from('abc');
  const a = fakeRes();
  sendStoredFile({ query: {} } as any, a.res, bytes, 'ไทม์ชีท.xlsx');
  assert.match(a.out.headers['Content-Disposition'], /^inline; filename\*=UTF-8''%/);
  assert.match(a.out.headers['Content-Type'], /spreadsheetml/);
  const b = fakeRes();
  sendStoredFile({ query: { dl: '' } } as any, b.res, bytes, 'a.pdf');
  assert.match(b.out.headers['Content-Disposition'], /^attachment;/);
  assert.equal(b.out.headers['Content-Length'], '3');
});
