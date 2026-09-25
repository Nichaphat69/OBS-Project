// ต้อง import ก่อน route ใดๆ ทั้งหมด — patch ตัว Router ให้ async handler ที่ throw/reject ส่งต่อเข้า
// error-handling middleware ท้ายไฟล์นี้เองอัตโนมัติ (Express 4 ไม่ทำให้อัตโนมัติ ต่างจาก Express 5)
// ไม่งั้น error ที่ route handler ไหนไม่ได้ catch เอง (เช่น throw ต่อจาก catch block ที่รู้จักแค่บาง
// error type) จะเป็น unhandled promise rejection — ทำให้ request นั้นค้างไม่ตอบอะไรกลับไปเลย หรือแย่กว่า
// นั้นคือทำให้ทั้งโปรเซส Node ตาย (unhandledRejection ปิดโปรเซสเป็นค่าเริ่มต้นตั้งแต่ Node 15) กระทบทุก
// request ที่ค้างอยู่พร้อมกัน ไม่ใช่แค่ตัวที่พัง (เจอจริง 15 ก.ย. 69 ตอนไล่ตรวจ audit ทั้งระบบ)
import 'express-async-errors';
import * as Sentry from '@sentry/node';

// error tracking ฝั่ง production (เจ้าของระบบสั่ง 24 ก.ย. 69 — "ไม่มี error tracking บั๊กฝั่ง production
// จะไม่มีใครรู้จนกว่าจะมีคนแจ้ง") — ปิดเงียบๆ ถ้ายังไม่ตั้ง SENTRY_DSN (ต้องสมัคร Sentry เองแล้วเอา DSN
// มาใส่ .env — ไม่ใช่ค่าที่เดา/ฝังในโค้ดได้) ต้อง init ก่อน import อื่นที่อาจ throw ทั้งหมด
if (process.env.SENTRY_DSN) {
  Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0.1 });
}

import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { authRouter } from './routes/auth.js';
import { dashboardRouter } from './routes/dashboard.js';
import { timesheetsRouter } from './routes/timesheets.js';
import { cyclesRouter } from './routes/cycles.js';
import { invoicesRouter } from './routes/invoices.js';
import { aiReadsRouter } from './routes/aiReads.js';
import { gmailRouter } from './routes/gmail.js';
import { usersRouter } from './routes/users.js';
import { auditLogRouter } from './routes/auditLog.js';
import { notificationRecipientsRouter, lineRouter } from './routes/notificationRecipients.js';
import { abbyySkillsRouter } from './routes/abbyySkills.js';
import { customersRouter } from './routes/customers.js';
import { employeesRouter } from './routes/employees.js';
import { lineWebhookRouter } from './routes/lineWebhook.js';
import { supportTicketsRouter } from './routes/supportTickets.js';
import { myLineLinkRouter } from './routes/myLineLink.js';
import { timesheetRemindersRouter } from './routes/timesheetReminders.js';
import { pulseRouter } from './routes/pulse.js';
import { contractsRouter } from './routes/contracts.js';
import { streamRouter } from './routes/stream.js';
import { activityRouter, myNotificationsRouter } from './routes/activity.js';
import { myProgressRouter } from './routes/myProgress.js';
import { settingsRouter } from './routes/settings.js';
import { timesheetSubmissionsRouter } from './routes/timesheetSubmissions.js';
import { assignmentsRouter } from './routes/assignments.js';
import { holidaysRouter } from './routes/holidays.js';
import { flowAccountCompaniesRouter } from './routes/flowaccountCompanies.js';
import { hrddRouter } from './routes/hrdd.js';
import { apiActivityLogRouter } from './routes/apiActivityLog.js';
import { keepModelWarm } from './lib/localLlmClient.js';
import { startQueueWorker } from './lib/readQueueService.js';
import { notifyApiError } from './lib/errorAlertService.js';

const app = express();

// LINE webhook ต้องมาก่อน express.json() เสมอ — ต้องการ raw body (ยังไม่ผ่าน JSON.parse) เพื่อตรวจ
// ลายเซ็น HMAC ให้ตรง ถ้า mount หลัง express.json() ตัวหลัก body stream จะถูกอ่าน/แปลงไปแล้ว
app.use('/api/line', lineWebhookRouter);

// เพิ่ม limit จากค่าเริ่มต้น 100kb — หน้าอัปโหลด Timesheet ส่งไฟล์ PDF (จำกัด 8MB) เป็น base64 มาใน body
app.use(express.json({ limit: '15mb' }));
app.use(cookieParser());
// อนุญาต origin ของ apps/web เท่านั้น (ถ้าตั้งไว้) — ถ้าใช้ Next.js route handler proxy (same-origin
// จากมุมมอง browser) จะไม่ได้ใช้เส้นทางนี้เลย เพราะ Next.js server เรียก api ตรงๆ (ไม่ผ่าน browser)
app.use(
  cors({
    origin: process.env.WEB_ORIGIN ?? true,
    credentials: true,
  }),
);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'obs-api', time: new Date().toISOString() });
});

