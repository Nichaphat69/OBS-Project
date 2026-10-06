/**
 * สารบัญฟิลด์กลางของ Timesheet — "ภาษากลาง" ที่ตัวอ่านทุกตัวต้องแปลงผลลัพธ์มาลงให้ตรงกัน
 *
 * ที่มา: Clear Read AI Master Timesheet Template — สรุปจากฟอร์มจริงของลูกค้าหลายราย
 * (PTT/iPassion, ThaiLife, Fujitsu, Virtual Link, T8, BigC) ว่าแต่ละเจ้าเรียกฟิลด์เดียวกันคนละชื่อ
 * อย่างไรบ้าง ไฟล์นี้คือสเปกนั้นในรูปแบบที่โค้ดอ่านได้
 *
 * ทำไมต้องเป็นข้อมูล ไม่ใช่แค่ TypeScript interface:
 * - หน้า "ตั้งค่าฟิลด์" ต้องวาดฟอร์มจากรายการนี้เอง จะได้ไม่ต้องแก้ UI ทุกครั้งที่เพิ่มฟิลด์
 * - `description` ไม่ใช่คอมเมนต์ แต่เป็นข้อความที่ส่งให้เครื่องอ่านเอกสารจริง (ABBYY/Clear Read)
 *   ใช้ตัดสินว่าช่องไหนในเอกสารคือฟิลด์นี้ — แก้ข้อความ = เปลี่ยนพฤติกรรมการอ่าน
 * - ตัวอ่านแต่ละเจ้า map ชื่อฟิลด์ของตัวเองมาที่ `key` เหล่านี้ (ดู fieldMap ต่อ Skill)
 *
 * กติกาสำคัญที่มาจากสเปกต้นทาง — ห้ามแปลง/ห้ามเดา/ห้ามคำนวณให้ ถ้าเอกสารไม่ได้เขียนไว้เอง
 * ค่าที่อ่านมาได้ให้เก็บตามรูปเดิมของเอกสาร (เช่นวันที่ "01/05/26" กับ "29-Jan-26" เก็บคนละแบบได้)
 * การแปลงเป็นรูปมาตรฐานเป็นหน้าที่ของชั้น normalize ทีหลัง ไม่ใช่ของตัวอ่าน
 */

export type TimesheetFieldType = 'text' | 'number';

export interface TimesheetFieldSpec {
  /** ชื่อ canonical ที่โค้ดทั้งระบบใช้ — ตัวอ่านทุกเจ้าต้อง map มาลงคีย์นี้ */
  key: string;
  /** ชื่อฟิลด์ตามสเปกกลาง (ใช้ตอนคุยกับผู้ตั้งค่า Skill และตอนส่งให้เครื่องอ่าน) */
  name: string;
  /** ป้ายภาษาไทยสำหรับหน้าจอตั้งค่า */
  label: string;
  /** ข้อความที่ส่งให้เครื่องอ่านเอกสารใช้ตัดสินว่าช่องไหนคือฟิลด์นี้ — ไม่ใช่คอมเมนต์ */
  description: string;
  type: TimesheetFieldType;
  examples: string[];
}

