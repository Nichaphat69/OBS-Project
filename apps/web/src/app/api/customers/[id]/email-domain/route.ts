import { NextRequest } from 'next/server';
import { proxyJson } from '../../../../../lib/api';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  return proxyJson(`/api/customers/${params.id}/email-domain`, { method: 'PATCH', cookieHeader: req.headers.get('cookie') ?? '', body });
}
