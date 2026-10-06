'use client';

import { useEffect, useMemo, useState } from 'react';
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

const ROLES = ['user', 'accounting', 'admin', 'executive'];
/** ลำดับการ์ด role ด้านบน — จากสิทธิ์มากไปน้อย อ่านแล้วเห็นลำดับชั้นของระบบทันที */
const ROLE_ORDER = ['admin', 'accounting', 'user', 'executive'];
/** หน้าที่หลักของแต่ละ role — ขึ้นบนการ์ด role และในฟอร์มเพิ่มผู้ใช้ ให้คนกำหนดสิทธิ์เห็นว่าเลือกแล้วได้อะไร */
const ROLE_DESC: Record<string, string> = {
  admin: 'ทุกอย่าง รวมตั้งค่าระบบและจัดการผู้ใช้',
  accounting: 'อัปโหลด/ตรวจ Timesheet, ตรวจ Manday, วางบิล',
  user: 'ส่ง Timesheet และดูความคืบหน้าของตัวเอง',
  executive: 'ดูภาพรวมข้ามบริษัทอย่างเดียว',
};
const ROLE_ICON: Record<string, string> = { admin: 'cog', accounting: 'invoice', user: 'idcard', executive: 'monitor' };
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

/**
 * "ผู้ใช้ระบบ" — รวมเข้ากับแท็บ "ผู้รับแจ้งเตือน" เดิมทั้งหมดแล้ว (25 ก.ย. 69 ตามที่ขอ "หน้านี้รวมกับ
 * ผู้รับแจ้งเตือนเลย") เหตุผล: ตารางผู้ใช้กับตารางสถานะผูกไลน์ที่แยกกันอยู่ก่อนหน้านี้คือข้อมูลชุดเดียวกัน
 * (คนเดียวกัน) แค่คนละมุมมอง — เดิม "ใครเป็นใคร" (StaffLineStatusTable) เห็นแค่ admin/accounting เท่านั้น
 * (role 'user' ไม่เคยโผล่เลยทั้งที่ผูกไลน์ได้เหมือนกันผ่าน Employee.lineUserId) มาแสดงรวมในตารางเดียวที่นี่
 * ให้ครบทุก role แทน — ส่วนฟอร์ม "เพิ่มผู้รับแจ้งเตือนเอง" เอาออกแล้ว (5 ต.ค. 69 ตามที่เจ้าของระบบสั่ง: แต่ละ role ผูกไลน์รับแจ้งเตือน
 * ตาม role เอง ไม่ต้องให้แอดมินเพิ่มให้)
 */
