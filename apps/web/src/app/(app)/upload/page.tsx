'use client';

import { useState } from 'react';
import { PageHeader } from '../../../components/ui';
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

export default function UploadPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('upload');
  const { tx } = useLang();

  return (
    <>
      <PageHeader eyebrow={tx('ขั้นตอน 1 · อัปโหลด Timesheet')} title={tx('อัปโหลด Timesheet')} subtitle={tx('อ่านไฟล์ด้วย ABBYY OCR, ดึงจาก Gmail หรือกรอกเองแล้วบันทึกเข้าระบบ')} />

      <div style={{ display: 'flex', gap: 8, marginBottom: 22, flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="btn sm"
            style={tab === t.key ? { background: 'var(--grad-brand)', border: 'none', color: '#fff' } : undefined}
          >
            {tx(t.label)}
          </button>
        ))}
      </div>

      {tab === 'upload' && <UploadFileTab />}
      {tab === 'gmail' && <GmailTab />}
      {tab === 'manual' && <ManualEntryTab />}
      {tab === 'history' && <HistoryTab />}
    </>
  );
}
