'use client';

import { useEffect, useState } from 'react';

/** ปุ่ม "เข้าสู่ระบบ/ลงทะเบียนด้วย Google" — ported from public/app.js's googleLoginBtn/
 * googleRegisterBtn wiring. โชว์เฉพาะตอนเซิร์ฟเวอร์ตั้งค่า GOOGLE_CLIENT_ID/SECRET ไว้แล้วเท่านั้น
 * (ดู GET /api/auth/config) ไม่งั้นกดไปก็เจอแค่ error เปล่าๆ */
export default function GoogleButton({ label }: { label: string }) {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    fetch('/api/auth/config')
      .then((r) => r.json())
      .then((data) => setEnabled(Boolean(data?.googleEnabled)))
      .catch(() => setEnabled(false));
  }, []);

  if (!enabled) return null;

  return (
    <button type="button" className="btn google" onClick={() => { window.location.href = '/api/auth/google/start'; }}>
      <svg viewBox="0 0 18 18" width="17" height="17" aria-hidden="true">
        <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
        <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.95v2.33A9 9 0 0 0 9 18Z" />
        <path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.95A9 9 0 0 0 0 9c0 1.45.35 2.83.95 4.05l3.02-2.33Z" />
        <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.59-2.59A8.9 8.9 0 0 0 9 0 9 9 0 0 0 .95 4.95l3.02 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
      </svg>
      <span>{label}</span>
    </button>
  );
}
