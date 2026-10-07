'use client';

import { useEffect, useState } from 'react';
import { Card } from './ui';
import { Icon } from './Icon';
import { useLang } from '../lib/language';
import { usePdfPreview } from './Overlays';

export interface QueueItem {
  id: number;
  fileName: string | null;
  status: string;
  errorMessage: string | null;
}

/**
 * การ์ดแสดงสถานะคิวอ่านเบื้องหลังแบบสด (23 ก.ย. 69 อ้างอิงหน้าตาจาก Clear Read) — แยกออกมาจาก
 * UploadFileTab.tsx (25 ก.ย. 69) เพื่อใช้ร่วมกันทุกจุดที่ส่งเข้าคิวอ่าน (POST /api/timesheets/
 * read-queue): แท็บ "อัปโหลดไฟล์" (ไฟล์ใหม่จากเครื่อง) และแท็บ "รอจากพนักงาน" (ไฟล์ที่มีอยู่แล้วในระบบ)
 * — โพลผ่าน /api/ai-reads + ฟัง SSE (/api/stream) ตัวเดียวกับที่แท็บ "ประวัติ" ใช้ ให้อัปเดตสถานะทันที
 * ไม่ต้องกด refresh เอง แถวที่ "พร้อมตรวจสอบ" คลิกเปิดรีวิวได้เลย (ผู้เรียกเป็นคนเปิด ReviewCard เอง
 * ผ่าน onOpenRow — คอมโพเนนต์นี้ไม่รู้จัก ReviewCard เลยโดยตั้งใจ เพื่อไม่ผูกกับหน้า "อัปโหลด" เจาะจง)
 */
export function QueueStatusCard({
  ids,
  onOpenRow,
  onClose,
  closeLabel,
  openingId,
}: {
  ids: number[];
  onOpenRow: (id: number) => void;
  onClose: () => void;
  /** ข้อความปุ่มปิด — ต่างกันตามบริบทที่เรียก (เช่น "อัปโหลดเพิ่ม" ตอนอัปโหลดไฟล์ vs "กลับไปที่รายการ"
   * ตอนอ่านจากคิวที่มีอยู่แล้ว) ค่าเริ่มต้นเป็นคำกลางๆ ที่ใช้ได้ทุกที่ */
  closeLabel?: string;
  openingId?: number | null;
}) {
  const { tx } = useLang();
  const openPdfPreview = usePdfPreview();
  const [items, setItems] = useState<QueueItem[] | null>(null);

  useEffect(() => {
    function loadStatus() {
      fetch('/api/ai-reads', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : []))
        .then((rows: any[]) => {
          const idSet = new Set(ids);
          setItems(
            (Array.isArray(rows) ? rows : [])
              .filter((r) => idSet.has(r.id))
              .map((r) => ({ id: r.id, fileName: r.fileName, status: r.status, errorMessage: r.errorMessage })),
          );
        })
        .catch(() => {});
    }

    loadStatus();
    let source: EventSource | null = null;
    try {
      source = new EventSource('/api/stream');
      source.addEventListener('change', loadStatus);
      // เจอจริง 23 ก.ย. 69: ช่วงระหว่างเปิดหน้านี้กับ SSE ต่อสำเร็จมีช่องว่างสั้นๆ ที่พลาดฟัง event
      // "queued → running" ไปได้ (worker เปลี่ยนสถานะเร็วกว่า SSE handshake) — ต่อ SSE สำเร็จเมื่อไหร่
      // ให้ดึงสถานะซ้ำอีกทีทันทีเพื่อไล่ตามให้ทัน
      source.addEventListener('open', loadStatus);
    } catch {
      /* SSE ต่อไม่ได้ — ยังมี poll สำรองด้านล่างคอยรีเฟรชต่อ */
    }
    // poll สำรองถี่ๆ ระหว่างที่ยังมีคิวค้างอยู่ — ABBYY อ่านไฟล์เล็กเสร็จเร็วมาก (2-3 วิ) ตั้งถี่ไว้กันข้าม
    // สถานะ "กำลังอ่าน" ไปเฉยๆ
    const poll = setInterval(loadStatus, 1200);
    return () => {
      source?.close();
      clearInterval(poll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  const allDone = items !== null && items.every((it) => it.status === 'pending' || it.status === 'failed');

  return (
    <Card title={tx('เข้าคิวอ่านแล้ว')} right={<span className="sub">{tx('อัปเดตสถานะอัตโนมัติ')}</span>}>
      <div className="rq-list">
        {items === null
          ? ids.map((id) => (
              <div key={id} className="rq-row">
                <span className="rq-spinner" style={{ opacity: 0.4 }} />
                <span className="rq-name">{tx('กำลังโหลด…')}</span>
              </div>
            ))
          : items.map((it) => {
              const clickable = it.status === 'pending';
              return (
                <div
                  key={it.id}
                  className={`rq-row ${it.status}${clickable ? ' clickable' : ''}`}
                  role={clickable ? 'button' : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  onClick={clickable ? () => onOpenRow(it.id) : undefined}
                  onKeyDown={
                    clickable
                      ? (e) => {
                          if (e.key === 'Enter') onOpenRow(it.id);
                        }
                      : undefined
                  }
                >
                  {it.status === 'running' || openingId === it.id ? (
                    <span className="rq-spinner" />
                  ) : (
                    <Icon
                      name={it.status === 'pending' ? 'chk' : it.status === 'failed' ? 'x' : 'clock'}
                      className="sm"
                      style={{
                        color: it.status === 'pending' ? 'var(--ok)' : it.status === 'failed' ? 'var(--cr)' : 'var(--fnt)',
                        flex: 'none',
                      }}
                    />
                  )}
                  <span className="rq-name">
                    {it.fileName ? (
                      <button
                        type="button"
                        className="lnk"
                        title={tx('เปิดดูไฟล์นี้')}
                        onClick={(e) => {
                          // แถวนี้คลิกเพื่อเปิดรีวิวได้ — กดที่ชื่อไฟล์ให้เปิดดูไฟล์ต้นฉบับอย่างเดียว ไม่เด้งไปรีวิว
                          e.stopPropagation();
                          openPdfPreview(`/api/ai-reads/${it.id}/file`, it.fileName);
                        }}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        {it.fileName}
                      </button>
                    ) : (
                      tx('ไม่ทราบชื่อไฟล์')
                    )}
                    {it.status === 'failed' && it.errorMessage && <span className="rq-err">{it.errorMessage}</span>}
                  </span>
                </div>
              );
            })}
      </div>
      <div className="sub" style={{ marginTop: 14 }}>
        {allDone
          ? tx('อ่านครบทุกไฟล์แล้ว — คลิกแถวไหนก็ได้เพื่อตรวจสอบและยืนยันเข้าระบบ')
          : tx('ระบบกำลังอ่านไฟล์เบื้องหลัง ไม่ต้องปิดหน้านี้ก็ได้ — แถวไหนพร้อมแล้วคลิกเข้าไปตรวจสอบได้เลย')}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
        <button className="btn" onClick={onClose}>
          {closeLabel ?? tx('เสร็จแล้ว')}
        </button>
      </div>
    </Card>
  );
}
