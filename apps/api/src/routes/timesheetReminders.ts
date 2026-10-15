import { Router } from 'express';
import { requireN8nSecret } from '../lib/n8nAuth.js';
import { sendOverdueTimesheetReminders } from '../lib/timesheetSubmissionService.js';
import { ingestTimesheet, IngestError } from '../lib/ingestService.js';
import { extractTimesheet, ExtractionError } from '../lib/extractionService.js';
import { AbbyyError } from '../lib/abbyyClient.js';
import { receiveInboundEmail, InboundEmailError } from '../lib/inboundEmailService.js';
import { logExposedRequest } from '../lib/apiActivityLog.js';

/** เส้นทางที่ n8n เรียกตรงเข้ามาโดยไม่มี session ใดๆ — เดิม (`src/server.js`'s `PUBLIC_API_PATTERNS`)
 * ไม่มี auth เลย ตอนพอร์ตมาสแต็กใหม่ปิดช่องนั้นด้วย shared secret (`requireN8nSecret`, ดู
 * n8nAuth.ts) ซึ่งเป็นการปรับปรุงเรื่องความปลอดภัยที่ตั้งใจทำเพิ่ม ไม่ใช่ 1:1 port ของต้นฉบับ
 *
 * ต้อง mount ก่อน timesheetsRouter ที่ requireAuth ทั้งหมด (ดู server.ts) — เส้นทางในไฟล์นี้ทับกับ
 * `/api/timesheets/*` แต่ต้องไม่ผ่าน requireAuth เลย */
export const timesheetRemindersRouter = Router();

timesheetRemindersRouter.post('/send-overdue-reminders', logExposedRequest('n8n'), requireN8nSecret, async (_req, res) => {
  res.json(await sendOverdueTimesheetReminders({}));
});

// ported from service.js's n8n entrypoint for ingestTimesheet() — ดู n8n/README.md's
// `POST /api/timesheets/ingest`. รับเฉพาะ fileBase64 (ไม่รับ filePath เหมือนต้นฉบับ — n8n กับสแต็ก
// Docker นี้ไม่ได้แชร์ filesystem เดียวกัน)
timesheetRemindersRouter.post('/ingest', logExposedRequest('n8n'), requireN8nSecret, async (req, res) => {
  try {
    const body = req.body ?? {};
    const result = await ingestTimesheet({
      documentNo: body.documentNo,
      fileBytes: typeof body.fileBase64 === 'string' ? Buffer.from(body.fileBase64, 'base64') : null,
      fileName: body.fileName ?? null,
      sourceEmailId: body.sourceEmailId ?? null,
      sourceEmailSubject: body.sourceEmailSubject ?? null,
      receivedAt: body.receivedAt ?? new Date().toISOString(),
      approvedBy: body.approvedBy ?? null,
      approvedAt: body.approvedAt ?? null,
      expectedPeriod: body.expectedPeriod,
      actor: 'n8n',
      submissionMethod: 'auto_gmail',
      extractor: extractTimesheet,
    });
    res.json(result);
  } catch (error) {
    if (error instanceof IngestError || error instanceof ExtractionError || error instanceof AbbyyError) {
      return res.status((error as any).status ?? 502).json({ error: error.message });
    }
    throw error;
  }
});

/**
 * รับไฟล์ Timesheet จาก n8n "เก็บไว้รอคนกดอ่าน" (30 ก.ย. 69) — ไม่เรียกโมเดล ไม่ตั้งสถานะอะไร
 * แค่เก็บไฟล์กับหัวเรื่อง/ผู้ส่ง/เนื้ออีเมลไว้ให้โผล่ในแท็บ "ดึงจาก Gmail" · ส่งซ้ำได้ (คืน duplicate: true)
 * การอ่านเกิดตอนคนกดปุ่มเท่านั้น และการขออนุมัติออก INV เข้า LINE ต้องรอหลังขั้น "ตรวจ Manday" จึงไม่ใช่
 * หน้าที่ของ workflow สายนี้ */
timesheetRemindersRouter.post('/receive-email', logExposedRequest('n8n'), requireN8nSecret, async (req, res) => {
  try {
    res.json(await receiveInboundEmail(req.body ?? {}));
  } catch (error) {
    if (error instanceof InboundEmailError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});
