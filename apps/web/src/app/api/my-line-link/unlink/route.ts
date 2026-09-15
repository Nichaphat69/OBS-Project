import { NextRequest } from 'next/server';
import { proxyJson } from '../../../../lib/api';

export async function POST(req: NextRequest) {
  return proxyJson('/api/my-line-link/unlink', { method: 'POST', cookieHeader: req.headers.get('cookie') ?? '', body: {} });
}
