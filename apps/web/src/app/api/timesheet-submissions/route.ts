import { NextRequest } from 'next/server';
import { proxyJson } from '../../../lib/api';

/** ภาพรวมทุกคน — ฝั่ง API บังคับ admin/แผนกบัญชีอีกชั้น (requireAdmin) หน้าเว็บแค่ไม่ยื่นให้ role อื่นเรียก */
export async function GET(req: NextRequest) {
  const qs = req.nextUrl.search;
  return proxyJson(`/api/timesheet-submissions${qs}`, {
    method: 'GET',
    cookieHeader: req.headers.get('cookie') ?? '',
  });
}
