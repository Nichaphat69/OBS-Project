import { Router } from 'express';
import { requireAuth } from '../lib/requireAuth.js';
import { requireSuperAdmin } from '../lib/requireRole.js';
import { TICKET_CATEGORIES } from '../lib/lineClient.js';
import {
  getSupportTicketAttachment,
  listMySupportTickets,
  listSupportTickets,
  resolveSupportTicket,
  submitSupportTicket,
  SupportTicketError,
} from '../lib/supportTicketsService.js';

export const supportTicketsRouter = Router();

// ทุกเส้นต้องล็อกอินก่อนเสมอ — ส่วนที่จำกัดแค่ admin ค่อยแปะ requireSuperAdmin ต่อรายเส้น (เหมือน
// timesheetSubmissions.ts) เพราะ "ของฉัน" (แจ้งปัญหา/ดูตั๋วตัวเอง) ต้องเปิดให้ role 'user' ใช้ได้ด้วย
// (24 ก.ย. 69 — เจ้าของระบบสั่งให้พนักงานแจ้งปัญหาจากเว็บได้ ไม่ใช่แค่ทาง LINE เหมือนเดิม)
supportTicketsRouter.use(requireAuth);

/** หมวดปัญหาให้เลือก — ใช้ค่าเดียวกับที่ LINE ใช้อยู่แล้ว (bug/manday/timesheet/suggestion) ไม่แยก
 * ชุดใหม่ต่างหาก กันหมวดปัญหาเดียวกันถูกเรียกคนละชื่อระหว่างสองช่องทาง */
supportTicketsRouter.get('/categories', (_req, res) => {
  res.json(TICKET_CATEGORIES);
});

/** ของฉัน — role 'user' เท่านั้นที่มี employeeId แบบนี้ตามการออกแบบระบบ (admin/accounting ไม่ผูก
 * พนักงาน) บัญชีที่ยังไม่ได้ผูกพนักงานเลยแจ้งปัญหาทางนี้ไม่ได้ ต้องใช้ทาง LINE แทนไปก่อน */
supportTicketsRouter.get('/mine', async (req, res) => {
  if (!req.user!.employeeId) return res.json([]);
  res.json(await listMySupportTickets(req.user!.employeeId));
});

supportTicketsRouter.post('/mine', async (req, res) => {
  const employeeId = req.user!.employeeId;
  if (!employeeId) {
    return res.status(403).json({ error: 'บัญชีนี้ยังไม่ได้ผูกกับพนักงาน — แจ้งปัญหาผ่านเว็บได้เฉพาะบัญชีที่ผูกพนักงานแล้วเท่านั้น' });
  }
  const body = req.body ?? {};
  const category = typeof body.category === 'string' ? body.category : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  if (!category || !TICKET_CATEGORIES[category]) return res.status(400).json({ error: 'เลือกหมวดปัญหาให้ถูกต้อง' });
  if (!description) return res.status(400).json({ error: 'กรอกรายละเอียดปัญหาก่อน' });

  const attachments = Array.isArray(body.attachments)
    ? body.attachments
        .filter((a: any) => a && typeof a.fileBase64 === 'string' && a.fileBase64)
        .map((a: any) => ({
          fileName: String(a.fileName ?? 'รูปแนบ'),
          mimeType: String(a.mimeType ?? 'application/octet-stream'),
          fileBase64: String(a.fileBase64),
        }))
    : [];
  if (attachments.length > 5) return res.status(400).json({ error: 'แนบได้ไม่เกิน 5 รูปต่อครั้ง' });

  const ticket = await submitSupportTicket({
    employeeId,
    employeeName: req.user!.nameTh,
    category,
    description,
    pageContext: typeof body.pageContext === 'string' ? body.pageContext.slice(0, 200) : null,
    attachments,
    actor: req.user!.nameTh,
  });
  res.json({ id: ticket.id });
});

/** ดูรูปแนบ — เจ้าของตั๋วหรือ admin เท่านั้น */
supportTicketsRouter.get('/attachments/:id', async (req, res) => {
  try {
    const attachment = await getSupportTicketAttachment(Number(req.params.id), {
      viewerEmployeeId: req.user!.employeeId,
      isAdmin: req.user!.role === 'admin',
    });
    res.setHeader('Content-Type', attachment.mimeType);
    res.send(Buffer.from(attachment.fileBytes));
  } catch (error) {
    if (error instanceof SupportTicketError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

// จำกัดเหลือ admin เท่านั้นตั้งแต่นี้ลงไป (commit 9bd675c "จำกัดเมนู 'แจ้งปัญหา' ให้เห็นได้เฉพาะ role
// admin" — เดิม accounting เห็นด้วย เปลี่ยนใจให้ admin ดูแลเรื่องนี้คนเดียวพอ) — รายการ "ทุกตั๋วในระบบ"
// กับปุ่มปิดตั๋วยังเป็นของ admin เท่านั้น ต่างจาก /mine ด้านบนที่เปิดให้ทุก role ที่ล็อกอินอยู่
supportTicketsRouter.use(requireSuperAdmin);

supportTicketsRouter.get('/', async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  res.json(await listSupportTickets({ status }));
});

supportTicketsRouter.post('/:id/resolve', async (req, res) => {
  try {
    res.json(await resolveSupportTicket(Number(req.params.id), { actor: req.user!.nameTh }));
  } catch (error) {
    if (error instanceof SupportTicketError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});
