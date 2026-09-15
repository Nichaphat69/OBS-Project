import { NextRequest, NextResponse } from 'next/server';
import { apiBaseUrl } from '../../../../lib/api';

/** Same-origin proxy to POST /api/auth/logout — forwards the browser's Cookie header to the
 * Express API so it can find and delete the right session row, then relays the clearing
 * Set-Cookie back to the browser. See login/route.ts for why this proxy pattern is used. */
export async function POST(req: NextRequest) {
  const upstream = await fetch(`${apiBaseUrl()}/api/auth/logout`, {
    method: 'POST',
    headers: { cookie: req.headers.get('cookie') ?? '' },
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
