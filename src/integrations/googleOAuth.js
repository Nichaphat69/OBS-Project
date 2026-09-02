/**
 * "เข้าสู่ระบบด้วย Google" — OAuth 2.0 authorization-code flow ตรงกับ Google เอง ไม่ผูก SSO
 * ผู้ให้บริการรายอื่น (31 ส.ค. 69 ตามที่ขอ)
 *
 * ต้องสร้าง OAuth Client ID/Secret เองใน Google Cloud Console → APIs & Services → Credentials
 * (Web application) แล้วใส่ GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET ใน .env — ไม่ใส่ครบ = ปุ่ม
 * "เข้าสู่ระบบด้วย Google" จะไม่โผล่ในหน้าเว็บเลย (ดู googleEnabled() + GET /api/auth/config)
 *
 * Authorized redirect URI ที่ต้องใส่ในหน้า Credentials ของ Google:
 *   ตั้ง GOOGLE_REDIRECT_URI ใน .env ให้ตรงกับ URL จริงของระบบ + /api/auth/google/callback
 *   เช่น https://obs.example.com/api/auth/google/callback — ไม่ใส่ = คำนวณจาก header Host ของ
 *   คำขอเอง (ใช้ได้เฉพาะตอนทดสอบในเครื่อง ไม่ควรใช้กับ production ที่อยู่หลัง reverse proxy)
 *
 * ไม่ใช้ googleapis SDK เหมือนกับ src/integrations/gmail.js — เรียก REST ตรงด้วย fetch
 */

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

export function googleEnabled() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/** URI ที่ Google ต้องเรียกกลับมาหลังคนกดยินยอม — ต้องตรงกับที่ตั้งไว้ในหน้า Credentials เป๊ะ */
export function googleRedirectUri(req) {
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;
  const proto = req.headers['x-forwarded-proto'] ?? 'http';
  return `${proto}://${req.headers.host}/api/auth/google/callback`;
}

export function buildGoogleAuthUrl({ redirectUri, state }) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  return `${AUTH_URL}?${params}`;
}

/** แลก authorization code เป็น access token แล้วดึงโปรไฟล์ (sub/email/name) มาให้เลย */
export async function fetchGoogleProfile({ code, redirectUri }) {
  const tokenRes = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const tokenBody = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok) {
    throw Object.assign(
      new Error(`แลก token กับ Google ไม่สำเร็จ: ${tokenBody.error_description ?? tokenBody.error ?? tokenRes.status}`),
      { status: 502 },
    );
  }

  const infoRes = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${tokenBody.access_token}` },
  });
  const info = await infoRes.json().catch(() => ({}));
  if (!infoRes.ok || !info.sub || !info.email) {
    throw Object.assign(new Error('ดึงข้อมูลบัญชี Google ไม่สำเร็จ'), { status: 502 });
  }
  return { sub: info.sub, email: info.email, name: info.name ?? info.email };
}
