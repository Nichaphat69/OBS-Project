'use client';

import { useEffect, useState } from 'react';
import { PageHeader, TabStrip } from '../../../components/ui';
import UploadFileTab from './UploadFileTab';
import GmailTab from './GmailTab';
import HistoryTab from './HistoryTab';
import EmployeeSubmissionsTab, { type EmployeeSubmissionItem } from './EmployeeSubmissionsTab';
import { useLang } from '../../../lib/language';

const TABS = [
  { key: 'employee', label: 'ส่งผ่านระบบ' },
  { key: 'upload', label: 'อัปโหลดไฟล์' },
  { key: 'gmail', label: 'ดึงจาก Gmail' },
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
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('employee');
  const { tx } = useLang();
  const isEmployee = role === 'user';

  // คิว "รอจากพนักงาน" — โหลดไว้ที่นี่ (ไม่ใช่ในตัวแท็บเอง) เพราะต้องรู้จำนวนไว้ขึ้น badge บนแท็บแม้ยัง
  // ไม่ได้กดเข้าแท็บนั้นเลย (เจ้าของระบบสั่ง 22 ก.ย. 69 — ให้เห็นงานค้างทันทีตั้งแต่เปิดหน้า เหมือน badge
  // แจ้งเตือนจุดอื่นในระบบ) พนักงาน (role user) ไม่ต้องโหลดเลย เพราะมองไม่เห็นแท็บนี้อยู่แล้ว
  const [pending, setPending] = useState<EmployeeSubmissionItem[] | null>(null);

  function loadPending() {
    if (isEmployee) return;
    fetch('/api/ai-reads', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: EmployeeSubmissionItem[]) =>
        setPending(Array.isArray(rows) ? rows.filter((r) => r.source === 'employee_submit' && r.status === 'pending') : []),
      )
      .catch(() => setPending([]));
  }

  useEffect(loadPending, [isEmployee]);

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
      <PageHeader eyebrow={tx('ขั้นตอน 1 · อัปโหลด Timesheet')} title={tx('อัปโหลด Timesheet')} subtitle={tx('อ่านไฟล์ด้วย ABBYY OCR หรือดึงจาก Gmail แล้วบันทึกเข้าระบบ')} />

      <TabStrip
        tabs={TABS}
        active={tab}
        onChange={setTab}
      />

      {tab === 'employee' && <EmployeeSubmissionsTab items={pending} onReload={loadPending} />}
      {tab === 'upload' && <UploadFileTab />}
      {tab === 'gmail' && <GmailTab />}
      {tab === 'history' && <HistoryTab />}
    </>
  );
}
