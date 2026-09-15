import { NextRequest } from 'next/server';
import { proxyJson } from '../../../../../lib/api';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  return proxyJson(`/api/timesheets/${params.id}/check`, {
    method: 'POST',
    cookieHeader: req.headers.get('cookie') ?? '',
    body: {},
  });
}
