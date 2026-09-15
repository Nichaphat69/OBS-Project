import { NextRequest, NextResponse } from 'next/server';
import { apiBaseUrl } from '../../../../lib/api';

/**
 * Same-origin proxy to the Express API's POST /api/auth/login.
 *
 * The browser only ever talks to this Next.js origin — never directly to apps/api — which
 * sidesteps cross-origin cookie handling (SameSite/partitioned-cookie quirks) between the
 * `web` and `api` Docker services entirely. This route forwards the login request server-to-
 * server, then relays the API's Set-Cookie header(s) back to the browser so the session cookie
 * ends up scoped to the web origin the browser is actually on.
 */
export async function POST(req: NextRequest) {
  const body = await req.text();
  const upstream = await fetch(`${apiBaseUrl()}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': req.headers.get('content-type') ?? 'application/json' },
    body,
  });

  const data = await upstream.text();
  const res = new NextResponse(data, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
  });

  for (const cookie of upstream.headers.getSetCookie?.() ?? []) {
    res.headers.append('set-cookie', cookie);
  }
  return res;
}
