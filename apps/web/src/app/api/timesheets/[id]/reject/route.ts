import { NextRequest } from 'next/server';
import { proxyJson } from '../../../../../lib/api';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  return proxyJson(`/api/timesheets/${params.id}/reject`, {
    method: 'POST',
    cookieHeader: req.headers.get('cookie') ?? '',
    body,
  });
}
