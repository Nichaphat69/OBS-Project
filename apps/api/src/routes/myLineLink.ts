import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { requireAuth } from '../lib/requireAuth.js';
import {
  startEmployeeLineLink,
  unlinkEmployeeLine,
  getEmployeeLineLinkStatus,
  linkEmployeeLineViaLogin,
  EmployeeLineLinkError,
} from '../lib/employeeLineLinkService.js';
import {
  startStaffLineLink,
  unlinkStaffLine,
  getStaffLineLinkStatus,
  linkStaffLineViaLogin,
  StaffLineLinkError,
} from '../lib/staffLineLinkService.js';
import { getLineAddFriendUrl } from '../lib/lineClient.js';
import { lineLoginEnabled, lineLoginRedirectUri, buildLineLoginUrl, fetchLineLoginUserId, LineLoginError } from '../lib/lineLoginClient.js';

const LINE_OAUTH_STATE_COOKIE = 'obs_line_oauth_state';

export const myLineLinkRouter = Router();
myLineLinkRouter.use(requireAuth);

/**
 * เดิมมีแต่ role 'user' ผูกไลน์ได้ (ผูกกับ Employee.lineUserId) — 24 ก.ย. 69 เปิดให้ admin/accounting
 * ผูกได้ด้วย (ผูกกับ User.lineUserId แทน คนละคอลัมน์ ดู staffLineLinkService.ts) เพื่อให้รู้ว่า "คนที่
 * แอดไลน์เข้ามาเป็น role อะไร" แล้วส่งแจ้งเตือนที่ตรงหน้าที่ให้อัตโนมัติ — หน้าเว็บ/route เดียวกันนี้
 * แตกสองทางภายในตาม role ไม่ได้เปิดหน้าคนละหน้า เพราะขั้นตอนแอดเพื่อน/พิมพ์รหัส/LINE Login เหมือนกันทุก
 * role เป๊ะๆ ต่างกันแค่ "จะเอาไปผูกกับ record ไหน"
 */
function isEmployeeRole(req: any): boolean {
  return req.user!.role === 'user';
}

function requireLinkable(req: any, res: any, next: any) {
  if (req.user!.role === 'user' && !req.user!.employeeId) {
    return res.status(400).json({ error: 'บัญชีนี้ยังไม่ได้ผูกกับพนักงานคนไหนเลย' });
  }
  next();
}

/** ลิงก์แอดเพื่อน OA สำหรับหน้า onboarding — ใช้สร้าง QR/ปุ่มก่อนขอรหัส 6 หลัก */
myLineLinkRouter.get('/oa-info', requireLinkable, async (_req, res) => {
  try {
    res.json({ addFriendUrl: await getLineAddFriendUrl() });
  } catch {
    res.status(502).json({ error: 'ดึงข้อมูล LINE OA ไม่สำเร็จ' });
  }
});

myLineLinkRouter.get('/status', requireLinkable, async (req, res) => {
  try {
    const status = isEmployeeRole(req)
      ? await getEmployeeLineLinkStatus(req.user!.employeeId!)
      : await getStaffLineLinkStatus(req.user!.username);
    res.json({ ...status, loginEnabled: lineLoginEnabled() });
  } catch (error) {
    if (error instanceof EmployeeLineLinkError || error instanceof StaffLineLinkError) {
      return res.status(error.status).json({ error: error.message });
    }
    throw error;
  }
});

/**
 * "เชื่อมต่อด้วย LINE Login" แบบคลิกเดียว — คู่กับ flow รหัส 6 หลักด้านล่าง ไม่ได้แทนที่ (ดู
 * lineLoginClient.ts) state เก็บใน cookie ชั่วคราวเทียบกับ query param ตอน callback (CSRF) วิธี
 * เดียวกับ /api/auth/google/start — apps/web's proxy route relay Set-Cookie นี้กลับไปให้ browser
 * (ดู apps/web/src/app/api/my-line-link/oauth/start/route.ts)
 */
myLineLinkRouter.get('/oauth/start', requireLinkable, (req, res) => {
  if (!lineLoginEnabled()) {
    return res.status(501).json({ error: 'ยังไม่ได้ตั้งค่า LINE Login — ใส่ LINE_LOGIN_CHANNEL_ID/SECRET ใน .env ก่อน' });
  }
  const state = randomBytes(16).toString('hex');
  res.cookie(LINE_OAUTH_STATE_COOKIE, state, { httpOnly: true, sameSite: 'lax', maxAge: 300_000, path: '/' });
  res.redirect(302, buildLineLoginUrl({ redirectUri: lineLoginRedirectUri(req), state }));
});

myLineLinkRouter.get('/oauth/callback', requireLinkable, async (req, res) => {
  try {
    const state = typeof req.query.state === 'string' ? req.query.state : null;
    const cookieState = req.cookies?.[LINE_OAUTH_STATE_COOKIE];
    if (!state || !cookieState || state !== cookieState) {
      throw new EmployeeLineLinkError('session สำหรับเชื่อมต่อ LINE หมดอายุ — ลองใหม่อีกครั้ง');
    }
    const code = typeof req.query.code === 'string' ? req.query.code : null;
    if (!code) throw new EmployeeLineLinkError('LINE ไม่ได้ส่ง code กลับมา');

    const lineUserId = await fetchLineLoginUserId({ code, redirectUri: lineLoginRedirectUri(req) });
    if (isEmployeeRole(req)) {
      await linkEmployeeLineViaLogin(req.user!.employeeId!, lineUserId);
    } else {
      await linkStaffLineViaLogin(req.user!.username, lineUserId);
    }
    res.clearCookie(LINE_OAUTH_STATE_COOKIE, { path: '/' });
    res.redirect(302, '/my-line-link?lineLinked=1');
  } catch (error: any) {
    res.clearCookie(LINE_OAUTH_STATE_COOKIE, { path: '/' });
    const message =
      error instanceof EmployeeLineLinkError || error instanceof StaffLineLinkError || error instanceof LineLoginError
        ? error.message
        : 'เชื่อมต่อ LINE ไม่สำเร็จ';
    res.redirect(302, `/my-line-link?lineLinkError=${encodeURIComponent(message)}`);
  }
});

myLineLinkRouter.post('/start', requireLinkable, async (req, res) => {
  try {
    res.json(isEmployeeRole(req) ? await startEmployeeLineLink(req.user!.employeeId!) : await startStaffLineLink(req.user!.username));
  } catch (error) {
    if (error instanceof EmployeeLineLinkError || error instanceof StaffLineLinkError) {
      return res.status(error.status).json({ error: error.message });
    }
    throw error;
  }
});

myLineLinkRouter.post('/unlink', requireLinkable, async (req, res) => {
  try {
    res.json(isEmployeeRole(req) ? await unlinkEmployeeLine(req.user!.employeeId!) : await unlinkStaffLine(req.user!.username));
  } catch (error) {
    if (error instanceof EmployeeLineLinkError || error instanceof StaffLineLinkError) {
      return res.status(error.status).json({ error: error.message });
    }
    throw error;
  }
});
