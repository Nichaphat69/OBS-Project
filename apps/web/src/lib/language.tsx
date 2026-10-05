'use client';

/**
 * สลับภาษา ไทย/อังกฤษ — ported from public/app.js's `applyLang()`/`state.lang`/`LANG_KEY`.
 *
 * ต้นฉบับแปล 2 ชั้น: (1) โครงแอปที่เป็น HTML คงที่ (แถบบน/เมนูข้าง) ผ่าน data-th/data-en ตรงตัว
 * (2) เนื้อหาที่ render() สร้างใหม่ทุกครั้ง (ตาราง/ฟอร์ม/การ์ด) ผ่าน tx('ข้อความไทย') ที่ผูกกับ T
 * dictionary (~290 บรรทัดใน app.js, ครอบคลุมข้อความในทุกหน้า)
 *
 * พอร์ตรอบนี้ (2026-09-14, ตามที่ขอ): สร้างกลไก useLang()/tx() ที่ทำงานแบบเดียวกันเป๊ะ (React context
 * แทน DOM query, localStorage key เดิม `obs.lang`) แล้วผูกให้ AppShell (แถบบน/เมนูข้าง) แปลได้ครบ —
 * แต่ยังไม่ได้ไล่ผูก tx() เข้ากับเนื้อหาของทุกหน้า (แดชบอร์ด/ตาราง/ฟอร์มต่างๆ อีก ~40 กว่าไฟล์) เหมือน
 * ต้นฉบับที่ทำครบทุกจุดในรอบเดียว — TX dictionary ด้านล่างมีแค่ข้อความที่ AppShell ใช้จริงตอนนี้ เพิ่ม
 * เข้าไปได้เรื่อยๆเมื่อจะผูกหน้าอื่นๆ ต่อ (โครงสร้างเดียวกับ T{} เดิม คัดลอกคำแปลจาก data-th/data-en
 * และ T{} ของต้นฉบับมาให้ตรงเป๊ะสำหรับทุกคำที่มีอยู่แล้ว)
 */
import { createContext, useContext, useEffect, useMemo, useState } from 'react';

export type Lang = 'th' | 'en';

const LANG_KEY = 'obs.lang';

/** คำแปล — คัดลอกจาก public/index.html's data-th/data-en และ public/app.js's T{} ตรงตัวสำหรับทุกคำ
 * ที่มีอยู่แล้วในต้นฉบับ ส่วนที่ต้นฉบับเองก็ไม่เคยแปลไว้ (เช่น "เชื่อมต่อ LINE"/"ออกจากระบบ" ที่เพิ่มเข้ามา
 * หลังฟีเจอร์สลับภาษา) เติมคำแปลที่สมเหตุสมผลเองแทน */
