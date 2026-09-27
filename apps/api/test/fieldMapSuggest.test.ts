/**
 * เดาชื่อฟิลด์จาก Timesheet ตัวอย่าง (27 ก.ย. 69) — เจ้าของระบบขอให้ไม่ต้องพิมพ์เองทีละช่อง 57 ช่อง
 *
 * สิ่งที่ล็อกไว้คือ "ต้องไม่เดามั่ว" มากกว่า "ต้องเดาได้เยอะ" — mapping ที่ผิดทำให้อ่านตัวเลขผิดแล้ว
 * ไหลไปถึงใบแจ้งหนี้ ปล่อยช่องว่างให้คนกรอกเองปลอดภัยกว่าเติมผิดแล้วคนกดผ่าน
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { FieldMapSuggestError, suggestFieldMap } from '../src/lib/fieldMapSuggestService.js';

const b64 = (s: string) => Buffer.from(s).toString('base64');

test('ไฟล์ว่าง → บอกตรงๆ ไม่ throw error ดิบ', async () => {
  await assert.rejects(
    () => suggestFieldMap({ fileBase64: '', fileName: 'x.pdf' }),
    (e: unknown) => e instanceof FieldMapSuggestError && /ไฟล์ว่าง/.test(e.message),
  );
});

test('ไฟล์ที่ไม่ใช่ PDF → บอกข้อจำกัดให้ชัด ไม่ปล่อยให้พังข้างใน', async () => {
  await assert.rejects(
    () => suggestFieldMap({ fileBase64: b64('อะไรก็ได้'), fileName: 'timesheet.xlsx' }),
    (e: unknown) => e instanceof FieldMapSuggestError && /PDF/.test(e.message),
  );
});

test('PDF ที่ไม่มีชั้นข้อความ (ภาพสแกน) → บอกให้กรอกเอง ไม่คืนผลเดาลอยๆ', async () => {
  /* ส่งไบต์ที่ไม่ใช่ PDF จริงเข้าไป — extractPdfText ต้องไม่คืน hasText แล้วเราต้องแปลงเป็นข้อความ
     ที่คนอ่านรู้เรื่อง ไม่ใช่ error ของ pdfjs หลุดออกไป */
  await assert.rejects(
    () => suggestFieldMap({ fileBase64: b64('not a real pdf'), fileName: 'scan.pdf' }),
    (e: unknown) => e instanceof FieldMapSuggestError,
  );
});
