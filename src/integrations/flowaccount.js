/**
 * FlowAccount API client
 *
 * ชื่อ endpoint · ชื่อฟิลด์ · วิธีขอ token ทั้งหมดในไฟล์นี้เทียบกับ
 * Postman Collection ตัวจริงของ FlowAccount แล้วเมื่อ 29 ก.ค. 2569 ไม่ใช่การเดา
 *
 * ที่ได้คำตอบจากการเทียบ:
 *   · ส่วนลดรายบรรทัดต้องใช้ endpoint ตัว inline เท่านั้น
 *   · ภาษีหัก ณ ที่จ่าย **เราต้องคิดแล้วส่งไปเอง** (documentWithholdingTaxAmount)
 *   · ไม่มีฟิลด์ status — เอกสารที่ POST เข้าไปเป็นร่างโดยปริยาย
 *
 * ⚠️ ที่ยังค้างก่อนเปิดโหมด live
 *   1. items[].id — ตัวอย่างกำกับว่า "use existing product list id"
 *      ยังไม่รู้ว่าจำเป็นไหม ถ้าจำเป็นต้องสร้างสินค้า/บริการไว้ก่อนด้วย /product-masters
 *   2. sellChartOfAccountCode 41210 มาจากตัวอย่าง ต้องให้ฝ่ายบัญชียืนยันผังบัญชีจริง
 *   3. เลือก Billing Note หรือ Tax Invoice ให้ตรง flow บัญชีปัจจุบัน
 *
 * โหมด dry-run (ค่าเริ่มต้น) ไม่เรียก API จริง แต่คืนผลลัพธ์เสมือนกลับมา
 * ทำให้รันระบบและทดสอบ flow ได้ครบโดยไม่ต้องมี credential
 */

/* ที่อยู่ API ยืนยันจากข้อมูล Sandbox ที่ลูกค้าให้มา + Postman Collection ตัวจริง
   token กับเอกสารอยู่ใต้ base เดียวกัน ({base}/token, {base}/tax-invoices/inline)
   sandbox = .../test · โหมด live ต้องให้ฝ่ายบัญชียืนยัน base ก่อน */
const BASE_URL = process.env.FLOWACCOUNT_BASE_URL ?? 'https://openapi.flowaccount.com/test';
const AUTH_PATH = '/token';
const AUTH_SCOPE = process.env.FLOWACCOUNT_SCOPE ?? 'flowaccount-api';

export const MODE = {
  DRY_RUN: 'dry-run',
  SANDBOX: 'sandbox',
  LIVE: 'live',
};

/**
 * ฟิลด์ที่ระบบเราส่งออก → ฟิลด์ที่คาดว่า FlowAccount รับ
 * แก้ที่นี่ที่เดียวเมื่อเทียบกับ API docs เสร็จ
 */
/* ต้องใช้ตัว inline เพราะต้องหักส่วนลดวันลารายบรรทัด — ดูเหตุผลใน toFlowAccountPayload()
   ตัว /tax-invoices เฉยๆ มีแต่ส่วนลดระดับเอกสาร ใช้กับงานนี้ไม่ได้ */
const DOCUMENT_PATHS = {
  'billing-note': '/billing-notes/inline',
  'tax-invoice': '/tax-invoices/inline',
};

export class FlowAccountError extends Error {
  constructor(message, { status = null, body = null } = {}) {
    super(message);
    this.name = 'FlowAccountError';
    this.status = status;
    this.body = body;
  }
}

export class FlowAccountClient {
  /**
   * @param {object} options
   * @param {string} options.mode              'dry-run' | 'sandbox' | 'live'
   * @param {string} [options.clientId]
   * @param {string} [options.clientSecret]
   * @param {string} [options.documentType]    'billing-note' | 'tax-invoice' | 'invoice'
   */
  constructor({
    mode = process.env.FLOWACCOUNT_MODE ?? MODE.DRY_RUN,
    clientId = process.env.FLOWACCOUNT_CLIENT_ID,
    clientSecret = process.env.FLOWACCOUNT_CLIENT_SECRET,
    documentType = 'billing-note',
    fetchImpl = globalThis.fetch,
  } = {}) {
    this.mode = mode;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.documentType = documentType;
    this.fetch = fetchImpl;
    this.token = null;
    this.tokenExpiresAt = 0;
  }

  get isDryRun() {
    return this.mode === MODE.DRY_RUN;
  }

