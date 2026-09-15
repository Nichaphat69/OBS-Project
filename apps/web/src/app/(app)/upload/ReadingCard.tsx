'use client';

import { useEffect, useState } from 'react';
import { useLang } from '../../../lib/language';

/**
 * การ์ด "AI กำลังอ่าน" — ported from public/app.js's pendingReadHtml()/tickPendingReads() (the
 * `.card.pending`/`.readwait`/`@keyframes readslide` CSS lives in globals.css). Shows the moment
 * reading starts (in the same spot the result will appear), with a running mm:ss timer so it's
 * clear the system is still working, not stuck — extraction reads a document page-by-page and can
 * take several minutes for a multi-page file.
 */
const READ_SECONDS_PER_PAGE = 60; // วัดจากของจริงบนเซิร์ฟเวอร์ ~54 วินาที/หน้า — ตรงต้นฉบับ

function formatElapsed(startedAt: number): string {
  const secs = Math.floor((Date.now() - startedAt) / 1000);
  const mm = String(Math.floor(secs / 60)).padStart(2, '0');
  const ss = String(secs % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

export default function ReadingCard({ fileName, email }: { fileName: string | null; email?: boolean }) {
  const { tx } = useLang();
  const [startedAt] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState('00:00');

  useEffect(() => {
    const id = setInterval(() => setElapsed(formatElapsed(startedAt)), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  return (
    <div className="card pending">
      <div className="hd">
        <h3>{tx(email ? 'ระบบกำลังอ่านเมลและไฟล์แนบ' : 'ระบบกำลังอ่านไฟล์')}</h3>
        <span className="rt n">{elapsed}</span>
      </div>
      <div className="bd">
        <div className="readwait">
          <div className="bar">
            <i />
          </div>
          <b>{fileName ?? tx('ไฟล์ Timesheet')}</b>
          <span>
            {tx('อ่านทีละหน้าแล้วรวมผล — เอกสารทั่วไปราว')} {READ_SECONDS_PER_PAGE} {tx('วินาทีต่อหน้า')}
            {' '}
            {tx('ไฟล์ที่รวม Timesheet หลายคนจะใช้เวลาหลายนาที ปล่อยหน้านี้ไว้ได้เลย')}
          </span>
        </div>
      </div>
    </div>
  );
}