/** ฟิลด์ระดับหัวเอกสาร — หนึ่งค่าต่อหนึ่ง Timesheet */
export const TIMESHEET_HEADER_FIELDS: TimesheetFieldSpec[] = [
  {
    key: 'vendorName', name: 'Vendor_Name', label: 'ชื่อบริษัทผู้ให้บริการ',
    description:
      'Name of the vendor, outsourcing company, staffing provider, employer, or service provider associated with '
      + 'the Timesheet. Map labels such as Vendor, Vender, Supplier, Employer, or Service Provider. '
      + 'Do not confuse with Client_Name.',
    type: 'text', examples: ['iPassion Co., Ltd.', 'ABC Co., Ltd.', 'Supplier A'],
  },
  {
    key: 'clientName', name: 'Client_Name', label: 'ชื่อลูกค้า',
    description:
      'Name of the client, customer, end customer, or organization receiving the service. Map Client, Customer, '
      + 'End Customer, or equivalent labels. Do not confuse with Vendor_Name.',
    type: 'text', examples: ['PTT Co.,Ltd.', 'ThaiLife Insurance Public Co.,Ltd.', 'Customer A'],
  },
  {
    key: 'projectName', name: 'Project_Name', label: 'ชื่อโครงการ',
    description:
      'Overall project, assignment, service, contract, or work engagement stated for the Timesheet. '
      + 'Do not use a daily task unless it is explicitly the overall project.',
    type: 'text', examples: ['Outsource for PTT Project', 'Outsource for BAU Project', 'Project A'],
  },
  {
    key: 'employeeName', name: 'Employee_Name', label: 'ชื่อพนักงาน',
    description:
      'Full name of the employee, consultant, contractor, or resource whose working time is recorded. '
      + 'Preserve Thai or English text exactly.',
    type: 'text', examples: ['Pitikorn Chumphuchanapai', 'Sunee Maneekasemsuk', 'Iptisam Samaheng'],
  },
  {
    key: 'employeeId', name: 'Employee_ID', label: 'รหัสพนักงาน',
    description:
      'Employee, staff, consultant, or resource identifier when explicitly shown. '
      + 'Do not use document number, project code, or row number.',
    type: 'text', examples: ['EMP001', 'ST-2026-015', '12345'],
  },
  {
    key: 'position', name: 'Position', label: 'ตำแหน่ง',
    description: 'Job title or professional position of the employee.',
    type: 'text', examples: ['OutSystems Developer', 'Java Programmer', 'Senior Project Manager', 'Developer'],
  },
  {
    key: 'role', name: 'Role', label: 'บทบาท',
    description: 'Functional, contract, or system role when separately stated from Position.',
    type: 'text', examples: ['System SMART', 'Developer', 'Consultant', 'Project Manager'],
  },
  {
    key: 'department', name: 'Department', label: 'แผนก',
    description: 'Department, division, business unit, or team associated with the employee when explicitly shown.',
    type: 'text', examples: ['IT', 'Development', 'Digital Transformation', 'PMO'],
  },
  {
    key: 'monthYear', name: 'Month_Year', label: 'เดือน/ปีของรอบ',
    description: 'Reporting month and year. Preserve the source representation rather than converting it.',
    type: 'text', examples: ['May 2026', '8 2026', 'January 2026', '08/2026'],
  },
  {
    key: 'reportingPeriod', name: 'Reporting_Period', label: 'ช่วงวันที่ของรอบ',
    description:
      'Explicit start and end period for the Timesheet when provided. '
      + 'Do not infer a full period when only a month/year is shown.',
    type: 'text', examples: ['01/08/2026 - 31/08/2026', 'Aug 1–31, 2026'],
  },
  {
    key: 'supervisorName', name: 'Supervisor_Name', label: 'ชื่อหัวหน้างาน',
    description: 'Name of the direct supervisor or project supervisor when explicitly shown.',
    type: 'text', examples: ['John Smith', 'Project Supervisor A'],
  },
  {
    key: 'projectManagerName', name: 'Project_Manager_Name', label: 'ชื่อ Project Manager',
    description:
      'Name of the Project Manager when the source states it as its own field. May be the same person as '
      + 'Approved_By_Name, but never copy one into the other unless the source itself repeats the name.',
    type: 'text', examples: ['Nichaphat Chokrak', 'Apinya Phuangtaw'],
  },
  {
    key: 'approvedByName', name: 'Approved_By_Name', label: 'ชื่อผู้อนุมัติ',
    description:
      'Name of the person who approves the Timesheet. Map the source aliases Approver, Approved By, and '
      + 'Approver Name onto this single canonical field.',
    type: 'text', examples: ['Nichaphat Chokrak', 'Supranee Suwannates'],
  },
  {
    key: 'documentSite', name: 'Document_Site', label: 'สถานที่ปฏิบัติงาน (ระดับเอกสาร)',
    description:
      'Physical site at document/header level, such as office, branch, or customer site. Map Place, Location, '
      + 'Office, Branch, and Customer Site when they appear at document level. Use Daily_Site for a site printed '
      + 'on an individual daily row, and Work_Location for a working arrangement such as WFH or Remote — '
      + 'those are different fields, not aliases of this one.',
    type: 'text', examples: ['Office', 'Bangkok', 'PTT', 'Head Office', 'Branch 01', 'Building A'],
  },
  {
    key: 'projectTeam', name: 'Project_Team', label: 'ทีมโครงการ',
    description: 'Project team, squad, group, or work team when explicitly shown.',
    type: 'text', examples: ['Team A', 'Development Team', 'Project Team 1'],
  },
  {
    key: 'documentType', name: 'Document_Type', label: 'ประเภทเอกสาร',
    description: 'Document type or document title as printed on the form.',
    type: 'text', examples: ['Timesheet', 'Working Report', 'Monthly Timesheet'],
  },
  {
    key: 'documentNumber', name: 'Document_Number', label: 'เลขที่เอกสาร',
    description:
      'Document, Timesheet, or reference number printed on the form. Do not use Employee_ID or a row number.',
    type: 'text', examples: ['TS-2026-08-001', '000000213'],
  },
];

