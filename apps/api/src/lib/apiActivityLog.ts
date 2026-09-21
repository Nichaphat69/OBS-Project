/**
 * API Activity Log — หน้า "จัดการระบบ" แท็บใหม่ (เฉพาะ admin) ดู design brief 7.3 (21 ก.ย. 69)
 * "ดูได้ในหน้าเดียวว่า OBS เรียกออกไปหาระบบอื่น (Consume) หรือถูกเรียกเข้ามา (Expose) เมื่อไหร่
 * สำเร็จหรือไม่ ใช้เวลาเท่าไหร่"
 *
 * สองจุดเรียกใช้ไฟล์นี้:
 *   - loggedFetch()        — แทน fetch() ตรงๆ ในทุก client ที่เรียกออกไปหาระบบอื่น (ABBYY/Clear Read/
 *                             FlowAccount/Gmail/Google/HRDD/LINE) หน้าตา/ค่าที่คืนเหมือน fetch() ทุก
 *                             ประการ (สลับใช้แทนที่ได้ตรงๆ) แค่แอบบันทึก log ข้างหลังแบบ fire-and-forget
 *   - logExposedRequest()  — middleware ใส่เฉพาะเส้นทางที่ระบบอื่นเรียกเข้ามาจริง (n8n/LINE webhook)
 *                             ไม่ใส่ทุกเส้นแบบ global เพราะ "Expose" ในที่นี้หมายถึงระบบภายนอกเรียกเข้า
 *                             ไม่ใช่ทุก request จาก browser ของผู้ใช้เอง (ถามยืนยันแล้วก่อนหน้านี้ว่า
 *                             consumer คือระบบไหนบ้าง — ดูบทสนทนา 21 ก.ย. 69)
 *
 * การเขียน log ต้อง "ห้ามพังงานจริง" เด็ดขาด — ทุกจุดจึงเป็น fire-and-forget (ไม่ await, catch เองใน
 * recordApiActivity) ถ้า DB ล่มหรือเขียนไม่ทัน งานจริง (เรียก ABBYY/ตอบ n8n) ต้องไม่ได้รับผลกระทบเลย
 *
 * requestBody/responseBody ผ่าน redactAndTruncate() เสมอ — ตัด field ที่เป็น credential ทิ้ง (ไม่ใช่แค่
 * เรื่องความปลอดภัย เผื่อ log รั่วออกไปเอง) และตัดความยาวกัน log บวมจากไฟล์แนบ/PDF base64/รายการอีเมลยาวๆ
 */
// ตั้งชื่อ Request/Response ของ express ให้ต่างจาก global Response (DOM fetch API) — ไม่งั้นชื่อชนกัน
// แล้ว TypeScript จะตีความ return type ของ loggedFetch() (Promise<Response>) เป็น express.Response
// ไปเงียบๆ (คนละ type กับ fetch() จริง ผิดทั้งไฟล์ที่เรียกใช้)
import type { NextFunction, Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { prisma } from '@obs/db';

const MAX_BODY_LEN = 4000;

const SENSITIVE_KEY = /^(authorization|client[_-]?secret|access[_-]?token|id[_-]?token|refresh[_-]?token|password|channel[_-]?secret|secret|token|api[_-]?key)$/i;

function redactValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(redactValue);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? '[redacted]' : redactValue(val);
    }
    return out;
  }
  return v;
}

function truncate(s: string): string {
  return s.length > MAX_BODY_LEN ? `${s.slice(0, MAX_BODY_LEN)}…(ตัดไว้ ยาวทั้งหมด ${s.length} ตัวอักษร)` : s;
}

/** รับ string ดิบ (JSON, x-www-form-urlencoded, หรือ text อื่น) มา redact ฟีลด์ที่เป็น credential แล้ว
 * ตัดความยาว — เดาชนิดจากเนื้อหาเอง ไม่บังคับผู้เรียกต้องบอกชนิดมาก่อน */
export function redactAndTruncate(raw: string | null | undefined): string | null {
  if (raw == null || raw.length === 0) return raw ?? null;
  try {
    const parsed = JSON.parse(raw);
    return truncate(JSON.stringify(redactValue(parsed)));
  } catch {
    // ไม่ใช่ JSON — เช็คว่าหน้าตาเป็น x-www-form-urlencoded ไหม (key=value คั่น & ไม่มีช่องว่าง/แท็ก)
    if (raw.length < 20_000 && /^[^\s<>]+=[^\s]*(&[^\s<>]+=[^\s]*)*$/.test(raw)) {
      try {
        const params = new URLSearchParams(raw);
        const redacted = new URLSearchParams();
        for (const [k, v] of params) redacted.set(k, SENSITIVE_KEY.test(k) ? '[redacted]' : v);
        return truncate(redacted.toString());
      } catch {
        /* ปล่อยผ่านไปตัดความยาวเฉยๆ ด้านล่าง */
      }
    }
    return truncate(raw);
  }
}

function requestBodyToLoggable(body: BodyInit | null | undefined): string | null {
  if (body == null) return null;
  if (typeof body === 'string') return redactAndTruncate(body);
  if (body instanceof URLSearchParams) return redactAndTruncate(body.toString());
  if (Buffer.isBuffer(body)) return `[Buffer ${body.length} bytes]`;
  if (typeof FormData !== 'undefined' && body instanceof FormData) return '[FormData]';
  return '[binary]';
}

