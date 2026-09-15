import { NextRequest } from 'next/server';
import { proxyJson } from '../../../../../lib/api';

export async function POST(req: NextRequest, { params }: { params: { username: string } }) {
  const body = await req.json().catch(() => ({}));
  return proxyJson(`/api/users/${params.username}/reset-password`, { method: 'POST', cookieHeader: req.headers.get('cookie') ?? '', body });
}
