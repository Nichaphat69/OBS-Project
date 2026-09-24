// Next.js เรียกไฟล์นี้เองตอน server boot (ต้องเปิด experimental.instrumentationHook ใน next.config.mjs
// สำหรับ Next 14.2 — เสถียรแบบไม่ต้องเปิด flag ตั้งแต่ Next 15) — แยก config ตาม runtime เพราะ
// sentry.server.config.ts ใช้ API ของ Node ที่รันบน edge runtime ไม่ได้
import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

// ปลอดภัยแม้ยังไม่ตั้ง SENTRY_DSN — Sentry SDK ที่ยังไม่ได้ init จะแค่ no-op เฉยๆ ไม่ throw
export const onRequestError = Sentry.captureRequestError;
