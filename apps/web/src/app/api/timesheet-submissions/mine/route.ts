import { NextRequest } from 'next/server';
import { proxyJson } from '../../../../lib/api';

/** ของพนักงานคนที่ล็อกอินอยู่เท่านั้น — ฝั่ง API ผูก employeeId จาก session ไม่รับจาก query เลย
 * แม้แต่บรรทัดเดียว ส่ง employeeId มาที่นี่ก็ไม่มีผล */
export async function GET(req: NextRequest) {
  const qs = req.nextUrl.search;
  return proxyJson(`/api/timesheet-submissions/mine${qs}`, {
    method: 'GET',
    cookieHeader: req.headers.get('cookie') ?? '',
  });
}
