import { NextRequest, NextResponse } from 'next/server';
import { apiBaseUrl } from '../../../../../lib/api';

/**
 * Same-origin proxy to the Express API's GET /api/my-line-link/oauth/callback — LINE redirects the
 * browser here directly (this path is what must be registered as the callback URL in the LINE
 * Login channel's Console settings), so forward the code/state query string, the session cookie
 * (this is account-linking for an already logged-in employee, not a sign-in) and the
 * obs_line_oauth_state cookie set by /oauth/start. Same relay pattern as
 * apps/web/src/app/api/auth/google/callback/route.ts.
 */
export async function GET(req: NextRequest) {
  const forwardedHost = req.headers.get('host') ?? '';
  const forwardedProto = req.nextUrl.protocol.replace(':', '');
  const upstream = await fetch(`${apiBaseUrl()}/api/my-line-link/oauth/callback${req.nextUrl.search}`, {
    headers: {
      cookie: req.headers.get('cookie') ?? '',
      'x-forwarded-host': forwardedHost,
      'x-forwarded-proto': forwardedProto,
    },
    redirect: 'manual',
  });

  const location = upstream.headers.get('location') ?? '/my-line-link';
  const base = `${forwardedProto}://${forwardedHost}`;
  const res = NextResponse.redirect(new URL(location, base), 302);
  for (const cookie of upstream.headers.getSetCookie?.() ?? []) {
    res.headers.append('set-cookie', cookie);
  }
  return res;
}
