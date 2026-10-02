/**
 * ยืนยันตัวตนคนใช้ระบบ — ported from src/auth.js.
 *
 * Same mechanism as the original app (scrypt password hashing + timingSafeEqual comparison,
 * random 32-byte base64url session tokens, TTL 12h default / 30 days "remember me"), now
 * reading/writing through the Prisma client against the `users`/`sessions` tables instead of
 * raw SQL. login/logout/me were ported first (Phase 4); self-registration, forgot-password, and
 * Google OAuth linking are ported here in 5.5.7.
 */
import { randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import { prisma } from '@obs/db';
import { logAudit } from './audit.js';
import { resetPassword } from './usersService.js';
import { GmailClient } from './gmailClient.js';

export const SESSION_COOKIE = 'obs_session';
/* "จดจำฉัน" ติ๊ก (ค่าเริ่มต้น) = 30 วัน เหมือนเดิม — ไม่ติ๊ก (เครื่องที่ไม่ใช่ของตัวเอง) = 12 ชั่วโมง */
const SESSION_TTL_REMEMBER_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_TTL_DEFAULT_MS = 12 * 60 * 60 * 1000;
const SCRYPT_KEYLEN = 64;
const RESET_CODE_TTL_MS = 10 * 60 * 1000; // รหัส 6 หลักตอนลืมรหัสผ่าน อยู่ได้ 10 นาที
const RESET_TOKEN_TTL_MS = 10 * 60 * 1000; // token หลังยืนยันรหัสผ่านแล้ว อยู่ได้อีก 10 นาที
const RESET_CODE_MAX_ATTEMPTS = 5; // กรอกรหัสผิดเกินนี้ต้องขอรหัสใหม่
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** scrypt แฮชค่าลับ — ใช้ทั้งรหัสผ่านจริงและรหัสยืนยัน 6 หลักตอนลืมรหัสผ่าน (ค่าไหนก็ไม่เก็บดิบ) */
function hashSecret(value: string): { salt: string; hash: string } {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(value, salt, SCRYPT_KEYLEN).toString('hex');
  return { salt, hash };
}

function secretMatches(candidate: string, salt: string | null, hash: string | null): boolean {
  if (!salt || !hash) return false;
  const candidateHash = scryptSync(candidate, salt, SCRYPT_KEYLEN);
  const stored = Buffer.from(hash, 'hex');
  return candidateHash.length === stored.length && timingSafeEqual(candidateHash, stored);
}

/** หาโดย email จริง หรือ username ที่เป็นอีเมลอยู่แล้ว (บัญชีเก่าก่อนมีคอลัมน์ email ทั้งหมด) */
async function findUserByLoginEmail(email: string) {
  const rows = await prisma.user.findMany({ where: { OR: [{ username: { equals: email, mode: 'insensitive' } }, { email: { equals: email, mode: 'insensitive' } }] } });
  return rows[0] ?? null;
}

export interface SessionUser {
  username: string;
  nameTh: string;
  role: string;
  employeeId: string | null;
}

/** ตรวจ username/password — คืน null ถ้าไม่ตรงหรือถูกปิดใช้งาน (ไม่บอกว่าผิดที่จุดไหน)
 *
 * ⚠️ เจ้าของระบบสั่ง 24 ก.ย. 69 ให้ล็อกอินด้วย "ชื่อ" หรือ "อีเมล" ได้ด้วย ไม่ใช่แค่ username (=อีเมล
 * ที่แอดมินตั้งให้ตอนสร้างบัญชี ซึ่งพนักงานจำนวนมากไม่รู้/จำไม่ได้ว่าคืออะไร รู้แต่ชื่อตัวเองกับอีเมลจริง)
 * — เทียบ username/email/nameTh/nameEn พร้อมกัน (case-insensitive) username กับ email เป็นค่าที่ควร
 * ไม่ซ้ำกันอยู่แล้ว แต่ nameTh/nameEn ไม่มีข้อบังคับ unique เลย ถ้าพิมพ์ชื่อแล้วดันตรงกับคนมากกว่า 1 คน
 * พอดี ปฏิเสธไปเลยแทนที่จะเดาเอาคนแรกในรายการ กันเข้าบัญชีผิดคนเงียบๆ */
export async function verifyLogin(identifier: string, password: string): Promise<SessionUser | null> {
  const trimmed = identifier.trim();
  if (!trimmed) return null;

  const candidates = await prisma.user.findMany({
    where: {
      OR: [
        { username: { equals: trimmed, mode: 'insensitive' } },
        { email: { equals: trimmed, mode: 'insensitive' } },
        { nameTh: { equals: trimmed, mode: 'insensitive' } },
        { nameEn: { equals: trimmed, mode: 'insensitive' } },
      ],
    },
  });
  if (candidates.length !== 1) return null;
  const user = candidates[0];
  if (!user.active) return null;

  const candidate = scryptSync(password, user.passwordSalt, SCRYPT_KEYLEN);
  const stored = Buffer.from(user.passwordHash, 'hex');
  if (candidate.length !== stored.length || !timingSafeEqual(candidate, stored)) return null;

  return { username: user.username, nameTh: user.nameTh, role: user.role, employeeId: user.employeeId };
}

export async function createSession(username: string, remember = true): Promise<{ token: string; expiresAt: string }> {
  const token = randomBytes(32).toString('base64url');
  const ttl = remember ? SESSION_TTL_REMEMBER_MS : SESSION_TTL_DEFAULT_MS;
  const expiresAt = new Date(Date.now() + ttl).toISOString();
  const createdAt = new Date().toISOString();
  await prisma.session.create({ data: { token, username, createdAt, expiresAt } });
  return { token, expiresAt };
}

/** คืนข้อมูลผู้ใช้ของ session นี้ หรือ null ถ้าไม่มี/หมดอายุแล้ว (ลบทิ้งให้เลยถ้าหมดอายุ) */
export async function resolveSession(token: string | undefined | null): Promise<SessionUser | null> {
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { token },
    include: { user: true },
  });
  if (!session || !session.user.active) return null;
  if (new Date(session.expiresAt).getTime() < Date.now()) {
    await destroySession(token);
    return null;
  }
  return {
    username: session.user.username,
    nameTh: session.user.nameTh,
    role: session.user.role,
    employeeId: session.user.employeeId,
  };
}

