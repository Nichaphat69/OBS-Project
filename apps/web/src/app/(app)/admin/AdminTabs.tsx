'use client';

import { useState } from 'react';
import OverviewTab from './OverviewTab';
import UsersTab from './UsersTab';
import NotificationRecipientsTab from './NotificationRecipientsTab';
import AuditLogTab from './AuditLogTab';
import EmailDomainsTab from './EmailDomainsTab';
import { TabStrip } from '../../../components/ui';

const TABS = [
  { key: 'overview', label: 'ภาพรวม' },
  { key: 'users', label: 'ผู้ใช้' },
  { key: 'recipients', label: 'ผู้รับแจ้งเตือน' },
  { key: 'auditLog', label: 'บันทึกระบบ' },
  { key: 'domains', label: 'โดเมนอีเมล' },
] as const;

export default function AdminTabs({ currentUsername }: { currentUsername: string }) {
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('overview');

  return (
    <>
      <TabStrip tabs={TABS} active={tab} onChange={setTab} />

      {tab === 'overview' && <OverviewTab />}
      {tab === 'users' && <UsersTab currentUsername={currentUsername} />}
      {tab === 'recipients' && <NotificationRecipientsTab />}
      {tab === 'auditLog' && <AuditLogTab />}
      {tab === 'domains' && <EmailDomainsTab />}
    </>
  );
}
