/**
 * คำที่เอกสารจริงของลูกค้าแต่ละเจ้า "เรียก" ฟิลด์แต่ละตัว — ใช้ตอนเดาชื่อฟิลด์จาก Timesheet ตัวอย่าง
 * (fieldMapSuggestService.ts) ไม่ได้ใช้ตอนอ่านค่าจริง
 *
 * ทำไมต้องมีไฟล์นี้ — เดิมตัวเดาเทียบแค่สองอย่างคือชื่อตามสเปก (`Employee_Name`) กับป้ายไทย
 * (`ชื่อพนักงาน`) ซึ่งเอกสารจริงแทบไม่มีเจ้าไหนเขียนตรงแบบนั้นเลย ผลคือฟอร์ม CP Axtra (Lotus)
 * เดาได้แค่ 2 จาก 67 ฟิลด์ (29 ก.ย. 69) ทั้งที่อ่านป้ายจากเอกสารมาได้ตั้ง 51 ป้าย — เพราะฟอร์มนั้น
 * เขียนว่า `Vender:` `Resource Name:` `Contract Role:` ซึ่งไม่ตรงกับทั้งสองทางเลย
 *
 * ทุกคำในนี้มาจากฟอร์มจริงที่เคยอ่านมาแล้ว ไม่ได้นั่งคิดเอาเอง — BigC · CP Axtra (Lotus) ·
 * T8 (Horizon/ISP/ISV) · Thailife · Locus→Sony · TSG/อาคเนย์ · Fujitsu→Toyota Daihatsu
 * รวมถึงคำที่เขาสะกดผิดแล้วยังใช้อยู่จริง (`Vender`, `Job Discription`) ซึ่งต้องจับให้ได้ด้วย
 *
 * เพิ่มคำใหม่ได้เรื่อยๆ เมื่อเจอฟอร์มเจ้าใหม่ — เป็นการเพิ่มล้วนๆ ไม่กระทบของเดิม
 */

