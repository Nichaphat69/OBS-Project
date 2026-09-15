'use client';

import { useEffect, useState } from 'react';
import { Card, ErrorState, Tag } from '../../../components/ui';
import { useConfirm, useToast } from '../../../components/Overlays';
import { useLang } from '../../../lib/language';

interface Recipient {
  id: number;
  channel: 'line' | 'email';
  label: string;
  target: string;
}
interface KnownLineUser {
  userId: string;
  lastSeenAt: string | null;
  displayName: string | null;
}

const CHANNEL_LABEL: Record<string, string> = { line: 'LINE', email: 'อีเมล' };

export default function NotificationRecipientsTab() {
  const toast = useToast();
  const confirm = useConfirm();
  const { tx } = useLang();
  const [recipients, setRecipients] = useState<Recipient[] | null>(null);
  const [knownLineUsers, setKnownLineUsers] = useState<KnownLineUser[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [channel, setChannel] = useState<'line' | 'email'>('line');
  const [label, setLabel] = useState('');
  const [target, setTarget] = useState('');
  const [adding, setAdding] = useState(false);

  function load() {
    setError(null);
    fetch('/api/notification-recipients', { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          setError(data.error ?? tx('โหลดข้อมูลไม่สำเร็จ'));
          return;
        }
        setRecipients(await r.json());
      })
      .catch(() => setError(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้')));
  }

  useEffect(() => {
    load();
    fetch('/api/line/known-users', { cache: 'no-store' })
      .then((r) => r.json())
      .then(setKnownLineUsers)
      .catch(() => setKnownLineUsers([]));
  }, []);

  async function add() {
    if (!target.trim()) {
      toast(tx('ต้องระบุปลายทาง (LINE user ID หรืออีเมล)'), true);
      return;
    }
    setAdding(true);
    try {
      const res = await fetch('/api/notification-recipients', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ channel, label: label.trim() || undefined, target: target.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error ?? tx('เพิ่มไม่สำเร็จ'), true);
        return;
      }
      toast(`${tx('เพิ่ม')} "${data.label ?? data.target}"`);
      setLabel('');
      setTarget('');
      load();
    } catch {
      toast(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'), true);
    } finally {
      setAdding(false);
    }
  }

  async function remove(r: Recipient) {
    const ok = await confirm({
      title: tx('ลบผู้รับแจ้งเตือนนี้?'),
      message: (
        <>
          {tx('ผู้รับแจ้งเตือน')} &quot;<b>{r.label}</b>&quot; {tx('จะไม่ได้รับการแจ้งเตือนอีกต่อไป')}
        </>
      ),
      confirmLabel: tx('ลบ'),
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/notification-recipients/${r.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error ?? tx('ลบไม่สำเร็จ'), true);
        return;
      }
      toast(tx('ลบแล้ว'));
      load();
    } catch {
      toast(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'), true);
    }
  }

  function displayLabel(r: Recipient): string {
    if (r.channel !== 'line') return r.label;
    const known = knownLineUsers.find((k) => k.userId === r.target);
    return known?.displayName ?? r.label;
  }

  return (
    <Card title={tx('ผู้รับแจ้งเตือน')}>
      <div className="frm auto" style={{ marginBottom: 18 }}>
        <label>
          {tx('ช่องทาง')}
          <select value={channel} onChange={(e) => setChannel(e.target.value as 'line' | 'email')}>
            <option value="line">LINE</option>
            <option value="email">{tx('อีเมล')}</option>
          </select>
        </label>
        <label>
          {tx('ชื่อ (แสดงในรายการ)')}
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="เช่น นิชา" />
        </label>
        <label>
          {tx('ปลายทาง')}
          <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="LINE user ID หรืออีเมล" />
        </label>
        <button className="btn pri" disabled={adding} onClick={add}>
          {adding ? tx('กำลังเพิ่ม…') : `+ ${tx('เพิ่ม')}`}
        </button>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : (
      <div className="tw">
        <table>
          <thead>
            <tr>
              <th>{tx('ช่องทาง')}</th>
              <th>{tx('ชื่อ')}</th>
              <th>{tx('ปลายทาง')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {recipients?.map((r) => (
              <tr key={r.id}>
                <td>
                  <Tag tone="mu">{tx(CHANNEL_LABEL[r.channel])}</Tag>
                </td>
                <td>{displayLabel(r)}</td>
                <td className="sub">{r.target}</td>
                <td>
                  <button className="btn ghost sm" onClick={() => remove(r)} style={{ color: 'var(--cr)' }}>
                    {tx('ลบ')}
                  </button>
                </td>
              </tr>
            ))}
            {recipients && recipients.length === 0 && (
              <tr>
                <td colSpan={4} style={{ textAlign: 'center', color: 'var(--mut)' }}>
                  {tx('ยังไม่มีผู้รับแจ้งเตือน')}
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
