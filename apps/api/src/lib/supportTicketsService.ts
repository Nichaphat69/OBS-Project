/** แจ้งปัญหา (support tickets) — ported from service.js's listSupportTickets/
 * resolveSupportTicket/startSupportTicket/submitSupportTicket/buildMyTicketsText.
 *
 * Statuses are exactly 'open' → 'resolved', one-way — no reopen/delete/assign/comment in the
 * original, so none are ported here either. */
import { prisma } from '@obs/db';
import { logAudit } from './audit.js';
import { LineClient, TICKET_CATEGORIES, buildTicketNotifyFlex } from './lineClient.js';
import { lineAdminTargets } from './notificationRecipientsService.js';
import { storeFile } from './fileStorage.js';

export class SupportTicketError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export interface SupportTicketAttachmentMeta {
  id: number;
  fileName: string;
  mimeType: string;
}

export interface SupportTicketRow {
  id: number;
  employeeName: string;
  category: string;
  categoryLabel: string;
  description: string;
  pageContext: string | null;
  status: string;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  attachments: SupportTicketAttachmentMeta[];
}

/** ported from service.js listSupportTickets() — ใช้แสดงในหน้าเว็บ "แจ้งปัญหา" ของ admin */
export async function listSupportTickets({ status }: { status?: string | null } = {}): Promise<SupportTicketRow[]> {
  const rows = await prisma.supportTicket.findMany({
    where: status ? { status } : undefined,
    include: { employee: { select: { nameTh: true } }, attachments: { select: { id: true, fileName: true, mimeType: true } } },
    orderBy: { id: 'desc' },
  });
  return rows.map((r) => ({
    id: r.id,
    employeeName: r.employee.nameTh,
    category: r.category,
    categoryLabel: TICKET_CATEGORIES[r.category] ?? r.category,
    description: r.description,
    pageContext: r.pageContext,
    status: r.status,
    createdAt: r.createdAt,
    resolvedAt: r.resolvedAt,
    resolvedBy: r.resolvedBy,
    attachments: r.attachments,
  }));
}

/** ตั๋วของพนักงานคนเดียว — ใช้กับหน้าเว็บ "แจ้งปัญหา" ฝั่งพนักงาน (24 ก.ย. 69) ดูได้แค่ของตัวเองเท่านั้น
 * ยึด employeeId จากอาร์กิวเมนต์ตรงๆ ไม่รับ override — ผู้เรียก (route) ต้องส่ง req.user.employeeId มา
 * เท่านั้น ห้ามรับจาก query/body เด็ดขาด เหมือน pattern อื่นในระบบที่ห้าม endpoint "ของฉัน" ถามแทนคนอื่นได้ */
export async function listMySupportTickets(employeeId: string): Promise<SupportTicketRow[]> {
  const rows = await prisma.supportTicket.findMany({
    where: { employeeId },
    include: { employee: { select: { nameTh: true } }, attachments: { select: { id: true, fileName: true, mimeType: true } } },
    orderBy: { id: 'desc' },
  });
  return rows.map((r) => ({
    id: r.id,
    employeeName: r.employee.nameTh,
    category: r.category,
    categoryLabel: TICKET_CATEGORIES[r.category] ?? r.category,
    description: r.description,
    pageContext: r.pageContext,
    status: r.status,
    createdAt: r.createdAt,
    resolvedAt: r.resolvedAt,
    resolvedBy: r.resolvedBy,
    attachments: r.attachments,
  }));
}

/** ดึงรูปแนบมาแสดง/ดาวน์โหลด — ต้องเป็นเจ้าของตั๋ว (employeeId ตรงกัน) หรือ admin เท่านั้น ผู้เรียก
 * (route) ส่ง `viewerEmployeeId` มาจาก session เสมอ ไม่รับจาก query กันคนเดารูปแนบของคนอื่น */
export async function getSupportTicketAttachment(
  id: number,
  { viewerEmployeeId, isAdmin }: { viewerEmployeeId: string | null; isAdmin: boolean },
) {
  const attachment = await prisma.supportTicketAttachment.findUnique({
    where: { id },
    include: { ticket: { select: { employeeId: true } } },
  });
  if (!attachment) throw new SupportTicketError('ไม่พบไฟล์แนบนี้', 404);
  if (!isAdmin && attachment.ticket.employeeId !== viewerEmployeeId) {
    throw new SupportTicketError('ไม่มีสิทธิ์ดูไฟล์แนบนี้', 403);
  }
  return attachment;
}

/** ported from service.js resolveSupportTicket() — กดจากปุ่มในการ์ดแจ้งเตือน LINE หรือจากหน้าเว็บ ทั้งสองทางเรียกฟังก์ชันเดียวกันนี้ */
export async function resolveSupportTicket(id: number, { actor }: { actor: string }) {
  const ticket = await prisma.supportTicket.findUnique({ where: { id } });
  if (!ticket) throw new SupportTicketError(`ไม่พบตั๋วเลขที่ ${id}`, 404);

  const updated = await prisma.supportTicket.update({
    where: { id },
    data: { status: 'resolved', resolvedAt: new Date().toISOString(), resolvedBy: actor },
  });
  await logAudit({ actor, action: 'resolve_support_ticket', entityType: 'support_ticket', entityId: String(id), detail: {} });
  return updated;
}

/** ported from service.js startSupportTicket() — เรียกตอนกดปุ่มหมวดปัญหาในการ์ด "แจ้งปัญหา" แค่จำหมวด
 * ไว้รอข้อความรายละเอียดถัดไป ยังไม่สร้างตั๋วจริง */
