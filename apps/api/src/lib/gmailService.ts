/**
 * "ดึงจาก Gmail" — ported (narrowed) from src/service.js's `gmailInbox()`,
 * `readTimesheetFromEmail()`, `dismissGmailMessage()`, `undismissGmailMessage()`,
 * `listDismissedGmailMessages()`.
 *
 * Simplifications vs. the original:
 * - The original filters the inbox to the "currently active company" (a company switcher stored
 *   in the session/topbar this migration hasn't built yet) — this port takes an explicit optional
 *   `contractId` instead; omit it to see every company's candidate emails (equivalent to the
 *   original's "แสดงทุกบริษัท" toggle).
 * - `readTimesheetFromEmail()` runs the email body through a local-LLM reader (`readApprovalEmail`,
 *   Phase 5.7) to auto-extract approval status/document number/approver, then blocks ingestion if
 *   the status isn't exactly "อนุมัติ" or the month doesn't match the PDF — matching the original.
 *   Narrowed vs. the original: the original's multi-document (`documents[]`) blockers-merging isn't
 *   needed here since this stack's `Extractor` interface is already single-document only (see
 *   extractionService.ts's file header) — the email-derived blockers are simply added to the one
 *   document's blockers list directly.
 */
import { prisma } from '@obs/db';
import { thaiMonth, normalizePeriod } from '@obs/domain';
import { GmailClient, hasGmailAccess } from './gmailClient.js';
import { readTimesheetFile, type ReadResult } from './uploadService.js';
import { ingestTimesheet } from './ingestService.js';
import { extractTimesheet } from './extractionService.js';
import { readApprovalEmail } from './llmEmailService.js';
import { logAudit } from './audit.js';

/* คำค้นเริ่มต้นของกล่อง Gmail — ตั้งใจให้ "กว้างไว้ก่อน" (28 ก.ย. 69)
 *
 * ของเดิม `subject:(TimeSheet OR "แจ้งอนุมัติ")` แคบเกินไป เพราะลูกค้าแต่ละเจ้าตั้งหัวเรื่องคนละแบบสิ้นเชิง
 * ตรวจกับอีเมลจริงของรอบ ส.ค. 2026 แล้วหลุดอย่างน้อย 4 แบบ:
 *   - "ตารางเข้างาน เดือน ส.ค. 2026"                        (Big C) — ไม่มีคำว่า timesheet เลย
 *   - "รบกวนอนุมัติ Time Sheet เดือน สิงหาคม 2569"           (T8)    — เขียนแยกเป็น "Time Sheet"
 *   - "FW: [Time Sheet] Thai Group_..._AUG_2026"            (TSG)   — เขียนแยกเหมือนกัน
 *   - "[ACTION REQUIRED] Timesheets 082026 ..."             (V-Link)— เติม s เป็นพหูพจน์
 * Gmail ตัดคำเป็น token ("Time Sheet" จึงไม่ match คำว่า timesheet) และไม่ทำ stemming ให้ ต้องไล่ใส่เอง
 *
 * หน้า "ดึงจาก Gmail" ให้คนเลือกไฟล์เองอยู่แล้ว การกวาดมาเกินจึงเสียแค่ต้องกวาดตาผ่าน แต่การกวาดมาไม่ครบ
 * แปลว่าบิลรอบนั้นหายไปเงียบๆ — เลือกให้กว้างไว้ก่อนจึงถูกกว่า และยังมีตัวกรอง from:@โดเมนลูกค้า
 * ซ้อนอีกชั้นตอนเลือกสัญญาอยู่แล้ว (ดู effectiveQuery ด้านล่าง) */
export const DEFAULT_GMAIL_QUERY =
  process.env.GMAIL_QUERY
  ?? 'subject:(timesheet OR timesheets OR "time sheet" OR "time-sheet" OR อนุมัติ OR ตารางเข้างาน OR บันทึกเวลา) '
     + 'has:attachment filename:pdf newer_than:90d';

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

