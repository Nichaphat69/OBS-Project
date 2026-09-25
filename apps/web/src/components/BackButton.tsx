'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Icon } from './Icon';
import { useLang } from '../lib/language';
import { TOP_LEVEL_HREFS } from '../lib/nav';

/**
 * ปุ่มย้อนกลับที่มุมขวาบนของทุกหน้า (เจ้าของระบบสั่ง 24 ก.ย. 69) — เรียก `router.back()` (history
 * ของเบราว์เซอร์) ไม่ใช่ลิงก์ไปหน้าคงที่ เพราะแต่ละหน้าถูกเข้าถึงได้จากหลายจุดในระบบ (เช่น "ประวัติ"
 * เข้าได้ทั้งจากแท็บอัปโหลดและจากเมนูข้าง) ไม่มี "หน้าก่อนหน้า" ตายตัวหนึ่งเดียวให้ผูกไว้ตรงๆ
 *
 * แยกเป็นไฟล์ client component ของตัวเอง (เหมือน readModelNames.ts) เพราะ `PageHeader` ใน ui.tsx
 * ต้อง import เข้า Server Component ได้อยู่ — การเรียก useRouter ต้องอยู่ในไฟล์ 'use client' แยกต่างหาก
 * ถ้าใส่ตรงๆ ใน ui.tsx จะทำให้ทั้งโมดูลกลายเป็น client-only ไปด้วย
 */
export function BackButton() {
  const router = useRouter();
  const pathname = usePathname();
  const { tx } = useLang();
  // หน้าแรกของแต่ละเมนูในแถบด้านซ้ายไม่ต้องมีปุ่มนี้ — กดย้อนกลับจากหน้าบนสุดไม่มีความหมาย แถบเมนู
  // ทำหน้าที่พาไปไหนต่อได้อยู่แล้ว (เจ้าของระบบสั่ง 25 ก.ย. 69) หน้าลูกที่ลึกเข้าไปยังมีปุ่มตามเดิม
  if (pathname && TOP_LEVEL_HREFS.has(pathname)) return null;
  return (
    <button type="button" className="btn ghost icon" aria-label={tx('ย้อนกลับ')} title={tx('ย้อนกลับ')} onClick={() => router.back()}>
      <Icon name="back" />
    </button>
  );
}
