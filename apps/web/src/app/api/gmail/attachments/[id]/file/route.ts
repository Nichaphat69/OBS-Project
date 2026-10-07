import { NextRequest } from 'next/server';
import { apiBaseUrl } from '../../../../../../lib/api';

/**
 * ไฟล์แนบในกล่องรับเมล (ที่ n8n ส่งมาเก็บไว้ ยังไม่ได้กดอ่าน) — proxy ไบต์ดิบเหมือน /api/ai-reads/[id]/file
 * ให้กดชื่อไฟล์ในแท็บ "ดึงจาก Gmail" เปิดดูในป๊อปอัปได้ก่อนตัดสินใจอ่าน
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const dl = req.nextUrl.searchParams.has('dl') ? '?dl' : '';
  const upstream = await fetch(`${apiBaseUrl()}/api/gmail/attachments/${encodeURIComponent(params.id)}/file${dl}`, {
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
