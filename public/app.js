/**
 * Frontend ของระบบวางบิล Outsource — vanilla ES module ไม่มี build step
 * ทุกหน้าดึงข้อมูลจริงจาก /api
 */

const api = async (path, options) => {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options?.headers ?? {}) },
  });
  const data = await response.json();
  /* session หลุด (หมดอายุ/ยังไม่ login) กลางทาง — พาไปหน้า login ทันที ยกเว้นตอนกำลัง
     ล็อกอินอยู่แล้ว (401 ตรงนั้นคือ "รหัสผ่านผิด" ต้องโชว์ในฟอร์ม ไม่ใช่เด้งไปไหน) */
  if (response.status === 401 && path !== '/auth/login') {
    showLoginScreen();
  }
  if (!response.ok) {
    const error = new Error(data.error ?? `เรียก ${path} ไม่สำเร็จ`);
    error.blockers = data.blockers;
    throw error;
  }
  return data;
};

const el = (id) => document.getElementById(id);
const main = el('main');

/* crypto.randomUUID() ใช้ได้แค่ใน secure context (https หรือ localhost) — เซิร์ฟเวอร์นี้เปิดผ่าน
   http ตรงๆที่ IP (ยังไม่ทำ HTTPS/domain) เบราว์เซอร์จึงตัด crypto.randomUUID ทิ้งเป็น undefined
   ทำให้เรียกแล้ว throw "is not a function" ทันที ใช้ตัวนี้แทนทุกที่ — เป็นแค่ key ติดตามการ์ดบนจอ
   ไม่ใช่ค่าที่ต้องเดายากระดับความปลอดภัย จึงไม่ต้องพึ่ง crypto จริงก็ได้ */
const genId = () => (crypto.randomUUID
  ? crypto.randomUUID()
  : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const money = (value) =>
  value === null || value === undefined
    ? '—'
    : Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const int = (value) => (value === null || value === undefined ? '—' : Number(value).toLocaleString('en-US'));

const icon = (name, cls = 'i sm') => `<svg class="${cls}"><use href="#i-${name}"/></svg>`;

/* ── สลับภาษา ไทย/อังกฤษ (27 ส.ค. 69) ─────────────────────────
   tx(str) แปลข้อความ UI คงที่ (หัวข้อ/ปุ่ม/label/หัวตาราง) — คีย์คือข้อความไทยต้นฉบับเป๊ะๆ ไม่ใช่ key
   เชิงความหมาย เพื่อให้เห็นชัดว่าแปลอะไรอยู่โดยไม่ต้องเปิดคู่ดิกชันนารี ไม่ครอบคลุมข้อมูลจริง
   (ชื่อคน/บริษัท/ไฟล์/หมายเหตุที่พิมพ์เอง) เพราะนั่นคือ "ข้อมูล" ไม่ใช่ "ข้อความของหน้าจอ" — ถ้าไม่เจอ
   คำแปลใน T จะคืนข้อความไทยเดิม ไม่ throw จึงต่อคำแปลเพิ่มได้เรื่อยๆโดยไม่เสี่ยงพังของเดิม
   ชื่อฟังก์ชันตั้งใจไม่ใช้ t เพราะทั้งไฟล์มีตัวแปร/พารามิเตอร์ชื่อ t (ตัวย่อ "timesheet") ใช้ซ้ำอยู่แล้ว
   หลายจุด (เช่น sheetCard(t), matchesSearch(t, term)) ถ้าใช้ t ซ้ำจะโดน shadow เงียบๆในฟังก์ชันพวกนั้น */
const T = {
  // ── ทั่วไป / คำซ้ำหลายหน้า ──
  'ใบ': 'sheets', 'วัน': 'days', 'บาท': 'THB', 'คน': 'people', 'เดือน': 'months', 'รอบ': 'cycles',
  'ข้อมูล ณ': 'Data as of', 'กลับ': 'Back', 'ทั้งหมด': 'All', 'ปิด': 'Close', 'บันทึก': 'Save',
  'ยกเลิก': 'Cancel', 'ลบ': 'Delete', 'แก้ไข': 'Edit', 'เพิ่ม': 'Add', 'ค้นหา': 'Search',
  'ไม่มีข้อมูล': 'No data', 'กำลังโหลด…': 'Loading…', 'กำลังโหลดข้อมูล…': 'Loading data…',
  'ยืนยันแล้ว': 'Confirmed', 'วางบิลแล้ว': 'Billed', 'รออนุมัติ': 'Awaiting approval',
  'รอคนตรวจ': 'Awaiting review', 'ข้อมูลไม่ตรง': 'Mismatch', 'ได้ไม่ครบ': 'Incomplete',
  'รอ Timesheet': 'Awaiting Timesheet', 'ตีกลับ': 'Rejected', 'ตีกลับให้แก้ไข': 'Rejected for correction',
  'รับเข้าระบบ': 'Received', 'อ่านข้อมูลแล้ว': 'Extracted', 'ตรวจผ่าน': 'Verified',
  'อนุมัติแล้ว': 'Approved', 'รอตรวจ': 'Pending review', 'บันทึกแล้ว': 'Saved', 'ทิ้งแล้ว': 'Discarded',
  'เกินกำหนด': 'Overdue', 'ตรงเวลา': 'On time', 'เลยกำหนดวางบิล': 'Billing overdue',

  // ── แดชบอร์ด ──
  'ภาพรวมการวางบิล': 'Billing Overview', 'ยังไม่มีสัญญาในระบบ': 'No contract in the system yet',
  'ขั้น 2 · รอตรวจสอบ': 'Step 2 · Awaiting review', 'ขั้น 3 · พร้อมวางบิล': 'Step 3 · Ready to bill',
  'ยอดวางบิลแล้ว': 'Amount billed', 'สถานะรอบบิล': 'Cycle status', 'งานที่ต้องทำ': 'To-do',
  'เปิด': 'Open', 'ความคืบหน้าสัญญา': 'Contract progress', 'มูลค่าสัญญา': 'Contract value',
  'คงเหลือ': 'Remaining', 'พนักงานในสัญญา': 'Employees on contract', 'เครดิต': 'Credit',
  'ส่วนลดวันลารวม': 'Total leave deduction', 'ยังไม่มีสัญญา': 'No contract yet',
  'รอบบิลตามสัญญา': 'Cycles by contract', 'รอบบิล': 'Billing cycle', 'สถานะ': 'Status',
  'กำหนดเวลา': 'Deadline', 'มูลค่า': 'Value', 'เลขที่': 'No.', 'รับเมื่อ': 'Received',
  'ลา': 'Leave', 'เปิดตรวจ': 'Open for review', 'รายการคำนวณ': 'Calculation', 'จำนวน': 'Qty',
  'เรทค่าบริการต่อเดือน': 'Monthly service rate', 'วันทำงานที่วางบิลได้': 'Billable work days',
  'ส่วนลดวันลา': 'Leave deduction', 'ไม่มีวันลา': 'No leave', 'ยอดที่วางบิลได้': 'Billable amount',
  'ยอดเปลี่ยน ต้องยืนยันใหม่': 'Amount changed — needs reconfirmation',
  'ต้องตรวจ': 'Needs review', 'รอคนยืนยัน': 'Awaiting confirmation',
  'รับล่าสุด': 'Most recent', 'ยอดสูงสุด': 'Highest amount', 'ชื่อพนักงาน': 'Employee name',
  'ต้องแก้ก่อน': 'Needs fixing first', 'เทียบเดือนก่อน': 'vs. last month',
  'ยังเทียบไม่ได้': 'No comparison yet',
  'ใบว่าจ้าง': 'PO', 'กดเพื่อไปตรวจ': 'Click to review', 'กดเพื่อไปอนุมัติ': 'Click to approve',
  'รอบล่าสุด': 'Latest cycle', 'รอ': 'Waiting on', 'ตาม Timesheet': 'per Timesheet',

  // ── ตรวจ Manday (คิว) ──
  'ขั้นที่ 2 จาก 4': 'Step 2 of 4', 'ตรวจ Manday': 'Review Manday', 'เรียงตาม': 'Sort by',
  'ค้นหาชื่อ เลขเอกสาร ตำแหน่ง รอบบิล…': 'Search by name, doc no., position, cycle…',
  'ล้างคำค้น': 'Clear search', 'ตัวกรอง': 'Filter',
  'ไม่พบรายการที่ตรงกับ': 'No results matching',
  'ไม่มีใบที่รอตรวจ — ทุกใบมีคนยืนยันแล้ว ไปต่อที่ขั้น 3 วางบิล':
    'Nothing pending review — everything has been confirmed, move on to Step 3 billing',
  'ไม่มีรายการในหมวดนี้': 'No items in this category', 'แสดง': 'Showing', 'จาก': 'of',
  'รายการ': 'items', 'ไม่มีรายการ': 'No items', 'กรองจาก': 'filtered from',
  'ก่อนหน้า': 'Previous', 'ถัดไป': 'Next',

  // ── รายละเอียด Timesheet (openSheet) ──
  'กลับไปกล่องงาน': 'Back to task box', 'โครงการ': 'Project', 'คำนวณใหม่': 'Recalculate',
  'อัปโหลด · ระบบอ่านไฟล์': 'Upload · System reads file',
  'ตรวจ Manday · คนยืนยัน': 'Review Manday · Human confirms',
  'วางบิล FlowAccount': 'Bill via FlowAccount', 'ร่างอีเมลถึงลูกค้า': 'Draft email to customer',
  'ภาพรวม': 'Overview', 'รายละเอียด': 'Details', 'ปฏิทิน': 'Calendar',
  'รายละเอียดวันที่เลือก': 'Selected Day', 'คลิกวันที่ในปฏิทินเพื่อดูรายละเอียดวันนั้น': 'Click a date to see its details',
  'เข้างาน': 'Check-in', 'ออกงาน': 'Check-out',
  'สรุปรายการที่จะวางบิล': 'Billing line summary',
  'เรทค่าบริการต่อเดือนตามใบว่าจ้าง': 'Monthly service rate per PO',
  'วันทำงานของเดือน': 'Work days this month',
  'หักเสาร์–อาทิตย์ และวันหยุดแล้ว': 'Weekends and holidays excluded',
  'ทำงานจริงตาม Timesheet': 'Actual work days per Timesheet', 'อัตราต่อวัน': 'Daily rate',
  'ข้อมูลอ้างอิง': 'Reference info', 'เลขผู้เสียภาษี': 'Tax ID', 'ใบเสนอราคา': 'Quotation',
  'ช่วงสัญญา': 'Contract period', 'ตัวหารอัตราต่อวัน': 'Daily-rate divisor', 'คงที่': 'Fixed',
  'วันทำงานจริงของเดือน': 'Actual work days of the month', 'ผู้ประสานงาน': 'Coordinator',
  'ประวัติการดำเนินการ': 'Activity history', 'ลูกค้าอนุมัติ Timesheet': 'Customer approved Timesheet',
  'ที่มาของข้อมูล': 'Data source', 'ไฟล์ที่อัปโหลด': 'Uploaded file', 'อ้างอิงอีเมล': 'Email reference',
  'ไม่ได้ระบุ': 'Not specified', 'ชื่อที่เขียนในไฟล์': 'Name as written in file',
  'ตำแหน่งที่เขียนในไฟล์': 'Position as written in file', 'เปิดดูไฟล์ต้นฉบับ': 'View original file',
  'ดาวน์โหลดไฟล์ต้นฉบับ': 'Download original file', 'ดาวน์โหลด': 'Download',
  'ไม่มีไฟล์ต้นฉบับเก็บไว้': 'No original file stored', 'วันที่': 'Date', 'ป้ายกำกับ': 'Label',
  'เวลาเข้า–ออก': 'Time in–out', 'รายละเอียดงาน': 'Job details', 'ค่าล่วงเวลา (OT)': 'Overtime (OT)',
  'ตรวจจับอัตโนมัติจาก Timesheet — ตรวจสอบชั่วโมงกับ PDF ต้นฉบับก่อนยืนยัน':
    'Auto-detected from the Timesheet — verify hours against the original PDF before confirming',
  'ชั่วโมง OT': 'OT hours', 'ค่าจ้างวันนั้น (รวม OT)': "That day's pay (incl. OT)",
  'ค่า OT เพิ่ม': 'Extra OT pay', 'รวมค่า OT ทั้งหมด': 'Total OT pay',
  'ผลการอ่านไฟล์ดิบ': 'Raw extraction result', 'สรุปประจำเดือน': 'Monthly summary',
  'ทำงาน (วัน)': 'Work (days)', 'ลาป่วย (วัน)': 'Sick leave (days)',
  'ลากิจ (วัน)': 'Personal leave (days)', 'ลาพักร้อน (วัน)': 'Vacation (days)',
  'เสาร์–อาทิตย์ (วัน)': 'Weekends (days)', 'วันหยุด (วัน)': 'Holidays (days)',
  'หมายเหตุที่จะขึ้นบนใบแจ้งหนี้': 'Remarks shown on the invoice',
  'ไม่มีวันลา จึงไม่มีหมายเหตุ': 'No leave, so no remarks', 'ยังยืนยันไม่ได้': 'Cannot confirm yet',
  'ยอดเปลี่ยนหลังยืนยันไปแล้ว': 'Amount changed after confirmation',
  'อ่านตัวเลขชุดใหม่แล้วยืนยันอีกครั้ง': 'New figures read — please reconfirm',
  'ตีกลับให้แก้ Timesheet': 'Reject for Timesheet correction',
  'ไปขั้น 3 วางบิล': 'Go to Step 3 billing', 'ยืนยันว่าตรวจแล้ว': 'Confirm reviewed',
  'ยังไม่ได้คำนวณ': 'Not calculated yet', 'อา': 'Su', 'จ': 'Mo', 'อ': 'Tu', 'พ': 'We', 'พฤ': 'Th',
  'ศ': 'Fr', 'ส': 'Sa', 'ทำงาน': 'Work', 'วันหยุด': 'Holiday', 'ลาป่วย': 'Sick leave',
  'ลากิจ': 'Personal leave', 'ลาพักร้อน': 'Vacation', 'ลาไม่รับค่าจ้าง': 'Unpaid leave',
  'เสาร์–อาทิตย์ไม่มีป้าย': 'No badge on weekends',
  'ราคาก่อน–หลังหัก VAT': 'Price before–after VAT', 'รวมเป็นเงิน (ก่อน VAT)': 'Subtotal (before VAT)',
  'รวมทั้งสิ้น (หลัง VAT)': 'Total (after VAT)', 'ยอดรับชำระสุทธิ': 'Net payment',
  'เหตุผลที่ตีกลับ…': 'Reason for rejection…', 'ตีกลับเรียบร้อย': 'Rejected successfully',
  'ภาษีมูลค่าเพิ่ม': 'VAT', 'หักภาษี ณ ที่จ่าย': 'Withholding tax',
  'คำนวณใหม่แล้ว — วางบิลได้': 'Recalculated — billable', 'วัน ส่วนลด': 'days, deduction',
  'คำนวณใหม่แล้ว — วันที่วางบิลได้': 'Recalculated — billable days',
  'พร้อมเข้ารอบบิล': 'ready for the billing cycle',

  // ── วางบิล & ร่างอีเมล (renderCycles/openCycle) ──
  'ขั้นที่ 3 จาก 4': 'Step 3 of 4', 'วางบิล &amp; ร่างอีเมล': 'Billing &amp; Email',
  'ของสัญญา': 'of contract', 'ไม่มีรอบบิลในหมวดนี้': 'No billing cycles in this category',
  'พร้อมอนุมัติ': 'Ready to approve', 'ทุกรอบ': 'All cycles', 'ยังไม่จบ': 'Not done',
  'กลับ': 'Back', 'กลับหน้ารอบบิล': 'Back to cycle list', 'ยังวางบิลไม่ได้': 'Cannot bill yet',
  'รายการในรอบบิล': 'Items in this cycle', 'ประกอบเป็นใบแจ้งหนี้ใบเดียว': 'combined into a single invoice',
  'ข้อมูลที่ส่งเข้า FlowAccount': 'Data sent to FlowAccount', 'ร่างอีเมล': 'Email draft',
  'Payload ที่จะยิงเข้า API': 'Payload to send to the API',
  'ต้องเทียบชื่อฟิลด์กับ API docs ก่อนใช้จริง': 'Verify field names against the API docs before using in production',
  'ร่างอีเมลวางบิล': 'Billing email draft', 'ให้ระบบเรียบเรียงใหม่': 'Let the system rewrite it',
  'คัดลอกร่าง': 'Copy draft', 'สร้างร่างใน Gmail': 'Create Gmail draft',
  'ข้อสังเกตจากระบบ': 'System notes', 'ถึง': 'To', 'สำเนา': 'Cc', 'เรื่อง': 'Subject',
  'เปิดดูไฟล์นี้': 'View this file', 'ดาวน์โหลดไฟล์นี้': 'Download this file',
  'ใบแจ้งหนี้ที่จะสร้าง': 'Invoice to be created', 'เลขเอกสารจะได้จาก FlowAccount': 'Document no. will come from FlowAccount',
  'ส่งเมลแล้ว': 'Email sent', 'ไม่พบอีเมลผู้รับในร่าง': 'No recipient email found in the draft',
  'บันทึกโดย': 'Recorded by', 'สร้างร่างแล้ว': 'Draft created', 'ดู Timesheet': 'View Timesheet',
  'วางบิล': 'Billed on', 'ครบกำหนด': 'Due', 'เปิดดูเอกสาร': 'View document', 'สร้างแล้ว': 'Created',
  'เลขประจำตัวผู้เสียภาษี': 'Tax ID', 'วันที่เอกสาร': 'Document date', 'ครบ': 'due',
  'เว้นว่างตามใบจริง': 'Left blank to match the real document', 'ส่วนลด': 'Discount',
  'จำนวนเงิน': 'Amount', 'รวมเป็นเงิน': 'Subtotal', 'รวมหลังหักส่วนลด': 'Total after discount',
  'รวมทั้งสิ้น': 'Grand total', 'ยอดรับชำระ': 'Payment amount', 'หมายเหตุ': 'Remark',
  'ภาษีหัก ณ ที่จ่ายคิดจากยอดหลังหักส่วนลดก่อน VAT': 'Withholding tax is calculated on the amount after discount, before VAT',
  'ตามที่ใบแจ้งหนี้ตัวอย่างทำ ไม่ใช่คิดจากยอดรวมทั้งสิ้น': 'as the sample invoice does — not on the grand total',
  'สร้างร่างใน FlowAccount แล้ว': 'FlowAccount draft created', 'ยังอนุมัติไม่ได้': 'Cannot approve yet',
  'ข้อ': 'issue(s)', 'อนุมัติและสร้างร่างใน FlowAccount': 'Approve and create FlowAccount draft',
  'กำลังส่งเข้า FlowAccount…': 'Sending to FlowAccount…',
  'ระบบกำลังเรียบเรียง…': 'System is rewriting…',
  'ระบบร่างอีเมลใหม่แล้ว — อ่านทวนก่อนคัดลอกไปส่ง': 'System redrafted the email — review before copying to send',
  'คัดลอกร่างอีเมลแล้ว — วางในกล่องเมลได้เลย': 'Email draft copied — paste it into your mail client',
  'คัดลอกไม่สำเร็จ — เลือกข้อความในกล่องร่างแล้วคัดลอกเอง': 'Copy failed — select the text in the draft box and copy it manually',
  'กำลังสร้างร่างใน Gmail…': 'Creating Gmail draft…',
  'สร้างร่างใบแจ้งหนี้': 'Invoice draft', 'ใน FlowAccount แล้ว': 'created in FlowAccount',
  '(โหมด dry-run — ยังไม่เรียก API จริง)': '(dry-run mode — no real API call made)',
  'ร่างอีเมลรออยู่ในระบบ ยังไม่ส่งออก': 'Email draft is ready in the system, not sent yet',
  'สร้างร่างใน Gmail แล้ว — ถึง': 'Gmail draft created — to',
  'เปิดแท็บใหม่ให้แล้ว กดตรวจแล้วส่งได้จากที่นั่นเลย': 'Opened a new tab — review and send it from there',
  'สร้างร่างใน Gmail แล้ว — กดส่งจาก Gmail ได้เลย': 'Gmail draft created — you can send it from Gmail',
  'ระบบจะขึ้นว่าส่งแล้วให้เองเมื่อเปิดหน้านี้อีกครั้ง': 'The system will show it as sent the next time you open this page',
  'ยังไม่ได้สร้างร่างใน Gmail — สร้างจากแท็บ': 'No Gmail draft yet — create one from the',
  'ด้านซ้าย': 'tab on the left', 'แล้วระบบจะตามให้เองว่าส่งไปแล้วหรือยัง': 'and the system will track whether it was sent',

  // ── อัปโหลด Timesheet (renderUpload) ──
  'ขั้นที่ 1 จาก 4': 'Step 1 of 4', 'อัปโหลด Timesheet': 'Upload Timesheet', 'อัปโหลดไฟล์': 'Upload File',
  'ดึงจาก Gmail': 'Pull from Gmail', 'ยังไม่ต่อ': 'Not connected', 'กรอกเอง': 'Manual entry',
  'ประวัติ': 'History', 'อีเมลแจ้งอนุมัติ Timesheet': 'Timesheet approval emails',
  'กำลังเชื่อมต่อ…': 'Connecting…', 'ยังไม่ได้เชื่อมต่อ Gmail': 'Gmail not connected yet',
  'ทำครั้งเดียวจบ ใช้บัญชี Google ของคุณเองได้': 'One-time setup — you can use your own Google account',
  'สิทธิ์ที่ขอคือ': 'The permissions requested are', 'อ่านเมล': 'read email', 'สร้างร่าง': 'create drafts',
  'ในโค้ดไม่มีคำสั่งส่งอีเมลอยู่เลย': 'there is no send-email command anywhere in the code',
  'ร่างที่สร้างจะไปอยู่ในกล่อง Drafts ให้คุณกดส่งเอง': 'Drafts land in your Drafts folder for you to send yourself',
  'เลือกไฟล์ Timesheet': 'Choose Timesheet file', 'PDF ที่ลูกค้าอนุมัติแล้ว': 'PDF the customer has approved',
  'ลากไฟล์มาวาง หรือกดเพื่อเลือกไฟล์': 'Drag a file here, or click to choose one',
  'อ่านไฟล์นี้': 'Read this file', 'ข้อมูลจากใบ Timesheet': 'Data from the Timesheet',
  'รอบเดือน': 'Month', 'ชื่อพนักงาน': 'Employee name', 'ตามที่เขียนในใบ': 'as written on the sheet',
  'ตำแหน่ง': 'Position', 'ผู้อนุมัติฝั่งลูกค้า': 'Customer-side approver', 'วันที่ลูกค้าอนุมัติ': 'Customer approval date',
  'วันลา': 'Leave', '+ เพิ่มวันลา': '+ Add leave', 'ไม่มีวันลาก็เว้นว่างไว้': 'Leave blank if there is no leave',
  'บันทึกเข้าระบบ': 'Save to system', 'ประวัติที่ระบบเคยอ่านแล้ว': 'Previously read history',
  'ทั้งจากอัปโหลดไฟล์และดึงจาก Gmail — ด่านแรกก่อนเข้าระบบวางบิลจริง':
    'From both file uploads and Gmail — the first gate before entering the real billing system',
  'กับ': 'and',

  // ── การ์ดผลอ่านไฟล์ (readResultHtml/whtSectionHtml/pendingReadHtml) ──
  'ข้อมูลที่อ่านได้': 'Data extracted', 'จากอีเมลและไฟล์แนบ': 'from the email and attachment',
  'จากไฟล์': 'from the file', 'ใบที่': 'Sheet', 'ในไฟล์เดียวกัน': 'in the same file',
  'เปิดดูไฟล์ต้นฉบับที่ระบบอ่าน': 'View the original file the system read',
  'เรื่อง': 'Subject', 'เลขเอกสาร': 'Document no.',
  'ยังบันทึกไม่ได้': 'Cannot save yet',
  'ชื่อพนักงานตามที่เขียนในไฟล์': 'Employee name as written in the file',
  'จับคู่กับพนักงานในระบบไม่ได้ — เลือกว่าชื่อนี้คือใคร แล้วกดเพิ่มเป็นชื่อพ้อง':
    'Could not match to an employee in the system — pick who this is, then add as an alias',
  'ครั้งต่อไประบบจะจับคู่ให้เอง': 'next time the system will match it automatically',
  '— เลือกพนักงานที่ตรงกับชื่อนี้ —': '— Choose the employee this name matches —',
  'เพิ่มเป็นชื่อพ้อง': 'Add as alias', 'ตำแหน่งตามที่เขียนในไฟล์': 'Position as written in the file',
  'วันทำงานที่ระบุท้ายตาราง': 'Work days stated at the bottom of the table',
  'วันลาที่ระบุท้ายตาราง': 'Leave days stated at the bottom of the table',
  'อีเมลระบุวันที่อนุมัติ': 'Email states approval date', 'วันลาที่อ่านได้': 'Leave days extracted',
  'เทียบกับ HRDD (ระบบเช็คชื่อบริษัทหลัก)': 'Compare with HRDD (parent-company attendance system)',
  'รีเฟรชจาก HRDD': 'Refresh from HRDD', 'กำลังตรวจสอบวันลากับ HRDD…': 'Checking leave against HRDD…',
  'จับคู่ชื่อพนักงานกับคนในระบบก่อน (ด้านบน) ถึงจะเทียบกับ HRDD ได้':
    'Match the employee name to someone in the system first (above) before comparing with HRDD',
  'ลายเซ็น': 'Signature', 'พนักงาน': 'Employee', 'พบลายเซ็น': 'Signature found',
  'ดู JSON ดิบที่ระบบอ่านออกมา': 'View the raw JSON the system extracted', 'ทิ้งผลนี้': 'Discard this result',
  'ยืนยันและบันทึกเข้าระบบ': 'Confirm and save to system', 'ระบบกำลังอ่าน': 'System is reading',
  'เมลและไฟล์แนบ': 'the email and attachment', 'ไฟล์': 'the file', 'ไฟล์ Timesheet': 'Timesheet file',
  'อ่านทีละหน้าแล้วรวมผล — เอกสารทั่วไปราว': 'Reading page by page and combining the result — typically about',
  'วินาทีต่อหน้า': 'seconds per page',
  'ไฟล์ที่รวม Timesheet หลายคนจะใช้เวลาหลายนาที ปล่อยหน้านี้ไว้ได้เลย':
    'files combining several people’s Timesheets take a few minutes — feel free to leave this page open',

  // ── ใบแจ้งหนี้ (renderInvoices) ──
  'เอกสาร': 'Documents', 'ใบแจ้งหนี้': 'Invoices',
  'เอกสารที่ระบบสร้างเข้า FlowAccount — กางยอดภาษีของทุกรอบไว้เทียบกัน':
    'Documents the system created in FlowAccount — tax figures for every cycle laid out to compare',
  'เลขที่เอกสาร': 'Document no.', 'หลังส่วนลด': 'After discount', 'หัก ณ ที่จ่าย': 'Withholding tax',
  'เปิดดูใบวางบิล': 'View invoice', 'ดาวน์โหลดใบวางบิล': 'Download invoice',
  'ส่งไม่สำเร็จ': 'Failed to send', 'ร่าง': 'Draft',
  'ยังไม่มีใบแจ้งหนี้ — สร้างได้ที่ขั้น 3': 'No invoices yet — create one at Step 3',
  'รวมยอดที่วางบิลแล้ว': 'Total billed',

  // ── ข้อมูลหลัก (renderMaster) ──
  'อ้างอิง': 'Reference', 'ข้อมูลหลัก': 'Master Data',
  'ฐานข้อมูลที่ทั้ง 3 ขั้นใช้ร่วมกัน — จับคู่ชื่อ · หาเรทค่าบริการ · นับวันทำงานของเดือน':
    'The shared database all 3 steps use — matching names, looking up rates, counting work days',
  'พนักงาน & ชื่อพ้อง': 'Employees & Aliases', 'ลูกค้า & สัญญา': 'Customers & Contracts',
  'วันหยุด': 'Holidays', 'เพิ่มพนักงาน': 'Add employee',
  'ยังไม่มีบริษัทที่กำลังดำเนินการอยู่': 'No active company selected',
  'รหัส': 'Code', 'ชื่อ': 'Name', 'ชื่อพ้อง': 'Aliases', 'ตำแหน่งพ้อง': 'Position aliases',
  'ตำแหน่งบนใบแจ้งหนี้': 'Position on invoice', 'เรท/เดือน': 'Rate/month', 'บริษัท': 'Company',
  'แก้ไขข้อมูลพนักงาน': 'Edit employee', 'นำออกจากโครงการนี้': 'Remove from this project',
  'เพิ่มลูกค้าใหม่': 'Add new customer',
  'กำลังดำเนินการอยู่ — ปิดไปยังไม่มีบริษัทอื่นมาแทนที่อัตโนมัติ':
    'Currently active — turning it off will not auto-switch to another company',
  'ปิดอยู่ — เปิดเพื่อให้ระบบทำงานกับบริษัทนี้ (จะปิดบริษัทอื่นที่เปิดอยู่ให้เองอัตโนมัติ)':
    'Inactive — turn on to make the system work with this company (auto-switches off any other active one)',
  'กำลังดำเนินการ': 'Active', 'ปิดอยู่': 'Inactive', 'แก้ไขข้อมูลสัญญา': 'Edit contract',
  'เลขที่สัญญา': 'Contract no.', 'จำนวนคน': 'Headcount', 'ยอดต่อเดือน': 'Monthly total',
  'ผู้ประสานงาน': 'Coordinator', 'สถานที่วางบิล': 'Billing address', 'ปฏิทินวันหยุด': 'Holiday calendar',
  'ชื่อวันหยุด': 'Holiday name', 'ขอบเขต': 'Scope',
  'เติมวันหยุดราชการทางการให้อัตโนมัติตามปีที่เลือก ไม่ต้องพิมพ์เพิ่มเอง':
    'Official public holidays fill in automatically for the selected year — no need to type them in',
  'ยังไม่มีข้อมูลวันหยุดทางการของปีนี้ในระบบ': 'No official holiday data for this year yet',
  'ทุกลูกค้า': 'All customers', 'ลบวันหยุดนี้': 'Delete this holiday', 'ลูกค้า': 'Customer',
  'บริษัท & สัญญา': 'Company & Contract',

  // ── ข้อมูลหลัก: alias cell / rate cell / add-edit forms ──
  'คลิกเพื่อแก้ไข': 'Click to edit', 'บันทึก': 'Save', 'ยกเลิก': 'Cancel', 'ไม่มี': 'None',
  'ลบ': 'Delete', 'นี้': 'this', 'ใหม่': 'new', 'แก้เรท': 'Edit rate',
  'กรอกข้อมูลบริษัทและสัญญาแรกในคราวเดียว': 'Enter the company and its first contract at once',
  'ชื่อบริษัท': 'Company name', 'เลขผู้เสียภาษี': 'Tax ID', 'สาขา': 'Branch', 'ที่อยู่': 'Address',
  'ดึงข้อมูลจาก FlowAccount': 'Import from FlowAccount',
  '— เลือกบริษัทจากใบเสนอราคาที่มีอยู่แล้ว —': '— Pick a company from an existing quotation —',
  'เครดิต (วัน)': 'Credit (days)', 'เบอร์ผู้ประสานงาน': 'Coordinator phone',
  'การอ่าน Timesheet ด้วย ABBYY': 'Reading Timesheets with ABBYY',
  'ABBYY Skill ID เฉพาะบริษัทนี้': "This company's ABBYY Skill ID",
  'เว้นว่าง = ใช้ Skill กลาง': 'Leave blank to use the shared Skill',
  'ถ้าลูกค้ารายนี้มี Timesheet คนละแบบฟอร์ม เทรน Skill แยกใน ABBYY Vantage แล้วใส่ Skill ID ไว้ที่นี่ — ตอนอัปโหลด Timesheet ระบบจะเลือกใช้ Skill นี้ให้เองตามบริษัทที่กำลังดำเนินการอยู่ ไม่ต้องเลือกอะไรเพิ่ม เว้นว่างไว้ถ้ายังไม่มี Skill เฉพาะ ระบบจะใช้ Skill กลางแทน':
    "If this customer's Timesheets use a different layout, train a separate Skill in ABBYY Vantage and put its Skill ID here — when uploading a Timesheet, the system will automatically use this Skill based on the currently active company, no extra selection needed. Leave blank if there's no dedicated Skill yet; the shared Skill will be used instead.",
  'อีเมลผู้ประสานงาน': 'Coordinator email', 'สัญญาแรก': 'First contract',
  'เลขที่ใบว่าจ้าง (PO)': 'PO number', 'เลขที่สัญญา': 'Contract no.', 'ชื่อโครงการ': 'Project name',
  'ตัวหารอัตราต่อวัน': 'Daily-rate divisor', 'คงที่ (ระบุจำนวนวัน)': 'Fixed (specify days)',
  'จำนวนวัน (ถ้าคงที่)': 'Number of days (if fixed)', 'วันเริ่มสัญญา': 'Contract start date',
  'วันสิ้นสุดสัญญา': 'Contract end date',
  'พนักงาน/อัตราจ้างของลูกค้ารายนี้เพิ่มได้ทีหลังจากแท็บ': 'Employees/rates for this customer can be added later from the',
  'บันทึกลูกค้าใหม่': 'Save new customer', 'เพิ่มพนักงานใหม่': 'Add new employee',
  'ผูกอัตราจ้างกับ': 'Linking the rate to', 'ชื่อ-นามสกุล (ไทย)': 'Full name (Thai)',
  'ชื่อ-นามสกุล (อังกฤษ)': 'Full name (English)', 'รหัสพนักงาน HRDD': 'HRDD employee code',
  'เลขที่ใบเสนอราคา (QT)': 'Quotation no. (QT)', 'เรทต่อเดือน (บาท)': 'Monthly rate (THB)',
  'วันเริ่มงาน': 'Start date', 'วันสิ้นสุด (ถ้าไม่ระบุ = ตามสัญญา)': 'End date (blank = follows contract)',
  'บันทึกพนักงานใหม่': 'Save new employee', 'แก้ไขข้อมูลสัญญา': 'Edit contract',
  'วันสิ้นสุด': 'End date', 'บันทึกการแก้ไข': 'Save changes', 'สัญญา': 'Contract',

  // ── จัดการระบบ (renderSystemAdmin) ──
  'ผู้ดูแลระบบ': 'System Admin', 'จัดการระบบ': 'System Admin',
  'ผู้ใช้ในระบบ · การเชื่อมต่อกับบริการภายนอก · บันทึกทุกการเปลี่ยนแปลง':
    'System users · connections to external services · a log of every change',
  'ผู้ใช้': 'Users', 'ผู้รับแจ้งเตือน': 'Notification recipients', 'บันทึกระบบ': 'System log',
  'การเชื่อมต่อ': 'Connections', 'ใช้จริงตอนกดอนุมัติ': 'Used in production on approval',
  'ไม่ตรงกับค่าใน .env ด้านบน — ค่านี้ในฐานข้อมูลเป็นตัวที่ใช้จริง':
    'Does not match the .env value above — this database value is what is actually used',
  'ตั้งค่าแล้ว': 'Configured', 'ยังไม่ตั้ง': 'Not configured', 'ชนิดเอกสาร': 'Document type',
  'เชื่อมต่อแล้ว': 'Connected', 'ยังไม่เชื่อม': 'Not connected',
  'ราย': 'recipients', 'ลิงก์ในข้อความ LINE': 'Link in LINE messages',
  'ข้อความแจ้งเตือนจะไม่มีปุ่มกดเข้าระบบ': 'Notification messages will have no button linking into the system',
  'ระบบในเครื่อง': 'Local system', 'โมเดล': 'Model', 'โมเดล (ข้อความ)': 'Model (text)',
  'โมเดล (อ่านไฟล์)': 'Model (file reading)', 'เงื่อนไขวางบิล': 'Billing rules',
  'วันที่ลงเอกสาร': 'Document date', 'ของเดือนถัดไป': 'of the following month',
  'ต้องได้ครบทุกคน': 'Requires everyone submitted', 'ใช่': 'Yes', 'ไม่': 'No',
  'ต้องมีคนกดยืนยัน': 'Requires human confirmation', 'ไม่ (โหมด auto)': 'No (auto mode)',
  'ใช่ (โหมด manual)': 'Yes (manual mode)', 'ส่งอีเมลอัตโนมัติ': 'Auto-send email',
  'สร้างร่างเท่านั้น': 'Draft only', 'ไฟล์แนบในร่างอีเมล': 'Email draft attachments',
  'ใบวางบิล + Timesheet ทุกคนในรอบ': 'Invoice + everyone’s Timesheet in the cycle',
  'ใบวางบิลดึงจาก FlowAccount มาเก็บให้เองตอนกดอนุมัติ': 'The invoice is pulled from FlowAccount automatically on approval',
  'ปิดรอบเมื่อส่งเมล': 'Close cycle when email is sent', 'อัตโนมัติ': 'Automatic',
  'ระบบดูจากกล่อง Gmail เองว่าร่างถูกกดส่งแล้วหรือยัง': 'The system checks your Gmail inbox to see whether the draft was sent',
  'เพิ่มผู้ใช้ใหม่': 'Add new user', 'รหัสผ่าน': 'Password', '(อย่างน้อย 8 ตัวอักษร)': '(at least 8 characters)',
  '+ เพิ่มผู้ใช้': '+ Add user', 'สร้างเมื่อ': 'Created', 'แก้ role ของตัวเองไม่ได้': 'Cannot change your own role',
  'ปิดใช้งานบัญชีตัวเองไม่ได้': 'Cannot deactivate your own account',
  'ใช้งานอยู่ — กดเพื่อปิดใช้งาน': 'Active — click to deactivate',
  'ปิดใช้งานอยู่ — กดเพื่อเปิดใช้งาน': 'Inactive — click to activate',
  'ใช้งานอยู่': 'Active', 'ปิดใช้งาน': 'Inactive', 'ลบบัญชีของตัวเองไม่ได้': 'Cannot delete your own account',
  'เพิ่มผู้รับแจ้งเตือน': 'Add notification recipient', 'ช่องทาง': 'Channel', 'อีเมล': 'Email',
  'ชื่อ (แสดงในรายการ)': 'Name (shown in the list)', 'ปลายทาง': 'Destination',
  '— เลือกคนที่เคยทักบอทมาแล้ว —': '— Choose someone who has messaged the bot —',
  'ไม่พบชื่อ': 'Name not found', 'อื่นๆ — กรอก userId เอง': 'Other — enter userId manually',
  '+ เพิ่ม': '+ Add', 'ลบผู้รับแจ้งเตือนนี้': 'Delete this recipient', 'ยังไม่มีผู้รับแจ้งเตือน': 'No notification recipients yet',
  'เวลา': 'Time', 'ผู้ทำ': 'Actor', 'การกระทำ': 'Action', 'เป้าหมาย': 'Target',
  '▶ รายละเอียด': '▶ Details', 'ยังไม่มีบันทึก': 'No log entries yet',
  'สวัสดีตอนเช้า': 'Good morning', 'สวัสดีตอนบ่าย': 'Good afternoon', 'สวัสดีตอนเย็น': 'Good evening',
  'เทียบ': 'vs ', 'เดือนก่อน': 'last month', 'ยอดของรายการนี้': 'This line amount',

  // ── ตารางรายละเอียดรายวันเต็มรูปแบบ (openSheet, 27 ส.ค. 69) ──
  'ตามคอลัมน์ที่ ABBYY อ่านได้ — ชั่วโมงคำนวณเองอัตโนมัติถ้าตารางต้นฉบับไม่ได้สรุปมาให้':
    'Matches the columns ABBYY reads — hours are auto-calculated when the source table has none',
  'วันในสัปดาห์': 'Day', 'เวลา OT': 'OT time', 'ประเภท': 'Type',
  'ชม.ปกติ': 'Normal (hrs)', 'ชม. OT': 'OT (hrs)', 'รวม/วัน': 'Total/day', 'รวมทั้งเดือน': 'Monthly total',
};
const tx = (str) => (state.lang === 'en' && T[str] ? T[str] : str);

/**
 * แปลงเวลาที่เก็บในฐานข้อมูลให้เป็น Date
 *
 * ค่าที่ SQLite เขียนเองไม่มีเครื่องหมายเขตเวลากำกับ แต่เป็น **UTC** เสมอ
 * ถ้าปล่อยให้ JS เดาเอง มันจะตีเป็นเวลาท้องถิ่น แล้วเวลาจะเพี้ยนไป 7 ชั่วโมง
 * (เคยทำให้กระดิ่งขึ้นว่า "7 ชั่วโมงที่แล้ว" ทั้งที่เพิ่งกดไปเมื่อครู่)
 * ของใหม่เขียน Z กำกับแล้ว บรรทัดนี้จึงมีไว้รองรับข้อมูลเก่าที่ยังไม่มี
 */
const toDate = (iso) => {
  if (!iso) return null;
  let norm = String(iso).includes('T') ? String(iso) : String(iso).replace(' ', 'T');
  if (norm.length === 10) norm += 'T00:00:00';           // วันที่ล้วน = ไม่มีเวลา ไม่ต้องแปลงเขต
  else if (!/[Zz]|[+-]\d{2}:?\d{2}$/.test(norm)) norm += 'Z';
  const d = new Date(norm);
  return Number.isNaN(d.getTime()) ? null : d;
};

const dt = (iso) => {
  const d = toDate(iso);
  if (!d) return iso ? String(iso) : '—';
  return d.toLocaleString('th-TH', {
    day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit',
  });
};

const THAI_M_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
                      'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/**
 * '2026-01' → '1–31 ม.ค. 2569'
 * ใช้แสดงบนหน้าจอเท่านั้น — description ที่ส่งเข้า FlowAccount ยังเป็นวันที่เต็ม
 */
const compactPeriod = (period) => {
  const [y, m] = period.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `1–${last} ${THAI_M_SHORT[m - 1]} ${y + 543}`;
};

const dateOnly = (iso) => {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });
};

/* ประวัติการดำเนินการ (audit_log.action) เก็บเป็นชื่อฟังก์ชันภาษาอังกฤษ — คนอ่านหน้าเว็บไม่ควรต้องรู้
   ชื่อฟังก์ชันในโค้ด แปลงเป็นประโยคสั้นๆ บอกว่าระบบทำอะไรไปแทน ชื่อที่ไม่รู้จักยังโชว์ได้ (แทน _ ด้วยเว้นวรรค) */
const AUDIT_ACTION_LABEL = {
  extract_timesheet: 'ระบบอ่านไฟล์ Timesheet',
  read_timesheet_file: 'ระบบอ่านไฟล์ Timesheet',
  read_email_approval: 'ระบบอ่านอีเมลอนุมัติ',
  ingest_timesheet: 'นำเข้าระบบวางบิล',
  ingest_timesheet_replaced: 'นำเข้าระบบวางบิล (แทนที่ฉบับเดิม)',
  ingest_failed_no_match: 'นำเข้าไม่ได้ — จับคู่ชื่อพนักงานไม่พบ',
  ingest_failed_no_contract: 'นำเข้าไม่ได้ — ไม่พบสัญญาที่ครอบคลุมรอบนี้',
  recompute_manday: 'คำนวณ Manday',
  human_checked: 'คนตรวจแล้ว — ยืนยันผ่าน',
  reject_timesheet: 'ตีกลับให้แก้ Timesheet',
  notify_line_needs_check: 'แจ้ง LINE — มี Timesheet ใหม่รอตรวจ',
  notify_line_needs_check_error: 'แจ้ง LINE ไม่สำเร็จ (รอตรวจ)',
  notify_line_check_failed: 'แจ้ง LINE — ตรวจ Manday ไม่ผ่าน',
  notify_line_check_failed_error: 'แจ้ง LINE ไม่สำเร็จ (ตรวจไม่ผ่าน)',
};
const auditActionLabel = (action) => AUDIT_ACTION_LABEL[action] ?? action.replace(/_/g, ' ');
const AUDIT_ACTOR_LABEL = { llm: 'ระบบ', system: 'ระบบอัตโนมัติ' };
const auditActorLabel = (actor) => AUDIT_ACTOR_LABEL[actor] ?? actor;

function toast(message, isError = false) {
  const node = el('tst');
  node.classList.toggle('err', isError);
  node.innerHTML = `<span class="tst-ic">${icon(isError ? 'alt' : 'chk')}</span><span class="tst-msg"></span>`;
  node.querySelector('.tst-msg').textContent = message;
  node.classList.add('on');
  clearTimeout(node._timer);
  node._timer = setTimeout(() => node.classList.remove('on'), isError ? 8000 : 6000);
}

/**
 * กล่องยืนยันแบบมีดีไซน์ — ใช้แทน confirm() ของเบราว์เซอร์ (หน้าตาเถื่อน ไม่ตรงกับธีมแอป)
 * message รับ HTML ได้ตรงๆ (คนเรียกต้อง esc() ค่าที่แปรผันเองก่อนใส่)
 * คืนค่าเป็น Promise<boolean> — true = กดปุ่มยืนยัน, false = ยกเลิกหรือกดนอกกล่อง
 */
function confirmModal({ iconName = 'trash-solid', danger = true, title, message, confirmLabel = 'ลบ', cancelLabel = 'ยกเลิก' } = {}) {
  return new Promise((resolve) => {
    const root = el('modalRoot');
    root.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal-card">
          <div class="modal-banner"></div>
          <span class="modal-ic"><span class="modal-ic-badge ${danger ? '' : 'brand'}">
            ${icon(iconName, iconName.endsWith('-solid') ? 'i solid' : 'i')}</span></span>
          <div class="modal-body">
            <h3>${esc(title)}</h3>
            <p>${message}</p>
          </div>
          <div class="modal-ft">
            <button class="btn" id="modalCancel">${esc(cancelLabel)}</button>
            <button class="btn ${danger ? 'dgr' : 'pri'}" id="modalConfirm">
              ${danger ? icon('trash', 'i sm') : ''} ${esc(confirmLabel)}</button>
          </div>
        </div>
      </div>`;
    const close = (result) => { root.innerHTML = ''; resolve(result); };
    el('modalCancel').addEventListener('click', () => close(false));
    el('modalConfirm').addEventListener('click', () => close(true));
    root.querySelector('.modal-backdrop').addEventListener('click', (e) => {
      if (e.target.classList.contains('modal-backdrop')) close(false);
    });
  });
}

/**
 * กล่องขอข้อความสั้นๆแบบมีดีไซน์ — ใช้แทน prompt() ของเบราว์เซอร์ (เหตุผลเดียวกับ confirmModal —
 * prompt() ก็เป็น native dialog แบบเดียวกับ confirm() ถูกบล็อกได้เหมือนกันในบางเบราว์เซอร์/ส่วนขยาย
 * กดปุ่มแล้วเหมือนไม่มีอะไรเกิดขึ้นเลย ทั้งที่จริงกำลังรอ dialog ที่ไม่มีวันโผล่มา)
 * คืนค่าเป็น Promise<string|null> — string (ตัดช่องว่างหัวท้ายแล้ว) ถ้ากรอกแล้วกดยืนยัน
 * null ถ้ายกเลิก/กดนอกกล่อง/กดยืนยันตอนช่องว่างเปล่า
 */
function promptModal({ title, message = '', placeholder = '', confirmLabel = 'ตกลง', cancelLabel = 'ยกเลิก' } = {}) {
  return new Promise((resolve) => {
    const root = el('modalRoot');
    root.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal-card">
          <div class="modal-banner"></div>
          <span class="modal-ic"><span class="modal-ic-badge brand">${icon('doc', 'i')}</span></span>
          <div class="modal-body">
            <h3>${esc(title)}</h3>
            ${message ? `<p>${message}</p>` : ''}
            <textarea id="modalPromptInput" class="modal-prompt-input" rows="3"
              placeholder="${esc(placeholder)}"></textarea>
          </div>
          <div class="modal-ft">
            <button class="btn" id="modalCancel">${esc(cancelLabel)}</button>
            <button class="btn pri" id="modalConfirm">${esc(confirmLabel)}</button>
          </div>
        </div>
      </div>`;
    const input = el('modalPromptInput');
    const close = (result) => { root.innerHTML = ''; resolve(result); };
    el('modalCancel').addEventListener('click', () => close(null));
    el('modalConfirm').addEventListener('click', () => close(input.value.trim() || null));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) close(input.value.trim() || null);
    });
    root.querySelector('.modal-backdrop').addEventListener('click', (e) => {
      if (e.target.classList.contains('modal-backdrop')) close(null);
    });
    input.focus();
  });
}

/**
 * เปิดดู PDF ในหน้าเว็บเลย ไม่เปิดแท็บใหม่ — เพราะเบราว์เซอร์บางเครื่องตั้งค่าให้ดาวน์โหลด
 * ไฟล์ PDF อัตโนมัติแทนเปิดดู (เจอจริงกับผู้ใช้บางคน) ต่อให้เซิร์ฟเวอร์ส่ง
 * Content-Disposition: inline มาแล้วก็ตาม — ฝัง <iframe> เองตัดปัญหานี้ไปเลย
 * เพราะเบราว์เซอร์ยังคงเปิดตัวอ่าน PDF ในตัวให้ดูภายใน iframe ได้ปกติ
 */
function openPdfPreview(url, filename) {
  const root = el('modalRoot');
  const dl = `${url}${url.includes('?') ? '&' : '?'}dl`;
  root.innerHTML = `
    <div class="modal-backdrop pdf">
      <div class="modal-card pdf-card">
        <div class="pdf-hd">
          <span class="pdf-title">${icon('file', 'i sm')} ${esc(filename ?? 'เอกสาร PDF')}</span>
          <div class="pdf-actions">
            <a class="btn sm icon" href="${esc(dl)}" download="${esc(filename ?? 'document.pdf')}"
               title="ดาวน์โหลดไฟล์นี้" aria-label="ดาวน์โหลด">${icon('cd')}</a>
            <button class="btn sm icon" id="pdfClose" title="ปิด" aria-label="ปิด">${icon('x')}</button>
          </div>
        </div>
        <iframe class="pdf-frame" src="${esc(url)}" title="${esc(filename ?? 'เอกสาร PDF')}"></iframe>
      </div>
    </div>`;
  const close = () => { root.innerHTML = ''; };
  el('pdfClose').addEventListener('click', close);
  root.querySelector('.modal-backdrop').addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-backdrop')) close();
  });
}

/* ทุกที่ในระบบที่แสดงไฟล์ PDF ใช้ลิงก์ class="file" ตัวเดียวกันหมด — ดักคลิกตรงนี้จุดเดียว
   แทนที่จะไปแก้ทีละจุดที่ render ไม่งั้นเพิ่มจุดใหม่ในอนาคตแล้วลืมผูกจะพลาดง่าย
   Ctrl/Cmd/กลางคลิกยังปล่อยให้เบราว์เซอร์เปิดแท็บใหม่ตามปกติ (ผู้ใช้ตั้งใจเปิดแยก) */
document.addEventListener('click', (e) => {
  const link = e.target.closest('a.file[href]');
  if (!link || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  openPdfPreview(link.href, link.textContent.replace(/^PDF/, '').trim());
});

// ─────────────────────────────────────────────────────────────

const state = {
  lang: localStorage.getItem('obs.lang') === 'en' ? 'en' : 'th',
  view: 'dash', detailId: null, tab: 1,
  queueFilter: 'action', queueSearch: '', queuePage: 1,
  queueSort: 'urgent', expanded: null,
  cycleFilter: 'all',
  cycleTab: 1,
  calDay: null,
  masterTab: 1, uploadTab: 1, sysTab: 1, holidayYear: null,
  /** role ของคนที่ login อยู่ — เติมจาก /pulse ทุกครั้งที่ syncBadges() คุยกับเซิร์ฟเวอร์ */
  role: null,
  /* สัญญาที่ "กำลังดำเนินการอยู่" ที่เลือกจากตัวเลือกบริษัทบนแถบบน — null = ยังไม่มีสัญญา active เลย
     (เช่นระบบใหม่ยังไม่ได้ตั้งใคร) แดชบอร์ด/ตรวจ Manday/ใบแจ้งหนี้จะกรองด้วยค่านี้เสมอ
     ดู loadContractSwitch()/contractQuery() ท้ายไฟล์ */
  contractId: null,
  /* แถวชื่อพ้อง/ตำแหน่งพ้องที่กำลังเพิ่มหรือแก้อยู่ — เปิดทีละอันเท่านั้น
     { empId, kind: 'name'|'position', mode: 'add'|'edit', original } (original ใช้ตอน mode 'edit') */
  aliasEdit: null,
  /** สัญญาจ้างที่กำลังแก้เรทอยู่ — เปิดทีละอันเท่านั้น: assignmentId หรือ null */
  rateEdit: null,
  /** เปิด/ปิดฟอร์ม "เพิ่มลูกค้าใหม่" ในแท็บลูกค้า & สัญญา */
  customerAdd: false,
  /** เปิด/ปิดฟอร์ม "เพิ่มพนักงานใหม่" ในแท็บพนักงาน & ชื่อพ้อง */
  employeeAdd: false,
  /** แถวพนักงานที่กำลังกดไอคอนดินสอแก้ไขอยู่ — เปิดทีละคน: assignment_id (หรือ employee id ถ้าไม่มี) หรือ null */
  employeeEdit: null,
  /** การ์ดบริษัท/สัญญาที่กำลังกดไอคอนดินสอแก้ไขอยู่ — เปิดทีละใบ: contract id หรือ null */
  contractEdit: null,
  /* ผลที่ AI อ่านจากไฟล์ที่เพิ่งอัปโหลด/ดึงจาก Gmail — ยังไม่ได้บันทึกลงฐานข้อมูล
     อยู่ในหน่วยความจำหน้าจอจนกว่าคนจะกดยืนยัน รีเฟรชแล้วหาย ซึ่งถูกต้อง
     เพราะสิ่งที่ AI อ่านมายังไม่ใช่ข้อมูลของระบบจนกว่าจะมีคนรับรอง
     เป็น "รายการ" (array) ไม่ใช่ตัวเดียว เพราะ 1 อีเมลอาจมีไฟล์แนบของหลายคน ต้องเห็นครบทุกคน
     พร้อมกันบนจอ ไม่ใช่แทนที่กันทีละคน — แต่ละรายการมี _key ไว้แยกกันเวลาแก้/ลบ/ยืนยัน */
  reads: [],
};

const STATUS_CLASS = {
  verified: 'ok', mismatch: 'cr', billed: 'ok', rejected: 'mu',
  received: 'pr', extracted: 'pr', approved: 'ok',
};

const CYCLE_STATE_CLASS = {
  awaiting: 'pr', partial: 'wn', mismatch: 'cr', checking: 'wn', ready: 'ok', billed: 'ok',
};

/* ══ แดชบอร์ด — หน้าเดียวที่ไม่ใช่ขั้นตอนงาน ═══════════════
   ไว้ดูภาพรวมว่าตอนนี้เงินอยู่ตรงไหนของ process และมีอะไรค้างที่ขั้นไหน
   ทุกตัวเลขมาจากสถานะจริงในระบบ — ไม่มีเรื่องการรับชำระ เพราะระบบไม่ได้บันทึกการรับเงิน */

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return tx('สวัสดีตอนเช้า');
  if (h < 17) return tx('สวัสดีตอนบ่าย');
  return tx('สวัสดีตอนเย็น');
}

function trendPill(value, label) {
  if (value === null || value === undefined) return `<span class="pill flat">${tx('ยังเทียบไม่ได้')}</span>`;
  const up = value >= 0;
  return `<span class="pill ${up ? 'up' : 'down'}" title="${tx('เทียบ')}${esc(tx(label ?? 'เดือนก่อน'))}">
    ${up ? '↑' : '↓'} ${Math.abs(value).toFixed(1)}%</span>`;
}

const SPLIT_LABEL = {
  billed: 'วางบิลแล้ว', ready: 'รออนุมัติ', checking: 'รอคนตรวจ',
  mismatch: 'ข้อมูลไม่ตรง', partial: 'ได้ไม่ครบ', awaiting: 'รอ Timesheet',
};
const SPLIT_COLOR = {
  billed: 'var(--ok)', ready: 'var(--brand)', checking: 'var(--wn)',
  mismatch: 'var(--cr)', partial: 'var(--tint2)', awaiting: 'var(--rule)',
};
async function renderDashboard() {
  const data = await api(`/dashboard${contractQuery()}`);
  const contract = data.contracts[0];
  const cycles = data.cycles;

  const dist = {};
  for (const c of cycles) dist[c.state] = (dist[c.state] ?? 0) + 1;
  const order = ['billed', 'ready', 'checking', 'mismatch', 'partial', 'awaiting'];

  main.innerHTML = `
  <div class="page">
    <div class="greet">
      <div>
        <span class="hi">${greeting()}</span>
        <h1>${tx('ภาพรวมการวางบิล')}</h1>
        <p class="sub2">${contract
          ? `${esc(contract.customerName)} · ${esc(contract.projectName)} · ${tx('ใบว่าจ้าง')} ${esc(contract.poNo)}`
          : tx('ยังไม่มีสัญญาในระบบ')}</p>
      </div>
      <div class="tools">
        <span class="datechip">${icon('cal')} ${tx('ข้อมูล ณ')} ${dateOnly(data.today)}</span>
      </div>
    </div>

    <div class="kpis">
      <div class="kpi ${data.counts.waitingCheck ? 'w' : 'g'} act" data-go="queue" role="button" tabindex="0">
        <div class="kh"><span class="ic">${icon('list-chk')}</span><span class="kl">${tx('ขั้น 2 · รอตรวจสอบ')}</span></div>
        <span class="kv">${int(data.counts.waitingCheck)}<small>${tx('ใบ')}</small></span>
        ${data.counts.waitingCheck
          ? `<span class="kf">${tx('มูลค่า')} ${money(data.waitingCheckValue)} ${tx('บาท')} · ${tx('กดเพื่อไปตรวจ')}</span>` : ''}
      </div>

      <div class="kpi ${data.counts.readyToBill ? 'w' : 'g'} act" data-go="cycles" role="button" tabindex="0">
        <div class="kh"><span class="ic">${icon('doc')}</span><span class="kl">${tx('ขั้น 3 · พร้อมวางบิล')}</span></div>
        <span class="kv">${int(data.counts.readyToBill)}<small>${tx('ใบ')}</small></span>
        ${data.counts.readyToBill
          ? `<span class="kf">${tx('มูลค่า')} ${money(data.readyValue)} ${tx('บาท')} · ${tx('กดเพื่อไปอนุมัติ')}</span>` : ''}
      </div>

      <div class="kpi a">
        <div class="kh"><span class="ic">${icon('money')}</span><span class="kl">${tx('ยอดวางบิลแล้ว')}</span>
          ${trendPill(data.trends.billed, data.trends.previousPeriodLabel)}</div>
        <span class="kv">${money(data.billedAmount)}</span>
        ${data.invoiceCount
          ? `<span class="kf">${int(data.invoiceCount)} ${tx('ใบ')} · ${tx('รอบล่าสุด')} ${esc(data.trends.latestPeriodLabel)}</span>` : ''}
      </div>
    </div>

    <div class="mosaic c3">
      <div class="card">
        <div class="hd"><h3>${tx('สถานะรอบบิล')}</h3></div>
        <div class="bd">
          <div class="split">
            ${order.filter((k) => dist[k]).map((k) =>
              `<span style="flex:${dist[k]};background:${SPLIT_COLOR[k]}"
                     title="${tx(SPLIT_LABEL[k])} ${dist[k]}"></span>`).join('')}
          </div>
          <ul class="legend-rows">
            ${order.map((k) => `
              <li><i style="background:${SPLIT_COLOR[k]}"></i>
                <span>${tx(SPLIT_LABEL[k])}</span><b>${int(dist[k] ?? 0)}</b></li>`).join('')}
          </ul>
        </div>
      </div>

      <div class="card">
        <div class="hd"><h3>${tx('งานที่ต้องทำ')}</h3></div>
        <div class="bd">
          <ul class="tasks">${data.tasks.slice(0, 6).map((n, i) => `
            <li>
              <span class="tic ${n.level === 'critical' ? 'cr' : n.level === 'warn' ? 'wn' : 'info'}">
                ${icon(n.level === 'info' ? 'info' : 'alt')}</span>
              <span><span class="tt">${esc(n.title)}</span>
                ${n.detail ? `<span class="td">${esc(n.detail)}</span>` : ''}</span>
              <button class="go" data-task="${i}">${tx('เปิด')}</button>
            </li>`).join('')}</ul>
        </div>
      </div>

      <div class="card">
        <div class="hd"><h3>${tx('ความคืบหน้าสัญญา')}</h3><span class="rt">${esc(contract?.poNo ?? '')}</span></div>
        <div class="bd">
          ${contract ? `
          <div class="pair" style="gap:20px">
            <div><span class="pl">${tx('มูลค่าสัญญา')}</span><span class="pv">${money(contract.contractValue)}</span></div>
            <div><span class="pl">${tx('คงเหลือ')}</span><span class="pv c">${money(contract.remainingValue)}</span></div>
          </div>
          <div class="bar"><span style="width:${contract.progress}%"></span></div>
          <div class="progline">
            <span>${dateOnly(contract.startDate)}</span>
            <span><b>${contract.progress}%</b> · ${contract.monthsBilled}/${contract.monthsTotal} ${tx('รอบ')}</span>
            <span>${dateOnly(contract.endDate)}</span>
          </div>
          <ul class="legend-rows" style="margin-top:16px">
            <li><i style="background:var(--brand)"></i><span>${tx('พนักงานในสัญญา')}</span><b>${int(contract.headcount)} ${tx('คน')}</b></li>
            <li><i style="background:var(--tint2)"></i><span>${tx('เครดิต')}</span><b>${int(contract.creditDays)} ${tx('วัน')}</b></li>
            <li><i style="background:var(--tint2)"></i><span>${tx('ส่วนลดวันลารวม')}</span><b>${money(data.leaveDeduction)}</b></li>
          </ul>` : `<div class="empty">${tx('ยังไม่มีสัญญา')}</div>`}
        </div>
      </div>

    </div>

    <div class="card">
      <div class="hd"><h3>${tx('รอบบิลตามสัญญา')}</h3></div>
      <div class="bd flush"><div class="tw"><table style="min-width:820px">
        <thead><tr>
          <th>${tx('รอบบิล')}</th><th style="width:150px">Timesheet</th>
          <th style="width:180px">${tx('สถานะ')}</th><th style="width:230px">${tx('กำหนดเวลา')}</th>
          <th class="r" style="width:140px">${tx('มูลค่า')}</th>
        </tr></thead>
        <tbody>${(contract?.periods ?? []).map((c) => cycleRow(c)).join('')
          || `<tr><td colspan="5" class="empty">${tx('ยังไม่มีสัญญาในระบบ')}</td></tr>`}</tbody>
      </table></div></div>
    </div>
  </div>`;

  bindRows();
  main.querySelectorAll('[data-task]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const link = data.tasks[Number(btn.dataset.task)]?.link;
      if (!link) return;
      if (link.view === 'detail') openSheet(link.id);
      else openCycle(link.contractId, link.period);
    });
  });
}

function bindRows() {
  main.querySelectorAll('[data-cycle]').forEach((row) => {
    row.addEventListener('click', () => {
      const [contractId, period] = row.dataset.cycle.split('|');
      openCycle(contractId, period);
    });
  });
  main.querySelectorAll('[data-go]').forEach((node) => {
    const go = () => setNav(node.dataset.go);
    node.addEventListener('click', go);
    node.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
    });
  });
}

/** แถวรอบบิลตามสัญญา */
function cycleRow(c, { showCustomer = false } = {}) {
  const urgent = c.overdueToBill || c.overduePayment;
  return `
  <tr class="rw ${urgent ? 'urgent' : ''}" data-cycle="${esc(c.contractId)}|${esc(c.period)}">
    <td><span class="docid">${esc(c.periodLabel)}</span>
        <span class="sub">${showCustomer ? `${esc(c.customerName)} · ` : ''}${esc(c.poNo)}</span></td>
    <td class="n">${c.received} / ${c.expected}
        ${c.missing.length
          ? `<span class="sub" title="${esc(c.missing.join(', '))}">${tx('รอ')} ${esc(c.missing.map(firstName).join(', '))}</span>`
          : c.uncheckedCount
            ? `<span class="sub">${tx('รอคนยืนยัน')} ${int(c.uncheckedCount)} ${tx('ใบ')}</span>`
            : ''}</td>
    <td><span class="st ${CYCLE_STATE_CLASS[c.state]}">${tx(c.stateLabel)}</span>
        ${c.invoiceNo ? `<span class="sub">${esc(c.invoiceNo)}</span>` : ''}</td>
    <td>${c.state === 'billed'
        ? (c.overduePayment ? `<span class="tg cr">${tx('เกินกำหนด')}</span>` : `<span class="tg ok">${tx('ตรงเวลา')}</span>`)
        : (c.overdueToBill ? `<span class="tg wn">${tx('เลยกำหนดวางบิล')}</span>` : '')}</td>
    <td class="r n">${c.value ? money(c.value) : ''}</td>
  </tr>`;
}



/* โหมด manual: ใบที่เครื่องตรวจผ่านแล้วแต่ยังไม่มีคนกดยืนยัน ก็ยังเป็นงานค้างของคน
   ต่างจากโหมด auto ที่ใบตรวจผ่านไหลไปเองโดยไม่ต้องมีใครแตะ */
const needsHuman = (t) =>
  ['mismatch', 'received', 'extracted'].includes(t.status) ||
  (t.status === 'verified' && !t.check?.checked);

const QUEUE_FILTERS = {
  action: { label: 'ต้องตรวจ', test: needsHuman },
  checked: { label: 'ยืนยันแล้ว', test: (t) => t.check?.checked && t.status !== 'billed' },
  all: { label: 'ทั้งหมด', test: () => true },
  billed: { label: 'วางบิลแล้ว', test: (t) => t.status === 'billed' },
  rejected: { label: 'ตีกลับ', test: (t) => t.status === 'rejected' },
};

/** อักษรย่อจากชื่อ — ใช้เป็นตราหน้าการ์ด */
function initials(name) {
  const parts = String(name ?? '').trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] ?? '') + (parts[1][0] ?? '');
  return (parts[0] ?? '?').slice(0, 2);
}

const AVA_TONE = { verified: 'g', mismatch: 'c', billed: 'g', rejected: '', received: '', extracted: '' };
const PAGE_SIZE = 6;

/** ชื่อต้นของคนไทย — ใช้ในคอลัมน์แคบที่ใส่ชื่อเต็มไม่พอ */
function firstName(full) {
  return String(full ?? '').trim().split(/\s+/)[0];
}

/** การ์ด Timesheet — มีตารางย่อยสรุปการคำนวณในตัว */
function sheetCard(t) {
  const flagged = t.status === 'mismatch';
  const failures = (t.checks ?? []).filter((c) => c.severity === 'fail');

  return `
  <div class="rec ${flagged ? 'flag' : ''}" data-sheet="${esc(t.id)}">
    <div class="rec-hd">
      <span class="ava ${AVA_TONE[t.status] ?? ''}">${esc(initials(t.employee.nameTh))}</span>
      <span>
        <span class="nm2">${esc(t.employee.nameTh)}</span>
        <span class="mt2">${esc(t.employee.invoicePosition ?? '—')}</span>
      </span>
      <span class="rt2">
        <span class="st ${STATUS_CLASS[t.status] ?? 'mu'}">${tx(t.statusLabel)}</span>
      </span>
    </div>

    <div class="rec-tags">
      <span class="tag">${esc(t.periodLabel)}</span>
      <span class="tag">${tx('เลขที่')} ${esc(t.id)}</span>
      ${t.reportedLeave ? `<span class="tag lv">${tx('ลา')} ${int(t.reportedLeave)} ${tx('วัน')}</span>` : ''}
      ${t.check?.checked ? `<span class="tag ok">${icon('chk')} ${tx('ยืนยันแล้ว')}</span>` : ''}
      ${t.check?.stale ? `<span class="tag lv">${tx('ยอดเปลี่ยน ต้องยืนยันใหม่')}</span>` : ''}
      ${t.invoiceNo ? `<span class="tag ok">${esc(t.invoiceNo)}</span>` : ''}
    </div>
    <div class="rec-when">${tx('รับเมื่อ')} ${dt(t.receivedAt)}</div>

    <div class="minitab">
      <div class="mh2"><span>${tx('รายการคำนวณ')}</span><span class="q">${tx('จำนวน')}</span><span class="p">${tx('บาท')}</span></div>
      <div class="mr">
        <span class="lb2">${tx('เรทค่าบริการต่อเดือน')}</span>
        <span class="q">1 ${tx('เดือน')}</span>
        <span class="p">${money(t.employee.monthlyRate)}</span>
      </div>
      <div class="mr">
        <span class="lb2">${tx('วันทำงานที่วางบิลได้')}<small>${tx('ตาม Timesheet')} ${int(t.reportedWorkDays)} ${tx('วัน')}</small></span>
        <span class="q">${int(t.payableDays)} ${tx('วัน')}</span>
        <span class="p">—</span>
      </div>
      ${t.reportedLeave
        ? `<div class="mr neg">
             <span class="lb2">${tx('ส่วนลดวันลา')}<small>${tx('ลา')} ${int(t.reportedLeave)} ${tx('วัน')}</small></span>
             <span class="q">${int(t.reportedLeave)} ${tx('วัน')}</span>
             <span class="p">−${money(t.discount)}</span>
           </div>`
        : `<div class="mr"><span class="lb2">${tx('ส่วนลดวันลา')}<small>${tx('ไม่มีวันลา')}</small></span>
             <span class="q">0 ${tx('วัน')}</span><span class="p">—</span></div>`}
    </div>

    <div class="rec-total">
      <span class="tl">${tx('ยอดที่วางบิลได้')}</span>
      <span class="tv">${money(t.lineAmount)}</span>
    </div>

    ${failures.length
      ? `<div class="note cr" style="margin:0">${icon('alt')}<span>${esc(failures.map((f) => f.title).join(' · '))}</span></div>`
      : t.statusReason
        ? `<div class="note wn" style="margin:0">${icon('alt')}<span>${esc(t.statusReason)}</span></div>`
        : ''}

    <div class="rec-acts ${t.status === 'billed' ? 'one' : ''}">
      <button class="btn pri" data-open="${esc(t.id)}">${icon('file')} ${tx('เปิดตรวจ')}</button>
      ${t.status === 'billed' ? '' : `<button class="btn dgr" data-reject="${esc(t.id)}">${tx('ตีกลับ')}</button>`}
    </div>
  </div>`;
}

function matchesSearch(t, term) {
  if (!term) return true;
  const q = term.toLowerCase();
  return [
    t.id, t.employee.nameTh, t.employee.nameEn, t.employee.invoicePosition,
    t.rawPosition, t.periodLabel, t.period, t.invoiceNo, t.statusLabel,
  ].some((v) => String(v ?? '').toLowerCase().includes(q));
}

const SORTS = {
  recent: { label: 'รับล่าสุด', cmp: (a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)) },
  amount: { label: 'ยอดสูงสุด', cmp: (a, b) => (b.lineAmount ?? 0) - (a.lineAmount ?? 0) },
  urgent: { label: 'ต้องแก้ก่อน', cmp: (a, b) => URGENCY[a.status] - URGENCY[b.status] },
  name: { label: 'ชื่อพนักงาน', cmp: (a, b) => a.employee.nameTh.localeCompare(b.employee.nameTh, 'th') },
  period: { label: 'รอบบิล', cmp: (a, b) => String(b.period).localeCompare(String(a.period)) },
};
const URGENCY = { mismatch: 0, verified: 1, received: 2, extracted: 3, rejected: 4, billed: 5, approved: 2 };


async function renderQueue() {
  const sheets = await api(`/timesheets${contractQuery()}`);

  const byFilter = sheets.filter(QUEUE_FILTERS[state.queueFilter].test);
  const found = byFilter
    .filter((t) => matchesSearch(t, state.queueSearch))
    .sort(SORTS[state.queueSort].cmp);

  const pages = Math.max(1, Math.ceil(found.length / PAGE_SIZE));
  if (state.queuePage > pages) state.queuePage = 1;
  const start = (state.queuePage - 1) * PAGE_SIZE;
  const shown = found.slice(start, start + PAGE_SIZE);

  main.innerHTML = `
  <div class="page">
    <div class="phd"><div><span class="ey">${tx('ขั้นที่ 2 จาก 4')}</span><h1>${tx('ตรวจ Manday')}</h1></div></div>

    <div class="card">
      <div class="filterbar">
        <div class="pills">
          ${Object.entries(QUEUE_FILTERS).map(([key, f]) => `
            <button class="pbtn ${state.queueFilter === key ? 'on' : ''}" data-filter="${key}">
              ${tx(f.label)}<span class="c">${byFilter === null ? 0 : sheets.filter(f.test).length}</span></button>`).join('')}
        </div>
        <div class="gap"></div>
        <span class="selectwrap">
          <span class="lb3">${tx('เรียงตาม')}</span>
          <span class="selectchip">
            <select id="qSort">
              ${Object.entries(SORTS).map(([key, s]) =>
                `<option value="${key}" ${state.queueSort === key ? 'selected' : ''}>${tx(s.label)}</option>`).join('')}
            </select>
            ${icon('cd')}
          </span>
        </span>
        <label class="searchbox">
          ${icon('srch')}
          <input type="search" id="qSearch" placeholder="${tx('ค้นหาชื่อ เลขเอกสาร ตำแหน่ง รอบบิล…')}"
                 value="${esc(state.queueSearch)}" autocomplete="off">
        </label>
        <button class="iconbtn ${state.queueSearch ? 'on' : ''}" id="clearSearch"
                title="${state.queueSearch ? tx('ล้างคำค้น') : tx('ตัวกรอง')}">
          ${icon(state.queueSearch ? 'cl' : 'flt')}
        </button>
      </div>

      ${shown.length
        ? `<div class="cardgrid">${shown.map(sheetCard).join('')}</div>`
        : `<div class="empty">${icon('inbox', 'i')}<div>${state.queueSearch
            ? `${tx('ไม่พบรายการที่ตรงกับ')} "${esc(state.queueSearch)}"`
            : state.queueFilter === 'action'
              ? tx('ไม่มีใบที่รอตรวจ — ทุกใบมีคนยืนยันแล้ว ไปต่อที่ขั้น 3 วางบิล')
              : tx('ไม่มีรายการในหมวดนี้')}</div></div>`}

      <div class="pager">
        <span class="info">${found.length
          ? `${tx('แสดง')} ${start + 1}–${Math.min(start + PAGE_SIZE, found.length)} ${tx('จาก')} ${found.length} ${tx('รายการ')}`
          : tx('ไม่มีรายการ')}${state.queueSearch ? ` · ${tx('กรองจาก')} ${byFilter.length} ${tx('รายการ')}` : ''}</span>
        <div class="gap"></div>
        <div class="pgn">
          <button data-page="${state.queuePage - 1}" ${state.queuePage === 1 ? 'disabled' : ''}
                  aria-label="${tx('ก่อนหน้า')}">${icon('cl')}</button>
          ${Array.from({ length: pages }, (_, i) => `
            <button data-page="${i + 1}" class="${state.queuePage === i + 1 ? 'on' : ''}">${i + 1}</button>`).join('')}
          <button data-page="${state.queuePage + 1}" ${state.queuePage === pages ? 'disabled' : ''}
                  aria-label="${tx('ถัดไป')}">${icon('cr')}</button>
        </div>
      </div>
    </div>
  </div>`;

  main.querySelectorAll('[data-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.queueFilter = btn.dataset.filter;
      state.queuePage = 1;
      renderQueue();
    });
  });

  main.querySelectorAll('[data-page]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const page = Number(btn.dataset.page);
      if (page < 1 || page > pages) return;
      state.queuePage = page;
      renderQueue();
    });
  });

  // ค้นหาแบบพิมพ์แล้วกรองทันที รักษาตำแหน่งเคอร์เซอร์ไว้
  const search = el('qSearch');
  search.addEventListener('input', () => {
    state.queueSearch = search.value;
    state.queuePage = 1;
    clearTimeout(search._t);
    search._t = setTimeout(async () => {
      await renderQueue();
      const next = el('qSearch');
      next.focus();
      next.setSelectionRange(next.value.length, next.value.length);
    }, 220);
  });

  el('clearSearch').addEventListener('click', () => {
    if (!state.queueSearch) return;
    state.queueSearch = '';
    state.queuePage = 1;
    renderQueue();
  });

  el('qSort').addEventListener('change', (e) => {
    state.queueSort = e.target.value;
    state.queuePage = 1;
    renderQueue();
  });

  // คลิกแถวเพื่อกาง/พับรายละเอียด
  main.querySelectorAll('[data-row]').forEach((row) => {
    row.addEventListener('click', () => {
      state.expanded = state.expanded === row.dataset.row ? null : row.dataset.row;
      renderQueue();
    });
  });

  main.querySelectorAll('[data-open]').forEach((btn) => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); openSheet(btn.dataset.open); });
  });

  main.querySelectorAll('[data-recompute]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        const r = await api(`/timesheets/${encodeURIComponent(btn.dataset.recompute)}/recompute`, { method: 'POST' });
        toast(`${tx('คำนวณใหม่แล้ว — วางบิลได้')} ${r.payableDays} ${tx('วัน ส่วนลด')} ${money(r.discount)} ${tx('บาท')}`);
        renderQueue();
      } catch (error) { toast(error.message, true); }
    });
  });

  main.querySelectorAll('[data-reject]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const reason = await promptModal({
        title: tx('ตีกลับให้แก้ Timesheet'), placeholder: tx('เหตุผลที่ตีกลับ…'), confirmLabel: tx('ตีกลับ'),
      });
      if (!reason) return;
      try {
        await api(`/timesheets/${encodeURIComponent(btn.dataset.reject)}/reject`, {
          method: 'POST', body: JSON.stringify({ reason }),
        });
        toast(tx('ตีกลับเรียบร้อย'));
        renderQueue();
      } catch (error) { toast(error.message, true); }
    });
  });
}

// ── รายละเอียด Timesheet ────────────────────────────────────

const DOW = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

/* ไอคอน+ป้ายต่อวันในปฏิทิน ทำตามแบบปฏิทิน HRDD เป๊ะๆ ตามที่ขอ: ไอคอนสีอยู่มุมขวาบนของวันนั้นๆ
   (แถวเดียวกับเลขวันที่ ไม่ใช่วางไว้ใต้เลขวันแบบเดิม), วันหยุดขึ้นแบนเนอร์เต็มความกว้างใต้เลขวันที่
   (แบบเดียวกับที่ HRDD ทำกับวันหยุดนักขัตฤกษ์), เสาร์-อาทิตย์ไม่มีป้ายเลย — ไอคอน/สีตรงตามที่ขอเป๊ะๆ:
   บ้าน=เขียวอ่อน (ทำงาน), หัวใจ=แดงอ่อน (ลาป่วย), รถ=ชมพูอ่อน (ลากิจ), จรวด=ส้มอ่อน (ลาพักร้อน)
   โทนอ่อนทั้งหมดตามที่ขอ "สีไม่เข้ม ขอสีน่ารักๆ"

   ระบบนี้ไม่มีข้อมูลตำแหน่งงาน (WFH/Onsite) เหมือน HRDD เพราะเป็นระบบคำนวณ Manday ไม่ใช่ระบบเช็คชื่อ
   เข้า-ออกงาน จึงให้ไอคอน "บ้าน" ตัวเดียวแทนวันทำงานทุกวัน ไม่แยก WFH/Onsite เพราะไม่มีข้อมูลจริงรองรับ
   ว่าวันไหนทำงานที่บ้านหรือเข้าออฟฟิศ — ไม่ใส่ข้อมูลปลอมๆที่ไม่มีจริงเข้าไป */
const LEAVE_ICON = { sick: 'sickface', personal: 'idcard', vacation: 'plane', unpaid: 'cal' };

/** ป้ายกำกับ "ประเภท" สองภาษา ใช้ทั้งในปฏิทิน (title ของไอคอน) และตารางรายละเอียดรายวัน (27 ส.ค. 69
 * ตามที่ขอเป๊ะๆ "Sick Leave"/"Vacation Leave") — ใช้ dayTypeText() อ่านค่าแทน tx() เพราะปุ่มสลับภาษา
 * ไม่ผูกกับ T{} ตัวเดียวกับที่จุดอื่นในหน้าใช้ (คีย์ 'วันหยุด' ของ T{} มีความหมายอื่นอยู่แล้วที่นั่น) */
const DAY_TYPE_LABEL = {
  work: { th: 'ทำงาน', en: 'Working' },
  weekend: { th: 'วันหยุด', en: 'Weekend' },
  holiday: { th: 'วันหยุดนักขัตฤกษ์', en: 'Public Holiday' },
  sick: { th: 'ลาป่วย', en: 'Sick Leave' },
  personal: { th: 'ลากิจ', en: 'Personal Leave' },
  vacation: { th: 'ลาพักร้อน', en: 'Vacation Leave' },
  unpaid: { th: 'ลาไม่รับค่าจ้าง', en: 'Unpaid Leave' },
};
const dayTypeText = (key) => DAY_TYPE_LABEL[key]?.[state.lang === 'en' ? 'en' : 'th'] ?? key;

/** ตัด "ข้อความซ้ำตัวเอง" ทิ้ง เช่น "Vacation Leave Vacation Leave" → "Vacation Leave" (27 ส.ค. 69) —
 * เอกสารที่รับเข้าระบบก่อนแก้จุดนี้ที่ src/extract/abbyy.js ยังมีข้อความซ้ำค้างอยู่ในฐานข้อมูลเดิม
 * (ไม่รื้ออ่านไฟล์ใหม่ทุกใบ) จึงกรองซ้ำอีกชั้นตอนแสดงผลด้วย ให้ใช้ได้ทันทีกับของเก่าที่ยืนยันไปแล้ว */
function dedupeRepeatedText(text) {
  const s = String(text ?? '').trim();
  if (!s) return text;
  const words = s.split(/\s+/);
  if (words.length < 2 || words.length % 2 !== 0) return s;
  const half = words.length / 2;
  const first = words.slice(0, half).join(' ');
  const second = words.slice(half).join(' ');
  return first.toLowerCase() === second.toLowerCase() ? first : s;
}

/** โทนสี+ป้ายของ "ประเภท" ในตารางรายละเอียดรายวัน (27 ส.ค. 69) — เดาโทนจากคำในข้อความ ไม่ยึดว่าต้องเป็น
 * ค่าคงที่ตายตัว เพราะ ABBYY แต่ละ Skill ใช้คำไม่เหมือนกัน (Working/Public Holiday/Vacation Leave ฯลฯ)
 * แต่ป้ายที่โชว์ผลใช้ DAY_TYPE_LABEL คงที่เสมอ ไม่ใช่ข้อความดิบจาก ABBYY จะได้แปลภาษาได้ */
function dayTypeInfo(type) {
  const t = String(type ?? '').toLowerCase();
  if (/holiday|หยุด/.test(t)) return { tone: 'dt-holiday', label: dayTypeText('holiday') };
  if (/weekend|เสาร์|อาทิตย์/.test(t)) return { tone: 'dt-weekend', label: dayTypeText('weekend') };
  if (/leave|ลา|sick|vacation|personal|annual|absent/.test(t)) return { tone: 'wn', label: type ?? '—' };
  if (/work|ทำงาน/.test(t)) return { tone: 'dt-work', label: dayTypeText('work') };
  return { tone: 'mu', label: type ?? '—' };
}

/** ฟอร์แมตชั่วโมงในตารางรายละเอียดรายวัน — ทศนิยม 2 ตำแหน่ง, "—" ถ้าไม่มีข้อมูล (ไม่ใช่ "0.00"
 * เพราะ "ไม่มีข้อมูล" กับ "ศูนย์ชั่วโมงจริงๆ" ความหมายต่างกัน คนอ่านต้องแยกออก) */
function hoursCell(value) {
  return value === null || value === undefined ? '—' : Number(value).toFixed(2);
}

/** รวมชั่วโมงทั้งเดือนต่อคอลัมน์ (ไว้ทำแถวรวมท้ายตาราง) — ข้ามแถวที่เป็น null (ไม่มีข้อมูล ไม่ใช่ศูนย์) */
function sumHours(days, key) {
  const values = days.map((d) => d[key]).filter((v) => v !== null && v !== undefined);
  return values.length ? values.reduce((sum, v) => sum + Number(v), 0) : null;
}

/** ราคาก่อน–หลังหัก VAT ของรายการนี้ (27 ส.ค. 69) — ตัวเลขคำนวณสดจากยอดรายการ+อัตราของสัญญานี้
 * เพื่อดูตัวเลขเบื้องต้นได้ทันทีในหน้าตรวจ Manday ยอดจริงที่ยิงเข้า FlowAccount รวมทุกรายการของ
 * รอบบิลเดียวกันคำนวณอีกทีตอนวางบิล (ดู buildInvoice() ที่ src/domain/invoice.js) อาจต่างกันเล็กน้อย
 * จากการปัดเศษเมื่อรวมหลายรายการเข้าด้วยกัน */
function vatBreakdownHtml(manday, contract) {
  const base = Number(manday?.lineAmount);
  if (!Number.isFinite(base)) return '';
  const vatRate = contract?.vatRate ?? 0.07;
  const whtRate = contract?.whtRate ?? 0.03;
  const vat = Math.round(base * vatRate * 100) / 100;
  const grand = Math.round((base + vat) * 100) / 100;
  const wht = Math.round(base * whtRate * 100) / 100;
  const net = Math.round((grand - wht) * 100) / 100;
  return `<div class="bd" style="padding-top:0">
    <div class="fsec-h" style="margin:8px 0 4px"><b>${tx('ราคาก่อน–หลังหัก VAT')}</b></div>
    <div class="tot">
      <div class="t"><span>${tx('รวมเป็นเงิน (ก่อน VAT)')}</span><span class="v">${money(base)}</span></div>
      <div class="t"><span>${tx('ภาษีมูลค่าเพิ่ม')} ${Math.round(vatRate * 100)}%</span><span class="v">${money(vat)}</span></div>
      <div class="t gr"><span>${tx('รวมทั้งสิ้น (หลัง VAT)')}</span><span class="v">${money(grand)}</span></div>
      <div class="t mi"><span>${tx('หักภาษี ณ ที่จ่าย')} ${Math.round(whtRate * 100)}%</span><span class="v">−${money(wht)}</span></div>
      <div class="t py"><span>${tx('ยอดรับชำระสุทธิ')}</span><span class="v">${money(net)}</span></div>
    </div>
  </div>`;
}

function calendarHtml(manday) {
  if (!manday?.calendar) return `<div class="empty">${tx('ยังไม่ได้คำนวณ')}</div>`;
  const { days } = manday.calendar;
  // ปฏิทินเริ่มวันอาทิตย์: getUTCDay() 0=อาทิตย์ ตรงกับคอลัมน์แรกพอดี ไม่ต้องเลื่อน
  const firstCol = days[0].dayOfWeek;
  const leaveByDate = new Map(manday.leaveDays.map((l) => [l.date, l.type]));

  // คลิกวันที่ในปฏิทินได้ (27 ส.ค. 69 ตามที่ขอ "ทำปฏิทินให้สวยๆ") — ใช้ดูรายละเอียดวันนั้นในการ์ด
  // "รายละเอียดวันที่เลือก" ข้างๆ ดูตัว sel/data-date ด้านล่าง กับ dayDetailHtml() ที่ประกอบการ์ดนั้น
  const cells = [
    ...Array.from({ length: firstCol }, () => '<div class="cl vd"></div>'),
    ...days.map((d) => {
      const sel = d.date === state.calDay ? ' sel' : '';
      if (d.kind === 'holiday') {
        return `<div class="cl holiday${sel}" data-date="${d.date}"><span class="dn">${d.day}</span>
          <span class="dbanner">${icon('gift', 'i xs')}${esc(d.label ?? dayTypeText('holiday'))}</span></div>`;
      }
      // เสาร์-อาทิตย์ไม่มีป้ายเลย เหมือน HRDD เป๊ะๆ — คอลัมน์ก็บอกอยู่แล้วว่าเป็นวันไหน
      if (d.kind === 'weekend') return `<div class="cl weekend${sel}" data-date="${d.date}"><span class="dn">${d.day}</span></div>`;
      if (d.kind === 'leave') {
        const leaveType = leaveByDate.get(d.date) ?? 'unpaid';
        return `<div class="cl lv-${leaveType}${sel}" data-date="${d.date}"><span class="dn">${d.day}</span>
          <span class="dbadge lv-${leaveType}" title="${esc(dayTypeText(leaveType))}">${icon(LEAVE_ICON[leaveType] ?? 'cal', 'i sm')}</span></div>`;
      }
      return `<div class="cl workday${sel}" data-date="${d.date}"><span class="dn">${d.day}</span>
        <span class="dbadge workday" title="${dayTypeText('work')}">${icon('monitor', 'i sm')}</span></div>`;
    }),
  ];
  // เติมช่องว่างท้ายแถวสุดท้ายด้วย .cl.vd เหมือนกับช่องว่างต้นเดือน (28 ส.ค. 69 ตามที่ขอ "ไม่มีวันที่
  // พื้นที่เหลือก็สีขาว ไม่เอาสีเทา") — ไม่งั้นช่องว่างท้ายแถวจะไม่มี element มาคลุม โผล่พื้นเทาของ
  // คอนเทนเนอร์ .cal ให้เห็น (สีเทานั้นคือเส้นตารางที่ตั้งใจไว้ ไม่ใช่พื้นที่ว่าง)
  const trailing = (7 - ((firstCol + days.length) % 7)) % 7;
  cells.push(...Array.from({ length: trailing }, () => '<div class="cl vd"></div>'));

  return `
    <div class="cal">
      ${DOW.map((d) => `<div class="dw">${tx(d)}</div>`).join('')}
      ${cells.join('')}
    </div>
    <div class="cal-legend">
      <span class="legend-item workday">${icon('monitor', 'i lg')}${tx('ทำงาน')}</span>
      <span class="legend-item holiday">${tx('วันหยุด')}</span>
      <span class="legend-item sick">${icon('sickface', 'i lg')}${tx('ลาป่วย')}</span>
      <span class="legend-item personal">${icon('idcard', 'i lg')}${tx('ลากิจ')}</span>
      <span class="legend-item vacation">${icon('plane', 'i lg')}${tx('ลาพักร้อน')}</span>
      <span class="cal-legend-mu">${tx('เสาร์–อาทิตย์ไม่มีป้าย')}</span>
    </div>`;
}

/** การ์ด "รายละเอียดวันที่เลือก" ข้างปฏิทิน (27 ส.ค. 69 ตามที่ขอ "ทำปฏิทินให้สวยๆ") — โชว์ตอนคลิกวันที่
 * ในปฏิทิน ดึงจากแถวเดียวกับตารางรายละเอียดรายวัน (sheet.dayLabels) ให้ตรงกันเป๊ะ ไม่เดาใหม่จาก
 * manday.calendar.days ซ้ำเพราะตัวนั้นมีแค่ kind/นับจำนวน ไม่มีเวลาเข้า-ออก/โปรเจกต์/รายละเอียดงาน */
function dayDetailHtml(date, sheet, manday) {
  if (!date) return `<div class="empty">${tx('คลิกวันที่ในปฏิทินเพื่อดูรายละเอียดวันนั้น')}</div>`;
  const d = sheet.dayLabels.find((r) => r.date === date);
  const calDay = manday?.calendar?.days?.find((c) => c.date === date);
  const leaveType = new Map((manday?.leaveDays ?? []).map((l) => [l.date, l.type])).get(date);
  const fallbackType = calDay?.kind === 'weekend' ? 'Weekend'
    : calDay?.kind === 'holiday' ? 'Holiday' : calDay?.kind === 'workday' ? 'Working' : '';
  const info = leaveType ? { tone: `lv-${leaveType}`, label: dayTypeText(leaveType) } : dayTypeInfo(d?.type ?? fallbackType);
  // วันหยุดนักขัตฤกษ์โชว์ชื่อวันหยุดจริงจากปฏิทินวันหยุดของลูกค้า (calDay.label — แหล่งเดียวกับ
  // แบนเนอร์ในตัวปฏิทินเอง) แทนข้อความทั่วไปจาก Timesheet เช่น "Public Holiday" เฉยๆ (28 ส.ค. 69
  // ตามที่ขอ "อยากให้ขึ้นด้วยว่าเป็นวันอะไร")
  const note = calDay?.kind === 'holiday' && calDay?.label
    ? calDay.label
    : d?.job_desc || d?.remark ? dedupeRepeatedText(d.job_desc ?? d.remark) : null;
  // ชื่อวันเต็ม (จันทร์/อังคาร/.../Monday/Tuesday) ใต้วันที่ — คำนวณสดจากวันที่ตรงๆ ไม่พึ่ง day_of_week
  // แบบย่อที่ ABBYY อ่านมา (เช่น "Mon") เพื่อให้ได้ชื่อเต็มสวยๆ ตามภาษาที่กำลังแสดงอยู่ (28 ส.ค. 69)
  const dow = new Date(`${date}T00:00:00`).toLocaleDateString(state.lang === 'en' ? 'en-US' : 'th-TH', { weekday: 'long' });
  return `
    <div class="daydetail">
      <div class="ddhd">
        <span class="ddhd-l"><span class="ddate">${esc(dateOnly(date))}</span><span class="ddow">${esc(dow)}</span></span>
        <span class="tg ${info.tone}">${esc(info.label)}</span>
      </div>
      ${d?.time_in && d?.time_out ? `
      <div class="dd-times">
        <div class="dd-time-box"><span class="ic">${icon('signin', 'i sm')}</span><span class="lbl">${tx('เข้างาน')}</span><span class="val">${esc(d.time_in)}</span></div>
        <div class="dd-time-box"><span class="ic">${icon('signout', 'i sm')}</span><span class="lbl">${tx('ออกงาน')}</span><span class="val">${esc(d.time_out)}</span></div>
      </div>` : ''}
      <dl class="kv">
        ${d?.ot_time_in && d?.ot_time_out ? `<dt>${tx('เวลา OT')}</dt><dd class="n">${esc(d.ot_time_in)} – ${esc(d.ot_time_out)}</dd>` : ''}
        ${d?.project ? `<dt>${tx('โครงการ')}</dt><dd>${esc(d.project)}</dd>` : ''}
        ${d?.total_hours !== null && d?.total_hours !== undefined ? `<dt>${tx('รวม/วัน')}</dt><dd class="n">${hoursCell(d.total_hours)}</dd>` : ''}
      </dl>
      ${note ? `<div class="rmk">${esc(note)}</div>` : ''}
    </div>`;
}

async function openSheet(id) {
  // เปิดใบใหม่ (id ต่างจากที่ค้างอยู่) ค่อยรีเซ็ตกลับแท็บ "ภาพรวม" — ถ้าเป็นใบเดิม (เรียกซ้ำจาก
  // สลับภาษา/กด "คำนวณใหม่"/ยืนยันตรวจแล้ว) คงแท็บที่กำลังดูอยู่ไว้ ไม่งั้นสลับภาษาแล้วเด้งกลับ
  // แท็บแรกทุกครั้ง ทั้งที่กำลังดูแท็บ "รายละเอียด"/"ปฏิทิน" อยู่ (27 ส.ค. 69 ตามที่ขอ)
  if (state.detailId !== id) { state.tab = 1; state.calDay = null; }
  state.view = 'detail';
  state.detailId = id;
  markTab('detail');

  main.innerHTML = '<div class="loading">กำลังโหลด…</div>';
  syncBadges();
  const sheet = await api(`/timesheets/${encodeURIComponent(id)}`);
  const manday = sheet.manday;
  const dayCounts = manday?.calendar?.counts ?? { workday: 0, leave: 0, holiday: 0, weekend: 0 };
  // สรุปประจำเดือนขอให้แยกวันลาแต่ละประเภทแทนยอดรวม "ลา" อันเดียว ("ขอให้มีครบทุกสถานะ")
  const leaveCounts = { sick: 0, personal: 0, vacation: 0, unpaid: 0 };
  for (const l of manday?.leaveDays ?? []) leaveCounts[l.type] = (leaveCounts[l.type] ?? 0) + 1;
  // ตารางรายละเอียดรายวันใช้ประเภทวันลาที่ classifyLeaveType() ตัดสินไว้แล้วจากตัวนี้ (แม่นกว่าเดาจาก
  // ข้อความ type/label ในตารางเอง) ให้สีป้ายตรงกับไอคอนในแท็บปฏิทินเป๊ะ — ดู leaveTypeByDate ด้านล่าง
  const leaveTypeByDate = new Map((manday?.leaveDays ?? []).map((l) => [l.date, l.type]));
  // ชื่อวันหยุดนักขัตฤกษ์จริง (เช่น "วันแรงงานแห่งชาติ") จากปฏิทินวันหยุดของบริษัทนี้ — ใช้แทนคำว่า
  // "Public Holiday" เฉยๆที่ ABBYY อ่านมาจาก Timesheet เอง เพราะวันที่เป็นตัวบอกที่แม่นกว่าเสมอสำหรับ
  // วันหยุดราชการ (Timesheet ต้นฉบับมักเขียนกำกวมแค่ "Holiday" ไม่บอกว่าเป็นวันหยุดอะไร) (28 ส.ค. 69)
  const holidayLabelByDate = new Map(
    (manday?.calendar?.days ?? []).filter((d) => d.kind === 'holiday').map((d) => [d.date, d.label]),
  );
  const failures = (manday?.checks ?? []).filter((c) => c.severity === 'fail');
  const step = sheet.status === 'billed' ? 4
    : failures.length || !sheet.check?.checked ? 2
    : 3;

  main.innerHTML = `
  <div class="page">
    <button class="back" id="backBtn">${icon('cl')} ${tx('กลับไปกล่องงาน')}</button>

    <div class="phd">
      <div>
        <span class="ey">Timesheet ${esc(sheet.id)} · ${tx('รอบบิล')} ${esc(sheet.periodLabel)}</span>
        <h1>${esc(sheet.employee.nameTh)} — ${esc(sheet.employee.invoicePosition ?? '')}</h1>
        <p>${esc(sheet.contract.customerName)} · ${tx('โครงการ')} ${esc(sheet.contract.projectName)}
           · ${tx('ใบว่าจ้าง')} ${esc(sheet.contract.poNo)} · ${tx('สัญญา')} ${esc(sheet.contract.contractNo ?? '—')}</p>
      </div>
      <div class="acts">
        <button class="btn" id="recomputeBtn">${icon('rf')} ${tx('คำนวณใหม่')}</button>
      </div>
    </div>

    <div class="prog">
      <div class="pstep dn">
        <span class="cir">${icon('chk')}</span>
        <span class="cap">Step 01</span>
        <span class="pl">${tx('อัปโหลด · ระบบอ่านไฟล์')}</span>
      </div>
      <div class="pline dn"></div>
      <div class="pstep ${step >= 3 ? 'dn' : 'cu'}">
        <span class="cir">${step >= 3 ? icon('chk') : icon('list-chk')}</span>
        <span class="cap">Step 02</span>
        <span class="pl">${tx('ตรวจ Manday · คนยืนยัน')}</span>
      </div>
      <div class="pline ${step >= 3 ? 'dn' : ''}"></div>
      <div class="pstep ${step === 3 ? 'cu' : step > 3 ? 'dn' : ''}">
        <span class="cir">${step > 3 ? icon('chk') : icon('money')}</span>
        <span class="cap">Step 03</span>
        <span class="pl">${tx('วางบิล FlowAccount')}</span>
      </div>
      <div class="pline ${step > 3 ? 'dn' : ''}"></div>
      <div class="pstep ${step === 4 ? 'cu' : ''}">
        <span class="cir">${icon('mail')}</span>
        <span class="cap">Step 04</span>
        <span class="pl">${tx('ร่างอีเมลถึงลูกค้า')}</span>
      </div>
    </div>

    <div class="tabs" role="tablist">
      ${['ภาพรวม', 'รายละเอียด', 'ปฏิทิน'].map((label, i) =>
        `<button class="tab ${state.tab === i + 1 ? 'on' : ''}" data-tab="${i + 1}">${tx(label)}</button>`).join('')}
    </div>

    <!-- ภาพรวม -->
    <div class="tp ${state.tab === 1 ? 'on' : ''}" data-pane="1">
      <div class="g3">
        <div>
          <div class="card">
            <div class="hd"><h3>${tx('สรุปรายการที่จะวางบิล')}</h3></div>
            <div class="bd flush"><table class="ldg"><tbody>
              <tr><td>${tx('เรทค่าบริการต่อเดือนตามใบว่าจ้าง')}</td><td class="r">${money(manday?.monthlyRate)}</td></tr>
              <tr><td>${tx('วันทำงานของเดือน')}<span class="sub">${tx('หักเสาร์–อาทิตย์ และวันหยุดแล้ว')}</span></td><td class="r">${int(manday?.standardWorkingDays)} ${tx('วัน')}</td></tr>
              <tr><td>${tx('ทำงานจริงตาม Timesheet')}</td><td class="r">${int(sheet.reportedWorkDays)} ${tx('วัน')}</td></tr>
              <tr><td>${tx('วันลา')}</td><td class="r">${int(manday?.leaveCount)} ${tx('วัน')}</td></tr>
              <tr><td>${tx('อัตราต่อวัน')}<span class="sub">${money(manday?.monthlyRate)} ÷ ${int(manday?.divisor?.applied)}</span></td><td class="r">${money(manday?.dailyRate)}</td></tr>
              <tr class="res"><td>${tx('ส่วนลดวันลา')}</td><td class="r">−${money(manday?.discount)}</td></tr>
              ${manday?.otTotal > 0
                ? `<tr class="res"><td>${tx('ค่าล่วงเวลา (OT)')}<span class="sub">${int((manday.otDays ?? []).length)} ${tx('วัน')}</span></td><td class="r" style="color:var(--ok)">+${money(manday.otTotal)}</td></tr>`
                : ''}
            </tbody></table></div>
            <div class="bd">
              <div class="tot">
                <div class="t py"><span>${tx('ยอดของรายการนี้')}</span><span class="v">${money(manday?.lineAmount)}</span></div>
              </div>
            </div>
            ${vatBreakdownHtml(manday, sheet.contract)}
          </div>
        </div>

        <div>
          <div class="card">
            <div class="hd"><h3>${tx('ข้อมูลอ้างอิง')}</h3></div>
            <div class="bd"><dl class="kv">
              <dt>${tx('ลูกค้า')}</dt><dd>${esc(sheet.contract.customerName)}</dd>
              <dt>${tx('เลขผู้เสียภาษี')}</dt><dd class="n">${esc(sheet.contract.taxId ?? '—')}</dd>
              <dt>${tx('ใบว่าจ้าง')}</dt><dd class="n">${esc(sheet.contract.poNo)}</dd>
              <dt>${tx('สัญญา')}</dt><dd class="n">${esc(sheet.contract.contractNo ?? '—')}</dd>
              <dt>${tx('ใบเสนอราคา')}</dt><dd class="n">${esc(sheet.employee.quotationNo ?? '—')}</dd>
              <dt>${tx('ช่วงสัญญา')}</dt><dd>${dateOnly(sheet.contract.startDate)} – ${dateOnly(sheet.contract.endDate)}</dd>
              <dt>${tx('เครดิต')}</dt><dd>${int(sheet.contract.creditDays)} ${tx('วัน')}</dd>
              <dt>${tx('ตัวหารอัตราต่อวัน')}</dt><dd>${sheet.contract.divisorMode === 'fixed'
                  ? `${tx('คงที่')} ${int(sheet.contract.divisorValue)}` : tx('วันทำงานจริงของเดือน')}</dd>
              <dt>${tx('ผู้ประสานงาน')}</dt><dd>${esc(sheet.contract.contactName ?? '—')}</dd>
            </dl></div>
          </div>

          <div class="card">
            <div class="hd"><h3>${tx('ประวัติการดำเนินการ')}</h3></div>
            <div class="bd"><ul class="acts-l">
              <li><span class="tx">${tx('รับเข้าระบบ')}<small>${esc(sheet.sourceFile ?? sheet.sourceEmailId ?? '—')}</small></span>
                <span class="tm">${dt(sheet.receivedAt)}</span></li>
              <li><span class="tx">${tx('ลูกค้าอนุมัติ Timesheet')}<small>${esc(sheet.approvedBy ?? '—')}</small></span>
                <span class="tm">${dateOnly(sheet.approvedAt)}</span></li>
              ${sheet.audit.map((a) => `
                <li><span class="tx">${esc(auditActionLabel(a.action))}<small>${esc(auditActorLabel(a.actor))}</small></span>
                  <span class="tm">${dt(a.at)}</span></li>`).join('')}
            </ul></div>
          </div>
        </div>
      </div>
    </div>

    <!-- อีเมล & Timesheet -->
    <div class="tp ${state.tab === 2 ? 'on' : ''}" data-pane="2">
      <div class="card">
        <div class="hd"><h3>${tx('ที่มาของข้อมูล')}</h3></div>
        <div class="bd">
          <dl class="kv" style="margin-bottom:16px">
            <dt>${tx('ไฟล์ที่อัปโหลด')}</dt><dd>${esc(sheet.sourceFile ?? '—')}</dd>
            <dt>${tx('อ้างอิงอีเมล')}</dt><dd>${esc(sheet.sourceEmailSubject ?? sheet.sourceEmailId ?? tx('ไม่ได้ระบุ'))}</dd>
            <dt>${tx('ชื่อที่เขียนในไฟล์')}</dt><dd>${esc(sheet.rawEmployeeName ?? '—')}</dd>
            <dt>${tx('ตำแหน่งที่เขียนในไฟล์')}</dt><dd>${esc(sheet.rawPosition ?? '—')}</dd>
            <dt>Total Work days</dt><dd class="n">${int(sheet.reportedWorkDays)}</dd>
            <dt>Leave / Sick (days)</dt><dd class="n">${int(sheet.reportedLeave)}</dd>
          </dl>
          <div class="attrow" style="margin-top:12px">
            ${sheet.sourceFile ? (() => {
              // ไฟล์ต้นฉบับถูกเก็บไว้ตอนยืนยันเข้าระบบ (timesheets.source_file_bytes)
              const src = `/api/timesheets/${encodeURIComponent(sheet.id)}/file`;
              return `<a class="file" href="${esc(src)}" target="_blank" rel="noopener"
                         title="${tx('เปิดดูไฟล์ต้นฉบับ')}"><span class="pd">PDF</span> ${esc(sheet.sourceFile)}</a>
                      <a class="btn sm icon" href="${esc(src)}?dl" download="${esc(sheet.sourceFile)}"
                         title="${tx('ดาวน์โหลดไฟล์ต้นฉบับ')}" aria-label="${tx('ดาวน์โหลด')}">${icon('cd')}</a>`;
            })() : `<span class="file"><span class="pd">PDF</span> ${tx('ไม่มีไฟล์ต้นฉบับเก็บไว้')}</span>`}
          </div>
        </div>
      </div>

      <div class="card">
        <div class="hd"><h3>${tx('รายละเอียด')}</h3>
          <span class="rt">${tx('ตามคอลัมน์ที่ ABBYY อ่านได้ — ชั่วโมงคำนวณเองอัตโนมัติถ้าตารางต้นฉบับไม่ได้สรุปมาให้')}</span></div>
        <div class="bd flush"><div class="tw"><table class="ldg" style="min-width:1080px">
          <thead><tr>
            <th>${tx('วันที่')}</th><th>${tx('วันในสัปดาห์')}</th><th>${tx('โครงการ')}</th>
            <th>${tx('เวลาเข้า–ออก')}</th><th>${tx('เวลา OT')}</th>
            <th>${tx('ประเภท')}</th><th>${tx('รายละเอียดงาน')}</th>
            <th class="r">${tx('ชม.ปกติ')}</th><th class="r">${tx('ชม. OT')}</th><th class="r">${tx('รวม/วัน')}</th>
          </tr></thead>
          <tbody>${sheet.dayLabels.length
            ? sheet.dayLabels.map((d) => {
                // วันลา — ใช้ประเภทที่ classifyLeaveType() ตัดสินไว้แล้ว (leaveDays ผ่านการจัดประเภท
                // sick/personal/vacation/unpaid มาแล้วจริง) แทนการเดาจากข้อความ type/label ในตารางนี้เอง
                // ให้สีตรงกับไอคอนในแท็บปฏิทินเป๊ะ ไม่ต้องเดาซ้ำสองที่ (27 ส.ค. 69 ตามที่ขอ)
                const leaveType = leaveTypeByDate.get(d.date);
                const info = leaveType ? { tone: `lv-${leaveType}`, label: dayTypeText(leaveType) } : dayTypeInfo(d.type);
                return `<tr>
                <td class="n">${esc(d.date)}</td>
                <td class="n">${esc(d.day_of_week ?? '—')}</td>
                <td>${esc(d.project ?? '—')}</td>
                <td class="n">${d.time_in && d.time_out ? `${esc(d.time_in)} – ${esc(d.time_out)}` : '—'}</td>
                <td class="n">${d.ot_time_in && d.ot_time_out ? `${esc(d.ot_time_in)} – ${esc(d.ot_time_out)}` : '—'}</td>
                <td><span class="tg ${info.tone}">${esc(info.label)}</span></td>
                <td style="white-space:pre-line">${esc(holidayLabelByDate.get(d.date) ?? dedupeRepeatedText(d.job_desc ?? d.remark ?? '—'))}</td>
                <td class="r n">${hoursCell(d.normal_hours)}</td>
                <td class="r n">${hoursCell(d.ot_hours)}</td>
                <td class="r n" style="font-weight:600">${hoursCell(d.total_hours)}</td>
              </tr>`;
              }).join('')
            : `<tr><td colspan="10" class="empty">${tx('ไม่มีข้อมูล')}</td></tr>`}</tbody>
          ${sheet.dayLabels.length ? `<tfoot><tr>
            <td colspan="7" style="font-weight:600">${tx('รวมทั้งเดือน')}</td>
            <td class="r n" style="font-weight:600">${hoursCell(sumHours(sheet.dayLabels, 'normal_hours'))}</td>
            <td class="r n" style="font-weight:600">${hoursCell(sumHours(sheet.dayLabels, 'ot_hours'))}</td>
            <td class="r n" style="font-weight:600">${hoursCell(sumHours(sheet.dayLabels, 'total_hours'))}</td>
          </tr></tfoot>` : ''}
        </table></div></div>
      </div>

      ${(manday?.otDays ?? []).length ? `<div class="card">
        <div class="hd"><h3>${tx('ค่าล่วงเวลา (OT)')}</h3>
          <span class="rt">${tx('ตรวจจับอัตโนมัติจาก Timesheet — ตรวจสอบชั่วโมงกับ PDF ต้นฉบับก่อนยืนยัน')}</span></div>
        <div class="bd flush"><div class="tw"><table style="min-width:0">
          <thead><tr><th>${tx('วันที่')}</th><th class="r">${tx('ชั่วโมง OT')}</th><th class="r">${tx('ค่าจ้างวันนั้น (รวม OT)')}</th><th class="r">${tx('ค่า OT เพิ่ม')}</th></tr></thead>
          <tbody>${manday.otDays.map((o) => `<tr><td class="n">${esc(dateOnly(o.date))}</td>
              <td class="r n">${o.hours}</td>
              <td class="r n">${money(o.dayAmount)}</td>
              <td class="r n" style="color:var(--ok)">+${money(o.otAmount)}</td></tr>`).join('')}</tbody>
        </table></div></div>
        <div class="bd">
          <div class="tot"><div class="t py"><span>${tx('รวมค่า OT ทั้งหมด')}</span><span class="v">+${money(manday.otTotal)}</span></div></div>
        </div>
      </div>` : ''}

      ${sheet.extraction ? `<div class="card">
        <div class="hd"><h3>${tx('ผลการอ่านไฟล์ดิบ')}</h3></div>
        <div class="bd"><pre class="code">${esc(JSON.stringify(sheet.extraction, null, 2))}</pre></div>
      </div>` : ''}
    </div>

    <!-- คำนวณ Manday -->
    <div class="tp ${state.tab === 3 ? 'on' : ''}" data-pane="3">
      <div class="g3 cal-grid">
        <div>
          <div class="card">
            <div class="hd"><h3>${tx('ปฏิทิน')} ${esc(sheet.periodLabel)}</h3></div>
            <div class="bd" id="calWrap">${calendarHtml(manday)}</div>
          </div>

          <div class="card">
            <div class="hd"><h3>${tx('หมายเหตุที่จะขึ้นบนใบแจ้งหนี้')}</h3></div>
            <div class="bd">
              ${manday?.remarkLines?.length
                ? `<div class="rmk">${esc(manday.remarkLines.join('\n'))}</div>`
                : `<div class="empty">${tx('ไม่มีวันลา จึงไม่มีหมายเหตุ')}</div>`}
            </div>
          </div>
        </div>

        <div>
          <div class="card">
            <div class="hd"><h3>${tx('สรุปประจำเดือน')}</h3></div>
            <div class="bd">
              <div class="stat-tiles cal-summary">
                <div class="stat-tile ok"><span class="sti">${icon('monitor', 'i lg')}</span><span class="stx"><span class="stv">${int(dayCounts.workday)}</span><span class="stl">${tx('ทำงาน (วัน)')}</span></span></div>
                <div class="stat-tile cr"><span class="sti">${icon('sickface', 'i lg')}</span><span class="stx"><span class="stv">${int(leaveCounts.sick)}</span><span class="stl">${tx('ลาป่วย (วัน)')}</span></span></div>
                <div class="stat-tile pr"><span class="sti">${icon('idcard', 'i lg')}</span><span class="stx"><span class="stv">${int(leaveCounts.personal)}</span><span class="stl">${tx('ลากิจ (วัน)')}</span></span></div>
                <div class="stat-tile wn"><span class="sti">${icon('plane', 'i lg')}</span><span class="stx"><span class="stv">${int(leaveCounts.vacation)}</span><span class="stl">${tx('ลาพักร้อน (วัน)')}</span></span></div>
                <div class="stat-tile mu"><span class="sti">${icon('cal', 'i lg')}</span><span class="stx"><span class="stv">${int(dayCounts.weekend)}</span><span class="stl">${tx('เสาร์–อาทิตย์ (วัน)')}</span></span></div>
                <div class="stat-tile pk"><span class="sti">${icon('gift', 'i lg')}</span><span class="stx"><span class="stv">${int(dayCounts.holiday)}</span><span class="stl">${tx('วันหยุด (วัน)')}</span></span></div>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="hd"><h3>${tx('รายละเอียดวันที่เลือก')}</h3></div>
            <div class="bd" id="dayDetailWrap">${dayDetailHtml(state.calDay, sheet, manday)}</div>
          </div>
        </div>
      </div>
    </div>

    <div class="fbar">
      <span class="sx">${failures.length
        ? `<b>${tx('ยังยืนยันไม่ได้')}</b> — ${esc(failures.map((f) => f.title).join(' · '))}`
        : sheet.status === 'billed'
          ? `<b>${tx('วางบิลแล้ว')}</b> — ${esc(sheet.invoiceNo ?? '')}`
          : sheet.check?.checked
            ? `<b>${tx('ยืนยันแล้ว')}</b> — ${esc(sheet.check.by ?? '')} · ${dt(sheet.check.at)}`
            : sheet.check?.stale
              ? `<b>${tx('ยอดเปลี่ยนหลังยืนยันไปแล้ว')}</b> — ${tx('อ่านตัวเลขชุดใหม่แล้วยืนยันอีกครั้ง')}`
              : ''}</span>
      <div class="gap"></div>
      <button class="btn dgr" id="rejectBtn">${tx('ตีกลับให้แก้ Timesheet')}</button>
      ${sheet.status === 'billed' || sheet.check?.checked
        ? `<button class="btn pri" id="toCycleBtn">${icon('send')} ${tx('ไปขั้น 3 วางบิล')}</button>`
        : `<button class="btn pri" id="checkBtn" ${failures.length ? 'disabled' : ''}>
             ${icon('chk')} ${tx('ยืนยันว่าตรวจแล้ว')}</button>`}
    </div>
  </div>`;

  el('backBtn').addEventListener('click', () => setNav('queue'));
  main.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.tab = Number(btn.dataset.tab);
      main.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b === btn));
      main.querySelectorAll('[data-pane]').forEach((p) =>
        p.classList.toggle('on', Number(p.dataset.pane) === state.tab));
    });
  });

  // คลิกวันที่ในปฏิทินเพื่อดูรายละเอียดวันนั้นในการ์ดข้างๆ — อัปเดตแค่สอง id นี้ในที่ ไม่ re-render
  // ทั้งหน้า (ตามแบบเดียวกับสลับแท็บด้านบน) กัน state อื่นๆที่ผู้ใช้กำลังทำอยู่ในหน้าเดียวกันหาย
  el('calWrap')?.addEventListener('click', (e) => {
    const cell = e.target.closest('.cl[data-date]');
    if (!cell) return;
    state.calDay = state.calDay === cell.dataset.date ? null : cell.dataset.date;
    el('calWrap').querySelectorAll('.cl[data-date]').forEach((c) =>
      c.classList.toggle('sel', c.dataset.date === state.calDay));
    el('dayDetailWrap').innerHTML = dayDetailHtml(state.calDay, sheet, manday);
  });

  el('recomputeBtn').addEventListener('click', async () => {
    try {
      const result = await api(`/timesheets/${encodeURIComponent(id)}/recompute`, { method: 'POST' });
      toast(`${tx('คำนวณใหม่แล้ว — วันที่วางบิลได้')} ${result.payableDays} ${tx('วัน ส่วนลด')} ${money(result.discount)} ${tx('บาท')}`);
      openSheet(id);
    } catch (error) { toast(error.message, true); }
  });

  el('rejectBtn').addEventListener('click', async () => {
    const reason = await promptModal({
      title: tx('ตีกลับให้แก้ Timesheet'), placeholder: tx('เหตุผลที่ตีกลับ…'), confirmLabel: tx('ตีกลับ'),
    });
    if (!reason) return;
    try {
      await api(`/timesheets/${encodeURIComponent(id)}/reject`, {
        method: 'POST', body: JSON.stringify({ reason }),
      });
      toast(tx('ตีกลับเรียบร้อย'));
      setNav('queue');
    } catch (error) { toast(error.message, true); }
  });

  el('toCycleBtn')?.addEventListener('click', () =>
    openCycle(sheet.contract.id, sheet.period));

  /* ประตูของขั้นที่ 2 — ตราที่ประทับผูกกับยอดชุดที่คนเพิ่งเห็นบนจอนี้
     ถ้ายอดเปลี่ยนทีหลัง ตราหมดอายุเองและปุ่มนี้กลับมาให้กดใหม่ */
  el('checkBtn')?.addEventListener('click', async () => {
    const btn = el('checkBtn');
    btn.disabled = true;
    try {
      await api(`/timesheets/${encodeURIComponent(id)}/check`, { method: 'POST' });
      toast(`${tx('ยืนยันแล้ว')} — ${sheet.employee.nameTh} ${tx('รอบ')} ${sheet.periodLabel} ${tx('พร้อมเข้ารอบบิล')}`);
      openSheet(id);
      syncBadges();
    } catch (error) {
      btn.disabled = false;
      toast(error.message, true);
    }
  });
}

/* ── เทียบวันลากับ HRDD ─────────────────────────────────────────
   อยู่ในหน้า "อัปโหลด Timesheet" ตอนรีวิวก่อนบันทึก (ไม่ใช่หลังยืนยันแล้ว) เพราะจะได้แก้วันลาให้
   ตรงกับ HRDD ก่อนกดยืนยันเข้าระบบเลย ไม่ต้องย้อนมาแก้ทีหลัง — ยิงแยกจากข้อมูลหลักของการ์ด
   เพราะเป็นการเรียกออกไปนอกระบบ (อาจช้า/ล่ม) ไม่ควรทำให้รอดูข้อมูลที่อ่านได้หลักไม่ได้
   ดูอย่างเดียว — เรียก HRDD ผ่าน API 2 เส้น (สถานะวันลา + รายการวันลา) ไม่มีเขียน/แก้/ลบฝั่ง HRDD
   ตรรกะเทียบอยู่ที่ src/domain/leaveCompare.js (ฝั่งเซิร์ฟเวอร์) หน้านี้แค่รับผลมาแสดง
   4 สถานะต่อวัน: ตรงกัน/ประเภทไม่ตรง/ไม่พบใน Timesheet/ไม่พบใน HRDD */

const HRDD_STATUS_LABEL = { ok: 'ตรงกัน', warn: 'ประเภทไม่ตรง', info: 'ไม่พบใน Timesheet', bad: 'ไม่พบใน HRDD' };
const HRDD_STATUS_TONE = { ok: 'ok', warn: 'wn', info: 'pr', bad: 'cr' };

/** อ่าน employeeId/period/วันลาปัจจุบันบนจอของการ์ดนี้ แล้วยิงไปเทียบกับ HRDD */
async function runHrddPreviewCompare(card, entry) {
  const meta = card.querySelector('.hrddMeta');
  const body = card.querySelector('.hrddBody');
  if (!meta || !body) return;

  const employeeId = entry().matching.employee?.id;
  const period = card.querySelector('[id^="rPeriod-"]').value;
  if (!employeeId) {
    body.innerHTML = `<div class="note">${icon('info')}<span>จับคู่ชื่อพนักงานกับคนในระบบก่อน (ด้านบน) ถึงจะเทียบกับ HRDD ได้</span></div>`;
    return;
  }
  if (!/^\d{4}-\d{2}$/.test(period ?? '')) {
    body.innerHTML = `<div class="note">${icon('info')}<span>รอบเดือนยังไม่ถูกต้อง แก้ "รอบเดือน" ด้านบนก่อน</span></div>`;
    return;
  }

  body.innerHTML = '<div class="loading">กำลังตรวจสอบวันลากับ HRDD…</div>';
  const leaveDays = [...card.querySelectorAll('.rLeaveRows .lrow')]
    .map((r) => ({ date: r.querySelector('.ldate').value, type: r.querySelector('.ltype').value }))
    .filter((l) => l.date);

  let result;
  try {
    result = await api('/hrdd-compare-preview', {
      method: 'POST',
      body: JSON.stringify({ employeeId, period, leaveDays }),
    });
  } catch (error) {
    result = { state: 'error', message: error.message };
  }
  renderHrddCompareInto(result, { card, meta, body });
}

function renderHrddCompareInto(result, { card, meta, body }) {
  meta.textContent = result.checkedAt ? `ซิงค์ล่าสุด ${dt(result.checkedAt)}` : '';

  if (result.state === 'not_connected' || result.state === 'error') {
    body.innerHTML = `
      <div class="empty">
        ${icon('alt', 'i')}
        <div>${esc(result.message)}</div>
        ${result.state === 'error' ? `<button class="btn sm hrddRetryBtn" type="button" style="margin-top:12px">ลองใหม่</button>` : ''}
      </div>`;
    body.querySelector('.hrddRetryBtn')?.addEventListener('click', () => {
      card.querySelector('.hrddRefreshBtn')?.click();
    });
    return;
  }

  const { rows, summary } = result;

  if (!rows.length) {
    body.innerHTML = `<div class="note">${icon('info')}<span>ไม่มีวันลาให้เทียบในรอบนี้ (ไม่มีทั้งฝั่ง Timesheet และ HRDD)</span></div>`;
    return;
  }

  const banner = summary.mismatched > 0
    ? `<div class="note wn">${icon('alt')}<span><b>พบความไม่ตรงกัน ${summary.mismatched} รายการ</b><br>
        ระหว่างวันลาที่อ่านได้จาก Timesheet กับข้อมูลใน HRDD — กรุณาตรวจสอบก่อนวางบิล</span></div>`
    : `<div class="note">${icon('chk')}<span><b>ข้อมูลวันลาตรงกันทั้งหมด</b><br>
        ตรวจกับ HRDD แล้ว ${summary.counts.ok} จาก ${summary.total} รายการตรงกัน</span></div>`;

  const stats = `
    <div class="stat-tiles">
      <div class="stat-tile ok"><span class="stv">${summary.counts.ok}</span><span class="stl">ตรงกัน</span></div>
      <div class="stat-tile wn"><span class="stv">${summary.counts.warn}</span><span class="stl">ประเภทไม่ตรง</span></div>
      <div class="stat-tile pr"><span class="stv">${summary.counts.info}</span><span class="stl">ไม่พบใน Timesheet</span></div>
      <div class="stat-tile cr"><span class="stv">${summary.counts.bad}</span><span class="stl">ไม่พบใน HRDD</span></div>
    </div>`;

  const table = `
    <div class="tw"><table style="min-width:0">
      <thead><tr><th>วันที่</th><th>Timesheet</th><th>HRDD</th><th>สถานะ</th><th></th></tr></thead>
      <tbody>
        ${rows.map((r) => `
          <tr class="hrdd-row ${HRDD_STATUS_TONE[r.status]}" data-date="${esc(r.date)}"
              data-ts-type="${esc(r.tsType ?? '')}" data-hrdd-type="${esc(r.hrddType ?? '')}"
              data-status="${esc(r.status)}">
            <td class="n">${dateOnly(r.date)}
              ${r.status !== 'ok' ? `<span class="why">${hrddMismatchNote(r)}</span>` : ''}</td>
            <td class="tsCell">${r.tsType ? esc(r.tsType) : '<span class="sub">— ไม่มีข้อมูล</span>'}</td>
            <td class="hrddCell">${r.hrddType ? esc(r.hrddType) : '<span class="sub">— ไม่มีข้อมูล</span>'}</td>
            <td class="statusCell"><span class="st ${HRDD_STATUS_TONE[r.status]}">${HRDD_STATUS_LABEL[r.status]}</span></td>
            <td class="actionCell">${r.status !== 'ok' ? `<button class="btn sm hrddFix" type="button">แก้ไข</button>` : ''}</td>
          </tr>
          ${r.status !== 'ok' ? `<tr class="hrddResolveRow" style="display:none">
            <td colspan="5"><div class="hrddResolvePanel"></div></td>
          </tr>` : ''}`).join('')}
      </tbody>
    </table></div>`;

  body.innerHTML = banner + stats + table;

  /* "แก้ไข" เปิดแผงเลือกว่าจะเอาตาม Timesheet/HRDD หรือทางเลือกอื่น (ตามสถานะของวันนั้น)
     พร้อมเหตุผลบังคับกรอก — แก้ไขจริงที่ตาราง "วันลาที่อ่านได้" (.rLeaveRows) ที่ซ่อนไว้ ไม่ใช่ที่นี่
     เพราะตอนกดยืนยันสุดท้าย confirmBtn จะอ่านข้อมูลวันลาจาก .rLeaveRows เท่านั้น (ดูด้านล่าง)
     ผูก event ของปุ่ม/radio ในแผง "ยกเลิก"/"บันทึกการแก้ไข" ตอนสร้าง HTML ของแผงจริงๆ (ในนี้)
     ไม่ใช่ผูกทีเดียวตอนวาดตารางแรกสุดแบบเดิม — ตอนนั้นแผงยังไม่มี HTML เลย (ว่างเปล่ารอ "แก้ไข" มาสร้าง)
     querySelectorAll หาปุ่มที่ยังไม่มีอยู่จริงย่อมไม่เจออะไรเลย ปุ่ม "บันทึกการแก้ไข" เลยกดไม่ทำงาน */
  body.querySelectorAll('.hrddFix').forEach((btn) => {
    btn.addEventListener('click', () => {
      const row = btn.closest('.hrdd-row');
      const panelRow = row.nextElementSibling;
      const panel = panelRow.querySelector('.hrddResolvePanel');
      if (!panel.innerHTML) {
        panel.innerHTML = buildHrddResolvePanel(row.dataset);
        panel.querySelectorAll('.hrr-choice input[type="radio"]').forEach((radio) => {
          radio.addEventListener('change', () => {
            const select = panel.querySelector('.hrr-custom-select');
            if (select) select.style.display = radio.value === 'custom' ? 'inline-block' : 'none';
          });
        });
        panel.querySelector('.hrr-cancel').addEventListener('click', () => { panelRow.style.display = 'none'; });
        panel.querySelector('.hrr-save').addEventListener('click', () => applyHrddResolve(card, panel.querySelector('.hrr-save')));
      }
      panelRow.style.display = panelRow.style.display === 'none' ? '' : 'none';
    });
  });
}

/** ตัวเลือกใน panel "แก้ไข" — เหมือนกันทุกสถานะตามที่ขอ (25 ส.ค. 69): ใช้ตาม HRDD / ใช้ตาม
 * Timesheet / ระบุเอง — ความหมายของแต่ละตัวเลือกต่างกันไปตามสถานะตอนเอาไปใช้จริง (ดู applyHrddResolve)
 * เช่น "ใช้ตาม HRDD" ตอนสถานะ "ไม่พบใน HRDD" หมายถึงลบวันลานี้ออกเพราะ HRDD ไม่มีข้อมูลอะไรให้ใช้
 *
 * ตั้งชื่อกลุ่ม radio ตามวันที่ (unique ต่อแถว) — ถ้าใช้ name เดียวกันทุกแถว พอเปิด "แก้ไข"
 * พร้อมกันหลายวัน radio ของแต่ละแถวจะไปหักล้างกันเอง (HTML จับกลุ่ม radio ด้วยชื่อทั้งหน้า ไม่ใช่ตามแผงที่มันอยู่) */
function buildHrddResolvePanel({ date }) {
  const name = `hrr-${date}`;
  return `
    <div class="hrr-choices">
      <label class="hrr-choice"><input type="radio" name="${name}" value="use-hrdd" checked> ใช้ตาม HRDD <span class="hrr-hint">(แนะนำ)</span></label>
      <label class="hrr-choice"><input type="radio" name="${name}" value="use-ts"> ใช้ตาม Timesheet</label>
      <label class="hrr-choice"><input type="radio" name="${name}" value="custom"> ระบุเอง
        <select class="hrr-custom-select" style="display:none">
          ${Object.entries(LEAVE_OPTIONS).map(([v, label]) => `<option value="${v}">${label}</option>`).join('')}
        </select></label>
    </div>
    <label class="hrr-reason-label">เหตุผล / หมายเหตุ <span class="hrr-req">*จำเป็น</span></label>
    <textarea class="hrr-reason" rows="2" placeholder="เช่น ตรวจสอบกับพนักงานแล้วว่า..."></textarea>
    <div class="hrr-actions">
      <button class="btn ghost sm hrr-cancel" type="button">ยกเลิก</button>
      <button class="btn pri sm hrr-save" type="button">บันทึกการแก้ไข</button>
    </div>`;
}

function applyHrddResolve(card, saveBtn) {
  const panelRow = saveBtn.closest('.hrddResolveRow');
  const row = panelRow.previousElementSibling;
  const reasonInput = panelRow.querySelector('.hrr-reason');
  const reason = reasonInput.value.trim();
  if (!reason) {
    reasonInput.classList.add('invalid');
    reasonInput.focus();
    toast('กรุณากรอกเหตุผล/หมายเหตุก่อนบันทึก', true);
    return;
  }
  reasonInput.classList.remove('invalid');

  const checked = panelRow.querySelector('input[type="radio"]:checked');
  const choice = checked.value;
  const choiceLabel = checked.closest('.hrr-choice').textContent.replace('(แนะนำ)', '').trim();
  const customSelect = panelRow.querySelector('.hrr-custom-select');
  const { date, tsType, hrddType, status } = row.dataset;
  const rows = card.querySelector('.rLeaveRows');

  const findRow = (d) => [...rows.querySelectorAll('.lrow')].find((r) => r.querySelector('.ldate').value === d);
  const toOption = (type) => (type && LEAVE_OPTIONS[type] ? type : 'other');

  if (status === 'warn') {
    // ทั้งสองฝั่งมีข้อมูลอยู่แล้ว แค่ประเภทไม่ตรงกัน — เลือกแค่ว่าจะเชื่อฝั่งไหน
    const finalType = choice === 'use-hrdd' ? toOption(hrddType)
      : choice === 'use-ts' ? toOption(tsType) : customSelect.value;
    const existing = findRow(date);
    if (existing) existing.querySelector('.ltype').value = finalType;
    row.querySelector('.tsCell').innerHTML = esc(finalType);
  } else if (status === 'info') {
    // Timesheet ไม่มีแถวนี้ — "ใช้ตาม HRDD"/"ระบุเอง" คือเพิ่มแถวใหม่, "ใช้ตาม Timesheet" คือปล่อยว่างไว้ตามเดิม
    if (choice === 'use-ts') {
      row.querySelector('.tsCell').innerHTML = '<span class="sub">— ไม่มีข้อมูล</span>';
    } else {
      const finalType = choice === 'use-hrdd' ? toOption(hrddType) : customSelect.value;
      addLeaveRow(rows);
      const added = rows.lastElementChild;
      added.querySelector('.ldate').value = date;
      added.querySelector('.ltype').value = finalType;
      row.querySelector('.tsCell').innerHTML = esc(finalType);
    }
  } else if (status === 'bad') {
    // HRDD ไม่มีแถวนี้ — "ใช้ตาม HRDD" คือลบวันลาออกจาก Timesheet, "ใช้ตาม Timesheet"/"ระบุเอง" คือเก็บไว้ (ระบุเองไว้แก้ประเภท)
    if (choice === 'use-hrdd') {
      findRow(date)?.remove();
      row.querySelector('.tsCell').innerHTML = '<span class="sub">— ไม่มีข้อมูล</span>';
    } else if (choice === 'custom') {
      const existing = findRow(date);
      if (existing) existing.querySelector('.ltype').value = customSelect.value;
      row.querySelector('.tsCell').innerHTML = esc(customSelect.value);
    }
  }

  row.classList.add('resolved');
  row.querySelector('.statusCell').innerHTML = '<span class="st mu">แก้ไขแล้ว</span>';
  row.querySelector('.actionCell').innerHTML = '';
  const whyEl = row.querySelector('.why');
  const summaryHtml = `<span class="why"><b>${esc(choiceLabel)}</b> — ${esc(reason)}</span>`;
  if (whyEl) whyEl.outerHTML = summaryHtml; else row.querySelector('td.n').insertAdjacentHTML('beforeend', summaryHtml);
  panelRow.remove();
}

/** ข้อความอธิบายว่าทำไมแถวนี้ไม่ตรงกัน — 3 แบบตามสถานะ (ดู HRDD_STATUS_LABEL) */
function hrddMismatchNote(r) {
  if (r.status === 'warn') {
    return `Timesheet ระบุ "${esc(r.tsType)}" แต่ HRDD บันทึกเป็น "${esc(r.hrddType)}" `
      + `— ควรยืนยันประเภทวันลาที่ถูกต้องกับพนักงานก่อนวางบิล`;
  }
  if (r.status === 'info') {
    return `พบวันลาที่อนุมัติแล้วใน HRDD แต่ไม่ถูกระบุในตาราง Timesheet — จำนวนวันทำงานที่คำนวณได้อาจไม่ถูกต้อง`;
  }
  if (r.status === 'bad') {
    return `พนักงานระบุว่าลาในตาราง Timesheet แต่ไม่พบการอนุมัติใน HRDD — อาจยังไม่ได้ยื่นคำขอลาในระบบเช็คชื่อ`;
  }
  return '';
}

// ── รอบบิล ──────────────────────────────────────────────────

const CYCLE_FILTERS = {
  ready: { label: 'พร้อมอนุมัติ', test: (c) => c.state === 'ready' },
  all: { label: 'ทุกรอบ', test: () => true },
  todo: { label: 'ยังไม่จบ', test: (c) => c.state !== 'billed' },
  chase: { label: 'รอ Timesheet', test: (c) => c.state === 'awaiting' || c.state === 'partial' },
  billed: { label: 'วางบิลแล้ว', test: (c) => c.state === 'billed' },
};

async function renderCycles() {
  const data = await api(`/cycles${contractQuery()}`);

  const all = data.cycles.slice().sort((a, b) => a.period.localeCompare(b.period));
  const filtered = all.filter(CYCLE_FILTERS[state.cycleFilter].test);

  main.innerHTML = `
  <div class="page">
    <div class="phd"><div><span class="ey">${tx('ขั้นที่ 3 จาก 4')}</span><h1>${tx('วางบิล &amp; ร่างอีเมล')}</h1></div></div>

    ${data.contracts.map((ct) => `
      <div class="card">
        <div class="hd">
          <h3>${esc(ct.poNo)} — ${esc(ct.customerName)}</h3>
          <span class="rt">${esc(ct.projectName)} · ${dateOnly(ct.startDate)} – ${dateOnly(ct.endDate)}</span>
        </div>
        <div class="bd" style="padding-bottom:0">
          <div class="pair">
            <div><span class="pl">${tx('มูลค่าสัญญา')}</span><span class="pv">${money(ct.contractValue)}<small>${tx('บาท')}</small></span></div>
            <div><span class="pl">${tx('วางบิลแล้ว')}</span><span class="pv a">${money(ct.billedValue)}<small>${tx('บาท')}</small></span></div>
            <div><span class="pl">${tx('คงเหลือ')}</span><span class="pv c">${money(ct.remainingValue)}<small>${tx('บาท')}</small></span></div>
            <div><span class="pl">${tx('รอบบิล')}</span><span class="pv">${ct.monthsBilled} / ${ct.monthsTotal}<small>${tx('เดือน')}</small></span></div>
          </div>
          <div class="bar"><span style="width:${ct.progress}%"></span></div>
          <div class="progline" style="padding-bottom:18px">
            <span>${dateOnly(ct.startDate)}</span>
            <span><b>${ct.progress}%</b> ${tx('ของสัญญา')}</span>
            <span>${dateOnly(ct.endDate)}</span>
          </div>
        </div>
      </div>`).join('')}

    <div class="card">
      <div class="tbar">
        <div class="seg">
          ${Object.entries(CYCLE_FILTERS).map(([key, f]) => `
            <button data-cfilter="${key}" class="${state.cycleFilter === key ? 'on' : ''}">
              ${tx(f.label)} <span class="c">${all.filter(f.test).length}</span></button>`).join('')}
        </div>
        <div class="gap"></div>
        <span class="meta">${tx('แสดง')} ${filtered.length} ${tx('จาก')} ${all.length} ${tx('รอบ')}</span>
      </div>
      <div class="tw"><table style="min-width:940px">
        <thead><tr>
          <th>${tx('รอบบิล')}</th><th style="width:200px">Timesheet</th>
          <th style="width:180px">${tx('สถานะ')}</th><th style="width:230px">${tx('กำหนดเวลา')}</th>
          <th class="r" style="width:140px">${tx('มูลค่า')}</th>
        </tr></thead>
        <tbody>${filtered.map((c) => cycleRow(c, { showCustomer: data.contracts.length > 1 })).join('')
          || `<tr><td colspan="5" class="empty">${tx('ไม่มีรอบบิลในหมวดนี้')}</td></tr>`}</tbody>
      </table></div>
    </div>
  </div>`;

  main.querySelectorAll('[data-cfilter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.cycleFilter = btn.dataset.cfilter;
      renderCycles();
    });
  });
  main.querySelectorAll('[data-cycle]').forEach((row) => {
    row.addEventListener('click', () => {
      const [contractId, period] = row.dataset.cycle.split('|');
      openCycle(contractId, period);
      syncBadges();
    });
  });
}

/* ข้อความบอกสถานะขั้นสุดท้ายของรอบบิล — ระบบดูจากกล่อง Gmail เองว่าร่างถูกกดส่งหรือยัง
   ไม่มีปุ่มให้คนมากดบอกแล้ว เพราะเดิมลืมกดกันประจำ รอบที่ส่งไปแล้วจริงก็ยังค้างเป็น "สร้างร่างแล้ว" */
/* ฟังก์ชันไม่ใช่ค่าคงที่ตรงๆ เพราะต้องอ่าน state.lang สดทุกครั้งที่ openCycle() วาดใหม่
   (สลับภาษาแล้วเปิดหน้านี้ซ้ำ) ถ้าเป็นค่าคงที่จะถูกคำนวณครั้งเดียวตอนโหลดไฟล์ ไม่มีวันอัปเดตตามภาษา */
const WAITING_SEND = () => `${icon('clock')} ${tx('สร้างร่างใน Gmail แล้ว — กดส่งจาก Gmail ได้เลย')} ` +
  tx('ระบบจะขึ้นว่าส่งแล้วให้เองเมื่อเปิดหน้านี้อีกครั้ง');
const NO_DRAFT_YET = () => `${icon('info')} ${tx('ยังไม่ได้สร้างร่างใน Gmail — สร้างจากแท็บ')} “${tx('ร่างอีเมล')}” ${tx('ด้านซ้าย')} ` +
  tx('แล้วระบบจะตามให้เองว่าส่งไปแล้วหรือยัง');

async function openCycle(contractId, period) {
  // เปิดรอบบิลใหม่ (contract/period ต่างจากที่ค้างอยู่) ค่อยรีเซ็ตกลับแท็บแรก — รอบเดิม (เรียกซ้ำจาก
  // สลับภาษา/อนุมัติแล้ว) คงแท็บที่ดูอยู่ไว้ เหมือน openSheet() ด้านบน
  if (state.cycleContractId !== contractId || state.cyclePeriod !== period) state.cycleTab = 1;
  state.view = 'cycle';
  state.cycleContractId = contractId;
  state.cyclePeriod = period;
  markTab('cycle');

  main.innerHTML = '<div class="loading">กำลังโหลด…</div>';
  const data = await api(`/cycles/${encodeURIComponent(contractId)}/${period}`);

  if (!data.invoice) {
    main.innerHTML = `<div class="page">
      <button class="back" id="backBtn">${icon('cl')} ${tx('กลับ')}</button>
      <div class="card"><div class="empty">${icon('cal', 'i')}
        <div>${esc(data.blockers.join(' · '))}</div></div></div></div>`;
    el('backBtn').addEventListener('click', () => setNav('cycles'));
    return;
  }

  const inv = data.invoice;
  const t = inv.totals;
  const billed = data.existing?.status === 'sent_to_flowaccount';

  const entryCard = (entry) => {
    const m = entry.manday;
    return `
    <div class="rec">
      <div class="rec-hd">
        <span class="ava">${esc(initials(entry.employee.nameTh))}</span>
        <span>
          <span class="nm2">${esc(entry.employee.invoicePosition)}</span>
          <span class="mt2">${esc(entry.employee.nameTh)} · ${esc(entry.employee.quotationNo ?? '')}</span>
        </span>
        <span class="rt2"><span class="st ${m.discount ? 'wn' : 'ok'}">
          ${m.payableDays} / ${m.standardWorkingDays} ${tx('วัน')}</span></span>
      </div>
      <div class="minitab">
        <div class="mh2"><span>${tx('รายการคำนวณ')}</span><span class="q">${tx('จำนวน')}</span><span class="p">${tx('บาท')}</span></div>
        <div class="mr">
          <span class="lb2">${tx('เรทค่าบริการต่อเดือน')}</span>
          <span class="q">1 ${tx('เดือน')}</span><span class="p">${money(m.monthlyRate)}</span>
        </div>
        ${m.leaveCount ? `<div class="mr neg">
          <span class="lb2">${tx('ส่วนลดวันลา')}<small>${money(m.dailyRate)} × ${m.leaveCount} ${tx('วัน')}</small></span>
          <span class="q">${m.leaveCount} ${tx('วัน')}</span><span class="p">−${money(m.discount)}</span>
        </div>` : `<div class="mr">
          <span class="lb2">${tx('ส่วนลดวันลา')}<small>${tx('ไม่มีวันลา')}</small></span>
          <span class="q">0 ${tx('วัน')}</span><span class="p">—</span>
        </div>`}
      </div>
      <div class="rec-total">
        <span class="tl">${tx('ยอดของรายการนี้')}</span>
        <span class="tv">${money(m.lineAmount)}</span>
      </div>
      <div class="rec-acts one">
        <button class="btn" data-open="${esc(entry.timesheetId)}">${icon('file')} ${tx('ดู Timesheet')}</button>
      </div>
    </div>`;
  };

  main.innerHTML = `
  <div class="page">
    <button class="back" id="backBtn">${icon('cl')} ${tx('กลับหน้ารอบบิล')}</button>

    <div class="greet">
      <div>
        <span class="hi">${tx('รอบบิล')} ${esc(data.periodLabel)}</span>
        <h1>${esc(data.contract.customer_name)}</h1>
        <p class="sub2">${tx('โครงการ')} ${esc(data.contract.project_name)} · Timesheet ${data.cycle.received}/${data.cycle.expected} ${tx('คน')}</p>
      </div>
      <div class="tools">
        <span class="datechip">${icon('cal')} ${tx('วางบิล')} ${dateOnly(inv.documentDate)}</span>
        <span class="datechip">${icon('clock')} ${tx('ครบกำหนด')} ${dateOnly(inv.dueDate)}</span>
      </div>
    </div>

    ${data.blockers.length ? `<div class="note cr">${icon('alt')}<span>
      <strong>${tx('ยังวางบิลไม่ได้')}</strong><br>${data.blockers.map(esc).join('<br>')}</span></div>` : ''}

    <div class="split2">
      <!-- ซ้าย: รายการในรอบบิล -->
      <div>
        <div class="card">
          <div class="hd"><h3>${tx('รายการในรอบบิล')}</h3>
            <span class="rt">${data.entries.length} ${tx('คน')} · ${tx('ประกอบเป็นใบแจ้งหนี้ใบเดียว')}</span></div>
          <div class="cardgrid" style="grid-template-columns:1fr">
            ${data.entries.map(entryCard).join('')}
          </div>
        </div>

        <div class="tabs" role="tablist">
          ${['ข้อมูลที่ส่งเข้า FlowAccount', 'ร่างอีเมล'].map((label, i) =>
            `<button class="tab ${state.cycleTab === i + 1 ? 'on' : ''}" data-ctab="${i + 1}">${tx(label)}</button>`).join('')}
        </div>

        <div class="tp ${state.cycleTab === 1 ? 'on' : ''}" data-cpane="1">
          <div class="card">
            <div class="hd"><h3>${tx('Payload ที่จะยิงเข้า API')}</h3>
              <span class="rt">${tx('ต้องเทียบชื่อฟิลด์กับ API docs ก่อนใช้จริง')}</span></div>
            <div class="bd"><pre class="code">${esc(JSON.stringify(data.payload, null, 2))}</pre></div>
          </div>
        </div>

        <div class="tp ${state.cycleTab === 2 ? 'on' : ''}" data-cpane="2">
          <div class="card">
            <div class="hd"><h3>${tx('ร่างอีเมลวางบิล')}</h3></div>
            <div class="bd">
              <div class="mailacts">
                <button class="btn sm" id="aiDraftBtn">${icon('rf')} ${tx('ให้ระบบเรียบเรียงใหม่')}</button>
                <button class="btn sm" id="copyMailBtn">${icon('doc')} ${tx('คัดลอกร่าง')}</button>
                <button class="btn sm" id="gmailDraftBtn">${icon('mail')} ${tx('สร้างร่างใน Gmail')}</button>
              </div>
              ${data.emailDraft.highlights?.length ? `<div class="note info">${icon('info')}<span>
                <strong>${tx('ข้อสังเกตจากระบบ')}</strong><br>${data.emailDraft.highlights.map(esc).join('<br>')}
              </span></div>` : ''}
              <div class="cmp">
                <div class="f"><span class="l">${tx('ถึง')}</span><span id="mailTo">${esc(data.emailDraft.to)}</span></div>
                <div class="f"><span class="l">${tx('สำเนา')}</span><span>${esc(data.emailDraft.cc)}</span></div>
                <div class="f sj"><span class="l">${tx('เรื่อง')}</span><span id="mailSubject">${esc(data.emailDraft.subject)}</span></div>
                <div class="lt" id="mailBody">${esc(data.emailDraft.body)}</div>
                <div class="en">
                  <div class="files">${data.emailDraft.attachments.map((raw) => {
                    // ร่างเก่าก่อนมีลิงก์ไฟล์จริง เก็บเป็นสตริงชื่อไฟล์เฉยๆ — รองรับไว้ไม่ให้พัง
                    const a = typeof raw === 'string' ? { label: raw } : raw;
                    // ใบวางบิลกับ Timesheet คนละ endpoint แต่เปิดดูแบบเดียวกัน
                    const href = a.invoiceId
                      ? `/api/invoices/${encodeURIComponent(a.invoiceId)}/file`
                      : a.timesheetId
                        ? `/api/timesheets/${encodeURIComponent(a.timesheetId)}/file`
                        : null;
                    return href
                      ? `<a class="file" href="${esc(href)}" target="_blank" rel="noopener"
                           title="${tx('เปิดดูไฟล์นี้')}"><span class="pd">PDF</span> ${esc(a.label)}</a>
                         <a class="btn sm icon" href="${esc(href)}?dl" download="${esc(a.label)}"
                           title="${tx('ดาวน์โหลดไฟล์นี้')}" aria-label="${tx('ดาวน์โหลด')}">${icon('cd')}</a>`
                      : `<span class="file"><span class="pd">PDF</span> ${esc(a.label)}</span>`;
                  }).join('')}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ขวา: ใบแจ้งหนี้ค้างไว้ตลอด -->
      <div class="sticky">
        <div class="card">
          <div class="hd"><h3>${tx('ใบแจ้งหนี้ที่จะสร้าง')}</h3>
            <span class="rt">${billed
              ? `${tx('สร้างแล้ว')} — ${esc(data.existing.document_no)}${data.existing.share_link
                  ? ` · <a href="${esc(data.existing.share_link)}" target="_blank" rel="noopener">${tx('เปิดดูเอกสาร')}</a>`
                  : ''}`
              : tx('เลขเอกสารจะได้จาก FlowAccount')}</span></div>
          ${billed ? (data.existing.email_sent_at
            ? `<div class="bd">
                 <div class="sentok">
                   <span class="ic">${icon('chk')}</span>
                   <div>
                     <div class="ttl">${tx('ส่งเมลแล้ว')}</div>
                     <div class="meta">${tx('ถึง')} <b>${esc(data.emailDraft?.to || tx('ไม่พบอีเมลผู้รับในร่าง'))}</b><br>
                       ${tx('บันทึกโดย')} ${esc(data.existing.email_sent_by || '—')} · ${dt(data.existing.email_sent_at)}</div>
                   </div>
                 </div>
               </div>`
            /* ไม่มีปุ่มให้กดบอกว่าส่งแล้วอีกต่อไป — ระบบไปดูในกล่อง Gmail เองว่าร่างถูกกดส่งหรือยัง
               แล้วสลับเป็นแถบเขียวด้านบนให้เอง (ดู syncEmailSent) ตรงนี้บอกแค่ว่ากำลังรออะไรอยู่ */
            : `<div class="bd sendrow">
                 <span class="hint" id="sendHint">${data.existing.gmail_thread_id
                   ? WAITING_SEND() : NO_DRAFT_YET()}</span>
               </div>`) : ''}
        <div class="bd">
          <div class="doc">
            <div class="dh">
              <div>
                <span class="tg ${billed ? 'ok' : 'wn'}" style="margin-bottom:6px">${billed ? tx('สร้างร่างแล้ว') : 'ร่าง · Draft'}</span>
                <div class="cs">${esc(inv.customer.name)}</div>
                <div class="ti">${tx('เลขประจำตัวผู้เสียภาษี')} ${esc(inv.customer.taxId)} · ${esc(inv.customer.branch ?? '')}</div>
              </div>
              <dl class="kv">
                <dt>${tx('วันที่เอกสาร')}</dt><dd>${dateOnly(inv.documentDate)}</dd>
                <dt>${tx('เครดิต')}</dt><dd>${int(inv.creditDays)} ${tx('วัน')} · ${tx('ครบ')} ${dateOnly(inv.dueDate)}</dd>
                <dt>Reference</dt><dd><span class="tg mu">${tx('เว้นว่างตามใบจริง')}</span></dd>
              </dl>
            </div>
            <div class="tw"><table style="min-width:0">
              <thead><tr><th style="width:34px">#</th><th>${tx('รายการ')}</th>
                <th class="r" style="width:96px">${tx('ส่วนลด')}</th><th class="r" style="width:112px">${tx('จำนวนเงิน')}</th></tr></thead>
              <tbody>${inv.items.map((i) => `
                <tr><td class="n">${i.seq}</td>
                  <td><span class="nm">${esc(i.name)}</span>
                    <span class="sub">${esc(i.employeeName)} · ${esc(compactPeriod(inv.period))}</span>
                    <span class="sub">${i.quantity} ${esc(i.unitName)} × ${money(i.pricePerUnit)}</span></td>
                  <td class="r n" style="${i.discount ? 'color:var(--cr)' : 'color:var(--fnt)'}">${i.discount ? '−' + money(i.discount) : '—'}</td>
                  <td class="r n">${money(i.amount)}</td></tr>`).join('')}</tbody>
            </table></div>
            <div class="dfoot">
              <div class="tot">
                <div class="t"><span>${tx('รวมเป็นเงิน')}</span><span class="v">${money(t.total)}</span></div>
                <div class="t mi"><span>${tx('ส่วนลด')}</span><span class="v">−${money(t.discountTotal)}</span></div>
                <div class="t rl"><span>${tx('รวมหลังหักส่วนลด')}</span><span class="v">${money(t.totalAfterDiscount)}</span></div>
                <div class="t"><span>${tx('ภาษีมูลค่าเพิ่ม')} ${Math.round(t.vatRate * 100)}%</span><span class="v">${money(t.vat)}</span></div>
                <div class="t gr"><span>${tx('รวมทั้งสิ้น')}</span><span class="v">${money(t.grandTotal)}</span></div>
                <div class="t mi"><span>${tx('หักภาษี ณ ที่จ่าย')} ${Math.round(t.whtRate * 100)}%</span><span class="v">−${money(t.withholdingTax)}</span></div>
                <div class="t py"><span>${tx('ยอดรับชำระ')}</span><span class="v">${money(t.paymentAmount)}</span></div>
              </div>
              ${inv.remark ? `<div class="rmk"><span class="ey">${tx('หมายเหตุ')}</span>${esc(inv.remark)}</div>` : ''}
              <div class="note">${icon('info')}<span>
                ${tx('ภาษีหัก ณ ที่จ่ายคิดจากยอดหลังหักส่วนลดก่อน VAT')}
                (${money(t.totalAfterDiscount)} × ${Math.round(t.whtRate * 100)}% = ${money(t.withholdingTax)})
                ${tx('ตามที่ใบแจ้งหนี้ตัวอย่างทำ ไม่ใช่คิดจากยอดรวมทั้งสิ้น')}
              </span></div>
            </div>
          </div>
        </div>
      </div>
      </div>
    </div>

    <div class="fbar">
      <span class="sx" id="cycleStatus">${billed
        ? `<b>${tx('สร้างร่างใน FlowAccount แล้ว')}</b> — ${esc(data.existing.document_no)}`
        : data.blockers.length
          ? `<b>${tx('ยังอนุมัติไม่ได้')}</b> — ${data.blockers.length} ${tx('ข้อ')}`
          : ''}</span>
      <div class="gap"></div>
      <button class="btn pri" id="approveBtn" ${billed || data.blockers.length ? 'disabled' : ''}>
        ${icon('send')} ${tx('อนุมัติและสร้างร่างใน FlowAccount')}</button>
    </div>
  </div>`;

  el('backBtn').addEventListener('click', () => setNav('cycles'));
  main.querySelectorAll('[data-ctab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const n = Number(btn.dataset.ctab);
      state.cycleTab = n;
      main.querySelectorAll('[data-ctab]').forEach((b) => b.classList.toggle('on', b === btn));
      main.querySelectorAll('[data-cpane]').forEach((p) =>
        p.classList.toggle('on', Number(p.dataset.cpane) === n));
    });
  });
  main.querySelectorAll('[data-open]').forEach((btn) => {
    btn.addEventListener('click', () => openSheet(btn.dataset.open));
  });

  const approveBtn = el('approveBtn');
  approveBtn?.addEventListener('click', async () => {
    approveBtn.disabled = true;
    approveBtn.textContent = tx('กำลังส่งเข้า FlowAccount…');
    try {
      const result = await api(`/cycles/${encodeURIComponent(contractId)}/${period}/approve`, {
        method: 'POST',
      });
      toast(
        `${tx('สร้างร่างใบแจ้งหนี้')} ${result.documentNo} ${tx('ใน FlowAccount แล้ว')}` +
        (result.mode === 'dry-run' ? ` ${tx('(โหมด dry-run — ยังไม่เรียก API จริง)')}` : '') +
        ` · ${tx('ร่างอีเมลรออยู่ในระบบ ยังไม่ส่งออก')}`,
      );
      openCycle(contractId, period);
      syncBadges();
    } catch (error) {
      approveBtn.disabled = false;
      approveBtn.innerHTML = `${icon('send')} ${tx('อนุมัติและสร้างร่างใน FlowAccount')}`;
      toast(error.message, true);
    }
  });

  /* ขั้นที่ 4 — ระบบไม่ส่งอีเมลเองไม่ว่าทางไหน (ไม่มีโค้ดเรียก send สักจุด)
     คัดลอก/เปิดโปรแกรมเมล คือทางที่ไม่ต้องเชื่อมต่อ Gmail เลย
     "สร้างร่างใน Gmail" ใช้สิทธิ์ gmail.compose ที่ขอไว้ตอนเชื่อมต่อ (createDraft) — วางร่างไว้ใน
     กล่อง Drafts ให้ ยังต้องกดส่งเองอยู่ดี ไม่ต่างจากสองปุ่มแรกในเรื่องนี้ */
  el('aiDraftBtn')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = tx('ระบบกำลังเรียบเรียง…');
    try {
      await api(`/cycles/${encodeURIComponent(contractId)}/${period}/email-draft`, { method: 'POST' });
      toast(tx('ระบบร่างอีเมลใหม่แล้ว — อ่านทวนก่อนคัดลอกไปส่ง'));
      openCycle(contractId, period);
    } catch (error) {
      btn.disabled = false;
      btn.innerHTML = `${icon('rf')} ${tx('ให้ระบบเรียบเรียงใหม่')}`;
      toast(error.message, true);
    }
  });

  el('copyMailBtn')?.addEventListener('click', async () => {
    const text = `${tx('เรื่อง')}: ${data.emailDraft.subject}\n\n${data.emailDraft.body}`;
    try {
      await navigator.clipboard.writeText(text);
      toast(tx('คัดลอกร่างอีเมลแล้ว — วางในกล่องเมลได้เลย'));
    } catch {
      toast(tx('คัดลอกไม่สำเร็จ — เลือกข้อความในกล่องร่างแล้วคัดลอกเอง'), true);
    }
  });

  el('gmailDraftBtn')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    /* เปิดแท็บเปล่าไว้ก่อนตั้งแต่ตอนคลิก (ยังอยู่ใน user gesture เดิม) แล้วค่อยเปลี่ยน
       location ทีหลังตอน await เสร็จ — ถ้าไปเรียก window.open() หลัง await เลย เบราว์เซอร์
       จะมองว่าไม่ใช่ user gesture แล้ว บล็อก popup ทันที (ทดสอบแล้วเจอจริง) */
    const draftWindow = window.open('', '_blank');
    btn.disabled = true;
    btn.textContent = tx('กำลังสร้างร่างใน Gmail…');
    try {
      const r = await api(`/cycles/${encodeURIComponent(contractId)}/${period}/gmail-draft`, { method: 'POST' });
      toast(`${tx('สร้างร่างใน Gmail แล้ว — ถึง')} ${r.to} · ${tx('เปิดแท็บใหม่ให้แล้ว กดตรวจแล้วส่งได้จากที่นั่นเลย')} (${r.note})`);
      /* อัปเดตแถบสถานะตรงๆแทนการโหลดหน้าใหม่ทั้งหน้า — ไม่งั้นแท็บที่คนเปิดค้างไว้จะเด้งกลับไปแท็บแรก */
      if (el('sendHint')) el('sendHint').innerHTML = WAITING_SEND();
      if (r.url && draftWindow) draftWindow.location = r.url;
      else draftWindow?.close();
    } catch (error) {
      toast(error.message, true);
      draftWindow?.close();
    } finally {
      btn.disabled = false;
      btn.innerHTML = `${icon('mail')} ${tx('สร้างร่างใน Gmail')}`;
    }
  });

}


/* ══ ขั้นที่ 1 — อัปโหลด Timesheet ══════════════════════════
   โหมด auto: อีเมลเข้า → n8n ดึงไฟล์ → ยิง /ingest → บันทึกทันที
   โหมด manual (หน้านี้): คนโหลดไฟล์จากเมลเอง → อัปโหลด → AI อ่านให้ดู →
   คนตรวจ/แก้สิ่งที่อ่านได้ → กดยืนยัน จึงบันทึก

   จุดต่างที่สำคัญคือ "ยังไม่บันทึกจนกว่าคนจะเห็น" — อีกสามขั้นที่เหลือเหมือนกันทุกอย่าง */

const LEAVE_OPTIONS = { sick: 'ลาป่วย', personal: 'ลากิจ', vacation: 'ลาพักร้อน', other: 'อื่นๆ' };

/** ประเภทหัก ณ ที่จ่ายที่พบบ่อย — ใช้เลือกเร็วในหน้าตรวจ Timesheet ก่อนยืนยัน (27 ส.ค. 69)
 * ปรับอัตราเองได้จากสเต็ปเปอร์ถ้าเงื่อนไขต่างจากมาตรฐาน — ดู readResultHtml()/bindUploadTab() */
const WHT_TYPES = [
  { pct: 1, name: 'ค่าบริการขนส่งสินค้า' },
  { pct: 2, name: 'ค่าโฆษณา' },
  { pct: 3, name: 'ค่าจ้างทำของ / ค่าบริการ' },
  { pct: 5, name: 'ค่าเช่าทรัพย์สิน' },
];

/** อ่านไฟล์เป็น base64 โดยไม่มีส่วนหัว data: */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('อ่านไฟล์ไม่สำเร็จ'));
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.readAsDataURL(file);
  });
}

async function renderUpload() {
  const [contracts, settings, employees] = await Promise.all([
    api('/contracts'), api('/settings'), api('/employees'),
  ]);
  const reads = state.reads;

  main.innerHTML = `
  <div class="page">
    <div class="phd">
      <div><span class="ey">${tx('ขั้นที่ 1 จาก 4')}</span><h1>${tx('อัปโหลด Timesheet')}</h1></div>
    </div>

    <div class="tabs" role="tablist">
      <button class="tab ${state.uploadTab === 1 ? 'on' : ''}" data-utab="1">${tx('อัปโหลดไฟล์')}</button>
      <button class="tab ${state.uploadTab === 3 ? 'on' : ''}" data-utab="3">${tx('ดึงจาก Gmail')}
        ${settings.env.hasGmail ? '' : `<span class="tg mu">${tx('ยังไม่ต่อ')}</span>`}</button>
      <button class="tab ${state.uploadTab === 2 ? 'on' : ''}" data-utab="2">${tx('กรอกเอง')}</button>
      <button class="tab ${state.uploadTab === 4 ? 'on' : ''}" data-utab="4">${tx('ประวัติ')}</button>
    </div>

    <!-- ── ดึงจาก Gmail ── -->
    <div class="tp ${state.uploadTab === 3 ? 'on' : ''}" data-upane="3">
      ${settings.env.hasGmail ? `
        <div class="card">
          <div class="hd"><h3>${tx('อีเมลแจ้งอนุมัติ Timesheet')}</h3>
            <span class="rt" id="gmailAcct">${tx('กำลังเชื่อมต่อ…')}</span></div>
          <div class="bd">
            <div id="gmailList"></div>
          </div>
        </div>` : `
        <div class="card"><div class="bd">
          <div class="note wn">${icon('alt')}<span>
            <strong>${tx('ยังไม่ได้เชื่อมต่อ Gmail')}</strong> — ${tx('ทำครั้งเดียวจบ ใช้บัญชี Google ของคุณเองได้')}
          </span></div>
          <ol class="steps">
            <li>เปิด <b>console.cloud.google.com</b> → สร้างโปรเจกต์ใหม่</li>
            <li><b>APIs &amp; Services → Library</b> → ค้น "Gmail API" → กด <b>Enable</b></li>
            <li><b>OAuth consent screen</b> → External → ใส่ชื่อแอปกับอีเมล →
                <b>Test users</b> เพิ่มอีเมลตัวเองเข้าไปด้วย</li>
            <li><b>Credentials → Create credentials → OAuth client ID</b> → Web application<br>
                Authorized redirect URI: <code>http://localhost:4399/oauth/callback</code></li>
            <li>ก๊อป Client ID/Secret ใส่ไฟล์ <code>.env</code> แล้วรัน <code>npm run gmail:auth</code></li>
            <li>เอา <code>GMAIL_REFRESH_TOKEN</code> ที่ได้ใส่ <code>.env</code> → รันเซิร์ฟเวอร์ใหม่</li>
          </ol>
          <div class="note info">${icon('info')}<span>
            ${tx('สิทธิ์ที่ขอคือ')} <b>${tx('อ่านเมล')}</b> ${tx('กับ')} <b>${tx('สร้างร่าง')}</b> — ${tx('ในโค้ดไม่มีคำสั่งส่งอีเมลอยู่เลย')}
            ${tx('ร่างที่สร้างจะไปอยู่ในกล่อง Drafts ให้คุณกดส่งเอง')}
          </span></div>
        </div></div>`}
    </div>

    <!-- ── อัปโหลดไฟล์ ── -->
    <div class="tp ${state.uploadTab === 1 ? 'on' : ''}" data-upane="1">
      <div class="card">
        <div class="hd"><h3>${tx('เลือกไฟล์ Timesheet')}</h3><span class="rt">${tx('PDF ที่ลูกค้าอนุมัติแล้ว')}</span></div>
        <div class="bd">
          <label class="drop" id="dropZone">
            <input type="file" id="fileInput" accept="application/pdf" hidden>
            ${icon('file', 'i')}
            <b id="dropName">${tx('ลากไฟล์มาวาง หรือกดเพื่อเลือกไฟล์')}</b>
          </label>
        </div>
        <div class="ft">
          <button class="btn pri" id="readBtn" disabled>${icon('srch')} ${tx('อ่านไฟล์นี้')}</button>
        </div>
      </div>

    </div>

    <!-- ── กรอกเอง ── -->
    <div class="tp ${state.uploadTab === 2 ? 'on' : ''}" data-upane="2">
      <div class="card">
        <div class="hd"><h3>${tx('ข้อมูลจากใบ Timesheet')}</h3></div>
        <div class="bd">
            <div class="frm">
              <label>${tx('รอบเดือน')}<input id="ePeriod" type="month"></label>
              <label>${tx('ชื่อพนักงาน')} <b>${tx('ตามที่เขียนในใบ')}</b>
                <input id="eName" type="text" placeholder="เช่น Pongpun Mamak" autocomplete="off">
              </label>
              <label>${tx('ตำแหน่ง')} <b>${tx('ตามที่เขียนในใบ')}</b>
                <input id="ePos" type="text" placeholder="เช่น Java Programmer" autocomplete="off">
              </label>
              <label>${tx('ผู้อนุมัติฝั่งลูกค้า')}
                <input id="eBy" type="text" value="Project Manager (TLI)" autocomplete="off">
              </label>
              <label>${tx('วันที่ลูกค้าอนุมัติ')}<input id="eAt" type="date"></label>
            </div>
            <div class="fsec">
              <div class="fsec-h"><b>${tx('วันลา')}</b><button class="btn sm" id="eAddLeave">${tx('+ เพิ่มวันลา')}</button></div>
              <div id="eLeaves"></div>
              <small class="fhint">${tx('ไม่มีวันลาก็เว้นว่างไว้')}</small>
            </div>
          </div>
        <div class="ft"><button class="btn pri" id="eSave">${tx('บันทึกเข้าระบบ')}</button></div>
      </div>
    </div>

    <!-- ── ประวัติที่ AI เคยอ่านแล้ว ── -->
    <div class="tp ${state.uploadTab === 4 ? 'on' : ''}" data-upane="4">
      <div class="card">
        <div class="hd"><h3>${tx('ประวัติที่ระบบเคยอ่านแล้ว')}</h3>
          <span class="rt">${tx('ทั้งจากอัปโหลดไฟล์และดึงจาก Gmail — ด่านแรกก่อนเข้าระบบวางบิลจริง')}</span></div>
        <div class="bd flush"><div id="aiHistoryList"><div class="loading">${tx('กำลังโหลด…')}</div></div></div>
      </div>
    </div>

    <!-- ผลที่ AI อ่านได้ — วางไว้นอกแท็บในโค้ด แต่โชว์เฉพาะของแท็บที่กำลังเปิดอยู่ (กรอง tab ตรงนี้)
         กันไม่ให้การ์ดจากแท็บอื่นโผล่มาปนตอนสับแท็บไปมา — แต่ละแท็บโชว์ได้พร้อมกันหลายใบ (คนละการ์ด)
         เพราะ 1 อีเมลอาจมีไฟล์แนบของหลายคน -->
    ${reads.filter((r) => r.tab === state.uploadTab).map((r) => (r.pending ? pendingReadHtml(r) : readResultHtml(r, employees))).join('')}
  </div>`;

  main.querySelectorAll('[data-utab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.uploadTab = Number(btn.dataset.utab);
      renderUpload();
    });
  });

  bindUploadTab();
  bindGmailTab();
  bindManualTab(contracts);
  bindAiHistoryTab();
}

/* ── ขั้นที่ 1 ทางที่สอง: เลือกอีเมลจากกล่องแล้วให้ AI อ่านทั้งฉบับ ──
   ต่างจากอัปโหลดไฟล์ตรงที่ได้เนื้ออีเมลมาด้วย → เลขที่เอกสารกับสถานะ "อนุมัติ"
   ระบบอ่านเองได้ ไม่ต้องให้คนพิมพ์ และคนยังเป็นคนกดเลือกว่าจะเอาฉบับไหนเข้าระบบ */
function bindGmailTab() {
  if (!el('gmailList')) return;

  const load = async () => {
    el('gmailList').innerHTML = '<div class="loading">กำลังดึงรายการเมล…</div>';
    try {
      const inbox = await api('/gmail/inbox');
      el('gmailAcct').textContent = `กล่องของ ${inbox.account}`;

      /* บางฉบับดึงรายละเอียดไม่สำเร็จ (ถูกลบพอดี หรือ Gmail สะดุด) — รายการที่เห็นจึงยังไม่ครบ
         ต้องบอกไว้ ไม่งั้นคนเข้าใจว่ากล่องมีแค่นี้จริงๆ แล้วไปตามหาอีเมลที่หายไปไม่เจอ */
      const warn = inbox.skipped
        ? `<div class="note warn">${icon('alt')}<span>ดึงรายละเอียดไม่สำเร็จ ${int(inbox.skipped)} ฉบับ
             — รายการด้านล่างอาจยังไม่ครบ กดรีเฟรชอีกครั้งได้</span></div>`
        : '';

      // เหลือแค่ฉบับที่ยังไม่เคยให้ AI อ่าน — ที่ทำไปแล้วย้ายไปโชว์ในดรอปดาวน์ประวัติด้านล่างแทน
      // อีเมลฉบับเดียวอาจมีไฟล์แนบของหลายคน (เช่น ผู้จัดการส่งอนุมัติรวมทีเดียว) —
      // แต่ละไฟล์ต้องอ่าน+ยืนยันแยกกันเป็นคนๆไป จึงต้องมีปุ่ม "ให้ AI อ่าน" แยกต่อไฟล์แนบ
      // ไม่ใช่ปุ่มเดียวต่ออีเมลที่อ่านได้แค่ไฟล์แรกเหมือนเดิม
      el('gmailList').innerHTML = warn + (inbox.messages.length
        ? `<ul class="maillist">${inbox.messages.map((m) => `
            <li>
              <span class="mi">
                <span class="ms">${esc(m.subject)}</span>
                <span class="mf">${esc(m.from)} · ${dt(m.receivedAt)}</span>
                <span class="mq">${esc(m.snippet.slice(0, 110))}</span>
                <div class="attlist">
                  ${m.attachments.map((a) => {
                    // ดึงสดจาก Gmail — ไฟล์ยังไม่ได้เข้าระบบ (ยังไม่มีใครยืนยัน) จึงไม่มีสำเนาในฐานข้อมูล
                    const src = `/api/gmail/${encodeURIComponent(m.id)}/attachment?filename=${encodeURIComponent(a.filename)}`;
                    return `
                    <div class="attrow">
                      <a class="file" href="${esc(src)}" target="_blank" rel="noopener"
                         title="เปิดดูไฟล์นี้"><span class="pd">PDF</span> ${esc(a.filename)}</a>
                      <a class="btn sm icon" href="${esc(src)}&dl" download="${esc(a.filename)}"
                         title="ดาวน์โหลดไฟล์นี้" aria-label="ดาวน์โหลด">${icon('cd')}</a>
                      <button class="btn sm pri" data-mail="${esc(m.id)}" data-att="${esc(a.filename)}">
                        ${icon('srch')} อ่านข้อมูล</button>
                    </div>`;
                  }).join('')}
                </div>
              </span>
              <button class="btn sm dgr" data-dismiss="${esc(m.id)}"
                title="ลบอีเมลนี้ทิ้งทั้งฉบับ รวมทุกไฟล์แนบ (ไม่ลบอีเมลจริงใน Gmail)">${icon('trash')}</button>
            </li>`).join('')}</ul>`
        : inbox.ingested.length
          ? `<div class="empty">${icon('mail', 'i')}<div>ไม่มีรายการใหม่ — ที่ตรงกับคำค้นให้ระบบอ่านไปหมดแล้ว
              (ดูประวัติที่เคยทำด้านล่างได้)</div></div>`
          : `<div class="empty">${icon('mail', 'i')}<div>ไม่พบอีเมลที่ตรงกับคำค้น —
              แก้คำค้นได้ที่ <code>GMAIL_QUERY</code> ในไฟล์ .env</div></div>`);

      el('gmailList').querySelectorAll('[data-mail]').forEach((btn) => {
        btn.addEventListener('click', () => readOneAttachment(btn));
      });

      /* ไล่อ่านให้เองทันทีที่เข้าแท็บ — ทีละไฟล์เรียงกัน ไม่ยิงพร้อมกัน เพราะ GPU มีตัวเดียว
         ยิงพร้อมกันจะแย่งกันจนช้ากว่าเดิมและกินหน่วยความจำการ์ดจอเกิน
         มีปุ่มหยุดให้กดได้ตลอด เพราะกล่องเมลอาจมีหลายฉบับและอ่านนานเป็นนาทีต่อฉบับ */
      autoReadPending();

      el('gmailList').querySelectorAll('[data-dismiss]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const filenames = [...btn.closest('li')?.querySelectorAll('.file') ?? []]
            .map((f) => f.textContent.trim().replace(/^PDF\s*/, ''));
          const label = filenames.length > 1
            ? `${filenames.length} ไฟล์ (${filenames.join(', ')})`
            : filenames[0] ?? 'ฉบับนี้';
          const ok = await confirmModal({
            iconName: 'trash-solid', danger: true,
            title: 'ลบ Timesheet นี้?',
            message: `Timesheet "<b>${esc(label)}</b>" จะหายไปจากรายการ — อีเมลจริงใน Gmail ยังอยู่เหมือนเดิม ไม่ถูกลบ`,
            confirmLabel: 'ลบ',
          });
          if (!ok) return;
          btn.disabled = true;
          try {
            await api('/gmail/dismiss', { method: 'POST', body: JSON.stringify({ messageId: btn.dataset.dismiss }) });
            toast('ลบแล้ว');
            load();
          } catch (error) {
            btn.disabled = false;
            toast(error.message, true);
          }
        });
      });
    } catch (error) {
      el('gmailList').innerHTML = `<div class="note cr">${icon('alt')}<span>${esc(error.message)}</span></div>`;
    }
  };

  // ดึงให้เองอัตโนมัติทันทีที่เข้าแท็บนี้ — เชื่อมกับกล่องเมลอยู่แล้ว ไม่ต้องมีปุ่มให้กดดึงเอง
  if (state.uploadTab === 3) load();
}

const AI_READ_STATUS_LABEL = { pending: 'รอตรวจ', confirmed: 'บันทึกแล้ว', discarded: 'ทิ้งแล้ว' };
const AI_READ_STATUS_TAG = { pending: 'wn', confirmed: 'ok', discarded: 'mu' };
const AI_READ_SOURCE_LABEL = { upload: 'อัปโหลดไฟล์', gmail: 'Gmail' };

/** ประวัติที่ AI เคยอ่านแล้ว — รวมทั้งอัปโหลดไฟล์เองและดึงจาก Gmail ไม่ว่าจะกดยืนยันไปแล้วหรือยังก็ตาม */
function bindAiHistoryTab() {
  const wrap = el('aiHistoryList');
  if (!wrap || state.uploadTab !== 4) return;

  const load = async () => {
    wrap.innerHTML = '<div class="loading">กำลังโหลด…</div>';
    try {
      const rows = await api(`/ai-reads${contractQuery()}`);
      wrap.innerHTML = rows.length
        ? `<div class="tw"><table style="min-width:760px">
            <thead><tr>
              <th>เลขเอกสาร</th><th>เดือน</th><th>ปี</th><th>พนักงาน</th><th>ที่มา</th>
              <th>สถานะ</th><th>วันที่</th><th>เวลา</th><th></th>
            </tr></thead>
            <tbody>${rows.map((r) => {
              const [monthName, yearTh] = (r.periodLabel ?? '— —').split(' ');
              const readAt = toDate(r.readAt);
              const dateStr = readAt
                ? readAt.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }) : '—';
              const timeStr = readAt
                ? readAt.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '—';
              return `
              <tr class="clk" data-hist-open="${r.id}">
                <td class="n">${esc(r.documentNo ?? '—')}</td>
                <td>${esc(monthName ?? '—')}</td>
                <td class="n">${esc(yearTh ?? '—')}</td>
                <td>${esc(r.employeeName ?? '—')}</td>
                <td><span class="tg mu">${esc(AI_READ_SOURCE_LABEL[r.source] ?? r.source)}</span></td>
                <td><span class="tg ${AI_READ_STATUS_TAG[r.status] ?? 'mu'}">${esc(AI_READ_STATUS_LABEL[r.status] ?? r.status)}</span></td>
                <td class="n">${dateStr}</td>
                <td class="n">${timeStr}</td>
                <td class="r">
                  <button class="btn sm" data-hist-view="${r.id}">${icon('file')} ดูรายละเอียด</button>
                  <button class="btn sm dgr" data-hist-del="${r.id}" title="ลบรายการนี้ทิ้ง">${icon('trash')}</button>
                </td>
              </tr>`;
            }).join('')}</tbody>
          </table></div>`
        : `<div class="empty">${icon('file', 'i')}<div>ยังไม่มีประวัติ — ให้ระบบอ่านไฟล์หรือดึงจาก Gmail ก่อน</div></div>`;

      // คลิกที่แถว (หรือปุ่ม "ดูรายละเอียด" ในแถวเดียวกัน) → ดูรายละเอียดในแถบประวัติเลย ไม่ต้องสับไปแท็บอื่น
      // เอา extraction ที่เก็บไว้ตอนอ่านครั้งนั้นมาเป็นการ์ดใหม่ใน state.reads ได้เลย เพราะเก็บ shape เดียวกัน
      // จึงยืนยันและบันทึกเข้าระบบได้จริงจากหน้านี้เหมือนเพิ่งอ่านมาสดๆ ทุกประการ (tab: 4 กันไม่ให้ไปโผล่แท็บอื่น)
      wrap.querySelectorAll('[data-hist-open]').forEach((tr) => {
        tr.addEventListener('click', async (e) => {
          if (e.target.closest('[data-hist-del]')) return;
          try {
            const detail = await api(`/ai-reads/${tr.dataset.histOpen}`);
            if (!detail.extraction) { toast('ไม่พบข้อมูลที่ระบบอ่านไว้สำหรับรายการนี้', true); return; }
            state.reads.push({ ...detail.extraction, _key: genId(), tab: 4 });
            renderUpload();
          } catch (error) {
            toast(error.message, true);
          }
        });
      });

      wrap.querySelectorAll('[data-hist-del]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const ok = await confirmModal({
            iconName: 'trash-solid', danger: true,
            title: 'ลบรายการประวัตินี้?',
            message: 'รายการนี้จะหายไปจากประวัติ — ถ้าเคยบันทึกเข้าระบบแล้ว Timesheet ตัวจริงจะไม่ถูกลบ',
            confirmLabel: 'ลบ',
          });
          if (!ok) return;
          btn.disabled = true;
          try {
            await api('/ai-reads/dismiss', {
              method: 'POST',
              body: JSON.stringify({ id: Number(btn.dataset.histDel) }),
            });
            toast('ลบแล้ว');
            load();
          } catch (error) {
            btn.disabled = false;
            toast(error.message, true);
          }
        });
      });
    } catch (error) {
      wrap.innerHTML = `<div class="note cr">${icon('alt')}<span>${esc(error.message)}</span></div>`;
    }
  };

  load();
}

/** ผลที่ AI อ่านได้ — แก้ได้ทุกช่องก่อนกดยืนยัน
 *  รับได้หลายใบพร้อมกันบนจอ (คนละการ์ด) จึง id ทุกช่องต้องต่อท้ายด้วย key ของใบนั้นๆ
 *  ไม่งั้นซ้ำกันข้ามการ์ด แล้ว document.getElementById จะเจอแค่ใบแรกเสมอ */
/**
 * แตกผลที่ AI อ่านมาเป็นการ์ดตรวจทีละฉบับ
 *
 * ไฟล์เดียวอาจมี Timesheet ของหลายคนต่อกัน (เจอจริงกับไฟล์รวมของ ThaiLife) —
 * ฝั่งระบบแยกให้แล้วใน result.documents คนละฉบับพร้อมผลจับคู่พนักงานของตัวเอง
 * ที่นี่จึงต้องวางเป็นการ์ดแยกกัน ให้คนตรวจและกดยืนยันทีละคน ไม่ใช่ยุบเหลือใบเดียว
 *
 * ค่าระดับไฟล์ (อีเมลต้นทาง · ชื่อไฟล์ · โมเดล) ใช้ร่วมกันทุกฉบับ จึงกระจายลงไปให้ครบทุกใบ
 */

/** ป้ายในดรอปดาวน์ — ชื่อไทยอย่างเดียวไม่พอให้เลือกถูก ต้องเห็นชื่ออังกฤษ ตำแหน่ง และลูกค้าด้วย */
function employeeLabel(e) {
  const parts = [e.name_th];
  if (e.name_en) parts.push(`(${e.name_en})`);
  const tail = [e.invoice_position, e.customer_name].filter(Boolean).join(' · ');
  return tail ? `${parts.join(' ')} — ${tail}` : parts.join(' ');
}

/**
 * เรียงพนักงานให้คนที่ชื่อใกล้เคียงกับที่อ่านมาอยู่บนสุด พร้อมติดดาวไว้
 *
 * ระบบจับคู่อัตโนมัติไม่ได้ก็จริง แต่ "ใกล้เคียง" กับ "ไม่เกี่ยวเลย" ต่างกันมาก —
 * เรียงมั่วตามลำดับในฐานข้อมูลทำให้คนต้องไล่หาเองทั้งรายการ แล้วเลือกผิดได้ง่าย
 * นับตัวอักษรที่ใช้ร่วมกัน (ไม่สนลำดับ) เพราะชื่อที่ AI อ่านเพี้ยนมักสลับตัวอักษร
 */
function rankEmployees(employees, readName) {
  const norm = (v) => String(v ?? '').toLowerCase().replace(/[^a-z\u0E00-\u0E7F]/g, '');
  const target = norm(readName);

  const score = (e) => {
    if (!target) return 0;
    const candidates = [norm(e.name_en), norm(e.name_th)].filter(Boolean);
    return Math.max(0, ...candidates.map((c) => {
      if (!c) return 0;
      const pool = [...c];
      let hit = 0;
      for (const ch of target) {
        const at = pool.indexOf(ch);
        if (at !== -1) { pool.splice(at, 1); hit += 1; }
      }
      return hit / Math.max(target.length, c.length);
    }));
  };

  return employees
    .map((e) => ({ e, s: score(e) }))
    .sort((a, b) => b.s - a.s || a.e.name_th.localeCompare(b.e.name_th, 'th'))
    .map(({ e, s }) => ({ e, close: s >= 0.6 }));
}

/* ── การ์ด "กำลังอ่าน" ───────────────────────────────────────────────
   AI อ่าน Timesheet ใช้เวลาราวหนึ่งนาทีต่อหน้า เอกสารรวมหลายคนจึงกินหลายนาที
   เดิมระหว่างนั้นเห็นแค่ปุ่มที่กดไม่ได้ ไม่มีอะไรบอกว่าคืบหน้าแค่ไหนหรือค้างไปแล้ว
   ตอนนี้พอกดปุ๊บจะได้การ์ดขึ้นมาทันทีในที่เดียวกับที่ผลจะไปโผล่ พร้อมนาฬิกาเดินให้เห็นว่ายังทำงานอยู่ */

const READ_SECONDS_PER_PAGE = 60;   // วัดจากของจริงบนเซิร์ฟเวอร์ ~54 วินาที/หน้า

function pendingReadHtml(read) {
  const secs = Math.floor((Date.now() - read.startedAt) / 1000);
  const mm = String(Math.floor(secs / 60)).padStart(2, '0');
  const ss = String(secs % 60).padStart(2, '0');
  return `
  <div class="card pending" data-read-key="${esc(read._key)}">
    <div class="hd"><h3>${icon('srch')} ${tx('ระบบกำลังอ่าน')}${tx(read.email ? 'เมลและไฟล์แนบ' : 'ไฟล์')}</h3>
      <span class="rt n">${mm}:${ss}</span></div>
    <div class="bd">
      <div class="readwait">
        <div class="bar"><i></i></div>
        <b>${esc(read.fileName ?? tx('ไฟล์ Timesheet'))}</b>
        <span>${tx('อ่านทีละหน้าแล้วรวมผล — เอกสารทั่วไปราว')} ${READ_SECONDS_PER_PAGE} ${tx('วินาทีต่อหน้า')}
          ${tx('ไฟล์ที่รวม Timesheet หลายคนจะใช้เวลาหลายนาที ปล่อยหน้านี้ไว้ได้เลย')}</span>
      </div>
    </div>
  </div>`;
}

/** เดินนาฬิกาบนการ์ดที่กำลังอ่าน — เขียนทับเฉพาะตัวเลข ไม่วาดการ์ดใหม่ทั้งใบ */
let readTicker = null;
function tickPendingReads() {
  clearInterval(readTicker);
  readTicker = setInterval(() => {
    const pending = state.reads.filter((r) => r.pending);
    if (!pending.length) { clearInterval(readTicker); readTicker = null; return; }
    for (const r of pending) {
      const box = document.querySelector(`[data-read-key="${CSS.escape(r._key)}"] .hd .rt`);
      if (!box) continue;
      const secs = Math.floor((Date.now() - r.startedAt) / 1000);
      box.textContent = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
    }
  }, 1000);
}

/** วางการ์ด "กำลังอ่าน" ลงในรายการทันทีที่กดปุ่ม แล้วคืน key ไว้ใช้แทนที่ตอนอ่านเสร็จ */
function startPendingRead({ fileName, email, tab }) {
  const key = genId();
  state.reads.push({ _key: key, tab, pending: true, startedAt: Date.now(), fileName, email });
  renderUpload();
  document.querySelector(`[data-read-key="${CSS.escape(key)}"]`)?.scrollIntoView({ block: 'center' });
  tickPendingReads();
  return key;
}

/** เอาการ์ด "กำลังอ่าน" ออก — ใช้ทั้งตอนสำเร็จและตอนพลาด */
function endPendingRead(key) {
  state.reads = state.reads.filter((r) => r._key !== key);
}


/* ── ไล่อ่านไฟล์แนบใน Gmail ให้เองอัตโนมัติ ────────────────────────────
   เดิมต้องกด "ให้ AI อ่าน" ทีละไฟล์แล้วนั่งรอ ซึ่งเป็นขั้นที่ไม่ได้ตัดสินใจอะไรเลย —
   ยังไงก็ต้องอ่านทุกไฟล์อยู่แล้ว ประตูของคนอยู่ที่ "ยืนยันและบันทึก" ทีหลังต่างหาก */

let autoReadRunning = false;
let autoReadStop = false;
/* ไฟล์ที่ลองอ่านไปแล้วในรอบนี้ — จำเป็นมาก ไม่ใช่แค่ optimization
   เพราะพออ่านเสร็จจะ renderUpload() ซึ่งวาดแท็บ Gmail ใหม่แล้วเรียก autoReadPending() อีกรอบ
   ถ้าไม่จำไว้ ไฟล์เดิมจะถูกอ่านซ้ำไม่รู้จบ (ทดสอบแล้วเจอจริง — 2 ไฟล์ยิงไป 5 ครั้ง)
   อีเมลยังอยู่ในรายการจนกว่าคนจะกดยืนยันบันทึก จึงพึ่งสถานะปุ่มอย่างเดียวไม่ได้ */
const autoReadDone = new Set();
const attachmentKey = (btn) => `${btn.dataset.mail}::${btn.dataset.att ?? ''}`;

/** อ่านไฟล์แนบหนึ่งไฟล์จากปุ่มที่ระบุ — ใช้ร่วมกันทั้งตอนกดเองและตอนไล่อ่านอัตโนมัติ */
async function readOneAttachment(btn) {
  if (btn.disabled) return;
  btn.disabled = true;
  btn.textContent = 'ระบบกำลังอ่านเมลและไฟล์แนบ…';
  /* วางการ์ดรอไว้ก่อนเลย ไม่ต้องให้คนนั่งมองปุ่มที่กดไม่ได้เป็นนาทีๆ
     โดยไม่รู้ว่าระบบยังทำงานอยู่หรือค้างไปแล้ว */
  const pendingKey = startPendingRead({ fileName: btn.dataset.att || null, email: true, tab: 3 });
  try {
    const result = await api('/gmail/read', {
      method: 'POST',
      body: JSON.stringify({ messageId: btn.dataset.mail, attachmentFilename: btn.dataset.att || null }),
    });
    endPendingRead(pendingKey);
    const added = readsFromResult(result, 3);
    state.reads.push(...added);
    /* อ่านจาก added[0] ไม่ใช่ result.data — added มาจาก readsFromResult() ซึ่งรับประกันว่ามี
       อย่างน้อยหนึ่งใบเสมอ ส่วน result.data เป็นแค่สำเนาที่วางไว้ให้โค้ดเดิม ถ้าฝั่งระบบ
       เปลี่ยนรูปแบบเมื่อไหร่ตรงนี้จะพังทั้งการ์ดทั้งที่ข้อมูลมาครบ */
    const first = added[0].data;
    toast(added.length > 1
      ? `อ่านเสร็จ — ไฟล์นี้มี Timesheet ${added.length} คน แยกให้ตรวจทีละคนแล้ว`
      : `อ่านเสร็จ — ${first.employeeName ?? ''} รอบ ${first.period ?? ''}`);
    renderUpload();
    return true;
  } catch (error) {
    endPendingRead(pendingKey);
    renderUpload();
    const back = document.querySelector(`[data-mail="${CSS.escape(btn.dataset.mail)}"][data-att="${CSS.escape(btn.dataset.att ?? '')}"]`);
    if (back) { back.disabled = false; back.innerHTML = `${icon('srch')} อ่านข้อมูล`; }
    toast(error.message, true);
    return false;
  }
}

/** ไล่อ่านทุกไฟล์ที่ยังไม่ได้อ่านในกล่อง ทีละไฟล์ */
async function autoReadPending() {
  // กำลังไล่อ่านอยู่แล้ว — แค่เอาแถบสถานะกลับขึ้นมา เพราะ renderUpload() เพิ่งลบทิ้งไป
  if (autoReadRunning) { restoreAutoReadBar(); return; }

  const queue = [...document.querySelectorAll('#gmailList [data-mail]')]
    .filter((b) => !b.disabled && !autoReadDone.has(attachmentKey(b)));
  if (!queue.length) return;

  autoReadRunning = true;
  autoReadStop = false;
  try {
    for (let i = 0; i < queue.length; i++) {
      if (autoReadStop) break;
      // ปุ่มถูกวาดใหม่ทุกครั้งที่ renderUpload() จึงต้องหาปุ่มตัวปัจจุบันจาก dataset ไม่ใช่ใช้ตัวเดิมที่เก็บไว้
      const { mail, att } = queue[i].dataset;
      const key = `${mail}::${att ?? ''}`;
      if (autoReadDone.has(key)) continue;
      autoReadDone.add(key);   // จำก่อนเริ่มอ่าน ไม่ใช่หลังอ่านเสร็จ — พลาดแล้วก็ไม่ต้องวนอ่านซ้ำเอง
      const live = document.querySelector(`#gmailList [data-mail="${CSS.escape(mail)}"][data-att="${CSS.escape(att ?? '')}"]`);
      if (!live || live.disabled) continue;
      autoReadProgress = { current: i + 1, total: queue.length };
      showAutoReadBar();
      await readOneAttachment(live);
    }
  } finally {
    autoReadRunning = false;
    hideAutoReadBar();
  }
}

let autoReadProgress = null;

function showAutoReadBar() {
  const list = el('gmailList');
  if (!list || !autoReadProgress) return;
  let bar = el('autoReadBar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'autoReadBar';
    bar.className = 'note info autoread';
    list.prepend(bar);
  }
  const { current, total } = autoReadProgress;
  bar.innerHTML = `${icon('srch')}<span>กำลังไล่อ่านให้อัตโนมัติ — ไฟล์ที่ ${int(current)} จาก ${int(total)}</span>
    <button class="btn sm" id="autoReadStopBtn" type="button">หยุด</button>`;
  el('autoReadStopBtn').addEventListener('click', () => {
    autoReadStop = true;
    toast('หยุดแล้ว — ไฟล์ที่กำลังอ่านอยู่จะอ่านให้จบก่อน ที่เหลือกดอ่านเองได้');
  });
}

/** เอาแถบกลับขึ้นมาหลัง renderUpload() วาดรายการเมลใหม่ */
function restoreAutoReadBar() { if (autoReadRunning) showAutoReadBar(); }

function hideAutoReadBar() { autoReadProgress = null; el('autoReadBar')?.remove(); }

function readsFromResult(result, tab) {
  const { documents, data, verification, matching, contract, blockers, documentNo, ...shared } = result;
  const list = documents?.length
    ? documents
    : [{ data, verification, matching, contract, blockers, documentNo }];

  return list.map((doc, i) => ({
    ...shared,
    ...doc,
    documentNo: doc.documentNo ?? documentNo ?? null,
    _key: genId(),
    tab,
    /* บอกว่าเป็นใบที่เท่าไรจากไฟล์เดียวกัน — ไม่งั้นเห็นสองการ์ดแล้วนึกว่าอ่านซ้ำ */
    partOfFile: list.length > 1 ? { index: i + 1, total: list.length } : null,
  }));
}

/** ส่วน "หัก ณ ที่จ่าย" ในหน้าตรวจ Timesheet ก่อนยืนยัน — อยู่ระหว่าง "เทียบกับ HRDD" กับ "ลายเซ็น"
 * ตั้งต้นจากอัตราที่ตั้งไว้ในสัญญาอยู่แล้ว (contract.whtRate) เลือกประเภท/ปรับ % แล้วกดยืนยันตอนท้าย
 * จะอัปเดตอัตราของสัญญานี้ให้ด้วย (ดู confirmBtn ใน bindUploadTab()) — ไม่มีสัญญาให้ยังเลือกไม่ได้ */
function whtSectionHtml(read, key) {
  if (!read.contract) {
    return `<div class="fsec">
      <div class="fsec-h"><b>${icon('money', 'i sm')} หัก ณ ที่จ่าย</b></div>
      <div class="note">${icon('info')}<span>จับคู่ชื่อพนักงานกับคนในระบบก่อน ถึงจะเลือกประเภทหัก ณ ที่จ่ายได้</span></div>
    </div>`;
  }
  const defaultPct = Math.round((read.contract.whtRate ?? 0.03) * 100);
  const base = Number(read.contract.monthlyRate) || 0;
  return `<div class="fsec">
    <div class="fsec-h"><b>${icon('money', 'i sm')} หัก ณ ที่จ่าย</b>
      <span style="font-size:12px;color:var(--mut)">ตามที่ฝ่ายบัญชีกำหนด</span></div>
    <div class="wht-types" data-wht-types>
      ${WHT_TYPES.map((w) => `<div class="wht-type ${w.pct === defaultPct ? 'on' : ''}" data-pct="${w.pct}">
        <div class="nm">${esc(w.name)}</div><div class="code">${w.pct}%</div></div>`).join('')}
    </div>
    <div class="stepper-row">
      <div class="lbl">อัตราหัก ณ ที่จ่าย<small>ปรับได้เองถ้าเงื่อนไขต่างจากค่ามาตรฐานของประเภทที่เลือก</small></div>
      <div class="stepper">
        <button type="button" class="whtMinus">−</button>
        <span class="val" data-wht-val>${defaultPct}%</span>
        <button type="button" class="whtPlus">+</button>
      </div>
    </div>
    <div class="wht-result">
      <span>หัก ณ ที่จ่าย <span data-wht-pct-label>${defaultPct}</span>% จากยอดประมาณ ${money(base)}</span>
      <span data-wht-amount>−${money(Math.round(base * defaultPct) / 100)}</span>
    </div>
    <input type="hidden" id="rWht-${key}" value="${defaultPct}">
  </div>`;
}

function readResultHtml(read, employees = []) {
  const key = read._key;
  const d = read.data;
  /* บล็อกจากช่องสรุปวันลาไม่ตรงกับรายการ และบล็อกจากสถานะในเมล แก้ในหน้านี้ได้เองแล้ว
     (ตารางวันลาแก้ไขได้ / สถานะมีดรอปดาวน์ให้เลือกจริง) จึงไม่ต้องล็อกปุ่มไว้ตายด้วยค่าตอนอ่านครั้งแรก
     ปุ่มยืนยันจะเช็คค่าล่าสุดบนจอตอนกดอีกที — บล็อกอื่น (จับคู่ชื่อไม่ได้/ไม่มีสัญญา/รอบเดือนผิด)
     ยังคงล็อกปุ่มไว้เหมือนเดิม แก้ในหน้านี้ไม่ได้ */
  const hardBlockers = read.blockers.filter((b) =>
    !b.startsWith('ช่องสรุประบุวันลา') && !b.startsWith('อีเมลระบุ'));
  const blocked = hardBlockers.length > 0;
  const docInput = `<input id="uDoc-${key}" type="text" placeholder="เช่น 2026020101" autocomplete="off"
                       value="${esc(read.documentNo ?? '')}">`;
  /* ไฟล์ต้นฉบับที่ AI อ่าน — เปิดดู/ดาวน์โหลดได้เฉพาะที่ดึงมาจาก Gmail เพราะยังอยู่ในเมล
     ไฟล์ที่อัปโหลดตรงยังไม่มีสำเนาในระบบจนกว่าจะกดยืนยัน (ตอนนั้นดูได้ที่หน้า Timesheet) */
  const srcFile = read.sourceEmailId && read.fileName
    ? `/api/gmail/${encodeURIComponent(read.sourceEmailId)}/attachment?filename=${encodeURIComponent(read.fileName)}`
    : null;

  return `
  <div class="card" data-read-key="${esc(key)}">
    <div class="hd"><h3>${tx('ข้อมูลที่อ่านได้')}${tx(read.email ? 'จากอีเมลและไฟล์แนบ' : 'จากไฟล์')}${
      d.employeeName ? ` — ${esc(d.employeeName)}` : ''}</h3>
      ${read.partOfFile ? `<span class="tg mu">${tx('ใบที่')} ${read.partOfFile.index} ${tx('จาก')} ${read.partOfFile.total} ${tx('ในไฟล์เดียวกัน')}</span>` : ''}</div>
    <div class="bd">
      ${srcFile ? `<div class="attrow" style="margin-bottom:14px">
        <a class="file" href="${esc(srcFile)}" target="_blank" rel="noopener"
           title="${tx('เปิดดูไฟล์ต้นฉบับที่ระบบอ่าน')}"><span class="pd">PDF</span> ${esc(read.fileName)}</a>
        <a class="btn sm icon" href="${esc(srcFile)}&dl" download="${esc(read.fileName)}"
           title="${tx('ดาวน์โหลดไฟล์ต้นฉบับ')}" aria-label="${tx('ดาวน์โหลด')}">${icon('cd')}</a>
      </div>` : ''}
      ${read.email ? `<div class="cmp" style="margin-bottom:16px">
        <div class="f"><span class="l">${state.lang === 'en' ? 'From' : 'จาก'}</span><span>${esc(read.email.from)}</span></div>
        <div class="f sj"><span class="l">${tx('เรื่อง')}</span><span>${esc(read.email.subject)}</span></div>
        <div class="f"><span class="l">${tx('เลขเอกสาร')}</span>${docInput}</div>
      </div>` : `<div class="frm" style="margin-bottom:16px"><label>${tx('เลขเอกสาร')}${docInput}</label></div>`}
      ${blocked ? `<div class="note cr">${icon('alt')}<span>
        <strong>${tx('ยังบันทึกไม่ได้')} ${hardBlockers.length} ${tx('ข้อ')}</strong><br>
        ${hardBlockers.map(esc).join('<br>')}</span></div>` : ''}

      <div class="g2">
        <div class="frm">
          <label>${tx('ชื่อพนักงานตามที่เขียนในไฟล์')}
            <input id="rName-${key}" type="text" value="${esc(d.employeeName ?? '')}">
            ${!read.matching.employee ? `
              <small>${tx('จับคู่กับพนักงานในระบบไม่ได้ — เลือกว่าชื่อนี้คือใคร แล้วกดเพิ่มเป็นชื่อพ้อง')}
                ${tx('ครั้งต่อไประบบจะจับคู่ให้เอง')}</small>
              <div class="fixa-picker">
                <span class="selectchip grow"><select id="rAliasEmp-${key}">
                  <option value="">${tx('— เลือกพนักงานที่ตรงกับชื่อนี้ —')}</option>
                  ${rankEmployees(employees, d.employeeName).map(({ e, close }) => `
                    <option value="${esc(e.id)}">${close ? '★ ' : ''}${esc(employeeLabel(e))}</option>`).join('')}
                </select>${icon('cd')}</span>
                <button class="btn sm pri rAliasAdd" type="button" disabled>${icon('chk')} ${tx('เพิ่มเป็นชื่อพ้อง')}</button>
              </div>` : ''}
          </label>
          <label>${tx('ตำแหน่งตามที่เขียนในไฟล์')}
            <input id="rPos-${key}" type="text" value="${esc(d.position ?? '')}">
          </label>
          <label>${tx('รอบเดือน')}<input id="rPeriod-${key}" type="month" value="${esc(d.period ?? '')}"></label>
        </div>
        <div class="frm">
          <label>${tx('วันทำงานที่ระบุท้ายตาราง')}
            <input id="rWork-${key}" type="number" min="0" max="31" value="${int(d.totalWorkDays)}">
          </label>
          <label>${tx('วันลาที่ระบุท้ายตาราง')}
            <input id="rLeave-${key}" type="number" min="0" max="31" value="${int(d.totalLeaveDays)}">
          </label>
          <label>${tx('ผู้อนุมัติฝั่งลูกค้า')}
            <input id="rBy-${key}" type="text"
              value="${esc(read.approvedBy ?? d.projectManagerSignatureName ?? 'Project Manager (TLI)')}">
            ${read.approvedAt ? `<small>${tx('อีเมลระบุวันที่อนุมัติ')} ${dateOnly(read.approvedAt)}</small>` : ''}
          </label>
        </div>
      </div>

      <div class="fsec" style="display:none">
        <!-- ซ่อนไว้ตามที่ขอ (25 ส.ค. 69) — ไม่ให้แก้วันลาตรงนี้ตรงๆอีกต่อไป ให้แก้ผ่านปุ่ม "แก้ไข"
             ในตาราง "เทียบกับ HRDD" ด้านล่างแทนที่เดียว แต่ต้องคง .rLeaveRows/.lrow ไว้ในหน้าเว็บ
             เพราะเป็นที่เก็บข้อมูลวันลาจริงที่ตอนกดยืนยันจะอ่านไปบันทึก (ดู confirmBtn ท้ายไฟล์นี้) -->
        <div class="fsec-h"><b>${tx('วันลาที่อ่านได้')}</b>
          <button class="btn sm rAddLeave" type="button">${tx('+ เพิ่มวันลา')}</button></div>
        <div class="rLeaveRows">${(d.leaveDays ?? []).map((l) => `
          <div class="lrow">
            <input type="date" class="ldate" value="${esc(l.date)}">
            <select class="ltype">
              ${Object.entries(LEAVE_OPTIONS).map(([v, label]) =>
                `<option value="${v}" ${l.type === v ? 'selected' : ''}>${tx(label)}</option>`).join('')}
            </select>
            <button class="btn sm dgr lrm" type="button">${tx('ลบ')}</button>
          </div>`).join('')}</div>
      </div>

      <div class="fsec hrdd">
        <div class="fsec-h"><b>${icon('list-chk', 'i sm')} ${tx('เทียบกับ HRDD (ระบบเช็คชื่อบริษัทหลัก)')}</b>
          <div class="hrdd-actions">
            <span class="hrddMeta"></span>
            <button class="btn sm hrddRefreshBtn" type="button">${icon('rf', 'i sm')} ${tx('รีเฟรชจาก HRDD')}</button>
          </div></div>
        <div class="hrddBody">${read.matching.employee
          ? `<div class="loading">${tx('กำลังตรวจสอบวันลากับ HRDD…')}</div>`
          : `<div class="note">${icon('info')}<span>${tx('จับคู่ชื่อพนักงานกับคนในระบบก่อน (ด้านบน) ถึงจะเทียบกับ HRDD ได้')}</span></div>`}</div>
      </div>

      ${whtSectionHtml(read, key)}

      <div class="fsec">
        <div class="fsec-h"><b>${tx('ลายเซ็น')}</b></div>
        <ul class="cks">
          <li><span class="l">${tx('พนักงาน')}</span>
            <span class="v ${d.signedByEmployee ? '' : 'mu'}">${d.signedByEmployee
              ? esc(d.employeeSignatureName || read.matching.employee?.nameTh || d.employeeName || tx('พบลายเซ็น'))
              : '—'}</span></li>
          <li><span class="l">${tx('ผู้อนุมัติฝั่งลูกค้า')}</span>
            <span class="v ${d.signedByProjectManager ? '' : 'mu'}">${d.signedByProjectManager
              ? esc(d.projectManagerSignatureName || read.approvedBy || tx('พบลายเซ็น'))
              : '—'}</span></li>
        </ul>
      </div>

      <details class="raw"><summary>${tx('ดู JSON ดิบที่ระบบอ่านออกมา')}</summary>
        <pre class="code">${esc(JSON.stringify(d, null, 2))}</pre></details>
    </div>
    <div class="ft review-ft">
      <button class="btn ghost discardBtn" type="button">${icon('trash', 'i sm')} ${tx('ทิ้งผลนี้')}</button>
      <button class="btn pri lg confirmBtn" type="button" data-blocked="${blocked}" ${blocked ? 'disabled' : ''}>
        ${icon('chk')} ${tx('ยืนยันและบันทึกเข้าระบบ')}</button>
    </div>
  </div>`;
}

function bindUploadTab() {
  const input = el('fileInput');
  const zone = el('dropZone');
  if (!input) return;

  let picked = null;

  const take = (file) => {
    if (!file) return;
    if (file.type !== 'application/pdf') { toast('รับเฉพาะไฟล์ PDF', true); return; }
    if (file.size > 8_000_000) { toast('ไฟล์ใหญ่เกิน 8 MB', true); return; }
    picked = file;
    el('dropName').textContent = file.name;
    zone.classList.add('has');
    el('readBtn').disabled = false;
  };

  input.addEventListener('change', () => take(input.files[0]));
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('over');
    take(e.dataTransfer.files[0]);
  });

  el('readBtn').addEventListener('click', async () => {
    let pendingKey = null;   // ประกาศนอก try เพื่อให้ catch เอาการ์ดรอออกได้ด้วย
    if (!picked) return;
    const btn = el('readBtn');
    btn.disabled = true;
    btn.textContent = 'ระบบกำลังอ่านไฟล์… (อ่านทีละหน้า อาจใช้เวลาหลายนาทีถ้าไฟล์มีหลายหน้า)';
    try {
      // ส่ง contractId ของบริษัทที่กำลังดำเนินการอยู่ไปด้วย — ให้ backend เลือก Skill ABBYY เฉพาะ
      // สัญญานี้ถ้าเคยตั้งไว้ (28 ส.ค. 69 ตามที่ขอ) ผู้ใช้เลือกบริษัทจากแถบบนไว้ก่อนอัปโหลดอยู่แล้วเสมอ
      const body = JSON.stringify({
        fileBase64: await fileToBase64(picked), fileName: picked.name, contractId: state.contractId,
      });
      // การ์ดรอขึ้นทันทีเหมือนฝั่ง Gmail — ดูเหตุผลที่ startPendingRead()
      pendingKey = startPendingRead({ fileName: picked.name, email: false, tab: 1 });
      const result = await api('/timesheets/read', { method: 'POST', body });
      endPendingRead(pendingKey);
      const added = readsFromResult(result, 1);
      state.reads.push(...added);
      const first = added[0].data;   // ดูเหตุผลที่ไม่ใช้ result.data ในตัวจัดการฝั่ง Gmail
      toast(added.length > 1
        ? `อ่านไฟล์เสร็จ — ไฟล์นี้มี Timesheet ${added.length} คน แยกให้ตรวจทีละคนแล้ว`
        : `อ่านไฟล์เสร็จ — ${first.employeeName ?? ''} รอบ ${first.period ?? ''}`);
      renderUpload();
    } catch (error) {
      if (pendingKey) { endPendingRead(pendingKey); renderUpload(); }
      btn.disabled = false;
      btn.innerHTML = `${icon('srch')} อ่านไฟล์นี้`;
      toast(error.message, true);
    }
  });

  /* ผลที่ AI อ่านได้มีได้หลายใบพร้อมกันบนจอ (อีเมลเดียวมีไฟล์แนบของหลายคนก็เจอบ่อย) แต่ละการ์ด
     ผูก event ของตัวเองผ่าน data-read-key แทนการอ้าง id เดี่ยวแบบตอนมีใบเดียว — field(name) หา
     ช่องกรอกในการ์ดนี้เท่านั้นด้วย id ที่ต่อท้ายด้วย key เดียวกับที่ readResultHtml() ตั้งไว้ */
  main.querySelectorAll('[data-read-key]').forEach((card) => {
    const key = card.dataset.readKey;
    const entry = () => state.reads.find((r) => r._key === key);
    const field = (name) => card.querySelector(`#${name}-${key}`);

    card.querySelector('.discardBtn')?.addEventListener('click', () => {
      state.reads = state.reads.filter((r) => r._key !== key);
      renderUpload();
    });

    // จับคู่ชื่อไม่ได้ทั้งหมด (ไม่ใช่แค่ใกล้เคียงต้องยืนยัน) จึงไม่มีพนักงานให้เสนอปุ่มลัดแบบหน้ารายละเอียด
    // ให้คนเลือกจากลิสต์เองแทน — ยังเป็นคนยืนยันเองอยู่ดี ไม่ใช่ AI เดา แค่เปลี่ยนจาก "พิมพ์ชื่อ" เป็น "เลือกจากลิสต์"
    /* ปุ่มเพิ่มชื่อพ้องเปิดใช้ได้ต่อเมื่อเลือกคนแล้วเท่านั้น — เดิมกดได้ตลอดแล้วเด้ง toast
       ว่า "เลือกพนักงานก่อน" ซึ่งเป็นการปล่อยให้กดผิดก่อนแล้วค่อยบอก */
    const aliasSel = card.querySelector(`#rAliasEmp-${CSS.escape(key)}`);
    const aliasBtn = card.querySelector('.rAliasAdd');
    aliasSel?.addEventListener('change', () => { aliasBtn.disabled = !aliasSel.value; });

    card.querySelector('.rAliasAdd')?.addEventListener('click', async () => {
      const sel = field('rAliasEmp');
      const empId = sel.value;
      if (!empId) { toast('เลือกพนักงานก่อน', true); return; }
      const btn = card.querySelector('.rAliasAdd');
      btn.disabled = true;
      try {
        const alias = field('rName').value.trim() || entry().data.employeeName;
        await api(`/employees/${encodeURIComponent(empId)}/aliases`, {
          method: 'POST',
          body: JSON.stringify({ kind: 'name', alias }),
        });
        const employees = await api('/employees');
        const picked = employees.find((e) => e.id === empId);
        const current = entry();
        current.matching = {
          ...current.matching,
          employee: picked
            ? { id: picked.id, nameTh: picked.name_th, invoicePosition: picked.invoice_position }
            : null,
        };
        current.blockers = current.blockers.filter((b) => !b.startsWith('จับคู่ชื่อ'));
        toast(`เพิ่มชื่อพ้อง "${alias}" ให้ ${picked?.name_th ?? ''} แล้ว`);
        renderUpload();
      } catch (error) {
        btn.disabled = false;
        toast(error.message, true);
      }
    });

    card.querySelector('.rAddLeave')?.addEventListener('click', () => addLeaveRow(card.querySelector('.rLeaveRows')));
    card.querySelectorAll('.rLeaveRows .lrm').forEach((btn) => {
      btn.addEventListener('click', () => btn.closest('.lrow').remove());
    });

    card.querySelector('.hrddRefreshBtn')?.addEventListener('click', () => runHrddPreviewCompare(card, entry));
    if (entry().matching.employee) runHrddPreviewCompare(card, entry);

    // ═══ หัก ณ ที่จ่าย — เลือกประเภท/ปรับ % แล้วอัปเดตค่านี้ลงในช่องซ่อนไว้ยิงตอนยืนยัน (ดู confirmBtn) ═══
    (() => {
      const whtTypes = card.querySelector('[data-wht-types]');
      if (!whtTypes) return;
      const base = Number(entry().contract?.monthlyRate) || 0;
      const valEl = card.querySelector('[data-wht-val]');
      const pctLabelEl = card.querySelector('[data-wht-pct-label]');
      const amtEl = card.querySelector('[data-wht-amount]');
      const hiddenEl = field('rWht');
      const renderWht = (pct) => {
        valEl.textContent = `${pct}%`;
        pctLabelEl.textContent = pct;
        amtEl.textContent = `−${money(Math.round(base * pct) / 100)}`;
        hiddenEl.value = pct;
      };
      whtTypes.addEventListener('click', (e) => {
        const t = e.target.closest('.wht-type');
        if (!t) return;
        whtTypes.querySelectorAll('.wht-type').forEach((x) => x.classList.toggle('on', x === t));
        renderWht(Number(t.dataset.pct));
      });
      card.querySelector('.whtPlus')?.addEventListener('click', () =>
        renderWht(Math.min(30, parseInt(valEl.textContent, 10) + 1)));
      card.querySelector('.whtMinus')?.addEventListener('click', () =>
        renderWht(Math.max(0, parseInt(valEl.textContent, 10) - 1)));
    })();

    card.querySelector('.confirmBtn')?.addEventListener('click', async () => {
      const btn = card.querySelector('.confirmBtn');
      const documentNo = field('uDoc').value.trim();
      if (!documentNo) { toast('ต้องกรอกเลขที่เอกสารก่อนบันทึก', true); return; }

      // เก็บวันลาจากตารางในหน้านี้ — ยึดตามที่เห็นบนจอ ไม่ใช่ผลดิบตอน AI อ่านครั้งแรก
      // (คนอาจแก้ไปแล้วถ้า AI อ่านตกหรือเกิน — ดูคอมเมนต์เหตุผลที่ hardBlockers ด้านบน)
      const leaveDays = [...card.querySelectorAll('.rLeaveRows .lrow')]
        .map((r) => ({ date: r.querySelector('.ldate').value, type: r.querySelector('.ltype').value }))
        .filter((l) => l.date);
      const totalLeaveDays = Number(field('rLeave').value);
      if (leaveDays.length !== totalLeaveDays) {
        toast(
          `ช่องสรุประบุวันลา ${totalLeaveDays} วัน แต่รายการวันลาในตารางมี ${leaveDays.length} รายการ — แก้ให้ตรงกันก่อน`,
          true,
        );
        return;
      }

      btn.disabled = true;
      const current = entry();
      const edited = {
        ...current.data,
        employeeName: field('rName').value.trim(),
        position: field('rPos').value.trim(),
        period: field('rPeriod').value,
        totalWorkDays: Number(field('rWork').value),
        totalLeaveDays,
        leaveDays,
      };

      // ถ้าเปลี่ยนประเภท/อัตราหัก ณ ที่จ่ายไว้ต่างจากที่สัญญาตั้งไว้เดิม อัปเดตให้สัญญานี้ก่อน
      // ยิงแยกจากบันทึก Timesheet เอง — ถ้าอัปเดตไม่สำเร็จ (เช่นไม่ใช่แอดมิน) ไม่ควรบล็อกการยืนยัน Timesheet
      const whtField = field('rWht');
      if (whtField && current.contract) {
        const newPct = Number(whtField.value);
        const currentPct = Math.round((current.contract.whtRate ?? 0.03) * 100);
        if (Number.isFinite(newPct) && newPct !== currentPct) {
          try {
            await api(`/contracts/${encodeURIComponent(current.contract.id)}/wht-rate`, {
              method: 'PATCH',
              body: JSON.stringify({ whtRate: newPct / 100 }),
            });
          } catch (error) {
            toast(`บันทึก Timesheet ต่อได้ แต่ปรับอัตราหัก ณ ที่จ่ายให้สัญญาไม่สำเร็จ: ${error.message}`, true);
          }
        }
      }

      try {
        const r = await api('/timesheets/confirm', {
          method: 'POST',
          body: JSON.stringify({
            documentNo,
            extraction: edited,
            fileName: current.fileName,
            readModel: current.model,
            approvedBy: field('rBy').value.trim() || null,
            // มาจาก Gmail ก็ผูกเลขอีเมล+หัวข้อไว้ด้วย จะได้รู้ว่าใบนี้มาจากเมลฉบับไหน
            sourceEmailId: current.sourceEmailId ?? null,
            sourceEmailSubject: current.email?.subject ?? null,
            approvedAt: current.approvedAt ?? null,
          }),
        });
        state.reads = state.reads.filter((r2) => r2._key !== key);
        if (r.nextAction === 'needs_match') { toast(r.reason, true); renderUpload(); return; }
        toast(`บันทึกแล้ว — ${r.status} · วางบิลได้ ${r.manday?.payableDays ?? '–'} วัน · ไปตรวจต่อได้เลย`);
        openSheet(r.timesheetId);
        syncBadges();
      } catch (error) {
        btn.disabled = false;
        toast(error.message, true);
      }
    });
  });
}

function bindManualTab(contracts) {
  if (!el('eSave')) return;
  addLeaveRow();
  el('eAddLeave').addEventListener('click', () => addLeaveRow());

  el('eSave').addEventListener('click', async () => {
    const leaveDays = [...document.querySelectorAll('.lrow')]
      .map((r) => ({ date: r.querySelector('.ldate').value, type: r.querySelector('.ltype').value }))
      .filter((l) => l.date);

    const btn = el('eSave');
    btn.disabled = true;
    try {
      const r = await api('/timesheets/manual', {
        method: 'POST',
        body: JSON.stringify({
          employeeName: el('eName').value.trim(),
          position: el('ePos').value.trim(),
          period: el('ePeriod').value,
          leaveDays,
          approvedBy: el('eBy').value.trim() || null,
          approvedAt: el('eAt').value || null,
          customerId: contracts[0]?.customer_id ?? null,
        }),
      });
      // endpoint คืนคีย์ชื่อ timesheetId ไม่ใช่ id — เคยพลาดตรงนี้จนเกิด uncaught error
      toast(`บันทึกแล้ว — ${r.status} · วางบิลได้ ${r.manday?.payableDays ?? '–'} วัน`);
      openSheet(r.timesheetId);
    } catch (error) {
      btn.disabled = false;
      toast(error.message, true);
    }
  });
}

/** แถววันลา — เพิ่มได้เรื่อยๆ ลบทีละแถวได้ — ใช้ทั้งแท็บ "กรอกเอง" และหน้าแก้ผลที่ AI อ่านได้ */
function addLeaveRow(target = 'eLeaves') {
  const box = typeof target === 'string' ? el(target) : target;
  const row = document.createElement('div');
  row.className = 'lrow';
  row.innerHTML = `
    <input type="date" class="ldate">
    <select class="ltype">
      ${Object.entries(LEAVE_OPTIONS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
    </select>
    <button class="btn sm dgr lrm">ลบ</button>`;
  row.querySelector('.lrm').addEventListener('click', () => row.remove());
  box.appendChild(row);
}

/* ══ ข้อมูลหลัก — รวมสามหน้าเดิมไว้ในหน้าเดียว ═══════════════
   ไม่ใช่ขั้นตอนการทำงาน แต่เป็นที่แก้เมื่อขั้นที่ 2 บอกว่าจับคู่ไม่ได้หรือเรทไม่ตรง
   ถ้าไม่มีหน้านี้ พนักงานคนใหม่เข้ามาทีต้องเรียกโปรแกรมเมอร์มาแก้ฐานข้อมูล */

/**
 * แท็กชื่อพ้อง/ตำแหน่งพ้อง — คลิกที่แท็กเพื่อแก้ไข (ลบของเดิม+เพิ่มของใหม่ให้ในคลิกเดียว)
 * มีปุ่ม "+" ต่อท้ายเพื่อเพิ่มรายการใหม่ — ทั้งสองอย่างเปิดเป็น input ในหน้า ไม่ใช้ prompt()
 * เพราะคนใช้จริงมองว่าปุ่มเดิม "กดแล้วไม่มีอะไรเกิดขึ้น" (popup ของเบราว์เซอร์ไม่เด่นพอ)
 */
function renderAliasCell(e, kind, aliases) {
  const edit = state.aliasEdit;
  const addingHere = edit?.mode === 'add' && edit.empId === e.id && edit.kind === kind;
  const label = tx(kind === 'name' ? 'ชื่อพ้อง' : 'ตำแหน่งพ้อง');

  const tags = aliases.map((a) => {
    const editingThis = edit?.mode === 'edit' && edit.empId === e.id && edit.kind === kind && edit.original === a.alias;
    if (editingThis) {
      return `<span class="tg alias editing">
        <input type="text" class="aliasInput" value="${esc(a.alias)}" data-emp="${esc(e.id)}"
          data-kind="${kind}" data-mode="edit" data-original="${esc(a.alias)}">
        <button class="ax save" data-emp="${esc(e.id)}" data-kind="${kind}" title="${tx('บันทึก')}">✓</button>
        <button class="ax cancel" title="${tx('ยกเลิก')}">×</button>
      </span>`;
    }
    return `<span class="tg alias-${kind} alias aliastag" title="${esc(a.source ?? '')} — ${tx('คลิกเพื่อแก้ไข')}"
        data-emp="${esc(e.id)}" data-kind="${kind}" data-alias="${esc(a.alias)}">${esc(a.alias)}<button
        class="ax rm" data-emp="${esc(e.id)}" data-kind="${kind}"
        data-alias="${esc(a.alias)}" title="${tx('ลบ')}${label}${tx('นี้')}">×</button></span>`;
  }).join(' ');

  const addRow = addingHere
    ? `<span class="tg alias editing">
        <input type="text" class="aliasInput" placeholder="${label}${tx('ใหม่')}" data-emp="${esc(e.id)}" data-kind="${kind}" data-mode="add">
        <button class="ax save" data-emp="${esc(e.id)}" data-kind="${kind}" title="${tx('บันทึก')}">✓</button>
        <button class="ax cancel" title="${tx('ยกเลิก')}">×</button>
      </span>`
    : `<button class="lk addal" data-emp="${esc(e.id)}" data-kind="${kind}">+ ${label}</button>`;

  return `${tags || (addingHere ? '' : `<span class="sub">${tx('ไม่มี')}</span> `)}${tags ? ' ' : ''}<div class="arow">${addRow}</div>`;
}

/**
 * เรทต่อเดือน — คลิก "แก้เรท" เพื่อแก้ในหน้าได้ทันที แทน prompt() แบบเดิม
 * จำเป็นต้องมี เพราะเป็นทางเดียวที่แก้เรทได้จากหน้าเว็บ (ไม่งั้นต้องรัน SQL ตรง)
 */
function renderRateCell(e) {
  if (!e.assignment_id) return money(e.monthly_rate);

  if (state.rateEdit === e.assignment_id) {
    return `<div class="rateEditRow">
      <input type="number" step="0.01" min="0" class="rateInput" value="${e.monthly_rate}"
        data-asg="${esc(e.assignment_id)}" data-name="${esc(e.name_th)}">
      <button class="ax save" title="${tx('บันทึก')}">✓</button>
      <button class="ax cancel" title="${tx('ยกเลิก')}">×</button>
    </div>`;
  }

  return `${money(e.monthly_rate)}
    <button class="lk edrate" data-asg="${esc(e.assignment_id)}"
      data-name="${esc(e.name_th)}">${tx('แก้เรท')}</button>`;
}

/**
 * ฟอร์ม "เพิ่มลูกค้าใหม่" — สร้างลูกค้า + สัญญาแรกของลูกค้ารายนั้นในคราวเดียว เพราะในระบบนี้
 * ลูกค้าที่ไม่มีสัญญาเลยใช้งานอะไรไม่ได้ (ไม่มีอัตราจ้าง ไม่มีรอบบิล) แยกเป็นสองปุ่มจะสร้างสถานะ
 * "ลูกค้าลอยๆ ไม่มีสัญญา" ที่ไม่มีที่ไหนในระบบรองรับ
 */
function renderCustomerAddForm(faCompanies = []) {
  return `
  <div class="card">
    <div class="hd"><h3>${tx('เพิ่มลูกค้าใหม่')}</h3>
      <span class="rt">${tx('กรอกข้อมูลบริษัทและสัญญาแรกในคราวเดียว')}</span></div>
    <div class="bd">
      ${faCompanies.length ? `
      <div class="frm" style="margin-bottom:16px">
        <label>${tx('ดึงข้อมูลจาก FlowAccount')}
          <span class="selectchip grow"><select id="ncFromFA">
            <option value="">${tx('— เลือกบริษัทจากใบเสนอราคาที่มีอยู่แล้ว —')}</option>
            ${faCompanies.map((c, i) => `<option value="${i}">${esc(c.nameTh)} (${esc(c.quotationNo ?? '—')})</option>`).join('')}
          </select></span>
        </label>
        <small class="fhint" id="ncFaEmpHint"></small>
      </div>` : ''}
      <div class="frm">
        <label>${tx('ชื่อบริษัท')}<input id="ncNameTh" type="text" placeholder="เช่น บริษัท ทดสอบ จำกัด" autocomplete="off"></label>
        <label>${tx('เลขผู้เสียภาษี')}<input id="ncTaxId" type="text" autocomplete="off"></label>
        <label>${tx('สาขา')}<input id="ncBranch" type="text" value="สำนักงานใหญ่" autocomplete="off"></label>
        <label>${tx('ที่อยู่')}<input id="ncAddress" type="text" autocomplete="off"></label>
        <label>${tx('เครดิต (วัน)')}<input id="ncCreditDays" type="number" min="0" value="30"></label>
        <label>${tx('ผู้ประสานงาน')}<input id="ncContactName" type="text" autocomplete="off"></label>
        <label>${tx('เบอร์ผู้ประสานงาน')}<input id="ncContactPhone" type="text" autocomplete="off"></label>
        <label>${tx('อีเมลผู้ประสานงาน')}<input id="ncContactEmail" type="email" autocomplete="off"></label>
        <label>${tx('สถานที่วางบิล')}<input id="ncBillingPlace" type="text" autocomplete="off"></label>
      </div>
      <div class="fsec">
        <div class="fsec-h"><b>${tx('สัญญาแรก')}</b></div>
        <div class="frm">
          <label>${tx('เลขที่ใบว่าจ้าง (PO)')}<input id="ncPoNo" type="text" placeholder="เช่น 26/B0200" autocomplete="off"></label>
          <label>${tx('เลขที่สัญญา')}<input id="ncContractNo" type="text" autocomplete="off"></label>
          <label>${tx('ชื่อโครงการ')}<input id="ncProjectName" type="text" autocomplete="off"></label>
          <label>${tx('ตัวหารอัตราต่อวัน')}
            <span class="selectchip grow"><select id="ncDivisorMode">
              <option value="fixed" selected>${tx('คงที่ (ระบุจำนวนวัน)')}</option>
              <option value="actual_working_days">${tx('วันทำงานจริงของเดือน')}</option>
            </select></span>
          </label>
          <label>${tx('จำนวนวัน (ถ้าคงที่)')}<input id="ncDivisorValue" type="number" min="1" value="20"></label>
          <label>${tx('วันเริ่มสัญญา')}<input id="ncStartDate" type="date"></label>
          <label>${tx('วันสิ้นสุดสัญญา')}<input id="ncEndDate" type="date"></label>
          <label>VAT (%)<input id="ncVat" type="number" min="0" max="100" step="0.1" value="7"></label>
          <label>${tx('หัก ณ ที่จ่าย')} (%)<input id="ncWht" type="number" min="0" max="100" step="0.1" value="3"></label>
        </div>
        <small class="fhint">${tx('พนักงาน/อัตราจ้างของลูกค้ารายนี้เพิ่มได้ทีหลังจากแท็บ')} "${tx('พนักงาน & ชื่อพ้อง')}"</small>
      </div>
      <div class="fsec">
        <div class="fsec-h"><b>${tx('การอ่าน Timesheet ด้วย ABBYY')}</b></div>
        <div class="frm">
          <label>${tx('ABBYY Skill ID เฉพาะบริษัทนี้')}
            <input id="ncAbbyySkillId" type="text" placeholder="${tx('เว้นว่าง = ใช้ Skill กลาง')}" autocomplete="off"></label>
        </div>
      </div>
    </div>
    <div class="ft">
      <button class="btn" id="custAddCancel">${tx('ยกเลิก')}</button>
      <button class="btn pri" id="custAddSave">${tx('บันทึกลูกค้าใหม่')}</button>
    </div>
  </div>`;
}

/**
 * ฟอร์ม "เพิ่มพนักงานใหม่" — สร้างพนักงาน + อัตราจ้างแรกผูกกับบริษัทที่กำลังดำเนินการอยู่ในคราวเดียว
 * (พนักงานทุกคนต้องมีอัตราจ้างกับสัญญาใดสัญญาหนึ่งเสมอ ไม่มีเรทคำนวณ Manday ไม่ได้)
 */
function renderEmployeeAddForm(activeContract) {
  return `
  <div class="card">
    <div class="hd"><h3>${tx('เพิ่มพนักงานใหม่')}</h3>
      <span class="rt">${tx('ผูกอัตราจ้างกับ')} "${esc(activeContract.customer_name)} — ${esc(activeContract.project_name)}"</span></div>
    <div class="bd">
      <div class="frm">
        <label>${tx('ชื่อ-นามสกุล (ไทย)')}<input id="neNameTh" type="text" autocomplete="off"></label>
        <label>${tx('ชื่อ-นามสกุล (อังกฤษ)')}<input id="neNameEn" type="text" autocomplete="off"></label>
        <label>${tx('ตำแหน่งบนใบแจ้งหนี้')}<input id="neInvoicePosition" type="text" autocomplete="off"></label>
        <label>${tx('รหัสพนักงาน HRDD')}<input id="neHrddCode" type="text" autocomplete="off"></label>
        <label>${tx('เลขที่ใบเสนอราคา (QT)')}<input id="neQuotationNo" type="text" autocomplete="off"></label>
        <label>${tx('เรทต่อเดือน (บาท)')}<input id="neMonthlyRate" type="number" min="0" step="0.01"></label>
        <label>${tx('วันเริ่มงาน')}<input id="neStartDate" type="date"></label>
        <label>${tx('วันสิ้นสุด (ถ้าไม่ระบุ = ตามสัญญา)')}<input id="neEndDate" type="date"></label>
      </div>
    </div>
    <div class="ft">
      <button class="btn" id="empAddCancel">${tx('ยกเลิก')}</button>
      <button class="btn pri" id="empAddSave">${tx('บันทึกพนักงานใหม่')}</button>
    </div>
  </div>`;
}

/**
 * ฟอร์ม "แก้ไขข้อมูลพนักงาน" — เปิดจากไอคอนดินสอในตาราง แก้ได้ทั้งข้อมูลตัวพนักงานและอัตราจ้าง
 * ของแถวนั้นในคราวเดียว (ต่างจาก "แก้เรท" แบบเดิมที่แก้ได้แค่เรทต่อเดือน)
 */
function renderEmployeeEditForm(e) {
  return `
  <div class="card">
    <div class="hd"><h3>${tx('แก้ไขข้อมูลพนักงาน')}</h3>
      <span class="rt">${esc(e.customer_name ?? '—')}${e.quotation_no ? ` · ${esc(e.quotation_no)}` : ''}</span></div>
    <div class="bd">
      <div class="frm">
        <label>${tx('ชื่อ-นามสกุล (ไทย)')}<input id="eeNameTh" type="text" value="${esc(e.name_th)}" autocomplete="off"></label>
        <label>${tx('ชื่อ-นามสกุล (อังกฤษ)')}<input id="eeNameEn" type="text" value="${esc(e.name_en ?? '')}" autocomplete="off"></label>
        <label>${tx('ตำแหน่งบนใบแจ้งหนี้')}<input id="eeInvoicePosition" type="text" value="${esc(e.invoice_position)}" autocomplete="off"></label>
        <label>${tx('รหัสพนักงาน HRDD')}<input id="eeHrddCode" type="text" value="${esc(e.hrdd_employee_code ?? '')}" autocomplete="off"></label>
        <label>${tx('เลขที่ใบเสนอราคา (QT)')}<input id="eeQuotationNo" type="text" value="${esc(e.quotation_no ?? '')}" autocomplete="off"></label>
        <label>${tx('เรทต่อเดือน (บาท)')}<input id="eeMonthlyRate" type="number" min="0" step="0.01" value="${e.monthly_rate ?? ''}"></label>
        <label>${tx('วันเริ่มงาน')}<input id="eeStartDate" type="date" value="${esc(e.start_date ?? '')}"></label>
        <label>${tx('วันสิ้นสุด')}<input id="eeEndDate" type="date" value="${esc(e.end_date ?? '')}"></label>
      </div>
    </div>
    <div class="ft">
      <button class="btn" id="empEditCancel">${tx('ยกเลิก')}</button>
      <button class="btn pri" id="empEditSave" data-emp="${esc(e.id)}" data-asg="${esc(e.assignment_id ?? '')}">${tx('บันทึกการแก้ไข')}</button>
    </div>
  </div>`;
}

/**
 * ฟอร์ม "แก้ไขข้อมูลสัญญา" — เปิดจากไอคอนดินสอบนการ์ดบริษัท แก้ได้ทั้งข้อมูลลูกค้าและสัญญา
 * ในคราวเดียว (เหมือนตอน "เพิ่มลูกค้าใหม่" ที่สร้างทั้งคู่พร้อมกัน)
 */
function renderContractEditForm(c) {
  return `
  <div class="card">
    <div class="hd"><h3>${tx('แก้ไขข้อมูลสัญญา')}</h3>
      <span class="rt">${esc(c.po_no)} — ${esc(c.project_name)}</span></div>
    <div class="bd">
      <div class="frm">
        <label>${tx('ชื่อบริษัท')}<input id="ccNameTh" type="text" value="${esc(c.customer_name)}" autocomplete="off"></label>
        <label>${tx('เลขผู้เสียภาษี')}<input id="ccTaxId" type="text" value="${esc(c.tax_id)}" autocomplete="off"></label>
        <label>${tx('ผู้ประสานงาน')}<input id="ccContactName" type="text" value="${esc(c.contact_name ?? '')}" autocomplete="off"></label>
        <label>${tx('เบอร์ผู้ประสานงาน')}<input id="ccContactPhone" type="text" value="${esc(c.contact_phone ?? '')}" autocomplete="off"></label>
        <label>${tx('สถานที่วางบิล')}<input id="ccBillingPlace" type="text" value="${esc(c.billing_place ?? '')}" autocomplete="off"></label>
      </div>
      <div class="fsec">
        <div class="fsec-h"><b>${tx('สัญญา')}</b></div>
        <div class="frm">
          <label>${tx('เลขที่ใบว่าจ้าง (PO)')}<input id="ccPoNo" type="text" value="${esc(c.po_no)}" autocomplete="off"></label>
          <label>${tx('เลขที่สัญญา')}<input id="ccContractNo" type="text" value="${esc(c.contract_no ?? '')}" autocomplete="off"></label>
          <label>${tx('ชื่อโครงการ')}<input id="ccProjectName" type="text" value="${esc(c.project_name)}" autocomplete="off"></label>
          <label>${tx('ตัวหารอัตราต่อวัน')}
            <span class="selectchip grow"><select id="ccDivisorMode">
              <option value="fixed" ${c.divisor_mode === 'fixed' ? 'selected' : ''}>${tx('คงที่ (ระบุจำนวนวัน)')}</option>
              <option value="actual_working_days" ${c.divisor_mode === 'actual_working_days' ? 'selected' : ''}>${tx('วันทำงานจริงของเดือน')}</option>
            </select></span>
          </label>
          <label>${tx('จำนวนวัน (ถ้าคงที่)')}<input id="ccDivisorValue" type="number" min="1" value="${int(c.divisor_value)}"></label>
          <label>${tx('วันเริ่มสัญญา')}<input id="ccStartDate" type="date" value="${esc(c.start_date)}"></label>
          <label>${tx('วันสิ้นสุดสัญญา')}<input id="ccEndDate" type="date" value="${esc(c.end_date)}"></label>
          <label>VAT (%)<input id="ccVat" type="number" min="0" max="100" step="0.1" value="${Math.round(c.vat_rate * 100)}"></label>
          <label>${tx('หัก ณ ที่จ่าย')} (%)<input id="ccWht" type="number" min="0" max="100" step="0.1" value="${Math.round(c.wht_rate * 100)}"></label>
          <label>${tx('เครดิต (วัน)')}<input id="ccCreditDays" type="number" min="0" value="${int(c.credit_days)}"></label>
        </div>
      </div>
      <div class="fsec">
        <div class="fsec-h"><b>${tx('การอ่าน Timesheet ด้วย ABBYY')}</b></div>
        <div class="frm">
          <label>${tx('ABBYY Skill ID เฉพาะบริษัทนี้')}
            <input id="ccAbbyySkillId" type="text" value="${esc(c.abbyy_skill_id ?? '')}"
                   placeholder="${tx('เว้นว่าง = ใช้ Skill กลาง')}" autocomplete="off"></label>
        </div>
        <small class="fhint">${tx('ถ้าลูกค้ารายนี้มี Timesheet คนละแบบฟอร์ม เทรน Skill แยกใน ABBYY Vantage แล้วใส่ Skill ID ไว้ที่นี่ — ตอนอัปโหลด Timesheet ระบบจะเลือกใช้ Skill นี้ให้เองตามบริษัทที่กำลังดำเนินการอยู่ ไม่ต้องเลือกอะไรเพิ่ม เว้นว่างไว้ถ้ายังไม่มี Skill เฉพาะ ระบบจะใช้ Skill กลางแทน')}</small>
      </div>
    </div>
    <div class="ft">
      <button class="btn" id="ctgEditCancel">${tx('ยกเลิก')}</button>
      <button class="btn pri" id="ctgEditSave" data-contract="${esc(c.id)}">${tx('บันทึกการแก้ไข')}</button>
    </div>
  </div>`;
}

async function renderMaster() {
  const holidayYear = state.holidayYear ?? new Date().getFullYear();
  // ดึงรายชื่อบริษัทจาก FlowAccount เฉพาะตอนเปิดฟอร์ม "เพิ่มลูกค้าใหม่" เท่านั้น — ไม่ต้องยิงทุกครั้งที่
  // เข้าแท็บนี้ (28 ส.ค. 69) ถ้าดึงไม่สำเร็จ (โหมด dry-run/หลุดสาย) ให้ฟอร์มยังกรอกมือได้ตามปกติ ไม่พัง
  const [employees, contracts, holidayData, faCompanies] = await Promise.all([
    api(`/employees${contractQuery()}`), api('/contracts'),
    api(`/holidays?year=${holidayYear}`),
    state.customerAdd ? api('/flowaccount/companies').catch(() => []) : Promise.resolve([]),
  ]);
  const tab = state.masterTab;
  const activeContract = contracts.find((c) => c.id === state.contractId) ?? null;

  main.innerHTML = `
  <div class="page">
    <div class="phd"><div><span class="ey">${tx('อ้างอิง')}</span><h1>${tx('ข้อมูลหลัก')}</h1>
      <p>${tx('ฐานข้อมูลที่ทั้ง 3 ขั้นใช้ร่วมกัน — จับคู่ชื่อ · หาเรทค่าบริการ · นับวันทำงานของเดือน')}</p></div></div>

    <div class="tabs" role="tablist">
      ${['พนักงาน & ชื่อพ้อง', 'ลูกค้า & สัญญา', 'วันหยุด'].map((label, i) =>
        `<button class="tab ${tab === i + 1 ? 'on' : ''}" data-mtab2="${i + 1}">${tx(label)}</button>`).join('')}
    </div>

    <div class="tp ${tab === 1 ? 'on' : ''}" data-mpane="1">
      <div class="metabar">
        <span class="ey">${activeContract ? `${employees.length} ${tx('คน')} — ${activeContract.customer_name}` : `${employees.length} ${tx('คน')}`}</span>
        <button class="btn pri sm" id="empAddBtn" ${activeContract ? '' : `disabled title="${tx('ยังไม่มีบริษัทที่กำลังดำเนินการอยู่')}"`}>${icon('grid', 'i sm')} ${tx('เพิ่มพนักงาน')}</button>
      </div>

      ${state.employeeAdd && activeContract ? renderEmployeeAddForm(activeContract) : ''}

      ${(() => {
        const editing = employees.find((e) => (e.assignment_id ?? e.id) === state.employeeEdit);
        return editing ? renderEmployeeEditForm(editing) : '';
      })()}

      <div class="card"><div class="tw"><table>
        <thead><tr><th>${tx('รหัส')}</th><th>${tx('ชื่อ')}</th><th>${tx('ชื่อพ้อง')}</th><th>${tx('ตำแหน่งพ้อง')}</th>
          <th>${tx('ตำแหน่งบนใบแจ้งหนี้')}</th><th class="r">${tx('เรท/เดือน')}</th><th>${tx('บริษัท')}</th><th style="width:80px"></th></tr></thead>
        <tbody>${employees.map((e) => `
          <tr><td class="n">${esc(e.id)}</td>
            <td><span class="nm">${esc(e.name_th)}</span><span class="sub">${esc(e.name_en ?? '')}</span></td>
            <td>${renderAliasCell(e, 'name', e.nameAliases)}</td>
            <td>${renderAliasCell(e, 'position', e.positionAliases)}</td>
            <td>${esc(e.invoice_position)}</td>
            <td class="r n">${renderRateCell(e)}</td>
            <td>${esc(e.customer_name ?? '—')}<span class="sub">${esc(e.quotation_no ?? '')}</span></td>
            <td><div class="rowacts">
              <button class="btn sm icon" data-edit-emp="${esc(e.assignment_id ?? e.id)}"
                title="${tx('แก้ไขข้อมูลพนักงาน')}" aria-label="${tx('แก้ไข')}">${icon('edit')}</button>
              ${e.assignment_id ? `<button class="btn sm icon dgr" data-rm-asg="${esc(e.assignment_id)}"
                data-emp-name="${esc(e.name_th)}" title="${tx('นำออกจากโครงการนี้')}" aria-label="${tx('ลบ')}">${icon('trash')}</button>` : ''}
            </div></td></tr>`).join('')}</tbody>
      </table></div></div>
    </div>

    <div class="tp ${tab === 2 ? 'on' : ''}" data-mpane="2">
      <div class="metabar">
        <span class="ey">${contracts.length} ${tx('บริษัท')}</span>
        <button class="btn pri sm" id="custAddBtn">${icon('grid', 'i sm')} ${tx('เพิ่มลูกค้าใหม่')}</button>
      </div>

      ${state.customerAdd ? renderCustomerAddForm(faCompanies) : ''}

      ${contracts.map((c) => (state.contractEdit === c.id ? renderContractEditForm(c) : `
        <div class="card">
          <div class="hd"><h3>${esc(c.po_no)} — ${esc(c.project_name)}</h3>
            <div class="rowacts">
              <label class="toggle ${c.status === 'active' ? 'on' : ''}"
                     title="${c.status === 'active'
                       ? tx('กำลังดำเนินการอยู่ — ปิดไปยังไม่มีบริษัทอื่นมาแทนที่อัตโนมัติ')
                       : tx('ปิดอยู่ — เปิดเพื่อให้ระบบทำงานกับบริษัทนี้ (จะปิดบริษัทอื่นที่เปิดอยู่ให้เองอัตโนมัติ)')}">
                <input type="checkbox" class="ctgAct" data-contract="${esc(c.id)}"
                       ${c.status === 'active' ? 'checked' : ''}>
                <span class="tk"></span>
                <span class="tl">${tx(c.status === 'active' ? 'กำลังดำเนินการ' : 'ปิดอยู่')}</span>
              </label>
              <button class="btn sm icon" data-edit-contract="${esc(c.id)}"
                title="${tx('แก้ไขข้อมูลสัญญา')}" aria-label="${tx('แก้ไข')}">${icon('edit')}</button>
            </div>
          </div>
          <div class="bd"><div class="g2">
            <dl class="kv">
              <dt>${tx('ลูกค้า')}</dt><dd>${esc(c.customer_name)}</dd>
              <dt>${tx('เลขผู้เสียภาษี')}</dt><dd class="n">${esc(c.tax_id)}</dd>
              <dt>${tx('เลขที่สัญญา')}</dt><dd class="n">${esc(c.contract_no ?? '—')}</dd>
              <dt>${tx('ช่วงสัญญา')}</dt><dd>${dateOnly(c.start_date)} – ${dateOnly(c.end_date)}</dd>
              <dt>${tx('จำนวนคน')}</dt><dd class="n">${int(c.headcount)} ${tx('คน')}</dd>
            </dl>
            <dl class="kv">
              <dt>${tx('ยอดต่อเดือน')}</dt><dd class="n">${money(c.monthly_total)} ${tx('บาท')}</dd>
              <dt>${tx('ตัวหารอัตราต่อวัน')}</dt><dd>${c.divisor_mode === 'fixed'
                  ? `${tx('คงที่')} ${int(c.divisor_value)}` : tx('วันทำงานจริงของเดือน')}</dd>
              <dt>VAT</dt><dd class="n">${Math.round(c.vat_rate * 100)}%</dd>
              <dt>${tx('หัก ณ ที่จ่าย')}</dt><dd class="n">${Math.round(c.wht_rate * 100)}%</dd>
              <dt>${tx('เครดิต')}</dt><dd class="n">${int(c.credit_days)} ${tx('วัน')}</dd>
              <dt>${tx('ผู้ประสานงาน')}</dt><dd>${esc(c.contact_name ?? '—')} ${esc(c.contact_phone ?? '')}</dd>
              ${c.billing_place ? `<dt>${tx('สถานที่วางบิล')}</dt><dd>${esc(c.billing_place)}</dd>` : ''}
            </dl>
          </div>
          </div>
        </div>`)).join('')}
    </div>

    <div class="tp ${tab === 3 ? 'on' : ''}" data-mpane="3">
      <div class="card">
        <div class="hd"><h3>${tx('ปฏิทินวันหยุด')}</h3>
          <span class="rt">${tx('เติมวันหยุดราชการทางการให้อัตโนมัติตามปีที่เลือก ไม่ต้องพิมพ์เพิ่มเอง')}</span></div>
        <div class="bd">
          <span class="selectchip"><select id="hYear">${holidayData.years.map((y) =>
            `<option value="${y}" ${y === holidayYear ? 'selected' : ''}>${y + 543}</option>`).join('')}</select></span>
        </div>
        <div class="bd flush"><div class="tw"><table style="min-width:520px">
          <thead><tr><th style="width:140px">${tx('วันที่')}</th><th>${tx('ชื่อวันหยุด')}</th><th>${tx('ขอบเขต')}</th>
            <th style="width:60px"></th></tr></thead>
          <tbody>${holidayData.holidays.length ? holidayData.holidays.map((h) => `
            <tr><td class="n">${dateOnly(h.date)}</td><td>${esc(h.name)}</td>
              <td>${h.customer_id ? esc(h.customer_id) : `<span class="tg mu">${tx('ทุกลูกค้า')}</span>`}</td>
              <td><button class="btn sm icon dgr hrm" data-date="${esc(h.date)}"
                data-name="${esc(h.name)}" data-cus="${esc(h.customer_id ?? '')}"
                title="${tx('ลบวันหยุดนี้')}" aria-label="${tx('ลบ')}">${icon('trash')}</button></td></tr>`).join('')
            : `<tr><td colspan="4" class="empty">${tx('ยังไม่มีข้อมูลวันหยุดทางการของปีนี้ในระบบ')}</td></tr>`}</tbody>
        </table></div></div>
      </div>
    </div>

  </div>`;

  main.querySelectorAll('[data-mtab2]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.masterTab = Number(btn.dataset.mtab2);
      renderMaster();
    });
  });

  /* เพิ่ม/แก้/ลบชื่อพ้องและตำแหน่งพ้อง — เปิดเป็น input ในหน้าแทน prompt()
     (คนใช้จริงมองว่าปุ่มเดิม "กดแล้วไม่มีอะไรเกิดขึ้น" เพราะ popup ของเบราว์เซอร์ไม่เด่นพอ)
     "แก้" ทำโดยเพิ่มค่าใหม่ก่อนแล้วค่อยลบค่าเดิม — ถ้าเพิ่มค่าใหม่ไม่สำเร็จ ค่าเดิมจะไม่หาย */

  main.querySelectorAll('.addal').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.aliasEdit = { empId: btn.dataset.emp, kind: btn.dataset.kind, mode: 'add' };
      renderMaster();
    });
  });

  main.querySelectorAll('.aliastag').forEach((tag) => {
    tag.addEventListener('click', (event) => {
      if (event.target.closest('.rm')) return; // ปุ่มลบมีตัวจัดการของตัวเองแยกไว้ด้านล่าง
      state.aliasEdit = {
        empId: tag.dataset.emp, kind: tag.dataset.kind, mode: 'edit', original: tag.dataset.alias,
      };
      renderMaster();
    });
  });

  main.querySelectorAll('.ax.rm').forEach((btn) => {
    btn.addEventListener('click', async (event) => {
      event.stopPropagation();
      const label = btn.dataset.kind === 'name' ? 'ชื่อพ้อง' : 'ตำแหน่งพ้อง';
      const ok = await confirmModal({
        iconName: 'trash-solid', danger: true,
        title: `ลบ${label}นี้?`,
        message: `"<b>${esc(btn.dataset.alias)}</b>" จะหายไปจากรายการ${label}`,
        confirmLabel: 'ลบ',
      });
      if (!ok) return;
      try {
        const q = new URLSearchParams({ kind: btn.dataset.kind, alias: btn.dataset.alias });
        await api(`/employees/${encodeURIComponent(btn.dataset.emp)}/aliases?${q}`, { method: 'DELETE' });
        toast('ลบแล้ว');
        renderMaster();
      } catch (error) { toast(error.message, true); }
    });
  });

  const saveAlias = async (input) => {
    const alias = input.value.trim();
    const { emp, kind, mode, original } = input.dataset;
    if (!alias) return;
    if (mode === 'edit' && alias === original) { state.aliasEdit = null; renderMaster(); return; }
    try {
      await api(`/employees/${encodeURIComponent(emp)}/aliases`, {
        method: 'POST', body: JSON.stringify({ kind, alias }),
      });
      if (mode === 'edit') {
        const q = new URLSearchParams({ kind, alias: original });
        await api(`/employees/${encodeURIComponent(emp)}/aliases?${q}`, { method: 'DELETE' });
      }
      toast(mode === 'edit' ? `แก้เป็น "${alias}" แล้ว` : `เพิ่ม "${alias}" แล้ว`);
      state.aliasEdit = null;
      renderMaster();
    } catch (error) { toast(error.message, true); }
  };

  main.querySelectorAll('.aliasInput').forEach((input) => {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') saveAlias(input);
      if (event.key === 'Escape') { state.aliasEdit = null; renderMaster(); }
    });
  });

  main.querySelectorAll('.tg.editing .save').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = btn.parentElement.querySelector('.aliasInput');
      if (input) saveAlias(input);
    });
  });

  main.querySelectorAll('.tg.editing .cancel').forEach((btn) => {
    btn.addEventListener('click', () => { state.aliasEdit = null; renderMaster(); });
  });

  main.querySelectorAll('.edrate').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.rateEdit = btn.dataset.asg;
      renderMaster();
    });
  });

  main.querySelectorAll('.rateEditRow .cancel').forEach((btn) => {
    btn.addEventListener('click', () => { state.rateEdit = null; renderMaster(); });
  });

  const saveRate = async (input) => {
    const next = input.value.trim();
    if (!next) return;
    try {
      const r = await api(`/assignments/${encodeURIComponent(input.dataset.asg)}`, {
        method: 'PATCH', body: JSON.stringify({ monthlyRate: next }),
      });
      toast(`${r.employeeName}: ${money(r.from)} → ${money(r.to)} · ${r.note}`);
      state.rateEdit = null;
      renderMaster();
    } catch (error) { toast(error.message, true); }
  };

  main.querySelectorAll('.rateInput').forEach((input) => {
    input.focus();
    input.select();
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') saveRate(input);
      if (event.key === 'Escape') { state.rateEdit = null; renderMaster(); }
    });
  });

  main.querySelectorAll('.rateEditRow .save').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = btn.closest('.rateEditRow').querySelector('.rateInput');
      if (input) saveRate(input);
    });
  });

  el('hYear')?.addEventListener('change', (e) => {
    state.holidayYear = Number(e.target.value);
    renderMaster();
  });

  main.querySelectorAll('.hrm').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await confirmModal({
        iconName: 'trash-solid', danger: true,
        title: 'ลบวันหยุดนี้?',
        message: `"<b>${esc(btn.dataset.name)}</b>" วันที่ ${dateOnly(btn.dataset.date)} จะหายไปจากปฏิทินวันหยุด`,
        confirmLabel: 'ลบ',
      });
      if (!ok) return;
      try {
        const q = new URLSearchParams({ date: btn.dataset.date });
        if (btn.dataset.cus) q.set('customerId', btn.dataset.cus);
        await api(`/holidays?${q}`, { method: 'DELETE' });
        toast('ลบแล้ว');
        renderMaster();
      } catch (error) { toast(error.message, true); }
    });
  });

  main.querySelectorAll('[data-rm-asg]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await confirmModal({
        iconName: 'trash-solid', danger: true,
        title: 'นำพนักงานออกจากโครงการนี้?',
        message: `"<b>${esc(btn.dataset.empName)}</b>" จะหายไปจากรายการของโครงการนี้ — ข้อมูลพนักงาน/ชื่อพ้องเดิมยังอยู่ เผื่อย้ายไปผูกโครงการอื่นทีหลัง`,
        confirmLabel: 'นำออก',
      });
      if (!ok) return;
      try {
        await api(`/assignments/${encodeURIComponent(btn.dataset.rmAsg)}`, { method: 'DELETE' });
        toast('นำออกจากโครงการแล้ว');
        renderMaster();
      } catch (error) { toast(error.message, true); }
    });
  });

  main.querySelectorAll('[data-edit-emp]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.employeeEdit = btn.dataset.editEmp;
      renderMaster();
    });
  });
  el('empEditCancel')?.addEventListener('click', () => {
    state.employeeEdit = null;
    renderMaster();
  });

  el('empEditSave')?.addEventListener('click', async (event) => {
    const btn = event.currentTarget;
    const nameTh = el('eeNameTh').value.trim();
    const invoicePosition = el('eeInvoicePosition').value.trim();
    const monthlyRate = Number(el('eeMonthlyRate').value);
    const startDate = el('eeStartDate').value;
    const endDate = el('eeEndDate').value;
    if (!nameTh || !invoicePosition || !monthlyRate || !startDate || !endDate) {
      toast('กรอกชื่อ ตำแหน่งบนใบแจ้งหนี้ เรทต่อเดือน และช่วงวันที่ให้ครบก่อน', true);
      return;
    }
    btn.disabled = true;
    try {
      await api(`/employees/${encodeURIComponent(btn.dataset.emp)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          assignmentId: btn.dataset.asg || null, nameTh, invoicePosition, monthlyRate, startDate, endDate,
          nameEn: el('eeNameEn').value.trim() || null,
          hrddEmployeeCode: el('eeHrddCode').value.trim() || null,
          quotationNo: el('eeQuotationNo').value.trim() || null,
        }),
      });
      toast(`บันทึกการแก้ไข "${nameTh}" แล้ว`);
      state.employeeEdit = null;
      renderMaster();
    } catch (error) {
      toast(error.message, true);
      btn.disabled = false;
    }
  });

  /* ── แท็บ "พนักงาน & ชื่อพ้อง" — เพิ่มพนักงานใหม่ ── */
  el('empAddBtn')?.addEventListener('click', () => {
    state.employeeAdd = true;
    renderMaster();
  });
  el('empAddCancel')?.addEventListener('click', () => {
    state.employeeAdd = false;
    renderMaster();
  });

  el('empAddSave')?.addEventListener('click', async (event) => {
    const btn = event.currentTarget;
    const nameTh = el('neNameTh').value.trim();
    const invoicePosition = el('neInvoicePosition').value.trim();
    const monthlyRate = Number(el('neMonthlyRate').value);
    const startDate = el('neStartDate').value;
    if (!nameTh || !invoicePosition || !monthlyRate || !startDate) {
      toast('กรอกชื่อ ตำแหน่งบนใบแจ้งหนี้ เรทต่อเดือน และวันเริ่มงานให้ครบก่อน', true);
      return;
    }
    btn.disabled = true;
    try {
      await api('/employees', {
        method: 'POST',
        body: JSON.stringify({
          contractId: state.contractId, nameTh, invoicePosition, monthlyRate, startDate,
          nameEn: el('neNameEn').value.trim() || null,
          hrddEmployeeCode: el('neHrddCode').value.trim() || null,
          quotationNo: el('neQuotationNo').value.trim() || null,
          endDate: el('neEndDate').value || null,
        }),
      });
      toast(`เพิ่ม "${nameTh}" แล้ว`);
      state.employeeAdd = false;
      renderMaster();
    } catch (error) {
      toast(error.message, true);
      btn.disabled = false;
    }
  });

  /* ── แท็บ "ลูกค้า & สัญญา" — สลับ active / เพิ่มลูกค้าใหม่ ── */
  el('custAddBtn')?.addEventListener('click', () => {
    state.customerAdd = true;
    renderMaster();
  });
  el('custAddCancel')?.addEventListener('click', () => {
    state.customerAdd = false;
    renderMaster();
  });

  /* เลือกบริษัทจาก FlowAccount แล้วเติมฟอร์มให้เอง — ยังแก้มือต่อได้ก่อนกดบันทึกจริง คนละขั้นกับ
     "ยืนยัน" ตั้งใจให้ตรวจทานได้ก่อน (28 ส.ค. 69) เก็บ flowaccountContactId ไว้ใน dataset ของ select
     เอง ส่งไปพร้อม POST /customers ทีหลัง กันสร้าง contact ซ้ำใน FlowAccount ตอนวางบิลจริงครั้งแรก */
  el('ncFromFA')?.addEventListener('change', (e) => {
    const c = faCompanies[Number(e.target.value)];
    if (!c) return;
    el('ncNameTh').value = c.nameTh;
    el('ncTaxId').value = c.taxId;
    el('ncBranch').value = c.branch || 'สำนักงานใหญ่';
    el('ncAddress').value = c.address ?? '';
    el('ncContactName').value = c.contactName ?? '';
    el('ncContactPhone').value = c.contactPhone ?? '';
    el('ncContactEmail').value = c.contactEmail ?? '';
    if (c.projectName) el('ncProjectName').value = c.projectName;
    e.target.dataset.faContactId = c.flowaccountContactId;
    const hint = el('ncFaEmpHint');
    if (hint) {
      const en = state.lang === 'en';
      hint.textContent = c.employees?.length
        ? (en
          ? `Will auto-import ${c.employees.length} employee(s) + monthly rate from this quotation.`
          : `ดึงพนักงาน ${c.employees.length} คน + เรทต่อเดือนจากใบเสนอราคานี้มาให้อัตโนมัติ`)
        : (en
          ? 'This quotation has no employee line items — add employees later from the "Employees & aliases" tab.'
          : 'ใบเสนอราคานี้ไม่มีรายชื่อพนักงานให้ดึง — เพิ่มพนักงานเองทีหลังได้จากแท็บ "พนักงาน & ชื่อพ้อง"');
    }
  });

  el('custAddSave')?.addEventListener('click', async (event) => {
    const btn = event.currentTarget;
    const nameTh = el('ncNameTh').value.trim();
    const taxId = el('ncTaxId').value.trim();
    const poNo = el('ncPoNo').value.trim();
    const projectName = el('ncProjectName').value.trim();
    const startDate = el('ncStartDate').value;
    const endDate = el('ncEndDate').value;
    if (!nameTh || !taxId || !poNo || !projectName || !startDate || !endDate) {
      toast('กรอกชื่อบริษัท เลขผู้เสียภาษี เลขที่ใบว่าจ้าง ชื่อโครงการ และช่วงสัญญาให้ครบก่อน', true);
      return;
    }
    btn.disabled = true;
    try {
      const customer = await api('/customers', {
        method: 'POST',
        body: JSON.stringify({
          nameTh, taxId,
          branch: el('ncBranch').value.trim() || undefined,
          address: el('ncAddress').value.trim() || null,
          creditDays: Number(el('ncCreditDays').value) || 30,
          contactName: el('ncContactName').value.trim() || null,
          contactPhone: el('ncContactPhone').value.trim() || null,
          contactEmail: el('ncContactEmail').value.trim() || null,
          billingPlace: el('ncBillingPlace').value.trim() || null,
          flowaccountContactId: el('ncFromFA')?.dataset.faContactId || null,
        }),
      });
      const contract = await api('/contracts', {
        method: 'POST',
        body: JSON.stringify({
          customerId: customer.id, poNo, projectName,
          contractNo: el('ncContractNo').value.trim() || null,
          divisorMode: el('ncDivisorMode').value,
          divisorValue: Number(el('ncDivisorValue').value) || 20,
          startDate, endDate,
          vatRate: (Number(el('ncVat').value) || 0) / 100,
          whtRate: (Number(el('ncWht').value) || 0) / 100,
          abbyySkillId: el('ncAbbyySkillId').value.trim() || null,
        }),
      });

      /* เลือกบริษัทจาก FlowAccount มา → ใบเสนอราคาใบนั้นมีรายชื่อพนักงาน+เรทต่อเดือนติดมาด้วย
         (items[] ของใบ QT) สร้างพนักงานทุกคนให้พร้อมสัญญาเลยทีเดียว ไม่ต้องพิมพ์ซ้ำทีละคน */
      const faIndex = el('ncFromFA')?.value;
      const faCompany = faIndex ? faCompanies[Number(faIndex)] : null;
      let addedEmployees = 0;
      if (faCompany?.employees?.length) {
        for (const emp of faCompany.employees) {
          try {
            await api('/employees', {
              method: 'POST',
              body: JSON.stringify({
                contractId: contract.id, nameTh: emp.nameTh, invoicePosition: emp.invoicePosition,
                monthlyRate: emp.monthlyRate, startDate, endDate,
                quotationNo: faCompany.quotationNo || null,
              }),
            });
            addedEmployees += 1;
          } catch (empError) {
            toast(`เพิ่มพนักงาน "${emp.nameTh}" ไม่สำเร็จ: ${empError.message}`, true);
          }
        }
      }

      toast(addedEmployees
        ? `เพิ่ม "${nameTh}" พร้อมพนักงาน ${addedEmployees} คนแล้ว`
        : `เพิ่ม "${nameTh}" แล้ว`);
      state.customerAdd = false;
      await loadContractSwitch();   // สัญญาใหม่อาจกลายเป็น active (ถ้าเป็นสัญญาแรกของระบบ)
      renderMaster();
    } catch (error) {
      toast(error.message, true);
      btn.disabled = false;
    }
  });

  main.querySelectorAll('[data-edit-contract]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.contractEdit = btn.dataset.editContract;
      renderMaster();
    });
  });
  el('ctgEditCancel')?.addEventListener('click', () => {
    state.contractEdit = null;
    renderMaster();
  });

  el('ctgEditSave')?.addEventListener('click', async (event) => {
    const btn = event.currentTarget;
    const customerNameTh = el('ccNameTh').value.trim();
    const taxId = el('ccTaxId').value.trim();
    const poNo = el('ccPoNo').value.trim();
    const projectName = el('ccProjectName').value.trim();
    const startDate = el('ccStartDate').value;
    const endDate = el('ccEndDate').value;
    if (!customerNameTh || !taxId || !poNo || !projectName || !startDate || !endDate) {
      toast('กรอกชื่อบริษัท เลขผู้เสียภาษี เลขที่ใบว่าจ้าง ชื่อโครงการ และช่วงสัญญาให้ครบก่อน', true);
      return;
    }
    btn.disabled = true;
    try {
      await api(`/contracts/${encodeURIComponent(btn.dataset.contract)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          customerNameTh, taxId, poNo, projectName, startDate, endDate,
          contractNo: el('ccContractNo').value.trim() || null,
          divisorMode: el('ccDivisorMode').value,
          divisorValue: Number(el('ccDivisorValue').value) || 20,
          vatRate: (Number(el('ccVat').value) || 0) / 100,
          whtRate: (Number(el('ccWht').value) || 0) / 100,
          creditDays: Number(el('ccCreditDays').value) || 30,
          contactName: el('ccContactName').value.trim() || null,
          contactPhone: el('ccContactPhone').value.trim() || null,
          billingPlace: el('ccBillingPlace').value.trim() || null,
          abbyySkillId: el('ccAbbyySkillId').value.trim() || null,
        }),
      });
      toast(`บันทึกการแก้ไข "${customerNameTh}" แล้ว`);
      state.contractEdit = null;
      await loadContractSwitch();   // ชื่อบริษัท/โครงการอาจเปลี่ยน — อัปเดตตัวเลือกบนแถบบนด้วย
      renderMaster();
    } catch (error) {
      toast(error.message, true);
      btn.disabled = false;
    }
  });

  main.querySelectorAll('.ctgAct').forEach((checkbox) => {
    checkbox.addEventListener('change', async () => {
      const contractId = checkbox.dataset.contract;
      const turningOn = checkbox.checked;
      checkbox.disabled = true;
      try {
        await api(`/contracts/${encodeURIComponent(contractId)}/active`, {
          method: 'PATCH', body: JSON.stringify({ active: turningOn }),
        });
        toast(turningOn ? 'เปิดใช้งานบริษัทนี้แล้ว — บริษัทอื่นที่เปิดอยู่ถูกปิดให้อัตโนมัติ' : 'ปิดใช้งานแล้ว');
        await loadContractSwitch();
        renderMaster();
      } catch (error) {
        toast(error.message, true);
        checkbox.checked = !turningOn;
        checkbox.disabled = false;
      }
    });
  });
}

/* ══ จัดการระบบ ══════════════════════════════════════════════
   เห็นเฉพาะ admin (nav ซ่อนไว้ + server ตรวจ 403 อีกชั้น) — รวมการเชื่อมต่อ (ย้ายมาจาก
   ข้อมูลหลัก), จัดการผู้ใช้ (เพิ่ม/เปลี่ยน role/ปิดใช้งาน), และบันทึกทุกการเปลี่ยนแปลงในระบบ */
async function renderSystemAdmin() {
  const tab = state.sysTab;
  const [settings, users, recipients, lineUsers, log] = await Promise.all([
    api('/settings'),
    tab === 2 ? api('/users') : Promise.resolve(null),
    tab === 3 ? api('/notification-recipients') : Promise.resolve(null),
    tab === 3 ? api('/line/known-users') : Promise.resolve(null),
    tab === 4 ? api('/audit-log?limit=200') : Promise.resolve(null),
  ]);

  main.innerHTML = `
  <div class="page">
    <div class="phd"><div><span class="ey">${tx('ผู้ดูแลระบบ')}</span><h1>${tx('จัดการระบบ')}</h1>
      <p>${tx('ผู้ใช้ในระบบ · การเชื่อมต่อกับบริการภายนอก · บันทึกทุกการเปลี่ยนแปลง')}</p></div></div>

    <div class="tabs" role="tablist">
      ${['ภาพรวม', 'ผู้ใช้', 'ผู้รับแจ้งเตือน', 'บันทึกระบบ'].map((label, i) =>
        `<button class="tab ${tab === i + 1 ? 'on' : ''}" data-systab="${i + 1}">${tx(label)}</button>`).join('')}
    </div>

    <div class="tp ${tab === 1 ? 'on' : ''}" data-spane="1">
      <div class="g2">
        <div class="card">
          <div class="hd"><h3>${tx('การเชื่อมต่อ')}</h3></div>
          <div class="bd"><dl class="kv">
            <dt>FlowAccount (.env)</dt><dd><span class="tg ${settings.env.flowAccountMode === 'dry-run' ? 'wn' : 'ok'}">${esc(settings.env.flowAccountMode)}</span></dd>
            <dt>FlowAccount (${tx('ใช้จริงตอนกดอนุมัติ')})</dt>
              <dd><span class="tg ${(settings.flowaccount?.mode ?? settings.env.flowAccountMode) === 'dry-run' ? 'wn' : 'ok'}">
                ${esc(settings.flowaccount?.mode ?? settings.env.flowAccountMode)}</span>
                ${settings.flowaccount?.mode && settings.flowaccount.mode !== settings.env.flowAccountMode
                  ? `<small style="display:block;color:var(--cr)">${tx('ไม่ตรงกับค่าใน .env ด้านบน — ค่านี้ในฐานข้อมูลเป็นตัวที่ใช้จริง')}</small>` : ''}</dd>
            <dt>Credential FlowAccount</dt><dd>${settings.env.hasFlowAccountCredentials
                ? `<span class="tg ok">${tx('ตั้งค่าแล้ว')}</span>` : `<span class="tg wn">${tx('ยังไม่ตั้ง')}</span>`}</dd>
            <dt>${tx('ชนิดเอกสาร')}</dt><dd>${esc(settings.flowaccount?.documentType ?? '—')}</dd>
            <dt>Gmail</dt><dd>${settings.env.hasGmail
                ? `<span class="tg ok">${tx('เชื่อมต่อแล้ว')}</span>` : `<span class="tg wn">${tx('ยังไม่เชื่อม')}</span>`}</dd>
            <dt>LINE</dt><dd>${settings.env.hasLine
                ? `<span class="tg ok">${tx('เชื่อมต่อแล้ว')}</span> <small>${tx('ผู้รับแจ้งเตือน')} ${int(settings.env.lineRecipientCount)} ${tx('ราย')}</small>`
                : `<span class="tg wn">${tx('ยังไม่เชื่อม')}</span>`}</dd>
            <dt>${tx('ลิงก์ในข้อความ LINE')}</dt><dd>${settings.env.appBaseUrl
                ? `<span class="n">${esc(settings.env.appBaseUrl)}</span>`
                : `<span class="tg wn">${tx('ยังไม่ตั้ง')}</span>
                   <small style="display:block">${tx('ข้อความแจ้งเตือนจะไม่มีปุ่มกดเข้าระบบ')}</small>`}</dd>
            <dt>${tx('ระบบในเครื่อง')}</dt><dd class="n">${esc(settings.env.localLlmBaseUrl)}</dd>
            ${settings.env.localTextModel === settings.env.localVisionModel
              // ตัวเดียวกันทั้งอ่านไฟล์และร่างข้อความ — แยกสองแถวก็เห็นค่าซ้ำกันเปล่าๆ
              ? `<dt>${tx('โมเดล')}</dt><dd class="n">${esc(settings.env.localTextModel)}</dd>`
              : `<dt>${tx('โมเดล (ข้อความ)')}</dt><dd class="n">${esc(settings.env.localTextModel)}</dd>
                 <dt>${tx('โมเดล (อ่านไฟล์)')}</dt><dd class="n">${esc(settings.env.localVisionModel)}</dd>`}
          </dl></div>
        </div>
        <div class="card">
          <div class="hd"><h3>${tx('เงื่อนไขวางบิล')}</h3></div>
          <div class="bd"><dl class="kv">
            <dt>${tx('วันที่ลงเอกสาร')}</dt><dd>${tx('วันที่')} ${int(settings.billingRules?.billOnDayOfNextMonth)} ${tx('ของเดือนถัดไป')}</dd>
            <dt>${tx('ต้องได้ครบทุกคน')}</dt><dd>${tx(settings.billingRules?.requireAllTimesheets ? 'ใช่' : 'ไม่')}</dd>
            <dt>${tx('ต้องมีคนกดยืนยัน')}</dt><dd><span class="tg ${settings.billingRules?.requireHumanCheck === false ? 'mu' : 'ok'}">
              ${tx(settings.billingRules?.requireHumanCheck === false ? 'ไม่ (โหมด auto)' : 'ใช่ (โหมด manual)')}</span></dd>
            <dt>${tx('ส่งอีเมลอัตโนมัติ')}</dt><dd><span class="tg ok">${tx('สร้างร่างเท่านั้น')}</span></dd>
            <dt>${tx('ไฟล์แนบในร่างอีเมล')}</dt><dd>${tx('ใบวางบิล + Timesheet ทุกคนในรอบ')}
              <small style="display:block">${tx('ใบวางบิลดึงจาก FlowAccount มาเก็บให้เองตอนกดอนุมัติ')}</small></dd>
            <dt>${tx('ปิดรอบเมื่อส่งเมล')}</dt><dd><span class="tg ok">${tx('อัตโนมัติ')}</span>
              <small style="display:block">${tx('ระบบดูจากกล่อง Gmail เองว่าร่างถูกกดส่งแล้วหรือยัง')}</small></dd>
          </dl></div>
        </div>
      </div>
    </div>

    <div class="tp ${tab === 2 ? 'on' : ''}" data-spane="2">
      <div class="card">
        <div class="hd"><h3>${tx('เพิ่มผู้ใช้ใหม่')}</h3></div>
        <div class="bd">
          <div class="frm">
            <label>Username / ${tx('อีเมล')}<input id="uUsername" type="text" autocomplete="off"></label>
            <label>${tx('ชื่อ')}<input id="uName" type="text" autocomplete="off"></label>
            <label>${tx('รหัสผ่าน')} <small>${tx('(อย่างน้อย 8 ตัวอักษร)')}</small><input id="uPassword" type="password" autocomplete="new-password"></label>
            <label>Role<span class="selectchip"><select id="uRole">
              <option value="user">user</option>
              <option value="admin">admin</option>
            </select>${icon('cd')}</span></label>
          </div>
        </div>
        <div class="ft"><button class="btn pri" id="uAdd">${tx('+ เพิ่มผู้ใช้')}</button></div>
      </div>

      <div class="card"><div class="tw"><table>
        <thead><tr><th>Username</th><th>${tx('ชื่อ')}</th><th>Role</th><th>${tx('สถานะ')}</th><th>${tx('สร้างเมื่อ')}</th><th></th></tr></thead>
        <tbody>${(users ?? []).map((u) => {
          const isSelf = u.username === state.username;
          return `
          <tr><td class="n">${esc(u.username)}</td>
            <td>${esc(u.name_th)}</td>
            <td><span class="selectchip"><select class="uRoleSel" data-user="${esc(u.username)}"
                  ${isSelf ? `disabled title="${tx('แก้ role ของตัวเองไม่ได้')}"` : ''}>
                <option value="user" ${u.role === 'user' ? 'selected' : ''}>user</option>
                <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>admin</option>
              </select>${icon('cd')}</span></td>
            <td><label class="toggle ${u.active ? 'on' : ''}"
                  title="${isSelf ? tx('ปิดใช้งานบัญชีตัวเองไม่ได้')
                    : tx(u.active ? 'ใช้งานอยู่ — กดเพื่อปิดใช้งาน' : 'ปิดใช้งานอยู่ — กดเพื่อเปิดใช้งาน')}">
                <input type="checkbox" class="uActiveToggle" data-user="${esc(u.username)}"
                  ${u.active ? 'checked' : ''} ${isSelf ? 'disabled' : ''}>
                <span class="tk"></span>
                <span class="tl">${tx(u.active ? 'ใช้งานอยู่' : 'ปิดใช้งาน')}</span>
              </label></td>
            <td>${dt(u.created_at)}</td>
            <td><button class="btn sm icon dgr" data-del-user="${esc(u.username)}" data-name="${esc(u.name_th)}"
                ${isSelf ? `disabled title="${tx('ลบบัญชีของตัวเองไม่ได้')}"` : ''} aria-label="${tx('ลบ')}">${icon('trash')}</button></td></tr>`;
        }).join('')}</tbody>
      </table></div></div>
    </div>

    <div class="tp ${tab === 3 ? 'on' : ''}" data-spane="3">
      <div class="card">
        <div class="hd"><h3>${tx('เพิ่มผู้รับแจ้งเตือน')}</h3></div>
        <div class="bd">
          <div class="frm">
            <label>${tx('ช่องทาง')}<span class="selectchip"><select id="nChannel">
              <option value="line">LINE</option>
              <option value="email">${tx('อีเมล')}</option>
            </select>${icon('cd')}</span></label>
            <label>${tx('ชื่อ (แสดงในรายการ)')}<input id="nLabel" type="text" placeholder="เช่น นิชา" autocomplete="off"></label>
            <label>${tx('ปลายทาง')}
              <span class="selectchip" id="nTargetLineWrap" style="${(lineUsers ?? []).length ? '' : 'display:none'}">
                <select id="nTargetLine">
                  <option value="">${tx('— เลือกคนที่เคยทักบอทมาแล้ว —')}</option>
                  ${(lineUsers ?? []).map((u) => `
                    <option value="${esc(u.userId)}" data-name="${esc(u.displayName ?? '')}">
                      ${esc(u.displayName ?? tx('ไม่พบชื่อ'))} (${esc(u.userId.slice(0, 10))}…)
                    </option>`).join('')}
                  <option value="__manual">${tx('อื่นๆ — กรอก userId เอง')}</option>
                </select>${icon('cd')}
              </span>
              <input id="nTarget" type="text" placeholder="LINE user ID หรืออีเมล" autocomplete="off"
                ${(lineUsers ?? []).length ? 'style="display:none"' : ''}>
            </label>
          </div>
        </div>
        <div class="ft"><button class="btn pri" id="nAdd">${tx('+ เพิ่ม')}</button></div>
      </div>

      <div class="card"><div class="tw"><table>
        <thead><tr><th>${tx('ช่องทาง')}</th><th>${tx('ชื่อ')}</th><th>${tx('ปลายทาง')}</th><th></th></tr></thead>
        <tbody>${(recipients ?? []).map((r) => {
          /* ชื่อที่โชว์ตรงนี้ต้องเป็นชื่อจริงในโปรไฟล์ LINE ของคนนั้น ไม่ใช่ป้ายที่พิมพ์ไว้ตอนเพิ่ม
             (พิมพ์ผิด/เปลี่ยนชื่อในไลน์แล้วป้ายเดิมจะไม่ตรงคนอีกต่อไป) — ถ้าหาโปรไฟล์ไม่เจอ
             (บล็อกบอท/เลิกเป็นเพื่อนไปแล้ว) ค่อยใช้ป้ายที่เก็บไว้เป็นสำรอง */
          const liveName = r.channel === 'line'
            ? (lineUsers ?? []).find((u) => u.userId === r.target)?.displayName : null;
          const label = liveName ?? r.label;
          return `
          <tr><td><span class="tg ${r.channel === 'line' ? 'ok' : 'mu'}">${r.channel === 'line' ? 'LINE' : tx('อีเมล')}</span></td>
            <td>${esc(label)}</td>
            <td class="n">${esc(r.target)}</td>
            <td><button class="btn sm icon dgr nrm" data-id="${r.id}" data-label="${esc(label)}"
                  title="${tx('ลบผู้รับแจ้งเตือนนี้')}" aria-label="${tx('ลบ')}">${icon('trash')}</button></td></tr>`;
        }).join('')}</tbody>
      </table></div>
      ${(recipients ?? []).length === 0 ? `<div class="empty">${tx('ยังไม่มีผู้รับแจ้งเตือน')}</div>` : ''}</div>
    </div>

    <div class="tp ${tab === 4 ? 'on' : ''}" data-spane="4">
      <div class="card"><div class="tw"><table>
        <thead><tr><th>${tx('เวลา')}</th><th>${tx('ผู้ทำ')}</th><th>${tx('การกระทำ')}</th><th>${tx('เป้าหมาย')}</th><th></th></tr></thead>
        <tbody>${(log ?? []).map((l) => `
          <tr><td class="n">${dt(l.at)}</td>
            <td>${esc(l.actor)}</td>
            <td>${esc(l.action)}</td>
            <td>${l.entity_type ? `${esc(l.entity_type)} · ${esc(l.entity_id ?? '')}` : '—'}</td>
            <td>${l.detail ? `<details class="raw"><summary>${tx('▶ รายละเอียด')}</summary>
                <pre class="code">${esc(JSON.stringify(l.detail, null, 2))}</pre></details>` : ''}</td></tr>`).join('')}</tbody>
      </table></div>
      ${(log ?? []).length === 0 ? `<div class="empty">${tx('ยังไม่มีบันทึก')}</div>` : ''}</div>
    </div>

  </div>`;

  main.querySelectorAll('[data-systab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.sysTab = Number(btn.dataset.systab);
      renderSystemAdmin();
    });
  });

  if (tab === 3) {
    /* ปลายทาง LINE เลือกจากดรอปดาวน์คนที่เคยทักบอทมาแล้วได้ ไม่ต้องก็อป userId มาวางเอง
       (LINE ไม่มีหน้าจอโชว์ userId ตรงๆ ให้ดู) — สลับกับช่องกรอกเองตอนเลือกอีเมล หรือกด "อื่นๆ" */
    const hasLineUsers = (lineUsers ?? []).length > 0;
    const syncTargetField = () => {
      const wantsManual = el('nChannel').value !== 'line' || !hasLineUsers || el('nTargetLine').value === '__manual';
      el('nTargetLineWrap').style.display = wantsManual ? 'none' : '';
      el('nTarget').style.display = wantsManual ? '' : 'none';
      if (wantsManual && el('nChannel').value === 'line' && el('nTargetLine').value === '__manual') {
        el('nTarget').value = '';
        el('nTarget').focus();
      }
    };
    el('nChannel').addEventListener('change', () => {
      if (el('nChannel').value !== 'line') { el('nLabel').readOnly = false; }
      syncTargetField();
    });
    if (hasLineUsers) {
      el('nTargetLine').addEventListener('change', () => {
        const opt = el('nTargetLine').selectedOptions[0];
        el('nTarget').value = opt.value === '__manual' ? '' : opt.value;
        /* เลือกคนที่รู้จักแล้ว → ล็อกชื่อให้ตรงโปรไฟล์ LINE เสมอ พิมพ์ทับเองไม่ได้ กันชื่อเพี้ยน
           จากที่คนพิมพ์เอง ส่วน "อื่นๆ" (ไม่รู้จักชื่อจริง) ปลดล็อกให้พิมพ์ป้ายเองได้ */
        if (opt.value && opt.value !== '__manual') {
          el('nLabel').value = opt.dataset.name || opt.value;
          el('nLabel').readOnly = true;
        } else {
          el('nLabel').value = '';
          el('nLabel').readOnly = false;
        }
        syncTargetField();
      });
    }

    el('nAdd').addEventListener('click', async () => {
      const channel = el('nChannel').value;
      const label = el('nLabel').value.trim();
      const target = el('nTarget').value.trim();
      if (!target) { toast('ต้องระบุปลายทาง', true); return; }
      try {
        await api('/notification-recipients', { method: 'POST', body: JSON.stringify({ channel, label, target }) });
        toast(`เพิ่ม "${label || target}" แล้ว`);
        renderSystemAdmin();
      } catch (error) { toast(error.message, true); }
    });

    main.querySelectorAll('.nrm').forEach((btn) => {
      btn.addEventListener('click', async () => {
        /* เดิมใช้ confirm() ของเบราว์เซอร์ — บางเบราว์เซอร์/บางการตั้งค่าปิดกั้น dialog แบบนี้ไปเลย
           กดแล้วเหมือนไม่มีอะไรเกิดขึ้น (ไม่มี error ให้เห็นด้วย) เปลี่ยนมาใช้ confirmModal ของแอปเอง
           ที่ไม่ใช่ native dialog จึงไม่โดนบล็อกแบบนั้น */
        const ok = await confirmModal({
          iconName: 'trash-solid', danger: true,
          title: 'ลบผู้รับแจ้งเตือนนี้?',
          message: `ผู้รับแจ้งเตือน "<b>${esc(btn.dataset.label)}</b>" จะไม่ได้รับการแจ้งเตือนอีกต่อไป`,
          confirmLabel: 'ลบ',
        });
        if (!ok) return;
        btn.disabled = true;
        try {
          await api(`/notification-recipients/${encodeURIComponent(btn.dataset.id)}`, { method: 'DELETE' });
          toast('ลบแล้ว');
          renderSystemAdmin();
        } catch (error) {
          btn.disabled = false;
          toast(error.message, true);
        }
      });
    });
  }

  if (tab !== 2) return;

  el('uAdd').addEventListener('click', async () => {
    const username = el('uUsername').value.trim();
    const nameTh = el('uName').value.trim();
    const password = el('uPassword').value;
    const role = el('uRole').value;
    if (!username || !nameTh || !password) {
      toast('ต้องกรอก username, ชื่อ, และรหัสผ่านให้ครบ', true);
      return;
    }
    try {
      await api('/users', { method: 'POST', body: JSON.stringify({ username, nameTh, password, role }) });
      toast(`เพิ่มผู้ใช้ "${nameTh}" แล้ว`);
      renderSystemAdmin();
    } catch (error) { toast(error.message, true); }
  });

  main.querySelectorAll('.uRoleSel').forEach((sel) => {
    sel.addEventListener('change', async () => {
      try {
        await api(`/users/${encodeURIComponent(sel.dataset.user)}`, {
          method: 'PATCH', body: JSON.stringify({ role: sel.value }),
        });
        toast(`เปลี่ยน role ของ ${sel.dataset.user} เป็น ${sel.value} แล้ว`);
        renderSystemAdmin();
      } catch (error) { toast(error.message, true); renderSystemAdmin(); }
    });
  });

  main.querySelectorAll('.uActiveToggle').forEach((checkbox) => {
    checkbox.addEventListener('change', async () => {
      const turningOn = checkbox.checked;
      if (!turningOn) {
        const ok = await confirmModal({
          iconName: 'trash-solid', danger: true,
          title: 'ปิดใช้งานผู้ใช้นี้?',
          message: `ผู้ใช้ "<b>${esc(checkbox.dataset.user)}</b>" จะล็อกอินไม่ได้ทันที และเซสชันที่ล็อกอินอยู่ตอนนี้จะถูกเลิกทันที`,
          confirmLabel: 'ปิดใช้งาน',
        });
        if (!ok) { checkbox.checked = true; return; }
      }
      checkbox.disabled = true;
      try {
        await api(`/users/${encodeURIComponent(checkbox.dataset.user)}`, {
          method: 'PATCH', body: JSON.stringify({ active: turningOn }),
        });
        toast(turningOn ? `เปิดใช้งาน ${checkbox.dataset.user} แล้ว` : `ปิดใช้งาน ${checkbox.dataset.user} แล้ว`);
        renderSystemAdmin();
      } catch (error) {
        toast(error.message, true);
        checkbox.checked = !turningOn;
        checkbox.disabled = false;
      }
    });
  });

  main.querySelectorAll('[data-del-user]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await confirmModal({
        iconName: 'trash-solid', danger: true,
        title: 'ลบผู้ใช้นี้?',
        message: `บัญชี "<b>${esc(btn.dataset.name)}</b>" (${esc(btn.dataset.delUser)}) จะถูกลบทิ้งถาวร ล็อกอินไม่ได้อีก — กู้คืนไม่ได้`,
        confirmLabel: 'ลบ',
      });
      if (!ok) return;
      try {
        await api(`/users/${encodeURIComponent(btn.dataset.delUser)}`, { method: 'DELETE' });
        toast(`ลบผู้ใช้ ${btn.dataset.delUser} แล้ว`);
        renderSystemAdmin();
      } catch (error) { toast(error.message, true); }
    });
  });
}

/* ══ ทะเบียนใบแจ้งหนี้ ══════════════════════════════════════
   ไว้กางยอด VAT / หัก ณ ที่จ่าย ของหลายรอบเทียบกันในตารางเดียว
   ซึ่งหน้ารอบบิลทำไม่ได้เพราะดูได้ทีละรอบ
   หมายเหตุ: นี่คือ "สิ่งที่เราส่งเข้าไป" ไม่ใช่สถานะล่าสุดใน FlowAccount */
async function renderInvoices() {
  const invoices = await api(`/invoices${contractQuery()}`);
  const sum = (k) => invoices
    .filter((i) => i.status === 'sent_to_flowaccount')
    .reduce((s, i) => s + (i[k] ?? 0), 0);

  main.innerHTML = `
  <div class="page">
    <div class="phd"><div><span class="ey">${tx('เอกสาร')}</span><h1>${tx('ใบแจ้งหนี้')}</h1>
      <p>${tx('เอกสารที่ระบบสร้างเข้า FlowAccount — กางยอดภาษีของทุกรอบไว้เทียบกัน')}</p></div></div>

    <div class="card"><div class="tw"><table style="min-width:960px">
      <thead><tr><th>${tx('เลขที่เอกสาร')}</th><th>${tx('รอบบิล')}</th><th>${tx('ลูกค้า')}</th>
        <th class="r">${tx('หลังส่วนลด')}</th><th class="r">VAT</th><th class="r">${tx('หัก ณ ที่จ่าย')}</th>
        <th class="r">${tx('ยอดรับชำระ')}</th><th style="width:150px">${tx('สถานะ')}</th></tr></thead>
      <tbody>${invoices.length ? invoices.map((i) => {
        const fileHref = i.document_no ? `/api/invoices/${encodeURIComponent(i.id)}/file` : null;
        return `
        <tr class="rw" data-cycle="${esc(i.contract_id)}|${esc(i.period)}">
          <td>${fileHref
            ? `<a class="file" href="${esc(fileHref)}" target="_blank" rel="noopener" title="${tx('เปิดดูใบวางบิล')}">
                 <span class="docid">${esc(i.document_no)}</span></a>
               <a class="btn sm icon" href="${esc(fileHref)}?dl" download="${esc(i.document_no)}.pdf"
                 title="${tx('ดาวน์โหลดใบวางบิล')}" aria-label="${tx('ดาวน์โหลด')}">${icon('cd')}</a>`
            : `<span class="docid">—</span>`}
              <span class="sub">${dateOnly(i.document_date)}</span></td>
          <td>${esc(i.periodLabel)}</td>
          <td>${esc(i.customer_name)}<span class="sub">${esc(i.po_no)}</span></td>
          <td class="r n">${money(i.total_after_discount)}</td>
          <td class="r n">${money(i.vat)}</td>
          <td class="r n" style="color:var(--cr)">−${money(i.withholding_tax)}</td>
          <td class="r n" style="font-weight:700;color:var(--brand-d)">${money(i.payment_amount)}</td>
          <td><span class="st ${i.status === 'sent_to_flowaccount' ? 'ok' : i.status === 'failed' ? 'cr' : 'wn'}">
            ${tx(i.status === 'sent_to_flowaccount' ? 'สร้างร่างแล้ว' : i.status === 'failed' ? 'ส่งไม่สำเร็จ' : 'ร่าง')}</span>
            ${i.response?.mode === 'dry-run' ? '<span class="sub">dry-run</span>' : ''}
            ${i.email_sent_at ? `<span class="sub">${tx('ส่งเมลแล้ว')} ${dt(i.email_sent_at)}</span>` : ''}</td></tr>`;
      }).join('')
        : `<tr><td colspan="8" class="empty">${tx('ยังไม่มีใบแจ้งหนี้ — สร้างได้ที่ขั้น 3')}</td></tr>`}</tbody>
      ${invoices.length ? `<tfoot><tr>
        <td colspan="3" style="font-weight:600">${tx('รวมยอดที่วางบิลแล้ว')}</td>
        <td class="r n">${money(sum('total_after_discount'))}</td>
        <td class="r n">${money(sum('vat'))}</td>
        <td class="r n" style="color:var(--cr)">−${money(sum('withholding_tax'))}</td>
        <td class="r n" style="font-weight:700;color:var(--brand-d)">${money(sum('payment_amount'))}</td>
        <td></td></tr></tfoot>` : ''}
    </table></div></div>
  </div>`;

  bindRows();
}

const RENDER = {
  dash: renderDashboard,
  upload: renderUpload, queue: renderQueue, cycles: renderCycles,
  invoices: renderInvoices, master: renderMaster, sysadmin: renderSystemAdmin,
};

/** แท็บที่ควรถูกไฮไลต์เมื่ออยู่ในหน้าย่อย */
const PARENT_TAB = { detail: 'queue', cycle: 'cycles' };

function markTab(view) {
  const active = PARENT_TAB[view] ?? view;
  document.querySelectorAll('.mtab').forEach((b) =>
    b.classList.toggle('on', b.dataset.view === active));
}

function setNav(view) {
  state.view = view;
  markTab(view);
  render();
}

/* ── ป้ายตัวเลขสด ─────────────────────────────────────────────
   ป้ายบนเมนูขั้นที่ 2 และ 3 บอกว่ามีงานค้างกี่ชิ้นในขั้นนั้น
   คนใช้ไม่ควรต้องกดรีเฟรชเพื่อรู้ว่ามีของใหม่ จึงถาม /pulse เป็นจังหวะ
   เขียนป้ายจากที่นี่ที่เดียว หน้าอื่นไม่ต้องเขียนเอง เลขจะได้ตรงกันทุกหน้า */

/* เซิร์ฟเวอร์เป็นฝ่ายบอกเองผ่าน /api/stream ป้ายจึงขึ้นแทบทันทีที่มีของใหม่
   การถามเป็นจังหวะยังเก็บไว้ห่างๆ เป็นตัวกันพลาด เผื่อข่าวหลุดตอนสายขาด */
const PULSE_MS = 60_000;
let pulseTimer = null;
let nudgeTimer = null;
let changeStream = null;

async function syncBadges() {
  let p;
  try { p = await api('/pulse'); } catch { return; }   // ป้ายพลาดไม่ควรทำให้หน้าพัง

  const queue = el('queueBadge');
  queue.textContent = int(p.needsAction);
  queue.classList.toggle('zero', p.needsAction === 0);

  const cycle = el('cycleBadge');
  cycle.textContent = int(p.readyToApprove);
  cycle.classList.toggle('zero', p.readyToApprove === 0);

  paintBell(p.feed);
  if (!el('bellPop').hidden) renderBellPop(p.feed);   // แผงเปิดอยู่ก็เห็นของใหม่ทันที

  const chip = el('envChip');
  chip.className = `env ${p.flowAccountMode === 'dry-run' ? 'dry' : 'live'}`;
  chip.innerHTML = `<span class="sw"></span> FlowAccount: ${esc(p.flowAccountMode)}`;

  /* ชื่อบนแถบบนต้องเป็นชื่อเดียวกับที่ audit log บันทึก ไม่ใช่ป้ายตกแต่ง — มาจาก session ที่ login เข้ามา */
  const ROLE_LABEL = { admin: 'ผู้ดูแลระบบ', user: 'ผู้ใช้งาน' };
  el('actorName').textContent = p.actor;
  el('actorAvatar').textContent = initials(p.actor);
  el('actorRole').textContent = ROLE_LABEL[p.role] ?? 'ผู้ใช้ระบบ';
  /* ในเมนูโชว์ username ที่ใช้ login ด้วย — ชิปด้านนอกโชว์ชื่อไทย ซึ่งคนละตัวกัน
     เปิดเมนูแล้วต้องรู้ได้ว่ากำลังใช้บัญชีไหนอยู่จริงก่อนกดออกจากระบบ */
  el('actorUser').textContent = state.username ?? p.actor;
  el('actorRole2').textContent = ROLE_LABEL[p.role] ?? 'ผู้ใช้ระบบ';

  /* เมนู "จัดการระบบ" กับ "ข้อมูลหลัก" (เรทพนักงาน สัญญา ชื่อพ้อง วันหยุด) เห็นเฉพาะ admin —
     server บล็อก 403 ไว้อีกชั้นอยู่แล้วที่ทุก endpoint เขียนข้อมูล (ดู requireAdmin ใน server.js)
     ฝั่งนี้ซ่อนเมนูไว้เป็นแค่ความสะดวก ไม่ใช่ตัวกันหลัก — user ไม่ควรเห็นปุ่มที่กดแล้วเจอ error ตั้งแต่แรก
     renderMaster()/renderSystemAdmin() เองก็เช็ค role ซ้ำอีกชั้น เผื่อมีคนสลับ view ตรงๆ ทาง URL/console */
  state.role = p.role;
  el('sysAdminTab').hidden = p.role !== 'admin';
  el('masterNavBtn').hidden = p.role !== 'admin';
  /* สลับบริษัทที่กำลังดำเนินการอยู่กระทบทั้งระบบ (เหมือนแก้ข้อมูลหลักอื่นๆ) จึงให้แค่ admin กดได้
     server บล็อกไว้เป็นด่านหลักอยู่แล้ว (ดู requireAdmin ที่ PATCH /api/contracts/:id/active)
     ที่นี่แค่ปิดปุ่มไว้ไม่ให้ user ทั่วไปกดแล้วเจอ error ทันที แต่ยังเห็นว่าตอนนี้ทำงานให้บริษัทไหนอยู่ */
  el('contractSwitchBtn').disabled = p.role !== 'admin';
}

/* หนึ่งการกระทำมักบันทึกหลายเหตุการณ์ติดกัน (เช่นอนุมัติรอบบิล)
   รอให้ข่าวชุดนั้นมาครบก่อนแล้วถามครั้งเดียว ไม่ใช่ถามทุกข่าว */
function nudge() {
  clearTimeout(nudgeTimer);
  nudgeTimer = setTimeout(() => { syncBadges(); refreshView(); }, 200);
}

/* ข้อมูลเปลี่ยนแล้วหน้าที่กำลังดูอยู่ต้องตามให้ทันเอง จึงไม่ต้องมีปุ่มให้กดรีเฟรช
   ข้ามถ้ากำลังพิมพ์อยู่ในหน้า เพราะการวาดใหม่จะดึงโฟกัสและตำแหน่งเคอร์เซอร์ไป
   ข้ามหน้ารายละเอียดกับหน้ารอบบิลด้วย เพราะคนกำลังอ่านเอกสารใบนั้นอยู่
   ไม่ควรถูกวาดใหม่คาตา — ปุ่มในหน้านั้นวาดใหม่เองอยู่แล้วเมื่อกดสั่งงาน */
function refreshView() {
  const focused = document.activeElement;
  if (focused && main.contains(focused) && focused.matches('input, textarea, select')) return;
  // หน้าอัปโหลดเป็นฟอร์มที่มีไฟล์ที่เลือกไว้ค้างอยู่ วาดใหม่ทีไฟล์หลุด
  if (state.view === 'upload') return;
  if (RENDER[state.view]) render({ silent: true });
}

function startPulse() {
  clearInterval(pulseTimer);
  pulseTimer = setInterval(() => { syncBadges(); refreshView(); }, PULSE_MS);
}

/* EventSource ต่อสายกลับให้เองเมื่อสายหลุดหรือเซิร์ฟเวอร์รีสตาร์ต
   จึงไม่ต้องเขียนตรรกะต่อใหม่เอง และสายที่ต่อกลับได้ก็จะถามยอดล่าสุดทันที */
function listenForChanges() {
  changeStream?.close();
  changeStream = new EventSource('/api/stream');
  changeStream.addEventListener('change', nudge);
  changeStream.addEventListener('open', () => syncBadges());   // ตามยอดที่อาจพลาดไปช่วงสายขาด
}

/* แท็บที่ถูกซ่อนไว้ไม่ต้องถามเซิร์ฟเวอร์ทิ้งเปล่าๆ กลับมาดูค่อยถามทันทีทีเดียว */
document.addEventListener('visibilitychange', () => {
  if (document.hidden) clearInterval(pulseTimer);
  else { syncBadges(); refreshView(); startPulse(); }
});

/**
 * วาดหน้าที่กำลังดูอยู่ใหม่
 * silent = วาดทับไปเลยโดยไม่ขึ้น "กำลังโหลด" และไม่เลื่อนกลับขึ้นบนสุด
 * ใช้ตอนข้อมูลเปลี่ยนเองจากข้างนอก ไม่ใช่ตอนคนกดเปลี่ยนหน้า
 */
async function render({ silent = false } = {}) {
  if (!silent) main.innerHTML = '<div class="loading">กำลังโหลด…</div>';
  syncBadges();
  try {
    await RENDER[state.view]();
  } catch (error) {
    main.innerHTML = `<div class="page"><div class="card"><div class="empty">
      ${icon('alt', 'i')}<div>${esc(error.message)}</div></div></div></div>`;
    toast(error.message, true);
  }
  if (!silent) window.scrollTo({ top: 0 });
}

document.querySelectorAll('.mtab').forEach((btn) => {
  btn.addEventListener('click', () => setNav(btn.dataset.view));
});

/* ── ย่อ/กางเมนูข้าง ─────────────────────────────────────────
   หน้าที่กว้างอย่างหน้าอนุมัติรอบบิล (สองคอลัมน์ + ใบแจ้งหนี้) ได้ที่คืนมา 192px
   จำสถานะไว้ใน localStorage เพราะเป็นความชอบของคนใช้ ไม่ใช่ข้อมูลของระบบ
   ตอนหุบยังอ่านออกว่าอยู่ขั้นไหน — เลขขั้นอยู่มุมไอคอน และมี tooltip กำกับทุกปุ่ม */
const SIDE_KEY = 'obs.sideCollapsed';

function applySideState(collapsed) {
  document.body.classList.toggle('side-collapsed', collapsed);
  const btn = el('sideToggle');
  btn.setAttribute('aria-pressed', String(collapsed));
  btn.title = collapsed ? 'กางเมนู' : 'ย่อเมนู';
  btn.setAttribute('aria-label', btn.title);
}

el('sideToggle').addEventListener('click', () => {
  const collapsed = !document.body.classList.contains('side-collapsed');
  localStorage.setItem(SIDE_KEY, collapsed ? '1' : '0');
  applySideState(collapsed);
});

/* ── สลับภาษา ไทย/อังกฤษ (27 ส.ค. 69) ─────────────────────────
   แทนที่ตำแหน่งวันที่เดิมบนแถบบน (#langSwitch) แปล 2 ชั้น: (1) โครงแอปที่เป็น HTML คงที่ (แถบบน/
   เมนูข้าง/หน้า login) ผ่าน data-th/data-en ตรงตัว (2) เนื้อหาที่ render() สร้างใหม่ทุกครั้ง (ตาราง/
   ฟอร์ม/การ์ด) ผ่าน tx('ข้อความไทย') ที่ผูกกับ T dictionary — ต้องสั่ง render() ซ้ำหลังสลับภาษา
   ไม่งั้นชั้นที่ 2 จะไม่รีเฟรช เพราะ HTML เดิมถูกสร้างไว้ตั้งแต่ตอนภาษาก่อนหน้าแล้ว */
const LANG_KEY = 'obs.lang';

function applyLang(lang) {
  state.lang = lang;
  document.querySelectorAll('#langSwitch .opt').forEach((o) => o.classList.toggle('on', o.dataset.set === lang));
  document.querySelectorAll('[data-th][data-en]').forEach((elx) => {
    elx.textContent = lang === 'en' ? elx.dataset.en : elx.dataset.th;
  });
}

el('langSwitch').addEventListener('click', (e) => {
  const opt = e.target.closest('.opt');
  if (!opt || opt.dataset.set === state.lang) return;
  const lang = opt.dataset.set;
  localStorage.setItem(LANG_KEY, lang);
  applyLang(lang);
  /* state.view อาจเป็น 'detail'/'cycle' ซึ่งเป็นหน้าย่อยที่เปิดตรงๆ ไม่ได้อยู่ใน RENDER dispatch
     (ดู render()) ต้องเรียกฟังก์ชันเปิดหน้านั้นซ้ำเอง render() เฉยๆจะหา RENDER['detail'] ไม่เจอแล้ว throw */
  if (state.view === 'detail' && state.detailId) openSheet(state.detailId);
  else if (state.view === 'cycle' && state.cycleContractId) openCycle(state.cycleContractId, state.cyclePeriod);
  else if (RENDER[state.view]) render();
});


/* ── กระดิ่งแจ้งเตือน ────────────────────────────────────────
   ตอบคำถาม "อะไรเพิ่งเกิดขึ้น" จาก audit_log พร้อมนับอ่าน/ไม่อ่าน
   ต่างจากการ์ด "งานที่ต้องทำ" บนแดชบอร์ดที่ตอบ "อะไรยังค้าง" — คนละคำถาม
   ป้ายเลขมาจาก /pulse ที่หน้าจอถามอยู่แล้ว ไม่ได้ยิงถามเพิ่ม */

const READ_KEY = 'obs.notifRead';
const READ_CAP = 500;   // เก็บเท่าที่จำเป็น ไม่ให้ localStorage บวม

const LEVEL_TONE = { critical: 'cr', warn: 'wn', ok: 'ok', info: 'info' };
const LEVEL_LABEL = { critical: 'ผิดพลาด', warn: 'ตีกลับ', ok: 'สำเร็จ', info: '' };

function readIds() {
  try { return new Set(JSON.parse(localStorage.getItem(READ_KEY) ?? '[]')); }
  catch { return new Set(); }
}

function saveReadIds(set) {
  const keep = [...set].sort((a, b) => b - a).slice(0, READ_CAP);
  localStorage.setItem(READ_KEY, JSON.stringify(keep));
}

function markRead(ids) {
  const set = readIds();
  ids.forEach((i) => set.add(i));
  saveReadIds(set);
}

/** เวลาแบบอ่านง่าย — ใกล้ๆ บอกเป็นนาที ไกลแล้วบอกเป็นวันที่ */
function ago(iso) {
  if (!iso) return '';
  const d = toDate(iso);
  if (!d) return String(iso);
  const min = Math.floor((Date.now() - d.getTime()) / 60000);
  if (min < 1) return 'เมื่อสักครู่';
  if (min < 60) return `${min} นาทีที่แล้ว`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} ชั่วโมงที่แล้ว`;
  const day = Math.floor(hr / 24);
  if (day === 1) return 'เมื่อวาน';
  if (day < 7) return `${day} วันที่แล้ว`;
  return dateOnly(iso);
}

function closeBell() {
  el('bellPop').hidden = true;
  el('bellBtn').setAttribute('aria-expanded', 'false');
}

/** ป้ายบนกระดิ่ง = จำนวนรายการที่ยังไม่ได้กดอ่าน */
function paintBell(feed) {
  const read = readIds();
  const unread = feed.items.filter((i) => !read.has(i.id)).length;
  const dot = el('bellCount');
  dot.hidden = unread === 0;
  dot.textContent = unread > 9 ? '9+' : unread;
  el('bellBtn').title = unread ? `${unread} เรื่องที่ยังไม่ได้อ่าน` : 'อ่านครบแล้ว';
}

function renderBellPop(feed) {
  const read = readIds();
  const unreadCount = feed.items.filter((i) => !read.has(i.id)).length;

  el('bellPop').innerHTML = `
    <div class="bp-hd">
      <b>การแจ้งเตือน</b>
      <span>${unreadCount ? `ยังไม่ได้อ่าน ${int(unreadCount)} เรื่อง` : 'อ่านครบแล้ว'}</span>
    </div>
    ${feed.items.length
      ? `<ul class="bp-list">${feed.items.map((n, i) => `
          <li><button data-bnotif="${i}" class="${read.has(n.id) ? '' : 'unread'}">
            <span class="tic ${LEVEL_TONE[n.level] ?? 'info'}">
              ${icon(n.level === 'critical' || n.level === 'warn' ? 'alt' : n.level === 'ok' ? 'chk' : 'info')}</span>
            <span class="bp-tx">
              <span class="bp-t">${esc(n.title)}</span>
              <span class="bp-d">${esc(n.detail)}</span>
              <span class="bp-m">${esc(ago(n.at))} · โดย ${esc(n.by)}</span>
            </span>
            ${LEVEL_LABEL[n.level]
              ? `<span class="tg ${LEVEL_TONE[n.level]}">${LEVEL_LABEL[n.level]}</span>` : ''}
          </button></li>`).join('')}</ul>
         <div class="bp-ft">
           ${unreadCount ? '<button class="lk" id="bellAll">อ่านแล้วทั้งหมด</button>' : ''}
         </div>`
      : '<div class="bp-empty">ยังไม่มีเหตุการณ์ในระบบ</div>'}`;

  el('bellPop').querySelectorAll('[data-bnotif]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const item = feed.items[Number(btn.dataset.bnotif)];
      markRead([item.id]);          // อ่านทีละรายการ ป้ายลดลงทีละหนึ่ง
      paintBell(feed);
      if (item.link) { closeBell(); openNotification(item); }
      else renderBellPop(feed);     // รายการที่ไม่มีที่ให้ไป แค่ทำเป็นอ่านแล้ว
    });
  });
  el('bellAll')?.addEventListener('click', () => {
    markRead(feed.items.map((i) => i.id));
    paintBell(feed);
    renderBellPop(feed);
  });
}

el('bellBtn').addEventListener('click', async (e) => {
  e.stopPropagation();
  /* ต้องสั่งปิดเมนูอื่นตรงนี้เอง — stopPropagation ข้างบนกันไม่ให้คลิกลอยไปถึง document
     ตัวปิดเมนูอื่นที่ดักไว้ที่ document จึงไม่มีวันได้ทำงาน แล้วสองแผงจะเปิดซ้อนกัน */
  closeWho();
  closeCtx();
  const pop = el('bellPop');
  if (!pop.hidden) { closeBell(); return; }
  try {
    const feed = await api('/activity?limit=25');
    /* ทาสีป้ายจากชุดข้อมูลเดียวกับที่กำลังจะแสดงในแผง
       ไม่มีบรรทัดนี้ ป้ายจะค้างเลขเก่าจนถึงรอบถามถัดไป (60 วินาที)
       คนจึงเห็น "แจ้งเตือน 6" แล้วกดเข้าไปเจอแผงว่าง */
    paintBell(feed);
    renderBellPop(feed);            // เปิดดูเฉยๆ ไม่นับว่าอ่าน ต้องกดรายการเอง
    pop.hidden = false;
    el('bellBtn').setAttribute('aria-expanded', 'true');
  } catch (error) { toast(error.message, true); }
});

document.addEventListener('click', (e) => {
  if (!el('bellPop').hidden && !e.target.closest('.bellwrap')) closeBell();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeBell();
});

/* ── login / logout ──────────────────────────────────────────
   หน้า login เป็น overlay คลุมทับทุกอย่าง (ดู .login-screen ใน styles.css)
   ไม่ต้องแยกหน้าจริง แค่โชว์/ซ่อนทับของเดิม เพราะ shell ที่เหลือไม่ทำอะไรถ้าไม่มี session อยู่แล้ว */

function showLoginScreen(message) {
  el('loginScreen').hidden = false;
  if (message) {
    el('loginErr').textContent = message;
    el('loginErr').hidden = false;
  }
  clearInterval(pulseTimer);
  changeStream?.close();
}

function hideLoginScreen() {
  el('loginScreen').hidden = true;
  el('loginErr').hidden = true;
  el('loginForm').reset();
}

/* ── login เข้า HRDD (WorkDD) เพิ่มเติม ───────────────────────
   ยิงหลังจาก login เข้าระบบ OBS สำเร็จ เพื่อเอา accessToken มาเก็บไว้เรียกข้อมูลจาก HRDD
   API ตรงจาก frontend ต่อได้ — เก็บใน localStorage แยกจาก session cookie ของ OBS เอง
   ยิงไม่สำเร็จก็ไม่บล็อกการเข้าระบบ OBS (แค่ยังไม่มี token ไปเรียก HRDD ต่อ) */
const HRDD_TOKEN_KEY = 'hrddAccessToken';
const HRDD_TOKEN_TYPE_KEY = 'hrddTokenType';

async function loginHrdd() {
  try {
    const response = await fetch('http://43.208.215.145:3003/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include', // ต้องใส่เพราะ backend ตั้ง allowCredentials(true)
      body: JSON.stringify({
        username: 'obs.test@workdd.com',
        password: '1234',
      }),
    });
    const data = await response.json();
    if (!response.ok || !data?.accessToken) {
      console.error('HRDD login ไม่สำเร็จ:', data);
      return null;
    }
    localStorage.setItem(HRDD_TOKEN_KEY, data.accessToken);
    localStorage.setItem(HRDD_TOKEN_TYPE_KEY, data.tokenType ?? 'Bearer');
    return data.accessToken;
  } catch (error) {
    console.error('เชื่อมต่อ HRDD ไม่สำเร็จ:', error);
    return null;
  }
}

/* ปุ่มในข้อความ LINE พา query string มาเปิดหน้าที่ต้องทำงานต่อได้ทันที ไม่ต้องกดเมนูหาเอง
     ?view=queue                              → คิว "ตรวจ Manday"
     ?view=cycle&contract=…&period=YYYY-MM    → หน้า "วางบิล & ร่างอีเมล" ของรอบบิลนั้น
   เช็คแค่ตอนเปิดแอปครั้งแรกเท่านั้น ไม่งั้นจะดึงกลับหน้านั้นซ้ำๆทุกครั้งที่ browser back/forward
   เพราะ query string ยังติดอยู่ใน URL

   คืนรอบบิลที่ต้องเปิดต่อ (ถ้ามี) แทนที่จะเปิดเองที่นี่ เพราะ openCycle() ต้องรอ API
   ต้องให้ startApp เป็นคนสั่งเปิดหลังหน้าแรกขึ้นแล้ว จะได้ไม่มีจอโล่งค้างระหว่างโหลด */
function applyDeepLinkView() {
  const q = new URLSearchParams(window.location.search);
  const requested = q.get('view');

  if (requested === 'cycle') {
    const contractId = q.get('contract');
    const period = q.get('period');
    if (contractId && period) {
      markTab('cycle');
      return { contractId, period };
    }
  }
  if (requested && RENDER[requested]) {
    state.view = requested;
    markTab(requested);
  }
  return null;
}

/* ── ตัวเลือกบริษัท/สัญญาที่กำลังดำเนินการอยู่ (แถบบน) ──────────
   ค่านี้เป็นสถานะกลางของ "ทั้งระบบ" ไม่ใช่แค่ของคนที่กำลังดูอยู่คนเดียว — เก็บที่ contracts.status
   ในฐานข้อมูล (ดู setActiveContract ใน src/service.js) เปลี่ยนแล้วทุกคนที่เปิดหน้าเว็บพร้อมกันเห็นตรงกัน */

/** ต่อท้าย URL ของ /dashboard, /timesheets, /invoices, /employees, /cycles, /ai-reads ให้กรองเหลือแค่สัญญาที่เลือกอยู่ */
function contractQuery() {
  return state.contractId ? `?contractId=${encodeURIComponent(state.contractId)}` : '';
}

/** รายชื่อบริษัท/สัญญาที่ดึงมาล่าสุด — เก็บไว้ใช้ตอนวาดแผงลอยใหม่ทุกครั้งที่กดเปิด
 * ไม่ต้องยิง /contracts ซ้ำทุกครั้งที่เปิด-ปิด (แค่ตอน loadContractSwitch() ครั้งแรก และหลังสลับ) */
let ctxContracts = [];

function closeCtx() {
  el('contractSwitchPop').hidden = true;
  el('contractSwitchBtn').setAttribute('aria-expanded', 'false');
}

function ctxLabel(c) {
  return `${c.customer_name} — ${c.project_name}`;
}

function renderCtxPop() {
  el('contractSwitchPop').innerHTML = ctxContracts.map((c) => {
    const on = c.id === state.contractId;
    return `
    <button class="ctx-item ${on ? 'on' : ''}" role="option" aria-selected="${on}" data-ctx="${esc(c.id)}">
      <span class="chk">${on ? icon('chk', 'i sm') : ''}</span>
      <span class="tx"><b>${esc(c.customer_name)}</b><span>${esc(c.project_name)}</span></span>
      <span class="tg ${c.status === 'active' ? 'ok' : 'mu'}">${c.status === 'active' ? 'กำลังดำเนินการ' : 'ปิดอยู่'}</span>
    </button>`;
  }).join('');

  el('contractSwitchPop').querySelectorAll('[data-ctx]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const contractId = btn.dataset.ctx;
      closeCtx();
      if (contractId === state.contractId) return;   // กดอันที่เลือกอยู่แล้ว ไม่ต้องยิงซ้ำ
      const target = ctxContracts.find((c) => c.id === contractId);
      try {
        await api(`/contracts/${encodeURIComponent(contractId)}/active`, {
          method: 'PATCH', body: JSON.stringify({ active: true }),
        });
        state.contractId = contractId;
        ctxContracts = ctxContracts.map((c) => ({ ...c, status: c.id === contractId ? 'active' : 'inactive' }));
        el('contractSwitchLabel').textContent = target ? ctxLabel(target) : '…';
        toast(`สลับไปทำงานกับ "${target ? ctxLabel(target) : contractId}" แล้ว`);
        render();
      } catch (error) {
        toast(error.message, true);
      }
    });
  });
}

/** ดึงรายชื่อบริษัท/สัญญาทั้งหมดมาใส่ตัวเลือกบนแถบบน — เรียกครั้งเดียวตอนเปิดแอป
 * ถ้ายังไม่มีสัญญาเลย (ระบบใหม่เอี่ยม) ซ่อนตัวเลือกไว้ ไม่มีอะไรให้เลือก */
async function loadContractSwitch() {
  const wrap = el('contractSwitchWrap');
  try { ctxContracts = await api('/contracts'); } catch { ctxContracts = []; }

  if (!ctxContracts.length) { wrap.hidden = true; state.contractId = null; return; }

  const active = ctxContracts.find((c) => c.status === 'active') ?? null;
  state.contractId = active?.id ?? null;
  el('contractSwitchLabel').textContent = active ? ctxLabel(active) : 'ยังไม่มีบริษัทที่กำลังดำเนินการ';
  wrap.hidden = false;
}

el('contractSwitchBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  closeBell();
  closeWho();
  const pop = el('contractSwitchPop');
  if (!pop.hidden) { closeCtx(); return; }
  renderCtxPop();
  pop.hidden = false;
  el('contractSwitchBtn').setAttribute('aria-expanded', 'true');
});

document.addEventListener('click', (e) => {
  if (!el('contractSwitchPop').hidden && !e.target.closest('.ctxwrap')) closeCtx();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !el('contractSwitchPop').hidden) {
    closeCtx();
    el('contractSwitchBtn').focus();
  }
});

async function startApp() {
  hideLoginScreen();
  applySideState(localStorage.getItem(SIDE_KEY) === '1');
  applyLang(state.lang);
  const deepCycle = applyDeepLinkView();

  await loadContractSwitch();

  if (deepCycle) {
    syncBadges();  // render() ปกติเป็นคนเรียกให้ แต่รอบนี้ข้าม render() ไปเปิดรอบบิลตรงๆ
    await openCycle(deepCycle.contractId, deepCycle.period);
  } else {
    render();      // render() เรียก syncBadges() ให้ป้ายขึ้นรอบแรกอยู่แล้ว
  }
  listenForChanges();
  startPulse();
}

el('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = el('loginBtn');
  btn.disabled = true;
  el('loginErr').hidden = true;
  try {
    await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: el('loginUser').value.trim(),
        password: el('loginPass').value,
      }),
    });
    await loginHrdd();
    await startApp();
  } catch (error) {
    el('loginErr').textContent = error.message;
    el('loginErr').hidden = false;
  } finally {
    btn.disabled = false;
  }
});

/* ── เมนูบัญชีบนแถบบน ────────────────────────────────────────
   เปิด/ปิดแบบเดียวกับแผงแจ้งเตือนใต้กระดิ่ง — กดข้างนอกหรือ Esc ก็ปิด */

function closeWho() {
  el('whoPop').hidden = true;
  el('whoBtn').setAttribute('aria-expanded', 'false');
}

el('whoBtn').addEventListener('click', () => {
  const pop = el('whoPop');
  if (pop.hidden) {
    closeBell();               // เปิดทีละอัน ไม่ให้สองแผงซ้อนกัน
    closeCtx();
    pop.hidden = false;
    el('whoBtn').setAttribute('aria-expanded', 'true');
    el('logoutBtn').focus();   // เปิดมาแล้วกด Enter ต่อได้เลย ไม่ต้องไล่ Tab
  } else closeWho();
});

document.addEventListener('click', (e) => {
  if (!el('whoPop').hidden && !e.target.closest('.who')) closeWho();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !el('whoPop').hidden) {
    closeWho();
    el('whoBtn').focus();
  }
});

el('logoutBtn').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  /* ยิงบอกเซิร์ฟเวอร์ให้ลบ session ทิ้ง — ยิงไม่สำเร็จก็ยังต้องพากลับไปหน้า login อยู่ดี
     ไม่งั้นคนกดออกจากระบบแล้วยังค้างอยู่ในหน้าเดิม นึกว่าออกไปแล้วทั้งที่ยังไม่ออก */
  try { await api('/auth/logout', { method: 'POST' }); } catch { /* ไม่ได้ก็เคลียร์ฝั่งเราไปเลย */ }
  localStorage.removeItem(HRDD_TOKEN_KEY);
  localStorage.removeItem(HRDD_TOKEN_TYPE_KEY);
  btn.disabled = false;
  closeWho();
  showLoginScreen();
});

(async function boot() {
  let me;
  try { me = await api('/auth/me'); } catch { me = { loggedIn: false }; }
  if (me.loggedIn) {
    state.username = me.username; // ใช้กันแก้ role/ปิดใช้งานบัญชีตัวเองในหน้าจัดการระบบ
    if (!localStorage.getItem(HRDD_TOKEN_KEY)) await loginHrdd(); // รีเฟรชหน้า/เปิดแท็บใหม่ตอน session OBS ยังอยู่ แต่ยังไม่มี HRDD token
    await startApp();
  } else showLoginScreen();
})();
