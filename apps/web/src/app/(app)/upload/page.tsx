import { requireUser } from '../../../lib/session';
import { Card } from '../../../components/ui';
import { TxPageHeader, TxEmptyState } from '../../../components/TxPageHeader';
import UploadClient from './UploadClient';

/** อ่าน role ฝั่งเซิร์ฟเวอร์แล้วส่งต่อให้คอมโพเนนต์ — พนักงานกับฝั่งที่ทำบิลเห็นหน้านี้คนละแบบ
 * (ดูเหตุผลใน UploadClient.tsx)
 *
 * role 'executive' ไม่มีเมนูนี้ แต่เดิมพิมพ์ /upload ตรงๆ แล้วเห็นหน้าเต็มรวมถึงแท็บ "ดึงจาก Gmail" (API ปฏิเสธทุกคำขอ
 * ข้อมูลไม่รั่ว แต่หน้าจอโชว์ของที่ใช้ไม่ได้ — QA GMAILBOX-012, 1 ต.ค. 69) จึงกันที่ตัวหน้าเหมือนหน้าออก INV:
 * ด่านจริงยังอยู่ฝั่ง API ตรงนี้เป็นเรื่องความเรียบร้อยของหน้าจอ */
export default async function UploadPage() {
  const { user } = await requireUser();

  if (user.role !== 'admin' && user.role !== 'accounting' && user.role !== 'user') {
    return (
      <>
        <TxPageHeader eyebrow="ขั้นตอน 1" title="อัปโหลด Timesheet" />
        <Card>
          <TxEmptyState label="หน้านี้สำหรับ admin แผนกบัญชี และพนักงานเท่านั้น" />
        </Card>
      </>
    );
  }

  return <UploadClient role={user.role} />;
}
