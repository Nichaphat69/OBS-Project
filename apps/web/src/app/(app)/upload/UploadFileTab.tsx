'use client';

import { useEffect, useRef, useState } from 'react';
import { Card } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { useLang } from '../../../lib/language';

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '');
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function fileSizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

interface SubmitResult {
  period: string;
  periodLabel: string;
  customerName: string;
  projectName: string;
  fileName: string;
}

interface QueueItem {
  id: number;
  fileName: string | null;
  status: string;
  errorMessage: string | null;
}

// ป้าย/สีเดียวกับที่แท็บ "ประวัติ" ใช้ (HistoryTab.tsx) ให้เห็นสถานะเดียวกันไม่ว่าจะดูจากหน้าไหน
const RQ_LABEL: Record<string, string> = {
  queued: 'รอคิว',
  running: 'กำลังอ่าน Timesheet',
  pending: 'พร้อมตรวจสอบ',
  failed: 'อ่านไม่สำเร็จ',
};

/**
 * `submitOnly` = โหมดของพนักงาน (role `user`) — เลือกไฟล์เดียวแล้วกดส่ง จบ ไม่มีคิว/ตัวอ่านเลย
 * (เจ้าของระบบสั่ง 18 ก.ย. 69: พนักงานมีหน้าที่ "ส่ง" อย่างเดียว) ยิงคนละเส้นกับโหมดฝั่งบัญชีด้านล่าง —
 * ไปที่ POST /api/timesheet-submissions/mine/upload ซึ่งยึด employeeId จาก session อย่างเดียว
 *
 * โหมดฝั่งบัญชี (ไม่ใช่ submitOnly) — เปลี่ยนเป็นเลือกได้หลายไฟล์พร้อมกัน (23 ก.ย. 69 ตามที่เคยตกลงกันไว้
 * อ้างอิงหน้าตา/ขั้นตอนจาก Clear Read เอง) กด "Process Documents" ครั้งเดียวส่งทั้งหมดเข้าคิวอ่านเบื้องหลัง
 * (POST /api/timesheets/read-queue) ไม่ได้อ่านทันทีแล้วโชว์ ReviewCard ในหน้านี้อีกต่อไป — ผลอ่านไปโผล่ที่
 * แท็บ "ประวัติ" (สถานะ queued → running → พร้อมตรวจสอบ) กดตรวจสอบ/ยืนยันได้จากตรงนั้นแทน
 */
