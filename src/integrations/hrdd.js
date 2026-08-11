/**
 * ตัวเชื่อม HRDD (WorkDD) — ใช้ "ดูอย่างเดียว" เพื่อเทียบวันลาที่ Timesheet รายงานกับวันลาที่
 * อนุมัติจริงใน HRDD ก่อนวางบิล (ข้อ "เทียบวันลา" ในเอกสาร)
 *
 * ⚠️ ห้ามมีโค้ดเขียน/แก้/ลบข้อมูลฝั่ง HRDD เด็ดขาด — ไฟล์นี้เรียกได้แค่:
 *   - POST /auth/login             ล็อกอินด้วยบัญชีที่ตั้งไว้ (ดู README หัวข้อ HRDD)
 *   - POST /leavetransaction/findByCompany   อ่านวันลาทั้งบริษัทในช่วงวันที่ที่ระบุ
 * ทั้งสองเส้นเป็น GET ทางความหมาย (ไม่มีผลข้างเคียงใน HRDD) แม้ endpoint ที่สองจะเป็น HTTP POST
 * ก็ตาม (HRDDออกแบบมาแบบนั้นเอง เพราะต้องส่ง body ช่วงวันที่/สถานะ)
 *
 * ไม่ใช้ JWT_SECRET ที่ปรากฏใน .env ของ HRDD มาปลอม token เอง — ยืนยันตัวตนด้วยการล็อกอินจริง
 * ผ่าน /auth/login เหมือนไคลเอนต์อื่นๆของ HRDD ทุกตัว ปลอดภัยกว่าและไม่ต้องพึ่งความลับที่หลุดมา
 */

const DEFAULT_TIMEOUT_MS = 15_000;

export class HrddError extends Error {
  constructor(message, { status = null, body = null } = {}) {
    super(message);
    this.name = 'HrddError';
    this.status = status;
    this.body = body;
  }
}

export function hasHrddCredentials() {
  return Boolean(process.env.HRDD_BASE_URL && process.env.HRDD_USERNAME && process.env.HRDD_PASSWORD);
}

export class HrddClient {
  constructor({
    baseUrl = process.env.HRDD_BASE_URL,
    username = process.env.HRDD_USERNAME,
    password = process.env.HRDD_PASSWORD,
    fetchImpl = globalThis.fetch,
  } = {}) {
    this.baseUrl = baseUrl?.replace(/\/+$/, '');
    this.username = username;
    this.password = password;
    this.fetch = fetchImpl;
    this.token = null;
  }

  async call(path, { method = 'POST', body = null, auth = true, retryOn401 = true } = {}) {
    if (!this.baseUrl || !this.username || !this.password) {
      throw new HrddError(
        'ยังไม่ได้เชื่อมต่อ HRDD — ใส่ HRDD_BASE_URL/HRDD_USERNAME/HRDD_PASSWORD ใน .env',
        { status: 400 },
      );
    }
    if (auth && !this.token) await this.login();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    let response;
    try {
      response = await this.fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(auth ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });
    } catch (error) {
      throw new HrddError(`เชื่อมต่อ HRDD ไม่สำเร็จ (${error.message})`, { status: null });
    } finally {
      clearTimeout(timeout);
    }

    // token หมดอายุ/ใช้ไม่ได้ — ลองล็อกอินใหม่แล้วยิงซ้ำครั้งเดียว ไม่วนซ้ำไม่จบ
    if (response.status === 401 && auth && retryOn401) {
      this.token = null;
      await this.login();
      return this.call(path, { method, body, auth, retryOn401: false });
    }

    const text = await response.text();
    const parsed = text ? safeJson(text) : null;
    if (!response.ok) {
      throw new HrddError(`เรียก HRDD ไม่สำเร็จ (${path})`, { status: response.status, body: parsed });
    }
    return parsed;
  }

  async login() {
    const data = await this.call('/auth/login', {
      auth: false,
      body: { username: this.username, password: this.password },
    });
    if (!data?.accessToken) {
      throw new HrddError('HRDD ตอบกลับมาโดยไม่มี accessToken — ตรวจ HRDD_USERNAME/HRDD_PASSWORD', { status: 401 });
    }
    this.token = data.accessToken;
    return this.token;
  }

  /**
   * วันลาทั้งบริษัทในช่วงวันที่ที่ระบุ — กรองเหลือเฉพาะพนักงานที่ต้องการเอาไว้ที่ฝั่งเรียกใช้
   * (endpoint จริงของ HRDD ไม่มีพารามิเตอร์กรองรายบุคคล ต้องขอมาทั้งบริษัทแล้วกรองเอง)
   *
   * @param {object} params
   * @param {string} params.dateFrom  'YYYY-MM-DD'
   * @param {string} params.dateTo    'YYYY-MM-DD'
   * @param {string[]} [params.status]  รหัสสถานะที่ต้องการ (เช่น รหัส "อนุมัติแล้ว")
   *   ไม่ระบุ = ขอมาทุกสถานะ แล้วผู้เรียกกรองเอาเฉพาะที่อนุมัติแล้วเองอีกที
   */
  async findLeavesByCompany({ dateFrom, dateTo, status = [] }) {
    return this.call('/leavetransaction/findByCompany', { body: { dateFrom, dateTo, status } });
  }

  /** รายการสถานะวันลาที่บริษัทนี้ตั้งไว้ใน HRDD — รหัส (code) เป็นข้อมูลที่ตั้งเองต่อบริษัท
   * ไม่ใช่ค่าคงที่ตายตัว ต้องถามทุกครั้ง ห้ามจำรหัสจากบริษัทหนึ่งไปใช้กับอีกบริษัท */
  async findLeaveStatuses() {
    return this.call('/leaveStatus/findByCompanyCode', { method: 'GET' });
  }

  /** รายการประเภทวันลาที่บริษัทนี้ตั้งไว้ใน HRDD (เช่น Sick Leave/Vacation Leave) — ใช้โชว์ชื่อเต็ม
   * เผื่อ leaveName ที่ได้จาก findByCompany ไม่ครบ (ในซอร์สโค้ด HRDD บางเส้นดึงชื่อจากตารางนี้เอง) */
  async findLeaveTypes() {
    return this.call('/leave/findByCompanyCode', { method: 'GET' });
  }
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return { raw: text }; }
}
