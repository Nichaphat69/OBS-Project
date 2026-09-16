'use client';

import { useEffect, useState } from 'react';
import { Card, ErrorState, PageHeader, Tag } from '../../../components/ui';
import AbbyySkillsManager from '../../../components/AbbyySkillsManager';
import { Icon } from '../../../components/Icon';
import { useConfirm, useToast } from '../../../components/Overlays';
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

/** การ์ดมีสองใบตามที่ผู้ใช้ขอ — local-llm เป็นตัวสำรองสุดท้าย ไม่ต้องมีการ์ดของตัวเอง แต่ถ้ามันคือ
 * ตัวที่ทำงานอยู่จริง หน้าต้องไม่ทำให้เข้าใจว่า ABBYY กำลังทำงาน (ดูแถบเตือนด้านล่าง) */
const CARDS = [
  { id: 'abbyy', cls: 'ab', mark: 'AB', desc: 'อ่านด้วย Skill ที่เทรนไว้ต่อฟอร์มลูกค้า' },
  { id: 'clear-read', cls: 'cr', mark: 'CR', desc: 'อ่านด้วยแม่แบบฟิลด์ พร้อมตาราง TimesheetDetails' },
] as const;

export default function ReadersClient() {
  const { tx } = useLang();
  const toast = useToast();
  const confirm = useConfirm();
  const [readers, setReaders] = useState<Reader[] | null>(null);
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
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
        // ค่าเริ่มต้นให้ดูตัวที่ใช้งานอยู่จริง ไม่ใช่ตัวแรกในลิสต์
        setSelected((cur) => cur ?? list.find((x) => x.active)?.id ?? CARDS[0].id);
      })
      .catch(() => setError(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้')));

    fetch('/api/abbyy-skills', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then(setSkills)
      .catch(() => setSkills([]));
  }

  useEffect(load, []);

  async function switchTo(reader: Reader) {
    const ok = await confirm({
      title: tx('เปลี่ยนตัวอ่าน Timesheet?'),
      message: `${tx('ไฟล์ที่อัปโหลดหลังจากนี้จะถูกอ่านด้วย')} ${reader.label} — ${tx('ใบที่อ่านไปแล้วไม่เปลี่ยนตาม')}`,
      confirmLabel: tx('เปลี่ยนมาใช้ตัวนี้'),
      // ไม่ใช่การลบ — ค่าเริ่มต้นของ confirm เป็นถังขยะ/ปุ่มแดง ซึ่งสื่อผิดกับการสลับตัวอ่าน
      iconName: 'rf',
      danger: false,
    });
    if (!ok) return;

    setSwitching(true);
    try {
      const res = await fetch('/api/settings/readers/active', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: reader.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data?.error ?? tx('เปลี่ยนตัวอ่านไม่สำเร็จ'), true);
        return;
      }
      // เชื่อค่าที่ API ตอบกลับมา ไม่ใช่เดาเองว่าเปลี่ยนสำเร็จ — active คำนวณจากตัวที่ระบบใช้จริง
      if (data.readers) setReaders(data.readers);
      toast(`${tx('เปลี่ยนมาใช้')} ${reader.label} ${tx('แล้ว')}`);
    } catch {
      toast(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'), true);
    } finally {
      setSwitching(false);
    }
  }

  const activeReader = readers?.find((r) => r.active) ?? null;
  const activeIsOffCard = !!activeReader && !CARDS.some((c) => c.id === activeReader.id);
  const view = selected ?? CARDS[0].id;

  return (
    <>
      <PageHeader
        eyebrow={tx('อ้างอิง')}
        title={tx('ตัวอ่าน Timesheet')}
        subtitle={tx('เลือกว่าจะให้ระบบใช้เครื่องมือไหนอ่านไฟล์ Timesheet ที่อัปโหลดเข้ามา เปลี่ยนได้ตลอด มีผลกับไฟล์ที่อ่านหลังจากนี้ ไม่กระทบใบที่อ่านไปแล้ว')}
      />

      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : !readers ? (
        <div className="sub">{tx('กำลังโหลด…')}</div>
      ) : (
        <>
          {/* ตัวที่ทำงานจริงไม่ใช่ตัวที่มีการ์ด — ต้องบอกให้ชัด ไม่ใช่ปล่อยให้เข้าใจว่า ABBYY ทำงานอยู่ */}
          {activeIsOffCard && (
            <div className="note wn">
              <Icon name="alt" />
              <span>
                <strong>{tx('ตอนนี้ระบบใช้')} {activeReader?.label}</strong>
                <br />
                {tx('ไม่ใช่ทั้ง ABBYY และ Clear Read — มักเกิดจากตัวที่ตั้งไว้ยังตั้งค่าไม่ครบ ระบบจึงถอยมาใช้ตัวสำรอง กดเลือกตัวที่ต้องการด้านล่างเพื่อกลับไปใช้')}
              </span>
            </div>
          )}

          <div className="rdpick">
            {CARDS.map((c) => {
              const r = readers.find((x) => x.id === c.id);
              if (!r) return null;
              const isActive = r.active;
              const isSel = view === c.id;
              const skillCount = c.id === 'abbyy' ? skills.length : 0;
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`rd ${c.cls}${isActive ? ' on' : ''}${isSel ? ' sel' : ''}${r.configured ? '' : ' off'}`}
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
                    {isActive ? (
                      <span className="live">{tx('กำลังใช้งาน')}</span>
                    ) : !r.configured ? (
                      <Tag tone="mu">{tx('ยังตั้งค่าไม่ครบ')}</Tag>
                    ) : (
                      <span
                        className="btn sm"
                        role="button"
                        tabIndex={0}
                        aria-disabled={switching}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!switching) switchTo(r);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            e.stopPropagation();
                            if (!switching) switchTo(r);
                          }
                        }}
                      >
                        {switching ? tx('กำลังเปลี่ยน…') : tx('เปลี่ยนมาใช้ตัวนี้')}
                      </span>
                    )}
                    <span className="meta">
                      {c.id === 'abbyy'
                        ? `${skillCount} Skill`
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
              <div className="empty">
                <div className="ic">
                  <Icon name="doc" className="lg" />
                </div>
                <div className="big">{tx('ยังเลือกแม่แบบจากหน้านี้ไม่ได้')}</div>
                <div className="sub" style={{ maxWidth: '52ch', margin: '0 auto' }}>
                  {tx('ฝั่งระบบหลังบ้านกำลังทำส่วนดึงรายการแม่แบบจาก Clear Read อยู่ เมื่อเสร็จแล้วหน้านี้จะจัดการได้เหมือนฝั่ง ABBYY — เลือกแม่แบบต่อสัญญา และจับคู่ฟิลด์ด้วยสารบัญฟิลด์กลางชุดเดียวกัน')}
                </div>
                <div className="sub" style={{ maxWidth: '52ch', margin: '10px auto 0' }}>
                  {tx('ระหว่างนี้สลับมาใช้ Clear Read ได้ แต่จะอ่านด้วยค่าเริ่มต้น ยังกำหนดแม่แบบต่อสัญญาไม่ได้')}
                </div>
              </div>
            </div>
          )}

          <Card title={tx('ข้อควรรู้ก่อนเปลี่ยน')}>
            <div className="sub" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span>· {tx('Clear Read อ่านช้ากว่า ABBYY มาก — ราว 3 นาทีต่อหนึ่งหน้า และถึงสิบนาทีกว่าถ้าไฟล์หลายหน้า ส่วน ABBYY ใช้เวลาไม่กี่วินาที')}</span>
              <span>· {tx('การเปลี่ยนมีผลกับไฟล์ที่อัปโหลดหลังจากนี้เท่านั้น ใบที่อ่านไปแล้วยังใช้ผลเดิม')}</span>
              <span>· {tx('ตัวที่ยังตั้งค่าไม่ครบจะเลือกไม่ได้ ระบบจะถอยไปใช้ตัวสำรองให้เองถ้าตัวที่ตั้งไว้ใช้งานไม่ได้')}</span>
            </div>
          </Card>
        </>
      )}
    </>
  );
}
