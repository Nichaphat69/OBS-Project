import { NextRequest } from 'next/server';
import { proxyJson } from '../../../../lib/api';

/** ยอดประมาณก่อนยืนยัน — ดู POST /estimate ใน apps/api/src/routes/timesheets.ts */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return proxyJson('/api/timesheets/estimate', {
    method: 'POST',
    cookieHeader: req.headers.get('cookie') ?? '',
    body,
  });
}
