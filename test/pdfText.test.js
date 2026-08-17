import test from 'node:test';
import assert from 'node:assert/strict';
import { employeeNameIn, periodIn, signatureNamesIn, dayRowsIn } from '../src/extract/pdfText.js';

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

/* ยืนยันด้วยการรันตรงกับไฟล์ "2026_07 - O291-Pitikorn chumphuchanapai.pdf" (14 ส.ค. 69):
   หัวเอกสารเขียน "เดือน / ปี : Jul-26" — ปีเป็น ค.ศ. 2 หลักท้าย ("26" = 2026 ไม่ใช่ พ.ศ.)
   ยืนยันจากชื่อไฟล์จริงที่ขึ้นต้นด้วย "2026_07" ตรงกับ "Jul-26" ในเนื้อไฟล์ */
test('periodIn อ่านเดือน/ปีจากหัวเอกสารฟอร์มไทย "เดือน / ปี : Jul-26" ได้ (ปี 2 หลัก = ค.ศ.)', () => {
  const text = 'รายงานการปฏิบัติงาน\nเดือน / ปี : Jul-26\nชื่อ - สกุล : Pitikorn chumphuchanapai';
  assert.equal(periodIn(text), '2026-07');
});

/* เจอจริง: ตัว "ี" ของ "ปี" ถูก pdfjs ดึงมาเป็นโค้ด Private Use Area (U+F702) — ฟอนต์เดียวกับที่ทำให้
   "ตำแหน่ง" พังเป็น U+F70A (ดูเทสต์ employeeNameIn ด้านบน) เขียนด้วย fromCharCode กันเครื่องมือ
   แปลงอักขระกลับเป็นรูปสะกดปกติโดยไม่ตั้งใจเหมือนที่เคยเจอตอนเขียนเทสต์ตัวนั้น */
test('periodIn ทนต่อ glyph พังในคำว่า "ปี" (เจอจริง: U+F702 แทนตัว ี)', () => {
  const brokenPii = String.fromCharCode(0x0e1b, 0xf702); // ป [U+F702 แทนที่ ี]
  const text = `เดือน / ${brokenPii} : May-26`;
  assert.equal(periodIn(text), '2026-05');
});

test('periodIn คืน null ถ้าไม่เจอรูปแบบเดือน/ปีที่รู้จักเลย', () => {
  assert.equal(periodIn('some random text with no period label at all'), null);
});

/* ยืนยันด้วยการรันตรงกับไฟล์ "Timesheet_Pitikorn_Chumphuchanapai_May_2026.pdf" (17 ส.ค. 69):
   ท้ายฟอร์ม "TIMESHEET" (ต่างจากฟอร์ม "รายงานการปฏิบัติงาน" ที่ทดสอบไว้ด้านบน) มีบรรทัดชื่อผู้เซ็น
   2 คอลัมน์ที่ pdfjs ต่อรวมเป็นสตริงเดียว ("Pitikorn Chumphuchanapai Nichaphat Chokrak") — เจอจริงว่า
   โมเดล vision อ่านชื่อผู้อนุมัติฝั่งลูกค้าผิดเป็นคำว่า "Employee" (หลุดมาจากป้ายฝั่งซ้ายของบรรทัด
   หัวตาราง "Employee's Signature") ต้องใช้ employeeName ที่อ่านได้แม่นแล้วเป็นหมุดตัดบรรทัดนี้แทน */
test('signatureNamesIn แยกชื่อผู้เซ็น 2 คอลัมน์ที่ถูกต่อรวมเป็นบรรทัดเดียว โดยใช้ employeeName เป็นหมุดตัด', () => {
  const text =
    'Total Work days : 19 Leave / Sick (days) : 0 Total Hours : 152.00\n' +
    "Employee's Signature Project Manager's Signature (TLI)\n" +
    'Pitikorn Chumphuchanapai Nichaphat Chokrak\n' +
    '31/05/2026 31/05/2026';
  assert.deepEqual(signatureNamesIn(text, 'Pitikorn Chumphuchanapai'), {
    employeeSignatureName: 'Pitikorn Chumphuchanapai',
    projectManagerSignatureName: 'Nichaphat Chokrak',
  });
});

test('signatureNamesIn คืนบรรทัดทั้งหมดเป็นชื่อผู้อนุมัติถ้าไม่มี employeeName ให้ใช้ตัดบรรทัด', () => {
  const text = "Employee's Signature Project Manager's Signature (TLI)\nSomeone Someone2\n01/01/2026 01/01/2026";
  assert.deepEqual(signatureNamesIn(text, null), {
    employeeSignatureName: null,
    projectManagerSignatureName: 'Someone Someone2',
  });
});

