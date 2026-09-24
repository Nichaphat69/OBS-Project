/** ผูกบัญชีไลน์ส่วนตัวของ admin/accounting — เหมือน employeeLineLinkService.ts ทุกอย่าง แค่คีย์ด้วย
 * username (User) แทน employeeId (Employee) เพราะ admin/accounting ไม่ผูกพนักงานเลย (24 ก.ย. 69
 * ตามที่ขอ — "เชื่อมต่อ LINE ครั้งแรก จะได้รู้ว่าคนที่แอดไลน์มาเป็น role อะไร รับแจ้งเตือนอะไรบ้าง")
 *
 * แยกไฟล์จาก employeeLineLinkService.ts โดยตั้งใจ ไม่รวมเป็นฟังก์ชันเดียวแล้วเช็ค role ข้างใน — กันเผลอ
 * ผูก Employee.lineUserId ทับของ role 'user' เข้ากับ User.lineUserId ของ admin/accounting สลับกัน */
import { randomInt } from 'node:crypto';
import { prisma } from '@obs/db';

export class StaffLineLinkError extends Error {
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

export async function getStaffLineLinkStatus(username: string): Promise<{ linked: boolean }> {
  const user = await prisma.user.findUnique({ where: { username }, select: { lineUserId: true } });
  if (!user) throw new StaffLineLinkError('ไม่พบบัญชีนี้', 404);
  return { linked: Boolean(user.lineUserId) };
}

export async function startStaffLineLink(username: string): Promise<StartLinkResult> {
  const user = await prisma.user.findUnique({ where: { username }, select: { username: true, lineUserId: true } });
  if (!user) throw new StaffLineLinkError('ไม่พบบัญชีนี้', 404);
  if (user.lineUserId) return { alreadyLinked: true, code: null };

  const code = `LINK-${String(randomInt(0, 1_000_000)).padStart(6, '0')}`;
  await prisma.user.update({
    where: { username },
    data: { lineLinkCode: code, lineLinkCodeExpiresAt: new Date(Date.now() + 10 * 60_000).toISOString() },
  });
  return { alreadyLinked: false, code };
}

/** ผูกไลน์ทางลัดผ่าน LINE Login — เหตุผลเดียวกับ linkEmployeeLineViaLogin() ดูคอมเมนต์ที่นั่น */
export async function linkStaffLineViaLogin(username: string, lineUserId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { username }, select: { username: true } });
  if (!user) throw new StaffLineLinkError('ไม่พบบัญชีนี้', 404);

  const takenBy = await prisma.user.findFirst({ where: { lineUserId, username: { not: username } }, select: { username: true } });
  if (takenBy) throw new StaffLineLinkError('บัญชีไลน์นี้ถูกผูกกับผู้ใช้คนอื่นไปแล้ว — ให้คนนั้นเลิกเชื่อมต่อก่อน', 409);

  await prisma.user.update({
    where: { username },
    data: { lineUserId, lineLinkCode: null, lineLinkCodeExpiresAt: null },
  });
}

export async function unlinkStaffLine(username: string): Promise<{ unlinked: true }> {
  const user = await prisma.user.findUnique({ where: { username }, select: { username: true } });
  if (!user) throw new StaffLineLinkError('ไม่พบบัญชีนี้', 404);

  await prisma.user.update({
    where: { username },
    data: { lineUserId: null, lineLinkCode: null, lineLinkCodeExpiresAt: null },
  });
  return { unlinked: true };
}
