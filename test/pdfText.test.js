import test from 'node:test';
import assert from 'node:assert/strict';
import { employeeNameIn } from '../src/extract/pdfText.js';

/* ข้อความด้านล่างคัดจากผลจริงของ extractPdfText() กับ
   "2026_07 - O291-Pitikorn chumphuchanapai.pdf" (ยืนยันด้วยการรันตรงกับไฟล์จริง 14 ส.ค. 69) —
   pdfjs ดึงเว้นวรรครอบขีด ("ชื่อ - สกุล" ไม่ใช่ "ชื่อ-สกุล") และวรรณยุกต์/สระของคำว่า "ตำแหน่ง"
   หายไปบางส่วน ("ตําแหนง") ทั้งสองเรื่องนี้คือของจริงที่เจอ ไม่ใช่ข้อมูลสมมติ */
test('employeeNameIn อ่านชื่อจากฟอร์มไทย "ชื่อ - สกุล" ได้ ไม่ติดคำว่าตำแหน่งที่ต่อในบรรทัดเดียวกัน', () => {
  const text =
    'รายงานการปฏิบัติงาน\n' +
    'เดือน / ป : Jul-26\n' +
    'ชื่อ - สกุล : Pitikorn chumphuchanapai ตําแหนง Developer\n' +
    'วันที่ Project';
  assert.equal(employeeNameIn(text), 'Pitikorn chumphuchanapai');
});

test('employeeNameIn อ่านฟอร์มไทยที่สะกด "ตำแหน่ง" ถูกต้องก็ได้เหมือนกัน', () => {
  const text = 'ชื่อ-สกุล: Sunee Maneekasemsuk ตำแหน่ง Senior Project Manager';
  assert.equal(employeeNameIn(text), 'Sunee Maneekasemsuk');
});

/* เจอจริงและยืนยันด้วยการรันตรงกับไฟล์ "2026_07 - O291-Pitikorn chumphuchanapai.pdf" (14 ส.ค. 69):
   ฟอนต์ของเอกสารมี glyph พังตัวหนึ่ง ทำให้ pdfjs ดึงตัวอักษรระหว่าง "น" กับ "ง" ของคำว่า "ตำแหน่ง"
   ออกมาเป็นโค้ด Private Use Area (U+F70A) แทน — สตริง "ตำแหน่ง"/"ตําแหนง" ที่สะกดถูกทุกตัวจะไม่มีวัน
   เทียบตรงกับคำที่พังแบบนี้ได้เลย ไม่ว่าจะลองสะกดกี่แบบ ต้องตัดที่ "ตำแหน" ก่อนถึงตัวที่พังเท่านั้น
   สร้างสตริงด้วย fromCharCode ทีละตัวตรงๆ (ไม่พิมพ์อักษรไทยดิบในซอร์ส) กันเครื่องมือ/ตัวแก้ไขข้อความ
   แปลงอักขระกลับเป็นรูปสะกดปกติโดยไม่ตั้งใจ (เจอมาแล้วตอนเขียนเทสต์นี้ครั้งแรก) */
test('employeeNameIn ทนต่อ glyph พังในคำว่า "ตำแหน่ง" (เจอจริง: U+F70A แทรกกลางคำจากฟอนต์ที่พัง)', () => {
  const brokenPosition = String.fromCharCode(
    0x0e15, 0x0e4d, 0x0e32, 0x0e41, 0x0e2b, 0x0e19, 0xf70a, 0x0e07, // ต ํ า แ ห น [U+F70A] ง
  );
  const text = `ชื่อ - สกุล : Pitikorn chumphuchanapai ${brokenPosition} Developer`;
  assert.equal(employeeNameIn(text), 'Pitikorn chumphuchanapai');
});

test('employeeNameIn ยังอ่านฟอร์มภาษาอังกฤษได้ตามเดิม (ไม่พังจากการเพิ่มป้ายภาษาไทย)', () => {
  assert.equal(employeeNameIn('Employee Name: Pongpun Mamak\nProject Name: BAU'), 'Pongpun Mamak');
  assert.equal(employeeNameIn('Resource Name : Korawit Khamsuk  Position: Developer'), 'Korawit Khamsuk');
});

test('employeeNameIn คืน null ถ้าไม่มีป้ายชื่อที่รู้จักเลย', () => {
  assert.equal(employeeNameIn('some random text with no name label at all'), null);
});
