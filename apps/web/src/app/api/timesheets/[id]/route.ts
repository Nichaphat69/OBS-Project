import { NextRequest } from 'next/server';
import { proxyJson } from '../../../../lib/api';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  return proxyJson(`/api/timesheets/${params.id}`, {
    method: 'GET',
    cookieHeader: req.headers.get('cookie') ?? '',
  });
}
