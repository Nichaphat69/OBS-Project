import { NextRequest } from 'next/server';
import { proxyJson } from '../../../../../lib/api';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  return proxyJson(`/api/contracts/${encodeURIComponent(params.id)}/sync-flowaccount`, {
    method: 'POST',
    cookieHeader: req.headers.get('cookie') ?? '',
    body: {},
  });
}
