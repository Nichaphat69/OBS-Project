/**
 * ตัวเชื่อม Gmail — ported from src/integrations/gmail.js.
 *   ขาเข้า  ดึงอีเมลแจ้งอนุมัติ Timesheet + ไฟล์แนบ PDF มาให้ระบบอ่าน
 *   ขาออก (ธุรกิจ)  createDraft() สร้าง **ร่าง** อีเมล INV ไว้ในกล่อง Drafts — ยังเป็นแค่ร่างเสมอ
 *   ขาออก (auth)    sendMessage() ส่งอีเมลรหัสยืนยัน 6 หลักตอนลืมรหัสผ่านจริง
 *
 * `sendMessage()` ported ไว้ที่ 5.5.7 — ตามคำเตือนของไฟล์ต้นฉบับ ต้องใช้ **เฉพาะ** อีเมลรหัสยืนยัน
 * ตอนลืมรหัสผ่านเท่านั้น อีเมลฝั่งธุรกิจ (ออก INV/แจ้งอนุมัติ) ต้องผ่าน `createDraft()` เสมอ ห้ามใช้
 * `sendMessage()` — ข้อยกเว้นนั้นเจ้าของระบบอนุญาตไว้เฉพาะเรื่องเดียว ไม่ใช่ไฟเขียวให้ส่งเมลอัตโนมัติ
 * ที่อื่น
 *
 * หมายเหตุ: `createDraft`/`findSentMessage` พอร์ตมาแล้ว (ก่อนหน้านี้อยู่นอกขอบเขต) แต่ฝั่ง service
 * ที่เรียกใช้ — รวบไฟล์แนบ ผูก threadId กับใบแจ้งหนี้ และ syncEmailSent() ที่คอยดูว่าร่างถูกกดส่งแล้ว
 * หรือยัง — ยังไม่ได้พอร์ต ดู MIGRATION_PLAN.md
 */
import { loggedFetch } from './apiActivityLog.js';

const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 500;

export class GmailError extends Error {
  status: number | null;
  body: unknown;
  constructor(message: string, { status = null, body = null }: { status?: number | null; body?: unknown } = {}) {
    super(message);
    this.name = 'GmailError';
    this.status = status;
    this.body = body;
  }
}

export function fromBase64Url(text: string | null | undefined): Buffer {
  return Buffer.from(String(text ?? '').replaceAll('-', '+').replaceAll('_', '/'), 'base64');
}

