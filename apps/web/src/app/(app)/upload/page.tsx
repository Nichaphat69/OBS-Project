import { requireUser } from '../../../lib/session';
import UploadClient from './UploadClient';

/** อ่าน role ฝั่งเซิร์ฟเวอร์แล้วส่งต่อให้คอมโพเนนต์ — พนักงานกับฝั่งที่ทำบิลเห็นหน้านี้คนละแบบ
 * (ดูเหตุผลใน UploadClient.tsx) */
export default async function UploadPage() {
  const { user } = await requireUser();
  return <UploadClient role={user.role} />;
}