/** ฟิลด์ระดับแถวรายวัน — หนึ่งแถวต่อหนึ่งวันในตาราง (line item ชื่อ TimesheetDetails) */
export const TIMESHEET_DETAIL_FIELDS: TimesheetFieldSpec[] = [
  {
    key: 'rowNumber', name: 'Row_Number', label: 'ลำดับแถว',
    description:
      'Sequential row or item number when explicitly printed in the daily table. '
      + 'Do not create one if the source does not show it.',
    type: 'text', examples: ['1', '01', '31'],
  },
  {
    key: 'date', name: 'Date', label: 'วันที่',
    description:
      'Calendar date corresponding to the specific daily row. Extract exactly as shown, preserving separators, '
      + 'language, and calendar system. Do not confuse with approval/signature date.',
    type: 'text', examples: ['01/05/26', '19/01/26', '29-Jan-26', '27/07/26'],
  },
  {
    key: 'day', name: 'Day', label: 'วันในสัปดาห์',
    description: 'Weekday corresponding to the daily row. Preserve the source language or abbreviation.',
    type: 'text', examples: ['Mon', 'Monday', 'Tue', 'Fri', 'Sat', 'Sunday', 'จันทร์'],
  },
  {
    key: 'project', name: 'Project', label: 'โครงการ (รายวัน)',
    description: 'Daily project code, project name, assignment, or chargeable project shown in the daily row.',
    type: 'text', examples: ['PRJ26050', 'BSCP-AI Object', 'Internal-Other', 'Project A'],
  },
  {
    key: 'dailySite', name: 'Daily_Site', label: 'สถานที่ (รายวัน)',
    description:
      'Physical site printed on this daily row. Map the source alias Place when it names a location. '
      + 'Use Document_Site for a site stated once at document level, and Work_Location for a working '
      + 'arrangement such as WFH or Remote — never mix Daily_Site and Work_Location.',
    type: 'text', examples: ['Office', 'PTT', 'Bangkok', 'Head Office', 'Branch 01'],
  },
  {
    key: 'workLocation', name: 'Work_Location', label: 'รูปแบบการทำงาน',
    description:
      'Working arrangement only — remote, WFH, on-site, or office arrangement. This is not a physical site: '
      + 'a named place belongs in Daily_Site or Document_Site. Use only when explicitly stated.',
    type: 'text', examples: ['WFH', 'Remote', 'On-site', 'Office'],
  },
  {
    key: 'workType', name: 'Work_Type', label: 'ประเภทของวัน',
    description: 'Daily work status or category, such as working, weekend, holiday, or leave.',
    type: 'text', examples: ['Working', 'Weekend', 'Holiday', 'Public Holiday', 'Vacation Leave', 'Sick Leave'],
  },
  {
    key: 'timeIn', name: 'Time_In', label: 'เวลาเข้า',
    description:
      'Regular working start time. Map Time In, Clock In, Clock-In, Normal In, IN, Start Time, or equivalent. '
      + 'Do not use OT In.',
    type: 'text', examples: ['8:30', '9:00', '10:00', '13:00'],
  },
  {
    key: 'timeOut', name: 'Time_Out', label: 'เวลาออก',
    description:
      'Regular working end time. Map Time Out, Clock Out, Normal Out, OUT, End Time, or equivalent. '
      + 'Do not use OT Out.',
    type: 'text', examples: ['17:00', '17:30', '18:00', '19:00'],
  },
  {
    key: 'breakHours', name: 'Break_Hours', label: 'ชั่วโมงพัก',
    description: 'Regular break, rest, lunch, or break duration when explicitly shown.',
    type: 'number', examples: ['1', '1.00', '0.5', '60'],
  },
  {
    key: 'otTimeIn', name: 'OT_In', label: 'เวลาเริ่ม OT',
    description: 'Overtime start time when explicitly shown.',
    type: 'text', examples: ['18:00', '19:00', '20:00'],
  },
  {
    key: 'otTimeOut', name: 'OT_Out', label: 'เวลาสิ้นสุด OT',
    description: 'Overtime end time when explicitly shown.',
    type: 'text', examples: ['20:00', '21:00', '22:00'],
  },
  {
    key: 'otBreakHours', name: 'OT_Break_Hours', label: 'ชั่วโมงพักระหว่าง OT',
    description: 'Overtime break/rest duration when explicitly shown.',
    type: 'number', examples: ['0', '0.5', '1.00'],
  },
  {
    key: 'normalHours', name: 'Normal_Hours', label: 'ชั่วโมงทำงานปกติ',
    description:
      'Regular working duration excluding overtime. Map Normal, Regular Hours, Normal Hours, Base Hours, '
      + 'Base Duration, or equivalent only when it represents regular work duration.',
    type: 'number', examples: ['7', '8', '8.00', '9'],
  },
  {
    key: 'otHours', name: 'OT_Hours', label: 'ชั่วโมง OT',
    description:
      'Overtime duration. Map OT, Overtime, OT Hours, or equivalent only when the source clearly represents overtime.',
    type: 'number', examples: ['0', '1', '2.00', '3.5'],
  },
  {
    key: 'dailyTotalHours', name: 'Daily_Total_Hours', label: 'ชั่วโมงรวมของวันนั้น',
    description:
      'Total duration for THIS ONE daily row only. Map Total, Total per day, Working Hrs., or Duration as hour '
      + 'when the value belongs to a single date. Never put a monthly or period total here — that is '
      + 'Monthly_Total_Hours, a different field. Do not calculate it yourself.',
    type: 'number', examples: ['8', '8.00', '9.5'],
  },
  {
    key: 'additionalHours', name: 'Additional_Hours', label: 'ชั่วโมงเพิ่มเติม',
    description:
      'Additional hours the source separates out but does not clearly label as overtime. Do not treat this as '
      + 'overtime unless the source explicitly identifies it as OT. For an additional man-day figure use '
      + 'Additional_Man_Day instead.',
    type: 'number', examples: ['0', '0.5', '1', '2.00'],
  },
  {
    key: 'additionalManDay', name: 'Additional_Man_Day', label: 'แมนเดย์เพิ่มเติม (รายวัน)',
    description: 'Additional man-day value on this daily row when the source states it.',
    type: 'number', examples: ['0.5', '1', '2'],
  },
  {
    key: 'jobDescription', name: 'Job_Description', label: 'รายละเอียดงาน',
    description:
      'Work description, task detail, or remark text describing what was done on this row. Where the same source '
      + 'cell contains multiple activities, preserve the complete content here unless the source has a separate '
      + 'Activity field.',
    type: 'text', examples: ['แก้บั๊กหน้าจอรายงาน', 'Development - API', 'Meeting with client'],
  },
  {
    key: 'activity', name: 'Activity', label: 'กิจกรรม',
    description: 'Activity or task category when the source provides it as a separate field from Job_Description.',
    type: 'text', examples: ['Development', 'Meeting', 'Support', 'Testing'],
  },
  {
    key: 'leaveType', name: 'Leave_Type', label: 'ประเภทการลา',
    description:
      'Leave category for the row when the source explicitly represents leave, such as sick leave, personal leave, '
      + 'vacation, or unpaid leave. Preserve the source wording.',
    type: 'text', examples: ['Sick Leave', 'Vacation Leave', 'ลากิจ', 'ลาป่วย', 'Unpaid Leave'],
  },
  {
    key: 'leaveDays', name: 'Leave_Days', label: 'จำนวนวันลา',
    description: 'Number of leave days reported for the row when explicitly shown.',
    type: 'number', examples: ['0.5', '1'],
  },
  {
    key: 'remarks', name: 'Remarks', label: 'หมายเหตุ',
    description:
      'Separate note or comment text that is not the main work description. If the source has one combined '
      + 'Job Description / Remark cell, keep the whole cell in Job_Description and leave this empty — '
      + 'never duplicate the same text into both.',
    type: 'text', examples: ['Approved', 'Pending', 'Remark A', 'N/A'],
  },
  {
    key: 'prLink', name: 'PR_Link', label: 'ลิงก์ PR/อ้างอิง',
    description:
      'Pull-request or reference URL appearing on this daily row. Preserve the URL exactly — do not shorten it.',
    type: 'text', examples: ['https://github.com/org/repo/pull/1795'],
  },
  {
    key: 'ticketId', name: 'Ticket_ID', label: 'เลขที่ Ticket/Issue',
    description: 'Issue, ticket, or reference ID explicitly shown on this daily row. Preserve it exactly.',
    type: 'text', examples: ['HEAL-2886', 'BSD-103', 'BSD-116'],
  },
  {
    key: 'status', name: 'Status', label: 'สถานะของแถว',
    description: 'Row status when the source prints it separately from Work_Type.',
    type: 'text', examples: ['Pending', 'Approved', 'Completed', 'Working'],
  },
  {
    key: 'otApproval', name: 'OT_Approval', label: 'สถานะอนุมัติ OT',
    description: 'Overtime approval state when the source shows it as its own column.',
    type: 'text', examples: ['Approved', 'Pending', 'Yes', 'No'],
  },
  {
    key: 'adjustmentValue', name: 'Adjustment_Value', label: 'ค่าปรับปรุง (รายวัน)',
    description:
      'Numeric adjustment printed on this daily row when the source has an Adjust or Adjustment column. '
      + 'For an adjustment stated at month/period level use Total_OT_Adjust instead — they are different fields.',
    type: 'number', examples: ['0', '0.5', '-1'],
  },
];

