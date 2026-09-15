import { NextRequest, NextResponse } from 'next/server';
import { apiBaseUrl } from '../../../../../lib/api';

/**
 * Same-origin proxy to the Express API's GET /api/auth/google/start — that endpoint responds
 * with a 302 to Google's consent screen plus a short-lived `obs_oauth_state` cookie (CSRF guard
 * for the callback). We forward the browser's own Host header as `x-forwarded-host` so
 * `googleRedirectUri()` on the API side computes the *web* origin's callback URL (not the
 * internal Docker `api:4301` address it would otherwise see) when GOOGLE_REDIRECT_URI isn't
 * explicitly set in .env. Set-Cookie is relayed so the state cookie ends up scoped to the web
 * origin the browser is actually on — same relay pattern as /api/auth/login.
 */
export async function GET(req: NextRequest) {
  const upstream = await fetch(`${apiBaseUrl()}/api/auth/google/start`, {
    headers: {
      'x-forwarded-host': req.headers.get('host') ?? '',
      'x-forwarded-proto': req.nextUrl.protocol.replace(':', ''),
    },
    redirect: 'manual',
  });

  if (upstream.status !== 302) {
    const data = await upstream.text();
    return new NextResponse(data, { status: upstream.status, headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' } });
  }

  const location = upstream.headers.get('location') ?? '/login';
  const res = NextResponse.redirect(location, 302);
  for (const cookie of upstream.headers.getSetCookie?.() ?? []) {
    res.headers.append('set-cookie', cookie);
  }
  return res;
}