app.use('/api/auth', authRouter);
app.use('/api/dashboard', dashboardRouter);
// public/n8n เหมือน /api/line/webhook ด้านบน — ต้อง mount ก่อน timesheetsRouter ที่ requireAuth ทั้งหมด
app.use('/api/timesheets', timesheetRemindersRouter);
app.use('/api/timesheets', timesheetsRouter);
app.use('/api/cycles', cyclesRouter);
app.use('/api/invoices', invoicesRouter);
app.use('/api/ai-reads', aiReadsRouter);
app.use('/api/gmail', gmailRouter);
app.use('/api/users', usersRouter);
app.use('/api/audit-log', auditLogRouter);
app.use('/api/notification-recipients', notificationRecipientsRouter);
app.use('/api/line', lineRouter);
app.use('/api/abbyy-skills', abbyySkillsRouter);
app.use('/api/customers', customersRouter);
app.use('/api/employees', employeesRouter);
app.use('/api/support-tickets', supportTicketsRouter);
app.use('/api/my-line-link', myLineLinkRouter);
app.use('/api/pulse', pulseRouter);
app.use('/api/contracts', contractsRouter);
app.use('/api/stream', streamRouter);
app.use('/api/activity', activityRouter);
app.use('/api/my-notifications', myNotificationsRouter);
app.use('/api/my-progress', myProgressRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/timesheet-submissions', timesheetSubmissionsRouter);
app.use('/api/assignments', assignmentsRouter);
app.use('/api/holidays', holidaysRouter);
app.use('/api/flowaccount', flowAccountCompaniesRouter);
app.use('/api', hrddRouter);
app.use('/api/api-activity-log', apiActivityLogRouter);

// ส่ง error ที่ route ไหนไม่จับเองเข้า Sentry ก่อนถึงตัวจับสุดท้ายด้านล่าง (ปิดเงียบๆ ถ้าไม่มี SENTRY_DSN)
if (process.env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app);
}

// ตัวจับ error สุดท้าย (ไม่มีมาก่อนเลยในระบบใหม่ — เจอจริง 15 ก.ย. 69) — ต้องมี 4 พารามิเตอร์ตรงตาม
// สเปกของ Express ถึงจะถูกจดจำเป็น error-handling middleware (ไม่ใช่ middleware ปกติ) ต้อง mount
// หลังสุดหลังทุก route แล้ว — ครอบทั้ง error ที่แต่ละ route ไม่รู้จัก type (throw ต่อจาก catch block เดิม)
// และ error ที่ route ไหนไม่ได้ catch เองเลย (ต้องพึ่ง express-async-errors ด้านบนส่งมาถึงตรงนี้)
// ไม่ log stack เต็มลง response (อาจรั่วรายละเอียดภายใน) แต่ log เต็มไว้ฝั่งเซิร์ฟเวอร์เสมอ
app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[obs-api] unhandled error', err);

  // ข้อความดิบของ Prisma ("Invalid `prisma.xxx.delete()` invocation: Foreign key constraint
  // violated...") หลุดไปให้ user เห็นตรงๆ มาก่อน (เจ้าของระบบเจอจริง 25 ก.ย. 69 ตอนลบสัญญาที่มีพนักงาน
  // เคยแจ้งปัญหาไว้) จุดที่รู้สาเหตุแน่ชัดควร throw error ที่มีข้อความเฉพาะเจาะจงกว่านี้เอง (ดู
  // deleteContract() เป็นตัวอย่าง) อันนี้เป็นแค่ตาข่ายกันสุดท้ายเผื่อมีจุดอื่นที่ยังไม่เจอ ไม่ใช่ error
  // ของระบบจริงๆ (แค่ทำรายการไม่ได้เพราะมีข้อมูลอื่นผูกอยู่) จึงตอบ 400 ไม่ใช่ 500 — ไม่ต้องปลุกใครทาง LINE
  if (err?.code === 'P2003') {
    return res.status(400).json({ error: 'ลบไม่ได้ — มีข้อมูลอื่นในระบบผูกอยู่กับรายการนี้' });
  }

  const status = typeof err?.status === 'number' ? err.status : 500;
  // แจ้ง LINE เฉพาะ 5xx จริง (ระบบพัง) — 4xx (validation/สิทธิ์ไม่พอ ฯลฯ) เป็นการทำงานปกติของแอป ไม่ใช่
  // เหตุที่ต้องปลุกใครกลางดึก (เจ้าของระบบสั่ง 24 ก.ย. 69) ไม่ await เพราะไม่อยากให้ผู้ใช้รอ LINE ส่งเสร็จ
  // ก่อนได้ response error กลับไป — ส่งพังก็แค่ log เงียบๆ (ดู errorAlertService.ts)
  if (status >= 500) {
    notifyApiError(err, { method: req.method, path: req.path }).catch(() => {});
  }
  if (res.headersSent) return;
  res.status(status).json({ error: err?.message || 'เกิดข้อผิดพลาดที่ไม่คาดคิด' });
});

const port = Number(process.env.PORT ?? 4301);
app.listen(port, () => {
  console.log(`[obs-api] listening on :${port}`);
});

// กันโมเดล vision ในเครื่องหลุดจากหน่วยความจำตอนไม่มีใครเรียกนาน — บางเซิร์ฟเวอร์ตั้ง TTL ปลดโมเดลไว้
// 1 ชม. ปิงถี่กว่านั้นมากพอให้โมเดลไม่ว่างจนถูกปลด ผิดพลาดได้ก็แค่ log เงียบๆ ไม่กระทบการทำงานหลัก —
// ported from server.js's setInterval(keepModelWarm, 20*60_000)
setInterval(() => {
  keepModelWarm();
}, 20 * 60_000).unref();

// เริ่ม worker ของคิวอ่าน Timesheet หลายไฟล์พร้อมกัน (23 ก.ย. 69) — รีเซ็ตแถวที่ค้าง 'running' จาก
// server restart กลางคันกลับเป็น 'queued' ก่อน แล้วเริ่ม poll หาแถว 'queued' ทุก 3 วิ ดู readQueueService.ts
startQueueWorker().catch((error) => console.error('[readQueueService] เริ่ม worker ไม่สำเร็จ —', error));