/** ported from service.js gmailInbox() */
export async function gmailInbox({
  query,
  max = 15,
  contractId,
}: {
  query?: string;
  max?: number;
  contractId?: string;
} = {}): Promise<GmailInboxResult> {
  if (!(await hasGmailAccess())) {
    throw new GmailIntakeError('ยังไม่ได้เชื่อมต่อ Gmail — ใส่ GMAIL_CLIENT_ID/GMAIL_CLIENT_SECRET/GMAIL_REFRESH_TOKEN ใน .env');
  }

  const explicit = Boolean(query);
  const base = query || DEFAULT_GMAIL_QUERY;

  const contract = contractId ? await prisma.contract.findUnique({ where: { id: contractId }, include: { customer: true } }) : null;
  // customers.email_domain เก็บค่าไม่ตรงรูปแบบกัน (บาง row มี "@" นำหน้าติดมาด้วย บาง row ไม่มี) — ตัด
  // "@" นำหน้าทิ้งเสมอตรงนี้ที่เดียว กันบั๊ก "from:@@domain" (double-@ ใช้ query ไม่ได้เลย) ที่ query
  // builder ด้านล่าง และกันไม่ให้ senderDomain() (คืนค่าไม่มี @ เสมอ) เทียบไม่ตรงกับค่านี้ (เจอจริง 15
  // ก.ย. 69 — Big-C ตั้ง emailDomain มี @ นำหน้า กรองไม่เจออีเมลเลยทั้งที่มีอยู่จริงในกล่อง)
  const activeDomain = (contract?.customer.emailDomain ?? '').trim().toLowerCase().replace(/^@+/, '') || null;
  const applyFilter = !explicit && Boolean(contract);
  // ⚠️ เดิมต่อโดเมนเข้าไปในคำค้นแบบ plain text (`${base} ${activeDomain}`) — Gmail search ตีความคำ
  // ท้ายๆแบบนี้เป็น full-text search ธรรมดา (ต้องเจอคำว่า "ipassion.co.th" ปรากฏอยู่จริงในหัวเรื่อง/
  // เนื้อหา/snippet ของอีเมล) ไม่ใช่ตัวกรอง "จากโดเมนนี้" ตามที่ตั้งใจเลย — อีเมลจริงจากโดเมนนั้นที่ไม่มี
  // คำว่าโดเมนตัวเองปรากฏในเนื้อหาเลยจะหลุดหายไปหมด (เจอจริง 15 ก.ย. 69 — บริษัท ปตท. ตั้งโดเมน
  // ipassion.co.th ไว้แล้ว แต่ผลลัพธ์ขึ้น "ไม่มีอีเมลที่ต้องอ่าน" ทั้งที่กล่องมีอีเมลจากโดเมนนี้จริง) ต้อง
  // ใช้ operator `from:@domain` ของ Gmail ถึงจะกรองตามโดเมนผู้ส่งจริงๆ ตามเอกสาร Gmail search operators
  const effectiveQuery = applyFilter && activeDomain ? `${base} from:@${activeDomain}` : base;
  const domain = applyFilter ? activeDomain : null;
  const domainMissing = applyFilter && !activeDomain;

  const gmail = new GmailClient();
  const [profile, found] = await Promise.all([gmail.profile(), gmail.searchMessages({ query: effectiveQuery, max })]);
  const { skipped } = found;

  const messages =
    applyFilter && activeDomain ? found.messages.filter((m) => senderDomain(m.from) === activeDomain) : found.messages;

  const known = new Map(
    (
      await prisma.aiRead.findMany({
        where: { sourceEmailId: { not: null }, status: { not: 'discarded' } },
        select: { sourceEmailId: true, fileName: true, period: true, documentNo: true },
      })
    ).map((r) => [`${r.sourceEmailId}::${r.fileName}`, { period: r.period, documentNo: r.documentNo }]),
  );
  const dismissed = new Set((await prisma.gmailDismissed.findMany({ select: { messageId: true } })).map((r) => r.messageId));

  const withAttachments = messages
    .filter((m) => m.pdfAttachments.length > 0)
    .map((m) => ({
      id: m.id,
      subject: m.subject,
      from: m.from,
      receivedAt: m.receivedAt,
      snippet: m.snippet,
      attachments: m.pdfAttachments.map((a) => ({
        filename: a.filename,
        size: a.size,
        attachmentId: a.attachmentId,
        ...known.get(`${m.id}::${a.filename}`),
      })),
    }));

  return {
    account: profile.email,
    query: effectiveQuery,
    domain,
    activeCompanyName: contract?.customer.nameTh ?? null,
    domainMissing,
    skipped: skipped.length,
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

/** ported (narrowed, see file header) from service.js readTimesheetFromEmail() */
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
  if (!(await hasGmailAccess())) {
    throw new GmailIntakeError('ยังไม่ได้เชื่อมต่อ Gmail — ใส่ GMAIL_CLIENT_ID/GMAIL_CLIENT_SECRET/GMAIL_REFRESH_TOKEN ใน .env');
  }

  const gmail = new GmailClient();
  const message = await gmail.getMessage(messageId);

  const target = attachmentFilename
    ? message.pdfAttachments.find((a) => a.filename === attachmentFilename)
    : message.pdfAttachments[0];
  if (!target) throw new GmailIntakeError('อีเมลฉบับนี้ไม่มีไฟล์ PDF แนบมา');

  // อ่านเนื้ออีเมลกับอ่านไฟล์ PDF พร้อมกัน — สองอย่างนี้ไม่ขึ้นต่อกัน
  const pdf = await gmail.getAttachment(messageId, target.attachmentId);
  const [emailMeta, sheet] = await Promise.all([
    readApprovalEmail({ subject: message.subject, from: message.from, date: message.date, body: message.body }),
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

/** ported from service.js listDismissedGmailMessages() */
export async function listDismissedGmailMessages() {
  const rows = await prisma.gmailDismissed.findMany({ orderBy: { dismissedAt: 'desc' } });
  if (!rows.length) return [];
  if (!(await hasGmailAccess())) {
    return rows.map((row) => ({
      id: row.messageId,
      subject: null,
      from: null,
      receivedAt: null,
      dismissedBy: row.dismissedBy,
      dismissedAt: row.dismissedAt,
    }));
  }

  const gmail = new GmailClient();
  return Promise.all(
    rows.map(async (row) => {
      try {
        const m = await gmail.getMessage(row.messageId);
        return { id: row.messageId, subject: m.subject, from: m.from, receivedAt: m.receivedAt, dismissedBy: row.dismissedBy, dismissedAt: row.dismissedAt };
      } catch {
        return { id: row.messageId, subject: null, from: null, receivedAt: null, dismissedBy: row.dismissedBy, dismissedAt: row.dismissedAt };
      }
    }),
  );
}

/**
 * ดึงอีเมลใหม่ทั้งหมดแล้วส่งเข้าระบบให้จบในเส้นเดียว — ใช้โดย n8n แทน Gmail Trigger เดิม (29 ก.ย. 69)
 *
 * **ทำไมย้ายมาไว้ที่นี่** — เดิม n8n เป็นคนคุยกับ Gmail เอง ซึ่งแปลว่าระบบมีสิทธิ์เข้าถึงกล่องเมล
 * เก็บอยู่สองที่ (ใน OBS หนึ่ง ใน n8n อีกหนึ่ง) วันที่สิทธิ์หลุดต้องตามไปต่อใหม่ทั้งสองที่ และหลุด
 * ไม่พร้อมกันด้วย · OBS ต้องมีสิทธิ์นี้อยู่แล้วเพราะฟีเจอร์ร่างอีเมลวางบิลใช้ Gmail API เหมือนกัน
 * ตัวที่อยู่ใน n8n จึงเป็นของซ้ำซ้อนล้วนๆ
 *
 * **เลิกกรองคำว่า "อนุมัติ" ที่ n8n แล้ว** — ด่านนั้นดูแค่เนื้อความ ไม่ดูหัวเรื่อง ทำให้อีเมลจริงของ
 * ลูกค้าหลายเจ้าตกด่านแล้วหายเงียบโดยไม่มีร่องรอย (เจอจริง 29 ก.ย. 69) ตอนนี้ปล่อยให้เข้ามาแล้วให้
 * ชั้นตรวจของระบบเป็นคนตัดสิน ซึ่งละเอียดกว่าและบันทึกไว้ว่าทำไมไม่ผ่าน
 *
 * อีเมลที่เคยอ่านไปแล้วถูกกรองออกตั้งแต่ใน `gmailInbox()` (เทียบจาก `sourceEmailId` + ชื่อไฟล์)
 * จึงเรียกซ้ำกี่ครั้งก็ไม่ประมวลผลซ้ำ
 */
export interface GmailIngestOutcome {
  messageId: string;
  subject: string;
  fileName: string;
  ok: boolean;
  /** ค่าที่ n8n ใช้ตัดสินว่าจะทำอะไรต่อ — รูปเดียวกับที่ POST /api/timesheets/ingest คืนมา */
  nextAction?: string;
  timesheetId?: string | null;
  contractId?: string | null;
  period?: string | null;
  reason?: string | null;
  error?: string;
}

export async function ingestNewGmailTimesheets({
  max = 20,
  ingest,
}: {
  max?: number;
  /** ฉีดเข้ามาได้เพื่อให้เทสต์ไม่ต้องยิง OCR จริง — ปกติใช้ตัวจริงจาก ingestService */
  ingest?: typeof ingestTimesheet;
} = {}): Promise<{ scanned: number; processed: number; results: GmailIngestOutcome[] }> {
  const inbox = await gmailInbox({ max });
  const run = ingest ?? ingestTimesheet;
  const gmail = new GmailClient();
  const results: GmailIngestOutcome[] = [];

  for (const message of inbox.messages) {
    for (const attachment of message.attachments) {
      const base = { messageId: message.id, subject: message.subject, fileName: attachment.filename };
      try {
        const bytes = await gmail.getAttachment(message.id, attachment.attachmentId);
        /* เลขเอกสารจากตัวเลขยาวๆ ในหัวเรื่อง ตามที่ workflow เดิมทำ — ไม่เจอก็ใช้ id ของอีเมลแทน
           ซึ่งไม่ซ้ำแน่นอนและตามกลับไปหาต้นทางได้ */
        const documentNo = /(\d{9,12})/.exec(message.subject ?? '')?.[1] ?? message.id;
        const outcome = await run({
          documentNo,
          fileBytes: bytes,
          fileName: attachment.filename,
          sourceEmailId: message.id,
          sourceEmailSubject: message.subject,
          receivedAt: message.receivedAt ?? new Date().toISOString(),
          approvedBy: message.from ?? null,
          actor: 'n8n',
          submissionMethod: 'auto_gmail',
          extractor: extractTimesheet,
        } as any);
        results.push({
          ...base,
          ok: true,
          nextAction: (outcome as any).nextAction,
          timesheetId: (outcome as any).timesheetId ?? null,
          contractId: (outcome as any).contractId ?? null,
          period: (outcome as any).period ?? null,
          reason: (outcome as any).reason ?? null,
        });
      } catch (error: any) {
        // ไฟล์เดียวพังต้องไม่ทำให้ทั้งรอบหยุด — ที่เหลือต้องถูกอ่านต่อจนครบ แล้วรายงานตัวที่พังกลับไป
        results.push({ ...base, ok: false, error: String(error?.message ?? error).slice(0, 300) });
      }
    }
  }

  await logAudit({
    actor: 'n8n',
    action: 'gmail_auto_ingest',
    entityType: 'gmail',
    entityId: String(results.length),
    detail: { scanned: inbox.messages.length, processed: results.length, failed: results.filter((r) => !r.ok).length },
  });

  return { scanned: inbox.messages.length, processed: results.length, results };
}
