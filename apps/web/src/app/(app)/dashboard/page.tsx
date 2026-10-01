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

  // ขอบเขต (site · PO · พนักงาน) ไม่ได้แนบเป็น query — อยู่ใน cookie obs_scope ที่แนบไปกับ cookieHeader แล้ว
  // เซิร์ฟเวอร์อ่านเองและตั้งค่าเริ่มต้นให้ (ไม่เลือกอะไร = สัญญาที่กำลังดำเนินการอยู่ ไม่ใช่ทุกบริษัท) ถ้า
  // /api/dashboard พังจริงๆ ให้โยน error ให้ Next แสดงหน้า error แทนที่จะส่ง data พังๆ ต่อให้ DashboardClient
  const res = await fetch(`${apiBaseUrl()}/api/dashboard`, {
    headers: { cookie: cookieHeader },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error('โหลดข้อมูลแดชบอร์ดไม่สำเร็จ');
  const data = await res.json();

  return <DashboardClient data={data} nameTh={user.nameTh} />;
}
