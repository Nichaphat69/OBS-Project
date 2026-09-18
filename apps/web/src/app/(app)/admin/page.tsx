import { requireUser } from '../../../lib/session';
import { Card } from '../../../components/ui';
import { TxPageHeader, TxEmptyState } from '../../../components/TxPageHeader';
import AdminTabs from './AdminTabs';

export default async function AdminPage() {
  const { user } = await requireUser();

  if (user.role !== 'admin') {
    return (
      <>
        <TxPageHeader eyebrow="ผู้ดูแลระบบ" title="จัดการระบบ" />
        <Card>
          <TxEmptyState label="ต้องเป็น admin เท่านั้นถึงจะเข้าหน้านี้ได้" />
        </Card>
      </>
    );
  }

  return (
    <>
      <TxPageHeader eyebrow="ผู้ดูแลระบบ" title="จัดการระบบ" />
      <AdminTabs currentUsername={user.username} />
    </>
  );
}
