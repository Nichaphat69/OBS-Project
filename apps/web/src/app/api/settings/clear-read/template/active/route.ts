import { NextRequest } from 'next/server';
import { proxyJson } from '../../../../../../lib/api';

/** เปลี่ยนแม่แบบที่ระบบใช้อ่านจริง — admin เท่านั้น (ฝั่ง API บังคับอีกชั้น หน้าเว็บแค่ไม่ยื่นปุ่มให้) */
export async function PATCH(req: NextRequest) {
  return proxyJson('/api/settings/clear-read/template/active', {
    method: 'PATCH',
    cookieHeader: req.headers.get('cookie') ?? '',
    body: await req.json().catch(() => ({})),
  });
}
