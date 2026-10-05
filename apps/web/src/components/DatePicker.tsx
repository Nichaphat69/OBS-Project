'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

/** ปฏิทินเลือกวันที่ทรง Material Design 3 (เจ้าของระบบสั่ง 22 ก.ย. 69 — อ้างอิงจาก m3.material.io/
 * components/date-pickers แต่ใช้โทนฟ้าไล่อ่อน→เข้มของระบบเองแทนสีม่วงต้นแบบ) แทนที่ <input type="date">
 * เดิมทุกจุด — เหตุผลที่ต้องสร้างใหม่ทั้งหมดแทนแค่ปรับ CSS: หน้าต่างปฏิทินของ <input type="date"> เดิม
 * เป็นของเบราว์เซอร์เอง แต่งหน้าตาด้วย CSS ไม่ได้เลยไม่ว่าวิธีไหน
 *
 * ค่าที่เข้า-ออกยังเป็น string รูปแบบ YYYY-MM-DD เหมือนของเดิมทุกจุด (ไม่เปลี่ยน data shape ที่โค้ดรอบข้าง
 * ใช้อยู่) — สลับจาก <input type="date" value=... onChange=... /> เป็น
 * <DatePicker value=... onChange={(v) => ...} /> ตรงๆ ได้เลย
 */

const WEEKDAYS_TH = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
const MONTHS_TH = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
function toIso(y: number, m: number, d: number): string {
  return `${y}-${pad2(m + 1)}-${pad2(d)}`;
}
function parseIso(v: string | undefined | null): { y: number; m: number; d: number } | null {
  if (!v) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]) - 1, d: Number(match[3]) };
}

