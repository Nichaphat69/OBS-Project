import { NextRequest } from 'next/server';
import { proxyJson } from '../../../../../lib/api';

/** พนักงานแจ้งว่ารอบนี้ส่งทางอีเมลแล้ว/ให้ผู้ดูแลเป็นคนส่ง — ฝั่ง API ยึด employeeId จาก session อย่างเดียว
 * (ดู POST /mine/method ใน apps/api/src/routes/timesheetSubmissions.ts) */
export async function POST(req: NextRequest) {
  return proxyJson('/api/timesheet-submissions/mine/method', {
    method: 'POST',
    cookieHeader: req.headers.get('cookie') ?? '',
    body: await req.json(),
  });
}
