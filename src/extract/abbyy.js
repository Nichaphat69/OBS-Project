/**
 * ตัวเชื่อม ABBYY Vantage — ใช้แทนโมเดล vision ในเครื่อง (google/gemma-4-e4b) สำหรับอ่านไฟล์ Timesheet
 * ตาม requirement ใหม่ (17 ส.ค. 69): เปลี่ยนมาใช้ Skill ที่ train ไว้ใน ABBYY Vantage แทน
 *
 * ยืนยัน endpoint ทั้งหมดจาก Swagger UI ของจริง (`{ABBYY_BASE_URL}/api/index.html?urls.primaryName=publicapi/v1`)
 * และเอกสารทางการของ ABBYY (help.abbyy.com/en-us/vantage) เมื่อ 17 ส.ค. 69 — ไม่ใช่การเดา:
 *   1. POST {base}/auth2/connect/token             ขอ access token แบบ Client Credentials
 *   2. POST {base}/api/publicapi/v1/transactions/launch?skillId=...   ส่งไฟล์เข้า Skill ในคำขอเดียว
 *   3. GET  {base}/api/publicapi/v1/transactions/{id}                  เช็คสถานะ (poll)
 *   4. GET  {base}/api/publicapi/v1/transactions/{id}/files/{fileId}/download   โหลดผลลัพธ์ (JSON)
 *
 * ⚠️ ยังไม่รู้โครงสร้าง field ในไฟล์ผลลัพธ์ (ชื่อพนักงาน/วันที่/เวลาเข้า-ออก ฯลฯ) เพราะยังไม่เคยเห็น
 * ผลลัพธ์จริงจาก Skill "Timesheet" — extractViaAbbyy() ด้านล่างคืนค่า JSON ดิบตรงๆ ที่ ABBYY ส่งมา
 * ยังไม่ map เข้ากับ schema ของเราเอง (TIMESHEET_SCHEMA ใน timesheet.js) ต้องรอตัวอย่างผลลัพธ์จริง
 * ก่อนถึงจะเขียนส่วน map ต่อได้ถูกต้อง ไม่งั้นจะเป็นการเดาชื่อ field ที่เสี่ยงผิด
 */

const DEFAULT_TIMEOUT_MS = 20_000;
// เอกสาร ABBYY แนะนำไม่ควรเช็คสถานะถี่กว่า 1 ครั้ง/วินาที — ตั้งเผื่อไว้ที่ 1.5 วินาที
const POLL_INTERVAL_MS = 1_500;
const POLL_TIMEOUT_MS = 120_000;

// สถานะที่ยืนยันจากเอกสารทางการของ ABBYY Vantage (help.abbyy.com) — ไม่ใช่การเดา
const STATUS = {
  NEW: 'New',
  PROCESSING: 'Processing',
  PROCESSED: 'Processed',
  FAILED: 'Failed',
  CANCELED: 'Canceled',
};

export class AbbyyError extends Error {
  constructor(message, { status = null, body = null } = {}) {
    super(message);
    this.name = 'AbbyyError';
    this.status = status;
    this.body = body;
  }
}

export function hasAbbyyCredentials() {
  return Boolean(
    process.env.ABBYY_BASE_URL && process.env.ABBYY_CLIENT_ID
    && process.env.ABBYY_CLIENT_SECRET && process.env.ABBYY_SKILL_ID,
  );
}

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

export class AbbyyClient {
  constructor({
    baseUrl = process.env.ABBYY_BASE_URL,
    clientId = process.env.ABBYY_CLIENT_ID,
    clientSecret = process.env.ABBYY_CLIENT_SECRET,
    skillId = process.env.ABBYY_SKILL_ID,
    fetchImpl = globalThis.fetch,
  } = {}) {
    this.baseUrl = baseUrl?.replace(/\/+$/, '');
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.skillId = skillId;
    this.fetch = fetchImpl;
    this.token = null;
    this.tokenExpiresAt = 0;
  }

  assertConfigured() {
    if (!this.baseUrl || !this.clientId || !this.clientSecret || !this.skillId) {
      throw new AbbyyError(
        'ยังไม่ได้เชื่อมต่อ ABBYY Vantage — ใส่ ABBYY_BASE_URL/ABBYY_CLIENT_ID/ABBYY_CLIENT_SECRET/ABBYY_SKILL_ID ใน .env',
        { status: 400 },
      );
    }
  }

