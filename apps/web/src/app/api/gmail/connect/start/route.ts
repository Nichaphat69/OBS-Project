import { NextRequest, NextResponse } from 'next/server';
import { apiBaseUrl } from '../../../../../lib/api';

/**
 * ส่งต่อไปยัง GET /api/gmail/connect/start ของฝั่ง Express ซึ่งตอบเป็น 302 ไปหน้ายินยอมของ Google
 * พร้อม cookie กัน CSRF อายุสั้น — รูปแบบเดียวกับ /api/auth/google/start ทุกประการ
 *
 * ต้องส่ง Host ของเบราว์เซอร์ไปเป็น x-forwarded-host ด้วย ไม่งั้นฝั่ง API จะคำนวณ redirect URI
 * จากที่อยู่ภายใน Docker (api:4301) ซึ่ง Google ไม่รู้จักและจะปฏิเสธทันที
 * และต้องส่ง cookie ของเซสชันไปด้วย เพราะเส้นนั้นบังคับล็อกอิน (admin/บัญชีเท่านั้น)
 */
export async function GET(req: NextRequest) {
  const upstream = await fetch(`${apiBaseUrl()}/api/gmail/connect/start`, {
    headers: {
      cookie: req.headers.get('cookie') ?? '',
      'x-forwarded-host': req.headers.get('host') ?? '',
      'x-forwarded-proto': req.nextUrl.protocol.replace(':', ''),
    },
    redirect: 'manual',
  });

  if (upstream.status !== 302) {
    const data = await upstream.text();
    return new NextResponse(data, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
    });
  }

  const res = NextResponse.redirect(upstream.headers.get('location') ?? '/gmail-link', 302);
  for (const cookie of upstream.headers.getSetCookie?.() ?? []) res.headers.append('set-cookie', cookie);
  return res;
}
