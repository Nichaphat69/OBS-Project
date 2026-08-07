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

/* สถานะที่ถือว่า "รอแล้วลองใหม่ได้" — 429 คือยิงถี่เกิน ส่วน 5xx คือฝั่ง Google เอง
   ที่เหลือ (401 token เสีย · 403 ไม่มีสิทธิ์ · 404 ไม่มีของ) ลองซ้ำกี่ครั้งก็ได้ผลเดิม */
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 500;

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
    this.refreshing = null;   // คำขอ token ที่กำลังวิ่งอยู่ — ดู getAccessToken()
  }

  /**
   * access token อายุสั้น ขอใหม่จาก refresh token เมื่อใกล้หมดอายุ
   *
   * เก็บคำขอที่กำลังวิ่งอยู่ไว้ใน this.refreshing แล้วให้คนที่มาทีหลังรอตัวเดียวกัน —
   * เปิดหน้ากล่อง Gmail ทีหนึ่งยิงหลายคำขอพร้อมกัน (อ่านอีเมลทีละฉบับ) ถ้าไม่กันไว้
   * ทุกคำขอจะไปขอ token ใหม่พร้อมกันหมด ซึ่ง Google นับเป็นการยิงถี่และตอบ 429 กลับมา
   */
  async getAccessToken() {
    if (!this.clientId || !this.clientSecret || !this.refreshToken) {
      throw new GmailError(
        'ยังไม่ได้เชื่อมต่อ Gmail — รัน `npm run gmail:auth` แล้วใส่ค่าที่ได้ในไฟล์ .env',
        { status: 400 },
      );
    }
    if (this.token && Date.now() < this.tokenExpiresAt - 60_000) return this.token;
    if (this.refreshing) return this.refreshing;

    this.refreshing = (async () => {
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
    })();

    try {
      return await this.refreshing;
    } finally {
      this.refreshing = null;   // ล้างทิ้งทั้งกรณีสำเร็จและพลาด ไม่งั้นพลาดครั้งเดียวแล้วค้างตลอด
    }
  }

  /**
   * เรียก Gmail API หนึ่งครั้ง — ลองซ้ำให้เองเมื่อเป็นความผิดพลาดชั่วคราว
   *
   * 429 (ยิงถี่เกิน) และ 5xx (ฝั่ง Google) เป็นอาการที่หายเองเมื่อรอสักครู่ ไม่ใช่ของเสียถาวร
   * เดิมพลาดครั้งเดียวคือขึ้น error เต็มหน้าให้คนกดใหม่เอง ทั้งที่รออีกครึ่งวินาทีก็ผ่านแล้ว
   */
  async call(path, options = {}, { attempt = 1 } = {}) {
    const token = await this.getAccessToken();

    let response;
    try {
      response = await this.fetch(`${API}${path}`, {
        ...options,
        headers: { Authorization: `Bearer ${token}`, ...(options.headers ?? {}) },
      });
    } catch (networkError) {
      if (attempt < MAX_ATTEMPTS) return this.retry(path, options, attempt);
      throw new GmailError(`ต่อ Gmail ไม่ได้ (${path}) — ${networkError.message}`, { status: null });
    }

    const body = await safeJson(response);
    if (response.ok) return body;

    if (RETRY_STATUS.has(response.status) && attempt < MAX_ATTEMPTS) {
      return this.retry(path, options, attempt);
    }
    throw new GmailError(describeGmailError(response.status, body, path), {
      status: response.status,
      body,
    });
  }

  async retry(path, options, attempt) {
    await new Promise((r) => { setTimeout(r, RETRY_DELAY_MS * attempt); });
    return this.call(path, options, { attempt: attempt + 1 });
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
  /**
   * ค้นอีเมลแล้วดึงรายละเอียดมาให้ครบทุกฉบับ
   *
   * ฉบับไหนดึงไม่สำเร็จให้ข้ามไป ไม่ล้มทั้งกล่อง — เดิมใช้ Promise.all ซึ่งพังฉบับเดียว
   * (เช่นถูกลบทิ้งพอดีหลังได้รายการมา หรือ Google สะดุดชั่วคราว) ก็ขึ้น error เต็มหน้า
   * ทั้งที่อีกหลายฉบับดึงมาได้เรียบร้อย คนเลยทำงานต่อไม่ได้เลยทั้งที่ควรจะได้
   *
   * @returns {Promise<{messages: object[], skipped: {id: string, reason: string}[]}>}
   */
  async searchMessages({ query, max = 20 } = {}) {
    const params = new URLSearchParams({ q: query, maxResults: String(max) });
    const list = await this.call(`/messages?${params}`);
    if (!list.messages?.length) return { messages: [], skipped: [] };

    // ดึงรายละเอียดทีละฉบับ — Gmail คืนมาแค่ id กับ threadId เท่านั้น
    const results = await Promise.allSettled(list.messages.map((m) => this.getMessage(m.id)));

    const messages = [];
    const skipped = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') messages.push(r.value);
      else skipped.push({ id: list.messages[i].id, reason: r.reason?.message ?? String(r.reason) });
    });
    return { messages, skipped };
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
   * หา message ที่ "ส่งออกไปแล้ว" ในสนทนานั้น — ใช้รู้ว่าร่างที่ระบบสร้างไว้ถูกกดส่งหรือยัง
   *
   * ตอนกดส่งจาก Gmail ร่างจะหายไปและเกิด message ใหม่ที่มี label SENT ในสนทนาเดิม
   * เช็คจาก label ตรงๆ ไม่ต้องเดา — ยังไม่ส่งจะมีแต่ฉบับ label DRAFT อยู่ฉบับเดียว
   *
   * คืน null ถ้ายังไม่ส่ง หรือตามสนทนานั้นไม่ได้แล้ว — ไม่ถือเป็น error
   *   404 สนทนาถูกลบทิ้งไปแล้ว
   *   400 "Invalid id value" — id ที่เก็บไว้ผิดรูปแบบไปเลย (ยิงกับ Gmail จริงแล้วเจอว่าตอบ 400
   *       ไม่ใช่ 404 เหมือนที่คิดไว้ตอนแรก) ทั้งสองกรณีแปลว่าตามต่อไม่ได้เหมือนกัน
   *       ไม่ควรโยน error ขึ้นไปให้ทุกครั้งที่มีคนเปิดหน้ารอบบิลนั้น
   *
   * ใช้สิทธิ์ gmail.readonly ที่ขอไว้อยู่แล้ว ไม่ต้องขอ scope เพิ่ม
   */
  async findSentMessage(threadId) {
    if (!threadId) return null;

    let thread;
    try {
      thread = await this.call(`/threads/${encodeURIComponent(threadId)}?format=metadata`);
    } catch (error) {
      if (error instanceof GmailError && (error.status === 404 || error.status === 400)) return null;
      throw error;
    }

    const sent = (thread.messages ?? []).find((m) => m.labelIds?.includes('SENT'));
    if (!sent) return null;

    const headers = sent.payload?.headers ?? [];
    const header = (name) =>
      headers.find((h) => h.name?.toLowerCase() === name)?.value ?? null;

    return {
      messageId: sent.id,
      to: header('to'),
      subject: header('subject'),
      // internalDate เป็นมิลลิวินาทีในรูปสตริง — เวลาที่ Gmail รับฉบับนั้นเข้าระบบจริง
      sentAt: sent.internalDate ? new Date(Number(sent.internalDate)).toISOString() : null,
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

/**
 * แปลง error ของ Gmail เป็นข้อความที่คนอ่านแล้วรู้ว่าต้องทำอะไรต่อ
 *
 * เดิมข้อความมีแต่ path ที่พัง ("เรียก Gmail API ไม่สำเร็จ (/messages/xxx)") ซึ่งบอกแค่ว่า
 * พังที่ไหน ไม่ได้บอกว่าเพราะอะไรหรือควรทำยังไง — คนเห็นแล้วทำอะไรต่อไม่ถูก
 */
function describeGmailError(status, body, path) {
  const reason = body?.error?.message ?? body?.error_description ?? null;
  const hint = {
    401: 'สิทธิ์เข้าถึงหมดอายุ — รัน `npm run gmail:auth` ใหม่',
    403: 'บัญชีนี้ไม่มีสิทธิ์ หรือใช้โควตาเกินกำหนดแล้ว',
    404: 'ไม่พบอีเมลฉบับนี้แล้ว — อาจถูกลบไปหลังจากระบบเพิ่งเห็นรายการ',
    429: 'เรียก Gmail ถี่เกินไป ลองใหม่อีกครั้งในอีกสักครู่',
  }[status] ?? (status >= 500 ? 'ระบบของ Google ขัดข้องชั่วคราว ลองใหม่อีกครั้ง' : null);

  return [
    `เรียก Gmail ไม่สำเร็จ (${status})`,
    hint,
    reason && reason !== hint ? `Google แจ้งว่า: ${reason}` : null,
    `— ${path}`,
  ].filter(Boolean).join(' · ');
}

async function safeJson(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { raw: text }; }
}