/**
 * ฟิลด์สรุปท้ายเอกสาร — หนึ่งค่าต่อหนึ่ง Timesheet เหมือนฟิลด์หัวเอกสาร แต่เป็นยอดรวมที่ "เอกสาร
 * เขียนไว้เอง" ไม่ใช่ที่เราคำนวณจากตาราง
 *
 * ⚠️ **สามฟิลด์นี้ไม่มีในไฟล์ Master Template ที่ได้รับมา** — เพิ่มเข้ามาเองเมื่อ 2026-09-16
 * หลังพบว่าสเปกต้นทางวางยอดรวมไว้ที่ระดับแถวอย่างเดียว (Normal_Hours/OT_Hours/Total_Hours/
 * Leave_Days ต่อแถว) แต่ฟอร์มจริงหลายเจ้าพิมพ์ยอดสรุปไว้ท้ายเอกสารด้วย เช่น ThaiLife เขียน
 * "Total Work days : 19  Leave / Sick (days) : 0  Total Hours : 152.00" และ Skill ของ ABBYY
 * ก็มีฟิลด์ "Total Work days"/"Leave Sick" ให้ดึงตรงๆ
 *
 * เหตุผลที่ต้องอยู่ในสารบัญกลาง ไม่ใช่แยกไว้ในแต่ละตัวอ่าน: ระบบพึ่งค่าพวกนี้จริง (`totalWorkDays`
 * จากช่องสรุปคือค่าหลัก ส่วนการนับจากตารางเป็น fallback) และฟอร์มเดียวกันนี้เองที่ Clear Read จะต้อง
 * อ่านด้วย — ถ้าปล่อยให้แต่ละตัวอ่านตั้งชื่อคีย์เอง สองตัวอ่านจะเรียกของสิ่งเดียวกันคนละชื่อ ซึ่งเป็น
 * ปัญหาที่สารบัญนี้มีไว้เพื่อกันตั้งแต่แรก
 *
 * กติกา "ห้ามคำนวณให้" ของสเปกต้นทางยังใช้เหมือนเดิม — ฟิลด์พวกนี้อ่านจากช่องสรุปที่เอกสารพิมพ์ไว้
 * เท่านั้น ถ้าเอกสารไม่มีช่องสรุปก็ปล่อยว่าง แล้วให้ชั้นถัดไปตัดสินใจว่าจะนับจากตารางแทนหรือไม่
 */