  /**
   * ขอ access token ด้วย OAuth2 Client Credentials Flow — เหมาะกับงาน machine-to-machine
   * แบบนี้พอดี (ไม่มีคนล็อกอินอยู่เบื้องหลัง) cache ไว้ใช้ซ้ำจนใกล้หมดอายุค่อยขอใหม่
   * (อายุ token ตั้งไว้ 1 วันใน ABBYY Token Lifetime Settings — เผื่อไว้ 60 วินาทีก่อนหมดอายุจริง)
   */
  async getAccessToken() {
    if (this.token && Date.now() < this.tokenExpiresAt) return this.token;

    this.assertConfigured();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    let res;
    try {
      res = await this.fetch(`${this.baseUrl}/auth2/connect/token`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: 'client_credentials',
          scope: 'openid permissions global.wildcard',
        }),
      });
    } catch (error) {
      throw new AbbyyError(`เชื่อมต่อ ABBYY ไม่สำเร็จ (${error.message})`, { status: null });
    } finally {
      clearTimeout(timeout);
    }

    const text = await res.text();
    const parsed = safeJson(text);
    if (!res.ok) {
      throw new AbbyyError(`ขอ access token จาก ABBYY ไม่สำเร็จ (${res.status})`, { status: res.status, body: parsed });
    }
    if (!parsed?.access_token) {
      throw new AbbyyError('ABBYY ตอบกลับมาโดยไม่มี access_token — ตรวจ ABBYY_CLIENT_ID/ABBYY_CLIENT_SECRET', { status: 401 });
    }

    this.token = parsed.access_token;
    // expires_in เป็นวินาที — เผื่อไว้ 60 วินาทีกันเผื่อรอบ request ยาวคาบเกี่ยวตอนหมดอายุพอดี
    this.tokenExpiresAt = Date.now() + (Math.max(parsed.expires_in ?? 3600, 120) - 60) * 1000;
    return this.token;
  }

  async authedFetch(path, options = {}) {
    const token = await this.getAccessToken();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      return await this.fetch(`${this.baseUrl}${path}`, {
        ...options,
        signal: controller.signal,
        headers: { ...options.headers, Authorization: `Bearer ${token}` },
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * ส่งไฟล์เข้า Skill ในคำขอเดียว (สร้าง transaction + แนบไฟล์ + เริ่มประมวลผลพร้อมกัน) —
   * เหมาะกับไฟล์ Timesheet ที่เล็กกว่า 30MB มาก ไม่ต้องแยกเป็นหลายคำขอ
   *
   * @param {Buffer} fileBuffer
   * @param {string} fileName
   * @returns {Promise<string>} transactionId
   */
  async launchTransaction(fileBuffer, fileName) {
    this.assertConfigured();
    const form = new FormData();
    form.append('Files', new Blob([fileBuffer], { type: 'application/pdf' }), fileName);

    const res = await this.authedFetch(
      `/api/publicapi/v1/transactions/launch?skillId=${encodeURIComponent(this.skillId)}`,
      { method: 'POST', body: form },
    );
    const text = await res.text();
    const parsed = safeJson(text);
    if (!res.ok) {
      throw new AbbyyError(`ส่งไฟล์เข้า ABBYY Skill ไม่สำเร็จ (${res.status})`, { status: res.status, body: parsed });
    }
    if (!parsed?.transactionId) {
      throw new AbbyyError('ABBYY ตอบกลับมาโดยไม่มี transactionId', { status: 502, body: parsed });
    }
    return parsed.transactionId;
  }

  /** ดึงสถานะ+รายละเอียด transaction (status, manualReviewLink, documents[].resultFiles[]) */
  async getTransaction(transactionId) {
    const res = await this.authedFetch(`/api/publicapi/v1/transactions/${transactionId}`, { method: 'GET' });
    const text = await res.text();
    const parsed = safeJson(text);
    if (!res.ok) {
      throw new AbbyyError(`ดึงสถานะ transaction ไม่สำเร็จ (${res.status})`, { status: res.status, body: parsed });
    }
    return parsed;
  }

  /** โหลดไฟล์ผลลัพธ์ (ปกติเป็น JSON) ตาม fileId ที่ได้จาก documents[].resultFiles[].fileId */
  async downloadResultFile(transactionId, fileId) {
    const res = await this.authedFetch(
      `/api/publicapi/v1/transactions/${transactionId}/files/${fileId}/download`,
      { method: 'GET' },
    );
    if (!res.ok) {
      throw new AbbyyError(`โหลดไฟล์ผลลัพธ์จาก ABBYY ไม่สำเร็จ (${res.status})`, { status: res.status });
    }
    const text = await res.text();
    return safeJson(text) ?? text;
  }

  /**
   * ส่งไฟล์เข้า Skill แล้วรอ (poll) จนประมวลผลเสร็จ คืน "ผลลัพธ์ดิบ" ตรงๆ ที่ ABBYY ส่งมา
   * (ยังไม่ map เข้า schema ของเราเอง — ดูคอมเมนต์หัวไฟล์)
   *
   * @param {Buffer} fileBuffer
   * @param {string} fileName
   * @returns {Promise<{transactionId: string, manualReviewLink: string|null, rawResult: any}>}
   */
  async extractDocument(fileBuffer, fileName) {
    const transactionId = await this.launchTransaction(fileBuffer, fileName);

    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let transaction;
    for (;;) {
      transaction = await this.getTransaction(transactionId);
      if (transaction.status === STATUS.PROCESSED) break;
      if (transaction.status === STATUS.FAILED) {
        throw new AbbyyError(`ABBYY ประมวลผลไฟล์ไม่สำเร็จ (transaction ${transactionId})`, { body: transaction });
      }
      if (transaction.status === STATUS.CANCELED) {
        throw new AbbyyError(`ABBYY ยกเลิกการประมวลผล (transaction ${transactionId})`, { body: transaction });
      }
      if (Date.now() > deadline) {
        throw new AbbyyError(
          `รอ ABBYY ประมวลผลไฟล์นานเกิน ${POLL_TIMEOUT_MS / 1000} วินาที (transaction ${transactionId}, สถานะล่าสุด "${transaction.status}")`,
          { body: transaction },
        );
      }
      await sleep(POLL_INTERVAL_MS);
    }

    const resultFile = transaction.documents?.[0]?.resultFiles?.find((f) => f.type === 'Json')
      ?? transaction.documents?.[0]?.resultFiles?.[0];
    if (!resultFile) {
      throw new AbbyyError('ประมวลผลเสร็จแต่ไม่พบไฟล์ผลลัพธ์ใน transaction', { body: transaction });
    }

    const rawResult = await this.downloadResultFile(transactionId, resultFile.fileId);
    return { transactionId, manualReviewLink: transaction.manualReviewLink ?? null, rawResult };
  }
}

function safeJson(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { raw: text }; }
}