export async function destroySession(token: string | undefined | null): Promise<void> {
  if (!token) return;
  await prisma.session.deleteMany({ where: { token } });
}

/** cookie ที่ TTL เท่ากับ session จริง — ให้ browser ล้าง cookie เองตอนหมดอายุด้วย (นอกเหนือจากที่
 * resolveSession() ลบฝั่งเซิร์ฟเวอร์อยู่แล้ว) */
export function sessionCookieMaxAgeMs(remember: boolean): number {
  return remember ? SESSION_TTL_REMEMBER_MS : SESSION_TTL_DEFAULT_MS;
}

/**
 * ลงทะเบียนบัญชีใหม่เอง — ไม่ผ่าน admin เหมือน createUser() บัญชีที่ได้ตั้ง active=false เสมอ ต้อง
 * รอ admin/accounting กดเปิดใช้งานที่หน้า "จัดการระบบ → ผู้ใช้" ก่อนถึง login ได้จริง (เหตุผลเดียวกับ
 * ที่พนักงานอัปโหลด Timesheet เองต้องรอตรวจซ้ำก่อนเข้า pipeline จริง) username = email ที่ใช้สมัคร
 */
export async function registerUser({ email, nameTh, password }: { email: string; nameTh: string; password: string }): Promise<{ username: string; nameTh: string }> {
  const normalizedEmail = String(email ?? '').trim().toLowerCase();
  if (!normalizedEmail || !nameTh || !password) throw new AuthError('ต้องระบุอีเมล ชื่อ และรหัสผ่านให้ครบ');
  if (!EMAIL_RE.test(normalizedEmail)) throw new AuthError('รูปแบบอีเมลไม่ถูกต้อง');
  if (password.length < 8) throw new AuthError('รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร');

  // เช็คทั้ง username และคอลัมน์ email (ไม่ใช่แค่ username) เหมือนตอนล็อกอิน/Google login — บัญชีที่ username ไม่ใช่อีเมล
  // (เช่น "qa_accounting" ที่มีอีเมล qa_accounting@example.com) เดิมเช็คไม่เจอ แล้วสร้างบัญชีซ้ำอีเมลเดียวกันได้ (QA AUTH-009, 2 ต.ค. 69)
  const existing = await findUserByLoginEmail(normalizedEmail);
  if (existing) throw new AuthError('มีบัญชีที่ใช้อีเมลนี้อยู่แล้ว', 409);

  const { salt, hash } = hashSecret(password);
  await prisma.user.create({
    data: {
      username: normalizedEmail,
      nameTh,
      role: 'user',
      email: normalizedEmail,
      selfRegistered: true,
      active: false,
      passwordSalt: salt,
      passwordHash: hash,
      createdAt: new Date().toISOString(),
    },
  });
  await logAudit({ actor: nameTh, action: 'register_user', entityType: 'user', entityId: normalizedEmail, detail: { self: true } });
  return { username: normalizedEmail, nameTh };
}

