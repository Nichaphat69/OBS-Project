import { Suspense } from 'react';
import { requireUser } from '../../../lib/session';
import { Card } from '../../../components/ui';
import { TxPageHeader, TxEmptyState } from '../../../components/TxPageHeader';
import MyLineLinkClient from './MyLineLinkClient';

export default async function MyLineLinkPage() {
  const { user } = await requireUser();

  if (user.role !== 'user') {
    return (
      <>
        <TxPageHeader eyebrow="บัญชีของฉัน" title="เชื่อมต่อ LINE" />
        <Card>
          <TxEmptyState label="มีแค่ role พนักงานเท่านั้นที่ผูกไลน์ได้" />
        </Card>
      </>
    );
  }

  if (!user.employeeId) {
    return (
      <>
        <TxPageHeader eyebrow="บัญชีของฉัน" title="เชื่อมต่อ LINE" />
        <Card>
          <TxEmptyState label="บัญชีนี้ยังไม่ได้ผูกกับพนักงานคนไหนเลย — ให้ admin ผูกให้ที่หน้าจัดการระบบก่อน" />
        </Card>
      </>
    );
  }

  return (
    <>
      <TxPageHeader eyebrow="บัญชีของฉัน" title="เชื่อมต่อ LINE" subtitle="ผูกบัญชี LINE ส่วนตัวเพื่อรับแจ้งเตือนและแจ้งปัญหาผ่านแชท" />
      <Suspense fallback={null}>
        <MyLineLinkClient />
      </Suspense>
    </>
  );
}
