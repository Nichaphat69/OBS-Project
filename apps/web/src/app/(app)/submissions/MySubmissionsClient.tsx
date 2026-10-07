'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { EmptyState, ErrorState, Loading, PageHeader } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { useLang } from '../../../lib/language';
import '../../../components/emp.css';

/**
 * "บันทึกการส่ง" ของพนักงาน (role user) — เห็นเฉพาะรอบบิลของตัวเองว่าส่งอะไรไปบ้าง (7 ต.ค. 69 ตามที่ขอ)
 * ไม่ใช่หน้าภาพรวมแบบ admin/accounting (โดนัท · ตัวกรอง · ตารางทั้งทีม) — ยิงเส้น /mine ซึ่งยึด employeeId จาก session
 */

type Status = 'not_submitted' | 'submitted' | 'pending_review' | 'confirmed' | 'problem';

const STATUS_LABEL: Record<Status, string> = {
  not_submitted: 'ยังไม่ส่ง',
  submitted: 'ส่งแล้ว',
  pending_review: 'ตรวจ Manday',
  confirmed: 'ยืนยันแล้ว',
  problem: 'มีปัญหา',
};
const STATUS_CLS: Record<Status, string> = {
  not_submitted: 'a',
  submitted: 'w',
  pending_review: 'w',
  confirmed: 'd',
  problem: 'r',
};
const METHOD_LABEL: Record<string, string> = {
  self_obs: 'ส่งผ่านระบบ OBS',
  self_email: 'ส่งผ่าน Email',
  proxy_email: 'ให้ผู้ดูแลเป็นคนส่ง',
};

interface Row {
  contractId: string;
  customerName: string;
  projectName: string;
  period: string;
  periodLabel: string;
  status: Status;
  method: string | null;
  methodChosenAt: string | null;
  deferredAt: string | null;
}

export default function MySubmissionsClient() {
  const { tx, formatDateTime: dt, formatPeriodLabel } = useLang();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setError(null);
    fetch('/api/timesheet-submissions/mine', { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) {
          setError((await r.json().catch(() => ({})))?.error ?? tx('โหลดข้อมูลไม่สำเร็จ'));
          return;
        }
        const b = await r.json();
        setRows([...(b.rows ?? [])].sort((x: Row, y: Row) => y.period.localeCompare(x.period)));
      })
      .catch(() => setError(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้')));
  }
  useEffect(load, []);

  return (
    <div className="ep">
      <PageHeader eyebrow={tx('อ้างอิง')} title={tx('บันทึกการส่ง')} subtitle={tx('รายการ Timesheet ที่คุณส่งในแต่ละรอบบิล')} />
      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : rows === null ? (
        <Loading rows={4} />
      ) : rows.length === 0 ? (
        <EmptyState label={tx('ยังไม่มีรอบบิลให้แสดง')} />
      ) : (
        <div className="ms-list">
          {rows.map((r) => (
            <div key={`${r.contractId}|${r.period}`} className={`ms-row ${STATUS_CLS[r.status]}`}>
              <span className="ms-ic">
                <Icon name={r.status === 'confirmed' ? 'chk' : r.status === 'not_submitted' ? 'file' : r.status === 'problem' ? 'alt' : 'send'} />
              </span>
              <div className="ms-main">
                <b>{formatPeriodLabel(r.periodLabel)}</b>
                <span>{r.customerName} · {r.projectName}</span>
              </div>
              <div className="ms-meta">
                <span>{r.method ? tx(METHOD_LABEL[r.method] ?? r.method) : '—'}</span>
                <span>{r.methodChosenAt ? dt(r.methodChosenAt) : r.deferredAt ? `${tx('ขอเลื่อน')} · ${dt(r.deferredAt)}` : ''}</span>
              </div>
              <span className="mp-chip">{tx(STATUS_LABEL[r.status])}</span>
              {r.status === 'not_submitted' || r.status === 'problem' ? (
                <Link className="btn sm pri" href={`/upload?contractId=${encodeURIComponent(r.contractId)}&period=${encodeURIComponent(r.period)}`}>
                  <Icon name="up" className="sm" /> {tx('ส่งไฟล์ Timesheet')}
                </Link>
              ) : (
                <span className="ms-gap" />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
