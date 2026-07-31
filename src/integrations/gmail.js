/**
 * ตัวเชื่อม Gmail — ใช้ทั้งขาเข้าและขาออกของขั้นที่ 1 กับขั้นที่ 4
 *
 *   ขาเข้า  ดึงอีเมลแจ้งอนุมัติ Timesheet + ไฟล์แนบ PDF มาให้ระบบอ่าน
 *   ขาออก  สร้าง **ร่าง** อีเมลวางบิลไว้ในกล่อง Drafts ของผู้ใช้
 *
 * ⚠️ ไฟล์นี้ไม่มีโค้ดส่งอีเมลเลย และต้องไม่มีต่อไป
 *    บรีฟระบุชัดว่า "ให้รีวิวก่อน ยังไม่ต้องส่งอีเมลไปเลย"
 *    การส่งคือ POST /gmail/v1/users/me/messages/send ซึ่งทั้งไฟล์นี้ไม่เรียกแม้แต่ครั้งเดียว
 *    ระบบสร้างร่างให้เท่านั้น คนเป็นคนกดส่งจากกล่องเมลตัวเอง
 *
 * ไม่ใช้ googleapis SDK — เรียก REST ตรงด้วย fetch ตามหลัก zero-dependency ของโปรเจกต์
 * (SDK ตัวนั้นลากมาหลายสิบแพ็กเกจเพื่อใช้แค่ 4 endpoint)
 *
 * ตั้งค่า: ดู `npm run gmail:auth` และหัวข้อ Gmail ใน README
 */

const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

/**
 * สิทธิ์ที่ขอ — ขอเท่าที่ใช้จริง
 *   gmail.readonly  อ่านอีเมลและไฟล์แนบ (ขาเข้า)
 *   gmail.compose   สร้าง/แก้ร่าง (ขาออก)
 *
 * หมายเหตุตรงๆ: Google ไม่มี scope ที่ให้ "สร้างร่างได้แต่ส่งไม่ได้"
 * gmail.compose จึงแถมสิทธิ์ส่งมาด้วยโดยเลี่ยงไม่ได้ — หลักประกันว่าไม่ส่ง
 * อยู่ที่ตัวโค้ดที่ไม่มี endpoint ส่งอยู่เลย ไม่ได้อยู่ที่ scope
 */
export const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
];

export class GmailError extends Error {
  constructor(message, { status = null, body = null } = {}) {
    super(message);
    this.name = 'GmailError';
    this.status = status;
    this.body = body;
  }
}

/** base64url ที่ Gmail ใช้ — ต่างจาก base64 ปกติที่ตัว + / และ padding */
export function toBase64Url(buffer) {
  return Buffer.from(buffer).toString('base64')
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function fromBase64Url(text) {
  return Buffer.from(String(text ?? '').replaceAll('-', '+').replaceAll('_', '/'), 'base64');
}

export function hasGmailCredentials() {
  return Boolean(
    process.env.GMAIL_CLIENT_ID &&
    process.env.GMAIL_CLIENT_SECRET &&
    process.env.GMAIL_REFRESH_TOKEN,
  );
}

export class GmailClient {
  constructor({
    clientId = process.env.GMAIL_CLIENT_ID,
    clientSecret = process.env.GMAIL_CLIENT_SECRET,
    refreshToken = process.env.GMAIL_REFRESH_TOKEN,
    fetchImpl = globalThis.fetch,
  } = {}) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.refreshToken = refreshToken;
    this.fetch = fetchImpl;
    this.token = null;
    this.tokenExpiresAt = 0;
  }

  /** access token อายุสั้น ขอใหม่จาก refresh token เมื่อใกล้หมดอายุ */
  async getAccessToken() {
    if (!this.clientId || !this.clientSecret || !this.refreshToken) {
      throw new GmailError(
        'ยังไม่ได้เชื่อมต่อ Gmail — รัน `npm run gmail:auth` แล้วใส่ค่าที่ได้ในไฟล์ .env',
        { status: 400 },
      );
    }
    if (this.token && Date.now() < this.tokenExpiresAt - 60_000) return this.token;

    const response = await this.fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: this.refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    });

    const body = await safeJson(response);
    if (!response.ok) {
      throw new GmailError(
        'ขอ access token จาก Google ไม่สำเร็จ — refresh token อาจหมดอายุ ให้รัน `npm run gmail:auth` ใหม่',
        { status: response.status, body },
      );
    }

    this.token = body.access_token;
    this.tokenExpiresAt = Date.now() + Number(body.expires_in ?? 3600) * 1000;
    return this.token;
  }

  async call(path, options = {}) {
    const token = await this.getAccessToken();
    const response = await this.fetch(`${API}${path}`, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, ...(options.headers ?? {}) },
    });
    const body = await safeJson(response);
    if (!response.ok) {
      throw new GmailError(`เรียก Gmail API ไม่สำเร็จ (${path})`, { status: response.status, body });
    }
    return body;
  }

  /** อีเมลของบัญชีที่ต่ออยู่ — ไว้แสดงบนหน้าจอว่ากำลังดูกล่องของใคร */
  async profile() {
    const p = await this.call('/profile');
    return { email: p.emailAddress, total: p.messagesTotal };
  }

  /**
   * ค้นอีเมลแจ้งอนุมัติ Timesheet
   * @param {string} query  Gmail search syntax เช่น 'subject:(แจ้งอนุมัติ) has:attachment newer_than:60d'
   */
  async searchMessages({ query, max = 20 } = {}) {
    const params = new URLSearchParams({ q: query, maxResults: String(max) });
    const list = await this.call(`/messages?${params}`);
    if (!list.messages?.length) return [];

    // ดึงรายละเอียดทีละฉบับ — Gmail คืนมาแค่ id กับ threadId เท่านั้น
    return Promise.all(list.messages.map((m) => this.getMessage(m.id)));
  }

  async getMessage(id) {
    const raw = await this.call(`/messages/${encodeURIComponent(id)}?format=full`);
    return shapeMessage(raw);
  }

  async getAttachment(messageId, attachmentId) {
    const data = await this.call(
      `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
    );
    return fromBase64Url(data.data);
  }

  /**
   * สร้าง **ร่าง** อีเมลในกล่อง Drafts — ไม่ส่ง
   * @param {object} draft  { to, cc, subject, body, attachments:[{filename, mimeType, content:Buffer}] }
   */
  async createDraft({ to, cc = null, subject, body, attachments = [] }) {
    if (!to) throw new GmailError('ต้องระบุอีเมลผู้รับก่อนสร้างร่าง', { status: 400 });

    const mime = buildMime({ to, cc, subject, body, attachments });
    const result = await this.call('/drafts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { raw: toBase64Url(mime) } }),
    });

    return {
      draftId: result.id,
      messageId: result.message?.id ?? null,
      /* ลิงก์เปิดร่างนั้นใน Gmail บนเว็บ — คนกดจากหน้าเราไปแก้และกดส่งต่อได้เลย */
      url: result.message?.id
        ? `https://mail.google.com/mail/u/0/#drafts?compose=${result.message.id}`
        : 'https://mail.google.com/mail/u/0/#drafts',
      attachmentCount: attachments.length,
    };
  }
}

