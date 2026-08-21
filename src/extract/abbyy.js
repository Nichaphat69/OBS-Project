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
 * โครงสร้างผลลัพธ์ (ยืนยันจากการทดสอบจริงกับไฟล์ Timesheet จริง 17 ส.ค. 69 และอีกครั้ง 21 ส.ค. 69
 * ตอนสลับไปใช้ Skill "Timesheet2") — `Transaction.Documents[0].ExtractedData.RootObject.Fields`
 * เป็น array ของ `{Name, List: [{Value, Annotations}]}` field ระดับเอกสาร (Employee Name, Approver,
 * Position/Role, Vendor, Client Name, Total Work days/Man Day, Total Hours, Month Year/Year ฯลฯ)
 * มี List แค่ 1 ค่าตรงไปตรงมา — Skill "Timesheet2" ยัง train ไม่ครบทุกฟิลด์พร้อมกัน (ฟิลด์ไหนยังมั่นใจ
 * ไม่พอ ABBYY จะไม่ส่งชื่อฟิลด์นั้นมาเลยในคำตอบ ไม่ใช่ส่งมาเป็นค่าว่าง) เห็นฟิลด์โผล่มาเพิ่มเรื่อยๆทีละตัว
 * ตามจำนวนเอกสารตัวอย่างที่ label เพิ่ม — mapAbbyyResult() จึงต้องรับมือกับฟิลด์ที่หายไปได้ (null/0 ไปก่อน)
 *
 * ตารางรายวัน ("New Table" ใน Timesheet2 / ฟิลด์ Time In-Time Out-Work Hour per Day แยกกันใน
 * Skill "Timesheet" รุ่นแรก) มี 2 รูปแบบที่ต้องรองรับพร้อมกัน:
 *   1) รุ่นแรก — field ตารางแต่ละคอลัมน์เป็น "ก้อนข้อความเดียว" คั่นด้วย "\n" ต่อวัน ไม่ใช่แถวจริง
 *      และ field "Date" ว่างเปล่าเสมอ ต้องจับคู่ตำแหน่งเอาเอง ดู buildDayRowsFromFlatFields()
 *   2) Timesheet2 — ได้ตารางเป็นแถวจริงแล้ว (RootObject.Fields[].List[].Value.Fields[] ต่อแถว)
 *      แต่ตรวจกับผลจริงพบว่าค่าในคอลัมน์ยังสลับตำแหน่งกันไม่คงที่ต่อแถว (ไม่ใช่ shift แบบตายตัวที่แก้
 *      โค้ดตามได้) ดูคอมเมนต์ hasStructuredTable() ด้านล่าง — ยังไม่ดึงเวลาเข้า-ออกจากตารางนี้เลย
 * ทั้งสองแบบ: ไม่มั่นใจว่าจับคู่ถูกแถวจริงเมื่อไหร่ ให้คืน [] ดีกว่าใส่ข้อมูลผิดแบบเงียบๆ
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

const EN_MONTH = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

/** "May 2026" (ค่าจริงในฟิลด์ที่ Skill ตั้งชื่อว่า "Year" แต่จริงๆเป็นเดือน+ปีรวมกัน) → "2026-05" */
function parsePeriodFromYearField(value) {
  const m = String(value ?? '').match(/([A-Za-z]+)\s+(\d{4})/);
  if (!m) return null;
  const month = EN_MONTH[m[1].toLowerCase()];
  if (!month) return null;
  return `${m[2]}-${String(month).padStart(2, '0')}`;
}

function daysInMonth(period) {
  const m = String(period ?? '').match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]), 0).getDate();
}

/** ดึงค่าแรกของแต่ละ field ชื่อ (RootObject.Fields[].List[0].Value) มาเป็น { [ชื่อฟิลด์]: ค่า } */
function fieldMap(rootObject) {
  const map = {};
  for (const field of rootObject?.Fields ?? []) {
    const value = field.List?.[0]?.Value;
    if (value != null && value !== '') map[field.Name] = value;
  }
  return map;
}

/** ค่าฟิลด์ตารางรายวันที่ ABBYY คืนมาเป็นก้อนเดียวคั่นด้วยขึ้นบรรทัดใหม่ ให้แยกเป็น array */
function splitLines(value) {
  if (!value) return [];
  return String(value).split('\n').map((s) => s.trim());
}

