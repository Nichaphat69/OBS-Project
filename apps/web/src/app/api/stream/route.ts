import { NextRequest } from 'next/server';
import { apiBaseUrl } from '../../../lib/api';

/**
 * SSE ("มีอะไรเปลี่ยนแล้ว") ผ่านเว็บ origin เดียวกัน — ป้ายตัวเลขเมนู/ฟีดแจ้งเตือน/คิวอ่านอัปเดตทันทีโดยไม่ต้องรีเฟรช
 *
 * เดิม AppShell ต่อตรงไปที่ `http(s)://โฮสต์:4301` แต่พอร์ต 4301 ปิดจากภายนอก (ผูก 127.0.0.1 / security group) บน UAT และ dev
 * EventSource จึงต่อไม่ติดเงียบๆ ทุกอย่างเลยอัปเดตได้แค่ตอนโพลทุก 60 วินาทีหรือรีเฟรชหน้า (HistoryTab/QueueStatusCard เรียก
 * `/api/stream` ที่ไม่มีอยู่จริงอยู่แล้ว ได้ 404) — ที่นี่พร็อกซี stream ของ apps/api แบบไม่ buffer
 *
 * ต้องส่ง body ของ upstream ต่อเป็นสตรีมตรงๆ (ห้ามอ่านจนจบแบบ proxyJson ที่เรียก .text() ซึ่งรอ stream ที่ไม่มีวันจบ)
 * `no-transform` กันไม่ให้ Next บีบอัด (gzip) แล้ว buffer · `x-accel-buffering: no` บอก nginx หน้าเว็บไม่ให้ buffer
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const upstream = await fetch(`${apiBaseUrl()}/api/stream`, {
    headers: { cookie: req.headers.get('cookie') ?? '', accept: 'text/event-stream' },
    cache: 'no-store',
    signal: req.signal, // ผู้ใช้ปิดแท็บ/เปลี่ยนหน้า → ตัดสายขึ้นไป apps/api ด้วย ไม่ปล่อยค้าง
  });
  if (!upstream.ok || !upstream.body) {
    return new Response(await upstream.text().catch(() => ''), {
      status: upstream.status || 502,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
    });
  }
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-store, no-transform, must-revalidate',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
}
