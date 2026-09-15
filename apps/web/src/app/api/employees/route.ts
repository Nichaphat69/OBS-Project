import { NextRequest } from 'next/server';
import { proxyJson } from '../../../lib/api';

export async function GET(req: NextRequest) {
  const qs = req.nextUrl.search;
  return proxyJson(`/api/employees${qs}`, { method: 'GET', cookieHeader: req.headers.get('cookie') ?? '' });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return proxyJson('/api/employees', { method: 'POST', cookieHeader: req.headers.get('cookie') ?? '', body });
}
