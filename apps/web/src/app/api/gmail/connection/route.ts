import { NextRequest } from 'next/server';
import { proxyJson } from '../../../../lib/api';

export async function GET(req: NextRequest) {
  return proxyJson('/api/gmail/connection', { method: 'GET', cookieHeader: req.headers.get('cookie') ?? '' });
}
