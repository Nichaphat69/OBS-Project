/**
 * แท็บ "ดึงจาก Gmail" — รายการไฟล์ Timesheet ที่ n8n ส่งเข้ามาเก็บไว้ (`inbound_emails`) รอให้คนกดอ่าน
 *
 * (30 ก.ย. 69) เดิมไฟล์นี้ไปอ่านกล่อง Gmail ด้วย token ของ OBS เอง ซึ่งหลุดทุกครั้งที่เจ้าของกล่อง
 * เปลี่ยนรหัสผ่าน และทำให้ระบบเข้าถึงกล่องเมลส่วนตัวของแผนกบัญชีได้ทั้งกล่อง — ตอนนี้ OBS ไม่แตะ Gmail
 * ในเส้นทางนี้เลย: กล่อง obs@ อ่านโดย n8n (Gmail Trigger) แล้วส่งเฉพาะ PDF ของอีเมลที่หัวเรื่องเป็น
 * Timesheet มาที่ `POST /api/timesheets/receive-email` (ดู inboundEmailService.ts)
 *
 * `readTimesheetFromEmail()` ยังทำเหมือนเดิม: ให้โมเดลอ่านเนื้ออีเมลดึงสถานะอนุมัติ/เลขเอกสาร/ผู้อนุมัติ
 * แล้วบล็อกถ้าสถานะไม่ใช่ "อนุมัติ" เป๊ะๆ หรือเดือนในอีเมลไม่ตรงกับในไฟล์ — ต่างแค่ว่าเนื้ออีเมลกับไฟล์
 * มาจากที่เก็บของเราเอง ไม่ใช่ดึงจาก Gmail ตอนกด
 *
 * ฟีเจอร์ร่างอีเมลวางบิลยังใช้ Gmail API ผ่าน gmailClient.ts แยกต่างหาก ไม่เกี่ยวกับไฟล์นี้
 */
import { prisma } from '@obs/db';
import { thaiMonth, normalizePeriod } from '@obs/domain';
import { readTimesheetFile, type ReadResult } from './uploadService.js';
import { readApprovalEmail } from './llmEmailService.js';
import { loadFile } from './fileStorage.js';
import { logAudit } from './audit.js';

/* ตัวกรองหัวเรื่องที่ตั้งไว้ใน Gmail Trigger ของ n8n (ไฟล์ n8n/01-obs-workflow.json) — เก็บไว้ที่นี่เพื่อ
 * แสดงในหน้าตั้งค่าเท่านั้น OBS ไม่ได้ใช้ค้นอะไรแล้ว · ตั้งใจไม่มีคำว่า "อนุมัติ" เดี่ยวๆ เพราะกว้างเกินไป
 * จะลากอีเมลเรื่องอื่นเข้ามาด้วย (ผู้ใช้กังวลเรื่องข้อมูลนอกเหนือจาก Timesheet) */
export const DEFAULT_GMAIL_QUERY =
  'subject:(timesheet OR timesheets OR "time sheet" OR "time-sheet" OR ตารางเข้างาน OR บันทึกเวลา) has:attachment filename:pdf';

export class GmailIntakeError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** ported from service.js senderDomain() — exported for its own test coverage, same as the original. */
export function senderDomain(from: string | null | undefined): string | null {
  const angle = /<([^>]+)>/.exec(from ?? '');
  const address = (angle ? angle[1] : from ?? '').trim();
  const at = address.lastIndexOf('@');
  return at === -1 ? null : address.slice(at + 1).toLowerCase();
}

export interface InboxMessage {
  id: string;
  subject: string;
  from: string;
  receivedAt: string | null;
  snippet: string;
  attachments: Array<{ filename: string; size: number; attachmentId: string; period?: string | null; documentNo?: string | null }>;
}

export interface GmailInboxResult {
  account: string;
  query: string;
  domain: string | null;
  activeCompanyName: string | null;
  domainMissing: boolean;
  skipped: number;
  messages: InboxMessage[];
  ingested: Array<InboxMessage & { period?: string | null; documentNo?: string | null; periodLabel?: string | null }>;
}

