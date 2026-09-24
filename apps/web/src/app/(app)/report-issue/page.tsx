import { requireUser } from '../../../lib/session';
import { Card } from '../../../components/ui';
import { TxPageHeader, TxEmptyState } from '../../../components/TxPageHeader';
import ReportIssueClient from './ReportIssueClient';

/**
 * "แจ้งปัญหา" ฝั่งเว็บของพนักงาน (24 ก.ย. 69 ตามที่ขอ) — คู่ขนานกับที่มีอยู่แล้วผ่าน LINE (พิมพ์คุยกับ
 * บอท) เพิ่มความสามารถแนบรูปได้ ซึ่งทาง LINE ทำไม่ได้ ใช้หมวดปัญหาชุดเดียวกับ LINE
 * (bug/manday/timesheet/suggestion — ดู TICKET_CATEGORIES ใน lineClient.ts) ไม่แยกชุดใหม่
 *
 * จำกัดแค่ role 'user' เท่านั้น (เหมือน /my-line-link) เพราะ SupportTicket ผูกกับ employeeId ตรงๆ —
 * admin/accounting ไม่มี employeeId ของตัวเอง ยังไม่รองรับในรอบนี้
 */
export default async function ReportIssuePage() {
  const { user } = await requireUser();

  if (user.role !== 'user') {
    return (
      <>
        <TxPageHeader eyebrow="บัญชีของฉัน" title="แจ้งปัญหา" />
        <Card>
          <TxEmptyState label="มีแค่ role พนักงานเท่านั้นที่แจ้งปัญหาทางนี้ได้" />
        </Card>
      </>
    );
  }

  if (!user.employeeId) {
    return (
      <>
        <TxPageHeader eyebrow="บัญชีของฉัน" title="แจ้งปัญหา" />
        <Card>
          <TxEmptyState label="บัญชีนี้ยังไม่ได้ผูกกับพนักงานคนไหนเลย — ให้ admin ผูกให้ที่หน้าจัดการระบบก่อน" />
        </Card>
      </>
    );
  }

  return (
    <>
      <TxPageHeader eyebrow="บัญชีของฉัน" title="แจ้งปัญหา" subtitle="พบปัญหาการใช้งาน หรืออยากเสนอแนะอะไร แจ้งได้เลย แนบรูปประกอบได้ด้วย" />
      <ReportIssueClient />
    </>
  );
}
