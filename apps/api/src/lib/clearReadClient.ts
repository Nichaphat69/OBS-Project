/**
 * ตัวเชื่อม Clear Read (https://clear-read.ai) — เครื่องอ่านเอกสารเจ้าที่สอง คู่กับ ABBYY
 *
 * ⚠️ Clear Read ไม่มีเอกสาร API เปิดเผยเลย ทุกอย่างในไฟล์นี้ยืนยันด้วยการยิงใช้งานจริงกับบัญชีของ user
 * (16 ก.ย. 69) ไม่ได้เดาจากเอกสาร — endpoint ได้มาจากการแกะ JS bundle ของหน้าเว็บแล้วทดสอบทีละตัว
 * ข้อสังเกตที่ทำให้หลงทางได้ถ้าไม่รู้ก่อน:
 *
 * - หน้าเว็บอยู่ที่ clear-read.ai แต่ API อยู่คนละโดเมน (`ai.prior-dev.app/prior-clear-read`)
 * - ไม่มีระบบ API key ต้องล็อกอิน email/password เอา JWT (อายุ ~1 ชม.) มาใช้
 * - ต้องส่ง `project_id` ไปแทบทุก endpoint และ **ไม่ได้อยู่ใน JWT** (ใน JWT มีแค่ user_id) ต้องขอจาก
 *   `POST /list/project` — ถ้าเผลอเอา user_id ไปใช้เป็น project_id `inquiry/templates` จะตอบ 200
 *   เหมือนใช้ได้ (แต่คืนเฉพาะเทมเพลตกลาง) แล้วไปพังตอน `agent/read` ว่า "project_id is not found"
 * - `POST /agent/read` **ไม่คืน document_id กลับมา** (ตอบแค่ `{code:"2000"}`) และเป็นงาน async ต้องไป
 *   หา document ของตัวเองเอาจาก `inquiry/documents` — ที่นี่จึงตั้งชื่อไฟล์ให้ไม่ซ้ำก่อนอัปโหลดทุกครั้ง
 *   จะได้จับคู่กลับมาได้แน่นอน ไม่ไปหยิบเอกสารของคนอื่นที่อัปพร้อมกัน
 * - อ่าน 1 หน้าใช้เวลาจริง ~2.8 นาที จึงต้อง poll ไม่ใช่ตั้ง timeout ของ request
 */
import { randomUUID } from 'node:crypto';
import {
  TIMESHEET_DETAIL_FIELDS,
  TIMESHEET_DETAIL_LINE_ITEM,
  TIMESHEET_DOCUMENT_FIELDS,
  TIMESHEET_SUMMARY_FIELDS,
  classifyDayKind,
  toInternalHeaderKey,
  classifyLeaveType,
  normalizeDate,
  normalizePeriod,
} from '@obs/domain';

const BASE_URL = () => process.env.CLEAR_READ_BASE_URL ?? 'https://ai.prior-dev.app/prior-clear-read';

/** เพดานรอผลอ่าน — ของจริงวัดได้ ~2.8 นาที/หน้า ตั้งเผื่อไฟล์หลายหน้าไว้มาก เพราะฝั่งโน้นไม่ได้บอก
 * ความคืบหน้าเป็น % ให้ดูเลย มีแค่ running/succeeded/failed */
const POLL_TIMEOUT_MS = 20 * 60 * 1000;
const POLL_INTERVAL_MS = 10_000;
/** เผื่อเวลาให้เอกสารโผล่ในรายการหลังอัปโหลด (คนละจังหวะกับตอนประมวลผลเสร็จ) */
const APPEAR_TIMEOUT_MS = 90_000;

export class ClearReadError extends Error {
  status: number | null;
  body: unknown;
  constructor(message: string, { status = null, body = null }: { status?: number | null; body?: unknown } = {}) {
    super(message);
    this.name = 'ClearReadError';
    this.status = status;
    this.body = body;
  }
}

export function hasClearReadCredentials(): boolean {
  return Boolean(
    process.env.CLEAR_READ_BASE_URL &&
      process.env.CLEAR_READ_EMAIL &&
      process.env.CLEAR_READ_PASSWORD &&
      process.env.CLEAR_READ_PROJECT_ID,
  );
}

