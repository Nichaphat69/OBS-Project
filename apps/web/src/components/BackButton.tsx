'use client';

import { useRouter } from 'next/navigation';
import { Icon } from './Icon';
import { useLang } from '../lib/language';

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
  const { tx } = useLang();
  return (
    <button type="button" className="btn ghost icon" aria-label={tx('ย้อนกลับ')} title={tx('ย้อนกลับ')} onClick={() => router.back()}>
      <Icon name="back" />
    </button>
  );
}