/** คีย์ = คีย์ฟิลด์ตามสารบัญกลาง (ดู timesheetFields.ts) · ค่า = คำที่เอกสารจริงใช้เรียกฟิลด์นั้น */
export const TIMESHEET_FIELD_LABEL_ALIASES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  // ── หัวเอกสาร ──────────────────────────────────────────────────────────
  vendorName: ['Vendor', 'Vender', 'Supplier', 'Employer', 'Service Provider', 'Company',
    'บริษัทผู้ให้บริการ', 'ผู้ให้บริการ', 'บริษัทคู่สัญญา'],
  clientName: ['Client', 'Client Name', 'Customer', 'End Customer', 'Company Name',
    'ลูกค้า', 'ชื่อลูกค้า', 'บริษัทลูกค้า'],
  projectName: ['Project', 'Project Name', 'Assignment', 'โครงการ', 'ชื่อโครงการ', 'ชื่องาน'],
  employeeName: ['Name', 'Employee', 'Employee Name', 'Resource Name', 'Resource', 'Outsource Name',
    'Consultant Name', 'Staff Name', 'Contractor Name', 'Full Name',
    'ชื่อ', 'ชื่อ-นามสกุล', 'ชื่อพนักงาน', 'ชื่อผู้ปฏิบัติงาน', 'ผู้ปฏิบัติงาน'],
  employeeId: ['Employee ID', 'Emp ID', 'Employee No', 'Staff ID', 'Resource ID', 'Personnel No',
    'รหัสพนักงาน', 'เลขประจำตัวพนักงาน'],
  position: ['Position', 'Job Title', 'Title', 'ตำแหน่ง', 'ตำแหน่งงาน'],
  role: ['Role', 'Contract Role', 'Job Role', 'บทบาท', 'หน้าที่'],
  department: ['Department', 'Dept', 'Division', 'แผนก', 'ฝ่าย', 'หน่วยงาน'],
  monthYear: ['Month', 'Year', 'Month/Year', 'Month / Year', 'MONTH/YEAR', 'Period Month',
    'เดือน', 'ประจำเดือน', 'เดือน/ปี', 'ประจำเดือน/ปี'],
  reportingPeriod: ['Period', 'Reporting Period', 'Date Range', 'From - To', 'Duration',
    'ช่วงวันที่', 'ระหว่างวันที่', 'รอบ', 'งวด'],
  supervisorName: ['Supervisor', 'Supervisor Name', 'Line Manager', 'หัวหน้างาน', 'ผู้บังคับบัญชา'],
  projectManagerName: ['Project Manager', 'PM', 'Project Manager Name', 'ผู้จัดการโครงการ', 'ผู้ควบคุมงาน'],
  approvedByName: ['Approved By', 'Approver', 'Authorized By', 'ผู้อนุมัติ', 'อนุมัติโดย'],
  documentSite: ['Site', 'Location', 'Place', 'Work Site', 'Office',
    'สถานที่', 'สถานที่ปฏิบัติงาน', 'สถานที่ทำงาน'],
  projectTeam: ['Team', 'Project/Team', 'Project Team', 'Squad', 'ทีม', 'ทีมโครงการ'],
  documentType: ['Document Type', 'Doc Type', 'Form Type', 'ประเภทเอกสาร'],
  documentNumber: ['Document No', 'Document Number', 'Doc No', 'Form No', 'เลขที่เอกสาร', 'เลขที่'],

  // ── ช่องสรุปท้ายเอกสาร ─────────────────────────────────────────────────
  totalWorkDays: ['Total Work Days', 'Total Working Days', 'Working Days', 'Total Days', 'Man Days',
    'รวมวันทำงาน', 'จำนวนวันทำงาน', 'รวมวันทำการ', 'วันทำงานรวม'],
  totalLeaveSickDays: ['Leave / Sick', 'Leave/Sick', 'Leave & Sick', 'ลา/ป่วย', 'ลา-ป่วย'],
  totalLeaveDays: ['Total Leave', 'Total Leave Days', 'Leave Days', 'Annual Leave',
    'รวมวันลา', 'จำนวนวันลา', 'วันลารวม'],
  totalSickDays: ['Total Sick', 'Sick Leave', 'Sick Days', 'รวมวันลาป่วย', 'ลาป่วย', 'วันป่วย'],
  totalNormalHours: ['Total Normal Hours', 'Total Working Hours', 'Normal Hours Total',
    'รวมชั่วโมงปกติ', 'รวมเวลาปกติ', 'ชั่วโมงทำงานรวม'],
  totalOtHours: ['Total OT', 'Total OT Hours', 'Total Overtime', 'Overtime Total',
    'รวมโอที', 'รวมล่วงเวลา', 'รวมชั่วโมงล่วงเวลา'],
  // ไม่ใส่คำว่า `Total` เปล่าๆ ไว้ที่นี่ — ฟอร์ม Fujitsu ใช้ `Total` เป็นคอลัมน์ชั่วโมงทำงานรายวัน
  // ไม่ใช่ยอดรวมทั้งงวด ถ้าใส่ไว้ ช่องสรุปจะคว้าคอลัมน์รายวันไปตั้งแต่รอบแรก
  monthlyTotalHours: ['Total Hours', 'Grand Total', 'รวมทั้งสิ้น', 'รวมทั้งหมด', 'รวมชั่วโมง'],
  totalWeekendDays: ['Total Weekend', 'Weekend Days', 'รวมวันหยุดสุดสัปดาห์', 'เสาร์-อาทิตย์'],
  totalHolidayDays: ['Total Holiday', 'Holiday Days', 'Public Holidays',
    'รวมวันหยุด', 'วันหยุดนักขัตฤกษ์', 'วันหยุดประจำปี'],
  totalBaseManDay: ['Man Day', 'Man-Day', 'Base Man Day', 'Total Man Day', 'แมนเดย์', 'รวมแมนเดย์'],
  totalAdditionalManDay: ['Additional Man Day', 'Extra Man Day', 'แมนเดย์เพิ่มเติม'],
  totalAdditionalHours: ['Total Additional Hours', 'Additional Hours Total', 'รวมชั่วโมงเพิ่มเติม'],
  totalOtAdjust: ['OT Adjust', 'Adjust OT', 'OT Adjustment', 'ปรับโอที', 'ปรับ OT'],

  // ── ลายเซ็น ────────────────────────────────────────────────────────────
  employeeSignatureName: ['Employee Signature', 'Signature of Employee', 'Prepared By',
    'ลายเซ็นพนักงาน', 'ลงชื่อพนักงาน', 'ผู้จัดทำ'],
  employeeSignatureDate: ['Employee Signature Date', 'Signed Date', 'วันที่ลงนาม'],
  projectManagerSignatureName: ['Project Manager Signature', 'PM Signature', 'Approved By (PM)',
    'ลายเซ็นผู้ควบคุมงาน', 'ลงชื่อผู้ควบคุมงาน'],
  projectManagerSignatureDate: ['PM Signature Date', 'วันที่ลงนามผู้ควบคุมงาน'],
  authorizedSignatureName: ['Authorized Signature', "Authorized Person's Signature",
    'ผู้มีอำนาจลงนาม', 'ลายเซ็นผู้มีอำนาจ'],
  issuedByName: ['Issued By', 'Created By', 'ผู้ออกเอกสาร'],
  issuedDate: ['Issued Date', 'Date Issued', 'วันที่ออกเอกสาร'],
  approvedDate: ['Approved Date', 'Date Approved', 'วันที่อนุมัติ'],
  signatureStatus: ['Signature Status', 'สถานะลายเซ็น'],

  // ── รายวัน (คอลัมน์ในตาราง) ────────────────────────────────────────────
  rowNumber: ['No', 'NO.', 'No.', 'Item', 'Seq', 'ลำดับ', 'ลำดับที่'],
  // ไม่ใส่ `Day` ไว้ที่นี่ทั้งที่ฟอร์ม Locus ใช้ `Day` เป็นคอลัมน์วันที่ — เพราะฟอร์ม T8/ISV ใช้ `Day`
  // เป็นคอลัมน์ชื่อวันในสัปดาห์ และมี `Date` แยกอยู่แล้ว ถ้าใส่ไว้จะแย่งกันเองในฟอร์มนั้น
  date: ['Date', 'DATE', 'Work Date', 'วันที่'],
  day: ['Day of Week', 'Weekday', 'Day Name', 'วัน', 'วันในสัปดาห์'],
  project: ['Project', 'Task Project', 'โครงการ'],
  dailySite: ['Site', 'Place', 'Location', 'Work Place', 'สถานที่'],
  workLocation: ['Work Location', 'Work Mode', 'Working Location', 'WFH', 'Onsite', 'On Site', 'Remote',
    'รูปแบบการทำงาน', 'ลักษณะการทำงาน'],
  workType: ['Type', 'Work Type', 'Day Type', 'Category', 'ประเภท', 'ประเภทวัน', 'ลักษณะงาน'],
  timeIn: ['Time In', 'Time in', 'Clock-In', 'Clock In', 'In', 'IN', 'Start Time', 'Normal In',
    'Check In', 'เวลาเข้า', 'เข้างาน', 'เวลาเริ่มงาน'],
  timeOut: ['Time Out', 'Time out', 'Clock-Out', 'Clock Out', 'Out', 'OUT', 'End Time', 'Normal Out',
    'Check Out', 'เวลาออก', 'ออกงาน', 'เวลาเลิกงาน'],
  breakHours: ['Break', 'BREAK', 'Break Time', 'Break Hours', 'Lunch', 'พัก', 'เวลาพัก', 'พักเที่ยง'],
  otTimeIn: ['OT In', 'OT Start', 'Overtime In', 'Time (OT)', 'ล่วงเวลาเข้า', 'เวลาเข้าโอที'],
  otTimeOut: ['OT Out', 'OT End', 'Overtime Out', 'ล่วงเวลาออก', 'เวลาออกโอที'],
  otBreakHours: ['OT Break', 'Overtime Break', 'พักโอที'],
  normalHours: ['Base hours', 'Base Hours', 'Working Hrs', 'Working Hours', 'Logged Hours', 'Normal Hours',
    'No.Hrs', 'Work', 'Hours', 'Total', 'ชั่วโมงทำงาน', 'ปกติ', 'เวลาปกติ', 'ชั่วโมงปกติ'],
  otHours: ['OT', 'OT Hours', 'Overtime', 'OverTime', 'Overtime Hours',
    'ล่วงเวลา', 'โอที', 'ชั่วโมงล่วงเวลา'],
  dailyTotalHours: ['Total Hours', 'Daily Total', 'Sum Hours', 'รวม', 'รวมชั่วโมง', 'รวมเวลา'],
  additionalHours: ['Additional hours', 'Additional Hours', 'Extra Hours', 'ชั่วโมงเพิ่มเติม'],
  additionalManDay: ['Additional Man Day', 'Extra Man Day', 'แมนเดย์เพิ่มเติม'],
  jobDescription: ['Job Description', 'Job Discription', 'Description', 'Job Detail', 'Task', 'Work Detail',
    'CONTENT', 'Content', 'Notes', 'Note', 'รายละเอียด', 'รายละเอียดงาน', 'งานที่ทำ'],
  activity: ['Activity', 'ACTIVITY', 'Activities', 'กิจกรรม'],
  leaveType: ['Leave', 'Leave Type', 'Absence Type', 'ลา', 'ประเภทการลา', 'ประเภทวันลา'],
  leaveDays: ['Leave Days', 'Days of Leave', 'วันลา', 'จำนวนวันลา'],
  remarks: ['Remark', 'Remarks', 'Note', 'Comment', 'หมายเหตุ'],
  prLink: ['PR', 'PR Link', 'Pull Request', 'Merge Request'],
  ticketId: ['Ticket', 'Ticket ID', 'Ticket No', 'Issue', 'Issue ID', 'Jira', 'เลขที่ตั๋ว'],
  status: ['Status', 'State', 'สถานะ'],
  otApproval: ['OT Approval', 'Approve OT', 'OT Approved', 'อนุมัติโอที', 'อนุมัติ OT'],
  adjustmentValue: ['Adjust', 'Adjustment', 'Adjust OT', 'ปรับปรุง', 'ค่าปรับปรุง'],
});