const sleep = (ms: number) => new Promise((r) => { setTimeout(r, ms); });

export interface ClearReadField {
  key_field: string;
  value: unknown;
}

/** เทมเพลตหนึ่งตัวในรูปที่หน้าเลือกเทมเพลตใช้ได้เลย — ตัดส่วนที่ไม่ได้ใช้ (bbox/validations/timestamps)
 * ออกตั้งแต่ชั้นนี้ เพราะ schema_json ดิบมีคำอธิบายฟิลด์ยาวมากต่อช่อง (ส่งให้เครื่องอ่านใช้ตัดสินใจ) */
export interface ClearReadTemplate {
  id: string;
  name: string;
  isDefault: boolean;
  description: string | null;
  version: number | null;
  /** ชื่อฟิลด์ระดับหัวเอกสารที่เทมเพลตนี้อ่าน */
  fields: string[];
  /** คอลัมน์ในตารางรายวัน (ว่างถ้าเทมเพลตนั้นไม่มี line item) */
  detailColumns: string[];
}

function toTemplateSummary(tpl: any, isDefault: boolean): ClearReadTemplate {
  let schema: any = tpl.schema_json;
  if (typeof schema === 'string') {
    try {
      schema = JSON.parse(schema);
    } catch {
      schema = null;
    }
  }
  const specs: any[] = Array.isArray(schema?.fields) ? schema.fields : [];
  const lineItem = specs.find((f) => f?.type === 'object_list');
  const columns: any[] = lineItem?.item_list?.[0]?.columns ?? [];

  return {
    id: String(tpl.template_id),
    name: String(tpl.template_name ?? tpl.template_id),
    isDefault,
    description: tpl.description ? String(tpl.description) : null,
    version: typeof tpl.version === 'number' ? tpl.version : null,
    fields: specs.filter((f) => f?.type !== 'object_list').map((f) => String(f?.name)),
    detailColumns: columns.map((c) => String(c?.name)),
  };
}

export class ClearReadClient {
  email?: string;
  password?: string;
  projectId?: string;
  templateId?: string;
  private token: string | null = null;
  private tokenExpiresAt = 0;

  constructor({
    email = process.env.CLEAR_READ_EMAIL,
    password = process.env.CLEAR_READ_PASSWORD,
    projectId = process.env.CLEAR_READ_PROJECT_ID,
    templateId = process.env.CLEAR_READ_TEMPLATE_ID,
  }: { email?: string; password?: string; projectId?: string; templateId?: string } = {}) {
    this.email = email;
    this.password = password;
    this.projectId = projectId;
    this.templateId = templateId;
  }

  assertConfigured() {
    if (!this.email || !this.password || !this.projectId) {
      throw new ClearReadError(
        'ยังไม่ได้ตั้งค่า Clear Read — ใส่ CLEAR_READ_EMAIL/CLEAR_READ_PASSWORD/CLEAR_READ_PROJECT_ID ใน .env',
        { status: 400 },
      );
    }
  }

