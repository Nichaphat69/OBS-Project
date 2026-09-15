import { NextRequest } from 'next/server';
import { proxyJson } from '../../../lib/api';

export async function GET(req: NextRequest) {
  return proxyJson('/api/notification-recipients', { method: 'GET', cookieHeader: req.headers.get('cookie') ?? '' });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return proxyJson('/api/notification-recipients', { method: 'POST', cookieHeader: req.headers.get('cookie') ?? '', body });
}