export async function startSupportTicket(employeeId: string, category: string) {
  await prisma.employee.update({ where: { id: employeeId }, data: { linePendingTicketCategory: category } });
}

/** ported from service.js submitSupportTicket() — สร้างตั๋วจริงจากข้อความรายละเอียดที่พิมพ์ตามหลังการ
 * เลือกหมวด แล้วแจ้ง admin ผ่าน LINE (ห่อ try/catch เพราะเป็นงานเสริม พังได้ก็แค่ log)
 *
 * ⚠️ เดิมแจ้งไปที่ lineApproverTargets() (ฝ่ายบัญชี) แต่คนที่มีสิทธิ์เปิดดู/ปิดตั๋วจริงในหน้า "จัดการ
 * ระบบ" มีแค่ admin เท่านั้น (requireSuperAdmin ที่ routes/supportTickets.ts) บัญชีเห็นแจ้งเตือนแต่ทำ
 * อะไรกับมันไม่ได้เลย — แก้ให้ตรงกับ role จริงที่รับผิดชอบ (เจ้าของระบบยืนยัน 25 ก.ย. 69: admin รับ
 * แจ้งปัญหา/help/feedback, บัญชีรับแค่ตรวจ Manday/ขออนุมัติวางบิล ไม่ปนกัน)
 *
 * `attachments`/`pageContext`/`actor` เพิ่มทีหลัง (24 ก.ย. 69 — แจ้งปัญหาจากหน้าเว็บ แนบรูปได้ ต่างจาก
 * ทาง LINE เดิมที่พิมพ์ข้อความล้วนๆ) เว้นว่างได้ทั้งหมด ไม่กระทบเส้น LINE เดิมที่ไม่เคยส่งพวกนี้มาเลย —
 * `linePendingTicketCategory` เคลียร์เฉพาะตอนสร้างจาก LINE จริงๆ เท่านั้น (ฝั่งเว็บไม่เคยตั้งค่านี้ไว้
 * ตั้งแต่แรก เคลียร์ซ้ำก็ไม่เสียหายอะไร แต่ข้ามให้ชัดเจนว่าเป็นคนละที่มา) */
export async function submitSupportTicket({
  employeeId,
  employeeName,
  category,
  description,
  pageContext = null,
  attachments = [],
  actor,
  client,
}: {
  employeeId: string;
  employeeName: string;
  category: string;
  description: string;
  pageContext?: string | null;
  attachments?: Array<{ fileName: string; mimeType: string; fileBase64: string }>;
  actor?: string;
  client?: LineClient;
}) {
  const resolvedActor = actor ?? `line:${employeeId}`;
  // เก็บไฟล์ลง storage ให้เสร็จก่อน create เพราะ map() ข้างใน `create` เป็น sync จะ await ข้างในไม่ได้
  const attachmentRows = await Promise.all(
    attachments.map(async (a) => {
      const bytes = Buffer.from(a.fileBase64, 'base64');
      return {
        fileName: a.fileName,
        mimeType: a.mimeType,
        fileBytes: bytes,
        fileKey: await storeFile('support', bytes, { fileName: a.fileName, mimeType: a.mimeType }),
        createdAt: new Date().toISOString(),
      };
    }),
  );
  const ticket = await prisma.supportTicket.create({
    data: {
      employeeId, category, description, pageContext, status: 'open', createdAt: new Date().toISOString(),
      attachments: attachmentRows.length ? { create: attachmentRows } : undefined,
    },
  });
  await prisma.employee.update({ where: { id: employeeId }, data: { linePendingTicketCategory: null } });
  await logAudit({ actor: resolvedActor, action: 'create_support_ticket', entityType: 'support_ticket', entityId: String(ticket.id), detail: { category } });

  const line = client ?? new LineClient();
  try {
    const flex = buildTicketNotifyFlex({
      employeeName,
      categoryLabel: TICKET_CATEGORIES[category] ?? category,
      description,
      ticketId: ticket.id,
    });
    const targets = await lineAdminTargets();
    await line.pushToAll(targets, [{ type: 'flex', altText: `แจ้งปัญหาใหม่จาก${employeeName}`, contents: flex }]);
  } catch (error: any) {
    await logAudit({ actor: 'system', action: 'notify_support_ticket_error', entityType: 'support_ticket', entityId: String(ticket.id), detail: { message: error.message } });
  }
  return ticket;
}

/** ported from service.js buildMyTicketsText() — ข้อความสรุปตั๋วของพนักงานคนนี้ ใช้ตอบคำสั่ง "ตั๋วของฉัน" */
export async function buildMyTicketsText(employee: { id: string; nameTh: string }): Promise<string> {
  const tickets = await prisma.supportTicket.findMany({
    where: { employeeId: employee.id },
    orderBy: { id: 'desc' },
    take: 10,
    select: { id: true, category: true, status: true },
  });
  if (!tickets.length) return `คุณ${employee.nameTh} ยังไม่เคยแจ้งปัญหาไว้เลยครับ`;
  const lines = tickets.map((t) => `#${t.id} ${TICKET_CATEGORIES[t.category] ?? t.category} — ${t.status === 'resolved' ? 'แก้แล้ว ✅' : 'รอดำเนินการ'}`);
  return `📋 ตั๋วของคุณ${employee.nameTh}\n\n${lines.join('\n')}`;
}