test('signatureNamesIn คืน null ทั้งคู่ถ้าไม่เจอหัวตาราง Employee\'s Signature / Project Manager\'s Signature (TLI) เลย', () => {
  assert.deepEqual(signatureNamesIn('some random text with no signature block at all', 'Pitikorn Chumphuchanapai'), {
    employeeSignatureName: null,
    projectManagerSignatureName: null,
  });
});

/* เจอจริง (17 ส.ค. 69, "Timesheet_Pitikorn_Chumphuchanapai_May_2026.pdf" — รันตรงกับไฟล์จริงยืนยันแล้ว):
   โมเดลในเครื่อง (google/gemma-4-e4b) หมดแรงกลางตารางที่มี 31 แถว แล้วเดาซ้ำ "เวลาเข้า-ออก 9:00-18:00"
   กับ "รายละเอียดงาน OT" เหมือนกันทุกวัน (แม้แต่วันแรงงานที่ไม่ได้ทำงานก็โดนใส่ค่าปลอมด้วย) ทั้งที่ในไฟล์
   จริงแต่ละวันเวลาเข้า-ออกและงานไม่เหมือนกันเลย — ต้องพาร์สตารางตรงจากชั้นข้อความแทนการเชื่อโมเดล */
test('dayRowsIn พาร์สตารางฟอร์ม "TIMESHEET" ได้ครบทุกวันในเดือน แยกวันทำงานจริง/วันหยุดถูกต้อง', () => {
  const lines = [];
  // กุมภาพันธ์ 2569 (ค.ศ. 2026) มี 28 วัน (ไม่ใช่ปีอธิกสุรทิน)
  for (let day = 1; day <= 28; day += 1) {
    const dow = new Date(2026, 1, day).getDay(); // 0=อาทิตย์ .. 6=เสาร์
    const dd = String(day).padStart(2, '0');
    lines.push(dow === 0 || dow === 6
      ? `${day} ${dd}/02/26 ${dow === 0 ? 'Sun' : 'Sat'} 0.00 0.00 0.00`
      : `${day} ${dd}/02/26 Wed PRJ1 9:00 18:00 1.00 งานวันที่ ${dd} กุมภาพันธ์ 8.00 0.00 8.00`);
  }
  const text =
    'No. Date Day Project Normal In Normal Out Break (hrs) OT In OT Out OT Break (hrs) Job Description / Remark Normal OT Total\n' +
    `${lines.join('\n')}\nTOTAL 160.00 0.00 160.00\n` +
    "Employee's Signature Project Manager's Signature (TLI)\nSomchai Jaidee Someone Else\n28/02/2026 28/02/2026";

  const rows = dayRowsIn(text, '2026-02');
  assert.equal(rows.length, 28);
  assert.deepEqual(rows.find((r) => r.date === '2026-02-02'), {
    date: '2026-02-02', timeIn: '9:00', timeOut: '18:00', jobDescription: 'งานวันที่ 02 กุมภาพันธ์',
  });
  const offDay = rows.find((r) => new Date(2026, 1, Number(r.date.slice(-2))).getDay() % 6 === 0);
  assert.deepEqual(offDay, { date: offDay.date, timeIn: null, timeOut: null, jobDescription: null });
});

/* เจอจริงกับ "Timesheet_Pitikorn_Chumphuchanapai_June_2026.pdf": บางแถวมีรายละเอียดงานยาวจน
   ขึ้นบรรทัดใหม่หลายบรรทัด (มี URL คั่นเป็นบรรทัดๆ) ทำให้ตัวเลข 3 ตัวท้าย (Normal/OT/Total) ของแถว
   นั้นไม่อยู่บรรทัดเดียวกับวันที่ พาร์สแถวนั้นไม่ได้ — ต้องคืน null ทั้งก้อน ไม่ override ครึ่งๆกลางๆ
   ดีกว่าใช้ข้อมูลที่พาร์สได้ไม่ครบ */
test('dayRowsIn คืน null ถ้าพาร์สแถวไม่ได้ครบทุกวันในเดือน (ไม่มั่นใจว่ารูปแบบตารางตรงกันทั้งหมด)', () => {
  const text =
    'No. Date Day Project Normal In Normal Out Break (hrs) OT In OT Out OT Break (hrs) Job Description / Remark Normal OT Total\n' +
    '1 01/06/26 Mon PRJ1 9:00 18:00 1.00 งานปกติ 8.00 0.00 8.00\n' +
    '2 02/06/26 Tue PRJ1 9:00 18:00 1.00\nhttps://example.com/a\nงานที่มีลิงก์คั่นบรรทัด\n8.00 0.00 8.00';
  assert.equal(dayRowsIn(text, '2026-06'), null);
});

test('dayRowsIn คืน null ถ้าไม่มี period ให้คำนวณจำนวนวันในเดือน', () => {
  assert.equal(dayRowsIn('1 01/05/26 Fri PRJ1 9:00 18:00 1.00 งาน 8.00 0.00 8.00', null), null);
});
