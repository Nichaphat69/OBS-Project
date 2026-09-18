import { NextRequest } from 'next/server';
import { proxyJson } from '../../../../../lib/api';

/** ปุ่ม "คำนวณใหม่" ในหน้าตรวจ Manday ยิงมาที่เส้นนี้มาตั้งแต่แรก แต่ไม่เคยมี proxy ตัวนี้อยู่จริง
 * (และฝั่ง Express ก็ไม่มี route ด้วย) — กดแล้วได้ 404 เงียบๆ เพิ่มพร้อมกันทั้งสองชั้น 18 ก.ย. 69 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  return proxyJson(`/api/timesheets/${params.id}/recompute`, {
    method: 'POST',
    cookieHeader: req.headers.get('cookie') ?? '',
    body: {},
  });
}
