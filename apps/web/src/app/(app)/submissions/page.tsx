import { requireUser } from '../../../lib/session';
import { Card } from '../../../components/ui';
import { TxPageHeader, TxEmptyState } from '../../../components/TxPageHeader';
import SubmissionsClient from './SubmissionsClient';
import MySubmissionsClient from './MySubmissionsClient';

/**
 * "บันทึกการส่ง" — มาแทนหน้า "แจ้งปัญหา" เดิมในตำแหน่งเมนูเดียวกัน โดยแจ้งปัญหากลายเป็นแท็บข้างใน
 *
 * ต่างจากหน้าอื่นตรงที่ **พนักงานเข้าได้ด้วย** แต่เห็นเฉพาะของตัวเอง — การกัน "เห็นของคนอื่น" อยู่ที่
 * API (เส้น /mine ผูก employeeId จาก session ไม่รับจาก query) ไม่ใช่ที่การซ่อน UI ตรงนี้ ที่นี่แค่
 * บอกคอมโพเนนต์ว่ากำลังแสดงให้ใครดู เพื่อไม่ยื่นแท็บ/คอลัมน์ที่ role นั้นใช้ไม่ได้ให้เปล่าๆ
 */
export default async function SubmissionsPage() {
  const { user } = await requireUser();

  // executive เป็น role ดูภาพรวมข้ามบริษัทอย่างเดียว ไม่มีหน้าที่ตามการส่งรายคน
  if (user.role === 'executive') {
    return (
      <>
        <TxPageHeader eyebrow="อ้างอิง" title="บันทึกการส่ง" />
        <Card>
          <TxEmptyState label="ต้องเป็น admin แผนกบัญชี หรือพนักงานเท่านั้นถึงจะเข้าหน้านี้ได้" />
        </Card>
      </>
    );
  }

  // พนักงานเห็นหน้าสั้นๆ ของตัวเองเท่านั้น ไม่ใช่ภาพรวมแบบ admin/บัญชี
  if (user.role === 'user') return <MySubmissionsClient />;

  return <SubmissionsClient role={user.role} />;
}
