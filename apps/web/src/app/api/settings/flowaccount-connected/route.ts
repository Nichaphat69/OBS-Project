import { NextRequest } from 'next/server';
import { proxyJson } from '../../../../lib/api';

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return proxyJson('/api/settings/flowaccount-connected', { method: 'PATCH', cookieHeader: req.headers.get('cookie') ?? '', body });
}
