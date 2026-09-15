import { NextRequest } from 'next/server';
import { proxyJson } from '../../../../lib/api';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return proxyJson('/api/gmail/read', { method: 'POST', cookieHeader: req.headers.get('cookie') ?? '', body });
}