/** รายการไฟล์ที่ n8n ส่งมาและยังไม่มีใครกดอ่าน (+ รายการที่อ่านไปแล้ว แยกไว้อีกกอง) */
export async function gmailInbox({
  max = 50,
  contractId,
}: {
  query?: string;
  max?: number;
  contractId?: string;
} = {}): Promise<GmailInboxResult> {
  const contract = contractId ? await prisma.contract.findUnique({ where: { id: contractId }, include: { customer: true } }) : null;
  // customers.email_domain เก็บค่าไม่ตรงรูปแบบกัน (บาง row มี "@" นำหน้า บาง row ไม่มี) — ตัดทิ้งที่เดียวตรงนี้
  // ให้เทียบกับ senderDomain() (คืนค่าไม่มี @ เสมอ) ได้ตรงกัน (Big-C เจอจริง 15 ก.ย. 69)
  const activeDomain = (contract?.customer.emailDomain ?? '').trim().toLowerCase().replace(/^@+/, '') || null;
  const applyFilter = Boolean(contract);
  const domain = applyFilter ? activeDomain : null;
  const domainMissing = applyFilter && !activeDomain;

  const rows = await prisma.inboundEmail.findMany({ orderBy: { createdAt: 'desc' }, take: Math.max(1, max) * 10 });

  const byEmail = new Map<string, InboxMessage>();
  for (const r of rows) {
    let m = byEmail.get(r.sourceEmailId);
    if (!m) {
      m = {
        id: r.sourceEmailId,
        subject: r.subject ?? '',
        from: r.fromAddress ?? '',
        receivedAt: r.receivedAt,
        snippet: (r.bodyText ?? '').replace(/\s+/g, ' ').slice(0, 160),
        attachments: [],
      };
      byEmail.set(r.sourceEmailId, m);
    }
    m.attachments.push({ filename: r.fileName, size: r.fileSize, attachmentId: String(r.id) });
  }

  let messages = [...byEmail.values()];
  if (applyFilter && activeDomain) messages = messages.filter((m) => senderDomain(m.from) === activeDomain);
  messages = messages.slice(0, max);

  const known = new Map(
    (
      await prisma.aiRead.findMany({
        where: { sourceEmailId: { not: null }, status: { not: 'discarded' } },
        select: { sourceEmailId: true, fileName: true, period: true, documentNo: true },
      })
    ).map((r) => [`${r.sourceEmailId}::${r.fileName}`, { period: r.period, documentNo: r.documentNo }]),
  );
  const dismissed = new Set((await prisma.gmailDismissed.findMany({ select: { messageId: true } })).map((r) => r.messageId));

  const withAttachments = messages.map((m) => ({
    ...m,
    attachments: m.attachments.map((a) => ({ ...a, ...known.get(`${m.id}::${a.filename}`) })),
  }));

  return {
    account: 'n8n',
    query: DEFAULT_GMAIL_QUERY,
    domain,
    activeCompanyName: contract?.customer.nameTh ?? null,
    domainMissing,
    skipped: 0,
    messages: withAttachments
      .filter((m) => !dismissed.has(m.id) && m.attachments.some((a) => !a.documentNo))
      .map((m) => ({ ...m, attachments: m.attachments.filter((a) => !a.documentNo) })),
    ingested: withAttachments
      .filter((m) => m.attachments.every((a) => a.documentNo))
      .map((m) => {
        const meta: any = m.attachments[0] ?? {};
        return { ...m, ...meta, periodLabel: meta.period ? thaiMonth(meta.period) : null };
      }),
  };
}

/** อ่านไฟล์ที่ n8n ส่งมา (เนื้ออีเมล + PDF จากที่เก็บของเรา) — ไม่ติดต่อ Gmail */
export async function readTimesheetFromEmail({
  messageId,
  attachmentFilename,
  contractId = null,
  readerId = null,
  abbyySkillId = null,
}: {
  messageId: string;
  attachmentFilename?: string;
  contractId?: string | null;
  /** เดิมไม่มีทางเลือกตัวอ่าน/Skill เลย — ใช้ตัวที่ระบบตั้งไว้เสมอ (เจ้าของระบบสั่ง 25 ก.ย. 69 ให้เลือก
   * ได้เหมือนแท็บ "อัปโหลดไฟล์") ส่งต่อให้ readTimesheetFile() ตรงๆ ไม่กระทบพฤติกรรมเดิมถ้าไม่ได้ระบุ */
  readerId?: string | null;
  abbyySkillId?: string | null;
}): Promise<
  ReadResult & {
    fileBytes: Buffer | null;
    documentNo: string | null;
    approvedBy: string | null;
    approvedAt: string | null;
    sourceEmailId: string;
    email: { subject: string; from: string; receivedAt: string | null; body: string; meta: any };
  }
