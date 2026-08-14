/**
 * ยืนยันตัวตนคนใช้ระบบ — login ด้วยรหัสผ่านที่เก็บเอง ไม่ผูก SSO
 *
 * ทำไมไม่ต่อ Google/SSO ตอนนี้ — ทีมยังเล็ก ยังไม่ได้ตัดสินว่าจะใช้ Google Workspace
 * หรือระบบไหนของบริษัท เก็บรหัสผ่านเองไปก่อนแบบเบาที่สุด (scrypt + session cookie
 * ธรรมดา ไม่มี dependency เพิ่ม) ย้ายไป SSO ทีหลังได้โดยไม่กระทบ audit log เดิม
 * เพราะทุกจุดอ้าง actor ด้วย name_th อยู่แล้ว ไม่ใช่ username
 *
 * เดิมระบบใช้ env ACTOR ตัวเดียวสำหรับทั้งเซิร์ฟเวอร์ (ทุกคนที่เปิดเว็บกลายเป็นคนเดียวกัน
 * ในบันทึก) ที่นี่แทนที่ด้วย session ต่อคนจริง — คนละคนคนละชื่อในบันทึกทุกครั้ง
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { all, get, run, logAudit } from './db/index.js';

export const SESSION_COOKIE = 'obs_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 วัน — เครื่องมือใช้ภายใน ไม่ต้อง login ถี่
const SCRYPT_KEYLEN = 64;

/**
 * admin แก้ข้อมูลหลักได้ (เรทพนักงาน สัญญา ชื่อพ้อง วันหยุด) + จัดการบัญชีผู้ใช้คนอื่น
 * user  ทำงานประจำวันได้หมด (อัปโหลด Timesheet, ตรวจ Manday, อนุมัติวางบิล, ร่างอีเมล)
 *       แต่แก้ข้อมูลหลักไม่ได้ — กันไม่ให้เรท/สัญญาถูกเปลี่ยนโดยไม่ตั้งใจ กระทบทุกใบในอนาคต
 *
 * ตั้งใจให้มีแค่ 2 role นี้เท่านั้น — Employee (พนักงานที่มี Timesheet เช่น Sunee/Pongpun)
 * เป็นข้อมูลในตาราง employees ไม่ใช่บัญชี login จึงไม่มี role ของตัวเอง และไม่ต้องเพิ่ม
 * role อื่น (approver/manager/accountant) จนกว่าจะมี workflow ที่ต้องแยกสิทธิ์จริงๆ
 */
export const ROLES = ['admin', 'user'];

function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return { salt, hash };
}

export function hasAnyUser() {
  return Boolean(get('SELECT 1 FROM users LIMIT 1'));
}

/**
 * สร้างผู้ใช้ใหม่ — เรียกได้สองทาง: `scripts/create-user.js` (ตอนยังไม่มีใครในระบบ)
 * และ `POST /api/users` (admin เพิ่มคนใหม่จากหน้า "จัดการระบบ" — server.js บังคับ requireAdmin ก่อนเรียก)
 */
export function createUser({ username, nameTh, password, role = 'user', actor = 'cli' }) {
  if (!username || !nameTh || !password) {
    throw Object.assign(new Error('ต้องระบุ username, ชื่อ, และรหัสผ่านให้ครบ'), { status: 400 });
  }
  if (password.length < 8) {
    throw Object.assign(new Error('รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร'), { status: 400 });
  }
  if (!ROLES.includes(role)) {
    throw Object.assign(new Error(`role ต้องเป็น ${ROLES.join(' หรือ ')} เท่านั้น`), { status: 400 });
  }
  if (get('SELECT username FROM users WHERE username = $username', { username })) {
    throw Object.assign(new Error(`มีผู้ใช้ชื่อ "${username}" อยู่แล้ว`), { status: 409 });
  }

  const { salt, hash } = hashPassword(password);
  run(
    `INSERT INTO users (username, name_th, role, password_salt, password_hash)
     VALUES ($username, $nameTh, $role, $salt, $hash)`,
    { username, nameTh, role, salt, hash },
  );
  logAudit({ actor, action: 'create_user', entityType: 'user', entityId: username, detail: { nameTh, role } });
  return { username, nameTh, role, active: true };
}

/** รายชื่อผู้ใช้ทั้งหมด — สำหรับหน้า "จัดการระบบ → ผู้ใช้" ไม่คืนรหัสผ่าน/salt ออกไปเด็ดขาด */
export function listUsers() {
  return all('SELECT username, name_th, role, active, created_at FROM users ORDER BY username')
    .map((u) => ({ ...u, active: Boolean(u.active) }));
}

/** เปลี่ยน role ของผู้ใช้ที่มีอยู่แล้ว */
export function updateUserRole(username, role, { actor = 'cli' } = {}) {
  if (!ROLES.includes(role)) {
    throw Object.assign(new Error(`role ต้องเป็น ${ROLES.join(' หรือ ')} เท่านั้น`), { status: 400 });
  }
  const user = get('SELECT username, name_th FROM users WHERE username = $username', { username });
  if (!user) throw Object.assign(new Error(`ไม่พบผู้ใช้ "${username}"`), { status: 404 });

  run('UPDATE users SET role = $role WHERE username = $username', { username, role });
  logAudit({ actor, action: 'update_user_role', entityType: 'user', entityId: username, detail: { role } });
  return { username, nameTh: user.name_th, role };
}

