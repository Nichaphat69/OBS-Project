/**
 * "เข้าสู่ระบบด้วย Google" — OAuth 2.0 authorization-code flow ตรงกับ Google เอง ไม่ผูก SSO
 * ผู้ให้บริการรายอื่น — ported from src/integrations/googleOAuth.js.
 *
 * ต้องสร้าง OAuth Client ID/Secret เองใน Google Cloud Console → APIs & Services → Credentials
 * (Web application) แล้วใส่ GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET ใน .env — ไม่ใส่ครบ = ปุ่ม
 * "เข้าสู่ระบบด้วย Google" จะไม่โผล่ในหน้าเว็บเลย (ดู googleEnabled() + GET /api/auth/config)
 *
 * Authorized redirect URI ที่ต้องใส่ในหน้า Credentials ของ Google: ตั้ง GOOGLE_REDIRECT_URI ใน
 * .env ให้ตรงกับ URL จริงของ **เว็บ** (apps/web origin ที่ browser คุยด้วยจริง ไม่ใช่ apps/api) +
 * /api/auth/google/callback เช่น https://obs.example.com/api/auth/google/callback — แนะนำให้ตั้ง
 * ค่านี้ตรงๆเสมอในดีพลอยแบบ Docker นี้ (ไม่ใช้ Host-header auto-detect) เพราะคำขอมาถึงที่นี่ผ่าน
 * apps/web proxy มาอีกที header Host ที่เห็นจะเป็นของ apps/web ไม่ใช่ของเบราว์เซอร์ผู้ใช้ตรงๆ — ไม่ใส่
 * จะ fallback ไปอ่านจาก x-forwarded-host/host ที่ apps/web proxy ส่งต่อมาให้แทน (ใช้ได้แต่เชื่อถือได้
 * น้อยกว่า โดยเฉพาะถ้ามี reverse proxy ชั้นอื่นอีก)
 *
 * ไม่ใช้ googleapis SDK เหมือนกับ gmailClient.ts — เรียก REST ตรงด้วย fetch
 */
import type { Request } from 'express';
import { loggedFetch } from './apiActivityLog.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

export function googleEnabled(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/** URI ที่ Google ต้องเรียกกลับมาหลังคนกดยินยอม — ต้องตรงกับที่ตั้งไว้ในหน้า Credentials เป๊ะ */
export function googleRedirectUri(req: Request): string {
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;
  const proto = (req.headers['x-forwarded-proto'] as string) ?? 'http';
  const host = (req.headers['x-forwarded-host'] as string) ?? req.headers.host;
  return `${proto}://${host}/api/auth/google/callback`;
}

export function buildGoogleAuthUrl({ redirectUri, state }: { redirectUri: string; state: string }): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  return `${AUTH_URL}?${params}`;
}

export class GoogleOAuthError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

/** แลก authorization code เป็น access token แล้วดึงโปรไฟล์ (sub/email/name) มาให้เลย */
export async function fetchGoogleProfile({ code, redirectUri }: { code: string; redirectUri: string }): Promise<{ sub: string; email: string; name: string }> {
  const tokenRes = await loggedFetch('google', TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const tokenBody: any = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok) {
    throw new GoogleOAuthError(`แลก token กับ Google ไม่สำเร็จ: ${tokenBody.error_description ?? tokenBody.error ?? tokenRes.status}`);
  }

  const infoRes = await loggedFetch('google', USERINFO_URL, { headers: { Authorization: `Bearer ${tokenBody.access_token}` } });
  const info: any = await infoRes.json().catch(() => ({}));
  if (!infoRes.ok || !info.sub || !info.email) {
    throw new GoogleOAuthError('ดึงข้อมูลบัญชี Google ไม่สำเร็จ');
  }
  return { sub: info.sub, email: info.email, name: info.name ?? info.email };
}
