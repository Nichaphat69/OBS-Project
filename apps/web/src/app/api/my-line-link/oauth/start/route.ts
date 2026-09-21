import { NextRequest, NextResponse } from 'next/server';
import { apiBaseUrl } from '../../../../../lib/api';

/**
 * Same-origin proxy to the Express API's GET /api/my-line-link/oauth/start — same relay pattern
 * as apps/web/src/app/api/auth/google/start/route.ts (forward host/proto so lineLoginRedirectUri()
 * computes the web origin's callback URL, relay the Set-Cookie state guard). Unlike the Google
 * flow this one needs the caller's own session cookie forwarded too — it's linking LINE to an
 * *already logged-in* employee, not signing in.
 */
export async function GET(req: NextRequest) {
  const upstream = await fetch(`${apiBaseUrl()}/api/my-line-link/oauth/start`, {
    headers: {
      cookie: req.headers.get('cookie') ?? '',
      'x-forwarded-host': req.headers.get('host') ?? '',
      'x-forwarded-proto': req.nextUrl.protocol.replace(':', ''),
    },
    redirect: 'manual',
  });

  if (upstream.status !== 302) {
    const data = await upstream.text();
    return new NextResponse(data, { status: upstream.status, headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' } });
  }

  const location = upstream.headers.get('location') ?? '/my-line-link';
  const res = NextResponse.redirect(location, 302);
  for (const cookie of upstream.headers.getSetCookie?.() ?? []) {
    res.headers.append('set-cookie', cookie);
  }
  return res;
}
