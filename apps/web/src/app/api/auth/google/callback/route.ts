import { NextRequest, NextResponse } from 'next/server';
import { apiBaseUrl } from '../../../../../lib/api';

/**
 * Same-origin proxy to the Express API's GET /api/auth/google/callback — Google redirects the
 * browser here directly (this path is what's registered as the OAuth redirect_uri), so we must
 * forward the `code`/`state` query string, the `obs_oauth_state` cookie set by /google/start
 * (for the API's CSRF check), and the same `x-forwarded-host`/`-proto` headers so
 * `googleRedirectUri()` recomputes the identical callback URL used at the /start step. The API's
 * response is itself a redirect (to `/`, `/?googlePending=1`, or `/?loginError=...`) plus,on
 * success, a Set-Cookie for the real session — both relayed straight through.
 */
export async function GET(req: NextRequest) {
  const forwardedHost = req.headers.get('host') ?? '';
  const forwardedProto = req.nextUrl.protocol.replace(':', '');
  const upstream = await fetch(`${apiBaseUrl()}/api/auth/google/callback${req.nextUrl.search}`, {
    headers: {
      cookie: req.headers.get('cookie') ?? '',
      'x-forwarded-host': forwardedHost,
      'x-forwarded-proto': forwardedProto,
    },
    redirect: 'manual',
  });

  // ต้องใช้ Host header ของ browser request จริง (เหมือนที่ forward ไป upstream ข้างบน) เป็น base
  // ไม่ใช่ req.url — ใน Next.js standalone server (docker) req.url สะท้อน hostname ของ container เอง
  // ไม่ใช่ hostname ที่ browser เรียกเข้ามาจริง ทำให้ redirect หลุดไปที่ container hostname ที่ DNS
  // ข้างนอกไม่รู้จัก
  const location = upstream.headers.get('location') ?? '/login';
  const base = `${forwardedProto}://${forwardedHost}`;
  const res = NextResponse.redirect(new URL(location, base), 302);
  for (const cookie of upstream.headers.getSetCookie?.() ?? []) {
    res.headers.append('set-cookie', cookie);
  }
  return res;
}
