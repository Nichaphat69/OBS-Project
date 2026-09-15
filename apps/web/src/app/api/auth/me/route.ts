import { NextRequest, NextResponse } from 'next/server';
import { apiBaseUrl } from '../../../../lib/api';

/** Same-origin proxy to GET /api/auth/me — used by client components that need to know who's
 * logged in without a full page reload. Server Components (e.g. the dashboard page) call the
 * Express API directly instead, since they already run server-side. */
export async function GET(req: NextRequest) {
  const upstream = await fetch(`${apiBaseUrl()}/api/auth/me`, {
    headers: { cookie: req.headers.get('cookie') ?? '' },
    cache: 'no-store',
  });
  const data = await upstream.text();
  return new NextResponse(data, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
  });
}
