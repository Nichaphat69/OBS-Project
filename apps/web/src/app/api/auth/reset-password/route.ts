import { NextRequest } from 'next/server';
import { proxyJson } from '../../../../lib/api';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return proxyJson('/api/auth/reset-password', { method: 'POST', cookieHeader: '', body });
}
