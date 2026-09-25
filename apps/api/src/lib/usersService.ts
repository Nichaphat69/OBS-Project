/**
 * จัดการผู้ใช้ (admin) — ported from src/auth.js's createUser/listUsers/updateUserRole/
 * updateUserEmployee/setUserActive/deleteUser/resetPassword.
 *
 * Not ported (per file's own original scope): registerUser/requestPasswordReset/
 * verifyResetCode/resetPasswordWithToken/findOrCreateGoogleUser — self-service auth flows,
 * deferred per MIGRATION_PLAN.md Phase 5.4.
 */
import { randomBytes, scryptSync } from 'node:crypto';
import { prisma } from '@obs/db';
import { logAudit } from './audit.js';

export const ROLES = ['admin', 'accounting', 'user', 'executive'];
const SCRYPT_KEYLEN = 64;

export class UserActionError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function hashSecret(secret: string): { salt: string; hash: string } {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(secret, salt, SCRYPT_KEYLEN).toString('hex');
  return { salt, hash };
}

export interface UserRow {
  username: string;
  nameTh: string;
  nameEn: string | null;
  role: string;
  employeeId: string | null;
  email: string | null;
  selfRegistered: boolean;
  active: boolean;
  createdAt: string;
  /** ผูก LINE แล้วหรือยัง — เพิ่มทีหลัง (25 ก.ย. 69 ตามที่ขอ "ทุก role ต้องแสดงสถานะด้วยว่าคนนี้เชื่อม
   * ต่อ line แล้ว") เดิมมีแยกอยู่แค่ในตาราง "ผู้รับแจ้งเตือน" และเห็นเฉพาะ admin/accounting เท่านั้น
   * (listStaffLineStatus() ที่ notificationRecipientsService.ts) รวมเข้ามาที่นี่ให้ครบทุก role รวม
   * role 'user' ด้วย — ⚠️ role 'user' ผูกไลน์ผ่าน Employee.lineUserId คนละคอลัมน์กับ admin/accounting/
   * executive ที่ผูกที่ User.lineUserId เอง (ดู staffLineLinkService.ts vs employeeLineLinkService.ts) */
  lineLinked: boolean;
}

/** ported from auth.js listUsers() — never returns salt/hash */
export async function listUsers(): Promise<UserRow[]> {
  const rows = await prisma.user.findMany({
    orderBy: { username: 'asc' },
    select: {
      username: true,
      nameTh: true,
      nameEn: true,
      role: true,
      employeeId: true,
      email: true,
      selfRegistered: true,
      active: true,
      createdAt: true,
      lineUserId: true,
    },
  });

  const employeeIds = rows.filter((r) => r.role === 'user' && r.employeeId).map((r) => r.employeeId!);
  const employeeLineMap = new Map<string, boolean>();
  if (employeeIds.length > 0) {
    const employees = await prisma.employee.findMany({
      where: { id: { in: employeeIds } },
      select: { id: true, lineUserId: true },
    });
    for (const e of employees) employeeLineMap.set(e.id, Boolean(e.lineUserId));
  }

  return rows.map((r) => ({
    username: r.username,
    nameTh: r.nameTh,
    nameEn: r.nameEn,
    role: r.role,
    employeeId: r.employeeId,
    email: r.email,
    selfRegistered: r.selfRegistered,
    active: r.active,
    createdAt: r.createdAt,
    lineLinked: r.role === 'user' ? (r.employeeId ? employeeLineMap.get(r.employeeId) ?? false : false) : Boolean(r.lineUserId),
  }));
}

/** ported from auth.js createUser() — เพิ่ม nameEn (optional) ให้ครบเหมือน Employee (15 ก.ย. 69) */
export async function createUser({
  username,
  nameTh,
  nameEn = null,
  password,
  role = 'user',
  employeeId = null,
  actor,
}: {
  username: string;
  nameTh: string;
  nameEn?: string | null;
  password: string;
  role?: string;
  employeeId?: string | null;
  actor: string;
}): Promise<UserRow> {
  if (!username || !nameTh || !password) throw new UserActionError('ต้องระบุ username, ชื่อ และรหัสผ่าน');
  if (password.length < 8) throw new UserActionError('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร');
  if (!ROLES.includes(role)) throw new UserActionError(`role ต้องเป็นหนึ่งใน ${ROLES.join(', ')}`);

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) throw new UserActionError('มี username นี้อยู่แล้ว', 409);

  const { salt, hash } = hashSecret(password);
  const effectiveEmployeeId = role === 'user' ? employeeId : null;
  const createdAt = new Date().toISOString();
  const trimmedNameEn = nameEn?.trim() || null;

  const user = await prisma.user.create({
    data: {
      username,
      nameTh,
      nameEn: trimmedNameEn,
      role,
      employeeId: effectiveEmployeeId,
      passwordSalt: salt,
      passwordHash: hash,
      active: true,
      createdAt,
    },
  });

  await logAudit({ actor, action: 'create_user', entityType: 'user', entityId: username, detail: { nameTh, nameEn: trimmedNameEn, role, employeeId: effectiveEmployeeId } });

  return {
    username: user.username,
    nameTh: user.nameTh,
    nameEn: user.nameEn,
    role: user.role,
    employeeId: user.employeeId,
    email: user.email,
    selfRegistered: user.selfRegistered,
    active: user.active,
    createdAt: user.createdAt,
    lineLinked: false,
  };
}

