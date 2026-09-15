'use client';

import { useEffect, useState } from 'react';
import { Card, ErrorState, StatusPill, Tag } from '../../../components/ui';
import { useToast } from '../../../components/Overlays';
import { useLang } from '../../../lib/language';

interface TicketRow {
  id: number;
  employeeName: string;
  category: string;
  categoryLabel: string;
  description: string;
  status: string;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

export default function TicketsClient() {
  const toast = useToast();
  const { tx } = useLang();
  const [tickets, setTickets] = useState<TicketRow[] | null>(null);
  const [resolving, setResolving] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setError(null);
    fetch('/api/support-tickets', { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          setError(data.error ?? tx('โหลดข้อมูลไม่สำเร็จ'));
          return;
        }
        setTickets(await r.json());
      })
      .catch(() => setError(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้')));
  }

  useEffect(load, []);

  async function resolve(id: number) {
    setResolving(id);
    try {
      const res = await fetch(`/api/support-tickets/${id}/resolve`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error ?? tx('บันทึกไม่สำเร็จ'), true);
        return;
      }
      toast(`${tx('ทำเครื่องหมายตั๋ว')} #${id} ${tx('ว่าแก้แล้ว')}`);
      load();
    } catch {
      toast(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'), true);
    } finally {
      setResolving(null);
    }
  }

  const openCount = tickets?.filter((t) => t.status !== 'resolved').length ?? 0;

  return (
    <Card title={tx('ตั๋วแจ้งปัญหา')} right={tickets ? <span className="sub">{tx('ค้างอยู่')} {openCount} {tx('รายการ')}</span> : undefined}>
      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : (
      <>
      <div className="tw">
        <table>
          <thead>
            <tr>
              <th>{tx('เลขที่')}</th>
              <th>{tx('พนักงาน')}</th>
              <th>{tx('หมวด')}</th>
              <th>{tx('รายละเอียด')}</th>
              <th>{tx('แจ้งเมื่อ')}</th>
              <th>{tx('สถานะ')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {tickets?.map((t) => (
              <tr key={t.id}>
                <td className="docid">#{t.id}</td>
                <td>{t.employeeName}</td>
                <td>
                  <Tag tone="mu">{tx(t.categoryLabel)}</Tag>
                </td>
                <td style={{ maxWidth: 320 }}>{t.description}</td>
                <td className="sub">{t.createdAt.replace('T', ' ').slice(0, 19)}</td>
                <td>
                  {t.status === 'resolved' ? (
                    <div>
                      <StatusPill tone="ok">{tx('แก้แล้ว')}</StatusPill>
                      <div className="sub">{t.resolvedAt?.replace('T', ' ').slice(0, 19)}</div>
                    </div>
                  ) : (
                    <StatusPill tone="wn">{tx('รอดำเนินการ')}</StatusPill>
                  )}
                </td>
                <td>
                  {t.status !== 'resolved' && (
                    <button className="btn sm" disabled={resolving === t.id} onClick={() => resolve(t.id)}>
                      {resolving === t.id ? tx('กำลังบันทึก…') : tx('ทำเครื่องหมายว่าแก้แล้ว')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {tickets && tickets.length === 0 && (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', color: 'var(--mut)' }}>
                  {tx('ยังไม่มีการแจ้งปัญหา')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {tickets && tickets.length > 0 && openCount === 0 && (
        <div className="sub" style={{ marginTop: 14, textAlign: 'center' }}>
          {tx('แก้ครบทุกรายการแล้ว')} 🎉
        </div>
      )}
      </>
      )}
    </Card>
  );
}
