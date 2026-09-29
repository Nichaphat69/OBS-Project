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

/* ── ขอสิทธิ์อ่านกล่อง Gmail (แยกขั้นจากการล็อกอิน) ──────────────────────────────────────────
 *
 * Google เรียกวิธีนี้ว่า incremental authorization และแนะนำให้ทำแบบนี้ — ตอนล็อกอินขอแค่ชื่อกับอีเมล
 * พอจะใช้ฟีเจอร์ที่ต้องอ่านเมลจริงๆ ค่อยขอสิทธิ์เพิ่มเป็นอีกขั้นหนึ่ง คนใช้งานจะได้ไม่ต้องเจอหน้าจอที่
 * ขอสิทธิ์อ่านเมลทั้งกล่องตั้งแต่ตอนล็อกอินครั้งแรก ซึ่งน่ากลัวโดยไม่จำเป็น
 *
 * ต่างจาก buildGoogleAuthUrl() ด้านบนสามจุด และทุกจุดจำเป็นทั้งหมด:
 *   - `scope` มี gmail.readonly เพิ่มมา
 *   - `access_type: offline` — ไม่มีอันนี้ Google จะไม่ให้ refresh token มาเลย ได้แต่ access token
 *     ที่หมดอายุใน 1 ชั่วโมง ซึ่งใช้กับงานเบื้องหลังไม่ได้
 *   - `prompt: consent` — บังคับให้ออก refresh token ใบใหม่ทุกครั้ง ถ้าไม่ใส่ Google จะให้ refresh
 *     token เฉพาะครั้งแรกที่คนคนนั้นกดยินยอมเท่านั้น ครั้งต่อไปจะได้แต่ access token ทำให้ "เชื่อมต่อใหม่"
 *     ตอน token หลุดใช้ไม่ได้เลย (กับดักคลาสสิกของ OAuth ฝั่ง Google)
 */
export const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

export function gmailConnectRedirectUri(req: Request): string {
  if (process.env.GMAIL_CONNECT_REDIRECT_URI) return process.env.GMAIL_CONNECT_REDIRECT_URI;
  // อิงจาก redirect ของการล็อกอินที่ตั้งไว้แล้ว เพื่อไม่ต้องตั้งค่าซ้ำสองที่ — เปลี่ยนแค่ท้าย path
  const loginUri = googleRedirectUri(req);
  return loginUri.replace(/\/api\/auth\/google\/callback$/, '/api/gmail/connect/callback');
}

export function buildGmailConsentUrl({ redirectUri, state }: { redirectUri: string; state: string }): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: `openid email ${GMAIL_READONLY_SCOPE}`,
    state,
    access_type: 'offline',
    prompt: 'consent',
  });
  return `${AUTH_URL}?${params}`;
}

export interface GmailConsentResult {
  email: string;
  refreshToken: string;
  scopes: string;
}

/**
 * แลก authorization code เป็น refresh token + รู้ว่าเป็นกล่องของใคร
 *
 * ถามอีเมลจาก Google เองเสมอ ไม่ให้คนพิมพ์เอง — ช่องอีเมลในตารางจึงตรงกับกล่องที่เข้าถึงได้จริง
 * 100% ไม่มีทางที่หน้าจอจะโชว์กล่องหนึ่งแต่ระบบอ่านอีกกล่องหนึ่ง
 */
export async function exchangeGmailConsent({ code, redirectUri }: { code: string; redirectUri: string }): Promise<GmailConsentResult> {
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
    throw new GoogleOAuthError(`แลก token กับ Google ไม่สำเร็จ: ${tokenBody.error_description ?? tokenBody.error ?? tokenRes.status}`, 400);
  }
  if (!tokenBody.refresh_token) {
    throw new GoogleOAuthError(
      'Google ไม่ได้ให้ refresh token กลับมา — เกิดขึ้นเมื่อบัญชีนี้เคยกดยินยอมไว้แล้วและยังไม่ได้ถอนสิทธิ์ ' +
        'ให้ไปถอนสิทธิ์ของ iPassion OBS ที่ myaccount.google.com/permissions แล้วกดเชื่อมต่อใหม่อีกครั้ง',
      400,
    );
  }

  const infoRes = await loggedFetch('google', USERINFO_URL, { headers: { Authorization: `Bearer ${tokenBody.access_token}` } });
  const info: any = await infoRes.json().catch(() => ({}));
  if (!infoRes.ok || !info.email) {
    throw new GoogleOAuthError('เชื่อมต่อได้แต่ถามอีเมลของกล่องจาก Google ไม่สำเร็จ ลองใหม่อีกครั้ง');
  }

  return { email: info.email, refreshToken: tokenBody.refresh_token, scopes: String(tokenBody.scope ?? '') };
}
