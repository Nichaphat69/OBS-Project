import { NextRequest } from 'next/server';
import { proxyJson } from '../../../../../../lib/api';

/** กดยืนยัน/ทำเครื่องหมายว่ามีปัญหา — admin/แผนกบัญชีเท่านั้น (requireAdmin ฝั่ง API) */
export async function PATCH(req: NextRequest, { params }: { params: { employeeId: string; period: string } }) {
  return proxyJson(`/api/timesheet-submissions/${encodeURIComponent(params.employeeId)}/${encodeURIComponent(params.period)}/review`, {
    method: 'PATCH',
    cookieHeader: req.headers.get('cookie') ?? '',
    body: await req.json().catch(() => ({})),
  });
}
