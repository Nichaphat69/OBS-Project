import { AppShell } from '../../components/AppShell';
import { requireUser } from '../../lib/session';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireUser();
  return <AppShell user={user}>{children}</AppShell>;
}
