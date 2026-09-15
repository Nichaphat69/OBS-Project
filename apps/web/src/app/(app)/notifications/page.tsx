import { requireUser } from '../../../lib/session';
import NotificationsClient from './NotificationsClient';

export default async function NotificationsPage() {
  const { user } = await requireUser();
  return <NotificationsClient role={user.role} />;
}