/**
 * สร้าง days[] จากฟิลด์ตารางแบบก้อนข้อความเดิม (Skill "Timesheet" รุ่นแรก) — จับคู่ตำแหน่ง
 * ดูคอมเมนต์หัวไฟล์อธิบายเหตุผล/ข้อจำกัดเต็มๆ คืน [] ทันทีที่จำนวนค่าไม่ตรงกับที่คาดไว้
 * ไม่มั่นใจว่าจะจับคู่ถูกแถวจริง — ใช้เฉพาะตอน field เป็นก้อนข้อความ (fields['Work Hour per Day']
 * เป็น string) เท่านั้น ถ้า Skill ใหม่คืนตารางมาเป็นแถวจริงแล้ว (ดู extractDayRowsFromTable)
 * ให้ใช้ทางนั้นแทน
 */
function buildDayRowsFromFlatFields(fields, period) {
  const totalDays = daysInMonth(period);
  if (!totalDays) return [];

  const workHourPerDay = splitLines(fields['Work Hour per Day']);
  if (workHourPerDay.length !== totalDays) return [];

  const workdayPositions = [];
  workHourPerDay.forEach((v, i) => { if (Number(v) > 0) workdayPositions.push(i); });

  const timeIn = splitLines(fields['Time In']);
  const timeOut = splitLines(fields['Time Out']);
  if (timeIn.length !== workdayPositions.length || timeOut.length !== workdayPositions.length) return [];

  return workdayPositions.map((dayIndex, i) => ({
    date: `${period}-${String(dayIndex + 1).padStart(2, '0')}`,
    timeIn: timeIn[i] || null,
    timeOut: timeOut[i] || null,
    label: null,
    type: null,
    remark: null,
    // ยังไม่ผูก "Description" — จำนวนค่าที่ Skill อ่านได้ไม่ตรงกับจำนวนวันทำงานจริง (ดูคอมเมนต์หัวไฟล์)
    jobDescription: null,
  }));
}

/**
 * ตาราง "New Table" ของ Skill "Timesheet2" (21 ส.ค. 69) — ตอนนี้ ABBYY คืนมาเป็นแถวจริงแล้ว
 * (ไม่ใช่ก้อนข้อความเหมือนเดิม) แต่ตรวจกับผลจริงแล้วพบว่า**ค่าในแต่ละคอลัมน์ยังสลับตำแหน่งกันไม่คงที่
 * ต่างกันไปทุกแถว** (เช่นแถวหนึ่ง "Time Out" ดันมีค่าที่ควรเป็นเวลาเข้า อีกแถว "Type" ดันมีค่าเวลาออก)
 * ไม่ใช่การสลับแบบตายตัวที่เขียนโค้ดแก้ตามได้ — ถ้าอ่านค่าคอลัมน์ตรงชื่อไปเลยจะได้เวลา/รายละเอียดผิด
 * แบบดูสมเหตุสมผลแต่ผิดจริง อันตรายกว่าตารางว่างเปล่า จึง**ไม่ดึงเวลาเข้า-ออก/รายละเอียดงานจากตารางนี้
 * เลยตอนนี้** — ปล่อยให้ [] ไว้ก่อน (คนตรวจพิมพ์เพิ่มเองได้) จนกว่า Skill จะ train ตารางนี้ให้
 * คอลัมน์ตรงตำแหน่งสม่ำเสมอทุกแถวก่อน
 *
 * สิ่งเดียวที่ดึงมาใช้ได้อย่างปลอดภัยจากตารางนี้คือ "แถวไหนเป็นวันจริงในเดือน" (ฟิลด์ "Date" เป็น
 * เลขล้วนๆ) เพื่อกันไม่ให้แถวหัวตาราง/แถวลายเซ็นที่หลุดเข้ามาปนถูกนับเป็นวันทำงาน — ใช้แค่นับ
 * จำนวนแถวเป็นตัวเช็คคร่าวๆเท่านั้น ไม่ได้ใช้คำนวณอะไรที่กระทบยอดเงิน
 */
function hasStructuredTable(rootObject) {
  const table = rootObject?.Fields?.find((f) => f.Name === 'New Table');
  return Array.isArray(table?.List) && table.List.length > 0 && table.List[0]?.Value?.Fields;
}