  /** JWT อายุ ~1 ชม. — cache ไว้แล้วขอใหม่เมื่อใกล้หมดอายุ (กันงาน ingest ยาวๆ ตายกลางทางเพราะ token
   * หมดอายุระหว่างอ่านไฟล์ที่ใช้เวลาหลายนาทีต่อไฟล์) เผื่อไว้ 60 วิเหมือน abbyyClient */
  async getAccessToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiresAt - 60_000) return this.token;
    this.assertConfigured();

    const res = await fetch(`${BASE_URL()}/sign-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: this.email, password: this.password }),
    });
    const body: any = await safeJson(res);
    if (!res.ok || !body?.data?.access_token) {
      throw new ClearReadError('ล็อกอิน Clear Read ไม่สำเร็จ — ตรวจ CLEAR_READ_EMAIL/CLEAR_READ_PASSWORD', {
        status: res.status,
        body,
      });
    }

    this.token = body.data.access_token as string;
    this.tokenExpiresAt = jwtExpiryMs(this.token) ?? Date.now() + 55 * 60 * 1000;
    return this.token;
  }

  /** POST ทุกเส้นของ Clear Read ใช้ Bearer เหมือนกันหมด — เจอ 401 ให้ทิ้ง token แล้วล็อกอินใหม่หนึ่งครั้ง
   * (เผื่อฝั่งโน้นเพิกถอน token ก่อนหมดอายุจริง) */
  private async post(path: string, init: { json?: unknown; form?: FormData }, retryOn401 = true): Promise<any> {
    const token = await this.getAccessToken();
    const res = await fetch(`${BASE_URL()}${path}`, {
      method: 'POST',
      headers: init.form ? { Authorization: `Bearer ${token}` } : { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: init.form ?? JSON.stringify(init.json ?? {}),
    });

    if (res.status === 401 && retryOn401) {
      this.token = null;
      return this.post(path, init, false);
    }

    const body: any = await safeJson(res);
    if (!res.ok) {
      throw new ClearReadError(`เรียก Clear Read ${path} ไม่สำเร็จ (${body?.message ?? res.status})`, {
        status: res.status,
        body,
      });
    }
    return body;
  }

  /** ส่งไฟล์เข้าอ่าน แล้วคืน document_id ที่จับคู่ได้จากชื่อไฟล์ที่ตั้งให้ไม่ซ้ำ (ดูหมายเหตุหัวไฟล์ —
   * endpoint นี้ไม่คืน id กลับมาเอง) */
  async submitDocument(source: Buffer, { templateId }: { templateId?: string | null } = {}): Promise<string> {
    this.assertConfigured();
    const uploadName = `obs-${randomUUID()}.pdf`;
    const form = new FormData();
    form.append('project_id', this.projectId!);
    const template = templateId || this.templateId;
    if (template) form.append('template_id', template);
    form.append('image_file', new Blob([new Uint8Array(source)], { type: 'application/pdf' }), uploadName);

    await this.post('/agent/read', { form });

    const deadline = Date.now() + APPEAR_TIMEOUT_MS;
    for (;;) {
      const found = await this.findDocumentByName(uploadName);
      if (found) return found;
      if (Date.now() > deadline) {
        throw new ClearReadError(
          `ส่งไฟล์เข้า Clear Read แล้วแต่หาเอกสารในระบบไม่เจอภายใน ${APPEAR_TIMEOUT_MS / 1000} วินาที — ไฟล์อาจยังอยู่ในคิว ลองดูที่หน้าเว็บ Clear Read`,
        );
      }
      await sleep(3_000);
    }
  }

  private async findDocumentByName(fileName: string): Promise<string | null> {
    const body = await this.post('/inquiry/documents', {
      json: { project_id: this.projectId, page: 1, page_limit: 50 },
    });
    const items: any[] = body?.data?.single_type ?? [];
    return items.find((d) => d?.file_name === fileName)?.document_id ?? null;
  }

  async waitUntilRead(documentId: string): Promise<void> {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    for (;;) {
      const body = await this.post('/fetch/status/document', {
        json: { project_id: this.projectId, document_id: documentId },
      });
      const status = body?.data?.status ?? body?.data;
      if (status === 'succeeded') return;
      if (status === 'failed' || status === 'error') {
        throw new ClearReadError(`Clear Read อ่านเอกสารไม่สำเร็จ (สถานะ "${status}")`, { body });
      }
      if (Date.now() > deadline) {
        throw new ClearReadError(
          `รอ Clear Read อ่านเอกสารนานเกิน ${POLL_TIMEOUT_MS / 60000} นาที (สถานะล่าสุด "${status}") — ` +
            'เอกสารอาจยังประมวลผลอยู่ ไม่ได้แปลว่าล้มเหลว ตรวจผลได้ที่หน้าเว็บ Clear Read แล้วลองใหม่อีกครั้ง',
          { body },
        );
      }
      await sleep(POLL_INTERVAL_MS);
    }
  }

  /** รายการเทมเพลตทั้งหมดในโปรเจกต์ — ใช้กับหน้าเลือกเทมเพลตต่อสัญญา คืนชื่อฟิลด์มาด้วยเลย
   * (มากับ response อยู่แล้วใน schema_json ไม่ต้องเรียกเพิ่มรายตัว) ผู้ใช้จะได้เห็นว่าเทมเพลตนั้นอ่าน
   * อะไรบ้างก่อนเลือก
   *
   * ⚠️ endpoint นี้ "ครึ่งๆ กลางๆ" ถ้าส่ง project_id ผิด: ตอนไล่แกะ API เคยเผลอส่ง user_id ไปแทน
   * แล้วมันตอบ 200 พร้อมเทมเพลตกลาง 6 ตัวเหมือนใช้ได้ปกติ แต่ custom เป็น 0 ทั้งหมด — ที่นี่จึงยึด
   * projectId ที่ตั้งค่าไว้เสมอ และเช็คว่าเทมเพลตฝั่ง custom เป็นของโปรเจกต์เราจริง ถ้าไม่ตรงแปลว่า
   * ตั้ง CLEAR_READ_PROJECT_ID ผิด ซึ่งควรรู้ตั้งแต่ตอนเปิดหน้าเลือก ไม่ใช่ไปพังตอนอ่านเอกสารจริง */
  async listTemplates(): Promise<ClearReadTemplate[]> {
    this.assertConfigured();
    const body = await this.post('/inquiry/templates', {
      json: { project_id: this.projectId, page: 1, page_limit: 200 },
    });
    const data = body?.data ?? {};

    const out: ClearReadTemplate[] = [];
    for (const [list, isDefault] of [
      [data.custom_templates, false],
      [data.default_templates, true],
    ] as const) {
      for (const entry of Array.isArray(list) ? list : []) {
        const tpl = entry?.template ?? entry;
        if (!tpl?.template_id) continue;
        if (!isDefault && tpl.project_id && tpl.project_id !== this.projectId) {
          throw new ClearReadError(
            'Clear Read คืนเทมเพลตของโปรเจกต์อื่นมา — น่าจะตั้ง CLEAR_READ_PROJECT_ID ผิด (ดู POST /list/project)',
          );
        }
        out.push(toTemplateSummary(tpl, isDefault));
      }
    }
    return out;
  }

  async fetchDetail(documentId: string): Promise<any> {
    const body = await this.post('/inquiry/ocr-detail', {
      json: { project_id: this.projectId, document_id: documentId },
    });
    return body?.data;
  }

  /** ส่ง → รอ → ดึงผล ครบวงจร */
  async readDocument(source: Buffer, { templateId }: { templateId?: string | null } = {}): Promise<any> {
    const documentId = await this.submitDocument(source, { templateId });
    await this.waitUntilRead(documentId);
    return this.fetchDetail(documentId);
  }
}

async function safeJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function jwtExpiryMs(token: string): number | null {
  try {
    const part = token.split('.')[1];
    const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const exp = JSON.parse(json)?.exp;
    return typeof exp === 'number' ? exp * 1000 : null;
  } catch {
    return null;
  }
}

// ── แปลงผลของ Clear Read → รูปกลางของระบบ ──────────────────────────────

/**
 * ชื่อฟิลด์ของแม่แบบรุ่นเก่า (ก่อน Master Template V4) → ชื่อตาม V4
 *
 * ทำไมต้องมี: prompt กับ schema อยู่ใน "แม่แบบฝั่ง Clear Read" ไม่ได้ส่งไปจาก request ของเรา (ดูหมายเหตุ
 * หัวไฟล์) แม่แบบฝั่งเขากับสารบัญกลางฝั่งเราจึงขยับเวอร์ชันแยกกัน และจะไม่ตรงกันอยู่ช่วงหนึ่งเสมอจนกว่า
 * จะมีคนไปอัปเดตแม่แบบ ถ้า map ตามสารบัญ V4 อย่างเดียว แม่แบบที่ยังเป็นรุ่นเก่าจะคืนชื่อเดิมมาแล้ว
 * **ค่าหายเงียบๆ ทั้งชุด ไม่ error ไม่เตือน** — รอยต่อนี้จึงรับความต่างไว้เอง เพื่อให้สารบัญกลางเป็น V4
 * สะอาดๆ ได้โดยไม่ต้องแบก alias ย้อนหลัง
 *
 * รายการนี้มาจากการอ่านแม่แบบจริงในบัญชีของ user (16 ก.ย. 69) ไม่ได้ไล่เดาจากเอกสาร — ลบออกได้เมื่อ
 * ยืนยันแล้วว่าแม่แบบทุกตัวที่ใช้งานจริงอัปเป็น V4 หมดแล้ว
 */
const LEGACY_NAME_ALIASES: Record<string, string> = {
  Approver_Name: 'Approved_By_Name',
  Site: 'Document_Site',
  Customer_site: 'Daily_Site',
  Total_Hours: 'Daily_Total_Hours',
};

/** ระดับเอกสารรวมทั้งหัวเอกสาร ช่องสรุป และลายเซ็น — V4 แยกสามหมวดแต่ Clear Read คืนมาปนกันใน
 * `fields` ชุดเดียว จึงต้องหาจากทั้งสามหมวด */
const DOCUMENT_KEY_BY_NAME = new Map(TIMESHEET_DOCUMENT_FIELDS.map((f) => [f.name, f.key]));
const DETAIL_KEY_BY_NAME = new Map(TIMESHEET_DETAIL_FIELDS.map((f) => [f.name, f.key]));
const SUMMARY_KEYS = new Set(TIMESHEET_SUMMARY_FIELDS.map((f) => f.key));

function documentKeyFor(name: string): string | undefined {
  return DOCUMENT_KEY_BY_NAME.get(LEGACY_NAME_ALIASES[name] ?? name);
}

function detailKeyFor(columnName: string): string | undefined {
  return DETAIL_KEY_BY_NAME.get(LEGACY_NAME_ALIASES[columnName] ?? columnName);
}

/** คำที่ถ้าทั้งช่องเป็นคำนี้พอดี ถือว่าเป็นวันลาแน่นอน — สำเนามาจาก abbyyClient.ts's EXACT_LEAVE_WORDS
 * ให้ตรงกันคำต่อคำ (จงใจไม่ import ข้ามไฟล์เพราะเป็นของอีกเซสชันที่กำลังแก้อยู่ ถ้าย้ายไป @obs/domain
 * เมื่อไหร่ควรให้ทั้งสองฝั่งใช้ตัวเดียวกัน) เทียบแบบ "ทั้งช่องต้องเท่ากับคำนี้" ไม่ใช่ substring จึงเอาไป
 * เทียบกับช่องรายละเอียดงานที่เป็นข้อความยาวๆได้โดยไม่ตีความผิด */
const EXACT_LEAVE_WORDS = new Set([
  'leave', 'vacation', 'sick', 'personal', 'annual', 'absent',
  'vacation leave', 'sick leave', 'personal leave', 'annual leave',
  'ลา', 'ลาป่วย', 'ลากิจ', 'ลาพักร้อน',
]);

/** ช่องที่ถือเป็น "ป้ายบอกประเภทวัน" — ตรงกับที่ ABBYY ส่งให้ classifyDayKind() คือทุกช่องยกเว้นช่อง
 * รายละเอียดงาน (ข้อความยาวอิสระ ถ้าเอาไปรวมจะ match คำว่า leave/holiday โดยบังเอิญได้ง่าย) */
const LEAVE_LABEL_KEYS = ['workType', 'leaveType', 'activity', 'remarks', 'site', 'workLocation', 'project', 'day'] as const;

function leaveRowLabel(row: Record<string, unknown>): string {
  return [...LEAVE_LABEL_KEYS.map((k) => row[k]), row.jobDescription].filter(Boolean).map(String).join(' ');
}

/**
 * แถวนี้เป็นวันลาไหม — ใช้กติกาเดียวกับฝั่ง ABBYY ทุกประการ (17 ก.ย. 69)
 *
 * เดิมที่นี่ดูแค่ช่อง `Leave_Type` ช่องเดียว ซึ่งแคบกว่า ABBYY มาก ฟอร์มที่เขียนวันลาไว้ในช่องประเภทวัน
 * หรือเขียนเป็นคำว่า "ลา" ในช่องอื่นจะอ่านได้วันลา = 0 แล้วส่วนลดวันลาในใบแจ้งหนี้จะเป็น 0 ตามไปด้วย
 * (ยอดในใบแจ้งหนี้ = ค่าจ้างรายเดือน − ส่วนลดวันลา) = เก็บเงินลูกค้าเกินแบบเงียบๆ — ความต่างนี้เกิดจาก
 * โค้ดสองเจ้าเขียนคนละแบบ ไม่ได้ตั้งใจให้ต่าง จึงทำให้ตัดสินใจเหมือนกัน
 *
 * ลำดับความสำคัญของ classifyDayKind() สำคัญและต้องคงไว้: วันหยุด/เสาร์-อาทิตย์ มาก่อนวันลา ดังนั้นแถว
 * ที่เป็นวันหยุดนักขัตฤกษ์จะไม่ถูกนับเป็นวันลาแม้จะมีคำว่าลาปนอยู่ในช่องอื่น
 */
function isLeaveRow(row: Record<string, unknown>): boolean {
  const labels = LEAVE_LABEL_KEYS.map((k) => (row[k] == null ? null : String(row[k])));
  if (classifyDayKind(...labels) === 'leave') return true;
  return [...labels, row.jobDescription == null ? null : String(row.jobDescription)].some(
    (v) => v !== null && EXACT_LEAVE_WORDS.has(v.trim().toLowerCase()),
  );
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** "Feb 2026" / "กุมภาพันธ์ 2569" / "02/2026" → "2026-02" — ใช้ helper ตัวเดียวกับที่ ABBYY ใช้ เพื่อให้
 * รองรับเดือนไทย/อังกฤษและปี พ.ศ./ค.ศ. เหมือนกันทั้งระบบ ค่าดิบยังเก็บไว้ที่ `monthYear` ตามกติกาสเปก */
function resolvePeriod(monthYear: string | null): string | null {
  if (!monthYear) return null;
  // ใช้ normalizePeriod() ของ @obs/domain ตัวเดียวกับที่ระบบใช้อยู่ ไม่เขียน regex เอง — ของเดิมที่เขียน
  // เองตัดคำผิด ("พ.ค. - 2026" ได้แค่ "ค") เพราะไม่ได้เผื่อจุดที่คั่นกลางตัวย่อเดือนไทย ตัวกลางรองรับทั้ง
  // เดือนไทยเต็ม/ย่อ อังกฤษ ตัวเลข และปี พ.ศ. อยู่แล้ว — คืนสตริงเดิมกลับมาถ้าแปลงไม่ได้ จึงต้องเช็ครูป
  const period = normalizePeriod(monthYear);
  return typeof period === 'string' && /^\d{4}-\d{2}$/.test(period) ? period : null;
}

export function mapClearReadResult(detail: any, { expectedPeriod }: { expectedPeriod?: string } = {}) {
  const fields: ClearReadField[] = Array.isArray(detail?.fields) ? detail.fields : [];

  const header: Record<string, string | null> = {};
  const summary: Record<string, number | null> = {};
  let rawRows: any[] = [];
  for (const f of fields) {
    if (f.key_field === TIMESHEET_DETAIL_LINE_ITEM) {
      rawRows = Array.isArray(f.value) ? f.value : [];
      continue;
    }
    const specKey = documentKeyFor(f.key_field);
    if (!specKey) continue;
    // ปล่อยออกเป็น "คีย์ภายใน" ตั้งแต่ตรงนี้เลย ต่างจากคีย์รายวันที่ปล่อยเป็นชื่อสเปกได้ — เพราะ
    // extractionService แปลงให้เฉพาะระดับรายวัน (normalizeDetailKeys) ไม่มีตัวแปลงระดับเอกสาร ถ้าปล่อย
    // เป็นชื่อสเปกออกไป ingestService จะอ่านไม่เจอแล้วคอลัมน์เป็น null เงียบๆ — abbyyClient ก็ทำแบบนี้
    const key = toInternalHeaderKey(specKey);
    // ช่องสรุปท้ายเอกสารต้องลง summary.* เท่านั้น ห้ามไปทับค่าระดับบนที่ชื่อพ้องกัน — โดยเฉพาะ
    // `totalWorkDays` ที่ระดับบนแปลว่า "ค่าที่ระบบใช้ตั้งบิล" ส่วนใน summary แปลว่า "เลขที่เอกสารพิมพ์ไว้"
    // ถ้าปล่อยให้ทับกัน จะเทียบสองค่านี้ไม่ได้อีกเลย ซึ่งเป็นตัวจับบั๊กที่ตั้งใจสร้างไว้
    if (SUMMARY_KEYS.has(specKey)) {
      summary[key] = toNumber(f.value);
      continue;
    }
    header[key] = f.value === null || f.value === undefined ? null : String(f.value);
  }

  const period = resolvePeriod(header.monthYear ?? null) ?? expectedPeriod ?? '';
  const expectedYear = period ? Number(period.slice(0, 4)) : null;

  // คีย์รายวันที่ปล่อยออกไปเป็น "ชื่อตามสเปกกลาง" (day/remarks/workType) ตามที่ extractionService.ts
  // แปลงให้เองด้วย normalizeDetailKeys() หลังจาก read() คืนค่า — ดูคอมเมนต์ที่นั่น
  const days: any[] = [];
  for (const row of rawRows) {
    if (!row || typeof row !== 'object') continue;
    const out: Record<string, unknown> = {};
    for (const [col, value] of Object.entries(row)) {
      if (col === 'bbox') continue;
      const key = detailKeyFor(col);
      if (!key) continue;
      const spec = TIMESHEET_DETAIL_FIELDS.find((f) => f.key === key);
      out[key] = spec?.type === 'number' ? toNumber(value) : value === '' ? null : value;
    }

    const date = normalizeDate(out.date, period || null);
    if (!date) continue;
    // กันปีเพี้ยนแบบเดียวกับที่เจอจริงฝั่ง ABBYY ("26/01/1900") — ถ้ารู้ปีของรอบแล้วปีในแถวห่างเกิน 1 ปี
    // ถือว่าอ่านผิด ทิ้งแถวนั้นดีกว่าปล่อยให้ไปพังการนับวัน/จับคู่วันลาเงียบๆ ทีหลัง
    if (expectedYear !== null && Math.abs(Number(date.slice(0, 4)) - expectedYear) > 1) continue;
    out.date = date;
    days.push(out);
  }

  const leaveDays = days
    .filter((d) => isLeaveRow(d))
    .map((d) => {
      const rawLabel = leaveRowLabel(d);
      return {
        date: d.date as string,
        // ใช้ค่าจากช่อง Leave_Type ก่อนถ้ามี เพราะเป็นช่องที่ระบุประเภทตรงๆ — ตกไปใช้ข้อความรวมทั้งแถว
        // เฉพาะตอนที่ฟอร์มไม่มีช่องนั้น (ข้อความรวมมีรายละเอียดงานปนอยู่ จัดประเภทพลาดได้ง่ายกว่า)
        type: classifyLeaveType(d.leaveType ? String(d.leaveType) : rawLabel),
        rawLabel,
      };
    });
  const otDays = days
    .filter((d) => (d.otHours ?? 0) > 0)
    .map((d) => ({ date: d.date as string, hours: Number(d.otHours) }));

  const workDays = days.filter((d) => (d.normalHours ?? 0) > 0).length;

  const hasSummary = Object.values(summary).some((v) => v !== null && v !== undefined);

  const notes: string[] = [];
  // เตือน "อ่านช่องสรุปไม่ได้" เฉพาะตอนที่ไม่ได้ค่ามาจริงเท่านั้น ไม่ใช่เตือนทุกครั้ง — แม่แบบรุ่นก่อน V4
  // ไม่มีช่องสรุปเลยจึงเตือนถูกเสมอ แต่ V4 มีช่องสรุป 13 ช่อง พออัปแม่แบบแล้วข้อความนี้จะกลายเป็นคำที่
  // ไม่จริงทันที (ดูเงื่อนไข hasSummary) — ยังคงกติกาเดิมไว้: ไม่เอายอดที่นับจากตารางไปใส่ summary.*
  // เพราะ summary.* แปลว่า "เลขที่เอกสารพิมพ์ไว้" ถ้าเอาเลขที่เรานับเองไปใส่ จะเทียบสองค่านี้ไม่ได้อีก
  if (!hasSummary) {
    notes.push(
      'ไม่ได้ค่าช่องสรุปท้ายเอกสารจาก Clear Read (แม่แบบอาจยังไม่มีฟิลด์ช่องสรุป — V4 มีให้แล้ว) — ' +
        'จำนวนวันทำงาน/วันลาด้านล่างนับจากตารางรายวันแทน ตรวจกับช่องสรุปในเอกสารต้นฉบับก่อนยืนยัน',
    );
  }
  if (!period) {
    notes.push('อ่านรอบเดือนจากเอกสารไม่ได้ (ช่อง Month_Year ว่างหรืออ่านไม่ออก) — ต้องเลือกรอบเดือนเอง');
  } else if (expectedPeriod && period !== expectedPeriod) {
    notes.push(`รอบเดือนที่อ่านได้ (${period}) ไม่ตรงกับที่คาดไว้ (${expectedPeriod}) — ตรวจสอบก่อนยืนยัน`);
  }
  if (days.length === 0) {
    notes.push('ไม่ได้ตารางรายวันจากเอกสารเลย — ต้องกรอกเพิ่มเอง');
  }
  // เจอจริงกับฟอร์ม Big-C บางแบบ (16 ก.ย. 69): อ่านตารางมาได้ 11 แถวแต่ไม่มีคอลัมน์ชั่วโมงเลยสักแถว
  // ทำให้นับวันทำงานได้ 0 ทั้งที่เอกสารไม่ได้ว่าง — เป็นตัวเลขผิดแบบเงียบๆ ที่ไหลไปถึงการตั้งบิลได้
  // ต้องเตือนให้เห็นชัด ไม่ใช่ปล่อยให้ 0 ผ่านไปเหมือนเป็นค่าที่อ่านมาได้จริง
  if (days.length > 0 && workDays === 0) {
    notes.push(
      `อ่านตารางรายวันมาได้ ${days.length} แถว แต่ไม่มีแถวไหนมีชั่วโมงทำงานปกติเลย จึงนับวันทำงานได้ 0 วัน — ` +
        'ฟอร์มนี้อาจไม่มีคอลัมน์ชั่วโมง หรืออ่านคอลัมน์ชั่วโมงไม่ออก ต้องตรวจกับเอกสารต้นฉบับและกรอกเองก่อนวางบิล',
    );
  }

  return {
    employeeName: header.employeeName ?? '',
    position: header.position ?? '',
    period,
    // ค่าที่ระบบใช้ตั้งบิล — นับจากตารางรายวันเสมอ **แม้จะอ่านช่องสรุปมาได้แล้วก็ตาม** จงใจไม่เอาเลขช่อง
    // สรุปมาแทน เพราะสองค่านี้มีไว้ให้เทียบกัน ถ้าเอาค่าเดียวกันมาใส่ทั้งสองที่ การเทียบก็ไร้ความหมาย
    totalWorkDays: workDays,
    totalLeaveDays: leaveDays.length,
    days,
    leaveDays,
    otDays,
    notes,
    vendorName: header.vendorName ?? null,
    clientName: header.clientName ?? null,
    projectName: header.projectName ?? null,
    employeeId: header.employeeId ?? null,
    role: header.role ?? null,
    department: header.department ?? null,
    monthYear: header.monthYear ?? null,
    reportingPeriod: header.reportingPeriod ?? null,
    supervisorName: header.supervisorName ?? null,
    approverName: header.approverName ?? null,
    site: header.site ?? null,
    projectTeam: header.projectTeam ?? null,
    // มีค่าก็ต่อเมื่อแม่แบบฝั่ง Clear Read มีช่องสรุปจริง (V4 เป็นต้นไป) — ไม่มีก็ปล่อย undefined ไม่ใช่
    // ใส่ 0 หรือใส่เลขที่นับเอง เพราะ "ไม่รู้" กับ "เอกสารบอกว่าศูนย์" คนละความหมายกันคนละผลลัพธ์
    summary: hasSummary ? summary : undefined,
  };
}
