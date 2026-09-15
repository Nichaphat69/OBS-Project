import { requireUser } from '../../../lib/session';
import { Card } from '../../../components/ui';
import { TxPageHeader, TxEmptyState } from '../../../components/TxPageHeader';
import ExecOverviewClient from './ExecOverviewClient';

export default async function CompaniesPage() {
  const { user } = await requireUser();

  if (user.role !== 'executive') {
    return (
      <>
        <TxPageHeader eyebrow="ผู้บริหาร" title="ภาพรวมทุกบริษัท" />
        <Card>
          <TxEmptyState label="ต้องเป็นผู้บริหารเท่านั้นถึงจะเข้าหน้านี้ได้" />
        </Card>
      </>
    );
  }

  return <ExecOverviewClient />;
}
