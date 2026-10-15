/**
 * อีเมล INV — สร้าง "ร่าง" ในกล่อง Drafts พร้อมไฟล์แนบ แล้วตามดูว่าถูกกดส่งหรือยัง
 *
 * ported from src/service.js's `createGmailDraft()` / `syncEmailSent()` / `cacheInvoicePdf()` /
 * `getInvoiceFile()` / `getTimesheetFile()` / `invoiceFileName()`
 *
 * ⚠️ กติกาที่ห้ามละเมิดเด็ดขาด: เส้นนี้สร้างได้แค่ "ร่าง" เท่านั้น ห้ามเรียก `sendMessage()` ไม่ว่ากรณีใด
 * อีเมลฝั่งธุรกิจต้องให้คนกดส่งเองเสมอ — เจ้าของระบบอนุญาตให้ส่งอัตโนมัติเฉพาะอีเมลรหัสยืนยันตอนลืม
 * รหัสผ่านเรื่องเดียว (ดูคอมเมนต์หัว gmailClient.ts) มีเทสดักไว้แล้วว่า createDraft ต้องไม่ยิงไปที่
 * /messages/send — ห้ามลบเทสตัวนั้น
 */
import { prisma } from '@obs/db';
import { GmailClient, hasGmailCredentials } from './gmailClient.js';
import { FlowAccountClient } from './flowaccountClient.js';
import { previewCycleInvoice } from './cyclesService.js';
import { getSetting } from './dashboardService.js';
import { logAudit } from './audit.js';
import { loadFile, storeFile } from './fileStorage.js';

export class InvoiceEmailError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** ported from service.js invoiceFileName() */
function invoiceFileName({ documentNo, id }: { documentNo: string | null; id: string }): string {
  return `INV ${documentNo || id}.pdf`;
}

export interface AttachmentFile {
  filename: string;
  bytes: Buffer;
}

/**
 * ดึงไฟล์INV จากหน้า share ของ FlowAccount มาเก็บไว้ในฐานข้อมูล — ported from cacheInvoicePdf()
 *
 * ปกติไฟล์ถูกเก็บไว้ตั้งแต่ตอนอนุมัติรอบบิลแล้ว (ดู approveCycle) ทางนี้เป็นตาข่ายรับสำหรับใบที่อนุมัติ
 * ไปก่อนจะมีฟีเจอร์เก็บไฟล์ หรือใบที่ตอนนั้นดึงไม่สำเร็จ — ล้มเหลวแล้วคืน null เฉยๆ ไม่ throw เพราะ
 * การสร้างร่างอีเมลไม่ควรพังทั้งฉบับเพราะแนบไฟล์ใบเดียวไม่ได้
 */
export async function cacheInvoicePdf(
  invoiceId: string,
  shareLink: string | null,
  { client, actor = 'system' }: { client?: FlowAccountClient; actor?: string } = {},
): Promise<Buffer | null> {
  if (!shareLink) return null;
  const fa = client ?? new FlowAccountClient();
  try {
    const { bytes } = await fa.fetchSharedPdf(shareLink);
    const documentPdfKey = await storeFile('invoice', bytes, { fileName: `${invoiceId}.pdf`, mimeType: 'application/pdf' });
    await prisma.invoice.update({ where: { id: invoiceId }, data: { documentPdfKey } });
    return bytes;
  } catch (error: any) {
    await logAudit({
      actor,
      action: 'flowaccount_pdf_fetch_failed',
      entityType: 'invoice',
      entityId: invoiceId,
      detail: { message: error.message },
    });
    return null;
  }
}

/** ported from service.js getInvoiceFile() — ใช้ไฟล์ที่ cache ไว้ก่อน ไม่มีค่อยไปดึงจาก share link */
export async function getInvoiceFile(
  id: string,
  { client }: { client?: FlowAccountClient } = {},
): Promise<AttachmentFile | null> {
  const row = await prisma.invoice.findUnique({
    where: { id },
    select: { id: true, documentNo: true, shareLink: true, documentPdfKey: true },
  });
  if (!row) return null;

  const filename = invoiceFileName(row);
  const cached = await loadFile(row.documentPdfKey);
  if (cached) return { filename, bytes: cached };

  const bytes = await cacheInvoicePdf(row.id, row.shareLink, { client });
  return bytes ? { filename, bytes } : null;
}

/** ported from service.js getTimesheetFile() */
export async function getTimesheetFile(id: string): Promise<AttachmentFile | null> {
  const row = await prisma.timesheet.findUnique({
    where: { id },
    select: { id: true, sourceFile: true, sourceFileKey: true },
  });
  const bytes = await loadFile(row?.sourceFileKey);
  if (!row || !bytes) return null;
  return { filename: row.sourceFile || `${row.id}.pdf`, bytes };
}

