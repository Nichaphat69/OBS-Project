import { Router } from 'express';
import { requireAuth } from '../lib/requireAuth.js';
import { requireAdmin } from '../lib/requireRole.js';
import {
  gmailInbox,
  readTimesheetFromEmail,
  dismissGmailMessage,
  undismissGmailMessage,
  listDismissedGmailMessages,
  GmailIntakeError,
} from '../lib/gmailService.js';
import { logAiRead } from '../lib/uploadService.js';
import { UploadError } from '../lib/uploadService.js';
import { ExtractionError } from '../lib/extractionService.js';
import { AbbyyError } from '../lib/abbyyClient.js';
import { SpreadsheetExtractionError } from '../lib/spreadsheetExtractionService.js';
import { GmailError } from '../lib/gmailClient.js';
import { randomBytes } from 'node:crypto';
import {
  googleEnabled,
  gmailConnectRedirectUri,
  buildGmailConsentUrl,
  exchangeGmailConsent,
  GoogleOAuthError,
} from '../lib/googleOAuth.js';
import {
  connectionStatus,
  saveConnection,
  disconnect,
  GmailConnectionError,
} from '../lib/gmailConnectionService.js';

export const gmailRouter = Router();

gmailRouter.use(requireAuth);
/**
 * ทั้งกลุ่มนี้เปิดให้ **admin กับแผนกบัญชีเท่านั้น** (เจ้าของระบบสั่ง 18 ก.ย. 69)
 *
 * เดิมมีแค่ `requireAuth` = ใครที่ล็อกอินก็เรียกได้ รวม role "user" ซึ่งแปลว่าพนักงานคนหนึ่ง
 * อ่านกล่องเมลวางบิลรวมของทั้งบริษัทได้ (หัวข้อ ผู้ส่ง ไฟล์แนบ), ส่ง `?query=` เป็น Gmail search
 * operator อะไรก็ได้, ยิง `/read` ดึง Timesheet ของเพื่อนร่วมงานออกมาทั้งใบได้ และ `/dismiss`
 * ซ่อนอีเมลลูกค้าออกจากคิวได้ซึ่งเป็นการ **เขียน** ไม่ใช่แค่อ่าน
 *
 * `/read` ยังสั่งให้เครื่องอ่าน (ABBYY/Clear Read) ทำงานด้วย ซึ่ง **คิดเงินต่อการเรียกหนึ่งครั้ง** —
 * ปล่อยไว้เท่ากับใครก็ได้กดเผาเครดิตได้ไม่จำกัด
 *
 * วางไว้ที่ระดับ router ไม่ใช่ไล่ใส่ทีละเส้น เพื่อไม่ให้เส้นที่เพิ่มทีหลังหลุดการป้องกันโดยลืม
 */
gmailRouter.use(requireAdmin);

gmailRouter.get('/inbox', async (req, res) => {
  try {
    const query = typeof req.query.query === 'string' ? req.query.query : undefined;
    const contractId = typeof req.query.contractId === 'string' ? req.query.contractId : undefined;
    const max = req.query.max ? Number(req.query.max) : undefined;
    res.json(await gmailInbox({ query, contractId, max }));
  } catch (error) {
    if (error instanceof GmailIntakeError || error instanceof GmailError) {
      return res.status((error as any).status ?? 502).json({ error: error.message });
    }
    throw error;
  }
});

gmailRouter.post('/read', async (req, res) => {
  try {
    const body = req.body ?? {};
    const result = await readTimesheetFromEmail({
      messageId: body.messageId,
      attachmentFilename: body.attachmentFilename,
      contractId: body.contractId ?? null,
      readerId: body.readerId ?? null,
      abbyySkillId: body.abbyySkillId ?? null,
    });
    const documentNo = await logAiRead({
      source: 'gmail',
      sourceEmailId: body.messageId,
      fileName: result.fileName,
      result,
      actor: req.user!.nameTh,
    });
    // rawResponse เก็บลง DB ผ่าน logAiRead() ด้านบนไปแล้ว (เพื่อ debug ย้อนหลัง) — ตัดออกก่อนตอบกลับ
    // client เสมอ ไม่ใช่ข้อมูลที่หน้าเว็บต้องใช้และอาจมีขนาดใหญ่โดยไม่จำเป็น
    const { rawResponse, ...clientResult } = result;
    res.json({ ...clientResult, documentNo });
  } catch (error) {
    if (
      error instanceof GmailIntakeError ||
      error instanceof GmailError ||
      error instanceof UploadError ||
      error instanceof ExtractionError ||
      error instanceof AbbyyError ||
      error instanceof SpreadsheetExtractionError
    ) {
      return res.status((error as any).status ?? 502).json({ error: error.message });
    }
    throw error;
  }
});

