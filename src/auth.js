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

import { randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import { all, get, run, logAudit } from './db/index.js';

export const SESSION_COOKIE = 'obs_session';
/* "จดจำฉัน" ติ๊ก (ค่าเริ่มต้น) = 30 วัน เหมือนเดิม — ไม่ติ๊ก (เครื่องที่ไม่ใช่ของตัวเอง) = 12 ชั่วโมง
   (31 ส.ค. 69 ตามที่ขอ) */
const SESSION_TTL_REMEMBER_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_TTL_DEFAULT_MS = 12 * 60 * 60 * 1000;
const SCRYPT_KEYLEN = 64;
const RESET_CODE_TTL_MS = 10 * 60 * 1000;    // รหัส 6 หลักตอนลืมรหัสผ่าน อยู่ได้ 10 นาที
const RESET_TOKEN_TTL_MS = 10 * 60 * 1000;   // token หลังยืนยันรหัสผ่านแล้ว อยู่ได้อีก 10 นาที
const RESET_CODE_MAX_ATTEMPTS = 5;           // กรอกรหัสผิดเกินนี้ต้องขอรหัสใหม่

/**
 * admin      แก้ข้อมูลหลักได้ (เรทพนักงาน สัญญา ชื่อพ้อง วันหยุด) + จัดการบัญชีผู้ใช้คนอื่น +
 *            จัดการ Skill ABBYY (เพิ่ม/ลบ Skill ID ใหม่) — สิทธิ์เต็มทุกอย่าง
 * accounting ทำได้ทุกอย่างเหมือน admin เป๊ะ ยกเว้นจัดการ Skill ABBYY (เลือกใช้ Skill ที่มีอยู่แล้ว
 *            ให้แต่ละสัญญาได้ แต่กำหนด/เพิ่ม Skill ใหม่ไม่ได้) — ดู requireAdmin/requireSuperAdmin
 *            ที่ src/server.js
 * user       "พนักงาน" (31 ส.ค. 69 ตามที่ขอ เปลี่ยนความหมายจากเดิมที่เคยทำงานประจำวันได้ทุกอย่าง
 *            เหมือน admin — ตอนนี้ตัดสิทธิ์นั้นไปให้ role 'accounting' แทนแล้ว) เห็นได้แค่ความคืบหน้า
 *            รอบบิลของตัวเอง (ผูกกับ employee_id) + อัปโหลด/ยืนยัน Timesheet ของตัวเองได้ แต่กด
 *            ตรวจ/ตีกลับ/อนุมัติวางบิลเองไม่ได้ ต้องรอ admin/accounting ตรวจซ้ำที่หน้า "ตรวจ Manday"
 *            เสมอ (ดู requireAdmin ที่ route /timesheets/:id/check เป็นด่านหลัก)
 * executive  ดูภาพรวมทุกบริษัทพร้อมกันได้ (ไม่ใช่ทีละบริษัทแบบปกติ) + แจ้งเตือนสัญญา/พนักงานใหม่ทางกระดิ่ง
 *            แต่เป็น read-only ล้วนๆ ทำรายการอะไรไม่ได้เลยสักจุด (ดู requireNotExecutive/isStaff)
 *
 * users.employee_id ผูกบัญชี role 'user' เข้ากับพนักงานในตาราง employees (nullable — role อื่น
 * ไม่ต้องผูก) ให้รู้ว่า "ของตัวเอง" คือของใคร ตอนกรองหน้าความคืบหน้าส่วนตัว
 */
export const ROLES = ['admin', 'accounting', 'user', 'executive'];

/** scrypt แฮชค่าลับ — ใช้ทั้งรหัสผ่านจริงและรหัสยืนยัน 6 หลักตอนลืมรหัสผ่าน (ค่าไหนก็ไม่เก็บดิบ) */
function hashSecret(value, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(value, salt, SCRYPT_KEYLEN).toString('hex');
  return { salt, hash };
}

function secretMatches(candidate, salt, hash) {
  if (!salt || !hash) return false;
  const candidateHash = scryptSync(candidate, salt, SCRYPT_KEYLEN);
  const stored = Buffer.from(hash, 'hex');
  return candidateHash.length === stored.length && timingSafeEqual(candidateHash, stored);
}

/** หาโดย email จริง หรือ username ที่เป็นอีเมลอยู่แล้ว (บัญชีเก่าก่อนมีคอลัมน์ email ทั้งหมด) */
function findUserByLoginEmail(email) {
  return get(
    'SELECT * FROM users WHERE lower(email) = lower($email) OR lower(username) = lower($email)',
    { email },
  );
}

export function hasAnyUser() {
  return Boolean(get('SELECT 1 FROM users LIMIT 1'));
}

/**
 * สร้างผู้ใช้ใหม่ — เรียกได้สองทาง: `scripts/create-user.js` (ตอนยังไม่มีใครในระบบ)
 * และ `POST /api/users` (admin เพิ่มคนใหม่จากหน้า "จัดการระบบ" — server.js บังคับ requireAdmin ก่อนเรียก)
 */
export function createUser({ username, nameTh, password, role = 'user', employeeId = null, actor = 'cli' }) {
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

  const { salt, hash } = hashSecret(password);
  run(
    `INSERT INTO users (username, name_th, role, employee_id, password_salt, password_hash)
     VALUES ($username, $nameTh, $role, $employeeId, $salt, $hash)`,
    { username, nameTh, role, employeeId: role === 'user' ? employeeId : null, salt, hash },
  );
  logAudit({ actor, action: 'create_user', entityType: 'user', entityId: username, detail: { nameTh, role, employeeId } });
  return { username, nameTh, role, employeeId, active: true };
}

/** รายชื่อผู้ใช้ทั้งหมด — สำหรับหน้า "จัดการระบบ → ผู้ใช้" ไม่คืนรหัสผ่าน/salt ออกไปเด็ดขาด */
export function listUsers() {
  return all(
    `SELECT username, name_th, role, employee_id, email, self_registered, active, created_at
       FROM users ORDER BY username`,
  ).map((u) => ({ ...u, active: Boolean(u.active), selfRegistered: Boolean(u.self_registered) }));
}

/** เปลี่ยน role ของผู้ใช้ที่มีอยู่แล้ว — สลับออกจาก role 'user' แล้วเลิกผูกพนักงานให้อัตโนมัติ
 * (role อื่นไม่ใช้ employee_id เลย เก็บค้างไว้จะสับสนเปล่าๆ) */
export function updateUserRole(username, role, { actor = 'cli' } = {}) {
  if (!ROLES.includes(role)) {
    throw Object.assign(new Error(`role ต้องเป็น ${ROLES.join(' หรือ ')} เท่านั้น`), { status: 400 });
  }
  const user = get('SELECT username, name_th FROM users WHERE username = $username', { username });
  if (!user) throw Object.assign(new Error(`ไม่พบผู้ใช้ "${username}"`), { status: 404 });

  if (role === 'user') {
    run('UPDATE users SET role = $role WHERE username = $username', { username, role });
  } else {
    run('UPDATE users SET role = $role, employee_id = NULL WHERE username = $username', { username, role });
  }
  logAudit({ actor, action: 'update_user_role', entityType: 'user', entityId: username, detail: { role } });
  return { username, nameTh: user.name_th, role };
}

/** ผูก/เลิกผูกบัญชี role 'user' กับพนักงานในตาราง employees (31 ส.ค. 69 ตามที่ขอ) — ใช้กรองหน้า
 * "ความคืบหน้าของฉัน" ให้เห็นแค่ของตัวเอง ผูกได้เฉพาะบัญชี role 'user' เท่านั้น */
export function updateUserEmployee(username, employeeId, { actor = 'cli' } = {}) {
  const user = get('SELECT username, name_th, role FROM users WHERE username = $username', { username });
  if (!user) throw Object.assign(new Error(`ไม่พบผู้ใช้ "${username}"`), { status: 404 });
  if (user.role !== 'user') {
    throw Object.assign(new Error('ผูกพนักงานได้เฉพาะบัญชี role "user" เท่านั้น'), { status: 400 });
  }
  run('UPDATE users SET employee_id = $employeeId WHERE username = $username', { username, employeeId });
  logAudit({ actor, action: 'update_user_employee', entityType: 'user', entityId: username, detail: { employeeId } });
  return { username, nameTh: user.name_th, employeeId };
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

  const { salt, hash } = hashSecret(newPassword);
  run(
    'UPDATE users SET password_salt = $salt, password_hash = $hash WHERE username = $username',
    { username, salt, hash },
  );
  run('DELETE FROM sessions WHERE username = $username', { username });
  logAudit({ actor, action: 'reset_password', entityType: 'user', entityId: username, detail: {} });
  return { username, nameTh: user.name_th };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * ลงทะเบียนบัญชีใหม่เอง (31 ส.ค. 69 ตามที่ขอ) — ไม่ผ่าน admin เหมือน createUser()
 * บัญชีที่ได้ตั้ง active=0 เสมอ ต้องรอ admin/accounting กดเปิดใช้งานที่หน้า "จัดการระบบ → ผู้ใช้"
 * ก่อนถึง login ได้จริง (เหตุผลเดียวกับที่พนักงานอัปโหลด Timesheet เองต้องรอตรวจซ้ำก่อนเข้า pipeline
 * จริง — กันคนตั้ง role/ผูกพนักงานผิดโดยไม่มีใครเช็ค) username = email ที่ใช้สมัคร
 */
export function registerUser({ email, nameTh, password }) {
  const normalizedEmail = String(email ?? '').trim().toLowerCase();
  if (!normalizedEmail || !nameTh || !password) {
    throw Object.assign(new Error('ต้องระบุอีเมล ชื่อ และรหัสผ่านให้ครบ'), { status: 400 });
  }
  if (!EMAIL_RE.test(normalizedEmail)) {
    throw Object.assign(new Error('รูปแบบอีเมลไม่ถูกต้อง'), { status: 400 });
  }
  if (password.length < 8) {
    throw Object.assign(new Error('รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร'), { status: 400 });
  }
  if (get('SELECT username FROM users WHERE username = $u', { u: normalizedEmail })) {
    throw Object.assign(new Error('มีบัญชีที่ใช้อีเมลนี้อยู่แล้ว'), { status: 409 });
  }

  const { salt, hash } = hashSecret(password);
  run(
    `INSERT INTO users (username, name_th, role, email, self_registered, active, password_salt, password_hash)
     VALUES ($u, $nameTh, 'user', $email, 1, 0, $salt, $hash)`,
    { u: normalizedEmail, nameTh, email: normalizedEmail, salt, hash },
  );
  logAudit({
    actor: nameTh, action: 'register_user', entityType: 'user', entityId: normalizedEmail,
    detail: { self: true },
  });
  return { username: normalizedEmail, nameTh };
}

/**
 * ขอรหัสยืนยัน 6 หลักตอนลืมรหัสผ่าน — คืน { username, nameTh, code } ให้ผู้เรียก (server.js) เอา
 * code ไปส่งอีเมลเอง (ฟังก์ชันนี้ไม่ส่งอีเมลเอง เก็บ concerns แยกจากที่นี่)
 * คืน null เงียบๆ ถ้าไม่เจอบัญชี/บัญชีถูกปิดใช้งาน — ผู้เรียกต้องตอบข้อความเดียวกันเสมอไม่ว่าเจอหรือไม่
 * (กันคนเดาว่าอีเมลไหนมีอยู่ในระบบจากข้อความตอบกลับที่ต่างกัน)
 */
export function requestPasswordReset(email) {
  const user = findUserByLoginEmail(String(email ?? '').trim());
  if (!user || !user.active) return null;

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const { salt, hash } = hashSecret(code);
  run(
    `UPDATE users SET reset_code_hash = $hash, reset_code_salt = $salt,
            reset_code_expires_at = $expiresAt, reset_code_attempts = 0,
            reset_token_hash = NULL, reset_token_expires_at = NULL
      WHERE username = $username`,
    { hash, salt, expiresAt: new Date(Date.now() + RESET_CODE_TTL_MS).toISOString(), username: user.username },
  );
  return { username: user.username, nameTh: user.name_th, code };
}

/**
 * ยืนยันรหัส 6 หลัก — ผ่านแล้วคืน resetToken (คนละค่ากับรหัส 6 หลัก) ให้ไปตั้งรหัสผ่านใหม่จริง
 * ที่ resetPasswordWithToken() ด้านล่าง ผิดเกิน RESET_CODE_MAX_ATTEMPTS ครั้งต้องขอรหัสใหม่
 */
export function verifyResetCode(email, code) {
  const user = findUserByLoginEmail(String(email ?? '').trim());
  const invalid = () => Object.assign(new Error('รหัสไม่ถูกต้องหรือหมดอายุแล้ว — ขอรหัสใหม่อีกครั้ง'), { status: 400 });
  if (!user || !user.reset_code_hash || !user.reset_code_expires_at) throw invalid();
  if (new Date(user.reset_code_expires_at).getTime() < Date.now()) throw invalid();
  if (user.reset_code_attempts >= RESET_CODE_MAX_ATTEMPTS) throw invalid();

  if (!secretMatches(String(code ?? ''), user.reset_code_salt, user.reset_code_hash)) {
    run('UPDATE users SET reset_code_attempts = reset_code_attempts + 1 WHERE username = $username', { username: user.username });
    throw invalid();
  }

  const token = randomBytes(24).toString('base64url');
  const { salt, hash } = hashSecret(token);
  run(
    `UPDATE users SET reset_token_hash = $hash, reset_token_salt = $salt,
            reset_token_expires_at = $expiresAt,
            reset_code_hash = NULL, reset_code_salt = NULL, reset_code_expires_at = NULL, reset_code_attempts = 0
      WHERE username = $username`,
    { hash, salt, expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString(), username: user.username },
  );
  return { resetToken: token };
}

/** ตั้งรหัสผ่านใหม่จริงหลังยืนยันรหัส 6 หลักผ่านแล้ว — ใช้ resetToken จาก verifyResetCode() */
export function resetPasswordWithToken(email, resetToken, newPassword) {
  const user = findUserByLoginEmail(String(email ?? '').trim());
  const invalid = () => Object.assign(new Error('คำขอตั้งรหัสผ่านใหม่หมดอายุแล้ว — เริ่มใหม่ที่ขั้นตอนลืมรหัสผ่าน'), { status: 400 });
  if (!user || !user.reset_token_hash || !user.reset_token_expires_at) throw invalid();
  if (new Date(user.reset_token_expires_at).getTime() < Date.now()) throw invalid();
  if (!secretMatches(String(resetToken ?? ''), user.reset_token_salt, user.reset_token_hash)) throw invalid();

  const result = resetPassword(user.username, newPassword, { actor: user.name_th });
  run(
    'UPDATE users SET reset_token_hash = NULL, reset_token_salt = NULL, reset_token_expires_at = NULL WHERE username = $username',
    { username: user.username },
  );
  return result;
}

/**
 * เข้าสู่ระบบด้วย Google — หาโดย google_sub ก่อน ไม่เจอค่อยลองผูกกับบัญชีเดิมที่ email ตรงกัน
 * ไม่เจอเลยสร้างบัญชีใหม่ (เหมือน registerUser แต่ไม่ต้องตั้งรหัสผ่านเอง) — active=0 เสมอเช่นกัน
 * ต้องรอ admin เปิดใช้งานก่อน (ดูคอมเมนต์ registerUser)
 */
export function findOrCreateGoogleUser({ sub, email, name }) {
  const normalizedEmail = String(email ?? '').trim().toLowerCase();
  let user = get('SELECT * FROM users WHERE google_sub = $sub', { sub });
  if (user) return shapeSessionUser(user);

  user = findUserByLoginEmail(normalizedEmail);
  if (user) {
    run('UPDATE users SET google_sub = $sub WHERE username = $username', { sub, username: user.username });
    logAudit({ actor: user.name_th, action: 'link_google', entityType: 'user', entityId: user.username, detail: {} });
    return shapeSessionUser({ ...user, google_sub: sub });
  }

  const { salt, hash } = hashSecret(randomBytes(24).toString('hex')); // รหัสผ่านที่ไม่มีใครรู้ — เข้าได้ทาง Google เท่านั้นจนกว่าจะตั้งรหัสผ่านเองผ่านหน้าลืมรหัสผ่าน
  run(
    `INSERT INTO users (username, name_th, role, email, google_sub, self_registered, active, password_salt, password_hash)
     VALUES ($u, $nameTh, 'user', $email, $sub, 1, 0, $salt, $hash)`,
    { u: normalizedEmail, nameTh: name || normalizedEmail, email: normalizedEmail, sub, salt, hash },
  );
  logAudit({ actor: name || normalizedEmail, action: 'register_user', entityType: 'user', entityId: normalizedEmail, detail: { self: true, google: true } });
  return { username: normalizedEmail, nameTh: name || normalizedEmail, role: 'user', employeeId: null, active: false };
}

function shapeSessionUser(user) {
  return { username: user.username, nameTh: user.name_th, role: user.role, employeeId: user.employee_id, active: Boolean(user.active) };
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

  return { username: user.username, nameTh: user.name_th, role: user.role, employeeId: user.employee_id };
}

export function createSession(username, remember = true) {
  const token = randomBytes(32).toString('base64url');
  const ttl = remember ? SESSION_TTL_REMEMBER_MS : SESSION_TTL_DEFAULT_MS;
  const expiresAt = new Date(Date.now() + ttl).toISOString();
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
    `SELECT s.token, s.expires_at, u.username, u.name_th, u.role, u.employee_id
       FROM sessions s JOIN users u ON u.username = s.username
      WHERE s.token = $token AND u.active = 1`,
    { token },
  );
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    destroySession(token);
    return null;
  }
  return { username: row.username, nameTh: row.name_th, role: row.role, employeeId: row.employee_id };
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