export default function UsersTab({ currentUsername }: { currentUsername: string }) {
  const toast = useToast();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const { tx, formatDate } = useLang();
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

  // ฟอร์มเพิ่มผู้ใช้พับเก็บไว้เป็นค่าเริ่มต้น (5 ต.ค. 69 ปรับ UX ตามที่ขอ) — เดิมเป็นแถวช่องกรอก 7 ช่องเรียง
  // ยาวค้างอยู่บนตารางตลอด ทั้งที่เพิ่มผู้ใช้นานๆ ครั้ง งานหลักของหน้านี้คือดู/แก้สิทธิ์คนที่มีอยู่แล้ว
  const [showAdd, setShowAdd] = useState(false);
  const [roleFilter, setRoleFilter] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const [editing, setEditing] = useState<string | null>(null);
  const [editNameTh, setEditNameTh] = useState('');
  const [editNameEn, setEditNameEn] = useState('');
  const [savingName, setSavingName] = useState(false);

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

  useEffect(() => {
    load();
    fetch('/api/employees', { cache: 'no-store' })
      .then((r) => r.json())
      .then(setEmployees)
      .catch(() => setEmployees([]));
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
      setShowAdd(false);
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

  const roleCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const u of users ?? []) c[u.role] = (c[u.role] ?? 0) + 1;
    return c;
  }, [users]);
  const visibleUsers = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (users ?? []).filter(
      (u) =>
        (!roleFilter || u.role === roleFilter) &&
        (!q || [u.username, u.nameTh, u.nameEn ?? ''].some((v) => v.toLowerCase().includes(q))),
    );
  }, [users, roleFilter, query]);

  return (
    <>
      <Card
        title={tx('ผู้ใช้ระบบ')}
        right={
          <button className={`btn sm ${showAdd ? 'ghost' : 'pri'}`} onClick={() => setShowAdd((v) => !v)}>
            {showAdd ? tx('ปิดฟอร์ม') : `+ ${tx('เพิ่มผู้ใช้')}`}
          </button>
        }
      >
        {/* การ์ดสรุปตาม role — บอกจำนวนคน หน้าที่ และเรื่องที่ได้รับแจ้งเตือนทาง LINE ในที่เดียว (เดิมข้อความ
            แจ้งเตือนซ้ำอยู่ทุกแถวของตารางจนตารางแน่น) กดการ์ดเพื่อกรองตาราง กดซ้ำเพื่อยกเลิก */}
        <div className="urole-grid">
          {ROLE_ORDER.map((r) => (
            <button
              key={r}
              type="button"
              className={`urole r-${r}${roleFilter === r ? ' on' : ''}`}
              onClick={() => setRoleFilter((cur) => (cur === r ? null : r))}
              aria-pressed={roleFilter === r}
            >
              <span className="urole-top">
                <span className="urole-ic">
                  <Icon name={ROLE_ICON[r]} className="sm" />
                </span>
                <b>{tx(ROLE_LABEL[r])}</b>
                <span className="urole-n">{roleCounts[r] ?? 0}</span>
              </span>
              <span className="urole-desc">{tx(ROLE_DESC[r])}</span>
              <span className="urole-ln">
                <Icon name="bell" className="sm" /> {tx(ROLE_NOTIFY_LABEL[r] === '—' ? 'ไม่มีแจ้งเตือนทาง LINE' : ROLE_NOTIFY_LABEL[r])}
              </span>
            </button>
          ))}
        </div>

        {showAdd && (
          <div className="uadd">
            <div className="uadd-h">
              <b>{tx('เพิ่มผู้ใช้ใหม่')}</b>
              <span className="sub">{tx('กรอกข้อมูลบัญชี แล้วเลือกสิทธิ์การใช้งาน')}</span>
            </div>
            <div className="frm uadd-grid">
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
            </div>
            <div className="uadd-sec">{tx('สิทธิ์การใช้งาน (Role)')}</div>
            <div className="urole-pick">
              {ROLE_ORDER.map((r) => (
                <label key={r} className={`urole-opt r-${r}${role === r ? ' on' : ''}`}>
                  <input type="radio" name="new-user-role" value={r} checked={role === r} onChange={() => setRole(r)} />
                  <span className="urole-ic">
                    <Icon name={ROLE_ICON[r]} className="sm" />
                  </span>
                  <span>
                    <b>{tx(ROLE_LABEL[r])}</b>
                    <span className="sub">{tx(ROLE_DESC[r])}</span>
                  </span>
                </label>
              ))}
            </div>
            {role === 'user' && (
              <div className="frm uadd-grid" style={{ marginTop: 14 }}>
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
              </div>
            )}
            <div className="uadd-foot">
              <button className="btn ghost" disabled={adding} onClick={() => setShowAdd(false)}>
                {tx('ยกเลิก')}
              </button>
              <button className="btn pri" disabled={adding} onClick={addUser}>
                {adding ? tx('กำลังเพิ่ม…') : `+ ${tx('เพิ่มผู้ใช้')}`}
              </button>
            </div>
          </div>
        )}

        <div className="utool">
          <div className="usearch">
            <Icon name="search" className="sm" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tx('ค้นหาชื่อ / username / อีเมล')}
              aria-label={tx('ค้นหาผู้ใช้')}
            />
          </div>
          <span className="sub">
            {roleFilter ? `${tx('กรอง')}: ${tx(ROLE_LABEL[roleFilter])} · ` : ''}
            {visibleUsers.length} / {users?.length ?? 0} {tx('คน')}
          </span>
          {(roleFilter || query) && (
            <button className="btn ghost sm" onClick={() => { setRoleFilter(null); setQuery(''); }}>
              {tx('ล้างตัวกรอง')}
            </button>
          )}
        </div>

        {error ? (
          <ErrorState message={error} onRetry={load} />
        ) : (
        <div className="tw">
          <table>
            <thead>
              <tr>
                <th>{tx('ผู้ใช้')}</th>
                <th>Role</th>
                <th>{tx('พนักงานที่ผูก')}</th>
                <th>LINE</th>
                <th>{tx('สถานะ')}</th>
                <th>{tx('สร้างเมื่อ')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users && visibleUsers.map((u) => {
                const self = u.username === currentUsername;
                return (
                  <tr key={u.username} className={u.active ? undefined : 'uinactive'}>
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
                        <div className="uwho">
                          <span className={`uav r-${u.role}`}>{(u.nameEn || u.nameTh || u.username).trim().charAt(0).toUpperCase()}</span>
                          <span className="uwho-t">
                            <span className="nm">
                              {u.nameTh}
                              {self && <Tag tone="pr">{tx('คุณ')}</Tag>}
                            </span>
                            <span className="sub">{u.username}</span>
                            {u.nameEn && u.nameEn !== u.nameTh && <span className="sub">{u.nameEn}</span>}
                          </span>
                        </div>
                      )}
                    </td>
                    <td>
                      <span className={`selectchip urole-sel r-${u.role}`}>
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
                        <span className="sub">—</span>
                      )}
                    </td>
                    <td title={tx(ROLE_NOTIFY_LABEL[u.role] ?? '—')}>
                      {u.role === 'user' && !u.employeeId ? (
                        <span className="sub">{tx('ไม่ผูกพนักงาน')}</span>
                      ) : u.lineLinked ? (
                        <StatusPill tone="ok">{tx('ผูกไลน์แล้ว')}</StatusPill>
                      ) : (
                        <StatusPill tone="mu">{tx('ยังไม่ผูก')}</StatusPill>
                      )}
                    </td>
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
                    <td className="sub" style={{ whiteSpace: 'nowrap' }}>{formatDate(u.createdAt)}</td>
                    <td>
                      <div className="rowacts">
                        <button className="btn sm icon" title={tx('แก้ไขชื่อ')} aria-label={tx('แก้ไขชื่อ')} onClick={() => startEdit(u)}>
                          <Icon name="edit" />
                        </button>
                        <button className="btn sm icon" title={tx('รีเซ็ตรหัสผ่าน')} aria-label={tx('รีเซ็ตรหัสผ่าน')} onClick={() => resetPassword(u)}>
                          <Icon name="rf" />
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
                  <td colSpan={7}>
                    <Loading rows={4} />
                  </td>
                </tr>
              )}
              {users && visibleUsers.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', color: 'var(--mut)' }}>
                    {tx(users.length === 0 ? 'ยังไม่มีผู้ใช้' : 'ไม่พบผู้ใช้ที่ตรงกับตัวกรอง')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        )}
        <div className="note" style={{ marginTop: 16 }}>
          <Icon name="info" />
          <span>{tx('แต่ละคนผูกไลน์ของตัวเองได้จากเมนู "เชื่อมต่อ LINE" — ไม่ต้องมาผูกให้ที่นี่')} · {tx('ชี้ที่สถานะ LINE เพื่อดูว่าจะได้รับแจ้งเตือนเรื่องอะไร')}</span>
        </div>
      </Card>
    </>
  );
}
