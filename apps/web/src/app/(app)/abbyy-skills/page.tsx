import { requireUser } from '../../../lib/session';
import { Card } from '../../../components/ui';
import { TxPageHeader, TxEmptyState } from '../../../components/TxPageHeader';
import AbbyySkillsClient from './AbbyySkillsClient';

export default async function AbbyySkillsPage() {
  const { user } = await requireUser();

  if (user.role !== 'admin') {
    return (
      <>
        <TxPageHeader eyebrow="ผู้ดูแลระบบ" title="Skill ABBYY" />
        <Card>
          <TxEmptyState label="ต้องเป็น admin เท่านั้นถึงจะเข้าหน้านี้ได้" />
        </Card>
      </>
    );
  }

  return (
    <>
      <TxPageHeader eyebrow="ผู้ดูแลระบบ" title="Skill ABBYY" subtitle="สารบัญ Skill ABBYY Vantage ที่เทรนไว้แล้ว — ตั้งชื่อให้จำง่ายแล้วนำ Skill ID ไปเลือกตอนแก้ไขสัญญา" />
      <AbbyySkillsClient />
    </>
  );
}
