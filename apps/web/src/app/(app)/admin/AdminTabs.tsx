'use client';

import { useState } from 'react';
import OverviewTab from './OverviewTab';
import UsersTab from './UsersTab';
import NotificationRecipientsTab from './NotificationRecipientsTab';
import AuditLogTab from './AuditLogTab';
import EmailDomainsTab from './EmailDomainsTab';
import { useLang } from '../../../lib/language';

const TABS = [
  { key: 'overview', label: 'ภาพรวม' },
  { key: 'users', label: 'ผู้ใช้' },
  { key: 'recipients', label: 'ผู้รับแจ้งเตือน' },
  { key: 'auditLog', label: 'บันทึกระบบ' },
  { key: 'domains', label: 'โดเมนอีเมล' },
] as const;

export default function AdminTabs({ currentUsername }: { currentUsername: string }) {
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('overview');
  const { tx } = useLang();

  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 22, flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className={`btn sm${tab === t.key ? ' pri' : ''}`}>
            {tx(t.label)}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab />}
      {tab === 'users' && <UsersTab currentUsername={currentUsername} />}
      {tab === 'recipients' && <NotificationRecipientsTab />}
      {tab === 'auditLog' && <AuditLogTab />}
      {tab === 'domains' && <EmailDomainsTab />}
    </>
  );
}