/** เติมINV เข้าไปในรายการไฟล์แนบของร่างที่บันทึกไว้ก่อนหน้า — ported from withInvoiceAttachment()
 * ร่างที่บันทึกตอนยังไม่อนุมัติจะไม่มีINV อยู่ในรายการ พออนุมัติแล้วต้องมีให้แนบด้วย */
function withInvoiceAttachment(draft: any, existing: { id: string; documentNo: string | null } | null): any {
  if (!draft || !existing?.id) return draft;
  const attachments = draft.attachments ?? [];
  if (attachments.some((a: any) => a.invoiceId)) return draft;

  return {
    ...draft,
    attachments: [
      { label: invoiceFileName(existing), invoiceId: existing.id, timesheetId: null },
      ...attachments,
    ],
  };
}

/**
 * สร้างร่างอีเมล INV ในกล่อง Drafts — ported from service.js createGmailDraft()
 *
 * แนบไฟล์ให้ครบตามรายการที่โชว์อยู่บนหน้าเว็บ ทั้งINV (ดึงจากหน้า share ของ FlowAccount) และ
 * Timesheet ของพนักงานทุกคนในรอบ — **ใบไหนหาไฟล์ไม่เจอให้ข้ามไป ไม่ทำให้ทั้งฉบับล้ม** แต่บอกไว้ใน
 * note ว่าขาดกี่ใบ เพราะคนที่กดส่งต้องรู้ว่าต้องแนบเองเพิ่มก่อนกดส่งหรือเปล่า
 */
export async function createGmailDraft(
  contractId: string,
  period: string,
  { actor, client, flowAccount }: { actor: string; client?: GmailClient; flowAccount?: FlowAccountClient },
) {
  const preview = await previewCycleInvoice(contractId, period);
  if (!preview.invoice) {
    throw new InvoiceEmailError('ยังไม่มีรายการที่ออก INV ได้ในรอบนี้', 400);
  }

  const to = preview.contract.customer.contactEmail;
  if (!to) {
    throw new InvoiceEmailError('ยังไม่มีอีเมลผู้ประสานงานของลูกค้าในระบบ — ใส่ที่หน้าข้อมูลหลักก่อน', 400);
  }

  // ร่างที่เคยบันทึกไว้ตอนอนุมัติชนะเสมอ (คนอาจแก้ข้อความไว้แล้ว) — ไม่มีค่อยใช้ร่างที่เพิ่งประกอบสดๆ
  const savedDraft = preview.existing?.id
    ? await prisma.invoice.findUnique({ where: { id: preview.existing.id }, select: { emailDraft: true } })
    : null;
  const draft = savedDraft?.emailDraft
    ? withInvoiceAttachment(JSON.parse(savedDraft.emailDraft), preview.existing)
    : preview.emailDraft;

  const wanted: Array<{ invoiceId: string | null; timesheetId: string | null }> = draft?.attachments ?? [];
  const files: AttachmentFile[] = [];
  for (const a of wanted) {
    const file = a.invoiceId
      ? await getInvoiceFile(a.invoiceId, { client: flowAccount })
      : a.timesheetId
        ? await getTimesheetFile(a.timesheetId)
        : null;
    if (file) files.push(file);
  }
  const attachments = files.map((f) => ({ filename: f.filename, mimeType: 'application/pdf', content: f.bytes }));
  const missing = wanted.length - attachments.length;

  const gmail = client ?? new GmailClient();
  const company = await getSetting<{ email?: string }>('company', {});
  const result = await gmail.createDraft({
    to,
    cc: company?.email ?? null,
    subject: draft.subject,
    body: draft.body,
    attachments,
  });

  // ผูกร่างไว้กับใบแจ้งหนี้ — threadId คือตัวที่ syncEmailSent() ใช้ตามต่อว่าถูกกดส่งหรือยัง ถ้าไม่ผูก
  // ตรงนี้ ระบบจะไม่มีทางรู้เลยว่าคนกดส่งไปแล้ว ต้องมากดบอกเองทุกครั้ง
  if (preview.existing?.id) {
    await prisma.invoice.update({
      where: { id: preview.existing.id },
      data: { gmailDraftId: result.draftId ?? null, gmailThreadId: result.threadId ?? null },
    });
  }

  await logAudit({
    actor,
    action: 'gmail_draft_created',
    entityType: 'invoice',
    entityId: preview.existing?.id ?? `${contractId}-${period}`,
    detail: { draftId: result.draftId, to, period, attachmentCount: attachments.length },
  });

  return {
    ...result,
    to,
    subject: draft.subject,
    note: attachments.length
      ? `แนบไฟล์ให้แล้ว ${attachments.length} ใบ` +
        (missing > 0 ? ` — อีก ${missing} ใบหาไฟล์ในระบบไม่เจอ ต้องแนบเองก่อนกดส่ง` : ' ครบตามรายการ')
      : 'สร้างเป็นร่างในกล่อง Drafts แล้ว — ยังไม่มีไฟล์ในระบบเลย ต้องแนบเองก่อนกดส่ง',
  };
}

