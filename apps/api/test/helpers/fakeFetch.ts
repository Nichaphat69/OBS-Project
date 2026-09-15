/**
 * ตัวสลับ global fetch สำหรับเทสต์
 *
 * เทสต์ต้นฉบับ (`test/flowaccount.test.js`, `test/abbyy.test.js`) ส่ง `fetchImpl` เข้า constructor
 * ของ client ได้โดยตรง แต่พอร์ต TypeScript ของสองไฟล์นี้เรียก `fetch` ตัว global ตรงๆ (ไม่รับ
 * `fetchImpl` เป็น option) — จึงต้องสลับ `globalThis.fetch` แทนเพื่อทดสอบเรื่องเดียวกัน
 */

export type FakeFetch = (url: any, opts?: any) => Promise<any>;

/** ติดตั้ง fetch จำลอง แล้วคืนฟังก์ชันสำหรับคืนค่าเดิม */
export function installFetch(impl: FakeFetch): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = impl as unknown as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

/** รัน fn โดยใช้ fetch จำลอง แล้วคืนค่า fetch เดิมเสมอไม่ว่าจะ throw หรือไม่ */
export async function withFetch<T>(impl: FakeFetch, fn: () => Promise<T>): Promise<T> {
  const restore = installFetch(impl);
  try {
    return await fn();
  } finally {
    restore();
  }
}

/** ตอบตาม path ที่ตรงกับ key — ตรงกับ `fakeFetch(responses)` ของเทสต์ต้นฉบับ */
export function respondByPath(responses: Record<string, unknown>): FakeFetch {
  return async (url: any) => {
    const key = Object.keys(responses).find((k) => String(url).includes(k));
    if (!key) throw new Error(`ไม่มี response จำลองสำหรับ ${url}`);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(responses[key]),
    };
  };
}
