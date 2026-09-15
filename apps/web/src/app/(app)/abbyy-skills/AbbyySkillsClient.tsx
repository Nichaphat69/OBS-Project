'use client';

import { Fragment, useEffect, useState } from 'react';
import { Card, ErrorState, Tag } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { useConfirm, useToast } from '../../../components/Overlays';
import { useLang } from '../../../lib/language';

/** ตรงกับ AbbyyFieldMap ใน apps/api/src/lib/abbyyClient.ts — ชื่อฟิลด์จริงใน ABBYY Vantage ของ Skill
 * นี้ ไม่ตรงกันข้าม Skill เลย (เช่น "Employee Name" vs "Name" vs "Mounth" สะกดผิด) ต้องตั้งต่อ Skill */
interface AbbyyFieldMap {
  employeeName?: string;
  position?: string;
  monthYear?: string | null;
  month?: string | null;
  year?: string | null;
  tableName?: string;
  totalWorkDays?: string | null;
}

interface AbbyySkillRow {
  id: string;
  name: string;
  skillId: string;
  createdAt: string;
  fieldMap: AbbyyFieldMap | null;
}

const FIELD_MAP_KEYS: Array<keyof AbbyyFieldMap> = ['employeeName', 'position', 'monthYear', 'month', 'year', 'tableName', 'totalWorkDays'];

function emptyDraft(map: AbbyyFieldMap | null): Record<keyof AbbyyFieldMap, string> {
  const draft = {} as Record<keyof AbbyyFieldMap, string>;
  for (const k of FIELD_MAP_KEYS) draft[k] = map?.[k] ?? '';
  return draft;
}

