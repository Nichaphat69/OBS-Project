// ต้อง import จาก '@sentry/nextjs/config' เท่านั้น (ไม่ใช่ '@sentry/nextjs' เฉยๆ) — ตรวจแล้วว่า
// index หลักของแพ็กเกจนี้ (เงื่อนไข "node" ใน package.json exports) ไม่มี withSentryConfig อยู่เลย
// import จาก '@sentry/nextjs' ตรงๆ จะพัง "Named export 'withSentryConfig' not found" ทันทีที่ Next.js
// โหลด next.config.mjs (ตรวจจริงด้วย node --input-type=module ก่อนใช้ ไม่ใช่เดาจากเอกสาร)
import { withSentryConfig } from '@sentry/nextjs/config';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  // Next 14.2 ยังต้องเปิด flag นี้ instrumentation.ts (server/edge Sentry init) ถึงจะทำงาน (เสถียรแบบ
  // ไม่ต้องเปิด flag ตั้งแต่ Next 15) — ดู instrumentation.ts ที่ root ของแอปนี้
  experimental: { instrumentationHook: true },
};

// withSentryConfig ทำงานปกติแม้ไม่มี SENTRY_AUTH_TOKEN/SENTRY_ORG/SENTRY_PROJECT (แค่ข้าม upload
// sourcemap ไป log warning เฉยๆ ตอน build ไม่ทำให้ build พัง) — ตัว capture error จริงคุมด้วย
// SENTRY_DSN ในไฟล์ sentry.*.config.ts แยกต่างหาก (เจ้าของระบบสั่ง 24 ก.ย. 69)
export default withSentryConfig(nextConfig, {
  silent: true,
  disableLogger: true,
  telemetry: false,
  sourcemaps: { disable: true },
});
