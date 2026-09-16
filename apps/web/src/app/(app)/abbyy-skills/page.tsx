import { redirect } from 'next/navigation';

/** ย้ายการจัดการ Skill ไปอยู่ในหน้า "ตัวอ่าน Timesheet" แล้ว (ใต้การ์ด ABBYY) และเอาเมนูนี้ออกจากแถบ
 * ข้างแล้ว — คง route ไว้เป็นทางเปลี่ยนเส้นทาง เผื่อใครเคยบุ๊กมาร์กหรือมีลิงก์เก่าค้างอยู่ จะได้ไปถึง
 * ที่ที่ใช้งานได้จริงแทนที่จะเจอ 404 */
export default function AbbyySkillsPage() {
  redirect('/readers');
}
