'use client';

import { PageHeader, EmptyState } from './ui';
import { useLang } from '../lib/language';

/** เวอร์ชันแปลภาษาได้ของ PageHeader — ใช้ในหน้าที่ตัว page.tsx เป็น server component (เรียก tx()
 * ตรงๆไม่ได้ ต้องมี client boundary) แต่เนื้อหาส่วนที่เหลือของหน้ายังอยู่ใน *Client.tsx ของตัวเอง
 * ไม่อยากย้าย PageHeader ทั้งก้อนเข้าไปซ้ำในทุกไฟล์ จึงแยกเป็นคอมโพเนนต์เล็กๆนี้แทน */
export function TxPageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  const { tx } = useLang();
  return <PageHeader eyebrow={tx(eyebrow)} title={tx(title)} subtitle={subtitle ? tx(subtitle) : undefined} actions={actions} />;
}

/** เวอร์ชันแปลภาษาได้ของ EmptyState — เหตุผลเดียวกับ TxPageHeader ด้านบน */
export function TxEmptyState({ label }: { label: string }) {
  const { tx } = useLang();
  return <EmptyState label={tx(label)} />;
}