/**
 * แปลงผลลัพธ์ดิบจาก ABBYY (Transaction.Documents[0].ExtractedData.RootObject) ให้ตรงกับ
 * TIMESHEET_SCHEMA ที่ src/extract/timesheet.js ใช้ต่อ (verifyExtraction, calculateManday ฯลฯ
 * ใช้ schema เดียวกันไม่ว่าจะมาจาก ABBYY หรือโมเดลในเครื่อง)
 *
 * รองรับชื่อฟิลด์ของ Skill "Timesheet2" เท่านั้น (Position, Total Work days, Month Year, Leave
 * Sick ฯลฯ) — เลิกใช้ Skill "Timesheet" รุ่นแรกแล้ว ไม่ต้องรองรับชื่อฟิลด์เก่าอีกต่อไป Timesheet2
 * ยัง train ไม่ครบทุกฟิลด์ (ดูคอมเมนต์หัวไฟล์ 21 ส.ค. 69) ฟิลด์ไหนที่ ABBYY ยังไม่ส่งมาจะเป็น null/0
 * ไปก่อน ไม่ใช่ error — ต้องกรอกเพิ่มเอง
 */
export function mapAbbyyResult(rawResult) {
  const rootObject = rawResult?.Transaction?.Documents?.[0]?.ExtractedData?.RootObject;
  const fields = fieldMap(rootObject);

  const period = parsePeriodFromYearField(fields['Month Year']);
  const employeeName = fields['Employee Name'] ?? null;
  const position = fields['Position'] ?? null;
  const projectManagerSignatureName = fields['Approver'] ?? null;
  const rawTotalWorkDays = fields['Total Work days'];
  const totalWorkDays = rawTotalWorkDays ? Number(rawTotalWorkDays) : 0;
  const rawTotalHours = fields['Total Hours'];
  const totalHours = rawTotalHours ? Number(rawTotalHours) : null;
  const rawLeaveSick = fields['Leave Sick'];
  const totalLeaveDays = rawLeaveSick ? Number(rawLeaveSick) : 0;

  // ตารางแถวจริงของ Timesheet2 ยังไม่น่าเชื่อพอจะดึงเวลาเข้า-ออกอัตโนมัติ (ดูคอมเมนต์ hasStructuredTable)
  // ส่วนตารางก้อนข้อความของ Timesheet รุ่นแรกยังลองแบบเดิมได้ตามปกติ
  const days = hasStructuredTable(rootObject) ? [] : buildDayRowsFromFlatFields(fields, period);

  const missingFieldNotes = [];
  if (hasStructuredTable(rootObject)) {
    missingFieldNotes.push(
      'ABBYY อ่านตารางรายวันมาเป็นแถวแล้ว แต่คอลัมน์ยังสลับตำแหน่งกันไม่คงที่ต่อแถว — ไม่ได้ดึงเวลาเข้า-ออก/รายละเอียดงานให้อัตโนมัติ ต้องกรอกเพิ่มเอง',
    );
  } else if (fields['Time In'] && days.length === 0) {
    missingFieldNotes.push(
      'ABBYY อ่านตารางรายวันได้ แต่จำนวนค่าที่ได้ไม่ตรงกับจำนวนวันในเดือน/วันทำงาน — ไม่ได้ใส่ตารางรายวันให้ ต้องกรอกเพิ่มเอง',
    );
  }
  if (!rawTotalWorkDays) missingFieldNotes.push('ABBYY ยังไม่ส่งจำนวนวันทำงานมา (ฟิลด์ "Total Work days") — ต้องกรอกเพิ่มเอง');
  if (!period) missingFieldNotes.push('ABBYY ยังไม่ส่งรอบเดือนมา (ฟิลด์ "Month Year") — ต้องเลือก "รอบเดือน" เอง');

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
    totalHours: Number.isFinite(totalHours) ? totalHours : null,
    days,
    leaveDays: [],
    // ไม่มีฟิลด์ชื่อกำกับลายเซ็นพนักงานแยกต่างหาก (ฟิลด์ "Employee's signature" เป็นรูปภาพ ไม่ใช่ตัวอักษร)
    // ใช้ Employee Name เป็นตัวแทน — มีชื่อพนักงานแปลว่าน่าจะมีลายเซ็นกำกับอยู่ในเอกสารเดียวกัน
    signedByEmployee: Boolean(employeeName),
    employeeSignatureName: employeeName,
    signedByProjectManager: Boolean(projectManagerSignatureName),
    projectManagerSignatureName,
    notes: missingFieldNotes,
  };
}

function safeJson(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { raw: text }; }
}
