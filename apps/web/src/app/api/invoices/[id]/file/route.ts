import { NextRequest } from 'next/server';
import { apiBaseUrl } from '../../../../../lib/api';

/**
 * ไฟล์ PDF ใบแจ้งหนี้ (cache ไว้จาก FlowAccount ตอนอนุมัติ) — proxy แบบไบต์ดิบ
 *
 * ขาดหายด้วยเหตุผลเดียวกับ /api/ai-reads/[id]/file: ฝั่ง apps/api มี `GET /api/invoices/:id/file`
 * อยู่แล้ว และหน้า "วางบิล & ร่างอีเมล" เรียกไปที่ URL นี้ตรงๆ (ปุ่มดูไฟล์แนบใบวางบิล) แต่ฝั่ง
 * Next.js ไม่มี route มารับ จึงตอบหน้า 404 ของตัวเองกลับไป ดูเหมือนไฟล์หายทั้งที่ไฟล์อยู่ครบ
 *
 * ยังไม่มีใครรายงานอาการนี้ — เจอตอนไล่เทียบว่า route ไฟล์ฝั่ง apps/api ตัวไหนมี proxy ครบแล้วบ้าง
 * หลังแก้เส้นของ ai-reads (17 ก.ย. 69)
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const dl = req.nextUrl.searchParams.has('dl') ? '?dl' : '';
  const upstream = await fetch(`${apiBaseUrl()}/api/invoices/${encodeURIComponent(params.id)}/file${dl}`, {
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
      'content-type': upstream.headers.get('content-type') ?? 'application/pdf',
      'content-disposition': upstream.headers.get('content-disposition') ?? 'inline',
      'cache-control': 'no-store',
    },
  });
}