> {
  if (!messageId) throw new GmailIntakeError('ต้องระบุอีเมลที่จะดึง');
  const stored = await prisma.inboundEmail.findFirst({
    where: { sourceEmailId: messageId, ...(attachmentFilename ? { fileName: attachmentFilename } : {}) },
    orderBy: { id: 'asc' },
  });
  if (!stored) throw new GmailIntakeError('ไม่พบอีเมลฉบับนี้ในรายการที่ n8n ส่งมา', 404);
  const pdf = await loadFile(stored.fileKey);
  if (!pdf) throw new GmailIntakeError('หาไฟล์ PDF ของอีเมลฉบับนี้ในที่เก็บไฟล์ไม่เจอ', 404);
  const message = {
    subject: stored.subject ?? '',
    from: stored.fromAddress ?? '',
    date: stored.receivedAt,
    receivedAt: stored.receivedAt,
    body: stored.bodyText ?? '',
  };
  const target = { filename: stored.fileName };

  // อ่านเนื้ออีเมลกับอ่านไฟล์ PDF พร้อมกัน — สองอย่างนี้ไม่ขึ้นต่อกัน
  const [emailMeta, sheet] = await Promise.all([
    readApprovalEmail({ subject: message.subject, from: message.from, date: message.date as any, body: message.body }),
    readTimesheetFile({ fileBase64: pdf.toString('base64'), fileName: target.filename, contractId, readerId, abbyySkillId }),
  ]);

  const blockers = [...sheet.blockers];

  // เอกสารข้อ 1.2 บังคับว่าต้องเป็น "อนุมัติ" เท่านั้นจึงเอาเข้าระบบได้ — เทียบตรงตัวเป๊ะๆ ห้ามใช้
  // .includes เพราะ "รออนุมัติ" ก็มีคำว่า "อนุมัติ" อยู่ในนั้นเหมือนกัน
  if (emailMeta.approvalStatus && emailMeta.approvalStatus !== 'อนุมัติ') {
    blockers.push(`อีเมลระบุสถานะ "${emailMeta.approvalStatus}" ไม่ใช่ "อนุมัติ"`);
  }

  // เดือนในอีเมลกับในไฟล์ไม่ตรงกัน = หยิบไฟล์ผิดฉบับ ต้องให้คนดูก่อน — normalizePeriod ทั้งสองฝั่งก่อน
  // เทียบ เพราะโมเดลในเครื่อง (ตัวเล็ก) บางทีตอบมาเป็น "มกราคม 2026" ดิบๆ แทน "2026-01" ตรงๆ
  const emailPeriod = normalizePeriod(emailMeta.period);
  if (emailPeriod && sheet.data.period && emailPeriod !== sheet.data.period) {
    blockers.push(`อีเมลบอกรอบ ${emailMeta.period} แต่ในไฟล์เป็น ${sheet.data.period}`);
  }

  await logAudit({
    actor: 'llm',
    action: 'read_email_approval',
    entityType: 'timesheet',
    entityId: emailMeta.documentNo ?? messageId,
    detail: { model: emailMeta.model, subject: message.subject, documentNo: emailMeta.documentNo, status: emailMeta.approvalStatus },
  });

  return {
    ...sheet,
    blockers,
    documentNo: (sheet.data as any)?.documentNo ?? emailMeta.documentNo ?? null,
    approvedBy: emailMeta.approvedBy ?? null,
    approvedAt: emailMeta.approvedAt ?? null,
    sourceEmailId: messageId,
    email: {
      subject: message.subject,
      from: message.from,
      receivedAt: message.receivedAt,
      body: message.body.slice(0, 4000),
      meta: emailMeta,
    },
  };
}

/** ported from service.js dismissGmailMessage() */
export async function dismissGmailMessage(messageId: string, { actor }: { actor: string }) {
  if (!messageId) throw new GmailIntakeError('ต้องระบุอีเมลที่จะซ่อน');
  await prisma.gmailDismissed.upsert({
    where: { messageId },
    create: { messageId, dismissedBy: actor, dismissedAt: new Date().toISOString() },
    update: {},
  });
  await logAudit({ actor, action: 'dismiss_gmail_message', entityType: 'gmail_message', entityId: messageId, detail: {} });
  return { dismissed: true };
}

/** ported from service.js undismissGmailMessage() */
export async function undismissGmailMessage(messageId: string, { actor }: { actor: string }) {
  if (!messageId) throw new GmailIntakeError('ต้องระบุอีเมลที่จะเลิกซ่อน');
  await prisma.gmailDismissed.deleteMany({ where: { messageId } });
  await logAudit({ actor, action: 'undismiss_gmail_message', entityType: 'gmail_message', entityId: messageId, detail: {} });
  return { dismissed: false };
}

/** รายการที่ซ่อนไว้ — หัวเรื่อง/ผู้ส่งดึงจากที่เก็บของเราเอง ไม่ต้องไปถาม Gmail */
export async function listDismissedGmailMessages() {
  const rows = await prisma.gmailDismissed.findMany({ orderBy: { dismissedAt: 'desc' } });
  if (!rows.length) return [];
  const mails = await prisma.inboundEmail.findMany({
    where: { sourceEmailId: { in: rows.map((r) => r.messageId) } },
    orderBy: { id: 'asc' },
  });
  const first = new Map<string, (typeof mails)[number]>();
  for (const m of mails) if (!first.has(m.sourceEmailId)) first.set(m.sourceEmailId, m);
  return rows.map((row) => {
    const m = first.get(row.messageId);
    return {
      id: row.messageId,
      subject: m?.subject ?? null,
      from: m?.fromAddress ?? null,
      receivedAt: m?.receivedAt ?? null,
      dismissedBy: row.dismissedBy,
      dismissedAt: row.dismissedAt,
    };
  });
}
