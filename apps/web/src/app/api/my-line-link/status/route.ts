import { NextRequest } from 'next/server';
import { proxyJson } from '../../../../lib/api';

export async function GET(req: NextRequest) {
  return proxyJson('/api/my-line-link/status', { method: 'GET', cookieHeader: req.headers.get('cookie') ?? '' });
}
