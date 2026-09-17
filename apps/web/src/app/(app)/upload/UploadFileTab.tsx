'use client';

import { useEffect, useRef, useState } from 'react';
import { Card } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import ReviewCard, { type ReadResultShape } from './ReviewCard';
import ReadingCard from './ReadingCard';
import { useLang } from '../../../lib/language';

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '');
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function UploadFileTab() {
  const { tx } = useLang();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [reading, setReading] = useState(false);
  const [readingFileName, setReadingFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReadResultShape | null>(null);
  const [readers, setReaders] = useState<Array<{ id: string; label: string; configured: boolean; active: boolean }>>([]);
  // null = ใช้ตัวที่ระบบตั้งไว้ (พฤติกรรมเดิม) — ตั้งค่าเมื่อผู้ใช้เลือกเองเฉพาะรอบนี้เท่านั้น
  const [readerId, setReaderId] = useState<string | null>(null);
  const [skills, setSkills] = useState<Array<{ id: string; name: string; skillId: string }>>([]);
  // null = ใช้ Skill ที่ผูกกับสัญญานี้ไว้ (เส้น Gmail ที่ไม่มีคนกดเลือกก็ใช้ทางนี้) — เลือกเองแล้วชนะค่าของสัญญา
  const [abbyySkillId, setAbbyySkillId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/settings/readers', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { readers: [] }))
      .then((d) => setReaders(d.readers ?? []))
      .catch(() => setReaders([]));

    fetch('/api/abbyy-skills', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => setSkills(Array.isArray(rows) ? rows : []))
      .catch(() => setSkills([]));
  }, []);

  const chosenReaderId = readerId ?? readers.find((r) => r.active)?.id ?? null;

  function pickFile(f: File | null | undefined) {
    if (!f) return;
    setFile(f);
    setError(null);
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    pickFile(e.dataTransfer.files?.[0]);
  }

  async function doRead() {
    if (!file) {
      setError(tx('เลือกไฟล์ก่อน'));
      return;
    }
    setReading(true);
    setReadingFileName(file.name);
    setError(null);
    setResult(null);
    try {
      const fileBase64 = await fileToBase64(file);
      const res = await fetch('/api/timesheets/read', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // ส่ง abbyySkillId เฉพาะตอนที่จะอ่านด้วย ABBYY จริงๆ — ไม่งั้น Skill ที่ค้างจากตอนกดสลับไปมา
        // จะติดไปกับคำขอที่อ่านด้วยเครื่องอื่น
        body: JSON.stringify({
          fileBase64,
          fileName: file.name,
          readerId,
          abbyySkillId: chosenReaderId === 'abbyy' ? abbyySkillId : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? tx('อ่านไฟล์ไม่สำเร็จ'));
        return;
      }
      setResult(data);
    } catch (e: any) {
      setError(e.message ?? tx('อ่านไฟล์ไม่สำเร็จ'));
    } finally {
      setReading(false);
    }
  }

  return (
    <>
      <Card title={tx('เลือกไฟล์ Timesheet')} right={<span className="sub">{tx('PDF ที่ลูกค้าอนุมัติแล้ว')}</span>}>
        <div
          className={`dropzone${dragOver ? ' over' : ''}`}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.xlsx,.csv"
            hidden
            onChange={(e) => pickFile(e.target.files?.[0])}
          />
          <Icon name="file" className="lg" />
          {file ? (
            <span className="dz-file">{file.name}</span>
          ) : (
            <span className="dz-hint">{tx('ลากไฟล์มาวาง หรือกดเพื่อเลือกไฟล์')}</span>
          )}
        </div>

        {readers.length > 0 && (
          <div className="readerpick">
            <span className="lbl">{tx('อ่านด้วย')}</span>
            {readers.map((r) => (
              <button
                key={r.id}
                type="button"
                className={`rp${chosenReaderId === r.id ? ' on' : ''}`}
                disabled={!r.configured || reading}
                title={r.configured ? undefined : tx('ยังตั้งค่าไม่ครบ')}
                onClick={() => setReaderId(r.id)}
              >
                {r.label}
              </button>
            ))}
          </div>
        )}

        {/* Skill เลือกได้เฉพาะฝั่ง ABBYY — ฝั่ง Clear Read ระบบปักแม่แบบเดียวทั้งระบบ จึงไม่มีอะไรให้เลือก
            ไม่เลือก = ใช้ Skill ที่ผูกกับสัญญานี้ไว้ ซึ่งเป็นทางที่เส้น Gmail (ไม่มีคนกด) ใช้อยู่ */}
        {chosenReaderId === 'abbyy' && skills.length > 0 && (
          <div className="readeropt">
            <label className="lbl" htmlFor="abbyy-skill">{tx('Skill ที่ใช้อ่าน')}</label>
            <select
              id="abbyy-skill"
              value={abbyySkillId ?? ''}
              disabled={reading}
              onChange={(e) => setAbbyySkillId(e.target.value || null)}
            >
              <option value="">{tx('ตาม Skill ที่ผูกกับสัญญานี้')}</option>
              {skills.map((s) => (
                <option key={s.skillId} value={s.skillId}>{s.name}</option>
              ))}
            </select>
          </div>
        )}

        {chosenReaderId === 'clear-read' && (
          <div className="readerwarn">
            <Icon name="clock" />
            <span>{tx('Clear Read อ่านช้ากว่า ABBYY มาก — ราว 3 นาทีต่อหนึ่งหน้า ไฟล์หลายหน้าอาจถึงสิบนาที')}</span>
          </div>
        )}

        <button className="btn pri lg full" style={{ marginTop: 14 }} disabled={reading || !file} onClick={doRead}>
          <Icon name="eye" /> {reading ? tx('กำลังอ่านไฟล์…') : tx('อ่านไฟล์นี้')}
        </button>

        {error && <div style={{ color: 'var(--cr)', marginTop: 14 }}>{error}</div>}

        {result && <ReviewCard result={result} onDone={() => setResult(null)} />}
      </Card>

      {reading && <ReadingCard fileName={readingFileName} />}
    </>
  );
}