/* ── ประกอบและแกะ MIME ──────────────────────────────────────
   Gmail รับ-ส่งเป็นอีเมลดิบ ไม่มี API แบบกรอกช่อง จึงต้องประกอบเองทั้งฉบับ */

function encodeHeader(text) {
  // หัวข้อภาษาไทยต้องเข้ารหัสตาม RFC 2047 ไม่งั้นตัวอักษรเพี้ยนในเมลไคลเอนต์
  return /^[\x20-\x7E]*$/.test(text ?? '')
    ? String(text ?? '')
    : `=?UTF-8?B?${Buffer.from(String(text ?? ''), 'utf8').toString('base64')}?=`;
}

export function buildMime({ to, cc, subject, body, attachments = [] }) {
  const boundary = `obs_${Buffer.from(String(body).slice(0, 24)).toString('hex').slice(0, 16)}`;
  const head = [
    `To: ${to}`,
    cc ? `Cc: ${cc}` : null,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
  ].filter(Boolean);

  if (!attachments.length) {
    return Buffer.from([
      ...head,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(body, 'utf8').toString('base64'),
    ].join('\r\n'), 'utf8');
  }

  const parts = [
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

/** แปลงโครงสร้าง message ของ Gmail ให้เหลือเฉพาะที่ระบบใช้ */
function shapeMessage(raw) {
  const headers = {};
  for (const h of raw.payload?.headers ?? []) headers[h.name.toLowerCase()] = h.value;

  const textParts = [];
  const attachments = [];

  const walk = (part) => {
    if (!part) return;
    const mime = part.mimeType ?? '';
    const filename = part.filename;

    if (filename && part.body?.attachmentId) {
      attachments.push({
        filename,
        mimeType: mime,
        size: part.body.size ?? 0,
        attachmentId: part.body.attachmentId,
      });
    } else if (mime === 'text/plain' && part.body?.data) {
      textParts.push(fromBase64Url(part.body.data).toString('utf8'));
    } else if (mime === 'text/html' && part.body?.data && textParts.length === 0) {
      // ไม่มี text/plain ก็ถอดแท็กจาก html เอา — เมลระบบหลายตัวส่ง html อย่างเดียว
      textParts.push(
        fromBase64Url(part.body.data).toString('utf8')
          .replace(/<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<\/(p|div|tr|h[1-6])>/gi, '\n')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
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
    pdfAttachments: attachments.filter(
      (a) => a.mimeType === 'application/pdf' || /\.pdf$/i.test(a.filename),
    ),
  };
}

async function safeJson(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { raw: text }; }
}
