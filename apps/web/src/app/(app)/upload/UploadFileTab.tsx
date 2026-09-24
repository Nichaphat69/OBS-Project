'use client';

import { useEffect, useRef, useState } from 'react';
import { Card } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { useLang } from '../../../lib/language';
import { useToast } from '../../../components/Overlays';
import { useReaderPicker, ReaderPickerBar } from '../../../components/ReaderPicker';
import { QueueStatusCard } from '../../../components/QueueStatusCard';
import ReviewCard, { type ReadResultShape } from './ReviewCard';

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

/**
 * `submitOnly` = โหมดของพนักงาน (role `user`) — เลือกไฟล์เดียวแล้วกดส่ง จบ ไม่มีคิว/ตัวอ่านเลย
 * (เจ้าของระบบสั่ง 18 ก.ย. 69: พนักงานมีหน้าที่ "ส่ง" อย่างเดียว) ยิงคนละเส้นกับโหมดฝั่งบัญชีด้านล่าง —
 * ไปที่ POST /api/timesheet-submissions/mine/upload ซึ่งยึด employeeId จาก session อย่างเดียว
 *
 * โหมดฝั่งบัญชี (ไม่ใช่ submitOnly) — เปลี่ยนเป็นเลือกได้หลายไฟล์พร้อมกัน (23 ก.ย. 69 ตามที่เคยตกลงกันไว้
 * อ้างอิงหน้าตา/ขั้นตอนจาก Clear Read เอง) กด "Process Documents" ครั้งเดียวส่งทั้งหมดเข้าคิวอ่านเบื้องหลัง
 * (POST /api/timesheets/read-queue) ไม่ได้อ่านทันทีแล้วโชว์ ReviewCard ในหน้านี้เองเหมือนเดิม — ผลอ่าน
 * ไปโผล่ในรายการคิวด้านล่างนี้เลย (สถานะ queued → running → พร้อมตรวจสอบ) แถวไหน "พร้อมตรวจสอบ" แล้ว
 * คลิกเปิด ReviewCard ตรงนี้ได้เลย (24 ก.ย. 69 ตามที่ขอ — ไม่ต้องไปกดเข้าแท็บ "ประวัติ" อีกที) แต่ก็ยัง
 * ตรวจ/ยืนยันจากแท็บ "ประวัติ" ได้เหมือนเดิมด้วย (เข้าถึงแถวเดียวกัน คนละทางเข้า)
 */
export default function UploadFileTab({ submitOnly = false }: { submitOnly?: boolean } = {}) {
  const { tx } = useLang();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<SubmitResult | null>(null);
  const [queuedIds, setQueuedIds] = useState<number[] | null>(null);
  const [reviewResult, setReviewResult] = useState<ReadResultShape | null>(null);
  const [reviewLoadingId, setReviewLoadingId] = useState<number | null>(null);
  // ยกไปเป็น hook ใช้ร่วมกัน (25 ก.ย. 69) — แท็บ "รอจากพนักงาน"/"ดึงจาก Gmail" ก็ต้องเลือกตัวอ่าน/Skill
  // แบบเดียวกันตอนอ่านหลายรายการพร้อมกัน ไม่เขียนตรรกะซ้ำอีกสองที่ โหมดพนักงาน (submitOnly) ไม่ใช้ค่า
  // เหล่านี้เลย (เจ้าของระบบสั่ง 18 ก.ย. 69) แต่ JSX ด้านล่างกันไว้แล้วด้วย submitOnly ไม่ให้ขึ้นมาโชว์
  const picker = useReaderPicker();

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
          readerId: picker.readerId,
          abbyySkillId: picker.chosenReaderId === 'abbyy' ? picker.abbyySkillId : null,
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

  /** เปิด ReviewCard ตัวเดียวกับที่แท็บ "ประวัติ" ใช้ — ให้แถวที่อ่านเสร็จแล้ว ("พร้อมตรวจสอบ") ในรายการ
   * คิวด้านล่างนี้ ตรวจสอบ/ยืนยันเข้าระบบได้เลยโดยไม่ต้องสลับไปแท็บ "ประวัติ" (24 ก.ย. 69 ตามที่ขอ) */
  function openReview(id: number) {
    setReviewLoadingId(id);
    fetch(`/api/ai-reads/${id}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((row: any) => {
        setReviewResult({ ...(row.extraction ?? {}), documentNo: row.documentNo, model: row.model });
      })
      .catch(() => toast(tx('โหลดรายละเอียดไม่สำเร็จ'), true))
      .finally(() => setReviewLoadingId(null));
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

  /* เปิด ReviewCard ทับหน้ารายการคิว (24 ก.ย. 69 ตามที่ขอ) — ตรวจสอบ/ยืนยันแถวที่อ่านเสร็จแล้วได้ตรงนี้
     เลย ไม่ต้องสลับไปแท็บ "ประวัติ" — ปิดแล้วกลับมาที่รายการคิวเดิม (ไม่รีเซ็ต queuedIds) */
  if (!submitOnly && reviewResult) {
    return (
      <Card title={tx('ตรวจสอบก่อนบันทึกเข้าระบบ')}>
        <ReviewCard result={reviewResult} onDone={() => setReviewResult(null)} />
      </Card>
    );
  }

  /* หน้าแสดงสถานะสดหลังเข้าคิวสำเร็จ (โหมดบัญชี) — เห็นเลยว่าไฟล์ไหนกำลังอ่านอยู่ ไฟล์ไหนรอคิว อัปเดต
     อัตโนมัติผ่าน SSE ไม่ต้องกด refresh (23 ก.ย. 69 ตามภาพอ้างอิงจาก Clear Read — เจ้าของระบบขอให้เห็นว่า
     "กำลังอ่านไฟล์ไหนอยู่" ไม่ใช่แค่ข้อความสรุปจำนวนเฉยๆ) */
  if (!submitOnly && queuedIds !== null) {
    return (
      <QueueStatusCard
        ids={queuedIds}
        onOpenRow={openReview}
        openingId={reviewLoadingId}
        closeLabel={tx('อัปโหลดเพิ่ม')}
        onClose={() => setQueuedIds(null)}
      />
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

      {!submitOnly && (
        <div style={{ marginTop: 14 }}>
          <ReaderPickerBar picker={picker} disabled={processing} />
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
