'use client';

import { useState } from 'react';
import UsersTab from './UsersTab';
import AuditLogTab from './AuditLogTab';
import EmailDomainsTab from './EmailDomainsTab';
import ApiActivityLogTab from './ApiActivityLogTab';
import { TabStrip } from '../../../components/ui';

// แท็บ "ภาพรวม" (สถานะการเชื่อมต่อ + เงื่อนไขวางบิล) เอาออก 2 ต.ค. 69 ตามที่เจ้าของระบบสั่ง — แท็บแรกจึงเป็น "ผู้ใช้"
// แท็บ "ผู้รับแจ้งเตือน" เดิม ยุบรวมเข้า "ผู้ใช้" ไปแล้วทั้งหมด (25 ก.ย. 69 ตามที่ขอ) — ดู UsersTab.tsx
const TABS = [
  { key: 'users', label: 'ผู้ใช้' },
  { key: 'auditLog', label: 'บันทึกระบบ' },
  { key: 'domains', label: 'โดเมนอีเมล' },
  { key: 'apiActivityLog', label: 'API Activity Log' },
] as const;

export default function AdminTabs({ currentUsername }: { currentUsername: string }) {
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('users');

  return (
    <>
      <TabStrip tabs={TABS} active={tab} onChange={setTab} />

      {tab === 'users' && <UsersTab currentUsername={currentUsername} />}
      {tab === 'auditLog' && <AuditLogTab />}
      {tab === 'domains' && <EmailDomainsTab />}
      {tab === 'apiActivityLog' && <ApiActivityLogTab />}
    </>
  );
}
