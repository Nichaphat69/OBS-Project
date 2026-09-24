// Sentry ฝั่ง edge runtime (middleware.ts ถ้ามีในอนาคต) — ปิดเงียบๆ ถ้ายังไม่ตั้ง SENTRY_DSN
import * as Sentry from '@sentry/nextjs';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 0.1,
  });
}
