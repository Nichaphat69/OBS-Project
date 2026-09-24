'use client';

import { useEffect, useState } from 'react';
import { EmptyState, StatusPill } from '../../../components/ui';
import { useLang } from '../../../lib/language';

/**
 * เทียบวันลากับ HRDD ตอนรีวิวก่อนบันทึกใน "อัปโหลด Timesheet" — ported from public/app.js's
 * runHrddPreviewCompare/renderHrddCompareInto/buildHrddResolvePanel/applyHrddResolve.
 *
 * ดูอย่างเดียว — เรียก HRDD ผ่าน /api/hrdd-compare-preview (สถานะวันลา + รายการวันลา) ไม่มีเขียน/แก้/
 * ลบฝั่ง HRDD ตรรกะเทียบอยู่ที่ @obs/domain's compareLeaves() (ฝั่งเซิร์ฟเวอร์) หน้านี้แค่รับผลมาแสดง
 * และแก้ตาราง leaveDays ของการ์ดตามที่คนเลือกใน panel "แก้ไข"
 */

const HRDD_STATUS_LABEL: Record<string, string> = { ok: 'ตรงกัน', warn: 'ประเภทไม่ตรง', info: 'ไม่พบใน Timesheet', bad: 'ไม่พบใน HRDD' };
const HRDD_STATUS_TONE: Record<string, 'ok' | 'wn' | 'pr' | 'cr' | 'mu'> = { ok: 'ok', warn: 'wn', info: 'pr', bad: 'cr' };
const LEAVE_OPTIONS: Record<string, string> = { sick: 'ลาป่วย', personal: 'ลากิจ', vacation: 'ลาพักร้อน', other: 'อื่นๆ' };

interface HrddRow {
  date: string;
  tsType: string | null;
  hrddType: string | null;
  status: 'ok' | 'warn' | 'info' | 'bad';
  /** ชั่วโมงที่ HRDD บันทึกไว้ — null = ลาเต็มวัน (หรือไม่มีข้อมูล) มีค่า = HRDD บอกว่าลาไม่เต็มวัน
   * (24 ก.ย. 69 ตามที่ขอ) แสดงไว้ให้คนตรวจเห็นเฉยๆ ยังไม่ผูกเข้ากลไก "แก้ไข" ด้านล่าง (นั่นแก้แค่
   * ประเภทวันลา ไม่ใช่จำนวนชั่วโมง) — เห็นแล้วไปแก้ช่อง "ชั่วโมงที่ลา" ในตารางด้านบนเองตามที่เห็นสมควร */
  hrddHours: number | null;
}
interface HrddSummary {
  counts: { ok: number; warn: number; info: number; bad: number };
  total: number;
  mismatched: number;
}
type HrddResult =
  | { state: 'not_connected' | 'error'; message: string }
  | { state: 'match' | 'diff'; rows: HrddRow[]; summary: HrddSummary; checkedAt: string };

export interface LeaveDayEdit {
  date: string;
  type: string;
  hours?: number | null;
}

function toOption(type: string | null | undefined): string {
  return type && LEAVE_OPTIONS[type] ? type : 'other';
}

function mismatchNote(r: HrddRow, tx: (th: string) => string): string {
  if (r.status === 'warn') return `${tx('Timesheet ระบุ')} "${r.tsType}" ${tx('แต่ HRDD บันทึกเป็น')} "${r.hrddType}" — ${tx('ควรยืนยันประเภทวันลาที่ถูกต้องกับพนักงานก่อนวางบิล')}`;
  if (r.status === 'info') return tx('พบวันลาที่อนุมัติแล้วใน HRDD แต่ไม่ถูกระบุในตาราง Timesheet — จำนวนวันทำงานที่คำนวณได้อาจไม่ถูกต้อง');
  if (r.status === 'bad') return tx('พนักงานระบุว่าลาในตาราง Timesheet แต่ไม่พบการอนุมัติใน HRDD — อาจยังไม่ได้ยื่นคำขอลาในระบบเช็คชื่อ');
  return '';
}