/**
 * ขอรหัสยืนยัน 6 หลักตอนลืมรหัสผ่าน — คืน { username, nameTh, code } ให้ผู้เรียก (route) เอา code ไป
 * ส่งอีเมลเอง (ฟังก์ชันนี้ไม่ส่งอีเมลเอง เก็บ concerns แยกจากที่นี่) คืน null เงียบๆ ถ้าไม่เจอบัญชี/
 * บัญชีถูกปิดใช้งาน — ผู้เรียกต้องตอบข้อความเดียวกันเสมอไม่ว่าเจอหรือไม่ (กันคนเดาว่าอีเมลไหนมีอยู่ใน
 * ระบบจากข้อความตอบกลับที่ต่างกัน)
 */
export async function requestPasswordReset(email: string): Promise<{ username: string; nameTh: string; code: string } | null> {
  const user = await findUserByLoginEmail(String(email ?? '').trim());
  if (!user || !user.active) return null;

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const { salt, hash } = hashSecret(code);
  await prisma.user.update({
    where: { username: user.username },
    data: {
      resetCodeHash: hash,
      resetCodeSalt: salt,
      resetCodeExpiresAt: new Date(Date.now() + RESET_CODE_TTL_MS).toISOString(),
      resetCodeAttempts: 0,
      resetTokenHash: null,
      resetTokenExpiresAt: null,
    },
  });
  return { username: user.username, nameTh: user.nameTh, code };
}

/**
 * ยืนยันรหัส 6 หลัก — ผ่านแล้วคืน resetToken (คนละค่ากับรหัส 6 หลัก) ให้ไปตั้งรหัสผ่านใหม่จริงที่
 * resetPasswordWithToken() ด้านล่าง ผิดเกิน RESET_CODE_MAX_ATTEMPTS ครั้งต้องขอรหัสใหม่
 */
export async function verifyResetCode(email: string, code: string): Promise<{ resetToken: string }> {
  const user = await findUserByLoginEmail(String(email ?? '').trim());
  const invalid = () => new AuthError('รหัสไม่ถูกต้องหรือหมดอายุแล้ว — ขอรหัสใหม่อีกครั้ง');
  if (!user || !user.resetCodeHash || !user.resetCodeExpiresAt) throw invalid();
  if (new Date(user.resetCodeExpiresAt).getTime() < Date.now()) throw invalid();
  if (user.resetCodeAttempts >= RESET_CODE_MAX_ATTEMPTS) throw invalid();

  if (!secretMatches(String(code ?? ''), user.resetCodeSalt, user.resetCodeHash)) {
    await prisma.user.update({ where: { username: user.username }, data: { resetCodeAttempts: { increment: 1 } } });
    throw invalid();
  }

  const token = randomBytes(24).toString('base64url');
  const { salt, hash } = hashSecret(token);
  await prisma.user.update({
    where: { username: user.username },
    data: {
      resetTokenHash: hash,
      resetTokenSalt: salt,
      resetTokenExpiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString(),
      resetCodeHash: null,
      resetCodeSalt: null,
      resetCodeExpiresAt: null,
      resetCodeAttempts: 0,
    },
  });
  return { resetToken: token };
}