export const TIMESHEET_SUMMARY_FIELDS: TimesheetFieldSpec[] = [
  {
    key: 'totalWorkDays', name: 'Total_Work_Days', label: 'จำนวนวันทำงานรวม (ช่องสรุป)',
    description:
      'Total number of work days printed in a document-level summary box. Map Total Work days or Working days. '
      + 'Read it from the summary the document prints — do not count the daily rows yourself. '
      + 'A base man-day figure belongs in Total_Base_Man_Day, not here.',
    type: 'number', examples: ['19', '20', '17'],
  },
  {
    key: 'totalLeaveSickDays', name: 'Total_Leave_Sick_Days', label: 'วันลา+ป่วยรวม (ช่องเดียวในเอกสาร)',
    description:
      'Use ONLY when the source prints leave and sick together in one combined box, such as "Leave / Sick (days)" '
      + 'or "Leave/Sick days". Do not split that one number into Total_Leave_Days and Total_Sick_Days, and do not '
      + 'fill this by adding two separate figures together.',
    type: 'number', examples: ['0', '1', '2'],
  },
  {
    key: 'totalLeaveDays', name: 'Total_Leave_Days', label: 'จำนวนวันลารวม (ช่องสรุป)',
    description:
      'Total leave days when the source prints a leave total on its own. Map Total Leave or Leave days. '
      + 'Does not include sick leave unless the source itself defines it that way. If the form only has one '
      + 'combined Leave/Sick box, use Total_Leave_Sick_Days instead and leave this empty.',
    type: 'number', examples: ['1', '2', '5'],
  },
  {
    key: 'totalSickDays', name: 'Total_Sick_Days', label: 'จำนวนวันลาป่วยรวม (ช่องสรุป)',
    description:
      'Total sick-leave days when the source prints it separately. Map Sick Leave days or Total Sick. '
      + 'If the form only has one combined Leave/Sick box, use Total_Leave_Sick_Days instead and leave this empty.',
    type: 'number', examples: ['0', '1', '2'],
  },
  {
    key: 'totalNormalHours', name: 'Total_Normal_Hours', label: 'ชั่วโมงทำงานปกติรวมทั้งงวด',
    description:
      'Regular/base working hours for the whole period when the source prints such a total. '
      + 'Map the alias Base Duration when it means monthly regular hours.',
    type: 'number', examples: ['152', '136.00', '168.00'],
  },
  {
    key: 'totalOtHours', name: 'Total_OT_Hours', label: 'ชั่วโมง OT รวมทั้งงวด',
    description:
      'Overtime total for the whole period when the source clearly labels it as OT. '
      + 'Map Total OT, OT Total, or OverTime Total.',
    type: 'number', examples: ['0', '11.50', '5.00'],
  },
  {
    key: 'monthlyTotalHours', name: 'Monthly_Total_Hours', label: 'ชั่วโมงรวมทั้งงวด (ช่องสรุป)',
    description:
      'Total working hours for the ENTIRE reporting month or period, printed in a summary/total section. '
      + 'Map Total Hours and Total Duration at period scope. Never copy a single day\'s value here — that is '
      + 'Daily_Total_Hours, a different field. Do not sum the daily rows to produce this; leave it empty if the '
      + 'document does not print it.',
    type: 'number', examples: ['152.00', '136.00', '179.50'],
  },
  {
    key: 'totalWeekendDays', name: 'Total_Weekend_Days', label: 'จำนวนวันหยุดสุดสัปดาห์รวม',
    description: 'Count of weekend days when the source prints it.',
    type: 'number', examples: ['4', '8', '10'],
  },
  {
    key: 'totalHolidayDays', name: 'Total_Holiday_Days', label: 'จำนวนวันหยุดนักขัตฤกษ์รวม',
    description: 'Count of holiday days when the source prints it.',
    type: 'number', examples: ['1', '2'],
  },
  {
    key: 'totalBaseManDay', name: 'Total_Base_Man_Day', label: 'แมนเดย์พื้นฐานรวม',
    description:
      'Base man-day total when the source prints it. This is not Total_Work_Days — keep them separate even when '
      + 'the two numbers happen to match.',
    type: 'number', examples: ['20', '19.0', '21'],
  },
  {
    key: 'totalAdditionalManDay', name: 'Total_Additional_Man_Day', label: 'แมนเดย์เพิ่มเติมรวม',
    description: 'Additional man-day total when the source prints it.',
    type: 'number', examples: ['0', '1', '2.5'],
  },
  {
    key: 'totalAdditionalHours', name: 'Total_Additional_Hours', label: 'ชั่วโมงเพิ่มเติมรวม',
    description:
      'Additional-hours total when the source prints it and does not clearly label it as overtime.',
    type: 'number', examples: ['0', '2', '5.5'],
  },
  {
    key: 'totalOtAdjust', name: 'Total_OT_Adjust', label: 'ยอดปรับ OT ทั้งงวด',
    description: 'Overtime adjustment at month/period level when the source prints it.',
    type: 'number', examples: ['0', '0.5', '1'],
  },
];