/** ใหม่ (ไม่มีในต้นฉบับ — ของเดิมไม่มีทางแก้ชื่อผู้ใช้หลังสร้างแล้วเลยแม้แต่ nameTh) เพิ่มเพื่อให้แก้/เพิ่ม
 * nameEn ให้บัญชีที่มีอยู่แล้วได้ (15 ก.ย. 69 ตามที่ user ขอ) — nameTh ยังคงบังคับห้ามว่าง (ใช้แสดงใน
 * บันทึกอนุมัติ/audit log ทั่วระบบอยู่แล้ว) ส่วน nameEn ใส่ null ได้ถ้าต้องการล้างค่า */
export async function updateUserNames(
  username: string,
  { nameTh, nameEn }: { nameTh?: string; nameEn?: string | null },
  { actor }: { actor: string },
) {
  await getUserOrThrow(username);
  if (nameTh !== undefined && !nameTh.trim()) throw new UserActionError('ต้องระบุชื่อ (ภาษาไทย) ห้ามเว้นว่าง');

  const data: { nameTh?: string; nameEn?: string | null } = {};
  if (nameTh !== undefined) data.nameTh = nameTh.trim();
  if (nameEn !== undefined) data.nameEn = nameEn?.trim() || null;

  await prisma.user.update({ where: { username }, data });
  await logAudit({ actor, action: 'update_user_names', entityType: 'user', entityId: username, detail: data });
}

async function getUserOrThrow(username: string) {
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) throw new UserActionError(`ไม่พบผู้ใช้ ${username}`, 404);
  return user;
}

/** ported from auth.js updateUserRole() — เปลี่ยน role อื่นนอกจาก user จะเลิกผูกพนักงานทันที */
export async function updateUserRole(username: string, role: string, { actor }: { actor: string }) {
  if (!ROLES.includes(role)) throw new UserActionError(`role ต้องเป็นหนึ่งใน ${ROLES.join(', ')}`);
  await getUserOrThrow(username);

  await prisma.user.update({
    where: { username },
    data: { role, employeeId: role === 'user' ? undefined : null },
  });
  await logAudit({ actor, action: 'update_user_role', entityType: 'user', entityId: username, detail: { role } });
}

/** ported from auth.js updateUserEmployee() */
export async function updateUserEmployee(username: string, employeeId: string | null, { actor }: { actor: string }) {
  const user = await getUserOrThrow(username);
  if (user.role !== 'user') throw new UserActionError('ผูกพนักงานได้เฉพาะบัญชี role "user" เท่านั้น');

  await prisma.user.update({ where: { username }, data: { employeeId } });
  await logAudit({ actor, action: 'update_user_employee', entityType: 'user', entityId: username, detail: { employeeId } });
}

/** ported from auth.js setUserActive() — ปิดใช้งาน = ล้าง session ทั้งหมดทันที */
export async function setUserActive(username: string, active: boolean, { actor }: { actor: string }) {
  await getUserOrThrow(username);

  await prisma.user.update({ where: { username }, data: { active } });
  if (!active) await prisma.session.deleteMany({ where: { username } });
  await logAudit({ actor, action: 'set_user_active', entityType: 'user', entityId: username, detail: { active } });
}

/** ported from auth.js deleteUser() — sessions ลบตามด้วย FK cascade */
export async function deleteUser(username: string, { actor }: { actor: string }) {
  const user = await getUserOrThrow(username);
  await prisma.user.delete({ where: { username } });
  await logAudit({ actor, action: 'delete_user', entityType: 'user', entityId: username, detail: { nameTh: user.nameTh } });
}

/** ported from auth.js resetPassword() — ไม่มี HTTP route ในต้นฉบับ (CLI/forgot-password เท่านั้น)
 * เพิ่มเป็นปุ่ม admin ในพอร์ตนี้ ใช้ validation/side-effect เดิมทุกจุด */
export async function resetPassword(username: string, newPassword: string, { actor }: { actor: string }) {
  if (newPassword.length < 8) throw new UserActionError('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร');
  await getUserOrThrow(username);

  const { salt, hash } = hashSecret(newPassword);
  await prisma.user.update({ where: { username }, data: { passwordSalt: salt, passwordHash: hash } });
  await prisma.session.deleteMany({ where: { username } });
  await logAudit({ actor, action: 'reset_password', entityType: 'user', entityId: username, detail: {} });
}
