import { NextRequest } from 'next/server';
import { apiBaseUrl } from '../../../../../lib/api';

/**
 * ไฟล์แนบต้นฉบับของรายการที่ AI อ่านไว้ — proxy แบบไบต์ดิบเหมือน /api/timesheets/[id]/file
 *
 * เดิมไม่มีเส้นนี้เลยทั้งที่ฝั่ง apps/api มี `GET /api/ai-reads/:id/file` อยู่แล้ว และหน้า "ดึงจาก Gmail"
 * เรียกไปที่ URL นี้ตรงๆ — Next.js จึงตอบหน้า 404 ของตัวเองกลับมา คนกดดูไฟล์แล้วเจอ "This page could
 * not be found" ในกล่องพรีวิว ซึ่งดูเหมือนไฟล์หาย ทั้งที่ไฟล์อยู่ครบและ API ตอบได้ปกติ
 * (เจอจริง 17 ก.ย. 69 — สังเกตจากหน้า 404 ที่เป็นของ Next.js ไม่ใช่ error รูป JSON ของ API)
 *
 * Content-Type เดาจากนามสกุลไฟล์ฝั่ง apps/api เพราะไฟล์แนบไม่ได้เป็น PDF เสมอไป (มี xlsx/csv ด้วย)
 * จึง relay header ที่ได้มาตรงๆ ไม่ยัด application/pdf ทับเหมือนเส้นของ timesheets
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const dl = req.nextUrl.searchParams.has('dl') ? '?dl' : '';
  const upstream = await fetch(`${apiBaseUrl()}/api/ai-reads/${encodeURIComponent(params.id)}/file${dl}`, {
    headers: { cookie: req.headers.get('cookie') ?? '' },
    cache: 'no-store',
  });

  if (!upstream.ok) {
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
    });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream',
      'content-disposition': upstream.headers.get('content-disposition') ?? 'inline',
      'cache-control': 'no-store',
    },
  });
}
