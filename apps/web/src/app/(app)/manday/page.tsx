import { requireUser } from '../../../lib/session';
import { Card } from '../../../components/ui';
import { TxPageHeader, TxEmptyState } from '../../../components/TxPageHeader';
import MandayClient from './MandayClient';

/**
 * เดิมหน้านี้เป็น client component ล้วน ไม่มีอะไรกันที่ตัวหน้าเลย — พนักงานพิมพ์ URL ตรงๆ เข้ามาได้
 * แล้วเจอหน้าเปล่า/error เพราะ API ปฏิเสธทุกคำขอ (ข้อมูลไม่เคยรั่ว แต่ดูเหมือนระบบพัง)
 *
 * แยกเป็น server wrapper + client child แบบเดียวกับหน้า "ข้อมูลหลัก"/"ตัวอ่าน Timesheet" เพื่อบอก
 * ตรงๆ ว่าไม่มีสิทธิ์ แทนที่จะปล่อยให้เข้ามาเจอหน้าที่ใช้อะไรไม่ได้ (เจ้าของระบบสั่ง 18 ก.ย. 69)
 * ด่านจริงยังอยู่ฝั่ง API เหมือนเดิม ตรงนี้เป็นเรื่องความเรียบร้อยของหน้าจอ ไม่ใช่ตัวกันความปลอดภัย
 */
export default async function MandayPage() {
  const { user } = await requireUser();

  if (user.role !== 'admin' && user.role !== 'accounting') {
    return (
      <>
        <TxPageHeader eyebrow="ขั้นตอน 2" title="ตรวจ Manday" />
        <Card>
          <TxEmptyState label="ต้องเป็น admin หรือแผนกบัญชีเท่านั้นถึงจะเข้าหน้านี้ได้" />
        </Card>
      </>
    );
  }

  return <MandayClient />;
}