/**
 * ฟิลด์ลายเซ็น/การอนุมัติ — หนึ่งค่าต่อหนึ่ง Timesheet เหมือนฟิลด์หัวเอกสาร
 * เพิ่มตาม Master Template V4 หมวด 5 (SIGNATURE / APPROVAL / CONTROL)
 *
 * แยกกลุ่มจากหัวเอกสารเพื่อให้หน้าตั้งค่าจัดกลุ่มได้ตรงกับที่สเปกแบ่งไว้ แต่ในทางข้อมูลถือเป็นฟิลด์
 * ระดับเอกสารเหมือนกัน จึงรวมอยู่ใน TIMESHEET_DOCUMENT_FIELDS ด้วย
 */
export const TIMESHEET_SIGNATURE_FIELDS: TimesheetFieldSpec[] = [
  {
    key: 'employeeSignatureName', name: 'Employee_Signature_Name', label: 'ชื่อที่ลงนาม (พนักงาน)',
    description:
      'Name attached to the employee/resource signature. Map the alias Resource Signature when the signer is '
      + 'the same recorded employee.',
    type: 'text', examples: ['Pitikorn Chumphuchanapai', 'Korrawit Soodnalao'],
  },
  {
    key: 'employeeSignatureDate', name: 'Employee_Signature_Date', label: 'วันที่ลงนาม (พนักงาน)',
    description: 'Date of the employee/resource signature. Preserve the source format.',
    type: 'text', examples: ['31/05/2026', '31/07/2026'],
  },
  {
    key: 'projectManagerSignatureName', name: 'Project_Manager_Signature_Name', label: 'ชื่อที่ลงนาม (PM)',
    description: 'Name attached to the Project Manager signature.',
    type: 'text', examples: ['Nichaphat Chokrak', 'Apinya Phuangtaw'],
  },
  {
    key: 'projectManagerSignatureDate', name: 'Project_Manager_Signature_Date', label: 'วันที่ลงนาม (PM)',
    description: 'Date of the Project Manager signature. Preserve the source format.',
    type: 'text', examples: ['31/05/2026', '31/07/2026'],
  },
  {
    key: 'authorizedSignatureName', name: 'Authorized_Signature_Name', label: 'ชื่อผู้มีอำนาจลงนาม',
    description: 'Name of the authorized signatory when the document has such a block.',
    type: 'text', examples: ['Patompong Kongwarin', 'Client Authorized Signatory'],
  },
  {
    key: 'issuedByName', name: 'Issued_By_Name', label: 'ผู้ออกเอกสาร',
    description: 'Person named in an "Issued by" field.',
    type: 'text', examples: ['Surasith Thatdee'],
  },
  {
    key: 'issuedDate', name: 'Issued_Date', label: 'วันที่ออกเอกสาร',
    description: 'Date shown in the "Issued by" block. Preserve the source format.',
    type: 'text', examples: ['02/09/2026', '31/08/2026'],
  },
  {
    key: 'approvedDate', name: 'Approved_Date', label: 'วันที่อนุมัติ',
    description: 'Approval date. Preserve the source format. Do not use a daily row date.',
    type: 'text', examples: ['02/09/2026', '31/08/2026'],
  },
  {
    key: 'signatureStatus', name: 'Signature_Status', label: 'สถานะลายเซ็น',
    description: 'Signature or approval state when the source states it.',
    type: 'text', examples: ['Signed', 'Approved', 'Pending'],
  },
];

/** ชื่อ line item ของตารางรายวันตามสเปกกลาง — ตัวอ่านที่รองรับ line item ต้องใช้ชื่อนี้ */
export const TIMESHEET_DETAIL_LINE_ITEM = 'TimesheetDetails';

