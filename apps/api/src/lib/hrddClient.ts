/**
 * ตัวเชื่อม HRDD (WorkDD) — ported from src/integrations/hrdd.js — ใช้ "ดูอย่างเดียว" เพื่อเทียบวันลา
 * ที่ Timesheet รายงานกับวันลาที่อนุมัติจริงใน HRDD ก่อนวางบิล
 *
 * ⚠️ ห้ามมีโค้ดเขียน/แก้/ลบข้อมูลฝั่ง HRDD เด็ดขาด — ไฟล์นี้เรียกได้แค่ POST /auth/login (ล็อกอิน) และ
 * POST /leavetransaction/findByCompany (อ่านวันลาทั้งบริษัท) ทั้งสองเส้นเป็น GET ทางความหมาย (ไม่มีผล
 * ข้างเคียงใน HRDD) แม้เส้นที่สองจะเป็น HTTP POST ก็ตาม (ต้องส่ง body ช่วงวันที่/สถานะ)
 *
 * ไม่ใช้ JWT_SECRET ที่ปรากฏใน .env ของ HRDD มาปลอม token เอง — ยืนยันตัวตนด้วยการล็อกอินจริงผ่าน
 * /auth/login เหมือนไคลเอนต์อื่นๆของ HRDD ทุกตัว
 */

const DEFAULT_TIMEOUT_MS = 15_000;

export class HrddError extends Error {
  status: number | null;
  body: unknown;
  constructor(message: string, { status = null, body = null }: { status?: number | null; body?: unknown } = {}) {
    super(message);
    this.name = 'HrddError';
    this.status = status;
    this.body = body;
  }
}

export function hasHrddCredentials(): boolean {
  return Boolean(process.env.HRDD_BASE_URL && process.env.HRDD_USERNAME && process.env.HRDD_PASSWORD);
}

export interface HrddLeaveStatus {
  code: string;
  name: string;
}

export interface HrddLeaveRecord {
  requestName: string;
  dateFrom: string;
  dateTo: string;
  leaveName?: string | null;
  leaveCode?: string | null;
  [key: string]: unknown;
}

export class HrddClient {
  private baseUrl: string | undefined;
  private username: string | undefined;
  private password: string | undefined;
  private fetch: typeof fetch;
  private token: string | null = null;

  constructor({
    baseUrl = process.env.HRDD_BASE_URL,
    username = process.env.HRDD_USERNAME,
    password = process.env.HRDD_PASSWORD,
    fetchImpl = globalThis.fetch,
  }: { baseUrl?: string; username?: string; password?: string; fetchImpl?: typeof fetch } = {}) {
    this.baseUrl = baseUrl?.replace(/\/+$/, '');
    this.username = username;
    this.password = password;
    this.fetch = fetchImpl;
  }

  private async call<T = any>(
    path: string,
    { method = 'POST', body = null, auth = true, retryOn401 = true }: { method?: string; body?: unknown; auth?: boolean; retryOn401?: boolean } = {},
  ): Promise<T> {
    if (!this.baseUrl || !this.username || !this.password) {
      throw new HrddError('ยังไม่ได้เชื่อมต่อ HRDD — ใส่ HRDD_BASE_URL/HRDD_USERNAME/HRDD_PASSWORD ใน .env', { status: 400 });
    }
    if (auth && !this.token) await this.login();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    let response: Response;
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
    } catch (error: any) {
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
    return parsed as T;
  }

  async login(): Promise<string> {
    const data = await this.call<{ accessToken?: string }>('/auth/login', {
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
   * วันลาทั้งบริษัทในช่วงวันที่ที่ระบุ — กรองเหลือเฉพาะพนักงานที่ต้องการเอาไว้ที่ฝั่งเรียกใช้ (endpoint
   * จริงของ HRDD ไม่มีพารามิเตอร์กรองรายบุคคล ต้องขอมาทั้งบริษัทแล้วกรองเอง)
   */
  async findLeavesByCompany({ dateFrom, dateTo, status = [] }: { dateFrom: string; dateTo: string; status?: string[] }): Promise<HrddLeaveRecord[]> {
    return this.call('/leavetransaction/findByCompany', { body: { dateFrom, dateTo, status } });
  }

  /** รายการสถานะวันลาที่บริษัทนี้ตั้งไว้ใน HRDD — รหัส (code) เป็นข้อมูลที่ตั้งเองต่อบริษัท ไม่ใช่ค่า
   * คงที่ตายตัว ต้องถามทุกครั้ง ห้ามจำรหัสจากบริษัทหนึ่งไปใช้กับอีกบริษัท */
  async findLeaveStatuses(): Promise<HrddLeaveStatus[]> {
    return this.call('/leaveStatus/findByCompanyCode', { method: 'GET' });
  }

  /** รายการประเภทวันลาที่บริษัทนี้ตั้งไว้ใน HRDD (เช่น Sick Leave/Vacation Leave) */
  async findLeaveTypes(): Promise<unknown> {
    return this.call('/leave/findByCompanyCode', { method: 'GET' });
  }
}

function safeJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}
