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