/**
 * คีย์รายวันสามตัวที่ชื่อภายในระบบไม่ตรงกับสเปกกลาง — มีมาก่อนสเปกและยังเปลี่ยนชื่อไม่ได้
 *
 * `ExtractedDay`/`timesheet_days` ใช้ `dayOfWeek`/`remark`/`type` มาตั้งแต่ Phase 5.1 ซึ่งตรงกับ
 * `day`/`remarks`/`workType` ของสเปกทุกประการในความหมาย ต่างแค่ชื่อ — การเปลี่ยนชื่อไม่ใช่การเพิ่ม
 * (additive) และกระทบทั้ง abbyyClient.ts กับ apps/web พร้อมกัน จึงเลื่อนไปทำเป็นงานแยกทีหลัง
 *
 * ระหว่างนี้ตารางนี้คือแหล่งความจริงแหล่งเดียวของความต่างนั้น — ตัวอ่านเจ้าใหม่เขียน mapping ด้วย
 * **คีย์ตามสเปก** ได้เลย แล้วให้ชั้น boundary แปลงให้ (ดู extractionService.ts) จะได้ไม่มีใครต้อง
 * จำข้อยกเว้นสามข้อนี้เอง และความต่างก็ไม่งอกผู้พึ่งพารายใหม่เพิ่มขึ้นระหว่างรอ rename
 */
export const DETAIL_SPEC_KEY_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  day: 'dayOfWeek',
  remarks: 'remark',
  workType: 'type',
  // V4 แยกชื่อให้ไม่ซ้ำกับระดับเอกสาร แต่คอลัมน์ในฐานข้อมูลยังชื่อเดิม — ดูหมายเหตุ V4 ด้านล่าง
  dailySite: 'site',
  dailyTotalHours: 'totalHours',
});

/** แปลงคีย์รายวันจากชื่อตามสเปก → ชื่อที่ `ExtractedDay` ใช้จริง (คีย์อื่นคืนค่าเดิม) */
export function toInternalDetailKey(specKey: string): string {
  return DETAIL_SPEC_KEY_ALIASES[specKey] ?? specKey;
}

/**
 * คีย์ระดับเอกสารที่ชื่อตามสเปก V4 ไม่ตรงกับชื่อที่ระบบเก็บจริง — เหตุผลเดียวกับตารางรายวันด้านบน
 *
 * V4 บังคับว่า **ชื่อฟิลด์ต้องไม่ซ้ำกันเลยทั้ง schema** (CORE RULE) ซึ่งสารบัญเดิมของเราละเมิดอยู่สองจุด
 * พอดี และเป็นสองจุดที่สเปกเขียนถึงมากที่สุด:
 *   - `Site` เคยใช้ทั้งระดับเอกสารและระดับแถว → V4 แยกเป็น `Document_Site` / `Daily_Site`
 *   - `Total_Hours` เคยใช้ทั้งระดับแถวและช่องสรุป → V4 แยกเป็น `Daily_Total_Hours` / `Monthly_Total_Hours`
 *     และสั่งห้ามใช้ชื่อ `Total_Hours` อีกเลย
 *
 * สารบัญนี้จึงใช้ชื่อ V4 ที่ไม่ซ้ำเป็นคีย์ ส่วนคอลัมน์ในฐานข้อมูล (`timesheets.site`,
 * `timesheets.summary_total_hours`) ยังชื่อเดิม เพราะการเปลี่ยนชื่อคอลัมน์ไม่ใช่การเพิ่มแบบ additive
 * และกระทบหลายไฟล์พร้อมกัน — แปลงที่ชั้น boundary แทน แบบเดียวกับที่ทำกับ day/remarks/workType
 * มาตั้งแต่ Phase 5.1 ตารางสองตารางนี้คือแหล่งความจริงแหล่งเดียวของความต่างทั้งหมด
 */
/**
 * ⚠️ ระบบมี "ชื่อฟิลด์" อยู่ **สองชุด** ที่บังเอิญซ้ำกันบางตัว — อย่าไล่แก้ให้ตรงกันโดยไม่ย้ายข้อมูล
 *
 *   1. คีย์สารบัญ (ไฟล์นี้)   ใช้ตั้งค่าว่า "ฟิลด์นี้อยู่ช่องไหนในเอกสาร" เก็บลง `abbyy_skills.field_map`
 *   2. คีย์ผลลัพธ์             รูปแบบข้อมูลที่ตัวอ่านคืนออกมาและถูกเก็บลง `ai_reads.extraction.data`
 *
 * ตัวอย่างที่ซ้ำกันแต่คนละชุด: คีย์สารบัญ `documentSite` ↔ คีย์ผลลัพธ์ `site`,
 * `monthlyTotalHours` ↔ `totalHours`, `vendorName` ↔ `vendor`
 *
 * ตอนขยับเป็น V4 เราเปลี่ยนชื่อ **เฉพาะชุดที่ 1** ซึ่งถูกต้องแล้ว ถ้าวันหนึ่งมีคนคิดว่า "สารบัญเปลี่ยนเป็น
 * documentSite แล้ว ควรแก้ให้ตรงกันทุกที่" แล้วไปเปลี่ยนชุดที่ 2 ด้วย ข้อมูลที่เก็บไว้แล้วใน `ai_reads`
 * จะอ่านไม่ออกทันทีแบบเงียบๆ — เป็นความพังแบบเดียวกับที่เจอตอนเปลี่ยนคีย์ field_map แค่กลับด้าน
 *
 * (เคสจริงที่เคยหลุดเพราะสองชุดนี้: ingestService รับช่องผู้ให้บริการไว้ชื่อ `vendorName` ชุดเดียว
 * แต่ตัวอ่าน 3 ใน 4 เจ้าคืนมาเป็น `vendor` ทำให้ `timesheets.vendor_name` ว่างทุกแถวจนกว่าจะแก้)
 */
