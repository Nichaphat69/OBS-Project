import { NextRequest } from 'next/server';
import { proxyJson } from '../../../../lib/api';

export async function PATCH(req: NextRequest, { params }: { params: { username: string } }) {
  const body = await req.json().catch(() => ({}));
  return proxyJson(`/api/users/${params.username}`, { method: 'PATCH', cookieHeader: req.headers.get('cookie') ?? '', body });
}

export async function DELETE(req: NextRequest, { params }: { params: { username: string } }) {
  return proxyJson(`/api/users/${params.username}`, { method: 'DELETE', cookieHeader: req.headers.get('cookie') ?? '' });
}