/** base64url ที่ Gmail ใช้ — ต่างจาก base64 ปกติที่ตัว + / และ padding */
export function toBase64Url(buffer: Buffer): string {
  return Buffer.from(buffer)
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

function encodeHeader(text: string | undefined): string {
  // หัวข้อภาษาไทยต้องเข้ารหัสตาม RFC 2047 ไม่งั้นตัวอักษรเพี้ยนในเมลไคลเอนต์
  return /^[\x20-\x7E]*$/.test(text ?? '') ? String(text ?? '') : `=?UTF-8?B?${Buffer.from(String(text ?? ''), 'utf8').toString('base64')}?=`;
}

export interface MimeAttachment {
  filename: string;
  mimeType?: string;
  content: Buffer;
}

/** ประกอบ raw MIME message ให้ Gmail API — Gmail ไม่มี API แบบกรอกช่อง รับเป็นอีเมลดิบอย่างเดียว
 * ports src/integrations/gmail.js's buildMime() — ไม่มีไฟล์แนบได้ text/plain ล้วน มีแล้วเป็น multipart/mixed */
export function buildMime({
  to,
  cc = null,
  subject,
  body,
  attachments = [],
}: {
  to: string;
  cc?: string | null;
  subject: string;
  body: string;
  attachments?: MimeAttachment[];
}): Buffer {
  const boundary = `obs_${Buffer.from(String(body).slice(0, 24)).toString('hex').slice(0, 16)}`;
  const head = [
    `To: ${to}`,
    cc ? `Cc: ${cc}` : null,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
  ].filter(Boolean) as string[];

  if (!attachments.length) {
    return Buffer.from(
      [...head, 'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', Buffer.from(body, 'utf8').toString('base64')].join('\r\n'),
      'utf8',
    );
  }

  const parts: string[] = [
    ...head,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(body, 'utf8').toString('base64'),
  ];

  for (const file of attachments) {
    parts.push(
      `--${boundary}`,
      `Content-Type: ${file.mimeType ?? 'application/octet-stream'}; name="${file.filename}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${file.filename}"`,
      '',
      // ตัดบรรทัดทุก 76 ตัวอักษรตามมาตรฐาน base64 ในอีเมล
      Buffer.from(file.content).toString('base64').replace(/(.{76})/g, '$1\r\n'),
    );
  }
  parts.push(`--${boundary}--`, '');

  return Buffer.from(parts.join('\r\n'), 'utf8');
}

export function hasGmailCredentials(): boolean {
  return Boolean(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN);
}

export interface GmailAttachment {
  filename: string;
  mimeType: string;
  size: number;
  attachmentId: string;
}

export interface GmailMessage {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  date: string | null;
  receivedAt: string | null;
  snippet: string;
  body: string;
  attachments: GmailAttachment[];
  pdfAttachments: GmailAttachment[];
}

export class GmailClient {
  private clientId?: string;
  private clientSecret?: string;
  private refreshToken?: string;
  private token: string | null = null;
  private tokenExpiresAt = 0;
  private refreshing: Promise<string> | null = null;

  constructor({
    clientId = process.env.GMAIL_CLIENT_ID,
    clientSecret = process.env.GMAIL_CLIENT_SECRET,
    refreshToken = process.env.GMAIL_REFRESH_TOKEN,
  }: { clientId?: string; clientSecret?: string; refreshToken?: string } = {}) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.refreshToken = refreshToken;
  }

  async getAccessToken(): Promise<string> {
    if (!this.clientId || !this.clientSecret || !this.refreshToken) {
      throw new GmailError('ยังไม่ได้เชื่อมต่อ Gmail — รัน `npm run gmail:auth` แล้วใส่ค่าที่ได้ในไฟล์ .env', { status: 400 });
    }
    if (this.token && Date.now() < this.tokenExpiresAt - 60_000) return this.token;
    if (this.refreshing) return this.refreshing;

    this.refreshing = (async () => {
      const response = await fetch(OAUTH_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: this.clientId!,
          client_secret: this.clientSecret!,
          refresh_token: this.refreshToken!,
          grant_type: 'refresh_token',
        }).toString(),
      });

      const body: any = await safeJson(response);
      if (!response.ok) {
        throw new GmailError('ขอ access token จาก Google ไม่สำเร็จ — refresh token อาจหมดอายุ ให้รัน `npm run gmail:auth` ใหม่', {
          status: response.status,
          body,
        });
      }

      this.token = body.access_token;
      this.tokenExpiresAt = Date.now() + Number(body.expires_in ?? 3600) * 1000;
      return this.token as string;
    })();

    try {
      return await this.refreshing;
    } finally {
      this.refreshing = null;
    }
  }

  async call(path: string, options: RequestInit = {}, { attempt = 1 }: { attempt?: number } = {}): Promise<any> {
    const token = await this.getAccessToken();

    let response: Response;
    try {
      response = await loggedFetch('gmail', `${API}${path}`, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.headers ?? {}) } });
    } catch (networkError: any) {
      if (attempt < MAX_ATTEMPTS) return this.retry(path, options, attempt);
      throw new GmailError(`ต่อ Gmail ไม่ได้ (${path}) — ${networkError.message}`, { status: null });
    }

    const body = await safeJson(response);
    if (response.ok) return body;

    if (RETRY_STATUS.has(response.status) && attempt < MAX_ATTEMPTS) {
      return this.retry(path, options, attempt);
    }
    throw new GmailError(describeGmailError(response.status, body, path), { status: response.status, body });
  }

  private async retry(path: string, options: RequestInit, attempt: number): Promise<any> {
    await new Promise((r) => { setTimeout(r, RETRY_DELAY_MS * attempt); });
    return this.call(path, options, { attempt: attempt + 1 });
  }

  async profile(): Promise<{ email: string; total: number }> {
    const p = await this.call('/profile');
    return { email: p.emailAddress, total: p.messagesTotal };
  }

  async searchMessages({ query, max = 20 }: { query: string; max?: number }): Promise<{ messages: GmailMessage[]; skipped: Array<{ id: string; reason: string }> }> {
    const params = new URLSearchParams({ q: query, maxResults: String(max) });
    const list = await this.call(`/messages?${params}`);
    if (!list.messages?.length) return { messages: [], skipped: [] };

    const results = await Promise.allSettled(list.messages.map((m: any) => this.getMessage(m.id)));

    const messages: GmailMessage[] = [];
    const skipped: Array<{ id: string; reason: string }> = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') messages.push(r.value);
      else skipped.push({ id: list.messages[i].id, reason: (r as PromiseRejectedResult).reason?.message ?? String((r as PromiseRejectedResult).reason) });
    });
    return { messages, skipped };
  }

  async getMessage(id: string): Promise<GmailMessage> {
    const raw = await this.call(`/messages/${encodeURIComponent(id)}?format=full`);
    return shapeMessage(raw);
  }

  async getAttachment(messageId: string, attachmentId: string): Promise<Buffer> {
    const data = await this.call(`/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`);
    return fromBase64Url(data.data);
  }

  /** ส่งอีเมลจริงทันที — **ใช้เฉพาะรหัสยืนยันตอนลืมรหัสผ่านเท่านั้น** (ดูคำเตือนหัวไฟล์) ห้ามเรียก
   * จากฟีเจอร์ธุรกิจอื่น (ออก INV/แจ้งอนุมัติ) — จุดนั้นต้องใช้ createDraft() เสมอเมื่อพอร์ตแล้ว */
  async sendMessage({ to, subject, body }: { to: string; subject: string; body: string }): Promise<{ id: string; threadId: string }> {
    if (!to) throw new GmailError('ต้องระบุอีเมลผู้รับก่อนส่ง', { status: 400 });
    const mime = buildMime({ to, subject, body });
    return this.call('/messages/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: toBase64Url(mime) }),
    });
  }

  /**
   * สร้าง **ร่าง** อีเมลในกล่อง Drafts — ไม่ส่ง
   * ported from src/integrations/gmail.js's createDraft() — พฤติกรรมเหมือนต้นฉบับทุกอย่าง
   *
   * ⚠️ ห้ามเปลี่ยนให้ไปเรียก sendMessage() โดยไม่ถามเจ้าของระบบก่อน (ดูคำเตือนหัวไฟล์)
   *    อีเมลฝั่งธุรกิจ (ออก INV/แจ้งอนุมัติ) ต้องเป็นแค่ร่างให้คนกดส่งเองเสมอ
   */
  async createDraft({
    to,
    cc = null,
    subject,
    body,
    attachments = [],
  }: {
    to: string;
    cc?: string | null;
    subject: string;
    body: string;
    attachments?: MimeAttachment[];
  }): Promise<{ draftId: string; messageId: string | null; threadId: string | null; url: string; attachmentCount: number }> {
    if (!to) throw new GmailError('ต้องระบุอีเมลผู้รับก่อนสร้างร่าง', { status: 400 });

    const mime = buildMime({ to, cc, subject, body, attachments });
    const [result, profile] = await Promise.all([
      this.call('/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: { raw: toBase64Url(mime) } }),
      }),
      this.profile(),
    ]);

    /* ลิงก์เปิดร่างนั้นใน Gmail บนเว็บ — คนกดจากหน้าเราไปแก้และกดส่งต่อได้เลย
       ห้ามใช้ /mail/u/0/ เฉยๆ เพราะ "0" คือช่องบัญชีแรกที่ล็อกอินไว้ใน**เบราว์เซอร์คนกด**
       ไม่ใช่บัญชีที่ต่อ Gmail API ไว้ — ถ้าเบราว์เซอร์นั้นล็อกอินบัญชีอื่นเป็นช่องแรก จะเปิดผิดบัญชี
       ใช้ authuser=อีเมลจริงแทน ให้ Gmail หาช่องที่ตรงกับบัญชีนี้เอง */
    const authuser = encodeURIComponent(profile.email);
    return {
      draftId: result.id,
      messageId: result.message?.id ?? null,
      /* เก็บ threadId ไว้ด้วย เพราะเป็นตัวเดียวที่อยู่ยงหลังกดส่ง — ตอนส่ง Gmail จะลบร่างทิ้ง
         แล้วสร้าง message ใหม่คนละ id ในสนทนาเดิม เลยตามจาก draftId/messageId ไม่ได้
         (ใช้ใน findSentMessage เพื่อรู้ว่าร่างนี้ถูกส่งออกไปแล้วหรือยัง) */
      threadId: result.message?.threadId ?? null,
      url: result.message?.id
        ? `https://mail.google.com/mail/?authuser=${authuser}#drafts?compose=${result.message.id}`
        : `https://mail.google.com/mail/?authuser=${authuser}#drafts`,
      attachmentCount: attachments.length,
    };
  }

  /**
   * ร่างในสนทนานี้ถูกกดส่งไปแล้วหรือยัง — คืนข้อมูลฉบับที่ส่งแล้ว หรือ null ถ้ายัง
   * ported from src/integrations/gmail.js's findSentMessage()
   *
   * คืน null แทนการโยน error เมื่อ Gmail ตอบ 404 หรือ 400 (สนทนาถูกลบทิ้ง หรือ threadId ที่เก็บไว้
   * ใช้ไม่ได้แล้ว — Gmail ตอบ 400 ไม่ใช่ 404 เหมือนที่คิดไว้ตอนแรก) ทั้งสองกรณีแปลว่าตามต่อไม่ได้
   * เหมือนกัน ไม่ควรโยน error ขึ้นไปทุกครั้งที่มีคนเปิดหน้ารอบบิลนั้น
   */
  async findSentMessage(threadId: string | null): Promise<{ messageId: string; to: string | null; subject: string | null; sentAt: string | null } | null> {
    if (!threadId) return null;

    let thread: any;
    try {
      thread = await this.call(`/threads/${encodeURIComponent(threadId)}?format=metadata`);
    } catch (error) {
      if (error instanceof GmailError && (error.status === 404 || error.status === 400)) return null;
      throw error;
    }

    const sent = (thread.messages ?? []).find((m: any) => m.labelIds?.includes('SENT'));
    if (!sent) return null;

    const headers = sent.payload?.headers ?? [];
    const header = (name: string) => headers.find((h: any) => h.name?.toLowerCase() === name)?.value ?? null;

    return {
      messageId: sent.id,
      to: header('to'),
      subject: header('subject'),
      // internalDate เป็นมิลลิวินาทีในรูปสตริง — เวลาที่ Gmail รับฉบับนั้นเข้าระบบจริง
      sentAt: sent.internalDate ? new Date(Number(sent.internalDate)).toISOString() : null,
    };
  }
}

