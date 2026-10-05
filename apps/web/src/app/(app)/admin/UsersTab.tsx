'use client';

import { useEffect, useState } from 'react';
import { Card, ErrorState, Loading, StatusPill, Tag } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { useConfirm, usePrompt, useToast } from '../../../components/Overlays';
import { useLang } from '../../../lib/language';

interface UserRow {
  username: string;
  nameTh: string;
  nameEn: string | null;
  role: string;
  employeeId: string | null;
  active: boolean;
  createdAt: string;
  lineLinked: boolean;
}
interface EmployeeOption {
  id: string;
  nameTh: string;
  customerName: string | null;
}
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

const ROLES = ['user', 'accounting', 'admin', 'executive'];
const ROLE_LABEL: Record<string, string> = { admin: 'admin', accounting: 'บัญชี', user: 'พนักงาน', executive: 'ผู้บริหาร' };
/** เรื่องที่แต่ละ role จะได้รับแจ้งเตือนทาง LINE — คงที่ตาม role ไม่ใช่ต่อคน (25 ก.ย. 69 ตามที่ขอ "แสดง
 * สถานะด้วยว่าพนักงานคนนี้เชื่อมต่อ line แล้ว เพื่อรับการแจ้งเตือน ที่ต่างกันไปตาม role") admin เพิ่ง
 * ย้ายมารับแจ้งปัญหา/feedback จากพนักงานด้วย (เดิมไปที่บัญชีผิดที่ — บัญชีไม่มีสิทธิ์ปิดตั๋วเลย) */
const ROLE_NOTIFY_LABEL: Record<string, string> = {
  admin: 'ระบบมีปัญหา (error) · แจ้งปัญหา/feedback จากพนักงาน',
  accounting: 'ตรวจ Manday · ขออนุมัติวางบิล',
  user: 'เช็คสถานะ/ส่ง Timesheet ผ่านแชทบอท LINE',
  executive: '—',
};
const CHANNEL_LABEL: Record<string, string> = { line: 'LINE', email: 'อีเมล' };

/**
 * "ผู้ใช้ระบบ" — รวมเข้ากับแท็บ "ผู้รับแจ้งเตือน" เดิมทั้งหมดแล้ว (25 ก.ย. 69 ตามที่ขอ "หน้านี้รวมกับ
 * ผู้รับแจ้งเตือนเลย") เหตุผล: ตารางผู้ใช้กับตารางสถานะผูกไลน์ที่แยกกันอยู่ก่อนหน้านี้คือข้อมูลชุดเดียวกัน
 * (คนเดียวกัน) แค่คนละมุมมอง — เดิม "ใครเป็นใคร" (StaffLineStatusTable) เห็นแค่ admin/accounting เท่านั้น
 * (role 'user' ไม่เคยโผล่เลยทั้งที่ผูกไลน์ได้เหมือนกันผ่าน Employee.lineUserId) มาแสดงรวมในตารางเดียวที่นี่
 * ให้ครบทุก role แทน ส่วนฟอร์ม "เพิ่มผู้รับแจ้งเตือนเอง" (คนนอกระบบ/อีเมลแผนก) ย้ายมาไว้ด้านล่างสุด
 */
