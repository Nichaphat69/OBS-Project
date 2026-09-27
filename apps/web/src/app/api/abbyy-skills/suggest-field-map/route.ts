import { NextRequest } from 'next/server';
import { proxyJson } from '../../../../lib/api';

/** เดาชื่อฟิลด์จาก Timesheet ตัวอย่าง — ดู POST /suggest-field-map ใน apps/api routes/abbyySkills.ts */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return proxyJson('/api/abbyy-skills/suggest-field-map', {
    method: 'POST',
    cookieHeader: req.headers.get('cookie') ?? '',
    body,
  });
}
