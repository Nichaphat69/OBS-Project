/** ผูกบัญชีไลน์ส่วนตัวของพนักงาน — ported from service.js's startEmployeeLineLink/unlinkEmployeeLine.
 *
 * role 'user' กดจากหน้าของตัวเอง ออกรหัส 6 หลักอายุ 10 นาที ให้ส่งไปหา LINE OA ของบริษัทเอง
 * (ต้องแอดเป็นเพื่อนก่อน) — lineWebhookService.ts จับคู่รหัสนี้กับ userId ที่ส่งมาแล้วผูกให้อัตโนมัติ. */
import { randomInt } from 'node:crypto';
import { prisma } from '@obs/db';

export class EmployeeLineLinkError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export interface StartLinkResult {
  alreadyLinked: boolean;
  code: string | null;
}

/** ใหม่ (ไม่มีในต้นฉบับ — ของเดิมได้สถานะนี้มาจาก employeeProgress() ซึ่งยังไม่พอร์ต) ใช้แสดงสถานะ
 * ผูกไลน์ปัจจุบันตอนโหลดหน้า ก่อนกด "เชื่อมต่อไลน์" */
export async function getEmployeeLineLinkStatus(employeeId: string): Promise<{ linked: boolean }> {
  const employee = await prisma.employee.findUnique({ where: { id: employeeId }, select: { lineUserId: true } });
  if (!employee) throw new EmployeeLineLinkError('ไม่พบพนักงาน', 404);
  return { linked: Boolean(employee.lineUserId) };
}

export async function startEmployeeLineLink(employeeId: string): Promise<StartLinkResult> {
  const employee = await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true, lineUserId: true } });
  if (!employee) throw new EmployeeLineLinkError('ไม่พบพนักงาน', 404);
  if (employee.lineUserId) return { alreadyLinked: true, code: null };

  const code = `LINK-${String(randomInt(0, 1_000_000)).padStart(6, '0')}`;
  await prisma.employee.update({
    where: { id: employeeId },
    data: { lineLinkCode: code, lineLinkCodeExpiresAt: new Date(Date.now() + 10 * 60_000).toISOString() },
  });
  return { alreadyLinked: false, code };
}

/** ผูกไลน์ทางลัดผ่าน LINE Login (ดู lineLoginClient.ts) — sub ที่ได้มาจาก ID token ตรงกับ Messaging
 * userId อยู่แล้วเพราะ Account Link ผูกสอง channel ไว้ในหน้า Console เลยข้ามขั้นตอนรหัส 6 หลักได้
 * เช็คก่อนว่า lineUserId นี้ไม่ได้ผูกกับพนักงานคนอื่นอยู่แล้ว — ป้องกันกรณีพนักงานคนหนึ่งเผลอกดยืนยันด้วย
 * บัญชีไลน์ที่เพื่อนร่วมงานผูกไว้ก่อนหน้า (เช่น ใช้เครื่องเดียวกัน/แอดมินตั้งค่าไลน์ผิดคน) ไม่ให้ทับเงียบๆ */
export async function linkEmployeeLineViaLogin(employeeId: string, lineUserId: string): Promise<void> {
  const employee = await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true } });
  if (!employee) throw new EmployeeLineLinkError('ไม่พบพนักงาน', 404);

  const takenBy = await prisma.employee.findFirst({ where: { lineUserId, id: { not: employeeId } }, select: { id: true } });
  if (takenBy) throw new EmployeeLineLinkError('บัญชีไลน์นี้ถูกผูกกับพนักงานคนอื่นไปแล้ว — ให้คนนั้นเลิกเชื่อมต่อก่อน', 409);

  await prisma.employee.update({
    where: { id: employeeId },
    data: { lineUserId, lineLinkCode: null, lineLinkCodeExpiresAt: null },
  });
}

/** เลิกผูกบัญชีไลน์ — เผื่อผูกผิดคน/พนักงานเปลี่ยนเครื่อง ต้องผูกใหม่ */
export async function unlinkEmployeeLine(employeeId: string): Promise<{ unlinked: true }> {
  const employee = await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true } });
  if (!employee) throw new EmployeeLineLinkError('ไม่พบพนักงาน', 404);

  await prisma.employee.update({
    where: { id: employeeId },
    data: { lineUserId: null, lineLinkCode: null, lineLinkCodeExpiresAt: null },
  });
  return { unlinked: true };
}
