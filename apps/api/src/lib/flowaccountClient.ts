/**
 * FlowAccount API client — ported from src/integrations/flowaccount.js.
 * See that file's header comment for the full history of what's been verified against the real
 * sandbox (endpoint names, field names, the documentSerial/documentId quirk, contact dedup).
 * createDraftDocument/getShareLink/fetchSharedPdf are used by cyclesService.ts's approveCycle();
 * deleteDocument is used by cyclesService.ts's deleteInvoice(); listDocuments by
 * contractsMasterService.ts's listFlowAccountCompanies().
 */

const BASE_URL = process.env.FLOWACCOUNT_BASE_URL ?? 'https://openapi.flowaccount.com/test';
const AUTH_PATH = '/token';
const AUTH_SCOPE = process.env.FLOWACCOUNT_SCOPE ?? 'flowaccount-api';

export const MODE = { DRY_RUN: 'dry-run', SANDBOX: 'sandbox', LIVE: 'live' } as const;
export type FlowAccountMode = (typeof MODE)[keyof typeof MODE];
export type FlowAccountDocumentType = 'billing-note' | 'tax-invoice';

const DOCUMENT_PATHS: Record<FlowAccountDocumentType, string> = {
  'billing-note': '/billing-notes/inline',
  'tax-invoice': '/tax-invoices/inline',
};
const SHARE_PATHS: Record<FlowAccountDocumentType, string> = {
  'billing-note': '/billing-notes/sharedocument',
  'tax-invoice': '/tax-invoices/sharedocument',
};
const DELETE_PATHS: Record<FlowAccountDocumentType, string> = {
  'billing-note': '/billing-notes',
  'tax-invoice': '/tax-invoices',
};

export class FlowAccountError extends Error {
  status: number | null;
  body: unknown;
  constructor(message: string, { status = null, body = null }: { status?: number | null; body?: unknown } = {}) {
    super(message);
    this.name = 'FlowAccountError';
    this.status = status;
    this.body = body;
  }
}

export interface CreateDraftResult {
  mode: string;
  ok: true;
  documentNo: string | null;
  documentId: string | number | null;
  contactId: string | number | null;
  documentType: FlowAccountDocumentType;
  status: string;
  note?: string;
  requestBody: unknown;
  responseBody?: unknown;
}

export class FlowAccountClient {
  mode: string;
  clientId?: string;
  clientSecret?: string;
  documentType: FlowAccountDocumentType;
  private token: string | null = null;
  private tokenExpiresAt = 0;

  constructor({
    mode = process.env.FLOWACCOUNT_MODE ?? MODE.DRY_RUN,
    clientId = process.env.FLOWACCOUNT_CLIENT_ID,
    clientSecret = process.env.FLOWACCOUNT_CLIENT_SECRET,
    documentType = 'billing-note' as FlowAccountDocumentType,
  }: { mode?: string; clientId?: string; clientSecret?: string; documentType?: FlowAccountDocumentType } = {}) {
    this.mode = mode;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.documentType = documentType;
  }

  get isDryRun(): boolean {
    return this.mode === MODE.DRY_RUN;
  }

