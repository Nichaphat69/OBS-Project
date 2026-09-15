/**
 * ตัวเชื่อม ABBYY Vantage — ported from src/extract/abbyy.js. Logic (including every real-world
 * data quirk it works around — column-swapped tables, leaked OT times, duplicated description
 * text, etc.) preserved exactly; only rewritten to TypeScript + native fetch/FormData/Blob (all
 * already global in Node 22, matching the original's dependency-free approach).
 *
 * See the original file's header comment for the full verification history (real sandbox calls,
 * Swagger UI, ABBYY docs) — endpoint names and field names here are not guesses.
 */
import { classifyDayKind, classifyLeaveType, monthFromWord, normalizeYear } from '@obs/domain';

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
      return await fetch(`${this.baseUrl}${path}`, {
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
  const m = String(value ?? '').match(/([A-Za-z]+)\s+(\d{4})/);
  if (!m) return null;
  const month = EN_MONTH[m[1].toLowerCase()];
  if (!month) return null;
  return `${m[2]}-${String(month).padStart(2, '0')}`;
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

function hasStructuredTable(rootObject: any, tableName: string): boolean {
  const table = rootObject?.Fields?.find((f: any) => f.Name === tableName);
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

const DOW_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function dayOfWeekFromDate(dateStr: string): string | null {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : DOW_EN[d.getUTCDay()];
}

function buildDayRowsFromStructuredTable(rootObject: any, tableName: string, expectedYear?: number | null) {
  const table = rootObject?.Fields?.find((f: any) => f.Name === tableName);
  if (!Array.isArray(table?.List)) return [];

  const days: any[] = [];
  for (const row of table.List) {
    const cols: Record<string, any> = {};
    for (const f of row.Value?.Fields ?? []) cols[f.Name] = f.List?.[0]?.Value ?? null;

    const date = parseTableRowDate(cols, expectedYear);
    if (!date) continue;

    const { timeIn, timeOut, otTimeIn, otTimeOut, recovered, descriptionOverride } = extractRowTimes(cols);
    const rawDescription = recovered ? descriptionOverride : cols['Description'];
    const jobDescription = rawDescription ? dedupeRepeatedText(rawDescription) : null;

    const isDateOrTimeLike = (v: unknown) => /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(String(v ?? '')) || parseTimeToMinutes(v) !== null;
    const labelParts = Object.entries(cols)
      .filter(([name, value]) => name !== 'Description' && !isDateOrTimeLike(value))
      .map(([, value]) => value)
      .filter(Boolean);
    const label = labelParts.length ? dedupeRepeatedText(labelParts.join(' ')) : null;

    const project = cols['Project'] ?? null;
    const type = cols['Type'] ? dedupeRepeatedText(cols['Type']) : label;

    const computedNormal = hoursBetween(timeIn, timeOut);
    const computedOt = hoursBetween(otTimeIn, otTimeOut);
    const normalHours = parsedOrNull(cols['Normal']) ?? computedNormal;
    const otHours = parsedOrNull(cols['OT']) ?? computedOt;
    const totalHours = parsedOrNull(cols['Total per day']) ?? (normalHours !== null || otHours !== null ? Math.round(((normalHours ?? 0) + (otHours ?? 0)) * 100) / 100 : null);

    days.push({
      date, dayOfWeek: dayOfWeekFromDate(date), project,
      timeIn, timeOut, otTimeIn, otTimeOut,
      label, type, remark: null, jobDescription,
      normalHours, otHours, totalHours,
    });
  }
  return days;
}

function extractLeaveDaysFromTable(rootObject: any, tableName: string, expectedYear?: number | null) {
  const table = rootObject?.Fields?.find((f: any) => f.Name === tableName);
  if (!Array.isArray(table?.List)) return [];

  const leaveDays: Array<{ date: string; type: string; rawLabel: string }> = [];
  for (const row of table.List) {
    const cols: Record<string, any> = {};
    for (const f of row.Value?.Fields ?? []) cols[f.Name] = f.List?.[0]?.Value ?? null;

    const date = parseTableRowDate(cols, expectedYear);
    if (!date) continue;

    const labelsNoDescription = Object.entries(cols).filter(([name]) => name !== 'Description').map(([, value]) => value);
    const isLeave = classifyDayKind(...labelsNoDescription) === 'leave' || hasExactLeaveWord(cols);
    if (!isLeave) continue;

    const rawLabel = [...labelsNoDescription, cols['Description']].filter(Boolean).join(' ');
    leaveDays.push({ date, type: classifyLeaveType(rawLabel), rawLabel });
  }
  return leaveDays;
}

function extractOtHoursFromTable(rootObject: any, tableName: string, expectedYear?: number | null) {
  const table = rootObject?.Fields?.find((f: any) => f.Name === tableName);
  if (!Array.isArray(table?.List)) return [];

  const otDays: Array<{ date: string; hours: number }> = [];
  for (const row of table.List) {
    const cols: Record<string, any> = {};
    for (const f of row.Value?.Fields ?? []) cols[f.Name] = f.List?.[0]?.Value ?? null;

    const date = parseTableRowDate(cols, expectedYear);
    if (!date) continue;

    const hours = Number(cols['OT']);
    if (Number.isFinite(hours) && hours > 0) otDays.push({ date, hours });
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

const DEFAULT_FIELD_MAP: Required<Pick<AbbyyFieldMap, 'employeeName' | 'position' | 'tableName'>> &
  Pick<AbbyyFieldMap, 'monthYear' | 'month' | 'year' | 'totalWorkDays'> = {
  employeeName: 'Employee Name',
  position: 'Position',
  monthYear: 'Month Year',
  month: null,
  year: null,
  tableName: 'New Table',
  totalWorkDays: 'Total Work days',
};

/** คำนวณรอบเดือน — เชื่อฟิลด์รวม (monthYear) ก่อนเสมอถ้าตั้งไว้ (พิสูจน์ใช้งานได้จริงกับ Skill ส่วนใหญ่
 * แล้ว) ตกไปทาง month+year แยกกันเฉพาะตอน Skill นั้นไม่มีฟิลด์รวม (เช่น Lotus) — ใช้ monthFromWord/
 * normalizeYear จาก @obs/domain (ตัวเดียวกับที่ normalizeDate ใช้) เพราะรองรับทั้งเดือนไทย/อังกฤษและ
 * ปี พ.ศ./ค.ศ. ทนทานกว่า EN_MONTH ในไฟล์นี้ที่รองรับแค่ชื่อเดือนอังกฤษเต็มรูปแบบเดียว */
function resolvePeriod(fields: Record<string, any>, fm: AbbyyFieldMap): string | null {
  if (fm.monthYear && fields[fm.monthYear]) {
    const p = parsePeriodFromYearField(fields[fm.monthYear]);
    if (p) return p;
  }
  if (fm.month && fm.year && fields[fm.month] && fields[fm.year]) {
    const month = monthFromWord(fields[fm.month]);
    const year = normalizeYear(fields[fm.year]);
    if (month && year) return `${year}-${String(month).padStart(2, '0')}`;
  }
  return null;
}

/** ported from abbyy.js mapAbbyyResult() — เดิม hardcode ชื่อฟิลด์ของ Skill "Timesheet2" ตัวเดียว
 * ตอนนี้รับ fieldMap ต่อ Skill เป็น parameter ที่สอง (ไม่ระบุ = ใช้ DEFAULT_FIELD_MAP ด้านบน ตรงกับ
 * พฤติกรรมเดิมทุกประการ — เรียกจาก extractionService.ts ที่ดึง fieldMap จาก abbyy_skills ตาม
 * abbyySkillId ของสัญญานั้นๆ มาให้) */
export function mapAbbyyResult(rawResult: any, fieldMapOverride?: AbbyyFieldMap | null) {
  const fm: AbbyyFieldMap = { ...DEFAULT_FIELD_MAP, ...(fieldMapOverride ?? {}) };
  const rootObject = rawResult?.Transaction?.Documents?.[0]?.ExtractedData?.RootObject;
  const fields = fieldMap(rootObject);

  const period = resolvePeriod(fields, fm);
  const employeeName = (fm.employeeName && fields[fm.employeeName]) ?? null;
  const position = (fm.position && fields[fm.position]) ?? null;
  const projectManagerSignatureName = fields['Approver'] ?? null;
  // ⚠️ ชื่อฟิลด์สรุป "Total Hours"/"Leave Sick"/"Vendor"/"Client Name"/"Project Name"/"Approver" ยังไม่
  // อยู่ใน fieldMap (ไม่ใช่ 1 ใน 4 ฟิลด์หลักที่บล็อกการ ingest) — คงไว้เป็นฟิลด์เสริมที่ null ได้เฉยๆถ้า
  // Skill ไหนไม่มี ไม่กระทบการทำงานหลัก ต่างจาก totalWorkDays ด้านล่างที่มี fallback คำนวณเองจากตาราง
  const rawTotalWorkDays = fm.totalWorkDays ? fields[fm.totalWorkDays] : undefined;
  const rawTotalHours = fields['Total Hours'];
  const totalHours = rawTotalHours ? Number(rawTotalHours) : null;
  const rawLeaveSick = fields['Leave Sick'];

  const expectedYear = period ? Number(period.slice(0, 4)) : null;
  const isStructuredTable = hasStructuredTable(rootObject, fm.tableName!);
  const days = isStructuredTable ? buildDayRowsFromStructuredTable(rootObject, fm.tableName!, expectedYear) : buildDayRowsFromFlatFields(fields, period);
  // ตารางรายวัน (ถ้ามี) คือแหล่งความจริงที่ใช้ได้กับทุก Skill โดยไม่ต้องรู้ชื่อฟิลด์สรุปล่วงหน้า — นับ
  // วันที่มีชั่วโมงทำงานปกติ > 0 (ตัดวันหยุด/วันลา/วันหยุดสุดสัปดาห์ที่ปกติจะเป็น 0 ชม.ออกไปเอง) ตรง
  // pattern เดียวกับ spreadsheetExtractionService.ts ที่พิสูจน์แล้วว่าใช้ได้จริงกับไฟล์จริง
  const tableWorkDays = isStructuredTable ? days.filter((d) => (d.normalHours ?? 0) > 0).length : null;
  // ฟิลด์สรุปที่ ABBYY ให้มาตรงๆ (ถ้ามีและตั้ง fieldMap ไว้) ยังคงเป็นค่าที่เชื่อถือได้ที่สุด (Skill
  // "OBS Timesheet2" ยิงจริงพิสูจน์แล้วว่าตรงกับของจริงทุกครั้ง) — คำนวณจากตารางเป็นแค่ fallback สำหรับ
  // Skill ที่ไม่มีฟิลด์นี้ในสคีมาเลย (เช่น "OBS Timesheet - iPassion") ไม่ใช่มาแทนที่ค่าที่ ABBYY ยืนยันแล้ว
  const totalWorkDays = rawTotalWorkDays ? Number(rawTotalWorkDays) : (tableWorkDays ?? 0);
  const leaveDays = isStructuredTable ? extractLeaveDaysFromTable(rootObject, fm.tableName!, expectedYear) : [];
  const totalLeaveDays = leaveDays.length > 0 ? leaveDays.length : rawLeaveSick ? Number(rawLeaveSick) : 0;
  const otDays = isStructuredTable ? extractOtHoursFromTable(rootObject, fm.tableName!, expectedYear) : [];

  const missingFieldNotes: string[] = [];
  if (isStructuredTable) {
    if (days.length === 0) {
      missingFieldNotes.push(`ABBYY ยังไม่ได้ตารางรายวันมาเลย (ตาราง "${fm.tableName}" ว่างเปล่าหรือหาวันที่ในแถวไม่เจอสักแถว) — ต้องกรอกเพิ่มเอง`);
    } else {
      missingFieldNotes.push('เวลาเข้า-ออก/รายละเอียดงานด้านล่างนี้ดึงมาจากตารางที่คอลัมน์เคยสลับตำแหน่งมาก่อน — ตรวจสอบกับ PDF ต้นฉบับก่อนยืนยัน');
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
  if (!period) missingFieldNotes.push('ABBYY ยังไม่ส่งรอบเดือนมา — ต้องเลือก "รอบเดือน" เอง');

  return {
    vendor: fields['Vendor'] ?? null,
    clientName: fields['Client Name'] ?? null,
    projectName: fields['Project Name'] ?? null,
    employeeName,
    position,
    period,
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
