import { NextRequest } from 'next/server';
import { proxyJson } from '../../../lib/api';

export async function GET(req: NextRequest) {
  const qs = req.nextUrl.search;
  return proxyJson(`/api/activity${qs}`, { method: 'GET', cookieHeader: req.headers.get('cookie') ?? '' });
}