const TX: Record<string, string> = {
  'ช่องที่ดึงจาก FlowAccount แก้ไม่ได้ — ถ้าไม่ตรง ให้แก้ที่ FlowAccount แล้วเลือกใบเสนอราคาใหม่': 'Fields pulled from FlowAccount cannot be edited — if they are wrong, fix them in FlowAccount and pick the quotation again',
  'ดึงจาก FlowAccount — แก้ไม่ได้': 'From FlowAccount — read-only',
  'ไม่แน่ใจ: เว้นว่างไว้ ระบบจะใช้ชื่อมาตรฐานของตัวอ่านเอง': 'Not sure: leave it blank and the system uses the reader\'s standard name',
  'ถ้าเอกสารไม่มีฟิลด์นั้นเลย: กด "ไม่มีในฟอร์ม" ระบบจะไม่เตือนว่าหาฟิลด์ไม่เจอ': 'If the document does not have the field at all: press "Not in the form" and the system will not warn that it is missing',
  'ช่องตรงกลาง: พิมพ์ชื่อที่เอกสารของบริษัทนี้เรียกฟิลด์นั้น (ดูจากเอกสารจริง)': 'Middle column: type what this company\'s document calls the field (check a real document)',
  'ชื่อที่เอกสารของบริษัทเรียก': 'Name used in the company\'s document',
  'ฟิลด์ที่ระบบต้องการ': 'Field the system needs',
  'พบ': 'Found',
  'วิธีใช้': 'How to use',
  'ฟิลด์ที่ตั้งค่าแล้ว': 'fields set',
  'มีฟิลด์นี้ในฟอร์ม': 'Field is in the form',
  // ── error states ทั่วไป (ใช้ร่วมกันหลายหน้า — ดู components/ui.tsx's ErrorState) ──
  โหลดข้อมูลไม่สำเร็จ: 'Failed to load data',
  เกิดข้อผิดพลาด: 'Something went wrong',
  โหลดสถานะไม่สำเร็จ: 'Failed to load status',
  สลับบริษัทไม่สำเร็จ: 'Failed to switch company',
  'โหลด FlowAccount ไม่สำเร็จ': 'Failed to load FlowAccount',
  'โหลดสถานะ FlowAccount ไม่สำเร็จ — กดเพื่อลองใหม่': 'Failed to load FlowAccount status — click to retry',

  แดชบอร์ด: 'Dashboard',
  ความคืบหน้าของฉัน: 'My Progress',
  ภาพรวมทุกบริษัท: 'All Companies',
  การแจ้งเตือน: 'Notifications',
  ขั้นตอนการทำงาน: 'Workflow',
  'อัปโหลด Timesheet': 'Upload Timesheet',
  'ตรวจ Manday': 'Review Manday',
  'วางบิล & ร่างอีเมล': 'Billing & Email',
  อ้างอิง: 'Reference',
  ใบแจ้งหนี้: 'Invoices',
  แจ้งปัญหา: 'Support Tickets',
  ข้อมูลหลัก: 'Master Data',
  'Skill ABBYY': 'ABBYY Skills',
  จัดการระบบ: 'System Admin',
  'เชื่อมต่อ LINE': 'Connect LINE',
  ย่อเมนู: 'Collapse',
  กางเมนู: 'Expand',
  ออกจากระบบ: 'Log out',
  'กำลังออก…': 'Logging out…',
  ยังไม่มีบริษัทที่เลือก: 'No company selected',
  'เลือกบริษัท/สัญญาที่กำลังดำเนินการอยู่': 'Choose the active company/contract',
  กำลังดำเนินการ: 'Active',
  ปิดอยู่: 'Inactive',
  ผู้ดูแลระบบ: 'Administrator',
  บัญชี: 'Accounting',
  พนักงาน: 'Employee',
  ผู้บริหาร: 'Executive',

  // ── ภาพรวมทุกบริษัท (companies/ExecOverviewClient.tsx) ──
  'ข้อมูลรวมทุกบริษัทพร้อมกัน อัปเดตแบบเรียลไทม์': 'All companies at a glance, updated in real time',
  บริษัททั้งหมด: 'Total companies',
  พนักงานทั้งหมด: 'Total employees',
  มูลค่าสัญญารวม: 'Total contract value',
  บริษัท: 'Company',
  โครงการ: 'Project',
  มูลค่าสัญญา: 'Contract value',
  วางบิลแล้ว: 'Billed',
  ความคืบหน้า: 'Progress',
  ยังไม่มีสัญญาในระบบ: 'No contracts in the system yet',
  บาท: 'THB',

  // ── companies/[contractId]/CompanyDetailClient.tsx ──
  ไม่พบบริษัทนี้: 'Company not found',
  กลับภาพรวมทุกบริษัท: 'Back to all companies',
  ใบว่าจ้าง: 'PO number',
  'Timesheet ที่ได้รับ': 'Timesheets received',
  มูลค่ารอบนี้: 'This cycle’s value',
  สถานะรอบบิล: 'Billing cycle status',
  ยังไม่มีรอบบิลของสัญญานี้: 'No billing cycle for this contract yet',
  พนักงานในรอบนี้: 'Employees this cycle',
  คน: 'people',
  ตำแหน่ง: 'Position',
  'สถานะ Timesheet': 'Timesheet status',
  ยังไม่มีพนักงานผูกกับสัญญานี้: 'No employees linked to this contract yet',

  // ── สถานะรอบบิล (dashboardService.ts's CYCLE_STATE_LABEL) — ใช้ร่วมกันทุกหน้าที่โชว์สถานะรอบบิล ──
  'รอ Timesheet': 'Awaiting timesheets',
  ได้ไม่ครบ: 'Incomplete',
  ข้อมูลไม่ตรง: 'Data mismatch',
  รอคนตรวจ: 'Awaiting review',
  รออนุมัติ: 'Awaiting approval',

  // ── สถานะ Timesheet (dashboardService.ts's STATUS_LABEL) — ใช้ร่วมกันทุกหน้าที่โชว์สถานะ Timesheet ──
  รับเข้าระบบ: 'Received',
  อ่านข้อมูลแล้ว: 'Extracted',
  ตรวจผ่าน: 'Verified',
  อนุมัติแล้ว: 'Approved',
  ตีกลับให้แก้ไข: 'Rejected — needs revision',

  // ── dashboard/DashboardClient.tsx ──
  ความคืบหน้าสัญญา: 'Contract progress',
  ทุกบริษัท: 'All companies',
  เดือน: 'months',
  เปิด: 'Open',
  สวัสดีต้อนรับ: 'Welcome',
  'แดชบอร์ด OBS': 'OBS Dashboard',
  'ข้อมูล ณ': 'as of',
  รอตรวจสอบ: 'Awaiting review',
  มูลค่า: 'Value',
  พร้อมวางบิล: 'Ready to bill',
  ยอดวางบิลแล้ว: 'Billed total',
  ใบ: 'invoices',
  งานที่ต้องทำ: 'To-do',
  'สรุปสถานะ Timesheet': 'Timesheet status summary',
  ทั้งหมด: 'Total',
  ตีกลับ: 'Rejected',
  สัญญา: 'Contracts',
  มูลค่าคงเหลือ: 'Remaining value',
  ไม่มีสัญญา: 'No contracts',
  รอบบิล: 'Billing cycles',
  รอบ: 'Cycle',
  สถานะ: 'Status',
  ไม่มีรอบบิล: 'No billing cycles',
  กิจกรรมล่าสุด: 'Recent activity',
  ไม่มีกิจกรรม: 'No activity',

  // ── page.tsx wrappers (my-progress/tickets/abbyy-skills/admin/master/my-line-link) ──
  'มีแค่ role พนักงานเท่านั้นที่ดูหน้านี้ได้': 'Only the Employee role can view this page',
  การแจ้งปัญหา: 'Support',
  'ต้องเป็น admin เท่านั้นถึงจะเข้าหน้านี้ได้': 'Only admins can access this page',
  'ตั๋วที่พนักงานแจ้งเข้ามาผ่าน LINE': 'Tickets employees reported via LINE',
  'สารบัญ Skill ABBYY Vantage ที่เทรนไว้แล้ว — ตั้งชื่อให้จำง่ายแล้วนำ Skill ID ไปเลือกตอนแก้ไขสัญญา':
    'Directory of trained ABBYY Vantage skills — name them memorably, then pick the Skill ID when editing a contract',
  'ต้องเป็น admin หรือแผนกบัญชีเท่านั้นถึงจะเข้าหน้านี้ได้': 'Only admins or Accounting can access this page',
  บัญชีของฉัน: 'My Account',
  'มีแค่ role พนักงานเท่านั้นที่ผูกไลน์ได้': 'Only the Employee role can link LINE',
  'บัญชีนี้ยังไม่ได้ผูกกับพนักงานคนไหนเลย — ให้ admin ผูกให้ที่หน้าจัดการระบบก่อน':
    'This account isn’t linked to any employee yet — ask an admin to link it on the System Admin page first',
  'ผูกบัญชี LINE ส่วนตัวเพื่อรับแจ้งเตือนและแจ้งปัญหาผ่านแชท': 'Link your personal LINE account to receive notifications and report issues via chat',

  // ── dashboard งานที่ต้องทำ ──
  'Timesheet เข้ามาใหม่ รอเปิดตรวจ': 'New Timesheet — ready to open',
  'รอตรวจ Manday': 'Awaiting Manday check',
  'รออนุมัติวางบิล': 'Awaiting billing approval',
  // ── upload/UploadFileTab.tsx (โหมดพนักงาน: เลือกรอบบิล) ──
  'ส่งผ่านระบบ OBS': 'Submit via OBS',
  'ส่งผ่าน Email': 'Submit via email',
  'ให้ผู้ดูแลเป็นคนส่ง': 'Have an admin submit it',
  'อัปโหลดไฟล์ Timesheet ตรงนี้เลย': 'Upload the Timesheet file here',
  'ส่งไฟล์ทางอีเมลไปแล้ว ฝ่ายบัญชีจะกรอกเข้าระบบให้เมื่อได้รับ': 'You emailed the file — accounting will enter it once received',
  'ระบบจะแจ้งฝ่ายดูแลทางไลน์ให้ส่งและตรวจ Timesheet แทนคุณ': 'Admins will be notified on LINE to submit and check the Timesheet for you',
  'วิธีส่ง': 'Submission method',
  'แจ้งไว้แล้ว': 'already reported',
  'บันทึกการส่งผ่าน Email เรียบร้อย': 'Email submission recorded',
  'มอบหมายผู้ดูแลระบบเรียบร้อย': 'Admin assigned',
  'บันทึกเรียบร้อยแล้ว': 'Saved',
  'ฝ่ายบัญชีจะกรอกเข้าระบบเมื่อได้รับอีเมล': 'Accounting will enter it once the email arrives',
  'อีเมลปลายทาง': 'Destination email',
  'ระบบได้ส่งการแจ้งเตือนไปยังฝ่ายดูแล เพื่อดำเนินการส่งและตรวจ Timesheet แทนคุณเรียบร้อยแล้ว': 'Admins have been notified to submit and check the Timesheet for you',
  'ถ้าเชื่อมต่อ LINE ไว้ จะได้รับข้อความยืนยันทางไลน์ด้วย': 'If your LINE is connected, you will also get a confirmation there',
  'ส่งรอบอื่น': 'Submit another period',
  'ยืนยันว่าส่งผ่าน Email แล้ว': 'Confirm I submitted by email',
  'แจ้งให้ผู้ดูแลเป็นคนส่ง': 'Ask an admin to submit it',
  'เลือกรอบบิลที่จะส่งก่อน': 'Select the billing period first',
  'รอบบิลที่จะส่ง': 'Billing period to submit',
  'โหลดรอบบิลไม่สำเร็จ ลองรีเฟรชหน้านี้': 'Could not load billing periods — try refreshing',
  'ตอนนี้ไม่มีรอบบิลที่ต้องส่ง': 'No billing period to submit right now',
  '— เลือกรอบบิล —': '— Select billing period —',
  'ถูกตีกลับ ส่งใหม่': 'returned, resubmit',
  // ── my-progress/MyProgressClient.tsx ──
  เลขที่เอกสาร: 'Document no.',
  'ส่ง Timesheet': 'Timesheet submitted',
  'ส่ง Timesheet รอบ': 'submitted the Timesheet for',
  'พนักงานส่งเองผ่านระบบ OBS': 'Submitted by employee via OBS',
  'ระบบดึงจาก Gmail อัตโนมัติ': 'Auto-imported from Gmail',
  'พนักงานส่งเองทางอีเมล': 'Submitted by employee via email',
  'ผู้อื่นส่งแทนทางอีเมล': 'Submitted on their behalf via email',
  ยังไม่มีคนตรวจ: 'Not yet reviewed',
  อนุมัติวางบิล: 'Billing approved',
  'บัญชีนี้ยังไม่ได้ผูกกับพนักงานคนไหน — แจ้ง admin ให้ผูกบัญชีกับชื่อพนักงานก่อน':
    'This account isn’t linked to any employee — ask an admin to link it first',
  เชื่อมต่อไลน์แล้ว: 'LINE connected',
  เชื่อมต่อไลน์: 'Connect LINE',
  ยังไม่มีสัญญาที่ผูกกับตัวเอง: 'No contracts linked to you yet',
  // ปุ่ม/แถบสรุปของเลย์เอาต์ใหม่ — "ส่งไฟล์ Timesheet" เป็นคำสั่งบนปุ่ม จงใจใช้คนละคีย์กับ "ส่ง Timesheet"
  // ที่เป็นชื่อขั้นตอน (แปลอังกฤษคนละความหมาย: Submit… vs Timesheet submitted)
  'ส่งไฟล์ Timesheet': 'Submit timesheet',
  ส่งใหม่อีกครั้ง: 'Submit again',
  'ต้องส่ง Timesheet': 'Timesheets to submit:',
  กดปุ่มในแถวที่ไฮไลต์ไว้เพื่อส่งไฟล์: 'use the button on the highlighted row to send the file',
  ส่งครบทุกรอบที่ถึงกำหนดแล้ว: 'Every period that has come due has been submitted',
  ยังไม่ถึงกำหนดส่ง: 'Not due yet',
  ยังไม่ถึงรอบ: 'Not due',
  รอบที่ยังไม่ถึงกำหนด: 'Periods not due yet',
  ยังไม่มีรอบบิลในสัญญานี้: 'No billing periods in this contract yet',

  // ── tickets/TicketsClient.tsx ──
  บันทึกไม่สำเร็จ: 'Save failed',
  ทำเครื่องหมายตั๋ว: 'Marked ticket',
  ว่าแก้แล้ว: 'as resolved',
  ตั๋วแจ้งปัญหา: 'Support tickets',
  ค้างอยู่: 'Open',
  รายการ: 'items',
  เลขที่: 'No.',
  หมวด: 'Category',
  รายละเอียด: 'Description',
  แจ้งเมื่อ: 'Reported',
  แก้แล้ว: 'Resolved',
  รอดำเนินการ: 'Pending',
  'กำลังบันทึก…': 'Saving…',
  ทำเครื่องหมายว่าแก้แล้ว: 'Mark as resolved',
  ยังไม่มีการแจ้งปัญหา: 'No support tickets yet',
  แก้ครบทุกรายการแล้ว: 'All resolved',

  // ── abbyy-skills/AbbyySkillsClient.tsx ──
  'กรอกชื่อ Skill และ Skill ID ให้ครบก่อน': 'Enter both Skill name and Skill ID first',
  เพิ่มไม่สำเร็จ: 'Add failed',
  'เพิ่ม Skill': 'Added skill',
  'ลบ Skill นี้?': 'Delete this skill?',
  'ลบ Skill นี้': 'Delete this skill',
  'จะหายไปจากรายการให้เลือก — สัญญาที่เคยเลือก Skill นี้ไปแล้วยังใช้งานได้ปกติ ไม่กระทบ':
    'will be removed from the picklist — contracts that already selected this skill are unaffected',
  ลบ: 'Delete',
  ลบไม่สำเร็จ: 'Delete failed',
  'ลบ Skill แล้ว': 'Skill deleted',
  'สารบัญ Skill ABBYY': 'ABBYY skill directory',
  'ชื่อ Skill': 'Skill name',
  'กำลังเพิ่ม…': 'Adding…',
  'เพิ่ม Skill ใหม่': 'Add new skill',
  สร้างเมื่อ: 'Created',
  'ยังไม่มี Skill ในสารบัญ': 'No skills in the directory yet',
  กำหนดฟิลด์เองแล้ว: 'Custom field map',
  'การจับคู่ฟิลด์ (Field map)': 'Field map',
  'ชื่อฟิลด์จริงใน ABBYY Vantage ของ Skill นี้ — เว้นว่างช่องไหนไว้เพื่อใช้ค่าเริ่มต้น (Employee Name/Position/Month Year/New Table) รอบเดือนเลือกได้ระหว่าง "ฟิลด์รวม" หรือ "แยกเดือน+ปี" ถ้ากรอกฟิลด์รวมไว้ ระบบจะใช้ตัวนั้นก่อนเสมอ':
    'The actual field names trained in ABBYY Vantage for this skill — leave any blank to use the default (Employee Name/Position/Month Year/New Table). For the period, use either the combined field or the split month+year fields; if the combined field is filled in, it always takes priority.',
  'ชื่อพนักงาน (Employee Name)': 'Employee name (Employee Name)',
  'ตำแหน่ง (Position)': 'Position',
  'รอบเดือน — ฟิลด์รวม (Month Year)': 'Period — combined field (Month Year)',
  'รอบเดือน — เดือน (แยก)': 'Period — month (split)',
  'รอบเดือน — ปี (แยก)': 'Period — year (split)',
  'ตารางรายวัน (Table)': 'Daily table (Table)',
  'จำนวนวันทำงานรวม (ถ้ามี)': 'Total work days (if available)',
  'บันทึก field map แล้ว': 'Field map saved',
  ล้างกลับเป็นค่าเริ่มต้น: 'Reset to default',

  'Skill นี้ยังเก็บค่าด้วยรูปแบบเดิม': 'This skill still stores the old format',
  'ระบบยังอ่านค่าเดิมได้ตามปกติ แต่แก้ผ่านหน้านี้ยังไม่ได้จนกว่าฝั่ง API จะแปลงรูปให้ตอนอ่าน — ถ้าแก้ตอนนี้ค่าที่ตั้งไว้เดิมจะหายทั้งหมด':
    'It still reads correctly as-is, but cannot be edited here until the API converts the format on read — editing now would wipe every value already configured.',

  // ── upload/ManualEntryTab.tsx — วัน OT ──
  'วันที่ทำ OT': 'Overtime days',
  'เพิ่มวัน OT': 'Add an overtime day',
  ชั่วโมง: 'Hours',
  วันนี้ถูกกรอกเป็นวันลาไว้แล้ว: 'This date is already entered as a leave day',
  'ทำ OT วันไหนก็ได้ รวมเสาร์-อาทิตย์และวันหยุดนักขัตฤกษ์ คิดสูตรเดียวกันหมด':
    'Overtime can be on any day, including weekends and public holidays — the same formula applies to all of them.',

  // ── upload/UploadFileTab.tsx — เลือกตัวอ่านเฉพาะครั้งนี้ ──
  อ่านด้วย: 'Read with',
  'Skill ที่ใช้อ่าน': 'Skill to read with',
  'ตาม Skill ที่ผูกกับสัญญานี้': "Use this contract's Skill",
  'Clear Read อ่านช้ากว่า ABBYY มาก — ราว 3 นาทีต่อหนึ่งหน้า':
    'Clear Read is far slower than ABBYY — around 3 minutes per page.',

  // ── readers/ReadersClient.tsx ──
  'ตั้งค่า Skill ของ ABBYY และแม่แบบของ Clear Read — เลือกว่าจะอ่านไฟล์ด้วยตัวไหนทำที่หน้าอัปโหลด Timesheet ตอนอ่านแต่ละครั้ง':
    "Configure ABBYY's Skills and Clear Read's templates here. Choosing which one reads a file happens on the upload screen, per read.",
  พร้อมใช้งาน: 'Ready to use',
  'ตัวอ่าน Timesheet': 'Timesheet reader',
  ยังตั้งค่าไม่ครบ: 'Not fully configured',
  'Skill ของ ABBYY': 'ABBYY Skills',
  'จัดการ Skill': 'Manage Skills',
  การจับคู่ฟิลด์: 'Field mapping',
  ใช้ค่าเริ่มต้น: 'Using defaults',
  'แม่แบบของ Clear Read': 'Clear Read templates',

  // ── components/ClearReadFieldCatalog.tsx ──
  ระดับเอกสาร: 'Document level',
  'หนึ่งค่าต่อหนึ่งใบ Timesheet — หัวเอกสาร ช่องสรุป และลายเซ็น':
    'One value per Timesheet — header, summary boxes and signatures.',
  ตารางรายวัน: 'Daily table',
  'หนึ่งแถวต่อหนึ่งวันที่มีการลงเวลา — คนละระดับกับด้านบน แม้ชื่อฟิลด์จะคล้ายกัน':
    'One row per logged day — a different level from the group above, even where the field names look alike.',
  'ค้นหาชื่อช่อง หรือข้อความในคำอธิบาย': 'Search field names or description text',
  ค้นหาฟิลด์: 'Search fields',
  แม่แบบที่เปิดดู: 'Viewing template',
  ใช้ตัวนี้อ่านจริง: 'Read with this one',
  'กำลังเปลี่ยน…': 'Switching…',
  'เปลี่ยนแม่แบบที่ใช้อ่านได้เฉพาะ admin': 'Only an admin can change which template reads files',
  'เปลี่ยนแม่แบบที่ใช้อ่านจริง?': 'Change the template files are read with?',
  'แม่แบบนี้อ่าน Timesheet ไม่ได้ ยืนยันหรือไม่?': 'This template cannot read Timesheets — are you sure?',
  ไฟล์ที่อ่านหลังจากนี้จะใช้: 'Files read from now on will use',
  ใบที่อ่านไปแล้วไม่เปลี่ยนตาม: 'documents already read are unaffected',
  'แม่แบบนี้ไม่มีคอลัมน์รายวันเลย จะอ่านไม่ได้ทั้งวันลาและ OT และไม่มีข้อมูลพอจะตั้งบิล':
    'This template has no daily columns at all — no leave days, no overtime, and nothing to bill from.',
  เปลี่ยน: 'Change',
  เปลี่ยนแม่แบบไม่สำเร็จ: 'Could not change the template',
  ตอนนี้ระบบอ่านด้วยแม่แบบ: 'The system now reads with',
  มีตารางรายวัน: 'Has a daily table',
  'ไม่มีตารางรายวัน — ใช้กับ Timesheet ไม่ได้': 'No daily table — cannot be used for Timesheets',
  ตัวที่ระบบใช้อ่าน: 'the one the system reads with',
  แม่แบบนี้อ่านตารางรายวันไม่ได้: 'This template cannot read a daily table',
  'ไม่มีคอลัมน์รายวันเลย ถ้าเอามาอ่าน Timesheet จะไม่ได้วันลา ไม่ได้ OT และไม่มีข้อมูลพอจะตั้งบิล — เปิดดูฟิลด์ได้ตามปกติ แต่คนละงานกับ Timesheet':
    'It has no daily columns at all. Used on a Timesheet it would yield no leave days, no overtime, and nothing to bill from — you can still browse its fields, but it is built for a different job.',
  'กำลังเปิดดูเฉยๆ ยังไม่ได้เปลี่ยนแม่แบบที่ใช้อ่านจริง ระบบยังอ่านด้วย':
    'Viewing only — this has not changed which template actually reads files. The system still reads with',
  ขยายทั้งหมด: 'Expand all',
  ย่อทั้งหมด: 'Collapse all',
  ไม่พบฟิลด์ที่ตรงกับคำค้น: 'No field matches',
  ช่อง: 'fields',
  ช่องระดับเอกสาร: 'document fields',
  คอลัมน์รายวัน: 'daily columns',
  ดึงใหม่: 'Refresh',
  ค่าเริ่มต้น: 'Default',
  รหัสแม่แบบ: 'Template ID',
  โหลดรายการฟิลด์ไม่สำเร็จ: 'Could not load the field list',
  ลองอีกครั้ง: 'Try again',
  'ต่อกับ Clear Read ไม่ได้ตอนนี้': 'Cannot reach Clear Read right now',
  ไม่ทราบสาเหตุ: 'Reason unknown',
  เทียบกับสารบัญฟิลด์กลาง: 'Checked against the central field registry',
  'แม่แบบตรงตามสเปกครบทุกช่อง ไม่มีชื่อที่เลิกใช้ ไม่มีช่องที่ระบบอ่านไม่ได้':
    'The template matches the spec on every field — no retired names, and nothing the system cannot read.',
  ระบบอ่านค่าจากช่องเหล่านี้ไม่ได้: 'The system cannot read these fields',
  'ตั้งไว้ในแม่แบบแล้ว แต่ระบบไม่รู้จักชื่อนี้ ข้อมูลจึงไม่ไหลเข้ามา':
    'They exist in the template, but the system does not recognise the name, so the values never arrive.',
  'ชื่อที่ V4 เลิกใช้แล้ว': 'Names V4 has retired',
  'สเปกห้ามใช้ชื่อซ้ำข้ามระดับ จึงแยกเป็นชื่อใหม่แทน':
    'The spec forbids reusing one name across levels, so each level got its own name.',
  สเปกมีแต่แม่แบบยังไม่มี: 'In the spec but not in the template',
  'ไม่ใช่ข้อผิดพลาดเสมอไป — ถ้าฟอร์มบริษัทไม่มีช่องนี้จริงก็ไม่ต้องมี':
    'Not necessarily a problem — if the customer form genuinely has no such box, it does not need one.',
  ระบบอ่านไม่ได้: 'Unreadable',
  ชื่อที่เลิกใช้: 'Retired name',
  ใช้แทนด้วย: 'Use instead:',
  'ช่องนี้ไม่มีคำอธิบายในแม่แบบ — เครื่องอ่านจะเดาจากชื่อช่องอย่างเดียว':
    'This field has no description in the template — the reader has only the field name to go on.',

  // ── components/TimesheetFieldMapEditor.tsx ──
  จับคู่ชื่อฟิลด์กับเอกสารของบริษัท: "Match field names to the company's document",
  'กรอกว่าเอกสารของบริษัทรายนี้เรียกแต่ละฟิลด์ว่าอะไร — เว้นว่างไว้ถ้ายังไม่ตั้ง ระบบจะใช้ค่าเริ่มต้นของตัวอ่าน ส่วนช่องที่ติ๊กว่าไม่มี ระบบจะไม่เตือนว่าหาฟิลด์ไม่เจอ':
    "Enter what this customer's document calls each field. Leave blank to keep the reader's own default; tick \"not on this form\" and the system won't warn that the field is missing.",
  'ค้นหาฟิลด์ (ชื่อไทย ชื่อสเปก หรือตัวอย่าง)': 'Search fields (Thai label, spec name, or example)',
  ไม่พบฟิลด์ที่ค้นหา: 'No matching fields',
  ฟิลด์หัวเอกสาร: 'Document header fields',
  ช่องสรุปท้ายเอกสาร: 'Document summary box',
  'ไม่ได้อยู่ในแม่แบบที่บริษัทให้มา — เพิ่มเองสำหรับฟอร์มที่พิมพ์ยอดรวมไว้ท้ายเอกสาร อ่านจากช่องสรุปเท่านั้น ไม่นับจากตารางให้':
    'Not part of the template the customer supplied — added for forms that print totals in a summary box. Read from that box only; never counted from the daily rows.',
  ฟิลด์ในตารางรายวัน: 'Daily table columns',
  ชื่อตารางรายวัน: 'Daily table name',
  'ชื่อตาราง/line item ที่ตัวอ่านใช้เรียกตารางรายวัน': 'The table / line-item name the reader uses for the daily table',
  ไม่มีในฟอร์ม: 'Not on form',
  'แยกเดือน/ปีสองช่อง': 'Split month/year',
  'ตั้งไว้ทั้งช่องรวมและช่องแยก — ระบบอ่านช่องรวมก่อน ถ้าเอกสารฉบับไหนไม่มีช่องรวมหรืออ่านค่าไม่ได้ จะใช้ช่องแยกที่เก็บไว้':
    'Both a combined field and a split pair are set — the reader tries the combined one first, and falls back to the stored split pair',
  'แทน — เก็บไว้ทั้งคู่ได้ ไม่ใช่ค่าที่ต้องลบทิ้ง':
    'for any document where the combined field is missing or unreadable. Keeping both is correct — this is not leftover config to delete.',
  ช่องเดือน: 'Month box',
  ช่องปี: 'Year box',
  ระบุว่าไม่มี: 'marked absent',
  ตัวอย่าง: 'e.g.',

  // ── admin/AdminTabs.tsx ──
  ภาพรวม: 'Overview',
  ผู้รับแจ้งเตือน: 'Notification recipients',
  โดเมนอีเมล: 'Email domains',

  // ── master/MasterDataClient.tsx ──
  'พนักงาน & ชื่อพ้อง': 'Employees & aliases',
  'บริษัท & สัญญา': 'Companies & contracts',
  วันหยุด: 'Holidays',
  'ฐานข้อมูลที่ทั้ง 3 ขั้นใช้ร่วมกัน — จับคู่ชื่อ · หาเรทค่าบริการ · นับวันทำงานของเดือน':
    'Shared master data across all 3 steps — name matching · rate lookup · workday counting',

  // ── my-line-link/MyLineLinkClient.tsx ──
  ขอรหัสไม่สำเร็จ: 'Failed to request code',
  'เลิกเชื่อมต่อไลน์?\n\nจะไม่ได้รับแจ้งเตือนสถานะ Timesheet ผ่านไลน์ส่วนตัวอีก — เชื่อมต่อใหม่ได้ทุกเมื่อ':
    'Unlink LINE?\n\nYou will no longer receive timesheet status notifications via your personal LINE — you can reconnect anytime',
  เลิกเชื่อมต่อไม่สำเร็จ: 'Unlink failed',
  สถานะการเชื่อมต่อ: 'Connection status',
  'กำลังเลิกเชื่อมต่อ…': 'Unlinking…',
  เลิกเชื่อมต่อ: 'Unlink',
  ยังไม่ได้เชื่อมต่อ: 'Not connected',
  'กำลังออกรหัส…': 'Requesting code…',
  'เพิ่มเพื่อนไลน์ของบริษัทก่อน แล้วพิมพ์รหัสนี้ส่งไปในแชท (หมดอายุใน 10 นาที)':
    'Add the company’s LINE account as a friend first, then send this code in chat (expires in 10 minutes)',

  // ── notifications/NotificationsClient.tsx ──
  เมื่อสักครู่: 'just now',
  นาทีที่แล้ว: 'minutes ago',
  ชั่วโมงที่แล้ว: 'hours ago',
  เมื่อวาน: 'yesterday',
  วันที่แล้ว: 'days ago',
  แจ้งเตือน: 'Notifications',
  ยังไม่ได้อ่าน: 'Unread:',
  เรื่อง: 'items',
  อ่านครบแล้ว: 'All read',
  อ่านแล้วทั้งหมด: 'Mark all read',
  ยังไม่มีเหตุการณ์ในระบบ: 'No events yet',
  โดย: 'by',
  ผิดพลาด: 'Error',
  สำเร็จ: 'Success',

  // ── invoices/page.tsx ──
  เอกสาร: 'Documents',
  'เอกสารที่ระบบสร้างเข้า FlowAccount': 'Documents the system created in FlowAccount',
  'เลขที่สัญญา/PO': 'Contract no. / PO',
  วันที่วางบิล: 'Billed on',
  ยอดรับชำระ: 'Amount received',
  ยังไม่มีใบแจ้งหนี้: 'No invoices yet',

  // ── billing/page.tsx ──
  'ขั้นตอน 3 · วางบิล & ร่างอีเมล': 'Step 3 · Billing & Email',
  'กำลังโหลด…': 'Loading…',
  'ดูสถานะแต่ละรอบบิล เปิดพรีวิวใบแจ้งหนี้และร่างอีเมลก่อนอนุมัติ': 'View each billing cycle’s status, preview invoices and draft emails before approving',
  คงเหลือ: 'Remaining',
  เปิดดู: 'Open',

  // ── billing/[contractId]/[period]/page.tsx ──
  อนุมัติไม่สำเร็จ: 'Approval failed',
  'ให้ AI เรียบเรียงอีเมลไม่สำเร็จ': 'AI failed to draft the email',
  กลับ: 'Back',
  'กำลังสร้างเอกสาร…': 'Creating document…',
  'อนุมัติและสร้างร่างใน FlowAccount': 'Approve and create a draft in FlowAccount',
  สร้างเอกสารสำเร็จ: 'Document created successfully',
  ดูเอกสาร: 'View document',
  ติดปัญหา: 'Blocked',
  รายการวางบิล: 'Billing line items',
  'พนักงาน / รายการ': 'Employee / item',
  จำนวน: 'Quantity',
  ราคาต่อหน่วย: 'Unit price',
  ส่วนลด: 'Discount',
  ยอดรวม: 'Amount',
  รวมเป็นเงิน: 'Subtotal',
  หักส่วนลด: 'Less discount',
  รวมหลังหักส่วนลด: 'Total after discount',
  ภาษีมูลค่าเพิ่ม: 'VAT',
  รวมทั้งสิ้น: 'Grand total',
  'หักภาษี ณ ที่จ่าย': 'Less withholding tax',
  ร่างอีเมลวางบิล: 'Billing email draft',
  'เรียบเรียงด้วย AI': 'Drafted by AI',
  'แบบ template — ยังไม่ได้ให้ AI เรียบเรียง': 'Template only — not yet drafted by AI',
  'กำลังเรียบเรียง…': 'Drafting…',
  'ให้ AI เรียบเรียง': 'Draft with AI',
  ถึง: 'To',
  สำเนา: 'Cc',
  หัวข้อ: 'Subject',
  ข้อสังเกตก่อนกดส่ง: 'Things to check before sending',
  ยังไม่มีรายการที่วางบิลได้ในรอบนี้: 'Nothing billable in this cycle yet',
  พนักงานในสัญญา: 'Employees in the contract',
  รอวางบิล: 'Awaiting billing',
  รายการในรอบบิล: 'Line items this cycle',
  'ดู Timesheet': 'View timesheet',
  คัดลอกร่าง: 'Copy draft',
  คัดลอกร่างอีเมลแล้ว: 'Email draft copied',
  คัดลอกไม่สำเร็จ: 'Copy failed',
  ข้อสังเกตจากระบบ: 'System notes',
  ใบแจ้งหนี้ที่จะสร้าง: 'Invoice to be created',
  สร้างแล้ว: 'Created',
  เปิดดูเอกสาร: 'Open document',
  'เลขเอกสารจะได้จาก FlowAccount': 'Document number will come from FlowAccount',
  สร้างร่างแล้ว: 'Draft created',
  ร่าง: 'Draft',
  เลขประจำตัวผู้เสียภาษี: 'Tax ID',
  ครบ: 'Due',
  จำนวนเงิน: 'Amount',
  หมายเหตุ: 'Note',
  'ภาษีหัก ณ ที่จ่ายคิดจากยอดหลังหักส่วนลดก่อน VAT': 'Withholding tax is calculated from the amount after discount, before VAT',
  'ตามที่ใบแจ้งหนี้ตัวอย่างทำ ไม่ใช่คิดจากยอดรวมทั้งสิ้น': '— as the sample invoice does, not from the grand total',
  'สร้างร่างใน FlowAccount แล้ว': 'Draft created in FlowAccount',
  ยังอนุมัติไม่ได้: 'Not yet approvable',
  ข้อ: 'issue(s)',
  รายการคำนวณ: 'Calculation',

  // ── submissions/SubmissionsClient.tsx ──
  บันทึกการส่ง: 'Submission log',
  'ติดตามและบันทึกสถานะการส่ง Timesheet ตามรอบบิล': 'Track and record Timesheet submission status by billing period',
  หน้านี้แสดงเฉพาะรายการส่งของคุณเอง: 'This page shows only your own submissions',
  รายการส่ง: 'Submissions',
  ยังไม่ส่ง: 'Not sent',
  ส่งแล้ว: 'Sent',
  มีปัญหา: 'Has a problem',
  ยังไม่ได้ต่อข้อมูลจริง: 'Not connected to live data yet',
  'ฝั่งระบบหลังบ้านกำลังทำส่วนเก็บและดึงบันทึกการส่งอยู่ เมื่อเสร็จแล้วตารางนี้จะขึ้นรายการของทุกคนในรอบ รวมคนที่ยังไม่ส่งด้วย':
    'The backend work to record and serve submissions is in progress. Once it lands, this table will list everyone in the period — including the people who have not sent anything yet.',
  'ต้องเป็น admin แผนกบัญชี หรือพนักงานเท่านั้นถึงจะเข้าหน้านี้ได้':
    'Only an admin, accounting, or an employee can open this page',
  ทุกสถานะ: 'All statuses',
  ทุกช่องทาง: 'All methods',
  ลำดับ: 'No.',
  สถานะการส่ง: 'Submission status',
  ช่องทางการส่ง: 'Method',
  'วันที่/เวลาที่ส่ง': 'Sent at',
  สถานะการตรวจสอบ: 'Review status',
  ผู้ดำเนินการ: 'Handled by',
  ขอเลื่อน: 'Deferred',
  'ยังไม่ผูก LINE OA': 'LINE OA not linked',
  พนักงานอาจไม่เห็นข้อความตอบกลับ: 'The employee may not have seen the reply',
  'รายการยังไม่ทราบสถานะจริง เพราะพนักงานยังไม่ได้ผูกบัญชี LINE — ไม่ใช่ยืนยันแล้วว่าไม่ส่ง':
    'items have unknown status because the employee has not linked LINE yet — this is not a confirmed non-submission',
  ทุกรอบที่ครบกำหนดส่ง: 'Every period that has come due',

  // ── manday/page.tsx ──
  กำลังดูข้ามทุกบริษัท: 'Viewing across all companies',
  กำลังดูเฉพาะ: 'Viewing only',
  บริษัทที่กำลังดำเนินการอยู่: 'the company currently being worked on',
  ต้องตรวจ: 'Needs review',
  ยืนยันแล้ว: 'Verified',
  ยืนยันไม่สำเร็จ: 'Verify failed',
  ตีกลับไม่สำเร็จ: 'Reject failed',
  'ขั้นตอน 2 · ตรวจ Manday': 'Step 2 · Review Manday',
  'ตรวจผลคำนวณ Manday แล้วยืนยันหรือตีกลับให้แก้ไข': 'Review the Manday calculation, then verify or reject for correction',
  ไม่มีรายการในหมวดนี้: 'No items in this category',
  ไม่ทราบชื่อ: 'Unknown name',
  ลา: 'Leave',
  รับเมื่อ: 'Received',
  เรทค่าบริการต่อเดือน: 'Monthly rate',
  วันทำงานที่วางบิลได้: 'Billable workdays',
  'ตาม Timesheet': 'Per timesheet:',
  วัน: 'days',
  ส่วนลดวันลา: 'Leave-day discount',
  ยอดที่วางบิลได้: 'Billable amount',
  ยืนยันตีกลับ: 'Confirm rejection',
  ยกเลิก: 'Cancel',
  เปิดตรวจ: 'Open for review',

  // ── upload/page.tsx ──
  อัปโหลดไฟล์: 'Upload file',
  'ดึงจาก Gmail': 'Fetch from Gmail',
  กรอกเอง: 'Manual entry',
  ประวัติ: 'History',
  'ขั้นตอน 1 · อัปโหลด Timesheet': 'Step 1 · Upload Timesheet',
  'อ่านไฟล์ด้วย ABBYY OCR, ดึงจาก Gmail หรือกรอกเองแล้วบันทึกเข้าระบบ': 'Read files with ABBYY OCR, fetch from Gmail, or enter manually, then save to the system',

  // ── upload/UploadFileTab.tsx ──
  เลือกไฟล์ก่อน: 'Choose a file first',
  อ่านไฟล์ไม่สำเร็จ: 'Failed to read the file',
  'เลือกไฟล์ Timesheet': 'Choose a timesheet file',
  'PDF ที่บริษัทอนุมัติแล้ว': 'Company-approved PDF',
  'ลากไฟล์มาวาง หรือกดเพื่อเลือกไฟล์': 'Drag a file here, or click to choose one',
  'กำลังอ่านไฟล์…': 'Reading file…',
  อ่านไฟล์นี้: 'Read this file',

  // ── upload/ReadingCard.tsx ──
  ระบบกำลังอ่านเมลและไฟล์แนบ: 'The system is reading the email and attachment',
  ระบบกำลังอ่านไฟล์: 'The system is reading the file',
  'ไฟล์ Timesheet': 'Timesheet file',
  'อ่านทีละหน้าแล้วรวมผล — เอกสารทั่วไปราว': 'Reading page by page and combining the results — typically around',
  วินาทีต่อหน้า: 'seconds per page.',
  'ไฟล์ที่รวม Timesheet หลายคนจะใช้เวลาหลายนาที ปล่อยหน้านี้ไว้ได้เลย': 'A file combining multiple people’s timesheets will take several minutes — feel free to leave this page open.',

  // ── upload/GmailTab.tsx ──
  'เชื่อมต่อ Gmail ไม่สำเร็จ': 'Failed to connect to Gmail',
  'เชื่อมต่อไม่สำเร็จ — ลองใหม่อีกครั้ง': 'Connection failed — please try again',
  ตรวจสอบก่อนบันทึก: 'Review before saving',
  'อีเมลแจ้งอนุมัติ Timesheet': 'Timesheet approval emails',
  กล่องของ: 'Inbox for',
  'ยังไม่ได้ตั้งโดเมนอีเมลของบริษัทนี้ไว้ — แสดงทุกฉบับที่ค้นเจอ ไม่กรองตามบริษัท':
    'This company’s email domain isn’t set yet — showing every message found, unfiltered by company',
  ซ่อน: 'Hide',
  'กำลังอ่าน…': 'Reading…',
  อ่านข้อมูล: 'Read',
  ไม่มีอีเมลที่ต้องอ่าน: 'No emails to read',
  ดูอีเมลที่เคยซ่อน: 'View hidden emails',
  เลิกซ่อน: 'Unhide',
  ยังไม่เคยซ่อนอีเมลใด: 'No emails have been hidden yet',
  กรองเฉพาะอีเมลของบริษัท: 'Filtering to emails from',
  แสดงทุกโดเมน: 'Show all domains',
  'กำลังแสดงทุกโดเมน ไม่กรองตามโดเมนที่เลือกอยู่': 'Showing all domains — not filtered to the selected one',
  กรองเฉพาะโดเมนนี้: 'Filter to this domain',
  เคยอ่านแล้ว: 'Already read',
  อ่านแล้ว: 'Read',
  พรีวิวไฟล์นี้ยังไม่พร้อมใช้งาน: 'Preview for this file isn’t available yet',

  // ── upload/ManualEntryTab.tsx ──
  ลาป่วย: 'Sick leave',
  ลากิจ: 'Personal leave',
  ลาพักร้อน: 'Vacation leave',
  อื่นๆ: 'Other',
  'กรอก Timesheet ด้วยมือ': 'Manual timesheet entry',
  ตารางรายวันคำนวณจากปฏิทินอัตโนมัติ: 'Daily table calculated automatically from the calendar',
  ชื่อพนักงานตามใบ: 'Employee name (as on the form)',
  ตำแหน่งตามใบ: 'Position (as on the form)',
  'รอบเดือน (YYYY-MM)': 'Period (YYYY-MM)',
  ผู้อนุมัติฝั่งบริษัท: 'Approver (company side)',
  'วันที่อนุมัติ (YYYY-MM-DD)': 'Approval date (YYYY-MM-DD)',
  ช่องทางที่ได้รับมา: 'How it was received',
  บริษัทส่งอีเมลมาเอง: 'Company sent the email directly',
  พนักงานส่งอีเมลแทน: 'Employee sent it on the client’s behalf',
  วันที่ลา: 'Leave dates',
  เพิ่มวันลา: 'Add leave day',
  บันทึกเข้าระบบ: 'Save to system',
  บันทึกสำเร็จ: 'Saved successfully',
  ยอด: 'Amount',

  // ── upload/HistoryTab.tsx ──
  'ประวัติ AI อ่านไฟล์': 'AI file-reading history',
  ที่มา: 'Source',
  ลาไม่รับค่าจ้าง: 'Unpaid leave',
  คลิกเพื่อดูรายละเอียดที่ระบบอ่านได้: 'Click to see what the system read from this file',
  โหลดรายละเอียดไม่สำเร็จ: 'Failed to load details',
  ไม่มีผลการอ่านเก็บไว้สำหรับรายการนี้: 'No read result stored for this record',
  ไม่มีวันลาที่อ่านได้ในรอบนี้: 'No leave days read for this cycle',
  ทิ้งไม่สำเร็จ: 'Failed to discard',
  รอบเดือน: 'Period',
  วันลา: 'Leave days',
  'วัน OT': 'Overtime days',
  ตำแหน่งที่อ่านได้: 'Position read',
  ติดปัญหาตอนอ่าน: 'Problems while reading',
  สิ่งที่ระบบเตือนไว้: 'What the system flagged',
  'วัน OT ที่อ่านได้': 'Overtime days read',
  'ไม่มี OT ที่อ่านได้ในรอบนี้': 'No overtime read for this cycle',
  ตารางรายวันที่อ่านได้: 'Daily table read',
  เครื่องอ่านไม่ได้ส่งตารางรายวันมาสำหรับใบนี้: 'The reader returned no daily table for this document',
  'ชม.': 'hrs',
  เข้า: 'In',
  ออก: 'Out',
  รวม: 'Total',
  ประเภทลา: 'Leave type',

  // ── upload/ReviewCard.tsx ──
  จับคู่: 'Matched',
  จับคู่พนักงานไม่ได้: 'Could not match an employee',
  ชื่อพนักงาน: 'Employee name',
  วันทำงาน: 'Workdays',
  'วันลา (นับอัตโนมัติ)': 'Leave days (auto)',
  'วันลา — แก้ไขได้ก่อนยืนยัน (เทียบกับ HRDD ด้านล่างเพื่อตรวจสอบ)': 'Leave days — editable before confirming (compare with HRDD below to verify)',
  วันลาที่อ่านได้: 'Leave days read from the file',
  'แก้ไขได้ก่อนยืนยัน — เทียบกับ HRDD ด้านล่างเพื่อตรวจสอบ': 'Editable before confirming — compare with HRDD below to verify',
  ไม่มีวันลา: 'No leave days',
  'ติดปัญหา (ตอนอ่านไฟล์)': 'Blocked (while reading the file)',
  'แก้ไขช่องด้านบนแล้วลองกด "ยืนยัน" ได้เลย — ระบบตรวจซ้ำจากค่าที่แก้แล้วอีกครั้งตอนบันทึกจริง':
    'Fix the fields above and try "Confirm" again — the system re-validates the corrected values when actually saving',
  ทิ้งผลนี้: 'Discard this result',
  ยืนยันและบันทึกเข้าระบบ: 'Confirm and save to system',
  โมเดล: 'Model',
  อ่านเมื่อ: 'Read at',
  ทิ้ง: 'Discard',
  ยังไม่มีประวัติ: 'No history yet',
  'จับคู่ชื่อพนักงานกับคนในระบบก่อน ถึงจะเลือกประเภทหัก ณ ที่จ่ายได้': 'Match the employee name to someone in the system first to choose a withholding tax type',
  ค่าบริการขนส่งสินค้า: 'Freight services',
  ค่าโฆษณา: 'Advertising',
  'ค่าจ้างทำของ / ค่าบริการ': 'Contract work / services',
  ค่าเช่าทรัพย์สิน: 'Property rental',
  'อัตราหัก ณ ที่จ่าย': 'Withholding tax rate',
  'ค่าบริการรายเดือน': 'Monthly service fee',
  'หักวันลา': 'Leave deduction',
  'ยอดรวมก่อนภาษี (Subtotal)': 'Subtotal',
  'คำนวณยอดไม่สำเร็จ — ตรวจรอบบิลและวันลาอีกครั้ง': 'Could not calculate — check the period and leave days',
  'กำลังคำนวณยอด…': 'Calculating…',

  // ── upload/HrddCompare.tsx ──
  ตรงกัน: 'Matches',
  ประเภทไม่ตรง: 'Type mismatch',
  'ไม่พบใน Timesheet': 'Not found in timesheet',
  'ไม่พบใน HRDD': 'Not found in HRDD',
  'Timesheet ระบุ': 'Timesheet says',
  'แต่ HRDD บันทึกเป็น': 'but HRDD recorded',
  ควรยืนยันประเภทวันลาที่ถูกต้องกับพนักงานก่อนวางบิล: 'Confirm the correct leave type with the employee before billing',
  'พบวันลาที่อนุมัติแล้วใน HRDD แต่ไม่ถูกระบุในตาราง Timesheet — จำนวนวันทำงานที่คำนวณได้อาจไม่ถูกต้อง':
    'An approved leave day was found in HRDD but not listed in the timesheet table — the calculated workday count may be incorrect',
  'พนักงานระบุว่าลาในตาราง Timesheet แต่ไม่พบการอนุมัติใน HRDD — อาจยังไม่ได้ยื่นคำขอลาในระบบเช็คชื่อ':
    'The employee marked leave in the timesheet table but no approval was found in HRDD — the leave request may not have been filed in the attendance system yet',
  ตรวจสอบไม่สำเร็จ: 'Check failed',
  เชื่อมต่อไม่สำเร็จ: 'Connection failed',
  'ใช้ตาม HRDD': 'Use HRDD',
  'ใช้ตาม Timesheet': 'Use timesheet',
  ระบุเอง: 'Specify manually',
  'จับคู่ชื่อพนักงานกับคนในระบบก่อน (ด้านบน) ถึงจะเทียบกับ HRDD ได้': 'Match the employee name to someone in the system first (above) to compare with HRDD',
  'รอบเดือนยังไม่ถูกต้อง แก้ "รอบเดือน" ด้านบนก่อน': 'The period is invalid — fix "Period" above first',
  'เทียบกับ HRDD (ระบบเช็คชื่อบริษัทหลัก)': 'Compare with HRDD (the parent company’s attendance system)',
  'กำลังตรวจสอบ…': 'Checking…',
  'รีเฟรชจาก HRDD': 'Refresh from HRDD',
  'กำลังตรวจสอบวันลากับ HRDD…': 'Checking leave days against HRDD…',
  ซิงค์ล่าสุด: 'Last synced',
  ลองใหม่: 'Try again',
  'ไม่มีวันลาให้เทียบในรอบนี้ (ไม่มีทั้งฝั่ง Timesheet และ HRDD)': 'No leave days to compare this cycle (none on either the timesheet or HRDD side)',
  พบความไม่ตรงกัน: 'Found',
  'รายการ — กรุณาตรวจสอบก่อนวางบิล': 'mismatch(es) — please review before billing',
  ข้อมูลวันลาตรงกันทั้งหมด: 'All leave data matches',
  วันที่: 'Date',
  ไม่มีข้อมูล: 'No data',
  แก้ไขแล้ว: 'Edited',
  แก้ไข: 'Edit',
  แนะนำ: 'Recommended',
  'เหตุผล / หมายเหตุ': 'Reason / note',
  จำเป็น: 'required',
  บันทึกการแก้ไข: 'Save changes',

  // ── manday/[id]/page.tsx ──
  กลับไปกล่องงาน: 'Back to the work queue',
  'กำลังคำนวณ…': 'Calculating…',
  คำนวณใหม่: 'Recalculate',
  'อัปโหลด · ระบบอ่านไฟล์': 'Upload · system reads the file',
  'ตรวจ Manday · คนยืนยัน': 'Review Manday · human verifies',
  'วางบิล FlowAccount': 'Bill in FlowAccount',
  ร่างอีเมลถึงบริษัท: 'Draft email to company',
  สรุปรายการที่จะวางบิล: 'Summary of what will be billed',
  เรทค่าบริการต่อเดือนตามใบว่าจ้าง: 'Monthly rate per the PO',
  วันทำงานของเดือน: 'Workdays this month',
  'หักเสาร์–อาทิตย์ และวันหยุดแล้ว': 'Weekends and holidays already excluded',
  'ทำงานจริงตาม Timesheet': 'Actual days worked per timesheet',
  อัตราต่อวัน: 'Daily rate',
  'ค่าล่วงเวลา (OT)': 'Overtime (OT)',
  ยอดของรายการนี้: 'Amount for this item',
  ข้อมูลอ้างอิง: 'Reference info',
  เลขผู้เสียภาษี: 'Tax ID',
  เครดิต: 'Credit terms',
  ตัวหารอัตราต่อวัน: 'Daily-rate divisor',
  คงที่: 'Fixed',
  วันทำงานจริงของเดือน: 'Actual workdays in the month',
  ผู้ประสานงาน: 'Coordinator',
  ประวัติการดำเนินการ: 'Action history',
  'บริษัทอนุมัติ Timesheet': 'Company approved the timesheet',
  ที่มาของข้อมูล: 'Data source',
  ไฟล์ที่อัปโหลด: 'Uploaded file',
  อ้างอิงอีเมล: 'Email reference',
  ไม่ได้ระบุ: 'Not specified',
  ชื่อที่เขียนในไฟล์: 'Name as written in the file',
  ตำแหน่งที่เขียนในไฟล์: 'Position as written in the file',
  เปิดดูไฟล์ต้นฉบับ: 'Open the source file',
  ดาวน์โหลดไฟล์ต้นฉบับ: 'Download the source file',
  ไม่มีไฟล์ต้นฉบับเก็บไว้: 'No source file on file',
  'ป้อนข้อมูลด้วยมือ — ไม่มีไฟล์ต้นฉบับ': 'Entered manually — no source file',
  วันในสัปดาห์: 'Day of week',
  'เวลาเข้า–ออก': 'Time in–out',
  'เวลา OT': 'OT time',
  ประเภท: 'Type',
  รายละเอียดงาน: 'Job description',
  'ชม.ปกติ': 'Normal hrs',
  'ชม. OT': 'OT hrs',
  'รวม/วัน': 'Total/day',
  รวมทั้งเดือน: 'Monthly total',
  'ตรวจจับอัตโนมัติจาก Timesheet — ตรวจสอบชั่วโมงกับ PDF ต้นฉบับก่อนยืนยัน':
    'Auto-detected from the timesheet — verify the hours against the source PDF before confirming',
  'ชั่วโมง OT': 'OT hours',
  'ค่าจ้างวันนั้น (รวม OT)': 'That day’s pay (incl. OT)',
  'ค่า OT เพิ่ม': 'Extra OT pay',
  'รวมค่า OT ทั้งหมด': 'Total OT pay',
  // ── manday/[id] ประวัติการดำเนินการ ──
  วางบิล: 'Billing',
  'รับ Timesheet เข้าระบบ': 'Timesheet received',
  ส่งโดย: 'Sent by',
  ไฟล์: 'File',
  ระบบอ่านไฟล์อัตโนมัติ: 'Automatic file reader',
  ระบบอัตโนมัติ: 'System',
  'ผ่าน LINE': 'Via LINE',
  'อ่านไฟล์ Timesheet': 'Timesheet file read',
  'อ่านข้อมูลจากไฟล์ Timesheet': 'Data extracted from Timesheet file',
  อ่านอีเมลอนุมัติจากบริษัท: 'Company approval email read',
  'รับ Timesheet ฉบับแก้ไข (เขียนทับของเดิม)': 'Revised Timesheet received (replaced the previous one)',
  'คำนวณ Manday': 'Manday calculated',
  'แจ้งทาง LINE ให้ตรวจ Manday': 'LINE notice sent to check Manday',
  'แจ้งทาง LINE ให้ตรวจ Manday ไม่สำเร็จ': 'Failed to send LINE notice to check Manday',
  'แจ้งทาง LINE ว่าตรวจไม่ผ่าน': 'LINE notice sent: check failed',
  'แจ้งทาง LINE ว่าตรวจไม่ผ่าน — ส่งไม่สำเร็จ': 'Failed to send LINE notice: check failed',
  'ยืนยันผลตรวจ Manday แล้ว': 'Manday check confirmed',
  'ส่งขออนุมัติวางบิลทาง LINE': 'Billing approval requested via LINE',
  'ส่งขออนุมัติวางบิลทาง LINE ไม่สำเร็จ': 'Failed to request billing approval via LINE',
  'อนุมัติวางบิลทาง LINE': 'Billing approved via LINE',
  'ไม่อนุมัติวางบิล (LINE)': 'Billing rejected (LINE)',
  'มีคนกดอนุมัติทาง LINE แต่ไม่มีสิทธิ์': 'Someone without permission tried to approve via LINE',
  'สร้างใบแจ้งหนี้ใน FlowAccount': 'Invoice created in FlowAccount',
  'สร้างใบแจ้งหนี้ใน FlowAccount ไม่สำเร็จ': 'Failed to create invoice in FlowAccount',
  'ดึงลิงก์ใบแจ้งหนี้จาก FlowAccount ไม่สำเร็จ': 'Failed to get invoice link from FlowAccount',
  'ดึงไฟล์ใบแจ้งหนี้จาก FlowAccount ไม่สำเร็จ': 'Failed to get invoice file from FlowAccount',
  ระบบร่างอีเมลวางบิล: 'Billing email drafted',
  'สร้างร่างอีเมลวางบิลใน Gmail': 'Billing email draft created in Gmail',
  ส่งอีเมลวางบิลแล้ว: 'Billing email sent',
  ตรวจสถานะการส่งอีเมลวางบิลไม่สำเร็จ: 'Failed to check billing email status',
  ลบใบแจ้งหนี้: 'Invoice deleted',
  ปฏิทิน: 'Calendar',
  หมายเหตุที่จะขึ้นบนใบแจ้งหนี้: 'Notes that will appear on the invoice',
  'ไม่มีวันลา จึงไม่มีหมายเหตุ': 'No leave days, so no notes',
  สรุปประจำเดือน: 'Monthly summary',
  'ทำงาน (วัน)': 'Worked (days)',
  'ลาป่วย (วัน)': 'Sick leave (days)',
  'ลากิจ (วัน)': 'Personal leave (days)',
  'ลาพักร้อน (วัน)': 'Vacation leave (days)',
  'เสาร์–อาทิตย์ (วัน)': 'Weekend (days)',
  'วันหยุด (วัน)': 'Holiday (days)',
  รายละเอียดวันที่เลือก: 'Selected day details',
  ยังยืนยันไม่ได้: 'Cannot confirm yet',
  ยอดเปลี่ยนหลังยืนยันไปแล้ว: 'Amount changed after confirming',
  อ่านตัวเลขชุดใหม่แล้วยืนยันอีกครั้ง: 'Re-read the new figures and confirm again',
  'ตีกลับให้แก้ Timesheet': 'Reject for timesheet correction',
  'ไปขั้น 3 วางบิล': 'Go to step 3: Billing',
  ยืนยันว่าตรวจแล้ว: 'Confirm reviewed',
  ยังไม่ได้คำนวณ: 'Not yet calculated',
  'คำนวณใหม่ไม่สำเร็จ — ระบบยังไม่เปิดเส้นทางนี้ให้ใช้งาน':
    'Recalculation failed — this endpoint is not available yet',
  'ลบชื่อพ้องเดิมไม่สำเร็จ — ตอนนี้มีทั้งของเดิมและของใหม่':
    'Could not delete the old alias — both the old and new one now exist:',
  ทำงาน: 'Work',
  'เสาร์–อาทิตย์ไม่มีป้าย': 'Weekends carry no label',
  คลิกวันที่ในปฏิทินเพื่อดูรายละเอียดวันนั้น: 'Click a date on the calendar to see that day’s details',
  เข้างาน: 'Time in',
  ออกงาน: 'Time out',
  อา: 'Su',
  จ: 'Mo',
  อ: 'Tu',
  พ: 'We',
  พฤ: 'Th',
  ศ: 'Fr',
  ส: 'Sa',

  // ── admin/OverviewTab.tsx ──
  การเชื่อมต่อ: 'Connections',
  'FlowAccount (ใช้จริงตอนกดอนุมัติ)': 'FlowAccount (actually used on approval)',
  'ไม่ตรงกับค่าใน .env ด้านบน — ค่านี้ในฐานข้อมูลเป็นตัวที่ใช้จริง': 'Differs from the .env value above — this database value is the one actually used',
  ตั้งค่าแล้ว: 'Configured',
  ยังไม่ตั้ง: 'Not set',
  ชนิดเอกสาร: 'Document type',
  เชื่อมต่อแล้ว: 'Connected',
  ยังไม่เชื่อม: 'Not connected',
  ราย: 'people',
  'ลิงก์ในข้อความ LINE': 'Link in LINE messages',
  ข้อความแจ้งเตือนจะไม่มีปุ่มกดเข้าระบบ: 'Notification messages will have no button to open the app',
  ระบบในเครื่อง: 'Local system',
  'โมเดล (ข้อความ)': 'Model (text)',
  'โมเดล (อ่านไฟล์)': 'Model (file reading)',
  เงื่อนไขวางบิล: 'Billing rules',
  วันที่ลงเอกสาร: 'Document date',
  ของเดือนถัดไป: 'of the following month',
  ต้องได้ครบทุกคน: 'Requires everyone',
  ใช่: 'Yes',
  ไม่: 'No',
  ต้องมีคนกดยืนยัน: 'Requires human confirmation',
  'ไม่ (โหมด auto)': 'No (auto mode)',
  'ใช่ (โหมด manual)': 'Yes (manual mode)',
  ส่งอีเมลอัตโนมัติ: 'Auto-send email',
  สร้างร่างเท่านั้น: 'Draft only',
  ไฟล์แนบในร่างอีเมล: 'Draft email attachments',
  'ใบวางบิล + Timesheet ทุกคนในรอบ': 'Invoice + everyone’s timesheet for the cycle',
  'ใบวางบิลดึงจาก FlowAccount มาเก็บให้เองตอนกดอนุมัติ': 'The invoice is automatically fetched from FlowAccount and stored on approval',
  ปิดรอบเมื่อส่งเมล: 'Close cycle on email send',
  อัตโนมัติ: 'Automatic',

  // ── admin/AuditLogTab.tsx ──
  'บันทึกระบบ (Audit log)': 'System log (Audit log)',
  ล่าสุด: 'Latest',
  เวลา: 'Time',
  ผู้ทำ: 'Actor',
  การกระทำ: 'Action',
  เป้าหมาย: 'Target',
  ยังไม่มีบันทึก: 'No log entries yet',

  // ── admin/EmailDomainsTab.tsx ──
  โดเมนอีเมลบริษัท: 'Company email domains',
  ตั้งโดเมน: 'Set domain',
  'ล้างโดเมนแล้ว — กลับไปแสดงทุกฉบับเหมือนเดิม': 'Domain cleared — back to showing every message as before',
  ยังไม่ได้ตั้ง: 'Not set yet',
  บันทึก: 'Save',
  ยังไม่มีบริษัทในระบบ: 'No companies in the system yet',

  // ── admin/NotificationRecipientsTab.tsx ──
  อีเมล: 'Email',
  'ต้องระบุปลายทาง (LINE user ID หรืออีเมล)': 'Destination is required (LINE user ID or email)',
  เพิ่ม: 'Add',
  'ลบผู้รับแจ้งเตือนนี้?': 'Delete this recipient?',
  จะไม่ได้รับการแจ้งเตือนอีกต่อไป: 'will no longer receive notifications',
  ลบแล้ว: 'Deleted',
  ช่องทาง: 'Channel',
  'ชื่อ (แสดงในรายการ)': 'Name (shown in the list)',
  ปลายทาง: 'Destination',
  ชื่อ: 'Name',
  ยังไม่มีผู้รับแจ้งเตือน: 'No notification recipients yet',

  // ── admin/UsersTab.tsx ──
  'ซ่อนรหัสผ่าน': 'Hide password',
  'แสดงรหัสผ่าน': 'Show password',
  'กรอก username, ชื่อ และรหัสผ่านให้ครบ': 'Fill in username, name, and password',
  เพิ่มผู้ใช้ไม่สำเร็จ: 'Failed to add user',
  เพิ่มผู้ใช้: 'Added user',
  แก้ไขไม่สำเร็จ: 'Update failed',
  ผู้ใช้: 'User',
  'จะล็อกอินไม่ได้ทันที และเซสชันที่ล็อกอินอยู่ตอนนี้จะถูกเลิกทันที': 'won’t be able to log in immediately, and any active session will be ended right away',
  ปิดใช้งาน: 'Disable',
  'จะถูกลบทิ้งถาวร ล็อกอินไม่ได้อีก — กู้คืนไม่ได้': 'will be permanently deleted and can no longer log in — this cannot be undone',
  ลบผู้ใช้แล้ว: 'User deleted',
  ตั้งรหัสผ่านใหม่: 'Set a new password',
  ให้: 'For',
  '(อย่างน้อย 8 ตัวอักษร) — เซสชันที่ล็อกอินอยู่จะถูกเลิกทันที': '(at least 8 characters) — the active session will be ended immediately',
  รหัสผ่านใหม่: 'New password',
  ตั้งรหัสผ่าน: 'Set password',
  ตั้งรหัสผ่านไม่สำเร็จ: 'Failed to set password',
  ตั้งรหัสผ่านใหม่แล้ว: 'New password set',
  ผู้ใช้ระบบ: 'System users',
  'รหัสผ่าน (≥ 8 ตัวอักษร)': 'Password (≥ 8 characters)',
  แสดง: 'Show',
  ผูกพนักงาน: 'Link employee',
  ไม่ผูก: 'Unlinked',
  'ลบผู้ใช้นี้?': 'Delete this user?',
  ลบผู้ใช้นี้: 'Delete this user',
  'ปิดใช้งานผู้ใช้นี้?': 'Disable this user?',
  พนักงานที่ผูก: 'Linked employee',
  'แก้ role ของตัวเองไม่ได้': 'Cannot change your own role',
  'ปิดใช้งานบัญชีของตัวเองไม่ได้': 'Cannot disable your own account',
  ใช้งานอยู่: 'Active',
  รีเซ็ตรหัสผ่าน: 'Reset password',
  'ลบบัญชีของตัวเองไม่ได้': 'Cannot delete your own account',
  ยังไม่มีผู้ใช้: 'No users yet',
  'ชื่อ (ไทย)': 'Name (Thai)',
  'ชื่อ (อังกฤษ)': 'Name (English)',
  แก้ไขชื่อ: 'Edit name',
  แก้ไขชื่อไม่สำเร็จ: 'Failed to update name',
  แก้ไขชื่อแล้ว: 'Name updated',

  // ── master/HolidaysTab.tsx ──
  'ลบวันหยุดนี้?': 'Delete this holiday?',
  จะหายไปจากปฏิทินวันหยุด: 'will be removed from the holiday calendar',
  ปฏิทินวันหยุด: 'Holiday calendar',
  'เติมวันหยุดราชการทางการให้อัตโนมัติตามปีที่เลือก ไม่ต้องพิมพ์เพิ่มเอง': 'Official public holidays are filled in automatically for the selected year — no need to type them in',
  ชื่อวันหยุด: 'Holiday name',
  ขอบเขต: 'Scope',
  ลบวันหยุดนี้: 'Delete this holiday',
  ยังไม่มีข้อมูลวันหยุดทางการของปีนี้ในระบบ: 'No official holiday data for this year in the system yet',

  // ── master/EmployeesTab.tsx ──
  ชื่อพ้อง: 'Name alias',
  'ลบชื่อพ้องนี้?': 'Delete this name alias?',
  จะหายไปจากรายการชื่อพ้อง: 'will be removed from the name-alias list',
  ไม่มี: 'None',
  คลิกเพื่อแก้ไข: 'Click to edit',
  ลบชื่อพ้องนี้: 'Delete this name alias',
  ชื่อพ้องใหม่: 'New name alias',
  'ข้อมูลดึงจาก FlowAccount — แก้ไข/นำออกจากหน้านี้ไม่ได้ ต้องแก้ที่ FlowAccount แล้วซิงก์ใหม่':
    'Data pulled from FlowAccount — cannot be edited or removed here. Edit it in FlowAccount and re-sync instead',
  แก้เรท: 'Edit rate',
  'นำพนักงานออกจากโครงการนี้?': 'Remove this employee from the project?',
  'จะหายไปจากรายการของโครงการนี้ — ข้อมูลพนักงาน/ชื่อพ้องเดิมยังอยู่ เผื่อย้ายไปผูกโครงการอื่นทีหลัง':
    'will be removed from this project’s list — the employee’s record and existing aliases remain, in case they’re linked to another project later',
  นำออก: 'Remove',
  นำออกไม่สำเร็จ: 'Failed to remove',
  นำออกจากโครงการแล้ว: 'Removed from the project',
  เพิ่มพนักงาน: 'Add employee',
  รหัส: 'ID',
  ตำแหน่งบนใบแจ้งหนี้: 'Position on invoice',
  'เรท/เดือน': 'Rate/month',
  แก้ไขข้อมูลพนักงาน: 'Edit employee record',
  ยังไม่มีพนักงานในระบบ: 'No employees in the system yet',
  เพิ่มพนักงานใหม่: 'Add new employee',
  ผูกอัตราจ้างกับ: 'Linking pay rate to',
  บันทึกพนักงานใหม่: 'Save new employee',
  'ชื่อ-นามสกุล (ไทย)': 'Full name (Thai)',
  'ชื่อ-นามสกุล (อังกฤษ)': 'Full name (English)',
  'รหัสพนักงาน HRDD': 'HRDD employee code',
  'เลขที่ใบเสนอราคา (QT)': 'Quotation number (QT)',
  'เรทต่อเดือน (บาท)': 'Monthly rate (THB)',
  วันเริ่มงาน: 'Start date',
  'วันสิ้นสุด (ถ้าไม่ระบุ = ตามสัญญา)': 'End date (if unspecified, follows the contract)',
  วันสิ้นสุด: 'End date',

  // ── master/CustomersContractsTab.tsx ──
  ทำรายการไม่สำเร็จ: 'Action failed',
  'เชื่อมต่อ FlowAccount?': 'Connect FlowAccount?',
  'ปิดการเชื่อมต่อ FlowAccount?': 'Disconnect FlowAccount?',
  'ระบบจะเริ่มเชื่อมต่อกับ FlowAccount จริง ดึงข้อมูลบริษัท/พนักงานได้ และใช้ยิงเอกสารตอนกดอนุมัติวางบิล':
    'The system will start connecting to real FlowAccount — it can pull company/employee data and file documents when billing is approved',
  'ทุกคำขอจะกลายเป็น dry-run (ข้อมูลจำลอง) ทั้งระบบ ไม่เชื่อมต่อกับ FlowAccount จริงอีก จนกว่าจะเปิดใหม่':
    'Every request becomes a dry-run (simulated data) system-wide — it will not connect to real FlowAccount again until reconnected',
  เชื่อมต่อ: 'Connect',
  ปิดการเชื่อมต่อ: 'Disconnect',
  'เชื่อมต่อ FlowAccount แล้ว': 'FlowAccount connected',
  'ปิดการเชื่อมต่อ FlowAccount แล้ว': 'FlowAccount disconnected',
  เชื่อมต่อเซิร์ฟเวอร์ไม่ได้: 'Could not reach the server',
  'โหมดการเชื่อมต่อ FlowAccount — กดเพื่อเปิด/ปิด': 'FlowAccount connection mode — click to toggle',
  'เปิดใช้งานบริษัทนี้แล้ว — บริษัทอื่นที่เปิดอยู่ถูกปิดให้อัตโนมัติ': 'This company is now active — any other active company was automatically deactivated',
  ปิดใช้งานแล้ว: 'Deactivated',
  'ลบสัญญานี้?': 'Delete this contract?',
  'และพนักงาน/Timesheet ทั้งหมดของสัญญานี้จะหายไปถาวร — กู้คืนไม่ได้ (ลบได้เฉพาะสัญญาที่ยังไม่เคยออกใบแจ้งหนี้เลยเท่านั้น ถ้าเคยวางบิลไปแล้วแม้แต่ใบเดียว ระบบจะปฏิเสธการลบทั้งหมด)':
    'and every employee/timesheet under this contract will be permanently deleted — this cannot be undone (only contracts with no invoices at all can be deleted; if even one invoice was billed, the system will refuse to delete it)',
  ลบสัญญาแล้ว: 'Contract deleted',
  'ลบบริษัทรายนี้?': 'Delete this company?',
  'จะถูกลบถาวร — กู้คืนไม่ได้ (ลบได้เพราะยังไม่มีสัญญาผูกอยู่)':
    'will be permanently deleted — this cannot be undone (deletable because no contract is linked to it yet)',
  ลบบริษัทแล้ว: 'Company deleted',
  ลบบริษัทรายนี้: 'Delete this company',
  เพิ่มบริษัทใหม่: 'Add new company',
  'กำลังดำเนินการอยู่ — ปิดไปยังไม่มีบริษัทอื่นมาแทนที่อัตโนมัติ': 'Currently active — deactivating it won’t automatically activate another company',
  'ปิดอยู่ — เปิดเพื่อให้ระบบทำงานกับบริษัทนี้ (จะปิดบริษัทอื่นที่เปิดอยู่ให้เองอัตโนมัติ)': 'Inactive — activate to have the system work with this company (any other active company is automatically deactivated)',
  แก้ไขข้อมูลสัญญา: 'Edit contract',
  ลบสัญญานี้: 'Delete this contract',
  เลขที่สัญญา: 'Contract no.',
  จำนวนคน: 'Headcount',
  ยอดต่อเดือน: 'Monthly total',
  'หัก ณ ที่จ่าย': 'Withholding tax',
  'อัตราหัก ณ ที่จ่ายต้องอยู่ระหว่าง 0–30%': 'The withholding tax rate must be between 0–30%',
  'บันทึกอัตราหัก ณ ที่จ่ายแล้ว': 'Withholding tax rate saved',
  'แก้อัตราหัก ณ ที่จ่าย': 'Edit the withholding tax rate',
  สถานที่วางบิล: 'Billing location',
  ดึงพนักงาน: 'Fetched',
  'คน + เรทต่อเดือนจากใบเสนอราคานี้มาให้อัตโนมัติ': 'employee(s) + monthly rates automatically from this quotation',
  'ใบเสนอราคานี้ไม่มีรายชื่อพนักงานให้ดึง — เพิ่มรายชื่อในใบเสนอราคาที่ FlowAccount ก่อน':
    'This quotation has no employee list to fetch — add the names to the quotation in FlowAccount first',
  สร้างบริษัทไม่สำเร็จ: 'Failed to create company',
  สร้างสัญญาไม่สำเร็จ: 'Failed to create contract',
  ไม่สำเร็จ: 'failed',
  พร้อมพนักงาน: 'with',
  คนแล้ว: 'employee(s)',
  กรอกข้อมูลบริษัทและสัญญาแรกในคราวเดียว: 'Fill in the company and first contract in one go',
  'ดึงข้อมูลจาก FlowAccount': 'Fetch from FlowAccount',
  เลือกบริษัทจากใบเสนอราคาที่มีอยู่แล้ว: 'Choose a company from an existing quotation',
  ชื่อบริษัท: 'Company name',
  สาขา: 'Branch',
  ที่อยู่: 'Address',
  'เครดิต (วัน)': 'Credit (days)',
  เบอร์ผู้ประสานงาน: 'Coordinator phone',
  อีเมลผู้ประสานงาน: 'Coordinator email',
  สัญญาแรก: 'First contract',
  'เลขที่ใบว่าจ้าง (PO)': 'PO number',
  ชื่อโครงการ: 'Project name',
  'คงที่ (ระบุจำนวนวัน)': 'Fixed (specify number of days)',
  'จำนวนวัน (ถ้าคงที่)': 'Number of days (if fixed)',
  วันเริ่มสัญญา: 'Contract start date',
  วันสิ้นสุดสัญญา: 'Contract end date',
  'หัก ณ ที่จ่าย (%)': 'Withholding tax (%)',
  'พนักงาน/อัตราจ้างของบริษัทรายนี้เพิ่มได้ทีหลังจากแท็บ "พนักงาน & ชื่อพ้อง"': 'Employees/pay rates for this company can be added later from the "Employees & aliases" tab',
  บันทึกบริษัทใหม่: 'Save new company',
  ข้อมูลสัญญา: 'Contract details',

  // ── companies/page.tsx, companies/[contractId]/page.tsx ──
  รายละเอียดบริษัท: 'Company details',
  'ต้องเป็น admin หรือผู้บริหารเท่านั้นถึงจะเข้าหน้านี้ได้': 'Only admins or executives can access this page',

  // ── components/Overlays.tsx ──
  ตกลง: 'OK',
  'เอกสาร PDF': 'PDF document',
  ดาวน์โหลดไฟล์นี้: 'Download this file',
  ดาวน์โหลด: 'Download',
  ปิด: 'Close',
  แชร์ลิงก์: 'Share link',
  แชร์: 'Share',
  คัดลอกลิงก์แล้ว: 'Link copied',
  คัดลอกลิงก์ไม่สำเร็จ: 'Failed to copy the link',

  // ── components/ui.tsx ──
  ไม่มีงานค้าง: 'No pending tasks',
  'ส่วนนี้อยู่ระหว่างพอร์ตต่อจาก MIGRATION_PLAN.md': 'This section is still being ported per MIGRATION_PLAN.md',
  'กำลังพัฒนาในเฟสถัดไป — เชื่อมข้อมูลจริงเร็ว ๆ นี้': 'Coming in a future phase — will connect to real data soon',
};

