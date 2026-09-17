import { NextRequest } from 'next/server';
import { proxyJson } from '../../../../../lib/api';

export async function GET(req: NextRequest) {
  // ส่งต่อเฉพาะสองตัวที่เส้นนี้รู้จัก ไม่ยกทั้ง query string มา
  // `id` = แม่แบบที่กำลังเปิดดู (ไม่ส่ง = ตัวที่ระบบใช้อ่านจริง) · `refresh=1` = ข้าม cache 5 นาที
  const q = new URLSearchParams();
  const id = req.nextUrl.searchParams.get('id');
  if (id) q.set('id', id);
  if (req.nextUrl.searchParams.get('refresh') === '1') q.set('refresh', '1');
  const qs = q.toString();

  return proxyJson(`/api/settings/clear-read/template${qs ? `?${qs}` : ''}`, {
    method: 'GET',
    cookieHeader: req.headers.get('cookie') ?? '',
  });
}