/** ตั้งรหัสผ่านใหม่จริงหลังยืนยันรหัส 6 หลักผ่านแล้ว — ใช้ resetToken จาก verifyResetCode() */
export async function resetPasswordWithToken(email: string, resetToken: string, newPassword: string): Promise<void> {
  const user = await findUserByLoginEmail(String(email ?? '').trim());
  const invalid = () => new AuthError('คำขอตั้งรหัสผ่านใหม่หมดอายุแล้ว — เริ่มใหม่ที่ขั้นตอนลืมรหัสผ่าน');
  if (!user || !user.resetTokenHash || !user.resetTokenExpiresAt) throw invalid();
  if (new Date(user.resetTokenExpiresAt).getTime() < Date.now()) throw invalid();
  if (!secretMatches(String(resetToken ?? ''), user.resetTokenSalt, user.resetTokenHash)) throw invalid();

  await resetPassword(user.username, newPassword, { actor: user.nameTh });
  await prisma.user.update({
    where: { username: user.username },
    data: { resetTokenHash: null, resetTokenSalt: null, resetTokenExpiresAt: null },
  });
}

/** ส่งอีเมลรหัสยืนยัน 6 หลักตอนลืมรหัสผ่านจริง — ported from service.js sendPasswordResetCodeEmail()
 * ⚠️ ใช้ GmailClient.sendMessage() เฉพาะจุดนี้เท่านั้น (ดูคำเตือนใน gmailClient.ts) */
export async function sendPasswordResetCodeEmail(email: string, code: string, { client }: { client?: GmailClient } = {}): Promise<void> {
  const gmail = client ?? new GmailClient();
  await gmail.sendMessage({
    to: email,
    subject: 'รหัสยืนยันตั้งรหัสผ่านใหม่ — ระบบวางบิล Outsource (OBS)',
    body: [
      `รหัสยืนยัน 6 หลักของคุณคือ: ${code}`,
      '',
      'รหัสนี้ใช้ได้ภายใน 10 นาที และใช้ได้ครั้งเดียว',
      'ถ้าคุณไม่ได้เป็นคนขอตั้งรหัสผ่านใหม่ ไม่ต้องทำอะไรต่อ — เพิกเฉยอีเมลนี้ได้เลย',
    ].join('\n'),
  });
}

export interface GoogleSessionUser {
  username: string;
  nameTh: string;
  role: string;
  employeeId: string | null;
  active: boolean;
}

/**
 * เข้าสู่ระบบด้วย Google — หาโดย google_sub ก่อน ไม่เจอค่อยลองผูกกับบัญชีเดิมที่ email ตรงกัน ไม่เจอ
 * เลยสร้างบัญชีใหม่ (เหมือน registerUser แต่ไม่ต้องตั้งรหัสผ่านเอง) — active=false เสมอเช่นกัน ต้อง
 * รอ admin เปิดใช้งานก่อน (ดูคอมเมนต์ registerUser)
 */
export async function findOrCreateGoogleUser({ sub, email, name }: { sub: string; email: string; name?: string | null }): Promise<GoogleSessionUser> {
  const normalizedEmail = String(email ?? '').trim().toLowerCase();

  let user = await prisma.user.findFirst({ where: { googleSub: sub } });
  if (user) return { username: user.username, nameTh: user.nameTh, role: user.role, employeeId: user.employeeId, active: user.active };

  user = await findUserByLoginEmail(normalizedEmail);
  if (user) {
    await prisma.user.update({ where: { username: user.username }, data: { googleSub: sub } });
    await logAudit({ actor: user.nameTh, action: 'link_google', entityType: 'user', entityId: user.username, detail: {} });
    return { username: user.username, nameTh: user.nameTh, role: user.role, employeeId: user.employeeId, active: user.active };
  }

  // รหัสผ่านที่ไม่มีใครรู้ — เข้าได้ทาง Google เท่านั้นจนกว่าจะตั้งรหัสผ่านเองผ่านหน้าลืมรหัสผ่าน
  const { salt, hash } = hashSecret(randomBytes(24).toString('hex'));
  const displayName = name || normalizedEmail;
  await prisma.user.create({
    data: {
      username: normalizedEmail,
      nameTh: displayName,
      role: 'user',
      email: normalizedEmail,
      googleSub: sub,
      selfRegistered: true,
      active: false,
      passwordSalt: salt,
      passwordHash: hash,
      createdAt: new Date().toISOString(),
    },
  });
  await logAudit({ actor: displayName, action: 'register_user', entityType: 'user', entityId: normalizedEmail, detail: { self: true, google: true } });
  return { username: normalizedEmail, nameTh: displayName, role: 'user', employeeId: null, active: false };
}
