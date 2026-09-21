'use client';

import { useState } from 'react';
import { PageHeader, TabStrip } from '../../../components/ui';
import UploadFileTab from './UploadFileTab';
import ManualEntryTab from './ManualEntryTab';
import GmailTab from './GmailTab';
import HistoryTab from './HistoryTab';
import { useLang } from '../../../lib/language';

const TABS = [
  { key: 'upload', label: 'อัปโหลดไฟล์' },
  { key: 'gmail', label: 'ดึงจาก Gmail' },
  { key: 'manual', label: 'กรอกเอง' },
  { key: 'history', label: 'ประวัติ' },
] as const;

/**
 * หน้าอัปโหลด Timesheet — หน้าตาต่างกันคนละเรื่องระหว่างพนักงานกับฝั่งที่ทำบิล
 *
 * พนักงาน (role `user`) มีหน้าที่เดียวคือ **ส่งไฟล์ Timesheet ของตัวเองเข้ามา** ไม่ได้มีหน้าที่อ่านไฟล์
 * ด้วย OCR, ดึงเมลจากกล่องกลาง, กรอกแทนคนอื่น หรือดูประวัติการอ่านทั้งระบบ — สามแท็บนั้นกับตัวเลือก
 * เครื่องอ่าน/Skill จึงไม่ใช่แค่ "ไม่มีสิทธิ์" แต่ไม่เกี่ยวกับงานเขาเลย (เจ้าของระบบสั่ง 18 ก.ย. 69)
 *
 * การกันจริงอยู่ที่ฝั่ง API เหมือนทุกหน้าในระบบนี้ ตรงนี้แค่ไม่ยื่นของที่ role นั้นใช้ไม่ได้ให้เปล่าๆ
 */
export default function UploadClient({ role }: { role: string }) {
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('upload');
  const { tx } = useLang();
  const isEmployee = role === 'user';

  if (isEmployee) {
    return (
      <>
        <PageHeader eyebrow={tx('ขั้นตอน 1 · ส่ง Timesheet')} title={tx('ส่ง Timesheet')} />
        <UploadFileTab submitOnly />
      </>
    );
  }

  return (
    <>
      <PageHeader eyebrow={tx('ขั้นตอน 1 · อัปโหลด Timesheet')} title={tx('อัปโหลด Timesheet')} subtitle={tx('อ่านไฟล์ด้วย ABBYY OCR, ดึงจาก Gmail หรือกรอกเองแล้วบันทึกเข้าระบบ')} />

      <TabStrip tabs={TABS} active={tab} onChange={setTab} />

      {tab === 'upload' && <UploadFileTab />}
      {tab === 'gmail' && <GmailTab />}
      {tab === 'manual' && <ManualEntryTab />}
      {tab === 'history' && <HistoryTab />}
    </>
  );
}
