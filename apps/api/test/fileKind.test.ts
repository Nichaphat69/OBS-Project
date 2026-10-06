/**
 * ตรวจชนิดไฟล์จากเนื้อไฟล์ — จุดที่ต้องไม่พลาด: ไม่เชื่อนามสกุล (".pdf.xlsx" / ชื่อ .pdf แต่เนื้อเป็น Excel),
 * แยก xlsx ออกจาก docx (ทั้งคู่เป็น zip), แยก xls ออกจาก doc (ทั้งคู่เป็น OLE2), และปฏิเสธไบนารีที่ไม่รู้จัก
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { detectFileKind, ACCEPTED_EXTENSIONS } from '../src/lib/fileKind.js';

const zip = (inner: string) => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(inner)]);
const ole = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(32)]);

test('PDF จากเนื้อไฟล์ แม้นามสกุลผิด', () => {
  assert.equal(detectFileKind(Buffer.from('%PDF-1.7\n...'), 'whatever.xlsx').kind, 'pdf');
});

test('xlsx แยกจาก docx/pptx ที่เป็น zip เหมือนกัน', () => {
  assert.equal(detectFileKind(zip('[Content_Types].xml xl/workbook.xml'), 'a.xlsx').kind, 'xlsx');
  assert.equal(detectFileKind(zip('[Content_Types].xml xl/workbook.xml'), 'a.pdf').kind, 'xlsx');
  assert.equal(detectFileKind(zip('[Content_Types].xml word/document.xml'), 'a.xlsx').kind, 'unknown');
  assert.equal(detectFileKind(zip('[Content_Types].xml ppt/slides/s1.xml'), 'a.pptx').kind, 'unknown');
  assert.equal(detectFileKind(zip('a.txt'), 'a.zip').kind, 'unknown');
});

test('xls เก่า (OLE2) แต่ .doc/.ppt เก่าไม่รับ', () => {
  assert.equal(detectFileKind(ole, 'a.xls').kind, 'xls');
  assert.equal(detectFileKind(ole, 'a.doc').kind, 'unknown');
  assert.equal(detectFileKind(ole, 'a.ppt').kind, 'unknown');
});

test('ภาพสแกน: PNG/JPEG/TIFF/WebP', () => {
  assert.equal(detectFileKind(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]), 'a.png').mimeType, 'image/png');
  assert.equal(detectFileKind(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]), 'a.jpg').mimeType, 'image/jpeg');
  assert.equal(detectFileKind(Buffer.from([0x49, 0x49, 0x2a, 0x00, 0, 0]), 'a.tif').mimeType, 'image/tiff');
  assert.equal(detectFileKind(Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0, 0]), 'a.tiff').kind, 'image');
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(8)]);
  assert.equal(detectFileKind(webp, 'a.webp').kind, 'image');
});

test('CSV/ข้อความล้วนรับได้ (รวมไทยและ BOM) แต่ไบนารีมีไบต์ศูนย์ไม่รับ', () => {
  assert.equal(detectFileKind(Buffer.from('a,b\n1,2\n'), 'x.csv').kind, 'csv');
  assert.equal(detectFileKind(Buffer.from('ชื่อ,เวลา\nสมชาย,09:00\n'), 'x.csv').kind, 'csv');
  assert.equal(detectFileKind(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('a,b\n')]), 'x.csv').kind, 'csv');
  assert.equal(detectFileKind(Buffer.from([0x01, 0x00, 0x02, 0x00]), 'x.csv').kind, 'unknown');
  assert.equal(detectFileKind(Buffer.alloc(0), 'x.csv').kind, 'unknown');
});

test('รายการนามสกุลที่ n8n ควรปล่อยผ่านครอบคลุมทุกชนิดที่อ่านได้', () => {
  for (const e of ['pdf', 'xlsx', 'xls', 'csv', 'jpg', 'png', 'tif']) assert.ok((ACCEPTED_EXTENSIONS as readonly string[]).includes(e), e);
});