export default function UploadFileTab({ submitOnly = false }: { submitOnly?: boolean } = {}) {
  const { tx } = useLang();
  const fileRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<SubmitResult | null>(null);
  const [queuedIds, setQueuedIds] = useState<number[] | null>(null);
  const [queueItems, setQueueItems] = useState<QueueItem[] | null>(null);
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

  // เช็คว่ามีไฟล์จากคิวนี้ที่ยังไม่เสร็จค้างอยู่ไหมทุกครั้งที่เปิด/รีเฟรชหน้า (23 ก.ย. 69) — เดิมสถานะ
  // "กำลังดูคิวอยู่" เก็บแค่ในหน่วยความจำของหน้าเว็บ รีเฟรชทีก็หายไปเลย ทั้งที่ไฟล์ยังอ่านไม่เสร็จจริงในระบบ
  // เช็คจากฐานข้อมูลตรงๆ แทน ไม่ต้องพึ่งความจำของหน้าเว็บอีกต่อไป
  useEffect(() => {
    if (submitOnly) return;
    fetch('/api/ai-reads', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: any[]) => {
        const inflight = (Array.isArray(rows) ? rows : []).filter(
          (r) => r.source === 'batch_upload' && (r.status === 'queued' || r.status === 'running'),
        );
        if (inflight.length > 0) setQueuedIds(inflight.map((r) => r.id));
      })
      .catch(() => {});
  }, [submitOnly]);

  // แสดงสถานะสดของไฟล์ที่เพิ่งเข้าคิว (23 ก.ย. 69 อ้างอิงหน้าตาจาก Clear Read เอง) — ดึงจาก /api/ai-reads
  // เดียวกับที่แท็บ "ประวัติ" ใช้ กรองเฉพาะ id ที่เพิ่งส่งเข้าคิวรอบนี้ แล้วฟัง SSE ตัวเดียวกับที่ประวัติใช้
  // (events.ts/emitChange) ให้อัปเดตสถานะทันทีไม่ต้องกด refresh เอง
  useEffect(() => {
    if (!queuedIds || queuedIds.length === 0) return;

    function loadQueueStatus() {
      fetch('/api/ai-reads', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : []))
        .then((rows: any[]) => {
          const idSet = new Set(queuedIds);
          setQueueItems(
            (Array.isArray(rows) ? rows : [])
              .filter((r) => idSet.has(r.id))
              .map((r) => ({ id: r.id, fileName: r.fileName, status: r.status, errorMessage: r.errorMessage })),
          );
        })
        .catch(() => {});
    }

    loadQueueStatus();
    let source: EventSource | null = null;
    try {
      source = new EventSource('/api/stream');
      source.addEventListener('change', loadQueueStatus);
      // เจอจริง 23 ก.ย. 69: ช่วงระหว่างเปิดหน้านี้กับ SSE ต่อสำเร็จมีช่องว่างสั้นๆ ที่พลาดฟัง event
      // "queued → running" ไปได้ (worker เปลี่ยนสถานะเร็วกว่า SSE handshake) ทำให้ค้างโชว์ "รอคิว" ทั้งที่
      // จริงๆ กำลังอ่านอยู่แล้ว — ต่อ SSE สำเร็จเมื่อไหร่ให้ดึงสถานะซ้ำอีกทีทันทีเพื่อไล่ตามให้ทัน
      source.addEventListener('open', loadQueueStatus);
    } catch {
      /* SSE ต่อไม่ได้ — ยังมี poll สำรองด้านล่างคอยรีเฟรชต่อ */
    }
    // poll สำรองถี่ๆ ระหว่างที่ยังมีคิวค้างอยู่ — กันพลาด event ของ SSE ไปเฉยๆ (เชื่อ SSE อย่างเดียวเสี่ยง
    // เกินไปสำหรับหน้าที่คนกำลังจ้องรอผลอยู่จริงๆ) ตั้งไว้ถี่ (1.2 วิ) เพราะ ABBYY อ่านไฟล์เล็กเสร็จเร็วมาก
    // (2-3 วิ) — 4 วิเดิมข้ามสถานะ "กำลังอ่าน" ไปเฉยๆ เพราะอ่านเสร็จก่อน poll รอบถัดไปจะทัน
    const poll = setInterval(loadQueueStatus, 1200);
    return () => {
      source?.close();
      clearInterval(poll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queuedIds]);

  const chosenReaderId = readerId ?? readers.find((r) => r.active)?.id ?? null;

  function pickFiles(list: FileList | File[] | null | undefined) {
    if (!list || list.length === 0) return;
    const picked = Array.from(list);
    setError(null);
    // โหมดพนักงาน = เลือกทีละไฟล์เสมอ (เลือกใหม่แทนของเดิม) — โหมดบัญชี = สะสมเพิ่มเรื่อยๆ (เลี่ยงชื่อ+
    // ขนาดไฟล์ซ้ำกันเป๊ะ กันกดเลือกไฟล์เดิมซ้ำโดยไม่ตั้งใจ)
    if (submitOnly) {
      setFiles([picked[0]]);
      return;
    }
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}::${f.size}`));
      const merged = [...prev];
      for (const f of picked) {
        const key = `${f.name}::${f.size}`;
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(f);
        }
      }
      return merged;
    });
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    pickFiles(e.dataTransfer.files);
  }

  /** โหมดพนักงาน — ส่งไฟล์เข้าระบบอย่างเดียว ไม่อ่าน ไม่มีหน้ารีวิวให้ยืนยันต่อ */
  async function doSubmit() {
    const file = files[0];
    if (!file) {
      setError(tx('เลือกไฟล์ก่อน'));
      return;
    }
    setProcessing(true);
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
      setFiles([]);
    } catch (e: any) {
      setError(e.message ?? tx('ส่งไม่สำเร็จ'));
    } finally {
      setProcessing(false);
    }
  }

  /** โหมดบัญชี — ส่งไฟล์ทั้งหมดที่เลือกไว้เข้าคิวอ่านเบื้องหลังทีเดียว (23 ก.ย. 69) ไม่รอ OCR เสร็จก่อน
   * ตอบกลับ — ผลไปโผล่ที่แท็บ "ประวัติ" แทน */
  async function doProcessBatch() {
    if (files.length === 0) {
      setError(tx('เลือกไฟล์อย่างน้อย 1 ไฟล์ก่อน'));
      return;
    }
    setProcessing(true);
    setError(null);
    try {
      const filePayload = await Promise.all(
        files.map(async (f) => ({ fileBase64: await fileToBase64(f), fileName: f.name })),
      );
      const res = await fetch('/api/timesheets/read-queue', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          files: filePayload,
          readerId,
          abbyySkillId: chosenReaderId === 'abbyy' ? abbyySkillId : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? tx('เข้าคิวไม่สำเร็จ'));
        return;
      }
      setQueuedIds(Array.isArray(data.ids) ? data.ids : []);
      setFiles([]);
    } catch (e: any) {
      setError(e.message ?? tx('เข้าคิวไม่สำเร็จ'));
    } finally {
      setProcessing(false);
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

  /* หน้าแสดงสถานะสดหลังเข้าคิวสำเร็จ (โหมดบัญชี) — เห็นเลยว่าไฟล์ไหนกำลังอ่านอยู่ ไฟล์ไหนรอคิว อัปเดต
     อัตโนมัติผ่าน SSE ไม่ต้องกด refresh (23 ก.ย. 69 ตามภาพอ้างอิงจาก Clear Read — เจ้าของระบบขอให้เห็นว่า
     "กำลังอ่านไฟล์ไหนอยู่" ไม่ใช่แค่ข้อความสรุปจำนวนเฉยๆ) */
  if (!submitOnly && queuedIds !== null) {
    const allDone = queueItems !== null && queueItems.every((it) => it.status === 'pending' || it.status === 'failed');
    return (
      <Card title={tx('เข้าคิวอ่านแล้ว')} right={<span className="sub">{tx('อัปเดตสถานะอัตโนมัติ')}</span>}>
        <div className="rq-list">
          {queueItems === null
            ? queuedIds.map((id) => (
                <div key={id} className="rq-row">
                  <span className="rq-spinner" style={{ opacity: 0.4 }} />
                  <span className="rq-name">{tx('กำลังโหลด…')}</span>
                </div>
              ))
            : queueItems.map((it) => (
                <div key={it.id} className={`rq-row ${it.status}`}>
                  {it.status === 'running' ? (
                    <span className="rq-spinner" />
                  ) : (
                    <Icon
                      name={it.status === 'pending' ? 'chk' : it.status === 'failed' ? 'x' : 'clock'}
                      className="sm"
                      style={{
                        color:
                          it.status === 'pending' ? 'var(--ok)' : it.status === 'failed' ? 'var(--cr)' : 'var(--fnt)',
                        flex: 'none',
                      }}
                    />
                  )}
                  <span className="rq-name">
                    {it.fileName ?? tx('ไม่ทราบชื่อไฟล์')}
                    {it.status === 'failed' && it.errorMessage && <span className="rq-err">{it.errorMessage}</span>}
                  </span>
                  <span className={`rq-status ${it.status}`}>{tx(RQ_LABEL[it.status] ?? it.status)}</span>
                </div>
              ))}
        </div>
        <div className="sub" style={{ marginTop: 14 }}>
          {allDone
            ? tx('อ่านครบทุกไฟล์แล้ว — ไปที่แท็บ "ประวัติ" เพื่อตรวจสอบและยืนยันเข้าระบบ')
            : tx('ระบบกำลังอ่านไฟล์เบื้องหลัง ไม่ต้องปิดหน้านี้ก็ได้ ติดตามสถานะและตรวจสอบผลได้ที่แท็บ "ประวัติ" เช่นกัน')}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button
            className="btn"
            onClick={() => {
              setQueuedIds(null);
              setQueueItems(null);
            }}
          >
            {tx('อัปโหลดเพิ่ม')}
          </button>
        </div>
      </Card>
    );
  }

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  return (
    <Card
      title={tx(submitOnly ? 'เลือกไฟล์ Timesheet ที่จะส่ง' : 'เลือกไฟล์ Timesheet')}
      right={submitOnly ? undefined : <span className="sub">{tx('PDF ที่ลูกค้าอนุมัติแล้ว — เลือกได้หลายไฟล์พร้อมกัน')}</span>}
    >
      {files.length === 0 ? (
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
            multiple={!submitOnly}
            hidden
            onChange={(e) => pickFiles(e.target.files)}
          />
          <Icon name="file" className="lg" />
          <span className="dz-hint">{tx('ลากไฟล์มาวาง หรือกดเพื่อเลือกไฟล์')}</span>
        </div>
      ) : (
        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '12px 16px',
              borderRadius: 'var(--m3-shape-md)',
              background: 'var(--okb)',
              marginBottom: 12,
            }}
          >
            <span style={{ color: 'var(--ok)', fontWeight: 600, fontSize: 13.5 }}>
              {files.length} {tx('ไฟล์ที่เลือกไว้')} · {fileSizeLabel(totalSize)}
            </span>
            {!submitOnly && (
              <button type="button" className="btn sm" onClick={() => fileRef.current?.click()}>
                <Icon name="up" className="sm" /> {tx('เพิ่มไฟล์')}
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.xlsx,.csv"
              multiple={!submitOnly}
              hidden
              onChange={(e) => pickFiles(e.target.files)}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {files.map((f, i) => (
              <div
                key={`${f.name}::${f.size}::${i}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 14px',
                  border: '1px solid var(--m3-outline)',
                  borderRadius: 'var(--m3-shape-md)',
                }}
              >
                <Icon name="file" className="sm" style={{ color: 'var(--brand)', flex: 'none' }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
                  <div className="sub">{fileSizeLabel(f.size)}</div>
                </div>
                <button type="button" className="btn sm icon dgr" onClick={() => removeFile(i)} title={tx('ลบไฟล์นี้')} aria-label={tx('ลบ')}>
                  <Icon name="x" className="sm" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {readers.length > 0 && (
        <div className="readerpick">
          <span className="lbl">{tx('อ่านด้วย')}</span>
          {readers.map((r) => {
            // เดิมมีกล่องเตือนเต็มแถบใต้ปุ่มตอนเลือก Clear Read — เจ้าของระบบสั่งเอาออก 18 ก.ย. 69
            // เก็บข้อมูลไว้เป็น tooltip สั้นๆ ที่ปุ่มแทน ไม่ให้ข้อมูลนี้หายไปเงียบๆ ทั้งที่ยังมีประโยชน์
            const slowHint = r.id === 'clear-read' ? tx('Clear Read อ่านช้ากว่า ABBYY มาก — ราว 3 นาทีต่อหนึ่งหน้า') : undefined;
            return (
              <button
                key={r.id}
                type="button"
                className={`rp${chosenReaderId === r.id ? ' on' : ''}`}
                disabled={!r.configured || processing}
                title={!r.configured ? tx('ยังตั้งค่าไม่ครบ') : slowHint}
                onClick={() => setReaderId(r.id)}
              >
                {r.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Skill เลือกได้เฉพาะฝั่ง ABBYY — ฝั่ง Clear Read ระบบปักแม่แบบเดียวทั้งระบบ (เจ้าของระบบสั่ง
          17 ก.ย. 69) จึงไม่มีอะไรให้เลือกเลย ไม่แสดงขั้นตอนนี้เลยถ้าเลือก Clear Read อยู่ */}
      {chosenReaderId === 'abbyy' && skills.length > 0 && (
        <div className="readeropt">
          <label className="lbl" htmlFor="abbyy-skill">{tx('Skill ที่ใช้อ่าน')}</label>
          <select
            id="abbyy-skill"
            value={abbyySkillId ?? ''}
            disabled={processing}
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
        disabled={processing || files.length === 0}
        onClick={submitOnly ? doSubmit : doProcessBatch}
      >
        <Icon name={submitOnly ? 'send' : 'chk'} />{' '}
        {submitOnly
          ? processing ? tx('กำลังส่ง…') : tx('ส่ง Timesheet นี้')
          : processing ? tx('กำลังเข้าคิว…') : tx('Process Documents')}
      </button>

      {error && <div style={{ color: 'var(--cr)', marginTop: 14 }}>{error}</div>}
    </Card>
  );
}
