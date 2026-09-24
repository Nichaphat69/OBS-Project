'use client';

import { useEffect, useState } from 'react';
import { Card, ErrorState, Loading, StatusPill, Tag } from '../../../components/ui';
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
interface StaffLineStatus {
  username: string;
  nameTh: string;
  role: string;
  linked: boolean;
}

const CHANNEL_LABEL: Record<string, string> = { line: 'LINE', email: 'อีเมล' };
const ROLE_LABEL: Record<string, string> = { admin: 'ผู้ดูแลระบบ', accounting: 'บัญชี' };
const ROLE_NOTIFY_LABEL: Record<string, string> = {
  admin: 'ระบบมีปัญหา/error',
  accounting: 'ขออนุมัติวางบิล · ตั๋วแจ้งปัญหา',
};

/** "ใครเป็นใคร" ตาม role — อ่านอย่างเดียว (24 ก.ย. 69 ตามที่ขอ "จะได้รู้ว่าคนที่แอดไลน์มาเป็น role อะไร
 * จะได้รับข้อมูลการแจ้งเตือนอะไรบ้าง") ผูกไลน์เองจากหน้า "เชื่อมต่อ LINE" ในเมนูของแต่ละคน ไม่ใช่แอดมิน
 * มาเพิ่มให้ที่นี่แบบด้านล่าง — ตารางนี้แค่โชว์ว่าใครผูกแล้วบ้าง ไม่มีปุ่มแก้ไข */
function StaffLineStatusTable() {
  const { tx } = useLang();
  const [rows, setRows] = useState<StaffLineStatus[] | null>(null);

  useEffect(() => {
    fetch('/api/notification-recipients/staff-line-status', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then(setRows)
      .catch(() => setRows([]));
  }, []);

  return (
    <Card title={tx('ใครเป็นใคร — ผูกไลน์เองแล้วบ้าง')} flush>
      <div className="tw">
        <table>
          <thead>
            <tr>
              <th>{tx('บัญชี')}</th>
              <th>Role</th>
              <th>{tx('จะได้รับแจ้งเตือนเรื่อง')}</th>
              <th>{tx('สถานะ')}</th>
            </tr>
          </thead>
          <tbody>
            {rows?.map((r) => (
              <tr key={r.username}>
                <td className="nm">
                  {r.nameTh}
                  <div className="sub">{r.username}</div>
                </td>
                <td>
                  <Tag tone="mu">{tx(ROLE_LABEL[r.role] ?? r.role)}</Tag>
                </td>
                <td className="sub">{tx(ROLE_NOTIFY_LABEL[r.role] ?? '—')}</td>
                <td>
                  {r.linked ? (
                    <StatusPill tone="ok">{tx('ผูกไลน์แล้ว')}</StatusPill>
                  ) : (
                    <StatusPill tone="mu">{tx('ยังไม่ผูก')}</StatusPill>
                  )}
                </td>
              </tr>
            ))}
            {!rows && (
              <tr>
                <td colSpan={4}>
                  <Loading rows={4} />
                </td>
              </tr>
            )}
            {rows && rows.length === 0 && (
              <tr>
                <td colSpan={4} style={{ textAlign: 'center', color: 'var(--mut)' }}>
                  {tx('ยังไม่มีบัญชี admin/accounting ในระบบ')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="sub" style={{ padding: '12px 24px' }}>
        {tx('แต่ละคนผูกไลน์ของตัวเองได้จากเมนู "เชื่อมต่อ LINE" — ไม่ต้องมาเพิ่มที่นี่')}
      </div>
    </Card>
  );
}

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
    <>
      <StaffLineStatusTable />
      <Card
        title={tx('ผู้รับแจ้งเตือน (เพิ่มเอง)')}
        right={<span className="sub">{tx('LINE ของ admin/accounting ผูกเองได้แล้วด้านบน — เพิ่มด้วยมือได้ทั้งสองช่องทาง เผื่อกรณีพิเศษ')}</span>}
      >
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
            {!recipients && (
              <tr>
                <td colSpan={4}>
                  <Loading rows={4} />
                </td>
              </tr>
            )}
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
    </>
  );
}
