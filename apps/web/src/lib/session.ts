import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { apiBaseUrl, SESSION_COOKIE } from './api';

export interface SessionUser {
  username: string;
  nameTh: string;
  role: string;
  employeeId: string | null;
}

/** Server-side helper shared by every protected page — redirects to /login if not signed in. */
export async function requireUser(): Promise<{ user: SessionUser; cookieHeader: string }> {
  const cookieStore = cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) redirect('/login');
  const cookieHeader = `${SESSION_COOKIE}=${token}`;

  const res = await fetch(`${apiBaseUrl()}/api/auth/me`, {
    headers: { cookie: cookieHeader },
    cache: 'no-store',
  });
  if (!res.ok) redirect('/login');
  const data = await res.json();
  if (!data.user) redirect('/login');
  return { user: data.user, cookieHeader };
}
