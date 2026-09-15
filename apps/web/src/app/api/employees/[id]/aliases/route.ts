import { NextRequest } from 'next/server';
import { proxyJson } from '../../../../../lib/api';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  return proxyJson(`/api/employees/${encodeURIComponent(params.id)}/aliases`, { method: 'POST', cookieHeader: req.headers.get('cookie') ?? '', body });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const qs = req.nextUrl.search;
  return proxyJson(`/api/employees/${encodeURIComponent(params.id)}/aliases${qs}`, { method: 'DELETE', cookieHeader: req.headers.get('cookie') ?? '' });
}