/**
 * ดูว่าร่างที่สร้างไว้ถูกกดส่งไปแล้วหรือยัง แล้วบันทึกเวลาส่งให้เอง — ported from syncEmailSent()
 *
 * ออกแบบให้ "เงียบและไม่ล้ม" โดยตั้งใจ เพราะถูกเรียกตอนเปิดหน้ารอบบิล: Gmail ล่ม/token หมดอายุ ต้องไม่
 * ทำให้เปิดหน้าไม่ได้ จึงจับ error ไว้เองแล้วคืน false พร้อมบันทึก audit ไว้ตามดูย้อนหลัง
 *
 * ออกก่อนทันทีถ้าใบนั้นบันทึกว่าส่งแล้ว หรือยังไม่มี threadId — กันไม่ให้ไปกวน Gmail ซ้ำทุกครั้งที่มีคน
 * เปิดหน้า ทั้งที่ไม่มีอะไรให้ตามแล้ว
 */
export async function syncEmailSent(
  invoiceId: string,
  { client }: { client?: GmailClient } = {},
): Promise<boolean> {
  const inv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, documentNo: true, period: true, emailSentAt: true, gmailThreadId: true },
  });
  if (!inv || inv.emailSentAt || !inv.gmailThreadId) return false;
  if (!client && !hasGmailCredentials()) return false;

  try {
    const gmail = client ?? new GmailClient();
    const sent = await gmail.findSentMessage(inv.gmailThreadId);
    if (!sent) return false;

    const at = sent.sentAt ?? new Date().toISOString();
    const by = sent.to ? `Gmail — ส่งถึง ${sent.to}` : 'Gmail';
    await prisma.invoice.update({ where: { id: inv.id }, data: { emailSentAt: at, emailSentBy: by } });
    await logAudit({
      actor: 'system',
      action: 'email_sent_detected',
      entityType: 'invoice',
      entityId: inv.id,
      detail: { documentNo: inv.documentNo, period: inv.period, messageId: sent.messageId },
    });
    return true;
  } catch (error: any) {
    await logAudit({
      actor: 'system',
      action: 'email_sent_check_failed',
      entityType: 'invoice',
      entityId: inv.id,
      detail: { message: error.message },
    });
    return false;
  }
}

/**
 * หน้ารอบบิลที่หน้าเว็บเรียก — เหมือน previewCycleInvoice() แต่แวะเช็คกล่อง Gmail ก่อน
 * ported from src/service.js's cycleDetail()
 *
 * เช็คตอนเปิดหน้าเพราะเป็นจังหวะเดียวที่คนกำลังมองผลอยู่จริง — ไม่ต้องตั้ง cron มาไล่เช็คทุกใบ
 * ทั้งที่ส่วนใหญ่ไม่มีอะไรเปลี่ยน
 *
 * แยกเป็นฟังก์ชันคนละตัวกับ previewCycleInvoice() ตามต้นฉบับ ไม่ยัด syncEmailSent() เข้าไปข้างใน
 * ด้วยเหตุผลเรื่องความเร็ว: previewCycleInvoice() ถูกเรียกจากหลายที่ (รวม createGmailDraft() เอง)
 * ถ้าฝังไว้ข้างในจะมี network call ไป Gmail พ่วงไปทุกจุดที่เรียกโดยไม่ได้ตั้งใจ ส่วนที่นี่คือจุดเดียว
 * ที่ตั้งใจให้เช็ค — และ syncEmailSent() ก็ออกก่อนทันทีถ้าใบนั้นปิดไปแล้วหรือยังไม่มี threadId
 * ของจริงจึงยิงถาม Gmail แค่ช่วงสั้นๆ ระหว่างที่ร่างถูกสร้างแล้วแต่ยังไม่มีใครกดส่ง
 */
export async function cycleDetail(contractId: string, period: string, { client }: { client?: GmailClient } = {}) {
  await syncEmailSent(`INV-${contractId}-${period}`, { client });
  return previewCycleInvoice(contractId, period);
}