const MONTHS_TH = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** จัด "รอบบิล" (period แบบ YYYY-MM ค.ศ. เสมอทั้งระบบ) ให้เป็นข้อความอ่านง่ายตามภาษาที่เลือกอยู่ — ไทย
 * ใช้ชื่อเดือนไทย + ปี พ.ศ. (+543) เหมือนเดิม, อังกฤษใช้ชื่อเดือนอังกฤษ + ปี ค.ศ. ตรงๆ (เจ้าของระบบสั่ง
 * 23 ก.ย. 69: สลับปีตามภาษาที่แถบบนด้วย ไม่ใช่ตรึงเป็น พ.ศ. เสมอไม่ว่าจะสลับภาษาเป็นอังกฤษหรือไม่)
 *
 * ใช้แทน `periodLabel` ที่หลายจุดฝั่งเซิร์ฟเวอร์ส่งมา (ซึ่งปั้นเป็นภาษาไทยตายตัวเสมอ ไม่รู้จักภาษาที่
 * เลือกอยู่ฝั่งเว็บ) — เซิร์ฟเวอร์ยังส่ง periodLabel แบบเดิมไว้ให้จุดที่ยังไม่ได้ผูกภาษาใช้ต่อได้โดยไม่พัง
 * แต่ทุกจุดที่โชว์ "เดือน/ปี" ควรเปลี่ยนมาใช้ตัวนี้กับ `period` ดิบ (YYYY-MM) แทน */
