import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import {
  SESSION_COOKIE,
  verifyLogin,
  createSession,
  resolveSession,
  destroySession,
  sessionCookieMaxAgeMs,
  AuthError,
  registerUser,
  requestPasswordReset,
  verifyResetCode,
  resetPasswordWithToken,
  sendPasswordResetCodeEmail,
  findOrCreateGoogleUser,
} from '../lib/auth.js';
import { googleEnabled, googleRedirectUri, buildGoogleAuthUrl, fetchGoogleProfile } from '../lib/googleOAuth.js';

const OAUTH_STATE_COOKIE = 'obs_oauth_state';

export const authRouter = Router();

authRouter.post('/login', async (req, res) => {
  const { username, password, remember = true } = req.body ?? {};
  if (!username || !password) {
    return res.status(400).json({ error: 'ต้องระบุ username และ password' });
  }

  const user = await verifyLogin(String(username), String(password));
  if (!user) {
    return res.status(401).json({ error: 'username หรือ password ไม่ถูกต้อง' });
  }

  const { token } = await createSession(user.username, Boolean(remember));
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    maxAge: sessionCookieMaxAgeMs(Boolean(remember)),
    path: '/',
  });
  res.json({ user });
});

authRouter.post('/logout', async (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE];
  await destroySession(token);
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ ok: true });
});

authRouter.get('/me', async (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE];
  const user = await resolveSession(token);
  if (!user) return res.status(401).json({ error: 'ยังไม่ได้เข้าสู่ระบบ' });
  res.json({ user });
});

/** หน้า login ใช้เช็คว่าจะโชว์ปุ่ม "เข้าสู่ระบบด้วย Google" ไหม — ไม่ได้ตั้งค่าไว้ = ไม่โชว์ปุ่มเลย */
authRouter.get('/config', (_req, res) => {
  res.json({ googleEnabled: googleEnabled() });
});

/** ลงทะเบียนเอง — บัญชีที่ได้ต้องรอ admin/accounting เปิดใช้งานก่อนถึง login ได้จริง */
authRouter.post('/register', async (req, res) => {
  try {
    const { username, nameTh } = await registerUser({ email: req.body?.email, nameTh: req.body?.nameTh, password: req.body?.password });
    res.json({ username, nameTh, pending: true });
  } catch (error) {
    if (error instanceof AuthError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

/** ลืมรหัสผ่าน ขั้น 1 — ขอรหัสยืนยัน 6 หลักทางอีเมล ตอบข้อความเดียวกันเสมอไม่ว่าเจอบัญชีหรือไม่ (กัน
 * คนเดาว่าอีเมลไหนมีอยู่ในระบบจากข้อความตอบกลับที่ต่างกัน) ส่งอีเมลไม่สำเร็จก็ log ไว้เฉยๆ ไม่ทำให้
 * ผู้ใช้เห็น error ที่บอกใบ้ได้ว่าอีเมลนี้มีอยู่จริงหรือเปล่า */
authRouter.post('/forgot-password', async (req, res) => {
  if (!req.body?.email) return res.status(400).json({ error: 'ต้องระบุอีเมล' });
  const result = await requestPasswordReset(req.body.email);
  if (result) {
    try {
      await sendPasswordResetCodeEmail(result.username, result.code);
    } catch (error: any) {
      console.error('[forgot-password] ส่งอีเมลรหัสยืนยันไม่สำเร็จ:', error.message);
    }
  }
  res.json({ ok: true, message: 'ถ้าอีเมลนี้มีอยู่ในระบบ จะได้รับรหัสยืนยัน 6 หลักทางอีเมลภายในไม่กี่นาที' });
});

/** ลืมรหัสผ่าน ขั้น 2 — ยืนยันรหัส 6 หลัก ผ่านแล้วได้ resetToken ไปตั้งรหัสผ่านใหม่จริงที่ขั้น 3 */
authRouter.post('/verify-reset-code', async (req, res) => {
  if (!req.body?.email || !req.body?.code) return res.status(400).json({ error: 'ต้องระบุอีเมลและรหัสยืนยัน' });
  try {
    res.json(await verifyResetCode(req.body.email, req.body.code));
  } catch (error) {
    if (error instanceof AuthError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

/** ลืมรหัสผ่าน ขั้น 3 — ตั้งรหัสผ่านใหม่จริงด้วย resetToken จากขั้น 2 */
authRouter.post('/reset-password', async (req, res) => {
  if (!req.body?.email || !req.body?.resetToken || !req.body?.newPassword) {
    return res.status(400).json({ error: 'ต้องระบุอีเมล resetToken และรหัสผ่านใหม่' });
  }
  try {
    await resetPasswordWithToken(req.body.email, req.body.resetToken, req.body.newPassword);
    res.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

/**
 * เข้าสู่ระบบด้วย Google — สองเส้นทางนี้ตอบเป็น redirect (302) ไม่ใช่ JSON ก้อนเดียว
 *
 * state เก็บไว้ใน cookie ชั่วคราวเทียบกับค่าที่ Google ส่งกลับมาตอน callback (CSRF) — อายุสั้นแค่ 5
 * นาทีพอสำหรับกดยินยอมที่ฝั่ง Google เสร็จ — apps/web's proxy route relays this Set-Cookie back to
 * the browser scoped to the web origin (ดู apps/web/src/app/api/auth/google/start/route.ts).
 */
authRouter.get('/google/start', (req, res) => {
  if (!googleEnabled()) {
    return res.status(501).json({ error: 'ยังไม่ได้ตั้งค่า Google Sign-In — ใส่ GOOGLE_CLIENT_ID/SECRET ใน .env ก่อน' });
  }
  const state = randomBytes(16).toString('hex');
  res.cookie(OAUTH_STATE_COOKIE, state, { httpOnly: true, sameSite: 'lax', maxAge: 300_000, path: '/' });
  res.redirect(302, buildGoogleAuthUrl({ redirectUri: googleRedirectUri(req), state }));
});

authRouter.get('/google/callback', async (req, res) => {
  try {
    const state = typeof req.query.state === 'string' ? req.query.state : null;
    const cookieState = req.cookies?.[OAUTH_STATE_COOKIE];
    if (!state || !cookieState || state !== cookieState) {
      throw new AuthError('session สำหรับเข้าสู่ระบบด้วย Google หมดอายุ — ลองใหม่อีกครั้ง');
    }
    const code = typeof req.query.code === 'string' ? req.query.code : null;
    if (!code) throw new AuthError('Google ไม่ได้ส่ง code กลับมา');

    const profile = await fetchGoogleProfile({ code, redirectUri: googleRedirectUri(req) });
    const user = await findOrCreateGoogleUser(profile);
    res.clearCookie(OAUTH_STATE_COOKIE, { path: '/' });

    if (!user.active) {
      return res.redirect(302, '/login?googlePending=1');
    }
    const { token } = await createSession(user.username, true);
    res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: sessionCookieMaxAgeMs(true), path: '/' });
    res.redirect(302, '/');
  } catch (error: any) {
    // ต้อง redirect ไป /login ตรงๆ ไม่ใช่ '/' ก่อน — root page เช็ค requireUser() แล้ว redirect ต่อไป
    // /login ทันทีโดยไม่พก query string ไปด้วย (session.ts's requireUser()) ทำให้ query param นี้หายไป
    // เงียบๆ ถ้าไป '/' ก่อน (เจอจริง 17 ก.ย. 69 — ข้อความ "รอ admin อนุมัติ" หลัง Google sign-up หายไป)
    res.redirect(302, `/login?loginError=${encodeURIComponent(error.message)}`);
  }
});
