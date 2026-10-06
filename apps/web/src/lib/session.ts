import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { apiBaseUrl, SESSION_COOKIE } from './api';

export interface SessionUser {
  username: string;
  nameTh: string;
  role: string;
  employeeId: string | null;
}

/** ชื่อ cookie ตัวกรอง PO — ต้องตรงกับ SCOPE_COOKIE ใน lib/scope.tsx (ไฟล์นั้นเป็น client component จึงอ้างข้ามมาไม่ได้) */
const SCOPE_COOKIE = 'obs_scope';

/** Server-side helper shared by every protected page — redirects to /login if not signed in. */
export async function requireUser(): Promise<{ user: SessionUser; cookieHeader: string }> {
  const cookieStore = cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) redirect('/login');
  // ส่ง cookie ตัวกรอง PO (obs_scope) ต่อไปให้ API ด้วย — เดิมส่งแค่ cookie login ทำให้หน้าที่เรนเดอร์ฝั่งเซิร์ฟเวอร์ (แดชบอร์ด) ไม่เคยรู้ว่า
  // ผู้ใช้เลือก PO ไหน ได้สัญญาค่าเริ่มต้นเสมอไม่ว่าจะเลือกอะไร (บั๊ก 6 ต.ค. 69) · cookies().get() คืนค่าที่ถอดรหัสแล้ว จึงต้อง
  // encode กลับก่อนใส่ header (ค่าเป็น JSON มีเครื่องหมายคำพูด/จุลภาคที่ใส่ใน header ตรงๆ ไม่ได้)
  const scope = cookieStore.get(SCOPE_COOKIE)?.value;
  const cookieHeader = scope
    ? `${SESSION_COOKIE}=${token}; ${SCOPE_COOKIE}=${encodeURIComponent(scope)}`
    : `${SESSION_COOKIE}=${token}`;

  const res = await fetch(`${apiBaseUrl()}/api/auth/me`, {
    headers: { cookie: cookieHeader },
    cache: 'no-store',
  });
  if (!res.ok) redirect('/login');
  const data = await res.json();
  if (!data.user) redirect('/login');
  return { user: data.user, cookieHeader };
}
