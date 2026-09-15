import { NextRequest } from 'next/server';
import { proxyJson } from '../../../../lib/api';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  return proxyJson(`/api/assignments/${encodeURIComponent(params.id)}`, { method: 'PATCH', cookieHeader: req.headers.get('cookie') ?? '', body });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  return proxyJson(`/api/assignments/${encodeURIComponent(params.id)}`, { method: 'DELETE', cookieHeader: req.headers.get('cookie') ?? '' });
}
