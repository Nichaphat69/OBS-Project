'use client';

import { Fragment, useEffect, useState } from 'react';
import { Card, ErrorState, StatusPill, Tag } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { usePdfPreview, useToast } from '../../../components/Overlays';
import { useLang } from '../../../lib/language';

interface AiReadItem {
  id: number;
  source: string;
  fileName: string | null;
  employeeName: string | null;
  period: string | null;
  periodLabel: string | null;
  documentNo: string | null;
  status: string;
  model: string | null;
  readAt: string;
  readBy: string | null;
}

/**
 * ⚠️ ทุกฟิลด์ใน `extraction` เป็น optional โดยตั้งใจ — เครื่องอ่านคนละเจ้าคืนคนละชุด และใบเก่าก็ไม่มี
 * ฟิลด์ที่เพิ่งเพิ่มทีหลัง (ตรวจจากของจริงในฐานข้อมูล 18 ก.ย. 69: ใบ ABBYY บางใบไม่มี `days`/`notes`/
 * `period` เลย ส่วนแถวรายวันของ ABBYY กับ Clear Read มีคีย์ไม่เหมือนกัน)
 *
 * เดิมประกาศ type ว่าฟิลด์พวกนี้อยู่บน `extraction` ตรงๆ และเป็น required ซึ่ง**ผิดทั้งคู่** — ของจริง
 * อยู่ใต้ `extraction.data` ทำให้โค้ดเดิมอ่าน `extraction.leaveDays` ได้ `undefined` แล้วไปเรียก
 * `.length` ต่อ → จอขาวทั้งหน้าทุกครั้งที่กดแถวในตารางนี้
 */
interface ExtractionDay {
  date?: string | null;
  dayOfWeek?: string | null;
  timeIn?: string | null;
  timeOut?: string | null;
  normalHours?: number | null;
  otHours?: number | null;
  totalHours?: number | null;
  leaveType?: string | null;
  remark?: string | null;
  jobDescription?: string | null;
  activity?: string | null;
  type?: string | null;
}
interface AiReadDetail extends AiReadItem {
  extraction: {
    data?: {
      period?: string | null;
      monthYear?: string | null;
      position?: string | null;
      employeeName?: string | null;
      totalWorkDays?: number | null;
      totalLeaveDays?: number | null;
      leaveDays?: Array<{ date?: string | null; type?: string | null; rawLabel?: string | null }> | null;
      otDays?: Array<{ date?: string | null; hours?: number | null }> | null;
      days?: ExtractionDay[] | null;
      notes?: string[] | null;
    } | null;
    blockers?: string[] | null;
    fileName?: string | null;
  } | null;
}

const STATUS_TONE: Record<string, 'ok' | 'wn' | 'mu'> = {
  confirmed: 'ok',
  pending: 'wn',
};

// เดิมโชว์ค่า enum ดิบ ('confirmed'/'pending') ตรงๆ — บั๊กชนิดเดียวกับที่เจอในหน้าใบแจ้งหนี้ 18 ก.ย. 69
const STATUS_LABEL: Record<string, string> = {
  confirmed: 'ยืนยันแล้ว',
  pending: 'รอดำเนินการ',
};

const LEAVE_TYPE_LABEL: Record<string, string> = { sick: 'ลาป่วย', personal: 'ลากิจ', vacation: 'ลาพักร้อน', unpaid: 'ลาไม่รับค่าจ้าง', unknown: 'อื่นๆ', other: 'อื่นๆ' };

/** คอลัมน์รายวันที่จะโชว์ — เลือกเฉพาะคอลัมน์ที่ "มีข้อมูลจริงอย่างน้อยหนึ่งแถว" เพราะแต่ละเครื่องอ่าน
 * เติมคนละชุด (ABBYY มี normalHours/label ส่วน Clear Read มี ticketId/status) ถ้าโชว์ทุกคอลัมน์ตายตัว
 * ตารางจะเต็มไปด้วยช่องว่างจนอ่านไม่ออกว่าอ่านอะไรได้จริงบ้าง */
const DAY_COLUMNS: Array<{ key: keyof ExtractionDay; label: string; numeric?: boolean }> = [
  { key: 'date', label: 'วันที่' },
  { key: 'dayOfWeek', label: 'วัน' },
  { key: 'timeIn', label: 'เข้า' },
  { key: 'timeOut', label: 'ออก' },
  { key: 'normalHours', label: 'ชม.ปกติ', numeric: true },
  { key: 'otHours', label: 'ชม. OT', numeric: true },
  { key: 'totalHours', label: 'รวม', numeric: true },
  { key: 'leaveType', label: 'ประเภทลา' },
  { key: 'jobDescription', label: 'รายละเอียดงาน' },
  { key: 'remark', label: 'หมายเหตุ' },
];

