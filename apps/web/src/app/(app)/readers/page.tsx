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

  // เปลี่ยนแม่แบบที่ใช้อ่านจริงเป็น admin เท่านั้น (แคบกว่าสิทธิ์เข้าหน้านี้) — ส่งลงไปเพื่อ "ไม่ยื่นปุ่มให้"
  // ตั้งแต่แรก ดีกว่าให้กดแล้วเจอ 403 ส่วนการบังคับจริงอยู่ฝั่ง API ไม่ใช่ที่นี่
  return <ReadersClient canSwitchTemplate={user.role === 'admin'} />;
}
