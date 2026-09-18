import { NextRequest } from 'next/server';
import { proxyJson } from '../../../../../lib/api';

/** พนักงานส่งไฟล์ Timesheet ของตัวเอง — ฝั่ง API ยึด employeeId จาก session อย่างเดียว ส่ง employeeId
 * แนบมาใน body ก็ไม่มีผล (ดู POST /mine/upload ใน apps/api/src/routes/timesheetSubmissions.ts) */
export async function POST(req: NextRequest) {
  return proxyJson('/api/timesheet-submissions/mine/upload', {
    method: 'POST',
    cookieHeader: req.headers.get('cookie') ?? '',
    body: await req.json(),
  });
}
