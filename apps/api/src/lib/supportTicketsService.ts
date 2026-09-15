/** แจ้งปัญหา (support tickets) — ported from service.js's listSupportTickets/
 * resolveSupportTicket/startSupportTicket/submitSupportTicket/buildMyTicketsText.
 *
 * Statuses are exactly 'open' → 'resolved', one-way — no reopen/delete/assign/comment in the
 * original, so none are ported here either. */
import { prisma } from '@obs/db';
import { logAudit } from './audit.js';
import { LineClient, TICKET_CATEGORIES, buildTicketNotifyFlex } from './lineClient.js';
import { lineApproverTargets } from './notificationRecipientsService.js';

export class SupportTicketError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export interface SupportTicketRow {
  id: number;
  employeeName: string;
  category: string;
  categoryLabel: string;
  description: string;
  status: string;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

/** ported from service.js listSupportTickets() — ใช้แสดงในหน้าเว็บ "แจ้งปัญหา" ของ admin */
export async function listSupportTickets({ status }: { status?: string | null } = {}): Promise<SupportTicketRow[]> {
  const rows = await prisma.supportTicket.findMany({
    where: status ? { status } : undefined,
    include: { employee: { select: { nameTh: true } } },
    orderBy: { id: 'desc' },
  });
  return rows.map((r) => ({
    id: r.id,
    employeeName: r.employee.nameTh,
    category: r.category,
    categoryLabel: TICKET_CATEGORIES[r.category] ?? r.category,
    description: r.description,
    status: r.status,
    createdAt: r.createdAt,
    resolvedAt: r.resolvedAt,
    resolvedBy: r.resolvedBy,
  }));
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
 * เลือกหมวด แล้วแจ้งฝ่ายบัญชี/admin ผ่าน LINE (ห่อ try/catch เพราะเป็นงานเสริม พังได้ก็แค่ log) */
export async function submitSupportTicket({
  employeeId,
  employeeName,
  category,
  description,
  client,
}: {
  employeeId: string;
  employeeName: string;
  category: string;
  description: string;
  client?: LineClient;
}) {
  const ticket = await prisma.supportTicket.create({
    data: { employeeId, category, description, status: 'open', createdAt: new Date().toISOString() },
  });
  await prisma.employee.update({ where: { id: employeeId }, data: { linePendingTicketCategory: null } });
  await logAudit({ actor: `line:${employeeId}`, action: 'create_support_ticket', entityType: 'support_ticket', entityId: String(ticket.id), detail: { category } });

  const line = client ?? new LineClient();
  try {
    const flex = buildTicketNotifyFlex({
      employeeName,
      categoryLabel: TICKET_CATEGORIES[category] ?? category,
      description,
      ticketId: ticket.id,
    });
    const targets = await lineApproverTargets();
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