interface ActivityEntry {
  direction: 'consume' | 'expose';
  service: string;
  method: string;
  path: string;
  durationMs: number;
  statusCode?: number | null;
  ok: boolean;
  requestBody?: string | null;
  responseBody?: string | null;
  errorMessage?: string | null;
}

/** เขียนแถว log — fire-and-forget เสมอ (ผู้เรียกไม่ await) ห้าม throw ออกไปหางานจริงเด็ดขาด */
export async function recordApiActivity(entry: ActivityEntry): Promise<void> {
  try {
    await prisma.apiActivityLog.create({
      data: {
        at: new Date().toISOString(),
        direction: entry.direction,
        service: entry.service,
        method: entry.method,
        path: entry.path.slice(0, 2000),
        durationMs: entry.durationMs,
        statusCode: entry.statusCode ?? null,
        ok: entry.ok,
        requestBody: entry.requestBody ?? null,
        responseBody: entry.responseBody ?? null,
        errorMessage: entry.errorMessage?.slice(0, 2000) ?? null,
      },
    });
  } catch (error) {
    console.error('[apiActivityLog] เขียน log ไม่สำเร็จ (ไม่กระทบงานจริง)', error);
  }
}

/** ตัวแทน fetch() 1:1 — คืนค่าเหมือน fetch() ทุกประการ (Response ตัวจริง อ่านซ้ำได้ปกติ เพราะ log
 * ใช้ .clone() อ่านแยกต่างหาก) สลับจาก `fetch(...)` เป็น `loggedFetch('service-name', ...)` ตรงๆ ได้เลย
 * ไม่ต้องแก้ logic รอบข้าง — อ้างถึง fetch ของ global ตอนเรียกจริง (ไม่ capture ไว้ตอน import) จึงยังโดน
 * มocked ด้วย global.fetch = ... ในเทสต์ได้ตามปกติเหมือนเดิม
 * พารามิเตอร์ตัวที่ 4 (fetchImpl) ไว้ให้ client ที่ DI fetch เข้ามาเอง (HrddClient/LineClient ที่รับ
 * `fetchImpl` เข้า constructor เพื่อเทสต์) ส่ง this.fetch เข้ามาแทน global fetch ได้ */
export async function loggedFetch(
  service: string,
  input: RequestInfo | URL,
  init?: RequestInit,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const start = Date.now();
  const method = init?.method ?? 'GET';
  const path = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
  try {
    const response = await fetchImpl(input as any, init);
    let responseBody: string | null = null;
    try {
      responseBody = redactAndTruncate(await response.clone().text());
    } catch {
      responseBody = null;
    }
    void recordApiActivity({
      direction: 'consume',
      service,
      method,
      path,
      durationMs: Date.now() - start,
      statusCode: response.status,
      ok: response.ok,
      requestBody: requestBodyToLoggable(init?.body ?? null),
      responseBody,
    });
    return response;
  } catch (error: any) {
    void recordApiActivity({
      direction: 'consume',
      service,
      method,
      path,
      durationMs: Date.now() - start,
      statusCode: null,
      ok: false,
      requestBody: requestBodyToLoggable(init?.body ?? null),
      errorMessage: error?.message ?? String(error),
    });
    throw error;
  }
}

function requestBodyForExpose(req: ExpressRequest): string | null {
  const body = (req as any).body;
  if (body == null) return null;
  if (Buffer.isBuffer(body)) return redactAndTruncate(body.toString('utf8'));
  try {
    return redactAndTruncate(JSON.stringify(body));
  } catch {
    return null;
  }
}

/** middleware ใส่เฉพาะเส้นทางที่ระบบภายนอกเรียกเข้ามาจริง (n8n/LINE webhook) — ใส่ก่อน middleware auth
 * ของเส้นนั้นเสมอ จะได้ log ครบแม้ถูกปฏิเสธ (401/403) ด้วย ไม่ใช่แค่ตอนสำเร็จ
 *
 * `skipIf` ไว้เฉพาะเส้นทางแบบ dual-mode อย่าง POST /api/cycles/:contractId/:period/request-approval
 * ที่ requireAuthOrN8nSecret ยอมให้ผ่านได้ทั้งจาก n8n (shared secret) และ admin ที่ login ในเว็บอยู่แล้ว
 * — เคสหลังไม่ใช่ "ระบบภายนอกเรียกเข้ามา" จริงๆ (แค่ผู้ใช้กดปุ่มในหน้าเว็บตามปกติ) จึงไม่ควรนับเป็น
 * Expose เอา predicate นี้เช็ค req.user (auth middleware setไว้ก่อน finish แล้วเสมอ) ข้ามการบันทึกถ้าจริง */
export function logExposedRequest(service: string, skipIf?: (req: ExpressRequest) => boolean) {
  return (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    const start = Date.now();
    let responseBody: unknown;
    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      responseBody = body;
      return originalJson(body);
    }) as typeof res.json;

    res.on('finish', () => {
      if (skipIf?.(req)) return;
      void recordApiActivity({
        direction: 'expose',
        service,
        method: req.method,
        path: req.originalUrl,
        durationMs: Date.now() - start,
        statusCode: res.statusCode,
        ok: res.statusCode < 400,
        requestBody: requestBodyForExpose(req),
        responseBody: responseBody !== undefined ? redactAndTruncate(JSON.stringify(responseBody)) : null,
      });
    });

    next();
  };
}
