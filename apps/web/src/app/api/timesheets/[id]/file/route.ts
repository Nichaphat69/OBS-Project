import { NextRequest } from 'next/server';
import { apiBaseUrl } from '../../../../../lib/api';

/** ไฟล์ PDF ต้นฉบับ — proxy แบบไบต์ดิบ (ไม่ผ่าน JSON) ต่างจาก proxyJson ที่ใช้กับ route อื่นทั้งหมด
 * เพราะต้อง relay Content-Type/Content-Disposition ให้เบราว์เซอร์เปิดดู/ดาวน์โหลด PDF ได้ตรงๆ */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const dl = req.nextUrl.searchParams.has('dl') ? '?dl' : '';
  const upstream = await fetch(`${apiBaseUrl()}/api/timesheets/${encodeURIComponent(params.id)}/file${dl}`, {
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
      'content-type': upstream.headers.get('content-type') ?? 'application/pdf',
      'content-disposition': upstream.headers.get('content-disposition') ?? 'inline',
      'cache-control': 'no-store',
    },
  });
}
