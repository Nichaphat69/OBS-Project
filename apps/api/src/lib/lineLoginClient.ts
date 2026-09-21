/**
 * "เชื่อมต่อไลน์ด้วยคลิกเดียว" — LINE Login (แยก channel จาก Messaging API ที่ใช้ส่งข้อความอยู่แล้ว)
 * ผูก Account Link ระหว่างสอง channel นี้ไว้ใน LINE Developers Console แล้ว ID token ที่ endpoint
 * `/oauth2/v2.1/verify` คืนมาจะมี `sub` เป็น userId เดียวกันกับที่ Messaging API ใช้เป๊ะ (ดู
 * lineWebhookService.ts's postback/message handlers ที่ทำงานกับ Employee.lineUserId ตัวเดียวกันนี้) —
 * โค้ดฝั่งนี้จึงแค่เอา sub ไปเซ็ต Employee.lineUserId ตรงๆ แทนที่ flow เดิมที่ต้องพิมพ์รหัส 6 หลัก
 * (ดู employeeLineLinkService.ts's startEmployeeLineLink) ทั้งสอง flow ยังอยู่คู่กันได้ — ไม่ได้ตัด
 * ของเดิมทิ้ง เผื่อพนักงานคนไหนกด "เชื่อมต่อด้วย LINE" ไม่ผ่าน (เช่น browser ในแอปบางตัวเปิด OAuth ไม่ได้)
 *
 * ต้องสร้าง LINE Login channel ใหม่ใน LINE Developers Console (แยกจาก Messaging API channel เดิม)
 * แล้วกด "Link" ผูกสอง channel นี้เข้าด้วยกันในหน้า Console (Messaging API channel → LINE Login tab)
 * ถึงจะได้ sub ตรงกับ Messaging userId — ไม่ผูกไว้ sub จะเป็นคนละ id กันคนละชุด ใส่ Employee.lineUserId
 * ผิดคนไปเงียบๆ จึงต้องเช็ค hasLineLoginCredentials() ก่อนโชว์ปุ่มเสมอ (เหมือน googleEnabled())
 *
 * Callback URL ที่ต้องใส่ในหน้า Console: <origin ของเว็บ>/api/my-line-link/oauth/callback
 */
import type { Request } from 'express';
import { loggedFetch } from './apiActivityLog.js';

const AUTH_URL = 'https://access.line.me/oauth2/v2.1/authorize';
const TOKEN_URL = 'https://api.line.me/oauth2/v2.1/token';
const VERIFY_URL = 'https://api.line.me/oauth2/v2.1/verify';

export function lineLoginEnabled(): boolean {
  return Boolean(process.env.LINE_LOGIN_CHANNEL_ID && process.env.LINE_LOGIN_CHANNEL_SECRET);
}

/** เหตุผลเดียวกับ googleRedirectUri() — apps/web proxy อยู่หน้า apps/api เสมอ ตั้ง
 * LINE_LOGIN_REDIRECT_URI ตรงๆ ใน .env ในดีพลอยจริง แทนการเดาจาก header จะเชื่อถือได้กว่า */
export function lineLoginRedirectUri(req: Request): string {
  if (process.env.LINE_LOGIN_REDIRECT_URI) return process.env.LINE_LOGIN_REDIRECT_URI;
  const proto = (req.headers['x-forwarded-proto'] as string) ?? 'http';
  const host = (req.headers['x-forwarded-host'] as string) ?? req.headers.host;
  return `${proto}://${host}/api/my-line-link/oauth/callback`;
}

/** bot_prompt=aggressive แปลว่าถ้ายังไม่เคยแอดเพื่อน OA จะเด้งหน้าชวนแอดให้ในตัวเลย (ไม่ต้องแยกขั้นตอน
 * QR "ขั้นตอนที่ 1" แบบ flow รหัส 6 หลักเดิมอีก) — ต้องตั้งค่า "Linked OA" ในหน้า Console ของ LINE
 * Login channel ก่อน ไม่งั้น LINE จะเมิน parameter นี้เฉยๆ ไม่ error */
export function buildLineLoginUrl({ redirectUri, state }: { redirectUri: string; state: string }): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.LINE_LOGIN_CHANNEL_ID!,
    redirect_uri: redirectUri,
    state,
    scope: 'openid',
    bot_prompt: 'aggressive',
  });
  return `${AUTH_URL}?${params}`;
}

export class LineLoginError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

/** แลก code เป็น id_token แล้วตรวจสอบผ่าน /verify (คืน sub = LINE userId) — ไม่ใช้ JWKS ตรวจเองเพราะ
 * endpoint /verify ของ LINE ตรวจลายเซ็น+aud+exp ให้ครบในคำขอเดียว ง่ายกว่าและพลาดยากกว่า verify เอง */
export async function fetchLineLoginUserId({ code, redirectUri }: { code: string; redirectUri: string }): Promise<string> {
  const tokenRes = await loggedFetch('line-login', TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: process.env.LINE_LOGIN_CHANNEL_ID!,
      client_secret: process.env.LINE_LOGIN_CHANNEL_SECRET!,
    }),
  });
  const tokenBody: any = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !tokenBody.id_token) {
    throw new LineLoginError(`แลก token กับ LINE ไม่สำเร็จ: ${tokenBody.error_description ?? tokenBody.error ?? tokenRes.status}`);
  }

  const verifyRes = await loggedFetch('line-login', VERIFY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      id_token: tokenBody.id_token,
      client_id: process.env.LINE_LOGIN_CHANNEL_ID!,
    }),
  });
  const verifyBody: any = await verifyRes.json().catch(() => ({}));
  if (!verifyRes.ok || !verifyBody.sub) {
    throw new LineLoginError('ตรวจสอบตัวตนกับ LINE ไม่สำเร็จ');
  }
  return verifyBody.sub as string;
}
