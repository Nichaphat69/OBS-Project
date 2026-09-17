'use client';

import { useEffect, useState } from 'react';
import type { ReadModelNameMap } from './ui';

/** ดึงสารบัญชื่อ Skill/แม่แบบมาสร้าง `ReadModelNameMap` ให้ `ReadModelTag` ใช้ — เรียกครั้งเดียวตอน
 * mount หน้า แล้วส่งผลลัพธ์ต่อให้ทุก `<ReadModelTag>` ในหน้านั้น ไม่ต้องดึงซ้ำต่อแถว
 *
 * ล้มเหลวได้เงียบๆ ทั้งสอง engine อิสระจากกัน (เช่น Clear Read ยังไม่ได้ตั้งค่าไว้เลย) — หน้าที่เรียก
 * ต้องยังใช้งานได้ปกติ แค่โชว์รหัสดิบต่อไปเหมือนตอนที่ยังไม่มีสารบัญนี้เลย ไม่ใช่ทำให้ทั้งหน้าพัง
 *
 * อยู่แยกไฟล์จาก ui.tsx โดยตั้งใจ: ไฟล์นี้มี 'use client' เพราะเรียก useEffect/useState แต่ ui.tsx
 * ยังต้อง import เข้า Server Component ได้อยู่ (เช่น admin/page.tsx) — ถ้ารวมกลับเข้า ui.tsx จะทำให้
 * ทั้งโมดูลกลายเป็น client-only ไปด้วย และ next build จะพังทั้งก้อน */
export function useReadModelNameMap(): ReadModelNameMap {
  const [map, setMap] = useState<ReadModelNameMap>({});
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next: ReadModelNameMap = {};
      try {
        const skills: Array<{ skillId: string; name: string }> = await fetch('/api/abbyy-skills', { cache: 'no-store' }).then((r) => r.json());
        next.abbyy = Object.fromEntries(skills.map((s) => [s.skillId, s.name]));
      } catch {
        /* เงียบไว้ — ไม่มีสารบัญนี้ก็แค่โชว์รหัสดิบต่อไป ไม่ใช่ทำให้หน้าใช้งานไม่ได้ */
      }
      try {
        const body: { templates?: Array<{ id: string; name: string }> } = await fetch('/api/settings/clear-read/templates', { cache: 'no-store' }).then((r) => r.json());
        next['clear-read'] = Object.fromEntries((body.templates ?? []).map((t) => [t.id, t.name]));
      } catch {
        /* เงียบไว้เหมือนกัน */
      }
      if (!cancelled) setMap(next);
    })();
    return () => { cancelled = true; };
  }, []);
  return map;
}
