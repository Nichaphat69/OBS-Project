/**
 * ตัวเชื่อม ABBYY Vantage — ported from src/extract/abbyy.js. Logic (including every real-world
 * data quirk it works around — column-swapped tables, leaked OT times, duplicated description
 * text, etc.) preserved exactly; only rewritten to TypeScript + native fetch/FormData/Blob (all
 * already global in Node 22, matching the original's dependency-free approach).
 *
 * See the original file's header comment for the full verification history (real sandbox calls,
 * Swagger UI, ABBYY docs) — endpoint names and field names here are not guesses.
 */
import { classifyDayKind, classifyLeaveType, monthFromWord, normalizeDate, normalizeYear, type TimesheetFieldMap } from '@obs/domain';
import { loggedFetch } from './apiActivityLog.js';

const DEFAULT_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 1_500;
const POLL_TIMEOUT_MS = 120_000;

const STATUS = { NEW: 'New', PROCESSING: 'Processing', PROCESSED: 'Processed', FAILED: 'Failed', CANCELED: 'Canceled' };

export class AbbyyError extends Error {
  status: number | null;
  body: unknown;
  constructor(message: string, { status = null, body = null }: { status?: number | null; body?: unknown } = {}) {
    super(message);
    this.name = 'AbbyyError';
    this.status = status;
    this.body = body;
  }
}

export function hasAbbyyCredentials(): boolean {
  return Boolean(
    process.env.ABBYY_BASE_URL && process.env.ABBYY_CLIENT_ID && process.env.ABBYY_CLIENT_SECRET && process.env.ABBYY_SKILL_ID,
  );
}

const sleep = (ms: number) => new Promise((r) => { setTimeout(r, ms); });

export class AbbyyClient {
  baseUrl?: string;
  clientId?: string;
  clientSecret?: string;
  skillId?: string;
  private token: string | null = null;
  private tokenExpiresAt = 0;

  constructor({
    baseUrl = process.env.ABBYY_BASE_URL,
    clientId = process.env.ABBYY_CLIENT_ID,
    clientSecret = process.env.ABBYY_CLIENT_SECRET,
    skillId = process.env.ABBYY_SKILL_ID,
  }: { baseUrl?: string; clientId?: string; clientSecret?: string; skillId?: string } = {}) {
    this.baseUrl = baseUrl?.replace(/\/+$/, '');
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.skillId = skillId;
  }

  assertConfigured() {
    if (!this.baseUrl || !this.clientId || !this.clientSecret || !this.skillId) {
      throw new AbbyyError(
        'ยังไม่ได้เชื่อมต่อ ABBYY Vantage — ใส่ ABBYY_BASE_URL/ABBYY_CLIENT_ID/ABBYY_CLIENT_SECRET/ABBYY_SKILL_ID ใน .env',
        { status: 400 },
      );
    }
  }

