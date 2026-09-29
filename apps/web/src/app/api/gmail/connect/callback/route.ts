import { NextRequest, NextResponse } from 'next/server';
import { apiBaseUrl } from '../../../../../lib/api';

/**
 * ปลายทางที่ Google เรียกกลับมาหลังคนกดยินยอม — ส่งต่อให้ฝั่ง Express ตัดสินแล้วรับ 302 กลับมา
 * ซึ่งจะพากลับไปหน้า "เชื่อมต่อ Gmail" พร้อมผลลัพธ์ใน query string
 */
export async function GET(req: NextRequest) {
  const upstream = await fetch(`${apiBaseUrl()}/api/gmail/connect/callback${req.nextUrl.search}`, {
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

  const res = NextResponse.redirect(new URL(upstream.headers.get('location') ?? '/gmail-link', req.nextUrl.origin), 302);
  for (const cookie of upstream.headers.getSetCookie?.() ?? []) res.headers.append('set-cookie', cookie);
  return res;
}