export const HEADER_SPEC_KEY_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  documentSite: 'site',
  monthlyTotalHours: 'totalHours',
  approvedByName: 'approverName',
});

/** แปลงคีย์ระดับเอกสารจากชื่อตามสเปก → ชื่อที่ระบบเก็บจริง (คีย์อื่นคืนค่าเดิม) */
export function toInternalHeaderKey(specKey: string): string {
  return HEADER_SPEC_KEY_ALIASES[specKey] ?? specKey;
}

/** ฟิลด์ระดับเอกสารทั้งหมด (หัวเอกสาร + ช่องสรุป + ลายเซ็น) — ใช้กับหน้าตั้งค่าและ `header` ของ TimesheetFieldMap */
export const TIMESHEET_DOCUMENT_FIELDS: TimesheetFieldSpec[] = [
  ...TIMESHEET_HEADER_FIELDS,
  ...TIMESHEET_SUMMARY_FIELDS,
  ...TIMESHEET_SIGNATURE_FIELDS,
];

const HEADER_BY_KEY = new Map(TIMESHEET_DOCUMENT_FIELDS.map((f) => [f.key, f]));
const DETAIL_BY_KEY = new Map(TIMESHEET_DETAIL_FIELDS.map((f) => [f.key, f]));

export function headerField(key: string): TimesheetFieldSpec | null {
  return HEADER_BY_KEY.get(key) ?? null;
}

export function detailField(key: string): TimesheetFieldSpec | null {
  return DETAIL_BY_KEY.get(key) ?? null;
}

/**
 * ผังชื่อฟิลด์ของตัวอ่านหนึ่งเจ้า → คีย์กลาง
 *
 * `header[canonicalKey] = 'ชื่อฟิลด์จริงในเครื่องอ่านเจ้านั้น'` และ `detail` เหมือนกันแต่เป็นคอลัมน์
 * ในตารางรายวัน — ค่า null แปลว่า "Skill/แม่แบบนี้ไม่มีฟิลด์นี้เลย" (ต่างจาก undefined ที่แปลว่า
 * ยังไม่ได้ตั้ง ให้ใช้ค่า default ของตัวอ่านนั้น) ความต่างนี้สำคัญ เพราะ "ไม่มีจริงๆ" ไม่ควรขึ้นเตือน
 * ว่าหาฟิลด์ไม่เจอ
 */
export interface TimesheetFieldMap {
  /** คีย์กลางระดับเอกสาร (TIMESHEET_DOCUMENT_FIELDS) → ชื่อฟิลด์จริงของตัวอ่านเจ้านั้น */
  header?: Record<string, string | null>;
  /** คีย์กลางระดับแถวรายวัน (TIMESHEET_DETAIL_FIELDS) → ชื่อคอลัมน์จริงในตารางของตัวอ่านเจ้านั้น */
  detail?: Record<string, string | null>;
  /** ชื่อตาราง/line item ของตัวอ่านเจ้านั้น (ABBYY เรียก "New Table", Clear Read ใช้ TimesheetDetails) */
  tableName?: string | null;
  /**
   * ฟอร์มที่แยก "เดือน" กับ "ปี" เป็นคนละช่อง (เจอจริงกับ Skill ของ Lotus) — ตั้งสองคีย์นี้แทน
   * `header.monthYear` แล้วตัวอ่านประกอบเป็นรอบเดือนเดียวกันให้
   *
   * อยู่แยกจาก `header` โดยตั้งใจ เพราะไม่ใช่ฟิลด์กลางคนละตัว แต่เป็น "สองช่องในเอกสารที่รวมกันแล้ว
   * ได้ฟิลด์กลาง monthYear ตัวเดิม" — ถ้าใส่เป็นคีย์กลางเพิ่มสองตัว ปลายทางจะต้องรู้เองว่าต้องเลือก
   * อ่านจาก monthYear หรือจาก month+year ซึ่งเป็นความรู้ที่ควรจบอยู่ในชั้น mapping ไม่ใช่ชั้นที่ใช้ค่า
   */
  monthYearSplit?: { month: string | null; year: string | null };
}