export function formatPeriod(period: string | null | undefined, lang: Lang): string {
  if (!period) return '—';
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) return period;
  const y = Number(m[1]);
  const mi = Number(m[2]) - 1;
  if (mi < 0 || mi > 11) return period;
  return lang === 'en' ? `${MONTHS_EN[mi]} ${y}` : `${MONTHS_TH[mi]} ${y + 543}`;
}

interface LanguageContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  tx: (th: string) => string;
  formatPeriod: (period: string | null | undefined) => string;
}

const LanguageContext = createContext<LanguageContextValue>({
  lang: 'th',
  setLang: () => {},
  tx: (th) => th,
  formatPeriod: (period) => formatPeriod(period, 'th'),
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>('th');

  // อ่านค่าที่เคยตั้งไว้จาก localStorage ตอน mount ฝั่ง client เท่านั้น (ตรงต้นฉบับ — SSR ยังไม่รู้จัก
  // ภาษาที่ผู้ใช้เคยเลือกไว้ จึง render เริ่มต้นเป็นไทยเสมอก่อน แล้วสลับทันทีถ้ามีค่าเก็บไว้)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LANG_KEY);
      if (saved === 'en') setLangState('en');
    } catch {
      /* localStorage อาจถูกบล็อก (private mode) — ใช้ไทยเป็นค่าเริ่มต้นไปเลย ไม่กระทบการทำงานหลัก */
    }
  }, []);

  function setLang(next: Lang) {
    setLangState(next);
    try {
      localStorage.setItem(LANG_KEY, next);
    } catch {
      /* เงียบไว้ — แค่จำภาษาข้ามเซสชันไม่ได้ ไม่กระทบการใช้งานรอบนี้ */
    }
  }

  const value = useMemo<LanguageContextValue>(
    () => ({
      lang,
      setLang,
      tx: (th: string) => (lang === 'en' && TX[th] ? TX[th] : th),
      formatPeriod: (period: string | null | undefined) => formatPeriod(period, lang),
    }),
    [lang],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLang() {
  return useContext(LanguageContext);
}