/**
 * ตั้งรหัสผ่านใหม่ให้ผู้ใช้ที่มีอยู่แล้ว — ใช้ตอนลืมรหัสผ่านเดิม
 * ปิดใช้งาน (setUserActive) แล้วสร้างใหม่ไม่ได้ผลจริง เพราะ username ซ้ำกับที่ปิดไว้ยังชนกันอยู่
 * (soft-delete ไม่ปลดชื่อผู้ใช้ให้ใช้ซ้ำได้) จึงต้องมีฟังก์ชันนี้แยกไว้ต่างหาก
 * เซสชันเดิมที่ล็อกอินไว้ก่อนหน้าจะถูกเลิกทั้งหมด — ต้อง login ใหม่ด้วยรหัสใหม่
 */
export function resetPassword(username, newPassword, { actor = 'cli' } = {}) {
  if (!newPassword || newPassword.length < 8) {
    throw Object.assign(new Error('รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร'), { status: 400 });
  }
  const user = get('SELECT username, name_th FROM users WHERE username = $username', { username });
  if (!user) throw Object.assign(new Error(`ไม่พบผู้ใช้ "${username}"`), { status: 404 });

  const { salt, hash } = hashPassword(newPassword);
  run(
    'UPDATE users SET password_salt = $salt, password_hash = $hash WHERE username = $username',
    { username, salt, hash },
  );
  run('DELETE FROM sessions WHERE username = $username', { username });
  logAudit({ actor, action: 'reset_password', entityType: 'user', entityId: username, detail: {} });
  return { username, nameTh: user.name_th };
}

/**
 * เปิด/ปิดการใช้งานผู้ใช้ — ปิดแทนการลบ เพราะ audit_log และ sessions ยังอ้าง username นี้อยู่
 * ปิดแล้ว login ไม่ได้ทันที (verifyLogin เช็ค active) และ session เดิมที่ค้างอยู่จะถูกลบด้วย
 */
export function setUserActive(username, active, { actor = 'cli' } = {}) {
  const user = get('SELECT username, name_th FROM users WHERE username = $username', { username });
  if (!user) throw Object.assign(new Error(`ไม่พบผู้ใช้ "${username}"`), { status: 404 });

  run('UPDATE users SET active = $active WHERE username = $username', { username, active: active ? 1 : 0 });
  if (!active) run('DELETE FROM sessions WHERE username = $username', { username });
  logAudit({ actor, action: 'set_user_active', entityType: 'user', entityId: username, detail: { active: Boolean(active) } });
  return { username, nameTh: user.name_th, active: Boolean(active) };
}

/**
 * ลบผู้ใช้ทิ้งจริง (hard delete) — ต่างจาก setUserActive ที่แค่ปิดใช้งาน
 * ปลอดภัยที่จะลบเพราะ audit_log เก็บ actor เป็น name_th (ข้อความ) ไม่ใช่ username ที่อ้างอิงกลับมา
 * sessions ผูก FK ON DELETE CASCADE ไว้แล้ว ลบ user แล้วเซสชันที่ค้างอยู่หายไปเอง
 * มีไว้เพื่อให้เอา username ที่พิมพ์ผิด/บัญชีทดสอบออกไปใช้ซ้ำได้จริง (ปิดใช้งานอย่างเดียวทำไม่ได้ ดู resetPassword)
 */
export function deleteUser(username, { actor = 'cli' } = {}) {
  const user = get('SELECT username, name_th FROM users WHERE username = $username', { username });
  if (!user) throw Object.assign(new Error(`ไม่พบผู้ใช้ "${username}"`), { status: 404 });

  run('DELETE FROM users WHERE username = $username', { username });
  logAudit({ actor, action: 'delete_user', entityType: 'user', entityId: username, detail: { nameTh: user.name_th } });
  return { username, nameTh: user.name_th };
}

/** ตรวจ username/password — คืน null ถ้าไม่ตรงหรือถูกปิดใช้งาน (ไม่บอกว่าผิดที่จุดไหน) */
export function verifyLogin(username, password) {
  const user = get('SELECT * FROM users WHERE username = $username', { username });
  if (!user || !user.active) return null;

  const candidate = scryptSync(password, user.password_salt, SCRYPT_KEYLEN);
  const stored = Buffer.from(user.password_hash, 'hex');
  if (candidate.length !== stored.length || !timingSafeEqual(candidate, stored)) return null;

  return { username: user.username, nameTh: user.name_th, role: user.role };
}

export function createSession(username) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  run(
    'INSERT INTO sessions (token, username, expires_at) VALUES ($token, $username, $expiresAt)',
    { token, username, expiresAt },
  );
  return { token, expiresAt };
}

/** คืนข้อมูลผู้ใช้ของ session นี้ หรือ null ถ้าไม่มี/หมดอายุแล้ว (ลบทิ้งให้เลยถ้าหมดอายุ) */
export function resolveSession(token) {
  if (!token) return null;
  const row = get(
    `SELECT s.token, s.expires_at, u.username, u.name_th, u.role
       FROM sessions s JOIN users u ON u.username = s.username
      WHERE s.token = $token AND u.active = 1`,
    { token },
  );
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    destroySession(token);
    return null;
  }
  return { username: row.username, nameTh: row.name_th, role: row.role };
}

export function destroySession(token) {
  if (token) run('DELETE FROM sessions WHERE token = $token', { token });
}

/** Node ไม่มีตัวแยก Cookie header ให้ในตัว — คั่นด้วย "; " ตามสเปก */
export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