export function DatePicker({
  value,
  onChange,
  min,
  max,
  disabled,
  className,
  ariaLabel,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const today = new Date();
  const parsed = parseIso(value);
  const [viewY, setViewY] = useState(parsed?.y ?? today.getFullYear());
  const [viewM, setViewM] = useState(parsed?.m ?? today.getMonth());

  // เปิดทีไร กลับไปแสดงเดือนของค่าที่เลือกอยู่เสมอ (ไม่ค้างเดือนที่เพิ่งเลื่อนดูค้างไว้จากรอบก่อน)
  useEffect(() => {
    if (!open) return;
    const p = parseIso(value);
    setViewY(p?.y ?? today.getFullYear());
    setViewM(p?.m ?? today.getMonth());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // วางปฏิทินเป็น fixed นอกการ์ดฟอร์ม (portal ไปที่ body) — 5 ต.ค. 69 เจ้าของระบบทัก "ปฏิทินโดนตัดท่อน": เดิมปฏิทินเป็น
  // absolute อยู่ในการ์ดที่ตัดส่วนเกิน (overflow) ต่อให้ในจอยังมีที่ว่างเหลือ ขอบการ์ดก็ตัดแถวท้ายๆ ทิ้ง · ตำแหน่งคำนวณจากปุ่ม
  // ใต้ปุ่มถ้าที่พอ ไม่พอก็เปิดขึ้นบน ไม่พอทั้งสองทางก็ชิดขอบจอ — และคำนวณใหม่ทุกครั้งที่เลื่อนหน้า/ย่อขยายหน้าต่าง/เปลี่ยนเดือน
  // (เดือนมี 5–6 แถว ความสูงต่างกัน)
  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const trigger = wrapRef.current?.getBoundingClientRect();
      const panel = panelRef.current?.getBoundingClientRect();
      if (!trigger) return;
      const h = panel?.height ?? 380;
      const w = panel?.width ?? 300;
      const gap = 8;
      const spaceBelow = window.innerHeight - trigger.bottom - gap;
      const spaceAbove = trigger.top - gap;
      let top: number;
      if (spaceBelow >= h) top = trigger.bottom + gap;
      else if (spaceAbove >= h) top = trigger.top - h - gap;
      else top = Math.max(gap, window.innerHeight - h - gap);
      const left = Math.max(gap, Math.min(trigger.left, window.innerWidth - w - gap));
      setOpenUp(top < trigger.top);
      setPos((prev) => (prev && prev.top === top && prev.left === left ? prev : { top, left }));
    }
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, viewY, viewM]);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      const t = e.target as Node;
      // ปฏิทินอยู่นอก wrapRef (portal) จึงต้องเช็คทั้งปุ่มและตัวปฏิทิน ไม่งั้นกดในปฏิทินแล้วปิดทันที
      if (wrapRef.current && !wrapRef.current.contains(t) && !panelRef.current?.contains(t)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const minP = parseIso(min);
  const maxP = parseIso(max);
  const minIso = minP ? toIso(minP.y, minP.m, minP.d) : null;
  const maxIso = maxP ? toIso(maxP.y, maxP.m, maxP.d) : null;

  function goPrevMonth() {
    if (viewM === 0) {
      setViewY((y) => y - 1);
      setViewM(11);
    } else {
      setViewM((m) => m - 1);
    }
  }
  function goNextMonth() {
    if (viewM === 11) {
      setViewY((y) => y + 1);
      setViewM(0);
    } else {
      setViewM((m) => m + 1);
    }
  }

  const firstOfMonth = new Date(viewY, viewM, 1);
  const startWeekday = firstOfMonth.getDay();
  const daysInMonth = new Date(viewY, viewM + 1, 0).getDate();
  const cells: Array<number | null> = [...Array(startWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const todayIso = toIso(today.getFullYear(), today.getMonth(), today.getDate());

  const label = parsed
    ? new Date(parsed.y, parsed.m, parsed.d).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })
    : null;

  return (
    <div className={`dpk${className ? ` ${className}` : ''}`} ref={wrapRef}>
      <button
        type="button"
        id={id}
        className="dpk-trigger"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="cal" className="sm" />
        {label ? <span>{label}</span> : <span className="dpk-placeholder">{ariaLabel ?? 'เลือกวันที่'}</span>}
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={panelRef}
          className={`dpk-panel${openUp ? ' up' : ''}`}
          role="dialog"
          aria-label={ariaLabel ?? 'เลือกวันที่'}
          // fixed ทับ absolute ของคลาส (ตำแหน่งจริงคำนวณด้านบน) · ซ่อนไว้จนกว่าจะวัดตำแหน่งเสร็จ กันปฏิทินวาบที่มุมจอ
          style={{ position: 'fixed', top: pos?.top ?? 0, left: pos?.left ?? 0, bottom: 'auto', zIndex: 1000, visibility: pos ? 'visible' : 'hidden' }}
        >
          <div className="dpk-head">
            <button type="button" className="dpk-nav" onClick={goPrevMonth} aria-label="เดือนก่อนหน้า">
              <Icon name="chev" className="sm" style={{ transform: 'rotate(90deg)' }} />
            </button>
            <span className="dpk-title">
              {MONTHS_TH[viewM]} {viewY + 543}
            </span>
            <button type="button" className="dpk-nav" onClick={goNextMonth} aria-label="เดือนถัดไป">
              <Icon name="chev" className="sm" style={{ transform: 'rotate(-90deg)' }} />
            </button>
          </div>

          <div className="dpk-weekdays">
            {WEEKDAYS_TH.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>

          <div className="dpk-grid">
            {cells.map((d, i) => {
              if (d == null) return <span key={i} className="dpk-cell empty" />;
              const iso = toIso(viewY, viewM, d);
              const isSelected = value === iso;
              const isToday = iso === todayIso;
              const isDisabled = (minIso != null && iso < minIso) || (maxIso != null && iso > maxIso);
              return (
                <button
                  key={i}
                  type="button"
                  className={`dpk-cell${isSelected ? ' on' : ''}${isToday && !isSelected ? ' today' : ''}`}
                  disabled={isDisabled}
                  onClick={() => {
                    onChange(iso);
                    setOpen(false);
                  }}
                >
                  {d}
                </button>
              );
            })}
          </div>

          <div className="dpk-foot">
            <button
              type="button"
              className="dpk-link-btn"
              onClick={() => {
                onChange(todayIso);
                setOpen(false);
              }}
            >
              วันนี้
            </button>
            {value && (
              <button
                type="button"
                className="dpk-link-btn"
                onClick={() => {
                  onChange('');
                  setOpen(false);
                }}
              >
                ล้างค่า
              </button>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
