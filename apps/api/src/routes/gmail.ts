import { Router } from 'express';
import { requireAuth } from '../lib/requireAuth.js';
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
