import { requireUser } from '../../../lib/session';
import { Card } from '../../../components/ui';
import { TxPageHeader, TxEmptyState } from '../../../components/TxPageHeader';
import MasterDataClient from './MasterDataClient';

export default async function MasterDataPage() {
  const { user } = await requireUser();

  if (user.role !== 'admin' && user.role !== 'accounting') {
    return (
      <>
        <TxPageHeader eyebrow="อ้างอิง" title="ข้อมูลหลัก" />
        <Card>
          <TxEmptyState label="ต้องเป็น admin หรือแผนกบัญชีเท่านั้นถึงจะเข้าหน้านี้ได้" />
        </Card>
      </>
    );
  }

  return <MasterDataClient />;
}
