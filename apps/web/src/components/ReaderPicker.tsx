'use client';

import { useEffect, useState } from 'react';
import { useLang } from '../lib/language';

export interface ReaderInfo {
  id: string;
  label: string;
  configured: boolean;
  active: boolean;
}
export interface SkillInfo {
  id: string;
  name: string;
  skillId: string;
}

export interface ReaderPickerState {
  readers: ReaderInfo[];
  readerId: string | null;
  setReaderId: (id: string | null) => void;
  /** readerId ที่จะใช้จริง — null = ยังไม่ได้เลือกเอง ใช้ตัวที่ระบบตั้งไว้ (พฤติกรรมเดิม) */
  chosenReaderId: string | null;
  skills: SkillInfo[];
  abbyySkillId: string | null;
  setAbbyySkillId: (id: string | null) => void;
}

/**
 * ดึงรายชื่อตัวอ่าน (ABBYY/Clear Read) + Skill ของ ABBYY มาไว้ให้เลือก "เฉพาะรอบนี้" โดยไม่แก้ค่าที่ตั้งไว้
 * ทั้งระบบ — แยกออกมาจาก UploadFileTab.tsx (25 ก.ย. 69 ตามที่ขอ) เพราะแท็บ "รอจากพนักงาน"/"ดึงจาก Gmail"
 * ต้องมีตัวเลือกเดียวกันนี้ด้วยตอนอ่านแบบเลือกหลายรายการพร้อมกัน — ใช้ตัวเดียวกันทั้งสามจุด ไม่เขียนซ้ำ
 */
export function useReaderPicker(): ReaderPickerState {
  const [readers, setReaders] = useState<ReaderInfo[]>([]);
  const [readerId, setReaderId] = useState<string | null>(null);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [abbyySkillId, setAbbyySkillId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/settings/readers', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { readers: [] }))
      // local-llm เป็นตัวสำรองสุดท้ายที่ระบบเรียกเองเมื่อ ABBYY กับ Clear Read ล้มทั้งคู่ ไม่ใช่ตัวเลือก
      // ของคน จึงไม่ต้องมีปุ่มของตัวเองที่นี่ (เหมือนที่หน้า "ตัวอ่าน Timesheet" ตัดออกไปแล้ว)
      .then((d) => setReaders((d.readers ?? []).filter((r: ReaderInfo) => r.id !== 'local-llm')))
      .catch(() => setReaders([]));

    fetch('/api/abbyy-skills', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => setSkills(Array.isArray(rows) ? rows : []))
      .catch(() => setSkills([]));
  }, []);

  const chosenReaderId = readerId ?? readers.find((r) => r.active)?.id ?? null;

  return { readers, readerId, setReaderId, chosenReaderId, skills, abbyySkillId, setAbbyySkillId };
}

/** แถบเลือกตัวอ่าน/Skill แบบกะทัดรัด — ใช้ในแถบเลือกหลายรายการของแท็บ "รอจากพนักงาน"/"ดึงจาก Gmail"
 * (หน้าตาอ้างอิงจากภาพที่เจ้าของระบบส่งมา 25 ก.ย. 69) ใช้คลาส CSS ชุดเดียวกับที่แท็บ "อัปโหลดไฟล์" มีอยู่
 * แล้ว (.readerpick/.readeropt) แค่ไม่มี margin-top เพราะอยู่ในแถบแนวนอนเดียวกัน ไม่ใช่บล็อกแยก */
export function ReaderPickerBar({ picker, disabled }: { picker: ReaderPickerState; disabled?: boolean }) {
  const { tx } = useLang();
  const { readers, chosenReaderId, setReaderId, skills, abbyySkillId, setAbbyySkillId } = picker;

  if (readers.length === 0) return null;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <div className="readerpick" style={{ margin: 0 }}>
        <span className="lbl">{tx('อ่านด้วย')}</span>
        {readers.map((r) => {
          const slowHint = r.id === 'clear-read' ? tx('Clear Read อ่านช้ากว่า ABBYY มาก — ราว 3 นาทีต่อหนึ่งหน้า') : undefined;
          return (
            <button
              key={r.id}
              type="button"
              className={`rp${chosenReaderId === r.id ? ' on' : ''}`}
              disabled={!r.configured || disabled}
              title={!r.configured ? tx('ยังตั้งค่าไม่ครบ') : slowHint}
              onClick={() => setReaderId(r.id)}
            >
              {r.label}
            </button>
          );
        })}
      </div>

      {chosenReaderId === 'abbyy' && skills.length > 0 && (
        <div className="readeropt" style={{ margin: 0 }}>
          <label className="lbl" htmlFor="bulk-abbyy-skill">{tx('Skill ที่ใช้อ่าน')}</label>
          <select
            id="bulk-abbyy-skill"
            value={abbyySkillId ?? ''}
            disabled={disabled}
            onChange={(e) => setAbbyySkillId(e.target.value || null)}
          >
            <option value="">{tx('ตาม Skill ที่ผูกกับสัญญานี้')}</option>
            {skills.map((s) => (
              <option key={s.skillId} value={s.skillId}>{s.name}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
