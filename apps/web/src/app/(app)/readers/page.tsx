import { requireUser } from '../../../lib/session';
import { Card } from '../../../components/ui';
import { TxPageHeader, TxEmptyState } from '../../../components/TxPageHeader';
import ReadersClient from './ReadersClient';

export default async function ReadersPage() {
  const { user } = await requireUser();

  // PATCH /api/settings/readers/active ฝั่ง API จำกัด admin/บัญชีอยู่แล้ว — หน้านี้กันให้ตรงกัน
  if (user.role !== 'admin' && user.role !== 'accounting') {
    return (
      <>
        <TxPageHeader eyebrow="อ้างอิง" title="ตัวอ่าน Timesheet" />
        <Card>
          <TxEmptyState label="ต้องเป็น admin หรือแผนกบัญชีเท่านั้นถึงจะเข้าหน้านี้ได้" />
        </Card>
      </>
    );
  }

  return <ReadersClient />;
}
