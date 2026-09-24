// Sentry ฝั่ง browser — ปิดเงียบๆ ถ้ายังไม่ตั้ง NEXT_PUBLIC_SENTRY_DSN (ต้องสมัคร Sentry เองแล้วเอา
// DSN มาใส่ .env — ต้องใช้ NEXT_PUBLIC_ เพราะโค้ดนี้รันในเบราว์เซอร์ ไม่ใช่ตัวแปร server-only ธรรมดา)
// (เจ้าของระบบสั่ง 24 ก.ย. 69 — "ไม่มี error tracking บั๊กฝั่ง production จะไม่มีใครรู้จนกว่าจะมีคนแจ้ง")
import * as Sentry from '@sentry/nextjs';

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    tracesSampleRate: 0.1,
  });
}