export default function AbbyySkillsClient() {
  const toast = useToast();
  const confirm = useConfirm();
  const { tx } = useLang();
  const [skills, setSkills] = useState<AbbyySkillRow[] | null>(null);
  const [name, setName] = useState('');
  const [skillId, setSkillId] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<keyof AbbyyFieldMap, string>>(emptyDraft(null));
  const [savingMap, setSavingMap] = useState(false);

  function load() {
    setError(null);
    fetch('/api/abbyy-skills', { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          setError(data?.error ?? tx('โหลดข้อมูลไม่สำเร็จ'));
          return;
        }
        setSkills(await r.json());
      })
      .catch(() => setError(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้')));
  }

  useEffect(load, []);

  async function add() {
    if (!name.trim() || !skillId.trim()) {
      toast(tx('กรอกชื่อ Skill และ Skill ID ให้ครบก่อน'), true);
      return;
    }
    setAdding(true);
    try {
      const res = await fetch('/api/abbyy-skills', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), skillId: skillId.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error ?? tx('เพิ่มไม่สำเร็จ'), true);
        return;
      }
      toast(`${tx('เพิ่ม Skill')} "${data.name}"`);
      setName('');
      setSkillId('');
      load();
    } catch {
      toast(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'), true);
    } finally {
      setAdding(false);
    }
  }

  async function remove(row: AbbyySkillRow) {
    const ok = await confirm({
      title: tx('ลบ Skill นี้?'),
      message: (
        <>
          Skill &quot;<b>{row.name}</b>&quot; {tx('จะหายไปจากรายการให้เลือก — สัญญาที่เคยเลือก Skill นี้ไปแล้วยังใช้งานได้ปกติ ไม่กระทบ')}
        </>
      ),
      confirmLabel: tx('ลบ'),
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/abbyy-skills/${encodeURIComponent(row.id)}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error ?? tx('ลบไม่สำเร็จ'), true);
        return;
      }
      toast(tx('ลบ Skill แล้ว'));
      load();
    } catch {
      toast(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'), true);
    }
  }

  function toggleFieldMap(row: AbbyySkillRow) {
    if (expandedId === row.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(row.id);
    setDraft(emptyDraft(row.fieldMap));
  }

  async function saveFieldMap(id: string) {
    setSavingMap(true);
    try {
      const hasAny = FIELD_MAP_KEYS.some((k) => draft[k].trim());
      const fieldMap: AbbyyFieldMap | null = hasAny
        ? {
            employeeName: draft.employeeName.trim() || undefined,
            position: draft.position.trim() || undefined,
            monthYear: draft.monthYear.trim() || null,
            month: draft.month.trim() || null,
            year: draft.year.trim() || null,
            tableName: draft.tableName.trim() || undefined,
            totalWorkDays: draft.totalWorkDays.trim() || null,
          }
        : null;
      const res = await fetch(`/api/abbyy-skills/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fieldMap }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error ?? tx('บันทึกไม่สำเร็จ'), true);
        return;
      }
      toast(tx('บันทึก field map แล้ว'));
      setExpandedId(null);
      load();
    } catch {
      toast(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'), true);
    } finally {
      setSavingMap(false);
    }
  }

  return (
    <Card title={tx('สารบัญ Skill ABBYY')}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px,1fr))', gap: 14, marginBottom: 18, alignItems: 'end' }}>
        <label>
          <div className="ey">{tx('ชื่อ Skill')}</div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="เช่น OBS Timesheet - Thailife"
            style={{ marginTop: 6, width: '100%', height: 38, borderRadius: 'var(--r-ctl)', border: '1px solid var(--rule)', padding: '0 12px' }}
          />
        </label>
        <label>
          <div className="ey">Skill ID</div>
          <input
            value={skillId}
            onChange={(e) => setSkillId(e.target.value)}
            placeholder="เช่น 89aa1af3-1e04-4477-9b91-00023980402c"
            style={{ marginTop: 6, width: '100%', height: 38, borderRadius: 'var(--r-ctl)', border: '1px solid var(--rule)', padding: '0 12px' }}
          />
        </label>
        <button className="btn pri" disabled={adding} onClick={add}>
          {adding ? tx('กำลังเพิ่ม…') : `+ ${tx('เพิ่ม Skill ใหม่')}`}
        </button>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : (
      <div className="tw">
        <table>
          <thead>
            <tr>
              <th>{tx('ชื่อ Skill')}</th>
              <th>Skill ID</th>
              <th>{tx('สร้างเมื่อ')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {skills?.map((s) => {
              const hasCustomMap = !!s.fieldMap && Object.values(s.fieldMap).some((v) => v);
              const expanded = expandedId === s.id;
              return (
                <Fragment key={s.id}>
                  <tr>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {s.name}
                        {hasCustomMap && <Tag tone="pr">{tx('กำหนดฟิลด์เองแล้ว')}</Tag>}
                      </div>
                    </td>
                    <td className="sub" style={{ wordBreak: 'break-all' }}>{s.skillId}</td>
                    <td className="sub">{s.createdAt.slice(0, 10)}</td>
                    <td>
                      <div className="rowacts">
                        <button
                          className="btn sm icon"
                          title={tx('การจับคู่ฟิลด์ (Field map)')}
                          aria-label={tx('การจับคู่ฟิลด์ (Field map)')}
                          onClick={() => toggleFieldMap(s)}
                        >
                          <Icon name="cog" />
                        </button>
                        <button className="btn sm icon dgr" title={tx('ลบ Skill นี้')} aria-label={tx('ลบ')} onClick={() => remove(s)}>
                          <Icon name="trash" />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expanded && (
                    <tr>
                      <td colSpan={4} style={{ background: 'var(--sunk)', padding: 18 }}>
                        <div className="ey" style={{ marginBottom: 8 }}>{tx('การจับคู่ฟิลด์ (Field map)')}</div>
                        <div className="sub" style={{ marginBottom: 14 }}>
                          {tx('ชื่อฟิลด์จริงใน ABBYY Vantage ของ Skill นี้ — เว้นว่างช่องไหนไว้เพื่อใช้ค่าเริ่มต้น (Employee Name/Position/Month Year/New Table) รอบเดือนเลือกได้ระหว่าง "ฟิลด์รวม" หรือ "แยกเดือน+ปี" ถ้ากรอกฟิลด์รวมไว้ ระบบจะใช้ตัวนั้นก่อนเสมอ')}
                        </div>
                        <div className="frm auto" style={{ gap: 14 }}>
                          <label>
                            {tx('ชื่อพนักงาน (Employee Name)')}
                            <input value={draft.employeeName} onChange={(e) => setDraft((d) => ({ ...d, employeeName: e.target.value }))} placeholder="Employee Name" />
                          </label>
                          <label>
                            {tx('ตำแหน่ง (Position)')}
                            <input value={draft.position} onChange={(e) => setDraft((d) => ({ ...d, position: e.target.value }))} placeholder="Position" />
                          </label>
                          <label>
                            {tx('รอบเดือน — ฟิลด์รวม (Month Year)')}
                            <input value={draft.monthYear} onChange={(e) => setDraft((d) => ({ ...d, monthYear: e.target.value }))} placeholder="Month Year" />
                          </label>
                          <label>
                            {tx('รอบเดือน — เดือน (แยก)')}
                            <input value={draft.month} onChange={(e) => setDraft((d) => ({ ...d, month: e.target.value }))} placeholder="Month" />
                          </label>
                          <label>
                            {tx('รอบเดือน — ปี (แยก)')}
                            <input value={draft.year} onChange={(e) => setDraft((d) => ({ ...d, year: e.target.value }))} placeholder="Year" />
                          </label>
                          <label>
                            {tx('ตารางรายวัน (Table)')}
                            <input value={draft.tableName} onChange={(e) => setDraft((d) => ({ ...d, tableName: e.target.value }))} placeholder="New Table" />
                          </label>
                          <label>
                            {tx('จำนวนวันทำงานรวม (ถ้ามี)')}
                            <input value={draft.totalWorkDays} onChange={(e) => setDraft((d) => ({ ...d, totalWorkDays: e.target.value }))} placeholder="Total Work days" />
                          </label>
                        </div>
                        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                          <button className="btn pri sm" disabled={savingMap} onClick={() => saveFieldMap(s.id)}>
                            {tx('บันทึก')}
                          </button>
                          <button className="btn ghost sm" disabled={savingMap} onClick={() => setExpandedId(null)}>
                            {tx('ยกเลิก')}
                          </button>
                          {hasCustomMap && (
                            <button
                              className="btn ghost sm"
                              disabled={savingMap}
                              onClick={() => setDraft(emptyDraft(null))}
                            >
                              {tx('ล้างกลับเป็นค่าเริ่มต้น')}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {skills && skills.length === 0 && (
              <tr>
                <td colSpan={4} style={{ textAlign: 'center', color: 'var(--mut)' }}>
                  {tx('ยังไม่มี Skill ในสารบัญ')}
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
