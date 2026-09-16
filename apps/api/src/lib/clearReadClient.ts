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
  TIMESHEET_HEADER_FIELDS,
  classifyLeaveType,
  monthFromWord,
  normalizeDate,
  normalizeYear,
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

/** ชื่อฟิลด์ในเทมเพลต Clear Read ตรงกับ `name` ของสารบัญกลางทุกช่อง ยกเว้นช่องเดียว: ตารางรายวันของ
 * Clear Read เรียก "Customer_site" แต่สารบัญเรียก "Site" — เก็บข้อยกเว้นไว้ที่เดียวตรงนี้ */
const DETAIL_NAME_ALIASES: Record<string, string> = { Customer_site: 'Site' };

const HEADER_KEY_BY_NAME = new Map(TIMESHEET_HEADER_FIELDS.map((f) => [f.name, f.key]));
const DETAIL_KEY_BY_NAME = new Map(TIMESHEET_DETAIL_FIELDS.map((f) => [f.name, f.key]));

function detailKeyFor(columnName: string): string | undefined {
  return DETAIL_KEY_BY_NAME.get(DETAIL_NAME_ALIASES[columnName] ?? columnName);
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
  const m = String(monthYear).match(/([A-Za-z฀-๿]+|\d{1,2})[\s/._-]+(\d{2,4})/);
  if (!m) return null;
  const month = monthFromWord(m[1]) ?? (Number(m[1]) >= 1 && Number(m[1]) <= 12 ? Number(m[1]) : null);
  const year = normalizeYear(m[2]);
  if (!month || !year) return null;
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function mapClearReadResult(detail: any, { expectedPeriod }: { expectedPeriod?: string } = {}) {
  const fields: ClearReadField[] = Array.isArray(detail?.fields) ? detail.fields : [];

  const header: Record<string, string | null> = {};
  let rawRows: any[] = [];
  for (const f of fields) {
    if (f.key_field === TIMESHEET_DETAIL_LINE_ITEM) {
      rawRows = Array.isArray(f.value) ? f.value : [];
      continue;
    }
    const key = HEADER_KEY_BY_NAME.get(f.key_field);
    if (key) header[key] = f.value === null || f.value === undefined ? null : String(f.value);
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
    .filter((d) => d.leaveType)
    .map((d) => ({ date: d.date as string, type: classifyLeaveType(String(d.leaveType)), rawLabel: String(d.leaveType) }));
  const otDays = days
    .filter((d) => (d.otHours ?? 0) > 0)
    .map((d) => ({ date: d.date as string, hours: Number(d.otHours) }));

  const workDays = days.filter((d) => (d.normalHours ?? 0) > 0).length;

  const notes: string[] = [];
  // เทมเพลต Master Template ของ Clear Read ไม่มีช่องสรุปท้ายเอกสาร (Total_Work_Days/Total_Leave_Days/
  // Total_Hours) จึงเติม summary.* ไม่ได้เลย — จงใจปล่อยว่างไว้ ไม่เอายอดที่นับจากตารางมาใส่แทน เพราะ
  // summary.* แปลว่า "ตัวเลขที่เอกสารพิมพ์ไว้" ถ้าเอายอดที่เรานับเองไปใส่ จะเทียบสองค่านี้ไม่ได้อีกเลย
  notes.push(
    'Clear Read อ่านช่องสรุปท้ายเอกสารไม่ได้ (เทมเพลตยังไม่มีฟิลด์ Total_Work_Days/Total_Leave_Days/Total_Hours) — ' +
      'จำนวนวันทำงาน/วันลาด้านล่างนับจากตารางรายวันแทน ตรวจกับช่องสรุปในเอกสารต้นฉบับก่อนยืนยัน',
  );
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
    // ค่าที่ระบบใช้ตั้งบิล — Clear Read ไม่มีช่องสรุปให้เชื่อ จึงนับจากตารางรายวันเสมอ (ต่างจาก summary.*
    // ด้านล่างที่ต้องเป็นค่าที่เอกสารพิมพ์ไว้จริงเท่านั้น)
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
  };
}
