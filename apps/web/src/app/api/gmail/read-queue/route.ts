import { NextRequest } from 'next/server';
import { proxyJson } from '../../../../lib/api';

/** ส่งไฟล์ที่ติ๊กไว้เข้าคิวอ่านเบื้องหลัง — ตอบทันทีไม่รอ OCR (ดู POST /api/gmail/read-queue ฝั่ง api) */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return proxyJson('/api/gmail/read-queue', { method: 'POST', cookieHeader: req.headers.get('cookie') ?? '', body });
}
