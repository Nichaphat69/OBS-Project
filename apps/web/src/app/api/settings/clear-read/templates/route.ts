import { NextRequest } from 'next/server';
import { proxyJson } from '../../../../../lib/api';

export async function GET(req: NextRequest) {
  const refresh = req.nextUrl.searchParams.get('refresh') === '1' ? '?refresh=1' : '';
  return proxyJson(`/api/settings/clear-read/templates${refresh}`, {
    method: 'GET',
    cookieHeader: req.headers.get('cookie') ?? '',
  });
}
