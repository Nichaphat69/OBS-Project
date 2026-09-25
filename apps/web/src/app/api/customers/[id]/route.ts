import { NextRequest } from 'next/server';
import { proxyJson } from '../../../../lib/api';

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  return proxyJson(`/api/customers/${encodeURIComponent(params.id)}`, { method: 'DELETE', cookieHeader: req.headers.get('cookie') ?? '' });
}
