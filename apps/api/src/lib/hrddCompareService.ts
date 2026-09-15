/**
 * เทียบวันลาที่ Timesheet รายงานกับวันลาที่อนุมัติแล้วจริงใน HRDD — ported from src/service.js's
 * `compareLeavesWithHrdd`/`checkTimesheetAgainstHrdd`/`checkLeavesAgainstHrdd`.
 *
 * ไม่มีผลข้างเคียงใดๆกับ HRDD — เรียกแค่ endpoint อ่านข้อมูล (สถานะวันลา + รายการวันลา) ไม่มีเขียน/แก้/
 * ลบฝั่ง HRDD เด็ดขาด (ดู hrddClient.ts)
 */
import { prisma } from '@obs/db';
import { matchEmployee, compareLeaves, summarizeLeaveComparison, type LeaveCompareRow, type LeaveCompareSummary } from '@obs/domain';
import { employeesForMatching } from './masterData.js';
import { getTimesheet } from './timesheetsService.js';
import { HrddClient, hasHrddCredentials, HrddError } from './hrddClient.js';

export class HrddCompareError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export type HrddCompareResult =
  | { state: 'not_connected'; message: string }
  | { state: 'error'; message: string }
  | { state: 'match' | 'diff'; period: string; employeeName: string; rows: LeaveCompareRow[]; summary: LeaveCompareSummary; checkedAt: string };

/** ตัดชื่อเล่นในวงเล็บที่ HRDD แปะท้าย requestName เช่น "Pongpun Mamak ( Ford )" — ไม่ตัดออก
 * matchEmployee จะเจอ "(" ปนอยู่ในชื่อแล้วจับคู่ไม่ติด */
function stripHrddNickname(name: string | null | undefined): string {
  return String(name ?? '').replace(/\(.*?\)/g, '').trim();
}

/** รหัสสถานะที่แปลว่า "อนุมัติแล้ว" ของบริษัทนี้ใน HRDD — เป็นข้อมูลที่บริษัทตั้งเอง จึงต้องถามใหม่ทุก
 * ครั้ง ห้ามจำรหัสจากบริษัทหนึ่งไปใช้กับอีกบริษัท หาแถวที่ชื่อสถานะเป็น "approve" ก่อน ไม่เจอเป๊ะๆ ค่อยเดา
 * จากสถานะที่ไม่ใช่รอ/ตีกลับ/ยกเลิก */
async function resolveHrddApprovedStatusCodes(client: HrddClient): Promise<string[]> {
  let statuses;
  try {
    statuses = await client.findLeaveStatuses();
  } catch {
    return [];
  }
  if (!Array.isArray(statuses) || !statuses.length) return [];

  const approved = statuses.filter((s) => /approve/i.test(s.name ?? ''));
  if (approved.length) return approved.map((s) => s.code);

  return statuses.filter((s) => !/wait|pending|reject|cancel/i.test(s.name ?? '')).map((s) => s.code);
}

/**
 * แกนกลางเทียบวันลากับ HRDD — ใช้ทั้งจาก Timesheet ที่บันทึกเข้าระบบแล้ว (checkTimesheetAgainstHrdd)
 * และจากหน้ารีวิวก่อนบันทึกใน "อัปโหลด Timesheet" (checkLeavesAgainstHrdd) ที่ยังไม่มี timesheetId
 *
 * จับคู่ "พนักงานคนไหนในบริษัท" ด้วยชื่อ (ไม่ใช่ employeeCode) เพราะ endpoint ของ HRDD ที่ใช้
 * (POST /leavetransaction/findByCompany) ไม่คืนค่า employeeCode มาให้เลย ใช้ requestName เทียบผ่าน
 * matchEmployee() ตัวเดียวกับที่จับคู่ชื่อจาก Timesheet อยู่แล้ว
 */
async function compareLeavesWithHrdd({
  employeeId,
  employeeName,
  period,
  tsLeaves,
}: {
  employeeId: string;
  employeeName: string;
  period: string;
  tsLeaves: Array<{ date: string; type?: string | null }>;
}): Promise<HrddCompareResult> {
  if (!hasHrddCredentials()) {
    return { state: 'not_connected', message: 'ยังไม่ได้เชื่อมต่อ HRDD — ใส่ HRDD_BASE_URL/HRDD_USERNAME/HRDD_PASSWORD ใน .env' };
  }

  const [year, month] = period.split('-').map(Number);
  const dateFrom = `${period}-01`;
  const dateTo = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);

  const client = new HrddClient({});
  let companyLeaves;
  try {
    const statusCodes = await resolveHrddApprovedStatusCodes(client);
    companyLeaves = await client.findLeavesByCompany({ dateFrom, dateTo, status: statusCodes });
  } catch (error: any) {
    const message = error instanceof HrddError ? error.message : `เชื่อมต่อ HRDD ไม่สำเร็จ: ${error.message}`;
    return { state: 'error', message };
  }

  const employees = await employeesForMatching();
  const hrddLeaves = companyLeaves.filter((rec) => {
    const result = matchEmployee(stripHrddNickname(rec.requestName), employees);
    return result.employee?.id === employeeId;
  });

  const rows = compareLeaves(tsLeaves as any, hrddLeaves as any);
  const summary = summarizeLeaveComparison(rows);

  return {
    state: summary.mismatched > 0 ? 'diff' : 'match',
    period,
    employeeName,
    rows,
    summary,
    checkedAt: new Date().toISOString(),
  };
}

/** เทียบวันลาของ Timesheet ที่บันทึกเข้าระบบแล้ว — ใช้ข้อมูลวันลาที่เก็บไว้ตอนยืนยัน */
export async function checkTimesheetAgainstHrdd(timesheetId: string): Promise<HrddCompareResult> {
  const sheet = await getTimesheet(timesheetId);
  if (!sheet) throw new HrddCompareError(`ไม่พบ Timesheet ${timesheetId}`, 404);

  const tsLeaves = sheet.leaveDays.map((d) => ({ date: d.date, type: d.leaveType }));
  return compareLeavesWithHrdd({
    employeeId: sheet.employee.id!,
    employeeName: sheet.employee.nameTh!,
    period: sheet.period,
    tsLeaves,
  });
}

/**
 * เทียบวันลาตอนยัง "รีวิวก่อนบันทึก" ในหน้าอัปโหลด Timesheet — ยังไม่มี timesheetId เพราะยังไม่ได้
 * ยืนยันเข้าระบบ ใช้ employeeId ที่จับคู่ได้กับ period/วันลาที่เห็นอยู่บนจอตอนนี้แทน (คนแก้ตารางวันลา
 * บนจอได้ก่อนกดยืนยัน ผลเทียบจึงต้องอิงค่าล่าสุดบนจอ)
 */
export async function checkLeavesAgainstHrdd({
  employeeId,
  period,
  leaveDays = [],
}: {
  employeeId: string;
  period: string;
  leaveDays?: Array<{ date: string; type?: string | null }>;
}): Promise<HrddCompareResult> {
  const employee = await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true, nameTh: true } });
  if (!employee) throw new HrddCompareError('ไม่พบพนักงานนี้', 404);
  if (!/^\d{4}-\d{2}$/.test(period ?? '')) throw new HrddCompareError('รอบเดือนไม่ถูกต้อง', 400);

  const tsLeaves = leaveDays.map((d) => ({ date: d.date, type: d.type }));
  return compareLeavesWithHrdd({ employeeId, employeeName: employee.nameTh!, period, tsLeaves });
}