  async getAccessToken(): Promise<string> {
    if (this.isDryRun) return 'dry-run-token';
    if (this.token && Date.now() < this.tokenExpiresAt - 60_000) return this.token;
    if (!this.clientId || !this.clientSecret) {
      throw new FlowAccountError(
        'ยังไม่ได้ตั้งค่า FLOWACCOUNT_CLIENT_ID / FLOWACCOUNT_CLIENT_SECRET — ใส่ใน .env หรือใช้ FLOWACCOUNT_MODE=dry-run',
      );
    }

    const response = await fetch(`${BASE_URL}${AUTH_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        scope: AUTH_SCOPE,
      }).toString(),
    });

    const body: any = await safeJson(response);
    if (!response.ok) {
      throw new FlowAccountError('ขอ access token จาก FlowAccount ไม่สำเร็จ', { status: response.status, body });
    }

    this.token = body.access_token ?? body.accessToken;
    const ttl = Number(body.expires_in ?? body.expiresIn ?? 3600) * 1000;
    this.tokenExpiresAt = Date.now() + ttl;
    return this.token as string;
  }

  async createDraftDocument(payload: any, meta: { period?: string; sequence?: number } = {}): Promise<CreateDraftResult> {
    if (payload.documentStructureType !== 'InlineDocument') {
      throw new FlowAccountError(
        `payload ต้องเป็น InlineDocument เพราะต้องหักส่วนลดวันลารายบรรทัด แต่ได้ "${payload.documentStructureType}"`,
      );
    }

    if (this.isDryRun) {
      return {
        mode: MODE.DRY_RUN,
        ok: true,
        documentNo: simulateDocumentNo(meta.period, meta.sequence),
        documentId: null,
        contactId: null,
        documentType: this.documentType,
        status: 'draft',
        note: 'โหมด dry-run — ไม่ได้เรียก FlowAccount จริง เลขเอกสารนี้เป็นค่าเสมือน',
        requestBody: payload,
      };
    }

    const path = DOCUMENT_PATHS[this.documentType];
    if (!path) {
      throw new FlowAccountError(`ไม่รู้จักชนิดเอกสาร "${this.documentType}"`);
    }
    const token = await this.getAccessToken();
    const response = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });

    const body: any = await safeJson(response);
    if (!response.ok) {
      throw new FlowAccountError('สร้างเอกสารใน FlowAccount ไม่สำเร็จ', { status: response.status, body });
    }

    const data = body?.data ?? body;
    return {
      mode: this.mode,
      ok: true,
      documentNo: data?.documentSerial ?? null,
      documentId: data?.documentId ?? data?.recordId ?? null,
      contactId: data?.contactId ?? null,
      documentType: this.documentType,
      status: data?.statusString ?? 'draft',
      requestBody: payload,
      responseBody: body,
    };
  }

  async getShareLink(documentId: string | number, { culture = 'th' }: { culture?: string } = {}) {
    if (this.isDryRun) return { mode: MODE.DRY_RUN, ok: true, link: null as string | null };
    if (!documentId) {
      throw new FlowAccountError('ต้องมี documentId ของเอกสารที่สร้างไปแล้วก่อนขอลิงก์ดูเอกสาร');
    }
    const path = SHARE_PATHS[this.documentType];
    if (!path) {
      throw new FlowAccountError(`ไม่รู้จักชนิดเอกสาร "${this.documentType}"`);
    }
    const token = await this.getAccessToken();
    const response = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ documentId, culture }),
    });
    const body: any = await safeJson(response);
    if (!response.ok) {
      throw new FlowAccountError('ขอลิงก์ดูเอกสารจาก FlowAccount ไม่สำเร็จ', { status: response.status, body });
    }
    return { mode: this.mode, ok: true, link: (body?.data?.link ?? null) as string | null };
  }

  /** ไฟล์ PDF ตัวจริงของเอกสาร — ดึงจากหน้า shareLink ไม่ใช่จาก API (FlowAccount ไม่มี endpoint
   * ดาวน์โหลด PDF ตรงๆ เลย ตาม Postman Collection ข้อ 4.3 — ยืนยันจริงจากสมัยพอร์ต flowaccount.js)
   * หน้า shareLink **ฝังไฟล์ทั้งไฟล์มาในหน้าเลย** เป็น base64 (`data:application/pdf;base64,…`) ให้
   * pdf.js วาดลง canvas ฝั่ง client เอง — ที่นี่ดึง HTML มา regex เอา base64 ออกมาแทน หน้า share เปิดได้
   * โดยไม่ต้องมี token (ใครถือลิงก์ก็เปิดได้) จึงไม่ต้องขอ access token ก่อนเรียก */
  async fetchSharedPdf(shareLink: string | null | undefined): Promise<{ mode: string; ok: true; bytes: Buffer }> {
    if (!shareLink) throw new FlowAccountError('ต้องมีลิงก์ดูเอกสารก่อนจึงจะดึงไฟล์ PDF ได้');
    const response = await fetch(shareLink, { headers: { Accept: 'text/html' } });
    if (!response.ok) {
      throw new FlowAccountError('เปิดหน้าเอกสารของ FlowAccount เพื่อดึงไฟล์ PDF ไม่สำเร็จ', { status: response.status });
    }
    const html = await response.text();
    const match = html.match(/data:application\/pdf;base64,([A-Za-z0-9+/=]+)/);
    if (!match) {
      throw new FlowAccountError('ไม่พบไฟล์ PDF ฝังอยู่ในหน้าเอกสารของ FlowAccount — หน้าอาจเปลี่ยนรูปแบบไปแล้ว');
    }
    const bytes = Buffer.from(match[1], 'base64');
    if (bytes.subarray(0, 4).toString('latin1') !== '%PDF') {
      throw new FlowAccountError('ข้อมูลที่ดึงมาจากหน้าเอกสารไม่ใช่ไฟล์ PDF ที่อ่านได้');
    }
    return { mode: this.mode, ok: true, bytes };
  }

  /** ดึงเอกสารเดิม (ใบเสนอราคา / PO) มา cross-check เรทราคา — ported from
   * src/integrations/flowaccount.js listDocuments(). Used by contractsMasterService.ts's
   * listFlowAccountCompanies() to autofill the "เพิ่มลูกค้าใหม่" form. */
  async listDocuments({ type = 'quotations', from, to }: { type?: string; from?: string; to?: string } = {}) {
    if (this.isDryRun) return { mode: MODE.DRY_RUN, ok: true, data: [] as any, note: 'dry-run — ไม่มีข้อมูลจริง' };
    const token = await this.getAccessToken();
    const params = new URLSearchParams();
    if (from) params.set('fromDate', from);
    if (to) params.set('toDate', to);

    const response = await fetch(`${BASE_URL}/${type}?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body: any = await safeJson(response);
    if (!response.ok) {
      throw new FlowAccountError(`ดึง ${type} จาก FlowAccount ไม่สำเร็จ`, { status: response.status, body });
    }
    return { mode: this.mode, ok: true, data: body?.data ?? body };
  }

  async deleteDocument(documentId: string | number) {
    if (this.isDryRun) return { mode: MODE.DRY_RUN, ok: true, deleted: false };
    if (!documentId) {
      throw new FlowAccountError('ต้องมี documentId ของเอกสารที่จะลบ');
    }
    const path = DELETE_PATHS[this.documentType];
    if (!path) {
      throw new FlowAccountError(`ไม่รู้จักชนิดเอกสาร "${this.documentType}"`);
    }
    const token = await this.getAccessToken();
    const response = await fetch(`${BASE_URL}${path}/${documentId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      const body = await safeJson(response);
      throw new FlowAccountError('ลบเอกสารใน FlowAccount ไม่สำเร็จ', { status: response.status, body });
    }
    return { mode: this.mode, ok: true, deleted: true };
  }
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

function simulateDocumentNo(period?: string, sequence = 6): string {
  if (!period) return `INV-DRYRUN-${String(sequence).padStart(4, '0')}`;
  const [year, month] = period.split('-').map(Number);
  const billMonth = month === 12 ? 1 : month + 1;
  const billYear = month === 12 ? year + 1 : year;
  return `INV${billYear}${String(billMonth).padStart(2, '0')}${String(sequence).padStart(4, '0')}`;
}
