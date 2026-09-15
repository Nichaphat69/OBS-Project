import { NextRequest } from 'next/server';
import { proxyJson } from '../../../../lib/api';

export async function GET(req: NextRequest) {
  return proxyJson('/api/line/known-users', { method: 'GET', cookieHeader: req.headers.get('cookie') ?? '' });
}