function hasValue(v: unknown): boolean {
  return v !== null && v !== undefined && v !== '';
}

function ReadDetail({ detail }: { detail: AiReadDetail }) {
  const { tx } = useLang();
  const openPdfPreview = usePdfPreview();
  const [showDays, setShowDays] = useState(false);

  // ทุกบรรทัดต่อจากนี้อ่านผ่าน `?.` / `?? []` เสมอ — ห้ามสมมติว่าฟิลด์ไหนมีอยู่
  const d = detail.extraction?.data ?? null;
  const notes = d?.notes ?? [];
  const blockers = detail.extraction?.blockers ?? [];
  const leaveDays = d?.leaveDays ?? [];
  const otDays = d?.otDays ?? [];
  const days = d?.days ?? [];
  const fileName = detail.fileName ?? detail.extraction?.fileName ?? null;

  if (!detail.extraction) {
    return <div className="sub">{tx('ไม่มีผลการอ่านเก็บไว้สำหรับรายการนี้')}</div>;
  }

  const shownCols = DAY_COLUMNS.filter((c) => days.some((row) => hasValue(row?.[c.key])));

  return (
    <div className="rdx">
      <div className="rdx-chips">
        <span className="rdx-chip">
          <span className="k">{tx('รอบเดือน')}</span>
          <span className="v">{d?.period ?? d?.monthYear ?? '—'}</span>
        </span>
        <span className="rdx-chip">
          <span className="k">{tx('วันทำงาน')}</span>
          <span className="v">{hasValue(d?.totalWorkDays) ? `${d?.totalWorkDays} ${tx('วัน')}` : '—'}</span>
        </span>
        <span className="rdx-chip">
          <span className="k">{tx('วันลา')}</span>
          <span className="v">{hasValue(d?.totalLeaveDays) ? `${d?.totalLeaveDays} ${tx('วัน')}` : leaveDays.length ? `${leaveDays.length} ${tx('วัน')}` : '—'}</span>
        </span>
        <span className="rdx-chip">
          <span className="k">{tx('วัน OT')}</span>
          <span className="v">{otDays.length ? `${otDays.length} ${tx('วัน')}` : '—'}</span>
        </span>
        <span className="rdx-chip">
          <span className="k">{tx('ตำแหน่งที่อ่านได้')}</span>
          <span className="v">{d?.position ?? '—'}</span>
        </span>
        {fileName && (
          <button type="button" className="file" onClick={() => openPdfPreview(`/api/ai-reads/${detail.id}/file`, fileName)}>
            <span className="pd">PDF</span> {fileName}
          </button>
        )}
      </div>

      {blockers.length > 0 && (
        <div className="rdx-block">
          <div className="rdx-h">{tx('ติดปัญหาตอนอ่าน')}</div>
          {blockers.map((b, i) => (
            <div key={i} className="rdx-note bad">
              <Icon name="alt" /> <span>{b}</span>
            </div>
          ))}
        </div>
      )}

      {notes.length > 0 && (
        <div className="rdx-block">
          <div className="rdx-h">{tx('สิ่งที่ระบบเตือนไว้')}</div>
          {notes.map((n, i) => (
            <div key={i} className="rdx-note">
              <Icon name="info" /> <span>{n}</span>
            </div>
          ))}
        </div>
      )}

      <div className="rdx-cols">
        <div className="rdx-block">
          <div className="rdx-h">{tx('วันลาที่อ่านได้')} ({leaveDays.length})</div>
          {leaveDays.length === 0 ? (
            <div className="sub">{tx('ไม่มีวันลาที่อ่านได้ในรอบนี้')}</div>
          ) : (
            leaveDays.map((l, i) => (
              <div key={i} className="rdx-line">
                <span className="n">{l?.date ?? '—'}</span>
                <Tag tone="mu">{tx(LEAVE_TYPE_LABEL[l?.type ?? ''] ?? l?.type ?? '—')}</Tag>
                {l?.rawLabel && <span className="sub">{l.rawLabel}</span>}
              </div>
            ))
          )}
        </div>

        <div className="rdx-block">
          <div className="rdx-h">{tx('วัน OT ที่อ่านได้')} ({otDays.length})</div>
          {otDays.length === 0 ? (
            <div className="sub">{tx('ไม่มี OT ที่อ่านได้ในรอบนี้')}</div>
          ) : (
            otDays.map((o, i) => (
              <div key={i} className="rdx-line">
                <span className="n">{o?.date ?? '—'}</span>
                <Tag tone="mu">{hasValue(o?.hours) ? `${o?.hours} ${tx('ชม.')}` : '—'}</Tag>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ตารางรายวันยาวได้ถึง 31 แถว — พับไว้ก่อน ไม่งั้นแถวเดียวที่กางกินจอทั้งหน้าจนเลื่อนหาแถวอื่นไม่เจอ */}
      <div className="rdx-block">
        <button type="button" className="rdx-toggle" onClick={() => setShowDays((v) => !v)} aria-expanded={showDays}>
          <Icon name="chev" className={showDays ? 'rdx-chev on' : 'rdx-chev'} />
          {tx('ตารางรายวันที่อ่านได้')} ({days.length})
        </button>
        {showDays &&
          (days.length === 0 || shownCols.length === 0 ? (
            <div className="sub">{tx('เครื่องอ่านไม่ได้ส่งตารางรายวันมาสำหรับใบนี้')}</div>
          ) : (
            <div className="tw">
              <table className="rdx-table">
                <thead>
                  <tr>
                    {shownCols.map((c) => (
                      <th key={String(c.key)} className={c.numeric ? 'r' : undefined}>
                        {tx(c.label)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {days.map((row, i) => (
                    <tr key={i}>
                      {shownCols.map((c) => {
                        const v = row?.[c.key];
                        return (
                          <td key={String(c.key)} className={c.numeric ? 'r n' : undefined}>
                            {hasValue(v) ? String(v) : '—'}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
      </div>
    </div>
  );
}

export default function HistoryTab() {
  const { tx } = useLang();
  const toast = useToast();
  const [rows, setRows] = useState<AiReadItem[] | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [details, setDetails] = useState<Record<number, AiReadDetail | 'loading' | 'error'>>({});

  function load() {
    setError(null);
    fetch('/api/ai-reads', { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          setError(data?.error ?? tx('โหลดข้อมูลไม่สำเร็จ'));
          return;
        }
        setRows(await r.json());
      })
      .catch(() => setError(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้')));
  }

  useEffect(load, []);

  function toggleExpand(id: number) {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (!details[id]) {
      setDetails((d) => ({ ...d, [id]: 'loading' }));
      fetch(`/api/ai-reads/${id}`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((data: AiReadDetail) => setDetails((d) => ({ ...d, [id]: data })))
        .catch(() => setDetails((d) => ({ ...d, [id]: 'error' })));
    }
  }

  async function dismiss(id: number) {
    setBusyId(id);
    try {
      const res = await fetch('/api/ai-reads/dismiss', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(data?.error ?? tx('ทิ้งไม่สำเร็จ'), true);
        return;
      }
      load();
    } catch {
      toast(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'), true);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card title={tx('ประวัติ AI อ่านไฟล์')} flush>
      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : (
      <div className="tw">
        <table>
          <thead>
            <tr>
              <th>{tx('เลขที่')}</th>
              <th>{tx('รอบ')}</th>
              <th>{tx('พนักงาน')}</th>
              <th>{tx('ที่มา')}</th>
              <th>{tx('โมเดล')}</th>
              <th>{tx('สถานะ')}</th>
              <th>{tx('อ่านเมื่อ')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows?.map((r) => {
              const expanded = expandedId === r.id;
              const detail = details[r.id];
              return (
                <Fragment key={r.id}>
                  <tr className="rw" onClick={() => toggleExpand(r.id)} title={tx('คลิกเพื่อดูรายละเอียดที่ระบบอ่านได้')}>
                    <td className="docid">{r.documentNo}</td>
                    <td>{r.periodLabel ?? '—'}</td>
                    <td className="nm">{r.employeeName ?? '—'}</td>
                    <td>
                      <Tag tone="mu">{r.source === 'upload' ? tx('อัปโหลดไฟล์') : 'Gmail'}</Tag>
                    </td>
                    <td>{r.model ?? '—'}</td>
                    <td>
                      <StatusPill tone={STATUS_TONE[r.status] ?? 'mu'}>{tx(STATUS_LABEL[r.status] ?? r.status)}</StatusPill>
                    </td>
                    <td className="sub">{r.readAt?.slice(0, 19).replace('T', ' ')}</td>
                    <td className="r">
                      <button
                        className="btn dgr sm"
                        disabled={busyId === r.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          dismiss(r.id);
                        }}
                      >
                        {tx('ทิ้ง')}
                      </button>
                    </td>
                  </tr>
                  {expanded && (
                    <tr>
                      <td colSpan={8} style={{ background: 'var(--sunk)' }}>
                        {detail === 'loading' && <div className="sub" style={{ padding: 12 }}>{tx('กำลังโหลด…')}</div>}
                        {detail === 'error' && <div style={{ padding: 12, color: 'var(--cr)' }}>{tx('โหลดรายละเอียดไม่สำเร็จ')}</div>}
                        {detail && detail !== 'loading' && detail !== 'error' && <ReadDetail detail={detail} />}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {rows && rows.length === 0 && (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', color: 'var(--mut)' }}>
                  {tx('ยังไม่มีประวัติ')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      )}
    </Card>
  );
}
