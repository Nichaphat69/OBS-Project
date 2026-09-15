'use client';

import { Fragment, useEffect, useState } from 'react';
import { Card, ErrorState, StatusPill, Tag } from '../../../components/ui';
import { useToast } from '../../../components/Overlays';
import { useLang } from '../../../lib/language';

interface AiReadItem {
  id: number;
  source: string;
  fileName: string | null;
  employeeName: string | null;
  period: string | null;
  periodLabel: string | null;
  documentNo: string | null;
  status: string;
  model: string | null;
  readAt: string;
  readBy: string | null;
}
interface AiReadDetail extends AiReadItem {
  extraction: {
    employeeName: string;
    position: string;
    period: string;
    totalWorkDays: number;
    totalLeaveDays: number;
    leaveDays: Array<{ date: string; type: string; rawLabel?: string }>;
    notes?: string[];
  } | null;
}

const STATUS_TONE: Record<string, 'ok' | 'wn' | 'mu'> = {
  confirmed: 'ok',
  pending: 'wn',
};

const LEAVE_TYPE_LABEL: Record<string, string> = { sick: 'ลาป่วย', personal: 'ลากิจ', vacation: 'ลาพักร้อน', unpaid: 'ลาไม่รับค่าจ้าง', unknown: 'อื่นๆ', other: 'อื่นๆ' };

export default function HistoryTab() {
  const { tx } = useLang();
  const toast = useToast();
  const [rows, setRows] = useState<AiReadItem[] | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [details, setDetails] = useState<Record<number, AiReadDetail | 'loading' | 'error'>>({});

  function load() {
    setError(null);
    fetch('/api/ai-reads', { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          setError(data?.error ?? tx('โหลดข้อมูลไม่สำเร็จ'));
          return;
        }
        setRows(await r.json());
      })
      .catch(() => setError(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้')));
  }

  useEffect(load, []);

  function toggleExpand(id: number) {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (!details[id]) {
      setDetails((d) => ({ ...d, [id]: 'loading' }));
      fetch(`/api/ai-reads/${id}`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((data: AiReadDetail) => setDetails((d) => ({ ...d, [id]: data })))
        .catch(() => setDetails((d) => ({ ...d, [id]: 'error' })));
    }
  }

  async function dismiss(id: number) {
    setBusyId(id);
    try {
      const res = await fetch('/api/ai-reads/dismiss', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(data?.error ?? tx('ทิ้งไม่สำเร็จ'), true);
        return;
      }
      load();
    } catch {
      toast(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'), true);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card title={tx('ประวัติ AI อ่านไฟล์')} flush>
      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : (
      <div className="tw">
        <table>
          <thead>
            <tr>
              <th>{tx('เลขที่')}</th>
              <th>{tx('รอบ')}</th>
              <th>{tx('พนักงาน')}</th>
              <th>{tx('ที่มา')}</th>
              <th>{tx('โมเดล')}</th>
              <th>{tx('สถานะ')}</th>
              <th>{tx('อ่านเมื่อ')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows?.map((r) => {
              const expanded = expandedId === r.id;
              const detail = details[r.id];
              return (
                <Fragment key={r.id}>
                  <tr className="rw" onClick={() => toggleExpand(r.id)} title={tx('คลิกเพื่อดูวันลาที่อ่านได้')}>
                    <td className="docid">{r.documentNo}</td>
                    <td>{r.periodLabel ?? '—'}</td>
                    <td className="nm">{r.employeeName ?? '—'}</td>
                    <td>
                      <Tag tone="mu">{r.source === 'upload' ? tx('อัปโหลดไฟล์') : 'Gmail'}</Tag>
                    </td>
                    <td>{r.model ?? '—'}</td>
                    <td>
                      <StatusPill tone={STATUS_TONE[r.status] ?? 'mu'}>{r.status}</StatusPill>
                    </td>
                    <td className="sub">{r.readAt?.slice(0, 19).replace('T', ' ')}</td>
                    <td className="r">
                      <button
                        className="btn dgr sm"
                        disabled={busyId === r.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          dismiss(r.id);
                        }}
                      >
                        {tx('ทิ้ง')}
                      </button>
                    </td>
                  </tr>
                  {expanded && (
                    <tr>
                      <td colSpan={8} style={{ background: 'var(--sunk)' }}>
                        {detail === 'loading' && <div className="sub" style={{ padding: 12 }}>{tx('กำลังโหลด…')}</div>}
                        {detail === 'error' && <div style={{ padding: 12, color: 'var(--cr)' }}>{tx('โหลดรายละเอียดไม่สำเร็จ')}</div>}
                        {detail && detail !== 'loading' && detail !== 'error' && (
                          <div style={{ padding: 12 }}>
                            {!detail.extraction ? (
                              <div className="sub">{tx('ไม่มีข้อมูลวันลาสำหรับรายการนี้')}</div>
                            ) : detail.extraction.leaveDays.length === 0 ? (
                              <div className="sub">{tx('ไม่มีวันลาที่อ่านได้ในรอบนี้')}</div>
                            ) : (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                <div className="ey">{tx('วันลาที่อ่านได้')}</div>
                                {detail.extraction.leaveDays.map((l, i) => (
                                  <div key={i} style={{ display: 'flex', gap: 10 }}>
                                    <span className="n">{l.date}</span>
                                    <Tag tone="mu">{tx(LEAVE_TYPE_LABEL[l.type] ?? l.type)}</Tag>
                                    {l.rawLabel && <span className="sub">{l.rawLabel}</span>}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {rows && rows.length === 0 && (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', color: 'var(--mut)' }}>
                  {tx('ยังไม่มีประวัติ')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      )}
    </Card>
  );
}
