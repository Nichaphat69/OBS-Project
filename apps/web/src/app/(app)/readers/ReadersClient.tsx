'use client';

import { useEffect, useState } from 'react';
import { Card, ErrorState, PageHeader, Tag } from '../../../components/ui';
import AbbyySkillsManager from '../../../components/AbbyySkillsManager';
import ClearReadFieldCatalog from '../../../components/ClearReadFieldCatalog';
import { useLang } from '../../../lib/language';

interface Reader {
  id: string;
  label: string;
  configured: boolean;
  active: boolean;
}

/** ใช้แค่จำนวนเพื่อโชว์บนการ์ด — รายละเอียดทั้งหมดจัดการใน AbbyySkillsManager */
interface SkillRow {
  id: string;
}

/** การ์ดมีสองใบตามที่ผู้ใช้ขอ — local-llm เป็นตัวสำรองสุดท้ายที่ระบบเรียกเองเมื่ออีกสองตัวล้ม
 * ไม่ใช่ตัวเลือกของคน จึงไม่ต้องมีการ์ดของตัวเองในหน้าตั้งค่า */
const CARDS = [
  { id: 'abbyy', cls: 'ab', mark: 'AB', desc: 'อ่านด้วย Skill ที่เทรนไว้ต่อฟอร์มลูกค้า' },
  { id: 'clear-read', cls: 'cr', mark: 'CR', desc: 'อ่านด้วยแม่แบบฟิลด์ พร้อมตาราง TimesheetDetails' },
] as const;

export default function ReadersClient({ canSwitchTemplate }: { canSwitchTemplate: boolean }) {
  const { tx } = useLang();
  const [readers, setReaders] = useState<Reader[] | null>(null);
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setError(null);
    fetch('/api/settings/readers', { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          setError(data?.error ?? tx('โหลดข้อมูลไม่สำเร็จ'));
          return;
        }
        const data = await r.json();
        const list: Reader[] = data.readers ?? [];
        setReaders(list);
        // ไม่มีแนวคิด "ตัวที่ใช้งานอยู่" แล้ว — หน้านี้ตั้งค่าอย่างเดียว เปิดโซนแรกไว้ก่อน
        setSelected((cur) => cur ?? CARDS[0].id);
      })
      .catch(() => setError(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้')));

    fetch('/api/abbyy-skills', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then(setSkills)
      .catch(() => setSkills([]));
  }

  useEffect(load, []);

  const view = selected ?? CARDS[0].id;

  return (
    <>
      <PageHeader
        eyebrow={tx('อ้างอิง')}
        title={tx('ตัวอ่าน Timesheet')}
        subtitle={tx('ตั้งค่า Skill ของ ABBYY และแม่แบบของ Clear Read — เลือกว่าจะอ่านไฟล์ด้วยตัวไหนทำที่หน้าอัปโหลด Timesheet ตอนอ่านแต่ละครั้ง')}
      />

      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : !readers ? (
        <div className="sub">{tx('กำลังโหลด…')}</div>
      ) : (
        <>

          <div className="rdpick">
            {CARDS.map((c) => {
              const r = readers.find((x) => x.id === c.id);
              if (!r) return null;
              const isSel = view === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`rd ${c.cls}${isSel ? ' sel' : ''}`}
                  aria-pressed={isSel}
                  onClick={() => setSelected(c.id)}
                >
                  <span className="top">
                    <span className="mark">{c.mark}</span>
                    <span>
                      <span className="nm">{r.label}</span>
                      <span className="ds">{tx(c.desc)}</span>
                    </span>
                  </span>
                  <span className="state">
                    <Tag tone={r.configured ? 'ok' : 'mu'}>
                      {r.configured ? tx('พร้อมใช้งาน') : tx('ยังตั้งค่าไม่ครบ')}
                    </Tag>
                    <span className="meta">
                      {c.id === 'abbyy'
                        ? `${skills.length} Skill`
                        : tx('ช้ากว่า ABBYY มาก (หลักนาทีต่อหน้า)')}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {view === 'abbyy' ? (
            <div className="rdpanel ab">
              <div className="phead">
                <span className="pbar" />
                <span className="ptitle">{tx('Skill ของ ABBYY')}</span>
              </div>
              {/* ตัวจัดการ Skill ตัวเดียวกับหน้า /abbyy-skills — เพิ่ม/ตั้งค่าฟิลด์/ลบ ได้ครบจากตรงนี้
                  ไม่ต้องสลับหน้า และเป็นโค้ดชุดเดียวกันจึงไม่มีทางที่สองที่จะเพี้ยนจากกัน */}
              <AbbyySkillsManager embedded />
            </div>
          ) : (
            <div className="rdpanel cr">
              <div className="phead">
                <span className="pbar" />
                <span className="ptitle">{tx('แม่แบบของ Clear Read')}</span>
              </div>
              {/* ไม่มีการเลือกแม่แบบต่อสัญญาแล้ว — ระบบปักแม่แบบเดียวทั้งระบบ สิ่งที่คนตั้งค่าต้องเห็นจึงเป็น
                  "แม่แบบตัวนั้นอ่านอะไรบ้าง" คือรายการฟิลด์พร้อมคำอธิบายที่สั่งเครื่องอ่านจริง */}
              <ClearReadFieldCatalog canSwitch={canSwitchTemplate} />
            </div>
          )}

          <Card title={tx('ข้อควรรู้')}>
            <div className="sub" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span>· {tx('หน้านี้ใช้ตั้งค่าอย่างเดียว การเลือกว่าจะอ่านไฟล์ด้วยตัวไหนทำที่หน้าอัปโหลด Timesheet ตอนอ่านแต่ละครั้ง')}</span>
              <span>· {tx('Clear Read อ่านช้ากว่า ABBYY มาก — ราว 3 นาทีต่อหนึ่งหน้า และถึงสิบนาทีกว่าถ้าไฟล์หลายหน้า ส่วน ABBYY ใช้เวลาไม่กี่วินาที')}</span>
              <span>· {tx('ตัวที่ยังตั้งค่าไม่ครบจะเลือกตอนอ่านไม่ได้ ต้องตั้งค่าที่หน้านี้ให้ครบก่อน')}</span>
            </div>
          </Card>
        </>
      )}
    </>
  );
}
