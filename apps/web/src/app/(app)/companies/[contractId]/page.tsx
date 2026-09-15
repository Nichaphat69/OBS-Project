import { requireUser } from '../../../../lib/session';
import { Card } from '../../../../components/ui';
import { TxPageHeader, TxEmptyState } from '../../../../components/TxPageHeader';
import CompanyDetailClient from './CompanyDetailClient';

export default async function CompanyDetailPage({ params }: { params: { contractId: string } }) {
  const { user } = await requireUser();

  if (user.role !== 'admin' && user.role !== 'executive') {
    return (
      <>
        <TxPageHeader eyebrow="ผู้บริหาร" title="รายละเอียดบริษัท" />
        <Card>
          <TxEmptyState label="ต้องเป็น admin หรือผู้บริหารเท่านั้นถึงจะเข้าหน้านี้ได้" />
        </Card>
      </>
    );
  }

  return <CompanyDetailClient contractId={params.contractId} />;
}