  /** OAuth2 client_credentials — ต่ออายุ token อัตโนมัติ */
  async getAccessToken() {
    if (this.isDryRun) return 'dry-run-token';

    if (this.token && Date.now() < this.tokenExpiresAt - 60_000) {
      return this.token;
    }
    if (!this.clientId || !this.clientSecret) {
      throw new FlowAccountError(
        'ยังไม่ได้ตั้งค่า FLOWACCOUNT_CLIENT_ID / FLOWACCOUNT_CLIENT_SECRET — ' +
          'ใส่ใน .env หรือใช้ FLOWACCOUNT_MODE=dry-run',
      );
    }

    /* ของจริงเป็น x-www-form-urlencoded ไม่ใช่ JSON — ยืนยันจาก Postman Collection */
    const response = await this.fetch(`${BASE_URL}${AUTH_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        scope: AUTH_SCOPE,
      }).toString(),
    });

    const body = await safeJson(response);
    if (!response.ok) {
      throw new FlowAccountError('ขอ access token จาก FlowAccount ไม่สำเร็จ', {
        status: response.status,
        body,
      });
    }

    this.token = body.access_token ?? body.accessToken;
    const ttl = Number(body.expires_in ?? body.expiresIn ?? 3600) * 1000;
    this.tokenExpiresAt = Date.now() + ttl;
    return this.token;
  }

  /**
   * สร้างเอกสารเป็นร่าง
   * @param {object} payload  ผลจาก toFlowAccountPayload()
   * @param {object} [meta]   ข้อมูลประกอบสำหรับ dry-run เช่น period
   */
  async createDraftDocument(payload, meta = {}) {
    /* หลักประกัน "ร่างเท่านั้น" อยู่ที่โครงสร้างของคลาสนี้ ไม่ใช่ฟิลด์ในกล่องข้อมูล —
       FlowAccount ไม่มีฟิลด์ status ในตัว request เอกสารที่ POST เข้าไปเป็นร่างโดยปริยาย
       การอนุมัติเป็น endpoint แยก (POST /{doc}/{id}/status/awaiting)
       ซึ่งทั้งไฟล์นี้ไม่มีโค้ดเรียกเลยแม้แต่บรรทัดเดียว และต้องไม่มีต่อไป
       เดิมโค้ดตรงนี้ตรวจ payload.status === 'draft' ซึ่งเป็นฟิลด์ที่ไม่มีอยู่จริงในสเปก
       หลักประกันจึงเคยพิงอยู่กับของที่ FlowAccount ไม่เคยอ่าน */
    if (payload.documentStructureType !== 'InlineDocument') {
      throw new FlowAccountError(
        'payload ต้องเป็น InlineDocument เพราะต้องหักส่วนลดวันลารายบรรทัด ' +
          `แต่ได้ "${payload.documentStructureType}"`,
      );
    }

    if (this.isDryRun) {
      return {
        mode: MODE.DRY_RUN,
        ok: true,
        documentNo: simulateDocumentNo(meta.period, meta.sequence),
        documentType: this.documentType,
        status: 'draft',
        note:
          'โหมด dry-run — ไม่ได้เรียก FlowAccount จริง เลขเอกสารนี้เป็นค่าเสมือน ' +
          'ตั้ง FLOWACCOUNT_MODE=sandbox พร้อม client id/secret เพื่อยิงของจริง',
        requestBody: payload,
      };
    }

    const path = DOCUMENT_PATHS[this.documentType];
    if (!path) {
      throw new FlowAccountError(`ไม่รู้จักชนิดเอกสาร "${this.documentType}"`);
    }

    const token = await this.getAccessToken();
    const response = await this.fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    const body = await safeJson(response);
    if (!response.ok) {
      throw new FlowAccountError('สร้างเอกสารใน FlowAccount ไม่สำเร็จ', {
        status: response.status,
        body,
      });
    }

    return {
      mode: this.mode,
      ok: true,
      documentNo:
        body.documentNumber ?? body.documentNo ?? body.data?.documentNumber ?? null,
      documentType: this.documentType,
      status: body.status ?? 'draft',
      requestBody: payload,
      responseBody: body,
    };
  }

  /** ดึงเอกสารเดิม (ใบเสนอราคา / PO) มา cross-check เรทราคา */
  async listDocuments({ type = 'quotations', from, to } = {}) {
    if (this.isDryRun) {
      return { mode: MODE.DRY_RUN, ok: true, data: [], note: 'dry-run — ไม่มีข้อมูลจริง' };
    }
    const token = await this.getAccessToken();
    const params = new URLSearchParams();
    if (from) params.set('fromDate', from);
    if (to) params.set('toDate', to);

    const response = await this.fetch(`${BASE_URL}/${type}?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await safeJson(response);
    if (!response.ok) {
      throw new FlowAccountError(`ดึง ${type} จาก FlowAccount ไม่สำเร็จ`, {
        status: response.status,
        body,
      });
    }
    return { mode: this.mode, ok: true, data: body.data ?? body };
  }
}

async function safeJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

/**
 * เลขเอกสารเสมือนสำหรับ dry-run — เลียนรูปแบบจริง INV + YYYYMM + running
 * ใบจริงของรอบ ม.ค. 2026 คือ INV2026020006 (ออกเดือน ก.พ.)
 */
function simulateDocumentNo(period, sequence = 6) {
  if (!period) return `INV-DRYRUN-${String(sequence).padStart(4, '0')}`;
  const [year, month] = period.split('-').map(Number);
  const billMonth = month === 12 ? 1 : month + 1;
  const billYear = month === 12 ? year + 1 : year;
  return `INV${billYear}${String(billMonth).padStart(2, '0')}${String(sequence).padStart(4, '0')}`;
}
