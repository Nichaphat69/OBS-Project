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
    key: 'approverName', name: 'Approver_Name', label: 'ชื่อผู้อนุมัติ',
    description:
      'Name of the person who approves the Timesheet, such as Approver, Approved By, Project Manager, or equivalent.',
    type: 'text', examples: ['Nichaphat Chokrak', 'Supranee Suwannates'],
  },
  {
    key: 'site', name: 'Site', label: 'สถานที่ปฏิบัติงาน (ระดับเอกสาร)',
    description:
      'Site, customer site, office, branch, location name, or work site associated with the specific record when '
      + 'explicitly shown. This describes the site itself, not remote/on-site working arrangement.',
    type: 'text', examples: ['Office', 'Bangkok', 'PTT', 'Head Office', 'Branch 01', 'Building A'],
  },
  {
    key: 'projectTeam', name: 'Project_Team', label: 'ทีมโครงการ',
    description: 'Project team, squad, group, or work team when explicitly shown.',
    type: 'text', examples: ['Team A', 'Development Team', 'Project Team 1'],
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
    key: 'site', name: 'Site', label: 'สถานที่ (รายวัน)',
    description: 'Daily customer/site/office/branch associated with the row when explicitly shown.',
    type: 'text', examples: ['Office', 'PTT', 'Bangkok', 'Head Office', 'Branch 01'],
  },
  {
    key: 'workLocation', name: 'Work_Location', label: 'รูปแบบการทำงาน',
    description:
      'Working arrangement or physical working location, distinct from Site. Use only when explicitly stated.',
    type: 'text', examples: ['WFH', 'Remote', 'On-site', 'Office', 'Customer Site'],
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
    key: 'totalHours', name: 'Total_Hours', label: 'ชั่วโมงรวม',
    description:
      'Total duration reported for the row. Map Total, Total per day, Working Hrs., Duration as hour, or equivalent '
      + 'when the source reports it. Do not calculate it yourself.',
    type: 'number', examples: ['8', '8.00', '9.5', '160.00'],
  },
  {
    key: 'additionalHours', name: 'Additional_Hours', label: 'ชั่วโมง/แมนเดย์เพิ่มเติม',
    description:
      'Additional hours or additional man-day explicitly reported by the source. Do not treat this as overtime '
      + 'unless the source explicitly identifies it as OT.',
    type: 'number', examples: ['0', '0.5', '1'],
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
    description: 'Remark, note, or status text for the row when the source provides it separately.',
    type: 'text', examples: ['Approved', 'Pending', 'Remark A', 'N/A'],
  },
];

/** ชื่อ line item ของตารางรายวันตามสเปกกลาง — ตัวอ่านที่รองรับ line item ต้องใช้ชื่อนี้ */
export const TIMESHEET_DETAIL_LINE_ITEM = 'TimesheetDetails';

const HEADER_BY_KEY = new Map(TIMESHEET_HEADER_FIELDS.map((f) => [f.key, f]));
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
  header?: Record<string, string | null>;
  detail?: Record<string, string | null>;
  /** ชื่อตาราง/line item ของตัวอ่านเจ้านั้น (ABBYY เรียก "New Table", Clear Read ใช้ TimesheetDetails) */
  tableName?: string | null;
}
