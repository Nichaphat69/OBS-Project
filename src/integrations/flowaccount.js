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
 * ✅ ยิง sandbox จริงแล้ว 31 ก.ค. 2569 (ดูรายละเอียดใน docs/checklist.md หัวข้อ 8)
 *   · items[].id — ไม่ต้องมี ยิงโดยไม่ใส่แล้วสำเร็จ FlowAccount สร้าง product-master ให้เองจากชื่อ item
 *     และเรียกซ้ำครั้งที่สองก็จับคู่ product-master ตัวเดิมให้ ไม่สร้างซ้ำ
 *   · sellChartOfAccountCode 41210 — เช็คกับ /chart-of-accounts/accounts ของ sandbox แล้วมีจริง
 *     ชื่อ "Revenue from Rendering of Services" ตรงกับที่ใช้ (ยังควรให้ฝ่ายบัญชี iPassion ยืนยันอีกที
 *     เผื่อผังบัญชีจริงถูกปรับแต่งไปจากค่ามาตรฐาน)
 *   · เจอ bug จริง — ตอนแรกอ่านเลขเอกสารผิดฟิลด์ (เดาว่า documentNumber/documentNo ที่ไม่มีอยู่จริง
 *     ของจริงคือ data.documentSerial) แก้แล้วใน createDraftDocument() — ไม่มีเทสต์คุมจุดนี้มาก่อน
 *     เพราะเทสต์เดิมมีแต่โหมด dry-run เท่านั้น เพิ่ม test/flowaccount.test.js คุมด้วย fetch จำลอง
 *   · "ดาวน์โหลด PDF" ตามเอกสารข้อ 4.3 — Postman Collection ไม่มี endpoint ให้ไฟล์ PDF ตรงๆ เลย
 *     มีแต่ /sharedocument ที่คืนลิงก์หน้าเอกสาร HTML พิมพ์ได้ (getShareLink()) ใช้แทนกัน
 *
 * ⚠️ ที่ยังค้างก่อนเปิดโหมด live
 *   1. เลือก Billing Note หรือ Tax Invoice ให้ตรง flow บัญชีปัจจุบัน — ยิงได้ทั้งสองแบบทางเทคนิคแล้ว
 *      เหลือแค่ตัดสินใจ
 *   2. contact ซ้ำทุกครั้งที่สร้างเอกสาร — ยิงลูกค้าเดิม (ชื่อ+เลขผู้เสียภาษีตรงกัน) 2 ครั้งได้ contactId
 *      คนละตัว ไม่มีทางสั่ง "ใช้ contact เดิม" ผ่าน endpoint สร้างเอกสารได้เลย (ลองส่ง contactCode ซ้ำ
 *      ก็ยังสร้างใหม่ไม่ error แต่ถ้า contactCode นั้นถูกสร้างไว้ก่อนผ่าน POST /contacts จะ error
 *      CONTACT_CODE_DUPLICATE แทน) ต้องถามฝ่ายบัญชีว่ารับได้ไหมที่ทะเบียนลูกค้าจะซ้ำทุกเดือน
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

