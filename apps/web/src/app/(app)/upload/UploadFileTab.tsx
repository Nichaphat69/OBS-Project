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

interface SubmitResult {
  period: string;
  periodLabel: string;
  customerName: string;
  projectName: string;
  fileName: string;
}

/**
 * `submitOnly` = โหมดของพนักงาน (role `user`) — เลือกไฟล์แล้วกดส่ง จบ
 *
 * ไม่มีตัวเลือกเครื่องอ่าน/Skill และไม่เรียก OCR เลย เพราะพนักงานมีหน้าที่ "ส่ง" อย่างเดียว ส่วนการ
 * อ่านไฟล์กับตรวจ Manday ยังเป็นงานของฝั่งที่ทำบิลเหมือนเดิม (เจ้าของระบบสั่ง 18 ก.ย. 69)
 * ยิงคนละเส้นกันด้วย ไม่ใช่เส้นเดิมแล้วแตก branch — ฝั่งพนักงานไปที่
 * POST /api/timesheet-submissions/mine/upload ซึ่งยึด employeeId จาก session อย่างเดียว
 */
export default function UploadFileTab({ submitOnly = false }: { submitOnly?: boolean } = {}) {
  const { tx } = useLang();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [reading, setReading] = useState(false);
  const [readingFileName, setReadingFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReadResultShape | null>(null);
  const [submitted, setSubmitted] = useState<SubmitResult | null>(null);
  const [readers, setReaders] = useState<Array<{ id: string; label: string; configured: boolean; active: boolean }>>([]);
  // null = ใช้ตัวที่ระบบตั้งไว้ (พฤติกรรมเดิม) — ตั้งค่าเมื่อผู้ใช้เลือกเองเฉพาะรอบนี้เท่านั้น
  const [readerId, setReaderId] = useState<string | null>(null);
  const [skills, setSkills] = useState<Array<{ id: string; name: string; skillId: string }>>([]);
  // null = ใช้ Skill ที่ผูกกับสัญญานี้ไว้ (เส้น Gmail ที่ไม่มีคนกดเลือกก็ใช้ทางนี้) — เลือกเองแล้วชนะค่าของสัญญา
  const [abbyySkillId, setAbbyySkillId] = useState<string | null>(null);

  useEffect(() => {
    // โหมดพนักงานไม่มีตัวเลือกเครื่องอ่าน/Skill จึงไม่ต้องยิงสองเส้นนี้ให้เปล่าๆ (ทั้งคู่เป็นข้อมูลตั้งค่า
    // ของฝั่งที่ทำบิล พนักงานเรียกไปก็ไม่ได้ใช้)
    if (submitOnly) return;

    fetch('/api/settings/readers', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { readers: [] }))
      // local-llm เป็นตัวสำรองสุดท้ายที่ระบบเรียกเองเมื่อ ABBYY กับ Clear Read ล้มทั้งคู่ ไม่ใช่ตัวเลือก
      // ของคน จึงไม่ต้องมีปุ่มของตัวเองที่นี่ (เหมือนกับที่หน้า "ตัวอ่าน Timesheet" ตัดออกไปแล้ว —
      // เจ้าของระบบสั่ง 18 ก.ย. 69 ว่าให้เหลือแค่ 2 ตัวที่คนเลือกได้จริง)
      .then((d) => setReaders((d.readers ?? []).filter((r: { id: string }) => r.id !== 'local-llm')))
      .catch(() => setReaders([]));

    fetch('/api/abbyy-skills', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => setSkills(Array.isArray(rows) ? rows : []))
      .catch(() => setSkills([]));
  }, [submitOnly]);

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

  /** โหมดพนักงาน — ส่งไฟล์เข้าระบบอย่างเดียว ไม่อ่าน ไม่มีหน้ารีวิวให้ยืนยันต่อ */
  async function doSubmit() {
    if (!file) {
      setError(tx('เลือกไฟล์ก่อน'));
      return;
    }
    setReading(true);
    setReadingFileName(file.name);
    setError(null);
    try {
      const fileBase64 = await fileToBase64(file);
      const res = await fetch('/api/timesheet-submissions/mine/upload', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fileBase64, fileName: file.name }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? tx('ส่งไม่สำเร็จ'));
        return;
      }
      setSubmitted(data);
      setFile(null);
    } catch (e: any) {
      setError(e.message ?? tx('ส่งไม่สำเร็จ'));
    } finally {
      setReading(false);
    }
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

  /* หน้ายืนยันหลังส่งสำเร็จ (โหมดพนักงาน) — บอกให้ชัดว่าส่งของรอบไหนไปแล้ว เพราะระบบเลือกรอบให้เอง
     จากรอบที่ค้างเก่าที่สุด ไม่ได้ให้พนักงานเลือก ถ้าไม่บอกกลับไปว่าเป็นรอบไหน คนส่งจะไม่มีทางรู้เลย */
  if (submitOnly && submitted) {
    return (
      <Card title={tx('ส่ง Timesheet แล้ว')}>
        <div className="subdone">
          <span className="ic">
            <Icon name="chk" className="lg" />
          </span>
          <div className="tx">
            <b>{tx('ส่งเรียบร้อยแล้ว')}</b>
            <div className="sub">
              {tx('รอบบิล')} {submitted.periodLabel} · {submitted.customerName} · {submitted.projectName}
            </div>
            <div className="sub">{submitted.fileName}</div>
            <div className="sub">{tx('ผู้ดูแลจะตรวจไฟล์นี้ต่อ ติดตามสถานะได้ที่หน้า "บันทึกการส่ง"')}</div>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn" onClick={() => setSubmitted(null)}>
            {tx('ส่งไฟล์อีกรอบ')}
          </button>
        </div>
      </Card>
    );
  }

  return (
    <>
      <Card
        title={tx(submitOnly ? 'เลือกไฟล์ Timesheet ที่จะส่ง' : 'เลือกไฟล์ Timesheet')}
        right={submitOnly ? undefined : <span className="sub">{tx('PDF ที่ลูกค้าอนุมัติแล้ว')}</span>}
      >
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
            {readers.map((r) => {
              // เดิมมีกล่องเตือนเต็มแถบใต้ปุ่มตอนเลือก Clear Read — เจ้าของระบบสั่งเอาออก 18 ก.ย. 69
              // เก็บข้อมูลไว้เป็น tooltip สั้นๆ ที่ปุ่มแทน ไม่ให้ข้อมูลนี้หายไปเงียบๆ ทั้งที่ยังมีประโยชน์
              const slowHint = r.id === 'clear-read' ? tx('Clear Read อ่านช้ากว่า ABBYY มาก — ราว 3 นาทีต่อหนึ่งหน้า') : undefined;
              const cls = r.id === 'abbyy' ? 'ab' : r.id === 'clear-read' ? 'cr' : '';
              return (
                <button
                  key={r.id}
                  type="button"
                  className={`rp ${cls}${chosenReaderId === r.id ? ' on' : ''}`}
                  disabled={!r.configured || reading}
                  title={!r.configured ? tx('ยังตั้งค่าไม่ครบ') : slowHint}
                  onClick={() => setReaderId(r.id)}
                >
                  {r.label}
                </button>
              );
            })}
          </div>
        )}

        {/* Skill เลือกได้เฉพาะฝั่ง ABBYY — ฝั่ง Clear Read ระบบปักแม่แบบเดียวทั้งระบบ จึงไม่มีอะไรให้เลือก
            ไม่เลือก = ใช้ Skill ที่ผูกกับสัญญานี้ไว้ ซึ่งเป็นทางที่เส้น Gmail (ไม่มีคนกด) ใช้อยู่ */}
        {chosenReaderId === 'abbyy' && skills.length > 0 && (
          // `ab` = ใช้ชุดสีของ ABBYY กับกรอบ/ป้ายของตัวเลือกนี้ — ตัวเลือกย่อยเป็นของเครื่องอ่านตัวไหน
          // ต้องดูออกตั้งแต่ตาแรก ไม่ใช่กรอบโฟกัสสีน้ำเงินของเบราว์เซอร์ที่ไม่ได้สื่ออะไรเลย
          <div className="readeropt ab">
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

        <button
          className="btn pri lg full"
          style={{ marginTop: 14 }}
          disabled={reading || !file}
          onClick={submitOnly ? doSubmit : doRead}
        >
          <Icon name={submitOnly ? 'send' : 'eye'} />{' '}
          {submitOnly
            ? reading ? tx('กำลังส่ง…') : tx('ส่ง Timesheet นี้')
            : reading ? tx('กำลังอ่านไฟล์…') : tx('อ่านไฟล์นี้')}
        </button>

        {error && <div style={{ color: 'var(--cr)', marginTop: 14 }}>{error}</div>}

        {result && <ReviewCard result={result} onDone={() => setResult(null)} />}
      </Card>

      {/* การ์ด "กำลังอ่านไฟล์" เป็นของเส้น OCR ล้วนๆ (มีขั้นตอนการอ่านให้ดูระหว่างรอ) โหมดส่งไม่ได้อ่าน
          อะไรเลย จะขึ้นการ์ดนั้นไม่ได้ ไม่งั้นพนักงานจะเข้าใจว่าระบบกำลังอ่าน Timesheet ให้อยู่ */}
      {reading && !submitOnly && <ReadingCard fileName={readingFileName} />}
    </>
  );
}