function shapeMessage(raw: any): GmailMessage {
  const headers: Record<string, string> = {};
  for (const h of raw.payload?.headers ?? []) headers[h.name.toLowerCase()] = h.value;

  const textParts: string[] = [];
  const attachments: GmailAttachment[] = [];

  const walk = (part: any) => {
    if (!part) return;
    const mime = part.mimeType ?? '';
    const filename = part.filename;

    if (filename && part.body?.attachmentId) {
      attachments.push({ filename, mimeType: mime, size: part.body.size ?? 0, attachmentId: part.body.attachmentId });
    } else if (mime === 'text/plain' && part.body?.data) {
      textParts.push(fromBase64Url(part.body.data).toString('utf8'));
    } else if (mime === 'text/html' && part.body?.data && textParts.length === 0) {
      textParts.push(
        fromBase64Url(part.body.data)
          .toString('utf8')
          .replace(/<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<\/(p|div|tr|h[1-6])>/gi, '\n')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/[ \t]+/g, ' ')
          .replace(/\n{3,}/g, '\n\n')
          .trim(),
      );
    }

    for (const child of part.parts ?? []) walk(child);
  };
  walk(raw.payload);

  return {
    id: raw.id,
    threadId: raw.threadId,
    from: headers.from ?? '',
    to: headers.to ?? '',
    subject: headers.subject ?? '(ไม่มีหัวข้อ)',
    date: headers.date ?? null,
    receivedAt: raw.internalDate ? new Date(Number(raw.internalDate)).toISOString() : null,
    snippet: raw.snippet ?? '',
    body: textParts.join('\n').trim(),
    attachments,
    pdfAttachments: attachments.filter((a) => a.mimeType === 'application/pdf' || /\.pdf$/i.test(a.filename)),
  };
}

function describeGmailError(status: number, body: any, path: string): string {
  const reason = body?.error?.message ?? body?.error_description ?? null;
  const hint =
    ({
      401: 'สิทธิ์เข้าถึงหมดอายุ — รัน `npm run gmail:auth` ใหม่',
      403: 'บัญชีนี้ไม่มีสิทธิ์ หรือใช้โควตาเกินกำหนดแล้ว',
      404: 'ไม่พบอีเมลฉบับนี้แล้ว — อาจถูกลบไปหลังจากระบบเพิ่งเห็นรายการ',
      429: 'เรียก Gmail ถี่เกินไป ลองใหม่อีกครั้งในอีกสักครู่',
    } as Record<number, string>)[status] ?? (status >= 500 ? 'ระบบของ Google ขัดข้องชั่วคราว ลองใหม่อีกครั้ง' : null);

  return [`เรียก Gmail ไม่สำเร็จ (${status})`, hint, reason && reason !== hint ? `Google แจ้งว่า: ${reason}` : null, `— ${path}`]
    .filter(Boolean)
    .join(' · ');
}

async function safeJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}