export default function UsersTab({ currentUsername }: { currentUsername: string }) {
  const toast = useToast();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const { tx } = useLang();
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [username, setUsername] = useState('');
  const [nameTh, setNameTh] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [role, setRole] = useState('user');
  const [employeeId, setEmployeeId] = useState('');
  const [adding, setAdding] = useState(false);

  const [editing, setEditing] = useState<string | null>(null);
  const [editNameTh, setEditNameTh] = useState('');
  const [editNameEn, setEditNameEn] = useState('');
  const [savingName, setSavingName] = useState(false);

  // ── ผู้รับแจ้งเตือนที่เพิ่มเอง (ย้ายมาจาก NotificationRecipientsTab.tsx) ──
  const [recipients, setRecipients] = useState<Recipient[] | null>(null);
  const [knownLineUsers, setKnownLineUsers] = useState<KnownLineUser[]>([]);
  const [recipientError, setRecipientError] = useState<string | null>(null);
  const [channel, setChannel] = useState<'line' | 'email'>('line');
  const [label, setLabel] = useState('');
  const [target, setTarget] = useState('');
  const [addingRecipient, setAddingRecipient] = useState(false);

  function load() {
    setError(null);
    fetch('/api/users', { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          setError(data?.error ?? tx('โหลดข้อมูลไม่สำเร็จ'));
          return;
        }
        setUsers(await r.json());
      })
      .catch(() => setError(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้')));
  }

  function loadRecipients() {
    setRecipientError(null);
    fetch('/api/notification-recipients', { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          setRecipientError(data.error ?? tx('โหลดข้อมูลไม่สำเร็จ'));
          return;
        }
        setRecipients(await r.json());
      })
      .catch(() => setRecipientError(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้')));
  }

  useEffect(() => {
    load();
    fetch('/api/employees', { cache: 'no-store' })
      .then((r) => r.json())
      .then(setEmployees)
      .catch(() => setEmployees([]));
    loadRecipients();
    fetch('/api/line/known-users', { cache: 'no-store' })
      .then((r) => r.json())
      .then(setKnownLineUsers)
      .catch(() => setKnownLineUsers([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addUser() {
    if (!username.trim() || !nameTh.trim() || !password) {
      toast(tx('กรอก username, ชื่อ และรหัสผ่านให้ครบ'), true);
      return;
    }
    setAdding(true);
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          nameTh: nameTh.trim(),
          nameEn: nameEn.trim() || undefined,
          password,
          role,
          employeeId: role === 'user' ? employeeId || null : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error ?? tx('เพิ่มผู้ใช้ไม่สำเร็จ'), true);
        return;
      }
      toast(`${tx('เพิ่มผู้ใช้')} "${data.nameTh}"`);
      setUsername('');
      setNameTh('');
      setNameEn('');
      setPassword('');
      setRole('user');
      setEmployeeId('');
      load();
    } catch {
      toast(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'), true);
    } finally {
      setAdding(false);
    }
  }

  async function patchUser(target: string, body: Record<string, unknown>) {
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(target)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) toast(data.error ?? tx('แก้ไขไม่สำเร็จ'), true);
      load();
    } catch {
      toast(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'), true);
    }
  }

  function startEdit(u: UserRow) {
    setEditing(u.username);
    setEditNameTh(u.nameTh);
    setEditNameEn(u.nameEn ?? '');
  }

  function cancelEdit() {
    setEditing(null);
  }

  async function saveEditName(username: string) {
    if (!editNameTh.trim()) {
      toast(tx('กรอก username, ชื่อ และรหัสผ่านให้ครบ'), true);
      return;
    }
    setSavingName(true);
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(username)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nameTh: editNameTh.trim(), nameEn: editNameEn.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error ?? tx('แก้ไขชื่อไม่สำเร็จ'), true);
        return;
      }
      toast(tx('แก้ไขชื่อแล้ว'));
      setEditing(null);
      load();
    } catch {
      toast(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'), true);
    } finally {
      setSavingName(false);
    }
  }

  async function toggleActive(u: UserRow) {
    if (u.active) {
      const ok = await confirm({
        title: tx('ปิดใช้งานผู้ใช้นี้?'),
        message: `${tx('ผู้ใช้')} "${u.nameTh}" ${tx('จะล็อกอินไม่ได้ทันที และเซสชันที่ล็อกอินอยู่ตอนนี้จะถูกเลิกทันที')}`,
        confirmLabel: tx('ปิดใช้งาน'),
      });
      if (!ok) return;
    }
    await patchUser(u.username, { active: !u.active });
  }

  async function deleteUser(u: UserRow) {
    const ok = await confirm({
      title: tx('ลบผู้ใช้นี้?'),
      message: `${tx('ผู้ใช้')} "${u.nameTh}" ${tx('จะถูกลบทิ้งถาวร ล็อกอินไม่ได้อีก — กู้คืนไม่ได้')}`,
      confirmLabel: tx('ลบ'),
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(u.username)}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error ?? tx('ลบไม่สำเร็จ'), true);
        return;
      }
      toast(tx('ลบผู้ใช้แล้ว'));
      load();
    } catch {
      toast(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'), true);
    }
  }

  async function resetPassword(u: UserRow) {
    const newPassword = await prompt({
      title: tx('ตั้งรหัสผ่านใหม่'),
      message: `${tx('ให้')} "${u.nameTh}" ${tx('(อย่างน้อย 8 ตัวอักษร) — เซสชันที่ล็อกอินอยู่จะถูกเลิกทันที')}`,
      placeholder: tx('รหัสผ่านใหม่'),
      confirmLabel: tx('ตั้งรหัสผ่าน'),
    });
    if (!newPassword) return;
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(u.username)}/reset-password`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error ?? tx('ตั้งรหัสผ่านไม่สำเร็จ'), true);
        return;
      }
      toast(tx('ตั้งรหัสผ่านใหม่แล้ว'));
    } catch {
      toast(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'), true);
    }
  }

  async function addRecipient() {
    if (!target.trim()) {
      toast(tx('ต้องระบุปลายทาง (LINE user ID หรืออีเมล)'), true);
      return;
    }
    setAddingRecipient(true);
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
      loadRecipients();
    } catch {
      toast(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'), true);
    } finally {
      setAddingRecipient(false);
    }
  }

  async function removeRecipient(r: Recipient) {
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
      loadRecipients();
    } catch {
      toast(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'), true);
    }
  }

  function displayRecipientLabel(r: Recipient): string {
    if (r.channel !== 'line') return r.label;
    const known = knownLineUsers.find((k) => k.userId === r.target);
    return known?.displayName ?? r.label;
  }

  return (
    <>
      <Card title={tx('ผู้ใช้ระบบ')}>
        <div className="frm auto" style={{ background: 'var(--sunk)', border: '1px solid var(--hair)', borderRadius: 'var(--r-card)', padding: 18, marginBottom: 22 }}>
          <label>
            {`Username / ${tx('อีเมล')}`}
            <input value={username} onChange={(e) => setUsername(e.target.value)} />
          </label>
          <label>
            {tx('ชื่อ (ไทย)')}
            <input value={nameTh} onChange={(e) => setNameTh(e.target.value)} />
          </label>
          <label>
            {tx('ชื่อ (อังกฤษ)')}
            <input value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
          </label>
          <label>
            {tx('รหัสผ่าน (≥ 8 ตัวอักษร)')}
            {/* ไอคอนตาเปิด/ปิดอยู่ในช่องทางขวา แทนปุ่มข้อความ "แสดง/ซ่อน" (5 ต.ค. 69 เจ้าของระบบสั่ง) — แบบเดียวกับหน้าสมัครสมาชิก */}
            <div style={{ position: 'relative' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                style={{ width: '100%', paddingRight: 42 }}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? tx('ซ่อนรหัสผ่าน') : tx('แสดงรหัสผ่าน')}
                aria-pressed={showPassword}
                title={showPassword ? tx('ซ่อนรหัสผ่าน') : tx('แสดงรหัสผ่าน')}
                style={{
                  position: 'absolute',
                  right: 10,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  border: 'none',
                  background: 'none',
                  color: 'var(--mut)',
                  cursor: 'pointer',
                  display: 'flex',
                  padding: 4,
                }}
              >
                <Icon name={showPassword ? 'eye-off' : 'eye'} className="sm" />
              </button>
            </div>
          </label>
          <label>
            Role
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {tx(ROLE_LABEL[r])}
                </option>
              ))}
            </select>
          </label>
          {role === 'user' && (
            <label>
              {tx('ผูกพนักงาน')}
              <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
                <option value="">— {tx('ไม่ผูก')} —</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nameTh} — {e.customerName ?? '—'}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button className="btn pri" disabled={adding} onClick={addUser}>
            {adding ? tx('กำลังเพิ่ม…') : `+ ${tx('เพิ่มผู้ใช้')}`}
          </button>
        </div>

        {error ? (
          <ErrorState message={error} onRetry={load} />
        ) : (
        <div className="tw">
          <table>
            <thead>
              <tr>
                <th>Username</th>
                <th>{tx('ชื่อ')}</th>
                <th>Role</th>
                <th>{tx('พนักงานที่ผูก')}</th>
                <th>LINE</th>
                <th>{tx('จะได้รับแจ้งเตือนเรื่อง')}</th>
                <th>{tx('สถานะ')}</th>
                <th>{tx('สร้างเมื่อ')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users?.map((u) => {
                const self = u.username === currentUsername;
                return (
                  <tr key={u.username}>
                    <td className="docid">{u.username}</td>
                    <td>
                      {editing === u.username ? (
                        <div
                          className="name-edit"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !savingName) saveEditName(u.username);
                            if (e.key === 'Escape') cancelEdit();
                          }}
                        >
                          <input type="text" value={editNameTh} onChange={(e) => setEditNameTh(e.target.value)} placeholder={tx('ชื่อ (ไทย)')} autoFocus />
                          <input type="text" value={editNameEn} onChange={(e) => setEditNameEn(e.target.value)} placeholder={tx('ชื่อ (อังกฤษ)')} />
                          <div className="name-edit-actions">
                            <button className="btn pri sm" disabled={savingName} onClick={() => saveEditName(u.username)}>
                              {tx('บันทึก')}
                            </button>
                            <button className="btn ghost sm" disabled={savingName} onClick={cancelEdit}>
                              {tx('ยกเลิก')}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <span className="nm">{u.nameTh}</span>
                          {u.nameEn && <span className="sub">{u.nameEn}</span>}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className="selectchip">
                        <select
                          value={u.role}
                          disabled={self}
                          title={self ? tx('แก้ role ของตัวเองไม่ได้') : undefined}
                          onChange={(e) => patchUser(u.username, { role: e.target.value })}
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {tx(ROLE_LABEL[r])}
                            </option>
                          ))}
                        </select>
                      </span>
                    </td>
                    <td>
                      {u.role === 'user' ? (
                        <span className="selectchip grow">
                          <select
                            value={u.employeeId ?? ''}
                            onChange={(e) => patchUser(u.username, { employeeId: e.target.value || null })}
                          >
                            <option value="">— {tx('ไม่ผูก')} —</option>
                            {employees.map((e) => (
                              <option key={e.id} value={e.id}>
                                {e.nameTh} — {e.customerName ?? '—'}
                              </option>
                            ))}
                          </select>
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      {u.role === 'user' && !u.employeeId ? (
                        <span className="sub">{tx('ไม่ผูกพนักงาน')}</span>
                      ) : u.lineLinked ? (
                        <StatusPill tone="ok">{tx('ผูกไลน์แล้ว')}</StatusPill>
                      ) : (
                        <StatusPill tone="mu">{tx('ยังไม่ผูก')}</StatusPill>
                      )}
                    </td>
                    <td className="sub">{tx(ROLE_NOTIFY_LABEL[u.role] ?? '—')}</td>
                    <td>
                      <label
                        className={`toggle${u.active ? ' on' : ''}`}
                        title={self ? tx('ปิดใช้งานบัญชีของตัวเองไม่ได้') : undefined}
                      >
                        <input type="checkbox" checked={u.active} disabled={self} onChange={() => toggleActive(u)} />
                        <span className="tk" />
                        <span className="tl">{u.active ? tx('ใช้งานอยู่') : tx('ปิดใช้งาน')}</span>
                      </label>
                    </td>
                    <td className="sub">{u.createdAt.slice(0, 10)}</td>
                    <td>
                      <div className="rowacts">
                        <button className="btn sm icon" title={tx('แก้ไขชื่อ')} aria-label={tx('แก้ไขชื่อ')} onClick={() => startEdit(u)}>
                          <Icon name="edit" />
                        </button>
                        <button className="btn ghost sm" onClick={() => resetPassword(u)}>
                          <Icon name="rf" className="sm" /> {tx('รีเซ็ตรหัสผ่าน')}
                        </button>
                        <button
                          className="btn sm icon dgr"
                          disabled={self}
                          title={self ? tx('ลบบัญชีของตัวเองไม่ได้') : tx('ลบผู้ใช้นี้')}
                          aria-label={tx('ลบ')}
                          onClick={() => deleteUser(u)}
                        >
                          <Icon name="trash" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!users && (
                <tr>
                  <td colSpan={9}>
                    <Loading rows={4} />
                  </td>
                </tr>
              )}
              {users && users.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', color: 'var(--mut)' }}>
                    {tx('ยังไม่มีผู้ใช้')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        )}
        <div className="sub" style={{ padding: '14px 4px 0' }}>
          {tx('แต่ละคนผูกไลน์ของตัวเองได้จากเมนู "เชื่อมต่อ LINE" — ไม่ต้องมาผูกให้ที่นี่')}
        </div>
      </Card>

      <Card
        title={tx('ผู้รับแจ้งเตือน (เพิ่มเอง)')}
        right={<span className="sub">{tx('เผื่อกรณีพิเศษ เช่น อีเมลแผนก/LINE กลุ่ม — บัญชีในระบบผูกไลน์เองได้แล้วด้านบน ไม่ต้องเพิ่มซ้ำที่นี่')}</span>}
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
          <button className="btn pri" disabled={addingRecipient} onClick={addRecipient}>
            {addingRecipient ? tx('กำลังเพิ่ม…') : `+ ${tx('เพิ่ม')}`}
          </button>
        </div>

        {recipientError ? (
          <ErrorState message={recipientError} onRetry={loadRecipients} />
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
                  <td>{displayRecipientLabel(r)}</td>
                  <td className="sub">{r.target}</td>
                  <td>
                    <button className="btn ghost sm" onClick={() => removeRecipient(r)} style={{ color: 'var(--cr)' }}>
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
