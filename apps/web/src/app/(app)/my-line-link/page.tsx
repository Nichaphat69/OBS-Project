import { Suspense } from 'react';
import { requireUser } from '../../../lib/session';
import { Card } from '../../../components/ui';
import { TxPageHeader, TxEmptyState } from '../../../components/TxPageHeader';
import MyLineLinkClient from './MyLineLinkClient';

export default async function MyLineLinkPage() {
  const { user } = await requireUser();

  // เดิมมีแค่ role 'user' ผูกไลน์ได้ — 24 ก.ย. 69 เปิดให้ admin/accounting ผูกได้ด้วย (คนละคอลัมน์กัน
  // ในฐานข้อมูล ดู staffLineLinkService.ts) เพื่อให้ระบบรู้ว่า "คนที่แอดไลน์เข้ามาเป็น role อะไร" แล้ว
  // ส่งแจ้งเตือนที่ตรงกับหน้าที่ให้อัตโนมัติ (admin → error/ระบบล่ม, accounting → ขออนุมัติ/ตั๋วแจ้งปัญหา)
  if (user.role === 'user' && !user.employeeId) {
    return (
      <>
        <TxPageHeader eyebrow="บัญชีของฉัน" title="เชื่อมต่อ LINE" />
        <Card>
          <TxEmptyState label="บัญชีนี้ยังไม่ได้ผูกกับพนักงานคนไหนเลย — ให้ admin ผูกให้ที่หน้าจัดการระบบก่อน" />
        </Card>
      </>
    );
  }

  const subtitle =
    user.role === 'user'
      ? 'ผูกบัญชี LINE ส่วนตัวเพื่อรับแจ้งเตือนและแจ้งปัญหาผ่านแชท'
      : user.role === 'admin'
        ? 'ผูกบัญชี LINE ส่วนตัวเพื่อรับแจ้งเตือนเมื่อระบบมีปัญหา/error'
        : 'ผูกบัญชี LINE ส่วนตัวเพื่อรับแจ้งเตือนคำขออนุมัติออก INV/ตั๋วแจ้งปัญหา';

  return (
    <>
      <TxPageHeader eyebrow="บัญชีของฉัน" title="เชื่อมต่อ LINE" subtitle={subtitle} />
      <Suspense fallback={null}>
        <MyLineLinkClient />
      </Suspense>
    </>
  );
}