export default function HrddCompare({
  employeeId,
  period,
  leaveDays,
  onLeaveDaysChange,
}: {
  employeeId: string | null;
  period: string;
  leaveDays: LeaveDayEdit[];
  onLeaveDaysChange: (next: LeaveDayEdit[]) => void;
}) {
  const { tx } = useLang();
  const [result, setResult] = useState<HrddResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [openDate, setOpenDate] = useState<string | null>(null);
  const [resolved, setResolved] = useState<Record<string, string>>({});

  const periodOk = /^\d{4}-\d{2}$/.test(period ?? '');

  async function run() {
    if (!employeeId || !periodOk) return;
    setLoading(true);
    setOpenDate(null);
    try {
      const res = await fetch('/api/hrdd-compare-preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ employeeId, period, leaveDays: leaveDays.map((l) => ({ date: l.date, type: l.type, hours: l.hours })) }),
      });
      const data = await res.json();
      setResult(res.ok ? data : { state: 'error', message: data.error ?? tx('ตรวจสอบไม่สำเร็จ') });
    } catch (e: any) {
      setResult({ state: 'error', message: e.message ?? tx('เชื่อมต่อไม่สำเร็จ') });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (employeeId && periodOk) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId, period]);

  function resolveRow(row: HrddRow, choice: 'use-hrdd' | 'use-ts' | 'custom', customType: string, reason: string) {
    const choiceLabel = choice === 'use-hrdd' ? tx('ใช้ตาม HRDD') : choice === 'use-ts' ? tx('ใช้ตาม Timesheet') : tx('ระบุเอง');

    if (row.status === 'warn') {
      const finalType = choice === 'use-hrdd' ? toOption(row.hrddType) : choice === 'use-ts' ? toOption(row.tsType) : customType;
      onLeaveDaysChange(leaveDays.map((l) => (l.date === row.date ? { ...l, type: finalType } : l)));
    } else if (row.status === 'info') {
      if (choice !== 'use-ts') {
        const finalType = choice === 'use-hrdd' ? toOption(row.hrddType) : customType;
        onLeaveDaysChange([...leaveDays, { date: row.date, type: finalType }]);
      }
      // 'use-ts' — Timesheet ไม่มีแถวนี้อยู่แล้ว ปล่อยว่างไว้ตามเดิม ไม่ต้องทำอะไร
    } else if (row.status === 'bad') {
      if (choice === 'use-hrdd') {
        onLeaveDaysChange(leaveDays.filter((l) => l.date !== row.date));
      } else if (choice === 'custom') {
        onLeaveDaysChange(leaveDays.map((l) => (l.date === row.date ? { ...l, type: customType } : l)));
      }
      // 'use-ts' — เก็บไว้ตามเดิม ไม่ต้องทำอะไร
    }

    setResolved((r) => ({ ...r, [row.date]: `${choiceLabel} — ${reason}` }));
    setOpenDate(null);
  }

  // ไม่มีเงื่อนไข "วันลาว่าง = ซ่อนทั้งหมด" ตรงนี้เลยโดยตั้งใจ — ต่อให้ Timesheet ไม่มีวันลาสักวัน
  // ก็ยังต้องเทียบกับ HRDD อยู่ดี (เผื่อ HRDD มีอนุมัติวันลาไว้แต่ Timesheet ไม่ได้ระบุ ก็ควรขึ้นเป็น
  // ความไม่ตรงกันให้เห็น) — 2 เงื่อนไขด้านล่างที่ทำให้ยังเทียบไม่ได้จริงๆ (ยังไม่รู้ตัวพนักงาน/รอบเดือน)
  // ก็ยังคงโครงหัวข้อ+เส้นแบ่งของ section นี้ไว้เหมือนตอนมีข้อมูล ไม่ใช่แค่ข้อความลอยบรรทัดเดียว ไม่งั้น
  // ดูเหมือนทั้ง section หายไปเฉยๆ (ตามที่ user รายงาน เทียบกับ reference design)
  const notReady = !employeeId
    ? tx('จับคู่ชื่อพนักงานกับคนในระบบก่อน (ด้านบน) ถึงจะเทียบกับ HRDD ได้')
    : !periodOk
      ? tx('รอบเดือนยังไม่ถูกต้อง แก้ "รอบเดือน" ด้านบนก่อน')
      : null;

  return (
    <div style={{ marginTop: 18, borderTop: '1px solid var(--hair)', paddingTop: 14 }}>
      <div className="section-head" style={{ marginTop: 0 }}>
        <div className="section-title">{tx('เทียบกับ HRDD (ระบบเช็คชื่อบริษัทหลัก)')}</div>
        {!notReady && (
          <div className="hrdd-actions" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {(result?.state === 'match' || result?.state === 'diff') && (
              <span className="hrddMeta">{tx('ซิงค์ล่าสุด')} {result.checkedAt.slice(0, 19).replace('T', ' ')}</span>
            )}
            <button className="btn ghost sm" type="button" disabled={loading} onClick={run}>
              {loading ? tx('กำลังตรวจสอบ…') : tx('รีเฟรชจาก HRDD')}
            </button>
          </div>
        )}
      </div>

      {notReady && <EmptyState label={notReady} />}

      {!notReady && loading && <div className="sub">{tx('กำลังตรวจสอบวันลากับ HRDD…')}</div>}

      {!notReady && !loading && result?.state === 'not_connected' && <div className="sub">{result.message}</div>}
      {!notReady && !loading && result?.state === 'error' && (
        <div>
          <div style={{ color: 'var(--cr)' }}>{result.message}</div>
          <button className="btn sm" type="button" style={{ marginTop: 8 }} onClick={run}>
            {tx('ลองใหม่')}
          </button>
        </div>
      )}

      {!notReady && !loading && (result?.state === 'match' || result?.state === 'diff') && (
        <>
          {result.rows.length === 0 ? (
            <div className="sub">{tx('ไม่มีวันลาให้เทียบในรอบนี้ (ไม่มีทั้งฝั่ง Timesheet และ HRDD)')}</div>
          ) : (
            <>
              {result.summary.mismatched > 0 ? (
                <StatusPill tone="wn">{tx('พบความไม่ตรงกัน')} {result.summary.mismatched} {tx('รายการ — กรุณาตรวจสอบก่อนวางบิล')}</StatusPill>
              ) : (
                <StatusPill tone="ok">{tx('ข้อมูลวันลาตรงกันทั้งหมด')} ({result.summary.counts.ok}/{result.summary.total})</StatusPill>
              )}

              <div className="stat-tiles" style={{ marginTop: 10 }}>
                <div className="stat-tile ok">
                  <span className="stx">
                    <span className="stv">{result.summary.counts.ok}</span>
                    <span className="stl">{tx(HRDD_STATUS_LABEL.ok)}</span>
                  </span>
                </div>
                <div className="stat-tile wn">
                  <span className="stx">
                    <span className="stv">{result.summary.counts.warn}</span>
                    <span className="stl">{tx(HRDD_STATUS_LABEL.warn)}</span>
                  </span>
                </div>
                <div className="stat-tile pr">
                  <span className="stx">
                    <span className="stv">{result.summary.counts.info}</span>
                    <span className="stl">{tx(HRDD_STATUS_LABEL.info)}</span>
                  </span>
                </div>
                <div className="stat-tile cr">
                  <span className="stx">
                    <span className="stv">{result.summary.counts.bad}</span>
                    <span className="stl">{tx(HRDD_STATUS_LABEL.bad)}</span>
                  </span>
                </div>
              </div>

              <div className="tw" style={{ marginTop: 10 }}>
                <table style={{ minWidth: 0 }}>
                  <thead>
                    <tr>
                      <th>{tx('วันที่')}</th>
                      <th>Timesheet</th>
                      <th>HRDD</th>
                      <th>{tx('สถานะ')}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((r) => (
                      <RowGroup
                        key={r.date}
                        r={r}
                        resolvedNote={resolved[r.date]}
                        open={openDate === r.date}
                        onToggle={() => setOpenDate(openDate === r.date ? null : r.date)}
                        onSave={(choice, customType, reason) => resolveRow(r, choice, customType, reason)}
                        onCancel={() => setOpenDate(null)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function RowGroup({
  r,
  resolvedNote,
  open,
  onToggle,
  onSave,
  onCancel,
}: {
  r: HrddRow;
  resolvedNote?: string;
  open: boolean;
  onToggle: () => void;
  onSave: (choice: 'use-hrdd' | 'use-ts' | 'custom', customType: string, reason: string) => void;
  onCancel: () => void;
}) {
  const { tx } = useLang();
  const [choice, setChoice] = useState<'use-hrdd' | 'use-ts' | 'custom'>('use-hrdd');
  const [customType, setCustomType] = useState('other');
  const [reason, setReason] = useState('');
  const [invalid, setInvalid] = useState(false);

  const isResolved = Boolean(resolvedNote);

  function save() {
    if (!reason.trim()) {
      setInvalid(true);
      return;
    }
    onSave(choice, customType, reason.trim());
  }

  return (
    <>
      <tr className={`hrdd-row ${isResolved ? 'ok' : HRDD_STATUS_TONE[r.status]}`}>
        <td className="n">
          <div>{r.date}</div>
          {isResolved ? (
            <div className="why">
              <b>{resolvedNote}</b>
            </div>
          ) : (
            r.status !== 'ok' && <div className="why">{mismatchNote(r, tx)}</div>
          )}
        </td>
        <td>{r.tsType ? tx(LEAVE_OPTIONS[r.tsType] ?? r.tsType) : <span className="sub">— {tx('ไม่มีข้อมูล')}</span>}</td>
        <td>
          {r.hrddType ? (
            <>
              {tx(LEAVE_OPTIONS[r.hrddType] ?? r.hrddType)}
              {r.hrddHours != null && <span className="sub"> ({r.hrddHours} {tx('ชม.')})</span>}
            </>
          ) : (
            <span className="sub">— {tx('ไม่มีข้อมูล')}</span>
          )}
        </td>
        <td>
          {isResolved ? (
            <span className="st mu">{tx('แก้ไขแล้ว')}</span>
          ) : (
            <span className={`st ${HRDD_STATUS_TONE[r.status]}`}>{tx(HRDD_STATUS_LABEL[r.status])}</span>
          )}
        </td>
        <td>{!isResolved && r.status !== 'ok' && (
          <button className="btn sm" type="button" onClick={onToggle}>
            {tx('แก้ไข')}
          </button>
        )}</td>
      </tr>
      {open && !isResolved && (
        <tr>
          <td colSpan={5}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 0' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="radio" checked={choice === 'use-hrdd'} onChange={() => setChoice('use-hrdd')} /> {tx('ใช้ตาม HRDD')}{' '}
                <span className="sub">({tx('แนะนำ')})</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="radio" checked={choice === 'use-ts'} onChange={() => setChoice('use-ts')} /> {tx('ใช้ตาม Timesheet')}
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="radio" checked={choice === 'custom'} onChange={() => setChoice('custom')} /> {tx('ระบุเอง')}{' '}
                {choice === 'custom' && (
                  <select value={customType} onChange={(e) => setCustomType(e.target.value)}>
                    {Object.entries(LEAVE_OPTIONS).map(([v, label]) => (
                      <option key={v} value={v}>
                        {tx(label)}
                      </option>
                    ))}
                  </select>
                )}
              </label>
              <label>
                {tx('เหตุผล / หมายเหตุ')} <span style={{ color: 'var(--cr)' }}>*{tx('จำเป็น')}</span>
              </label>
              <textarea
                rows={2}
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  setInvalid(false);
                }}
                placeholder="เช่น ตรวจสอบกับพนักงานแล้วว่า..."
                style={{ borderColor: invalid ? 'var(--cr)' : undefined }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button className="btn ghost sm" type="button" onClick={onCancel}>
                  {tx('ยกเลิก')}
                </button>
                <button className="btn pri sm" type="button" onClick={save}>
                  {tx('บันทึกการแก้ไข')}
                </button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
