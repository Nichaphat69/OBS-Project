import { redirect } from 'next/navigation';
import { apiBaseUrl } from '../../../lib/api';
import { requireUser } from '../../../lib/session';
import DashboardClient from './DashboardClient';

/** ported from app.js ALLOWED_VIEWS — role 'user'/'executive' ไม่มีสิทธิ์ดูหน้านี้ (มีหน้าเริ่มต้น
 * ของตัวเองแยกต่างหาก) กันไว้เผื่อพิมพ์ URL ตรงๆ ไม่ผ่านเมนู */
export default async function DashboardPage() {
  const { user, cookieHeader } = await requireUser();
  if (user.role === 'user') redirect('/my-progress');
  if (user.role === 'executive') redirect('/companies');

  const activeRes = await fetch(`${apiBaseUrl()}/api/contracts/active`, {
    headers: { cookie: cookieHeader },
    cache: 'no-store',
  });
  // เรียก /api/dashboard ไม่ได้บริษัทที่ active ก็ยังโหลดหน้าต่อได้ (แค่ไม่กรองตามบริษัท) — ผิดจาก
  // /api/dashboard เองที่ถ้าพังจริงๆ ควรโยน error ให้ Next แสดงหน้า error แทนที่จะส่ง data พังๆ ต่อให้
  // DashboardClient ซึ่งไม่ได้ออกแบบมารับมือกับ shape ที่ไม่ครบ
  const active: { id: string } | null = activeRes.ok ? await activeRes.json() : null;
  const qs = active ? `?contractId=${encodeURIComponent(active.id)}` : '';

  const res = await fetch(`${apiBaseUrl()}/api/dashboard${qs}`, {
    headers: { cookie: cookieHeader },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error('โหลดข้อมูลแดชบอร์ดไม่สำเร็จ');
  const data = await res.json();

  return <DashboardClient data={data} nameTh={user.nameTh} />;
}
