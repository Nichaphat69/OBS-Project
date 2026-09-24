import { NextRequest } from 'next/server';
import { proxyJson } from '../../../../lib/api';

export async function GET(req: NextRequest) {
  return proxyJson('/api/notification-recipients/staff-line-status', { method: 'GET', cookieHeader: req.headers.get('cookie') ?? '' });
}