  async getAccessToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiresAt) return this.token;

    this.assertConfigured();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/auth2/connect/token`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: this.clientId!,
          client_secret: this.clientSecret!,
          grant_type: 'client_credentials',
          scope: 'openid permissions global.wildcard',
        }),
      });
    } catch (error: any) {
      throw new AbbyyError(`เชื่อมต่อ ABBYY ไม่สำเร็จ (${error.message})`, { status: null });
    } finally {
      clearTimeout(timeout);
    }

    const text = await res.text();
    const parsed: any = safeJson(text);
    if (!res.ok) {
      throw new AbbyyError(`ขอ access token จาก ABBYY ไม่สำเร็จ (${res.status})`, { status: res.status, body: parsed });
    }
    if (!parsed?.access_token) {
      throw new AbbyyError('ABBYY ตอบกลับมาโดยไม่มี access_token — ตรวจ ABBYY_CLIENT_ID/ABBYY_CLIENT_SECRET', { status: 401 });
    }

    this.token = parsed.access_token;
    this.tokenExpiresAt = Date.now() + (Math.max(parsed.expires_in ?? 3600, 120) - 60) * 1000;
    return this.token as string;
  }

  async authedFetch(path: string, options: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
    const token = await this.getAccessToken();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      return await loggedFetch('abbyy', `${this.baseUrl}${path}`, {
        ...options,
        signal: controller.signal,
        headers: { ...options.headers, Authorization: `Bearer ${token}` },
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  async launchTransaction(fileBuffer: Buffer, fileName: string): Promise<string> {
    this.assertConfigured();
    const form = new FormData();
    form.append('Files', new Blob([new Uint8Array(fileBuffer)], { type: 'application/pdf' }), fileName);

    const res = await this.authedFetch(`/api/publicapi/v1/transactions/launch?skillId=${encodeURIComponent(this.skillId!)}`, {
      method: 'POST',
      body: form,
    });
    const text = await res.text();
    const parsed: any = safeJson(text);
    if (!res.ok) {
      throw new AbbyyError(`ส่งไฟล์เข้า ABBYY Skill ไม่สำเร็จ (${res.status})`, { status: res.status, body: parsed });
    }
    if (!parsed?.transactionId) {
      throw new AbbyyError('ABBYY ตอบกลับมาโดยไม่มี transactionId', { status: 502, body: parsed });
    }
    return parsed.transactionId;
  }

  async getTransaction(transactionId: string): Promise<any> {
    const res = await this.authedFetch(`/api/publicapi/v1/transactions/${transactionId}`, { method: 'GET' });
    const text = await res.text();
    const parsed = safeJson(text);
    if (!res.ok) {
      throw new AbbyyError(`ดึงสถานะ transaction ไม่สำเร็จ (${res.status})`, { status: res.status, body: parsed });
    }
    return parsed;
  }

  async downloadResultFile(transactionId: string, fileId: string): Promise<any> {
    const res = await this.authedFetch(`/api/publicapi/v1/transactions/${transactionId}/files/${fileId}/download`, { method: 'GET' });
    if (!res.ok) {
      throw new AbbyyError(`โหลดไฟล์ผลลัพธ์จาก ABBYY ไม่สำเร็จ (${res.status})`, { status: res.status });
    }
    const text = await res.text();
    return safeJson(text) ?? text;
  }

  async extractDocument(fileBuffer: Buffer, fileName: string): Promise<{ transactionId: string; manualReviewLink: string | null; rawResult: any }> {
    const transactionId = await this.launchTransaction(fileBuffer, fileName);

    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let transaction: any;
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

    const resultFile =
      transaction.documents?.[0]?.resultFiles?.find((f: any) => f.type === 'Json') ?? transaction.documents?.[0]?.resultFiles?.[0];
    if (!resultFile) {
      throw new AbbyyError('ประมวลผลเสร็จแต่ไม่พบไฟล์ผลลัพธ์ใน transaction', { body: transaction });
    }

    const rawResult = await this.downloadResultFile(transactionId, resultFile.fileId);
    return { transactionId, manualReviewLink: transaction.manualReviewLink ?? null, rawResult };
  }
}

const EN_MONTH: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

function parsePeriodFromYearField(value: unknown): string | null {
  const text = String(value ?? '').trim();
  if (!text) return null;

  // ทางเดิม: ชื่อเดือนอังกฤษเต็ม + ปี 4 หลัก ("May 2026") — ต่างจากเดิมตรงที่ปีต้องผ่าน normalizeYear
  // ด้วย ไม่งั้นเอกสารที่พิมพ์ปี พ.ศ. ("May 2569") จะได้รอบเดือน "2569-05" ที่ไม่มีอยู่จริงแบบเงียบๆ
  // (ไม่ error ไม่ขึ้นโน้ต) แล้วไหลต่อไปถึงรอบวางบิล — แย่กว่าอ่านไม่ออกไปเลย
  const strict = text.match(/([A-Za-z]+)\s+(\d{4})/);
  if (strict) {
    const month = EN_MONTH[strict[1].toLowerCase()];
    const year = normalizeYear(strict[2]);
    if (month && year) return `${year}-${String(month).padStart(2, '0')}`;
  }

  // ทางสำรอง: ชื่อเดือนย่อ ("Jan 2026") เดือนภาษาไทย หรือเดือนเป็นตัวเลข ("8 2026", "08/2026" — สอง
  // แบบหลังเป็นตัวอย่างในสารบัญกลางเอง) EN_MONTH ด้านบนรับแค่ชื่อเต็มภาษาอังกฤษแบบเดียว จึงใช้
  // monthFromWord/normalizeYear ตัวเดียวกับที่ทาง month+year แยกฟิลด์ใช้อยู่แล้ว ซึ่งทนทานกว่ามาก
  const loose = text.match(/^(.+?)[\s/,-]+(\d{2,4})$/);
  if (loose) {
    const numeric = /^\d{1,2}$/.test(loose[1]) ? Number(loose[1]) : null;
    const month = (numeric !== null && numeric >= 1 && numeric <= 12 ? numeric : null) ?? monthFromWord(loose[1]);
    const year = normalizeYear(loose[2]);
    if (month && year) return `${year}-${String(month).padStart(2, '0')}`;
  }
  return null;
}

function daysInMonth(period: string | null): number | null {
  const m = String(period ?? '').match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]), 0).getDate();
}

function fieldMap(rootObject: any): Record<string, any> {
  const map: Record<string, any> = {};
  for (const field of rootObject?.Fields ?? []) {
    const value = field.List?.[0]?.Value;
    if (value != null && value !== '') map[field.Name] = value;
  }
  return map;
}

function splitLines(value: unknown): string[] {
  if (!value) return [];
  return String(value).split('\n').map((s) => s.trim());
}

function buildDayRowsFromFlatFields(fields: Record<string, any>, period: string | null) {
  const totalDays = daysInMonth(period);
  if (!totalDays) return [];

  const workHourPerDay = splitLines(fields['Work Hour per Day']);
  if (workHourPerDay.length !== totalDays) return [];

  const workdayPositions: number[] = [];
  workHourPerDay.forEach((v, i) => { if (Number(v) > 0) workdayPositions.push(i); });

  const timeIn = splitLines(fields['Time In']);
  const timeOut = splitLines(fields['Time Out']);
  if (timeIn.length !== workdayPositions.length || timeOut.length !== workdayPositions.length) return [];

  return workdayPositions.map((dayIndex, i) => ({
    date: `${period}-${String(dayIndex + 1).padStart(2, '0')}`,
    timeIn: timeIn[i] || null,
    timeOut: timeOut[i] || null,
    label: null as string | null,
    type: null as string | null,
    remark: null as string | null,
    jobDescription: null as string | null,
  }));
}

function hasStructuredTable(rootObject: any, tableName: string | null): boolean {
  const table = findTable(rootObject, tableName);
  return Array.isArray(table?.List) && table.List.length > 0 && table.List[0]?.Value?.Fields;
}

/** ป้องกัน OCR อ่านปีในตารางรายวันผิดเพี้ยน (เจอจริง Skill Big-C: "26/01/1900" ที่ควรเป็น 2026 — ต้นตอ
 * อยู่ที่หน้า ABBYY Vantage เอง ไม่ใช่โค้ดนี้ แต่ถ้าไม่กรองทิ้ง วันที่เพี้ยนนี้จะหลุดเข้าไปเป็นทั้งแถว
 * ในตาราง/วันลา แล้วไปพลาดจับคู่กับปฏิทินของรอบเดือนจริง ทำให้วันลาที่ควรนับเป็น "ลา" กลับถูกนับเป็น
 * "ทำงาน" แทนในแท็บปฏิทิน ต้นเหตุหนึ่งของตัวเลขไม่ตรงกันระหว่างแท็บ 15 ก.ย. 69) ถ้ารู้ปีของรอบเอกสาร
 * (expectedYear จาก period ที่ resolve ไว้แล้ว) ปีในแถวต้องห่างไม่เกิน 1 ปี (กันวันข้ามปีที่ขอบเดือน
 * ธ.ค./ม.ค.) ถ้ายังไม่รู้ period เลยใช้เพดานกว้างๆแทน (2015-2100) กันปีเพี้ยนสุดขั้วอย่างน้อยที่สุด */
function parseTableRowDate(cols: Record<string, any>, expectedYear?: number | null): string | null {
  for (const value of Object.values(cols)) {
    const m = String(value ?? '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (!m) continue;
    const day = Number(m[1]);
    const month = Number(m[2]);
    const year = Number(m[3]) < 100 ? Number(m[3]) + 2000 : Number(m[3]);
    if (day < 1 || day > 31 || month < 1 || month > 12) continue;
    if (expectedYear != null ? Math.abs(year - expectedYear) > 1 : year < 2015 || year > 2100) continue;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  return null;
}

const EXACT_LEAVE_WORDS = new Set([
  'leave', 'vacation', 'sick', 'personal', 'annual', 'absent',
  'vacation leave', 'sick leave', 'personal leave', 'annual leave',
  'ลา', 'ลาป่วย', 'ลากิจ', 'ลาพักร้อน',
]);

function hasExactLeaveWord(cols: Record<string, any>): boolean {
  return Object.values(cols).some((v) => EXACT_LEAVE_WORDS.has(String(v ?? '').trim().toLowerCase()));
}

function parseTimeToMinutes(value: unknown): number | null {
  const m = String(value ?? '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function extractLeadingTimeFromDescription(description: unknown): { time: string; rest: string | null } | null {
  const m = String(description ?? '').match(/^(\d{1,2}:\d{2})\s+(.*)$/s);
  if (!m || parseTimeToMinutes(m[1]) === null) return null;
  return { time: m[1], rest: m[2].trim() || null };
}

function stripLeadingDuplicateType(text: string | null, type: unknown): string | null {
  if (!text || !type) return text;
  const escaped = String(type).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`^${escaped}\\s+`, 'i'), '').trim() || null;
}

function extractRowTimes(cols: Record<string, any>) {
  const times = Object.values(cols)
    .map((v) => ({ raw: v, minutes: parseTimeToMinutes(v) }))
    .filter((t): t is { raw: any; minutes: number } => t.minutes !== null)
    .sort((a, b) => a.minutes - b.minutes);

  if (times.length === 2) {
    return { timeIn: times[0].raw, timeOut: times[1].raw, otTimeIn: null, otTimeOut: null, recovered: false, descriptionOverride: null as string | null };
  }
  if (times.length === 4) {
    return { timeIn: times[0].raw, timeOut: times[1].raw, otTimeIn: times[2].raw, otTimeOut: times[3].raw, recovered: false, descriptionOverride: null as string | null };
  }
  if (times.length === 3) {
    const leaked = extractLeadingTimeFromDescription(cols['Description']);
    if (leaked) {
      const merged = [...times, { raw: leaked.time, minutes: parseTimeToMinutes(leaked.time)! }].sort((a, b) => a.minutes - b.minutes);
      return {
        timeIn: merged[0].raw, timeOut: merged[1].raw, otTimeIn: merged[2].raw, otTimeOut: merged[3].raw,
        recovered: true, descriptionOverride: stripLeadingDuplicateType(leaked.rest, cols['Type']),
      };
    }
  }
  return { timeIn: null, timeOut: null, otTimeIn: null, otTimeOut: null, recovered: false, descriptionOverride: null as string | null };
}

function hoursBetween(startRaw: unknown, endRaw: unknown): number | null {
  const start = parseTimeToMinutes(startRaw);
  const end = parseTimeToMinutes(endRaw);
  if (start === null || end === null) return null;
  const diffMin = end >= start ? end - start : end + 24 * 60 - start;
  return Math.round((diffMin / 60) * 100) / 100;
}

function parsedOrNull(raw: unknown): number | null {
  if (raw === null || raw === undefined || String(raw).trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function dedupeRepeatedText(text: unknown): string | null {
  const s = String(text ?? '').trim();
  if (!s) return text as null;
  const words = s.split(/\s+/);
  if (words.length < 2 || words.length % 2 !== 0) return s;
  const half = words.length / 2;
  const first = words.slice(0, half).join(' ');
  const second = words.slice(half).join(' ');
  return first.toLowerCase() === second.toLowerCase() ? first : s;
}

/** ป้ายชื่อ (label) ในเอกสารต้นฉบับที่อยู่ติดกับช่องกรอกจริง — ถ้ากรอบฟิลด์ของ Skill ใน ABBYY กินพื้นที่
 * เผื่อไปโดนป้ายด้วย OCR จะอ่านติดป้ายมาก่อนค่าจริงเสมอ (เจอจริง 17 ก.ย. 69: field "Employee Name"
 * อ่านได้ "-สกุล : Pitikorn Chumphuchanapai" — หลุดมาจากป้าย "ชื่อ-สกุล :" ที่อยู่ก่อนช่องกรอก)
 *
 * แก้ที่ต้นตอ (ปรับกรอบฟิลด์ใน ABBYY Vantage) ตรงกว่า แต่ต้องเข้า UI ของ ABBYY ไปแก้ทีละ Skill และ
 * ไม่ครอบคลุมเอกสารที่เทรนไว้แล้ว ตัดป้ายที่รู้จักไว้ที่นี่ครอบคลุมทันทีทั้งฟิลด์ชื่อ/ตำแหน่งของทุก Skill
 * โดยไม่ต้องรอ — เผื่อพลาดไว้แค่ pattern ไม่ตัดคำแรกของชื่อจริงถ้าไม่ตรงป้ายที่รู้จักเป๊ะ */
const LABEL_PREFIX_RE = /^[-\s]*(?:ชื่อ[-\s]*สกุล|ชื่อ[-\s]*นามสกุล|นามสกุล|สกุล|ชื่อ|ตำแหน่ง|position|surname|name)\s*[:.\-]+\s*/i;

function stripLabelPrefix(text: unknown): string | null {
  const s = String(text ?? '').trim();
  if (!s) return text as null;
  const stripped = s.replace(LABEL_PREFIX_RE, '').trim();
  return stripped || s;
}

const DOW_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function dayOfWeekFromDate(dateStr: string): string | null {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : DOW_EN[d.getUTCDay()];
}

function minusBreak(hours: number | null, brk: number | null): number | null {
  return hours === null ? null : Math.max(0, Math.round((hours - (brk ?? 0)) * 100) / 100);
}

/** เวลาเดี่ยวหรือช่วงเวลา เผื่อมีขีด/ช่องว่างติดหัวท้ายจากการตัดคอลัมน์ ("17:00", "- 17:00", "08.00-17.00") */
const TIME_CELL_RE = /^[\s\-–—]*\d{1,2}[.:]\d{2}\s*(?:[-–—]|ถึง|to)?\s*(?:\d{1,2}[.:]\d{2})?[\s\-–—]*$/i;

/**
 * ช่องนี้เป็นวันที่หรือเวลาหรือเปล่า — ใช้คัดช่องที่ "ไม่ใช่ป้ายกำกับ" ออกก่อนจะเอาช่องที่เหลือมาต่อกันเป็น
 * `label` (ซึ่งเป็นค่าสำรองของคอลัมน์ "ประเภท" เมื่อ Skill ไม่ได้ระบุคอลัมน์ประเภทไว้)
 *
 * เดิมรู้จักวันที่แค่รูป DD/MM/YY ตัวเลขล้วนเท่านั้น ฟอร์มที่เขียนวันที่เป็นชื่อเดือน ("1-Mar-26" แบบ
 * ThaiLife) จึงรอดตัวกรองมาได้ แล้วไปโผล่เป็นค่าของคอลัมน์ "ประเภท" ทั้งตาราง — หน้าตรวจ Manday
 * แสดง "1-Mar-26" / "2-Mar-26 3-Mar-26" ในช่องที่ควรเป็น Weekend/Holiday/Working
 * (เจอจริง 18 ก.ย. 69 กับ OBS202621) ใช้ normalizeDate() ตัวเดียวกับที่ resolveRowDate() ใช้
 * จะได้รู้จักทุกรูปแบบวันที่ที่ระบบรองรับอยู่แล้ว ไม่ต้องไล่เพิ่ม regex ทีละแบบอีก
 */
function isDateOrTimeCell(value: unknown): boolean {
  const s = String(value ?? '').trim();
  if (!s) return false;
  if (parseTimeToMinutes(s) !== null || TIME_CELL_RE.test(s)) return true;
  return normalizeDate(s) !== null;
}

/**
 * ชั่วโมง OT ของแถวหนึ่ง — ใช้ร่วมกันระหว่าง `buildDayRowsFromStructuredTable()` (หน้าตรวจ Manday) และ
 * `extractOtHoursFromTable()` (รายการที่ใบแจ้งหนี้ใช้คิดเงิน) เพราะชั่วโมง OT คูณเป็นเงินตรงๆ
 * (ชั่วโมง ÷ 8 × เรทต่อวัน) ต่างจากชั่วโมงทำงานปกติที่ไม่เข้าสูตรคิดเงิน — สองจุดนี้เคยแยกลอจิกกัน:
 * ที่นี่คำนวณจากเวลาเข้า-ออก OT ได้เมื่อไม่มีคอลัมน์ชั่วโมง แต่ `extractOtHoursFromTable` เดิมอ่านจาก
 * คอลัมน์ชั่วโมงอย่างเดียว ผลคือหน้าจอตรวจ Manday โชว์ OT แต่ใบแจ้งหนี้ไม่คิดเงินให้เลย (เจอจริงกับ
 * ฟอร์ม _T8 Chakrit ที่มี OT_In/OT_Out แต่ไม่มีคอลัมน์ OT_Hours — 17 ก.ย. 69) ดึงมาเป็นฟังก์ชันเดียว
 * ตรงนี้เพื่อกันไม่ให้สองจุดคิดเลขไม่ตรงกันอีกในอนาคต — ห้ามคัดลอกลอจิกนี้ไปเขียนซ้ำที่อื่น
 *
 * ลำดับ: คอลัมน์ชั่วโมงที่เอกสารเขียนไว้ตรงๆ ชนะเสมอ ไม่มีค่อยคำนวณจากเวลาเข้า-ออก OT หักด้วยเวลาพัก
 * OT ที่เอกสารเขียนไว้ (ถ้ามี) — ยังคำนวณต่อแม้เอกสารไม่ได้เขียนเวลาพัก OT ไว้ (ผู้ใช้ยืนยันแล้ว
 * 17 ก.ย. 69: "ก็คิดตามชม.ที่ทำ OT มันจะมี Total สรุปอยู่" — มีช่องสรุปทั้งงวดให้ไขว้เช็คได้ ดู
 * cross-check ท้าย mapAbbyyResult ถ้าตัวเลขเบี่ยงเกินเกณฑ์)
 */
function resolveOtHoursForRow(cols: Record<string, any>, detail: Record<string, string | null | undefined>): number | null {
  const direct = parsedOrNull(pick(cols, detail.otHours));
  if (direct !== null) return direct;

  const mappedTimes = detail.timeIn !== undefined && detail.timeOut !== undefined;
  const { otTimeIn, otTimeOut } = mappedTimes ? mappedRowTimes(cols, detail) : extractRowTimes(cols);
  const otBreakHours = parsedOrNull(pick(cols, detail.otBreakHours));
  return minusBreak(hoursBetween(otTimeIn, otTimeOut), otBreakHours);
}

function buildDayRowsFromStructuredTable(rootObject: any, tableName: string | null, expectedYear?: number | null, detail: Record<string, string | null | undefined> = DEFAULT_DETAIL_MAP) {
  const table = findTable(rootObject, tableName);
  if (!Array.isArray(table?.List)) return [];

  const days: any[] = [];
  for (const row of table.List) {
    const cols: Record<string, any> = {};
    for (const f of row.Value?.Fields ?? []) cols[f.Name] = f.List?.[0]?.Value ?? null;

    const date = resolveRowDate(cols, detail, expectedYear);
    if (!date) continue;

    // คอลัมน์เวลาที่ตั้งค่าไว้ชัดเจนเชื่อถือได้กว่าการเดาเสมอ — ใช้ตรงๆ แล้วข้ามการเรียงเวลาไปเลย
    // (นี่คือจุดที่แก้ปัญหาคอลัมน์สลับตำแหน่งได้จริง) ตั้งไม่ครบ/ไม่ได้ตั้ง = เดาแบบเดิมทั้งแถว
    const mappedTimes = detail.timeIn !== undefined && detail.timeOut !== undefined;
    const { timeIn, timeOut, otTimeIn, otTimeOut, recovered, descriptionOverride } = mappedTimes
      ? mappedRowTimes(cols, detail)
      : extractRowTimes(cols);

    const descriptionCol = detail.jobDescription;
    const rawDescription = recovered ? descriptionOverride : pick(cols, descriptionCol);
    const jobDescription = rawDescription ? dedupeRepeatedText(rawDescription) : null;

    const labelParts = Object.entries(cols)
      .filter(([name, value]) => name !== descriptionCol && !isDateOrTimeCell(value))
      .map(([, value]) => value)
      .filter(Boolean);
    const label = labelParts.length ? dedupeRepeatedText(labelParts.join(' ')) : null;

    const project = pick(cols, detail.project);
    const rawType = pick(cols, detail.workType);
    /**
     * ไม่มีคอลัมน์ "ประเภท" ที่ตั้งค่าไว้ = ไม่รู้ว่าวันนั้นเป็นประเภทอะไร ต้องเป็น null ไปตรงๆ
     *
     * เดิมตกไปใช้ `label` ซึ่งคือ "ทุกคอลัมน์ที่เหลือในแถวต่อกันเป็นข้อความเดียว" — เป็นค่าสำรองที่เดา
     * จากของที่ไม่รู้ว่าคืออะไร ผลคือช่องประเภทของฟอร์มที่ไม่ได้ map คอลัมน์นี้ไว้ (ThaiLife, Lotus)
     * กลายเป็นขยะทั้งตาราง เช่น "1-Jul-26 grooming - 08.30 and" — ปนทั้งวันที่ เวลา และเศษคำอธิบายงาน
     * (เจ้าของระบบเจอจริงทั้งสองฟอร์ม 18 ก.ย. 69)
     *
     * "—" บอกความจริงว่าไม่รู้ ส่วนข้อความมั่วๆ ดูเหมือนระบบอ่านได้แล้วซึ่งแย่กว่า และ `label` ยังถูก
     * เก็บลงคอลัมน์ของตัวเองตามเดิม ไม่มีข้อมูลไหนหายไป — แค่เลิกเอามาสวมเป็น "ประเภท"
     */
    const type = rawType ? dedupeRepeatedText(rawType) : null;

    const breakHours = parsedOrNull(pick(cols, detail.breakHours));
    const otBreakHours = parsedOrNull(pick(cols, detail.otBreakHours));

    // หักเวลาพักที่ "เอกสารเขียนไว้เอง" ออกจากชั่วโมงที่คำนวณจากเวลาเข้า-ออก — เดิมอ่านช่องพักมาเก็บไว้
    // เฉยๆ แต่ไม่เคยเอามาใช้ตอนคำนวณเลย ทั้งที่ค่าอยู่ในมือแล้ว ฟอร์มที่เขียนเวลาเข้า-ออกห่างกัน 9 ชม.
    // แล้วระบุพัก 1 ชม. จะถูกนับเป็น 9 ชม. เกินจริงไปเต็มๆ 1 ชม.ทุกแถว — นี่ยัง **ไม่ใช่** การเลิก
    // คำนวณเอง เอกสารที่ไม่ได้เขียนเวลาพักไว้ก็ยังถูกคำนวณแบบเดิมและยังอาจเกินจริงอยู่ (ผู้ใช้ยืนยันแล้ว
    // 17 ก.ย. 69 ว่าให้คำนวณต่อไป มีช่องสรุปทั้งงวดให้ไขว้เช็คได้ — ดู cross-check ท้าย mapAbbyyResult)
    const computedNormal = minusBreak(hoursBetween(timeIn, timeOut), breakHours);
    const normalHours = parsedOrNull(pick(cols, detail.normalHours)) ?? computedNormal;
    // ชั่วโมง OT ใช้ resolveOtHoursForRow() ตัวเดียวกับที่ extractOtHoursFromTable() (ใบแจ้งหนี้) เรียก —
    // เดิมสองจุดนี้แยกกันคนละลอจิก (ที่นี่คำนวณจากเวลาเข้า-ออกได้ แต่ extractOtHoursFromTable อ่านจาก
    // คอลัมน์ชั่วโมงอย่างเดียว) หน้าจอตรวจ Manday จึงโชว์ OT แต่ใบแจ้งหนี้ไม่คิดเงินให้เลย ตัวเลขไม่ตรงกัน
    // ระหว่างสองจุดที่ควรเป็นค่าเดียวกัน
    const otHours = resolveOtHoursForRow(cols, detail);
    const totalHours = parsedOrNull(pick(cols, detail.dailyTotalHours)) ?? (normalHours !== null || otHours !== null ? Math.round(((normalHours ?? 0) + (otHours ?? 0)) * 100) / 100 : null);

    days.push({
      date, dayOfWeek: pick(cols, detail.day) ?? dayOfWeekFromDate(date), project,
      timeIn, timeOut, otTimeIn, otTimeOut,
      label, type, remark: pick(cols, detail.remarks), jobDescription,
      normalHours, otHours, totalHours,
      // ฟิลด์ตามสารบัญกลางที่เพิ่มเข้ามา — Skill ไหนไม่ได้ตั้ง mapping ไว้ก็เป็น null เฉยๆ ไม่กระทบของเดิม
      rowNumber: pick(cols, detail.rowNumber),
      site: pick(cols, detail.dailySite),
      workLocation: pick(cols, detail.workLocation),
      breakHours,
      otBreakHours,
      additionalHours: parsedOrNull(pick(cols, detail.additionalHours)),
      activity: pick(cols, detail.activity),
      leaveType: pick(cols, detail.leaveType),
      leaveDays: parsedOrNull(pick(cols, detail.leaveDays)),
    });
  }
  return days;
}

/** เวลาเข้า-ออกจากคอลัมน์ที่ map ไว้ — ส่วน OT ถ้ายังไม่ได้ map ต้องไม่ทิ้งไปเฉยๆ แต่ให้ไปเดาจาก
 * "คอลัมน์ที่เหลือ" (หักคอลัมน์เข้า-ออกที่รู้แล้วออกก่อน) เพราะคนตั้งค่ามักตั้งแค่เวลาเข้า-ออกซึ่งเป็น
 * คู่ที่เห็นชัดที่สุดก่อน ถ้าการตั้งค่านั้นทำให้ชั่วโมง OT ที่เคยตรวจเจอหายไปเงียบๆ จะกลายเป็นค่าจ้าง
 * ที่หายไปจากบิลโดยไม่มีอะไรเตือน — ตั้งค่าแล้วต้องไม่แย่ลงกว่าไม่ตั้ง */
/** ฟอร์มบางเจ้า (เช่น Lotus) เก็บเวลาเข้า-ออกรวมไว้ช่องเดียวเป็นช่วง "08.00 - 17.00" — ถ้าช่องที่ map ไว้
 * เป็นช่วงแบบนั้นและยังไม่มีเวลาออกจากที่อื่น ให้แยกเป็นสองค่า ตั้งค่าได้โดยใส่ชื่อคอลัมน์เดียวกันทั้งช่อง
 * "เวลาเข้า" และ "เวลาออก" (หรือใส่แค่ช่องเวลาเข้าช่องเดียวก็ได้)
 *
 * จงใจ**ไม่**แปลงรูปแบบเวลา ("08.00" ไม่ถูกเปลี่ยนเป็น "08:00") — สารบัญกลางกำหนดให้เก็บตามรูปเดิมของ
 * เอกสาร การแปลงเป็นหน้าที่ของชั้น normalize ทีหลัง ไม่ใช่ของตัวอ่าน */
const TIME_RANGE_RE = /^\s*(\d{1,2}[.:]\d{2})\s*(?:-|–|—|ถึง|to)\s*(\d{1,2}[.:]\d{2})\s*$/i;

function splitTimeRange(start: any, end: any): { start: any; end: any } {
  // ใส่ชื่อคอลัมน์เดียวกันทั้งสองช่อง = ได้ค่าช่วงเต็มมาทั้งคู่ ต้องถือว่ายังไม่มีเวลาออกจริง ไม่งั้นจะ
  // ตัดสินว่า "มีเวลาออกแล้ว" แล้วไม่ยอมแยก (เทสต์จับเคสนี้ไว้)
  const hasSeparateEnd = end && String(end) !== String(start);
  if (hasSeparateEnd) return { start, end };
  const m = TIME_RANGE_RE.exec(String(start ?? ''));
  if (!m) return { start, end };
  return { start: m[1], end: m[2] };
}

function mappedRowTimes(cols: Record<string, any>, detail: Record<string, string | null | undefined>) {
  const regular = splitTimeRange(pick(cols, detail.timeIn), pick(cols, detail.timeOut));
  const base = {
    timeIn: regular.start,
    timeOut: regular.end,
    recovered: false,
    descriptionOverride: null as string | null,
  };
  if (detail.otTimeIn !== undefined || detail.otTimeOut !== undefined) {
    const ot = splitTimeRange(pick(cols, detail.otTimeIn), pick(cols, detail.otTimeOut));
    return { ...base, otTimeIn: ot.start, otTimeOut: ot.end };
  }

  // ไม่รู้คอลัมน์เข้า-ออกจริงสักช่อง (ตั้ง null ทั้งคู่ = Skill นี้ไม่มีคอลัมน์เวลาเลย) ก็ไม่มีอะไรให้หัก
  // ออก การเดาต่อจะกลายเป็นจับเวลาปกติมาเป็น OT — ปล่อยว่างปลอดภัยกว่า
  const known = [detail.timeIn, detail.timeOut].filter((c): c is string => typeof c === 'string');
  if (known.length === 0) return { ...base, otTimeIn: null, otTimeOut: null };

  const rest: Record<string, any> = { ...cols };
  for (const column of known) delete rest[column];
  const leftover = extractRowTimes(rest);
  return { ...base, otTimeIn: leftover.timeIn, otTimeOut: leftover.timeOut };
}

function findTable(rootObject: any, tableName: string | null) {
  if (!tableName) return null;
  return rootObject?.Fields?.find((f: any) => f.Name === tableName) ?? null;
}

/** คอลัมน์วันที่ที่ตั้งค่าไว้ชัดเจนมาก่อน — ไม่ได้ตั้งค่อยไล่เดาจากรูปแบบ DD/MM/YY ทุกคอลัมน์แบบเดิม */
function resolveRowDate(cols: Record<string, any>, detail: Record<string, string | null | undefined>, expectedYear?: number | null): string | null {
  if (detail.date !== undefined) {
    const mapped = pick(cols, detail.date);
    if (mapped) {
      const parsed = parseTableRowDate({ mapped }, expectedYear);
      if (parsed) return parsed;
      /* รู้แน่ว่าคอลัมน์ไหนคือวันที่แล้ว จึงใช้ตัวแปลงกลางได้เต็มที่ — มันรับได้ทั้งชื่อเดือนอังกฤษ/ไทย
         และปี พ.ศ. ต่างจาก parseTableRowDate() ที่รับแค่ DD/MM/YY ตัวเลขล้วน
         เจอจริงกับฟอร์ม CP Axtra ที่เขียนวันที่เป็น "1 Jul 26" — แถวถูกทิ้งไป 14 จาก 16 แถว
         ผลคืออ่านได้ 0 วันทำงานทั้งใบ
         ⚠️ ใช้เฉพาะตอนที่ผู้ใช้ตั้ง mapping ไว้แล้วเท่านั้น ถ้าไม่รู้ว่าคอลัมน์ไหนคือวันที่ ยังต้องใช้
         regex เข้มเหมือนเดิม ไม่งั้นค่าอย่าง "8.00" ในคอลัมน์อื่นอาจถูกตีความเป็นวันที่ */
      const normalized = normalizeDate(String(mapped), expectedYear != null ? String(expectedYear) : undefined);
      if (normalized) return normalized;
    }
  }
  return parseTableRowDate(cols, expectedYear);
}

function extractLeaveDaysFromTable(rootObject: any, tableName: string | null, expectedYear?: number | null, detail: Record<string, string | null | undefined> = DEFAULT_DETAIL_MAP) {
  const table = findTable(rootObject, tableName);
  if (!Array.isArray(table?.List)) return [];

  const descriptionCol = detail.jobDescription;
  const leaveDays: Array<{ date: string; type: string; rawLabel: string }> = [];
  for (const row of table.List) {
    const cols: Record<string, any> = {};
    for (const f of row.Value?.Fields ?? []) cols[f.Name] = f.List?.[0]?.Value ?? null;

    const date = resolveRowDate(cols, detail, expectedYear);
    if (!date) continue;

    // คอลัมน์ประเภทการลาที่ตั้งค่าไว้ = "ให้ดูช่องนี้" ไม่ใช่ "ช่องนี้มีค่าแปลว่าลา" — ตัวจำแนกยังเป็น
    // classifyDayKind ตัวเดิมทุกประการ ฟอร์มที่พิมพ์ "-"/"N/A" ในวันทำงานปกติจึงไม่ถูกนับเป็นวันลา
    const mappedLeaveValue = typeof detail.leaveType === 'string' ? pick(cols, detail.leaveType) : null;
    const mappedSaysLeave = mappedLeaveValue !== null
      && (classifyDayKind(mappedLeaveValue) === 'leave' || hasExactLeaveWord({ value: mappedLeaveValue }));

    // จงใจไม่สแกนคอลัมน์รายละเอียดงาน — คำว่า "ลา" ที่แทรกกลางประโยคงานไม่ใช่วันลา (มีเทสต์คุมไว้)
    const labelsNoDescription = Object.entries(cols).filter(([name]) => name !== descriptionCol).map(([, value]) => value);
    // ตั้งค่าคอลัมน์ไว้แล้วก็ยังสแกนคอลัมน์อื่นต่อ — ฟอร์มที่เขียนคำลาไว้สองที่ต้องไม่หายไปหนึ่งที่
    // เพียงเพราะแอดมินระบุชื่ออีกที่หนึ่ง (บทเรียนเดียวกับตอนที่ map เวลาเข้า-ออกแล้วทำ OT หาย)
    const isLeave = mappedSaysLeave || classifyDayKind(...labelsNoDescription) === 'leave' || hasExactLeaveWord(cols);
    if (!isLeave) continue;

    const rawLabel = [...labelsNoDescription, pick(cols, descriptionCol)].filter(Boolean).join(' ');
    // ถ้าคอลัมน์ที่ตั้งไว้เป็นตัวชี้ ใช้ค่าจากช่องนั้นจำแนกประเภท แม่นกว่าเอาทั้งแถวมาต่อกันแล้วเดา
    const type = mappedSaysLeave ? classifyLeaveType(String(mappedLeaveValue)) : classifyLeaveType(rawLabel);
    leaveDays.push({ date, type, rawLabel });
  }
  return leaveDays;
}

function extractOtHoursFromTable(rootObject: any, tableName: string | null, expectedYear?: number | null, detail: Record<string, string | null | undefined> = DEFAULT_DETAIL_MAP) {
  const table = findTable(rootObject, tableName);
  if (!Array.isArray(table?.List)) return [];

  const otDays: Array<{ date: string; hours: number }> = [];
  for (const row of table.List) {
    const cols: Record<string, any> = {};
    for (const f of row.Value?.Fields ?? []) cols[f.Name] = f.List?.[0]?.Value ?? null;

    const date = resolveRowDate(cols, detail, expectedYear);
    if (!date) continue;

    // ใช้ resolveOtHoursForRow() ตัวเดียวกับหน้าตรวจ Manday แทนการอ่านคอลัมน์ชั่วโมงตรงๆ อย่างเดียว —
    // เดิมฟอร์มที่มีแต่เวลาเข้า-ออก OT (ไม่มีคอลัมน์ชั่วโมง) จะได้ otDays ว่างเปล่า ใบแจ้งหนี้จึงไม่คิด
    // เงิน OT ให้เลย ทั้งที่หน้าจอตรวจ Manday เห็นชั่วโมง OT อยู่แล้ว (ดูคอมเมนต์ที่ resolveOtHoursForRow)
    const hours = resolveOtHoursForRow(cols, detail);
    if (hours !== null && hours > 0) otDays.push({ date, hours });
  }
  return otDays;
}

/** ชื่อฟิลด์จริงของ Skill นี้ใน ABBYY Vantage → ชื่อ canonical ที่โค้ดใช้ — แต่ละ Skill (ต่อบริษัท)
 * ตั้งชื่อฟิลด์เองอิสระตอนเทรน ไม่ตรงกันข้าม Skill เลย ยืนยันจริงจาก ABBYY Vantage API ตรงๆ (15 ก.ย.
 * 69): "Employee Name" (OBS Timesheet2/iPassion/Thailife) vs "Name" (Big-C/Lotus/CP), "Month Year"
 * vs "Month_Year" (Big-C) vs "Month"+"Year" แยกกัน (Lotus) vs "Mounth" สะกดผิด (CP), "New Table"
 * vs "New Table 2" (Thailife) — เก็บ mapping ต่อ Skill ไว้ที่ `abbyy_skills.field_map` (Postgres
 * jsonb) ให้ admin ตั้งค่าได้จากหน้า "Skill ABBYY" โดยไม่ต้องแก้โค้ดทุกครั้งที่เพิ่ม Skill ใหม่ */
export interface AbbyyFieldMap {
  employeeName?: string;
  position?: string;
  /** ฟิลด์รอบเดือน+ปีรวมกันช่องเดียว (ค่า default) — ถ้า Skill นี้แยกเป็นสองฟิลด์แทน ปล่อยว่างแล้วใช้
   * month/year ด้านล่างคู่กัน */
  monthYear?: string | null;
  month?: string | null;
  year?: string | null;
  /** ชื่อฟิลด์ตารางรายวัน (type: Group ใน ABBYY) — ค่า default "New Table" */
  tableName?: string;
  /** ฟิลด์สรุปจำนวนวันทำงานที่ ABBYY คำนวณมาให้ตรงๆ (ถ้ามี) — ใช้เป็นค่าหลักเมื่อมี ไม่มีก็ไม่เป็นไร
   * เพราะคำนวณจากตารางรายวันเป็น fallback ที่เชื่อถือได้อยู่แล้ว (ดู tableWorkDays ด้านล่าง) ตั้งเป็น
   * null ได้ถ้า Skill นี้ไม่มีฟิลด์แบบนี้เลย จะได้ไม่ขึ้นเตือนหาฟิลด์ที่ไม่มีอยู่จริง */
  totalWorkDays?: string | null;
}

/** รับได้ทั้งสองรูป: รูปเก่าแบน (แถว `abbyy_skills.field_map` ที่บันทึกไว้ก่อนหน้า + หน้าตั้งค่าเดิม)
 * และรูปกลาง `TimesheetFieldMap` จาก @obs/domain — normalize เป็นรูปเดียวกันก่อนใช้งานเสมอ */
export type AbbyySkillFieldMap = AbbyyFieldMap | TimesheetFieldMap;

interface ResolvedFieldMap {
  header: Record<string, string | null | undefined>;
  detail: Record<string, string | null | undefined>;
  tableName: string | null;
  monthYearSplit: { month: string | null; year: string | null };
}

/** คีย์ระดับเอกสารตามสารบัญกลาง (TIMESHEET_DOCUMENT_FIELDS = header + summary) — ค่า default คือชื่อ
 * ฟิลด์จริงของ Skill "OBS Timesheet2" ตรงกับพฤติกรรมเดิมทุกตัวอักษร ส่วนคีย์ที่ไม่มี default (เช่น
 * employeeId/role/department/site) ปล่อยเป็น undefined ไว้ = ยังไม่ได้ตั้งค่า ไม่ใช่ "ไม่มีฟิลด์นี้" */
const DEFAULT_HEADER_MAP: Record<string, string | null> = {
  vendorName: 'Vendor',
  clientName: 'Client Name',
  projectName: 'Project Name',
  employeeName: 'Employee Name',
  position: 'Position',
  monthYear: 'Month Year',
  // คีย์ฝั่งซ้ายเปลี่ยนตามสารบัญกลาง V4 (Approver_Name → Approved_By_Name, Total_Hours ระดับสรุป →
  // Monthly_Total_Hours) ส่วนค่าฝั่งขวาคือชื่อฟิลด์จริงใน Skill ของ ABBYY ไม่ได้เปลี่ยนสักตัว
  approvedByName: 'Approver',
  totalWorkDays: 'Total Work days',
  monthlyTotalHours: 'Total Hours',
  totalLeaveDays: 'Leave Sick',
};

/** คอลัมน์ในตารางรายวัน — คีย์ตามสารบัญกลาง ค่า default คือชื่อคอลัมน์ที่ hardcode ไว้เดิม
 * ตัวที่จงใจไม่ใส่ default (date/timeIn/timeOut/otTimeIn/otTimeOut) คือตัวที่โค้ดเดิมไม่ได้อ่านจากชื่อ
 * คอลัมน์ แต่เดาเอาจากรูปแบบค่า (วันที่ DD/MM/YY, เรียงเวลาจากน้อยไปมาก) — ปล่อยเป็น undefined ไว้
 * เพื่อให้ยัง fallback ไปใช้การเดาแบบเดิมเมื่อ Skill ไม่ได้ตั้งค่าไว้ ดู pickCol() */
const DEFAULT_DETAIL_MAP: Record<string, string | null> = {
  jobDescription: 'Description',
  project: 'Project',
  workType: 'Type',
  normalHours: 'Normal',
  otHours: 'OT',
  // Total_Hours ระดับแถว → Daily_Total_Hours ตาม V4 ค่าฝั่งขวาคือชื่อคอลัมน์จริงใน Skill ไม่เปลี่ยน
  dailyTotalHours: 'Total per day',
};

const DEFAULT_TABLE_NAME = 'New Table';

function isCanonicalShape(raw: unknown): raw is TimesheetFieldMap {
  if (!raw || typeof raw !== 'object') return false;
  const o = raw as Record<string, unknown>;
  // `tableName` อย่างเดียวแยกสองรูปไม่ได้ (มีเหมือนกันทั้งคู่) — ดูคีย์ที่มีเฉพาะรูปกลางเท่านั้น
  return ['header', 'detail', 'monthYearSplit'].some((k) => o[k] !== undefined && typeof o[k] === 'object');
}

/** รูปเก่า → รูปกลาง — คัดเฉพาะคีย์ที่ตั้งไว้จริง (ห้ามเติม undefined ลงไป ไม่งั้นจะไปทับ default
 * ตอน spread) `month`/`year`/`totalWorkDays` ย้ายไปอยู่ในส่วนขยายของ header ตามที่อธิบายด้านบน */
function fromLegacyShape(legacy: AbbyyFieldMap): TimesheetFieldMap {
  const header: Record<string, string | null> = {};
  for (const key of ['employeeName', 'position', 'monthYear', 'totalWorkDays'] as const) {
    const value = legacy[key];
    if (value !== undefined) header[key] = value;
  }
  // รูปเก่าเก็บ month/year แบนไว้ระดับเดียวกับฟิลด์อื่น — รูปกลางย้ายไปอยู่ใน monthYearSplit
  const split = legacy.month !== undefined || legacy.year !== undefined
    ? { month: legacy.month ?? null, year: legacy.year ?? null }
    : undefined;
  return {
    header,
    ...(split ? { monthYearSplit: split } : {}),
    ...(legacy.tableName !== undefined ? { tableName: legacy.tableName } : {}),
  };
}

/** แปลงค่าที่เก็บไว้ให้เป็น "รูปกลาง" สำหรับส่งออกไปให้หน้าตั้งค่าใช้ — ตั้งใจ**ไม่**เติมค่า default
 * ลงไป เพราะหน้าตั้งค่าแยกสามสถานะ (ว่าง = ยังไม่ได้ตั้ง / null = Skill นี้ไม่มีฟิลด์นี้ / ข้อความ =
 * ชื่อฟิลด์จริง) ถ้าเติม default ไปด้วย ค่าที่ระบบเดาให้จะกลายเป็นค่าที่ "แอดมินตั้งเอง" ทันทีที่กดบันทึก
 * ครั้งแรก — ต่างกับ resolveFieldMap() ที่เติม default เพราะใช้ตอนอ่านเอกสารจริง */
export function toCanonicalFieldMap(raw: AbbyySkillFieldMap | null | undefined): TimesheetFieldMap | null {
  if (raw === null || raw === undefined) return null;
  return isCanonicalShape(raw) ? raw : fromLegacyShape(raw as AbbyyFieldMap);
}

function resolveFieldMap(raw: AbbyySkillFieldMap | null | undefined): ResolvedFieldMap {
  const fm = isCanonicalShape(raw) ? raw : fromLegacyShape((raw ?? {}) as AbbyyFieldMap);
  return {
    header: { ...DEFAULT_HEADER_MAP, ...(fm.header ?? {}) },
    detail: { ...DEFAULT_DETAIL_MAP, ...(fm.detail ?? {}) },
    // tableName: null = Skill นี้ไม่มีตารางรายวันจริงๆ (ไปใช้ทางก้อนข้อความแทน) ต่างจาก undefined ที่
    // แปลว่าไม่ได้ตั้งค่า ให้ใช้ค่า default
    tableName: fm.tableName === undefined ? DEFAULT_TABLE_NAME : fm.tableName,
    monthYearSplit: fm.monthYearSplit ?? { month: null, year: null },
  };
}

/** อ่านค่าตามชื่อฟิลด์ที่ map ไว้ — ชื่อเป็น null/undefined (ไม่มีฟิลด์นี้/ไม่ได้ตั้งค่า) คืน null เฉยๆ */
function pick(source: Record<string, any>, name: string | null | undefined): any {
  if (!name) return null;
  return source[name] ?? null;
}

/** คำนวณรอบเดือน — เชื่อฟิลด์รวม (monthYear) ก่อนเสมอถ้าตั้งไว้ (พิสูจน์ใช้งานได้จริงกับ Skill ส่วนใหญ่
 * แล้ว) ตกไปทาง month+year แยกกันเฉพาะตอน Skill นั้นไม่มีฟิลด์รวม (เช่น Lotus) — ใช้ monthFromWord/
 * normalizeYear จาก @obs/domain (ตัวเดียวกับที่ normalizeDate ใช้) เพราะรองรับทั้งเดือนไทย/อังกฤษและ
 * ปี พ.ศ./ค.ศ. ทนทานกว่า EN_MONTH ในไฟล์นี้ที่รองรับแค่ชื่อเดือนอังกฤษเต็มรูปแบบเดียว */
function resolvePeriod(fields: Record<string, any>, fm: ResolvedFieldMap): string | null {
  const monthYear = pick(fields, fm.header.monthYear);
  if (monthYear) {
    const p = parsePeriodFromYearField(monthYear);
    if (p) return p;
  }
  const rawMonth = pick(fields, fm.monthYearSplit.month);
  const rawYear = pick(fields, fm.monthYearSplit.year);
  if (rawMonth && rawYear) {
    const month = monthFromWord(rawMonth);
    const year = normalizeYear(rawYear);
    if (month && year) return `${year}-${String(month).padStart(2, '0')}`;
  }
  return null;
}

/** ported from abbyy.js mapAbbyyResult() — เดิม hardcode ชื่อฟิลด์ของ Skill "Timesheet2" ตัวเดียว
 * ตอนนี้รับ fieldMap ต่อ Skill เป็น parameter ที่สอง (ไม่ระบุ = ใช้ค่า default ด้านบน ตรงกับ
 * พฤติกรรมเดิมทุกประการ — เรียกจาก extractionService.ts ที่ดึง fieldMap จาก abbyy_skills ตาม
 * abbyySkillId ของสัญญานั้นๆ มาให้) */
export function mapAbbyyResult(rawResult: any, fieldMapOverride?: AbbyySkillFieldMap | null) {
  const fm = resolveFieldMap(fieldMapOverride);
  const rootObject = rawResult?.Transaction?.Documents?.[0]?.ExtractedData?.RootObject;
  const fields = fieldMap(rootObject);

  const period = resolvePeriod(fields, fm);
  const employeeName = stripLabelPrefix(pick(fields, fm.header.employeeName));
  const position = stripLabelPrefix(pick(fields, fm.header.position));
  const projectManagerSignatureName = stripLabelPrefix(pick(fields, fm.header.approvedByName));
  const rawTotalWorkDays = pick(fields, fm.header.totalWorkDays);
  const rawTotalHours = pick(fields, fm.header.monthlyTotalHours);
  const totalHours = rawTotalHours ? Number(rawTotalHours) : null;
  const rawLeaveSick = pick(fields, fm.header.totalLeaveDays);

  const expectedYear = period ? Number(period.slice(0, 4)) : null;
  const isStructuredTable = hasStructuredTable(rootObject, fm.tableName);
  const days = isStructuredTable ? buildDayRowsFromStructuredTable(rootObject, fm.tableName, expectedYear, fm.detail) : buildDayRowsFromFlatFields(fields, period);
  // ตารางรายวัน (ถ้ามี) คือแหล่งความจริงที่ใช้ได้กับทุก Skill โดยไม่ต้องรู้ชื่อฟิลด์สรุปล่วงหน้า — นับ
  // วันที่มีชั่วโมงทำงานปกติ > 0 (ตัดวันหยุด/วันลา/วันหยุดสุดสัปดาห์ที่ปกติจะเป็น 0 ชม.ออกไปเอง) ตรง
  // pattern เดียวกับ spreadsheetExtractionService.ts ที่พิสูจน์แล้วว่าใช้ได้จริงกับไฟล์จริง
  const tableWorkDays = isStructuredTable ? days.filter((d) => (d.normalHours ?? 0) > 0).length : null;
  // ฟิลด์สรุปที่ ABBYY ให้มาตรงๆ (ถ้ามีและตั้ง fieldMap ไว้) ยังคงเป็นค่าที่เชื่อถือได้ที่สุด (Skill
  // "OBS Timesheet2" ยิงจริงพิสูจน์แล้วว่าตรงกับของจริงทุกครั้ง) — คำนวณจากตารางเป็นแค่ fallback สำหรับ
  // Skill ที่ไม่มีฟิลด์นี้ในสคีมาเลย (เช่น "OBS Timesheet - iPassion") ไม่ใช่มาแทนที่ค่าที่ ABBYY ยืนยันแล้ว
  const totalWorkDays = rawTotalWorkDays ? Number(rawTotalWorkDays) : (tableWorkDays ?? 0);
  const leaveDays = isStructuredTable ? extractLeaveDaysFromTable(rootObject, fm.tableName, expectedYear, fm.detail) : [];
  const totalLeaveDays = leaveDays.length > 0 ? leaveDays.length : rawLeaveSick ? Number(rawLeaveSick) : 0;
  const otDays = isStructuredTable ? extractOtHoursFromTable(rootObject, fm.tableName, expectedYear, fm.detail) : [];

  const missingFieldNotes: string[] = [];
  if (isStructuredTable) {
    if (days.length === 0) {
      missingFieldNotes.push(`ABBYY ยังไม่ได้ตารางรายวันมาเลย (ตาราง "${fm.tableName}" ว่างเปล่าหรือหาวันที่ในแถวไม่เจอสักแถว) — ต้องกรอกเพิ่มเอง`);
    } else {
      // เดิม note นี้ขึ้นทุกครั้งที่มีตารางแล้วมีแถว ไม่ได้เช็คว่าใบนี้เคยสลับคอลัมน์จริงหรือเปล่า —
      // เตือนเหมารวมทุกใบทั้งที่ระบบอ่านตรงคอลัมน์อยู่แล้ว ตอนนี้ใช้เงื่อนไขเดียวกับ mappedTimes ใน
      // buildDayRowsFromStructuredTable() (บรรทัด 440): ขึ้นเฉพาะตอนที่ Skill นี้ยังไม่ได้ map
      // timeIn/timeOut ไว้จริง ซึ่งเป็นตอนเดียวที่ระบบต้องเดาตำแหน่งคอลัมน์เอง ถ้า map ครบแล้วอ่านตรง
      // คอลัมน์ ไม่มีอะไรต้องเตือน
      const mappedTimes = fm.detail.timeIn !== undefined && fm.detail.timeOut !== undefined;
      if (!mappedTimes) {
        missingFieldNotes.push('เวลาเข้า-ออก/รายละเอียดงานด้านล่างนี้ดึงมาจากตารางที่ยังไม่ได้ตั้งชื่อคอลัมน์ไว้ ระบบเดาตำแหน่งเอาเอง — ตรวจสอบกับ PDF ต้นฉบับก่อนยืนยัน');
      }
    }
    if (leaveDays.length > 0) {
      missingFieldNotes.push('วันลาด้านล่างนี้ตรวจจับมาจากตารางเดียวกันที่คอลัมน์ยังไม่แม่นยำ 100% — ตรวจสอบวันที่กับ PDF ต้นฉบับก่อนยืนยัน');
    }
    if (rawLeaveSick && Number(rawLeaveSick) !== leaveDays.length) {
      missingFieldNotes.push(`ช่องสรุป "Leave Sick" บอกว่ามีวันลา ${rawLeaveSick} วัน แต่ตรวจจากตารางเจอ ${leaveDays.length} วัน — ไม่ตรงกัน ตรวจสอบเพิ่ม`);
    }
    if (otDays.length > 0) {
      missingFieldNotes.push(`ตรวจพบ OT ${otDays.length} วันจากตาราง — ระบบคำนวณค่าจ้างเพิ่มให้อัตโนมัติในหน้าตรวจ Manday ตรวจสอบชั่วโมงกับ PDF ต้นฉบับก่อนยืนยัน`);
    }
  } else if (fields['Time In'] && days.length === 0) {
    missingFieldNotes.push('ABBYY อ่านตารางรายวันได้ แต่จำนวนค่าที่ได้ไม่ตรงกับจำนวนวันในเดือน/วันทำงาน — ไม่ได้ใส่ตารางรายวันให้ ต้องกรอกเพิ่มเอง');
  }
  // เตือนเฉพาะตอนหาไม่ได้จริงๆทั้งสองทาง (ไม่มีฟิลด์สรุป และนับจากตารางได้ 0 วัน) — ถ้า Skill นี้ไม่มี
  // ฟิลด์สรุปจำนวนวันทำงาน แต่นับจากตารางได้ค่าจริง ไม่ต้องเตือนอะไรเลย ถือว่าได้ค่าที่เชื่อถือได้แล้ว
  if (totalWorkDays === 0) missingFieldNotes.push('ABBYY ยังไม่ส่งจำนวนวันทำงานมา (ทั้งฟิลด์สรุปและตารางรายวัน) — ต้องกรอกเพิ่มเอง');
  /* ฟอร์มที่ไม่มีช่อง "เดือน/ปี" เลย แต่ตารางรายวันมีวันที่ครบ — อนุมานรอบเดือนจากเดือนที่แถวส่วนใหญ่
     ตกอยู่ (เจอจริงกับฟอร์ม CP Axtra ที่มีแต่คอลัมน์ Date รายแถว) นับจากของที่อ่านมาได้จริงเท่านั้น
     ไม่ได้เดาจากวันที่ปัจจุบันหรือจากชื่อไฟล์
     ยังคงเตือนไว้ให้คนตรวจเห็นว่าเลขนี้มาจากการอนุมาน ไม่ใช่ที่เอกสารเขียนไว้เอง — ต่างจากกรณีที่
     เอกสารพิมพ์รอบเดือนมาตรงๆ ซึ่งเชื่อได้มากกว่า */
  let resolvedPeriod = period;
  if (!resolvedPeriod && days.length > 0) {
    const tally = new Map<string, number>();
    for (const d of days) {
      const ym = String(d.date ?? '').slice(0, 7);
      if (/^\d{4}-\d{2}$/.test(ym)) tally.set(ym, (tally.get(ym) ?? 0) + 1);
    }
    const best = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
    if (best) {
      resolvedPeriod = best[0];
      missingFieldNotes.push(
        `เอกสารไม่มีช่องรอบเดือน — ระบบอนุมานเป็น ${best[0]} จากวันที่ในตารางรายวัน (${best[1]} จาก ${days.length} แถว) ตรวจสอบก่อนยืนยัน`,
      );
    }
  }
  if (!resolvedPeriod) missingFieldNotes.push('ABBYY ยังไม่ส่งรอบเดือนมา — ต้องเลือก "รอบเดือน" เอง');

  /* ไขว้เช็คผลรวมชั่วโมงที่คำนวณจากตารางรายวัน กับช่องสรุปทั้งงวด "Total Hours" ที่เอกสารพิมพ์ไว้เอง —
     ไม่ block การยืนยัน แค่เตือนให้คนตรวจเห็น เพราะชั่วโมงที่คำนวณจากเวลาเข้า-ออก (โดยเฉพาะ OT ที่ไม่มี
     คอลัมน์ชั่วโมงตรงๆ) ยังอาจเกินจริงถ้าเอกสารไม่ได้เขียนเวลาพักไว้ (ผู้ใช้ยืนยันให้คำนวณต่อ 17 ก.ย. 69
     — ดู resolveOtHoursForRow) ช่องสรุปนี้จึงเป็นตัวช่วยจับความคลาดเคลื่อนที่ทำได้ทันทีโดยไม่ต้องเดา
     ชื่อฟิลด์ "Total OT" ที่ยังไม่เคยยืนยันว่ามีจริงใน Skill ไหน — ใช้เกณฑ์ 5% หรือ 1 ชม. (เลือกค่ามาก
     กว่า) กันไม่ให้เตือนจุกจิกกับความคลาดเคลื่อนเล็กน้อยจากการปัดเศษ */
  if (totalHours !== null && days.length > 0) {
    const sumHours = days.reduce((sum, d) => sum + (d.normalHours ?? 0) + (d.otHours ?? 0), 0);
    const diff = Math.round(Math.abs(sumHours - totalHours) * 100) / 100;
    const threshold = Math.max(1, totalHours * 0.05);
    if (diff > threshold) {
      missingFieldNotes.push(
        `ผลรวมชั่วโมงที่คำนวณจากตารางรายวัน (${Math.round(sumHours * 100) / 100} ชม.) ต่างจากช่องสรุป "Total Hours" ` +
          `ในเอกสาร (${totalHours} ชม.) อยู่ ${diff} ชม. — ควรตรวจสอบชั่วโมงกับ PDF ต้นฉบับก่อนยืนยัน`,
      );
    }
  }

  return {
    vendor: pick(fields, fm.header.vendorName),
    clientName: pick(fields, fm.header.clientName),
    projectName: pick(fields, fm.header.projectName),
    employeeName,
    position,
    period: resolvedPeriod,
    // คีย์ระดับเอกสารที่เหลือตามสารบัญกลาง — ยังไม่มี Skill ไหนตั้ง mapping ไว้ (ไม่มี default) จึงเป็น
    // null จนกว่า admin จะตั้งค่าให้ Skill นั้น เพิ่มแบบ additive ไม่กระทบคีย์เดิมที่ ingest ใช้อยู่
    employeeId: pick(fields, fm.header.employeeId),
    role: pick(fields, fm.header.role),
    department: pick(fields, fm.header.department),
    reportingPeriod: pick(fields, fm.header.reportingPeriod),
    supervisorName: stripLabelPrefix(pick(fields, fm.header.supervisorName)),
    site: pick(fields, fm.header.documentSite),
    projectTeam: pick(fields, fm.header.projectTeam),
    documentNo: null,
    approvalStatus: null,
    totalWorkDays: Number.isFinite(totalWorkDays) ? totalWorkDays : 0,
    totalLeaveDays: Number.isFinite(totalLeaveDays) ? totalLeaveDays : 0,
    totalHours: Number.isFinite(totalHours as number) ? totalHours : null,
    days,
    leaveDays,
    otDays,
    signedByEmployee: Boolean(employeeName),
    employeeSignatureName: employeeName,
    signedByProjectManager: Boolean(projectManagerSignatureName),
    projectManagerSignatureName,
    notes: missingFieldNotes,
  };
}

function safeJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}
