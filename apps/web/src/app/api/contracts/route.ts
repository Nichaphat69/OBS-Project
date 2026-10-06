import { NextRequest } from 'next/server';
import { proxyJson } from '../../../lib/api';

export async function GET(req: NextRequest) {
  // ส่ง query ต่อด้วย (เช่น scoped=1 ของแท็บ "สัญญาบริษัท") — เดิมทิ้ง จึงได้รายการเต็มเสมอ (6 ต.ค. 69)
  const qs = req.nextUrl.search;
  return proxyJson(`/api/contracts${qs}`, { method: 'GET', cookieHeader: req.headers.get('cookie') ?? '' });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return proxyJson('/api/contracts', { method: 'POST', cookieHeader: req.headers.get('cookie') ?? '', body });
}
