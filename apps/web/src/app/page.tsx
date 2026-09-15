import { redirect } from 'next/navigation';
import { requireUser } from '../lib/session';

/** หน้าเริ่มต้นตาม role — ported from app.js DEFAULT_VIEW (admin/accounting → dash,
 * user → myProgress, executive → execOverview) */
export default async function RootPage() {
  const { user } = await requireUser();
  if (user.role === 'user') redirect('/my-progress');
  if (user.role === 'executive') redirect('/companies');
  redirect('/dashboard');
}
