'use client';

import { useState } from 'react';
import { Card, StatusPill } from '../../../components/ui';
import { useLang } from '../../../lib/language';

const LEAVE_TYPES = [
  { value: 'sick', label: 'ลาป่วย' },
  { value: 'personal', label: 'ลากิจ' },
  { value: 'vacation', label: 'ลาพักร้อน' },
  { value: 'other', label: 'อื่นๆ' },
];

export default function ManualEntryTab() {
  const { tx } = useLang();
  const [employeeName, setEmployeeName] = useState('');
  const [position, setPosition] = useState('');
  const [period, setPeriod] = useState('');
  const [approvedBy, setApprovedBy] = useState('');
  const [approvedAt, setApprovedAt] = useState('');
  const [submissionMethod, setSubmissionMethod] = useState('self_email');
  const [leaveDays, setLeaveDays] = useState<Array<{ date: string; type: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  function addLeaveDay() {
    setLeaveDays((d) => [...d, { date: '', type: 'sick' }]);
  }
  function updateLeaveDay(i: number, patch: Partial<{ date: string; type: string }>) {
    setLeaveDays((d) => d.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function removeLeaveDay(i: number) {
    setLeaveDays((d) => d.filter((_, idx) => idx !== i));
  }

  async function submit() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/timesheets/manual', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ employeeName, position, period, approvedBy, approvedAt, leaveDays, submissionMethod }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.errors?.[0] ?? data.error ?? tx('บันทึกไม่สำเร็จ'));
        return;
      }
      setResult(data);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={tx('กรอก Timesheet ด้วยมือ')} right={<span className="sub">{tx('ตารางรายวันคำนวณจากปฏิทินอัตโนมัติ')}</span>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px,1fr))', gap: 14, marginBottom: 18 }}>
        <Field label={tx('ชื่อพนักงานตามใบ')} value={employeeName} onChange={setEmployeeName} />
        <Field label={tx('ตำแหน่งตามใบ')} value={position} onChange={setPosition} />
        <Field label={tx('รอบเดือน (YYYY-MM)')} value={period} onChange={setPeriod} placeholder="2026-06" />
        <Field label={tx('ผู้อนุมัติฝั่งลูกค้า')} value={approvedBy} onChange={setApprovedBy} />
        <Field label={tx('วันที่อนุมัติ (YYYY-MM-DD)')} value={approvedAt} onChange={setApprovedAt} />
        <label>
          <div className="ey">{tx('ช่องทางที่ได้รับมา')}</div>
          <select
            value={submissionMethod}
            onChange={(e) => setSubmissionMethod(e.target.value)}
            style={{ marginTop: 6, width: '100%', height: 38, borderRadius: 'var(--r-ctl)', border: '1px solid var(--rule)', padding: '0 12px' }}
          >
            <option value="self_email">{tx('ลูกค้าส่งอีเมลมาเอง')}</option>
            <option value="proxy_email">{tx('พนักงานส่งอีเมลแทน')}</option>
          </select>
        </label>
      </div>

      <div style={{ marginBottom: 18 }}>
        <div className="ey" style={{ marginBottom: 8 }}>
          {tx('วันที่ลา')}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {leaveDays.map((l, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="date"
                value={l.date}
                onChange={(e) => updateLeaveDay(i, { date: e.target.value })}
                style={{ height: 36, borderRadius: 'var(--r-ctl)', border: '1px solid var(--rule)', padding: '0 10px' }}
              />
              <select
                value={l.type}
                onChange={(e) => updateLeaveDay(i, { type: e.target.value })}
                style={{ height: 36, borderRadius: 'var(--r-ctl)', border: '1px solid var(--rule)', padding: '0 10px' }}
              >
                {LEAVE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {tx(t.label)}
                  </option>
                ))}
              </select>
              <button className="btn ghost sm" onClick={() => removeLeaveDay(i)}>
                {tx('ลบ')}
              </button>
            </div>
          ))}
          <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={addLeaveDay}>
            + {tx('เพิ่มวันลา')}
          </button>
        </div>
      </div>

      {error && <div style={{ color: 'var(--cr)', marginBottom: 14 }}>{error}</div>}

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn pri" disabled={busy} onClick={submit}>
          {busy ? tx('กำลังบันทึก…') : tx('บันทึกเข้าระบบ')}
        </button>
      </div>

      {result && (
        <div style={{ borderTop: '1px solid var(--hair)', marginTop: 18, paddingTop: 18 }}>
          <StatusPill tone="ok">{tx('บันทึกสำเร็จ')}</StatusPill>
          <div style={{ marginTop: 10 }} className="sub">
            {tx('เลขที่')} {result.timesheetId} · {tx('สถานะ')} {result.status} ·{' '}
            {result.manday ? `${tx('ยอด')} ${result.manday.lineAmount?.toLocaleString('en-US', { minimumFractionDigits: 2 })} ${tx('บาท')}` : ''}
          </div>
        </div>
      )}
    </Card>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label>
      <div className="ey">{label}</div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ marginTop: 6, width: '100%', height: 38, borderRadius: 'var(--r-ctl)', border: '1px solid var(--rule)', padding: '0 12px' }}
      />
    </label>
  );
}
