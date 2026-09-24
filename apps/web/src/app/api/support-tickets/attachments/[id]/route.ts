import { NextRequest } from 'next/server';
import { apiBaseUrl } from '../../../../../lib/api';

/** รูปแนบตั๋วแจ้งปัญหา — proxy แบบไบต์ดิบเหมือน timesheets/[id]/file/route.ts เพราะต้อง relay
 * Content-Type จริงให้ <img> แสดงผลได้ตรงๆ ไม่ผ่าน JSON */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const upstream = await fetch(`${apiBaseUrl()}/api/support-tickets/attachments/${encodeURIComponent(params.id)}`, {
    headers: { cookie: req.headers.get('cookie') ?? '' },
    cache: 'no-store',
  });

  if (!upstream.ok) {
    const text = await upstream.text();
    return new Response(text, { status: upstream.status, headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' } });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream',
      'cache-control': 'no-store',
    },
  });
}
