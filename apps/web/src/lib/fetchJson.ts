/**
 * อ่านคำตอบจาก API ให้ปลอดภัยเมื่อปลายทาง "ไม่ได้ตอบ JSON"
 *
 * เดิมหลายหน้าเรียก `await res.json()` ตรงๆ ถ้ามีอะไรระหว่างทาง (reverse proxy, tunnel, หน้า error
 * ของ Next.js) ตอบกลับเป็น HTML แทน คนใช้งานจะเห็นข้อความของตัวแปลง JSON ว่า
 * `Unexpected token '<', "<html> <h"... is not valid JSON` ซึ่งไม่ได้บอกเลยว่าเกิดอะไรขึ้น
 * และที่แย่กว่าคือ **ปิดบังรหัสสถานะจริง** ทำให้ไล่ปัญหาไม่ได้ (เจอจริง 29 ก.ย. 69 ตอนอัปโหลด 3 ไฟล์)
 *
 * ตัวนี้คืนสถานะจริงเสมอ และถ้าเนื้อหาไม่ใช่ JSON ก็แปลงเป็นข้อความที่บอกได้ว่าติดตรงไหน
 */
export interface JsonResult<T = any> {
  ok: boolean;
  status: number;
  data: T | null;
  /** ข้อความพร้อมแสดงให้ผู้ใช้เมื่อไม่สำเร็จ — null เมื่อสำเร็จ */
  error: string | null;
}

/** แปลรหัสสถานะเป็นภาษาคน เฉพาะตัวที่เกิดจริงกับระบบนี้ */
function describeStatus(status: number): string {
  if (status === 413) return 'ไฟล์ที่เลือกรวมกันใหญ่เกินกว่าที่ตัวรับคำขอยอมให้ส่ง — ลองแบ่งส่งทีละน้อยลง';
  if (status === 502 || status === 503 || status === 504) return 'ติดต่อเซิร์ฟเวอร์ไม่ได้ชั่วคราว — ลองใหม่อีกครั้ง';
  if (status === 401) return 'เซสชันหมดอายุ — เข้าสู่ระบบใหม่';
  if (status === 0) return 'ส่งคำขอไม่ถึงเซิร์ฟเวอร์';
  return `เซิร์ฟเวอร์ตอบกลับผิดปกติ (HTTP ${status})`;
}

export async function readJson<T = any>(res: Response): Promise<JsonResult<T>> {
  const text = await res.text().catch(() => '');
  let data: T | null = null;
  try {
    data = text ? (JSON.parse(text) as T) : null;
  } catch {
    data = null;
  }

  if (data === null && text.trim()) {
    // ไม่ใช่ JSON — บอกสถานะจริงไว้ก่อน แล้วค่อยแปะเนื้อหาสั้นๆ ไว้ให้ไล่ต่อได้
    const peek = text.replace(/\s+/g, ' ').trim().slice(0, 80);
    return { ok: false, status: res.status, data: null, error: `${describeStatus(res.status)} · ${peek}` };
  }
  if (!res.ok) {
    const fromBody = (data as any)?.error;
    return { ok: false, status: res.status, data, error: fromBody || describeStatus(res.status) };
  }
  return { ok: true, status: res.status, data, error: null };
}