gmailRouter.post('/dismiss', async (req, res) => {
  const result = await dismissGmailMessage(req.body?.messageId, { actor: req.user!.nameTh });
  res.json(result);
});

gmailRouter.get('/dismissed', async (_req, res) => {
  res.json(await listDismissedGmailMessages());
});

gmailRouter.post('/undismiss', async (req, res) => {
  const result = await undismissGmailMessage(req.body?.messageId, { actor: req.user!.nameTh });
  res.json(result);
});

/* ── เชื่อมต่อกล่อง Gmail (แยกขั้นจากการล็อกอินด้วย Google) ──────────────────────────────────
 *
 * เดิม refresh token อยู่ในไฟล์ `.env` บนเครื่อง เปลี่ยนกล่องทีต้อง SSH เข้าไปแก้ไฟล์แล้วรีสตาร์ท
 * ซึ่งแปลว่าคนที่ใช้งานจริง (แผนกบัญชี) ทำเองไม่ได้เลย ต้องรอคนที่เข้าเครื่องได้เสมอ
 * สามเส้นนี้ย้ายงานนั้นมาไว้บนหน้าเว็บ (29 ก.ย. 69)
 *
 * เปิดให้ **admin กับแผนกบัญชี** เหมือนเส้นอื่นในไฟล์นี้ (requireAdmin ด้านบนครอบอยู่แล้ว) —
 * ตั้งใจไม่จำกัดแค่ admin เพราะคนที่ต้องกดคือ "เจ้าของกล่องเมล" ซึ่งคือฝั่งบัญชี ถ้าล็อกไว้แค่ admin
 * จะกลายเป็นว่าผูกกล่องของฝ่ายบัญชีไม่ได้เลย (Google ผูกสิทธิ์กับบัญชีที่ล็อกอินอยู่ในเบราว์เซอร์
 * ตอนกดยินยอม ไม่ใช่บัญชีที่ล็อกอินเข้า OBS)
 */
const GMAIL_STATE_COOKIE = 'obs_gmail_oauth_state';
const GMAIL_LINK_PAGE = '/gmail-link';

gmailRouter.get('/connection', async (_req, res) => {
  res.json(await connectionStatus());
});

gmailRouter.get('/connect/start', (req, res) => {
  if (!googleEnabled()) {
    return res.status(501).json({ error: 'ยังไม่ได้ตั้งค่า Google — ใส่ GOOGLE_CLIENT_ID/SECRET ใน .env ก่อน' });
  }
  const state = randomBytes(16).toString('hex');
  res.cookie(GMAIL_STATE_COOKIE, state, { httpOnly: true, sameSite: 'lax', maxAge: 300_000, path: '/' });
  res.redirect(302, buildGmailConsentUrl({ redirectUri: gmailConnectRedirectUri(req), state }));
});

gmailRouter.get('/connect/callback', async (req, res) => {
  const back = (params: Record<string, string>) => `${GMAIL_LINK_PAGE}?${new URLSearchParams(params)}`;
  try {
    const state = typeof req.query.state === 'string' ? req.query.state : null;
    const cookieState = req.cookies?.[GMAIL_STATE_COOKIE];
    if (!state || !cookieState || state !== cookieState) {
      throw new GmailConnectionError('หน้าเชื่อมต่อหมดอายุ — กดเชื่อมต่อใหม่อีกครั้ง');
    }
    res.clearCookie(GMAIL_STATE_COOKIE, { path: '/' });

    // คนกดยกเลิกที่หน้าจอของ Google — ไม่ใช่ข้อผิดพลาด ไม่ต้องขึ้นเป็นสีแดง
    if (typeof req.query.error === 'string') {
      return res.redirect(302, back({ cancelled: '1' }));
    }
    const code = typeof req.query.code === 'string' ? req.query.code : null;
    if (!code) throw new GmailConnectionError('Google ไม่ได้ส่ง code กลับมา');

    const consent = await exchangeGmailConsent({ code, redirectUri: gmailConnectRedirectUri(req) });
    await saveConnection({ ...consent, actor: req.user?.nameTh ?? req.user?.username ?? 'ไม่ทราบ' });
    res.redirect(302, back({ connected: consent.email }));
  } catch (error: any) {
    const message = error instanceof GmailConnectionError || error instanceof GoogleOAuthError
      ? error.message
      : 'เชื่อมต่อกล่องอีเมลไม่สำเร็จ ลองใหม่อีกครั้ง';
    res.redirect(302, back({ connectError: message }));
  }
});

gmailRouter.post('/connect/disconnect', async (req, res) => {
  try {
    res.json(await disconnect({ actor: req.user?.nameTh ?? req.user?.username ?? 'ไม่ทราบ' }));
  } catch (error) {
    if (error instanceof GmailConnectionError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});