/* endpoint ขอลิงก์ดูเอกสาร (ดูเหตุผลที่ใช้ลิงก์ ไม่ใช่ไฟล์ PDF ตรงๆ ใน getShareLink()) */
const SHARE_PATHS = {
  'billing-note': '/billing-notes/sharedocument',
  'tax-invoice': '/tax-invoices/sharedocument',
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
        documentId: null,          // ไม่มีเอกสารจริงให้อ้าง จึงขอลิงก์ดูเอกสารไม่ได้ในโหมดนี้
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

    /* ของจริงห่อทุกอย่างไว้ใต้ .data และเลขเอกสารที่คนอ่านคือ documentSerial (เช่น "BL2026020001")
       ไม่ใช่ documentNumber/documentNo — ยืนยันจากการยิง sandbox จริงเมื่อ 31 ก.ค. 2569
       documentId คือรหัสภายในตัวเลข (เช่น 200154) เอาไว้ขอลิงก์ดูเอกสารต่อใน getShareLink() */
    const data = body?.data ?? body;
    return {
      mode: this.mode,
      ok: true,
      documentNo: data?.documentSerial ?? null,
      documentId: data?.documentId ?? data?.recordId ?? null,
      documentType: this.documentType,
      status: data?.statusString ?? 'draft',
      requestBody: payload,
      responseBody: body,
    };
  }

  /**
   * ลิงก์ดูเอกสาร (HTML พิมพ์ได้) — ใช้แทน "ดาวน์โหลด PDF" เพราะ Postman Collection ของจริง
   * ไม่มี endpoint ให้ไฟล์ PDF ตรงๆ เลย มีแต่ตัวนี้ที่คืนลิงก์หน้าเอกสารแบบพิมพ์ได้
   * (ยิงทดสอบแล้ว 31 ก.ค. 2569 — เปิดแล้วเป็นหน้าเอกสารเต็มรูปแบบ พิมพ์เป็น PDF จากเบราว์เซอร์ได้ปกติ)
   */
  async getShareLink(documentId, { culture = 'th' } = {}) {
    if (this.isDryRun) {
      return { mode: MODE.DRY_RUN, ok: true, link: null };
    }
    if (!documentId) {
      throw new FlowAccountError('ต้องมี documentId ของเอกสารที่สร้างไปแล้วก่อนขอลิงก์ดูเอกสาร');
    }
    const path = SHARE_PATHS[this.documentType];
    if (!path) {
      throw new FlowAccountError(`ไม่รู้จักชนิดเอกสาร "${this.documentType}"`);
    }

    const token = await this.getAccessToken();
    const response = await this.fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ documentId, culture }),
    });

    const body = await safeJson(response);
    if (!response.ok) {
      throw new FlowAccountError('ขอลิงก์ดูเอกสารจาก FlowAccount ไม่สำเร็จ', {
        status: response.status,
        body,
      });
    }
    return { mode: this.mode, ok: true, link: body?.data?.link ?? null };
  }

  /**
   * ไฟล์ PDF ตัวจริงของเอกสาร — ดึงจากหน้า shareLink ไม่ใช่จาก API
   *
   * ไล่ดูหน้า share ของจริงแล้ว (6 ส.ค. 2569): หน้านั้นไม่ได้ไปโหลด PDF จากที่อื่นมาแสดง
   * แต่ **ฝังไฟล์ทั้งไฟล์มาในหน้าเลย** เป็น base64 (`var pdfAsDataUri = "data:application/pdf;base64,…"`)
   * แล้วให้ pdf.js วาดลง canvas — ปุ่มดาวน์โหลดบนหน้าก็แปลงสตริงก้อนเดียวกันนี้เป็นไฟล์
   * เพราะงั้นดึง HTML มาแล้วตัด base64 ออกมา ก็ได้ไฟล์เดียวกับที่กดดาวน์โหลดเองเป๊ะๆ
   *
   * ในหน้ายังมี URL ไป media.flowaccount.com อยู่ด้วย แต่บรรทัดนั้นถูก comment ทิ้งไว้ในโค้ดของเขา
   * ไม่ได้ใช้งานจริง เลยไม่ยึดเป็นหลัก — ยึด base64 ที่หน้าใช้วาดจริงแทน
   *
   * หน้า share เปิดได้โดยไม่ต้องมี token (ใครถือลิงก์ก็เปิดได้) จึงไม่ต้องขอ access token ที่นี่
   */
  async fetchSharedPdf(shareLink) {
    if (!shareLink) {
      throw new FlowAccountError('ต้องมีลิงก์ดูเอกสารก่อนจึงจะดึงไฟล์ PDF ได้');
    }

    const response = await this.fetch(shareLink, { headers: { Accept: 'text/html' } });
    if (!response.ok) {
      throw new FlowAccountError('เปิดหน้าเอกสารของ FlowAccount เพื่อดึงไฟล์ PDF ไม่สำเร็จ', {
        status: response.status,
      });
    }

    const html = await response.text();
    const match = html.match(/data:application\/pdf;base64,([A-Za-z0-9+/=]+)/);
    if (!match) {
      throw new FlowAccountError(
        'ไม่พบไฟล์ PDF ฝังอยู่ในหน้าเอกสารของ FlowAccount — หน้าอาจเปลี่ยนรูปแบบไปแล้ว',
      );
    }

    const bytes = Buffer.from(match[1], 'base64');
    /* กันกรณีตัด base64 ได้ไม่ครบ/ได้ก้อนอื่นมาแทน — ไฟล์ PDF จริงต้องขึ้นต้นด้วย %PDF เสมอ */
    if (bytes.subarray(0, 4).toString('latin1') !== '%PDF') {
      throw new FlowAccountError('ข้อมูลที่ดึงมาจากหน้าเอกสารไม่ใช่ไฟล์ PDF ที่อ่านได้');
    }
    return { mode: this.mode, ok: true, bytes };
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
