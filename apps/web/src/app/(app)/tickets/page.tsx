import { requireUser } from '../../../lib/session';
import { Card } from '../../../components/ui';
import { TxPageHeader, TxEmptyState } from '../../../components/TxPageHeader';
import TicketsClient from './TicketsClient';

export default async function TicketsPage() {
  const { user } = await requireUser();

  if (user.role !== 'admin') {
    return (
      <>
        <TxPageHeader eyebrow="การแจ้งปัญหา" title="แจ้งปัญหา" />
        <Card>
          <TxEmptyState label="ต้องเป็น admin เท่านั้นถึงจะเข้าหน้านี้ได้" />
        </Card>
      </>
    );
  }

  return (
    <>
      <TxPageHeader eyebrow="การแจ้งปัญหา" title="แจ้งปัญหา" subtitle="ตั๋วที่พนักงานแจ้งเข้ามาผ่าน LINE" />
      <TicketsClient />
    </>
  );
}
