'use client';

import { Fragment, useEffect, useState } from 'react';
import type { TimesheetFieldMap } from '@obs/domain';
import { Card, ErrorState, Tag } from './ui';
import { Icon } from './Icon';
import { TimesheetFieldMapEditor } from './TimesheetFieldMapEditor';
import { useConfirm, useToast } from './Overlays';
import { useLang } from '../lib/language';

interface AbbyySkillRow {
  id: string;
  name: string;
  skillId: string;
  createdAt: string;
  fieldMap: TimesheetFieldMap | null;
}

/** คีย์ของรูปเก่า (AbbyyFieldMap แบบแบนใน abbyyClient.ts) ที่วางอยู่ระดับบนสุด — รูปกลางไม่มีคีย์พวกนี้
 * เลย เพราะย้ายไปอยู่ใต้ header/monthYearSplit หมดแล้ว */
const LEGACY_KEYS = ['employeeName', 'position', 'monthYear', 'month', 'year', 'totalWorkDays'];

/** ฝั่ง API normalize รูปเก่าให้เป็นรูปกลางตั้งแต่ตอนอ่านแล้ว แต่ web กับ api คนละ image กัน จึงมีจังหวะ
 * ที่ web ใหม่คุยกับ api เก่าได้ ถ้าปล่อยให้รูปเก่าหลุดเข้าฟอร์มนี้ ฟอร์มจะวาดเป็นช่องว่างทั้งหมดทั้งที่
 * ของจริงมีค่าอยู่ พอกดบันทึกจะทับค่าที่ใช้งานอยู่หายทั้งชุด (Big-C มี 7 คีย์ รวม totalWorkDays ที่เป็น
 * ตัวตั้งจำนวนวันทำงานสำหรับวางบิล) — กันไว้ดีกว่าเขียนทับเงียบๆ */
function isLegacyShape(map: TimesheetFieldMap | null): boolean {
  if (!map || typeof map !== 'object') return false;
  return LEGACY_KEYS.some((k) => k in map);
}

/** Skill ที่ยังไม่เคยตั้งค่าเลยได้ `{ header: {} }` กลับมาจาก API (ไม่ใช่ null) — เช็คแค่ว่า section
 * มีอยู่ไหมจะกลายเป็นจริงเสมอ เพราะ object เปล่าก็ truthy ต้องนับคีย์ข้างในจริงๆ */
function hasAnyMapping(map: TimesheetFieldMap | null): boolean {
  if (!map) return false;
  if (map.header && Object.keys(map.header).length > 0) return true;
  if (map.detail && Object.keys(map.detail).length > 0) return true;
  if (map.tableName) return true;
  return !!map.monthYearSplit && !!(map.monthYearSplit.month || map.monthYearSplit.year);
}

/** ตัวห่อของตัวจัดการ Skill — ต้องอยู่ระดับไฟล์ ไม่ใช่ในตัวคอมโพเนนต์ (ดูเหตุผลที่คอมเมนต์ใน AbbyySkillsManager) */
function Shell({ embedded, title, children }: { embedded?: boolean; title: string; children: React.ReactNode }) {
  return embedded ? <div style={{ padding: '17px' }}>{children}</div> : <Card title={title}>{children}</Card>;
}

export default function AbbyySkillsManager({ embedded }: { embedded?: boolean }) {
  const toast = useToast();
  const confirm = useConfirm();
  const { tx } = useLang();
  const [skills, setSkills] = useState<AbbyySkillRow[] | null>(null);
  const [name, setName] = useState('');
  const [skillId, setSkillId] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TimesheetFieldMap>({});
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
    setDraft(row.fieldMap ?? {});
  }

  async function saveFieldMap(id: string) {
    setSavingMap(true);
    try {
      // ล้างทุกช่องแล้วบันทึก = ตั้งใจกลับไปใช้ค่า default ของตัวอ่าน ซึ่งฝั่ง API รับเป็น null — ไม่ใช่
      // เก็บ { header: {} } ไว้เป็นเปลือกเปล่า (ผลเหมือนกันก็จริง แต่ null บอกเจตนาได้ตรงกว่า)
      const fieldMap: TimesheetFieldMap | null = hasAnyMapping(draft) ? draft : null;
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

  // ฝังอยู่ในแผงของหน้า "ตัวอ่าน Timesheet" แล้วไม่ต้องมีการ์ดซ้อนการ์ดอีกชั้น ใช้โค้ดชุดเดียวกัน
  // ทั้งสองที่ เพื่อไม่ให้สองทางเข้าค่อยๆ ต่างกันไปคนละทาง
  // ⚠️ ห้ามประกาศตัวห่อ (Shell) ไว้ข้างในฟังก์ชันนี้ — เดิมประกาศไว้ตรงนี้ ทำให้ทุกครั้งที่พิมพ์ลงช่องใดช่องหนึ่ง
  // (setName/onChange) React เห็นเป็นคอมโพเนนต์ "ตัวใหม่" แล้วทิ้งทั้งฟอร์มสร้างใหม่ ช่องกรอกจึงเสียโฟกัสทุกตัวอักษร
  // พิมพ์ต่อไม่ได้ (เจอจริง 1 ต.ค. 69 ทั้งช่องเพิ่ม Skill และช่องจับคู่ชื่อฟิลด์ที่อยู่ข้างใน) ย้ายออกไปไว้ระดับไฟล์แล้ว
  return (
    <Shell embedded={embedded} title={tx('สารบัญ Skill ABBYY')}>
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
        {/* justifySelf: ไม่ให้ปุ่มยืดเต็มคอลัมน์ของกริด ไม่งั้นมันสูงเท่าช่องกรอกและกว้างเท่ากัน
            จนดูเป็นช่องที่สามของฟอร์มแทนที่จะเป็นปุ่มสั่งงาน */}
        <button className="btn pri sm" style={{ justifySelf: 'start' }} disabled={adding} onClick={add}>
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
              const hasCustomMap = hasAnyMapping(s.fieldMap);
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
                        {isLegacyShape(s.fieldMap) ? (
                          <div className="note wn">
                            <Icon name="alt" />
                            <span>
                              <strong>{tx('Skill นี้ยังเก็บค่าด้วยรูปแบบเดิม')}</strong>
                              <br />
                              {tx('ระบบยังอ่านค่าเดิมได้ตามปกติ แต่แก้ผ่านหน้านี้ยังไม่ได้จนกว่าฝั่ง API จะแปลงรูปให้ตอนอ่าน — ถ้าแก้ตอนนี้ค่าที่ตั้งไว้เดิมจะหายทั้งหมด')}
                            </span>
                          </div>
                        ) : (
                          <>
                            <TimesheetFieldMapEditor value={draft} onChange={setDraft} disabled={savingMap} />
                            <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
                              <button className="btn pri sm" disabled={savingMap} onClick={() => saveFieldMap(s.id)}>
                                {tx('บันทึก')}
                              </button>
                              <button className="btn ghost sm" disabled={savingMap} onClick={() => setExpandedId(null)}>
                                {tx('ยกเลิก')}
                              </button>
                              {hasCustomMap && (
                                <button className="btn ghost sm" disabled={savingMap} onClick={() => setDraft({})}>
                                  {tx('ล้างกลับเป็นค่าเริ่มต้น')}
                                </button>
                              )}
                            </div>
                          </>
                        )}
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
    </Shell>
  );
}
