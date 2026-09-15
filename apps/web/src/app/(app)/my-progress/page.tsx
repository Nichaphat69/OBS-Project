import { requireUser } from '../../../lib/session';
import { Card } from '../../../components/ui';
import { TxPageHeader, TxEmptyState } from '../../../components/TxPageHeader';
import MyProgressClient from './MyProgressClient';

export default async function MyProgressPage() {
  const { user } = await requireUser();

  if (user.role !== 'user') {
    return (
      <>
        <TxPageHeader eyebrow="พนักงาน" title="ความคืบหน้าของฉัน" />
        <Card>
          <TxEmptyState label="มีแค่ role พนักงานเท่านั้นที่ดูหน้านี้ได้" />
        </Card>
      </>
    );
  }

  return <MyProgressClient />;
}
