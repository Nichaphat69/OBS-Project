import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { requireUser } from '../../../lib/session';
import { TxPageHeader } from '../../../components/TxPageHeader';
import GmailLinkClient from './GmailLinkClient';

/**
 * หน้าเชื่อมกล่อง Gmail ที่ระบบใช้ดึงอีเมล Timesheet
 *
 * เปิดให้ **admin กับแผนกบัญชี** — ตั้งใจไม่จำกัดแค่ admin เพราะคนที่ต้องกดยินยอมคือเจ้าของกล่องเมล
 * ซึ่งอยู่ฝั่งบัญชี ถ้าล็อกไว้แค่ admin จะกลายเป็นว่าผูกกล่องของฝ่ายบัญชีไม่ได้เลย
 * (ฝั่ง API กันซ้ำอีกชั้นด้วย requireAdmin ใน routes/gmail.ts — ตรงนี้แค่ซ่อนหน้าไม่ให้กดเข้ามาเปล่าๆ)
 */
export default async function GmailLinkPage() {
  const { user } = await requireUser();
  if (user.role !== 'admin' && user.role !== 'accounting') redirect('/');

  return (
    <>
      <TxPageHeader
        eyebrow="การเชื่อมต่อ"
        title="เชื่อมต่อ Gmail"
        subtitle="อนุญาตให้ระบบอ่านอีเมล Timesheet จากกล่องที่ลูกค้าส่งมา"
      />
      <Suspense fallback={null}>
        <GmailLinkClient />
      </Suspense>
    </>
  );
}
