// Sentry ฝั่ง server (Node runtime) — ปิดเงียบๆ ถ้ายังไม่ตั้ง SENTRY_DSN — import จาก instrumentation.ts
import * as Sentry from '@sentry/nextjs';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 0.1,
  });
}
