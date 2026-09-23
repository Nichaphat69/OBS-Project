'use client';

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useRouter } from 'next/navigation';
import { StatusPill, Tag } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { DatePicker } from '../../../components/DatePicker';
import HrddCompare from './HrddCompare';
import { useLang } from '../../../lib/language';

export interface ReadResultShape {
  documentNo: string;
  model: string;
  data: {
    employeeName: string | null;
    position: string | null;
    period: string | null;
    totalWorkDays: number;
    totalLeaveDays: number;
    leaveDays: Array<{ date: string; type: string; rawLabel?: string }>;
    notes: string[];
  };
  matching: { employee: { id: string; nameTh: string } | null };
  contract: { id: string; customerName: string; monthlyRate: number; whtRate: number } | null;
  blockers: string[];
  // มีเฉพาะตอนมาจากแท็บ "ดึงจาก Gmail" — ดู gmailService.ts's readTimesheetFromEmail()
  sourceEmailId?: string;
  approvedBy?: string | null;
  approvedAt?: string | null;
  email?: { subject: string };
  // มีเฉพาะตอนมาจากแท็บ "รอจากพนักงาน" — แถว ai_reads ดิบที่พนักงานส่งเข้ามา ต้องส่งกลับตอน /confirm
  // เพื่อปิดแถวต้นทางนั้น ไม่งั้นจะค้างโผล่ในแท็บนั้นต่อไปทั้งที่ยืนยันเข้าระบบไปแล้ว
  sourceAiReadId?: number | null;
}

const LEAVE_TYPE_LABEL: Record<string, string> = { sick: 'ลาป่วย', personal: 'ลากิจ', vacation: 'ลาพักร้อน', unpaid: 'ลาไม่รับค่าจ้าง', unknown: 'อื่นๆ', other: 'อื่นๆ' };
/** ไอคอนต่อประเภทลา — ชุดเดียวกับ LEAVE_ICON ในหน้าตรวจ Manday's [id]/page.tsx เพื่อให้เห็นภาพเดียวกัน
 * ตั้งแต่ตอนกรอกจนถึงตอนตรวจ */
const LEAVE_TYPE_ICON: Record<string, string> = { sick: 'sickface', personal: 'idcard', vacation: 'plane', unpaid: 'cal', unknown: 'cal', other: 'cal' };

/** ประเภทหัก ณ ที่จ่ายที่พบบ่อย — ported from public/app.js's WHT_TYPES */
const WHT_TYPES = [
  { pct: 1, name: 'ค่าบริการขนส่งสินค้า' },
  { pct: 2, name: 'ค่าโฆษณา' },
  { pct: 3, name: 'ค่าจ้างทำของ / ค่าบริการ' },
  { pct: 5, name: 'ค่าเช่าทรัพย์สิน' },
];
const pctRound = (n: number) => Math.round(n * 100) / 100;

function money(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Shared review UI for both the upload-file and Gmail-intake tabs — one reviewed document,
 * editable employee/position/period, confirm-or-discard. */
export default function ReviewCard({ result, onDone }: { result: ReadResultShape; onDone: () => void }) {
  const { tx } = useLang();
  const router = useRouter();
  const [employeeName, setEmployeeName] = useState(result.data?.employeeName ?? '');
  const [position, setPosition] = useState(result.data?.position ?? '');
  const [period, setPeriod] = useState(result.data?.period ?? '');
  const [workDays, setWorkDays] = useState(String(result.data?.totalWorkDays ?? ''));
  /* ทุกช่องที่อ่านจากผลของเครื่องอ่านต้องกันค่าว่างไว้หมด — ผลที่ส่งกลับมาไม่ได้การันตีว่าครบทุกฟิลด์
     (เครื่องอ่านคนละเจ้า/เอกสารคนละแบบ ให้ผลไม่เท่ากัน) ถ้าพลาดแม้ช่องเดียว การ์ดนี้จะ throw ตอน
     render แล้ว **ทั้งหน้าอัปโหลดกลายเป็นจอขาว** ("Application error") ซึ่งแย่กว่าแสดงค่าว่างมาก
     เพราะไฟล์ถูกอ่านไปแล้ว (เสียเวลา/เสียเครดิต) แต่คนกดไม่เหลืออะไรให้ดูเลย (18 ก.ย. 69) */
  const [leaveDays, setLeaveDays] = useState<Array<{ date: string; type: string }>>(
    (result.data?.leaveDays ?? []).map((l) => ({ date: l.date, type: l.type })),
  );
  const [whtPct, setWhtPct] = useState(pctRound((result.contract?.whtRate ?? 0.03) * 100));
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmResult, setConfirmResult] = useState<any>(null);
  const { period: periodNotes, data: dataNotes } = splitNotesByTopic(result.data?.notes ?? []);

  function addLeaveDay() {
    setLeaveDays((d) => [...d, { date: '', type: 'sick' }]);
  }
  function updateLeaveDay(i: number, patch: Partial<{ date: string; type: string }>) {
    setLeaveDays((d) => d.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function removeLeaveDay(i: number) {
    setLeaveDays((d) => d.filter((_, idx) => idx !== i));
  }

  async function doConfirm() {
    setConfirming(true);
    setError(null);
    try {
      // ถ้าปรับอัตราหัก ณ ที่จ่ายไว้ต่างจากที่สัญญาตั้งไว้เดิม อัปเดตให้สัญญานี้ก่อน — ยิงแยกจากบันทึก
      // Timesheet เอง ถ้าอัปเดตไม่สำเร็จ (เช่นไม่ใช่แอดมิน) ไม่ควรบล็อกการยืนยัน Timesheet
      if (result.contract) {
        const currentPct = pctRound(result.contract.whtRate * 100);
        if (Math.abs(whtPct - currentPct) > 0.001) {
          try {
            await fetch(`/api/contracts/${encodeURIComponent(result.contract.id)}/wht-rate`, {
              method: 'PATCH',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ whtRate: whtPct / 100 }),
            });
          } catch {
            /* เงียบไว้ — บันทึก Timesheet ต่อได้แม้ปรับอัตราของสัญญาไม่สำเร็จ */
          }
        }
      }
      const res = await fetch('/api/timesheets/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          documentNo: result.documentNo,
          extraction: {
            ...(result.data ?? {}),
            employeeName,
            position,
            period,
            leaveDays,
            totalLeaveDays: leaveDays.length,
            // ช่องวันทำงานแก้ได้แล้ว ต้องส่งค่าที่แก้ไปด้วย ไม่ใช่ค่าเดิมจาก ...result.data
            totalWorkDays: Number(workDays) || 0,
          },
          readModel: result.model,
          sourceEmailId: result.sourceEmailId,
          sourceEmailSubject: result.email?.subject,
          approvedBy: result.approvedBy,
          approvedAt: result.approvedAt,
          sourceAiReadId: result.sourceAiReadId ?? null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? tx('บันทึกไม่สำเร็จ'));
        return;
      }
      if (!data.timesheetId) {
        setError(data.reason ?? tx('บันทึกไม่สำเร็จ'));
        return;
      }
      setConfirmResult(data);
    } finally {
      setConfirming(false);
    }
  }

  // บันทึกเสร็จ = จบขั้นตอนที่ 1 แล้ว ขั้นต่อไปของ flow คือ "ตรวจ Manday" เสมอ — เดิมค้างอยู่หน้านี้
  // ให้กดเข้าเมนูเองต่อ ซึ่งไม่ใช่ next step ที่ระบบตั้งใจให้ไป (เจ้าของระบบสั่ง 18 ก.ย. 69: ทุกปุ่ม
  // ทุกฟีเจอร์ต้องพาไปหน้าถัดไปของ flow เอง ไม่ใช่ค้างหน้าเดิม) โชว์ผลไว้ครู่หนึ่งให้ทันอ่านตัวเลข
  // ก่อนพาไปต่ออัตโนมัติ
  useEffect(() => {
    if (!confirmResult) return;
    const t = setTimeout(() => router.push('/manday'), 1400);
    return () => clearTimeout(t);
  }, [confirmResult, router]);

  if (confirmResult) {
    return (
      <div style={{ borderTop: '1px solid var(--hair)', paddingTop: 18 }}>
        <StatusPill tone="ok">{tx('บันทึกสำเร็จ')}</StatusPill>
        <div style={{ marginTop: 10 }} className="sub">
          {tx('เลขที่')} {confirmResult.timesheetId} · {tx('สถานะ')} {confirmResult.status} ·{' '}
          {confirmResult.manday ? `${tx('ยอด')} ${confirmResult.manday.lineAmount?.toLocaleString('en-US', { minimumFractionDigits: 2 })} ${tx('บาท')}` : ''}
        </div>
        <div className="sub" style={{ marginTop: 10 }}>{tx('กำลังพาไปหน้า "ตรวจ Manday"…')}</div>
      </div>
    );
  }

  return (
    <div style={{ borderTop: '1px solid var(--hair)', paddingTop: 18 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <Tag tone="mu">{tx('เลขที่')} {result.documentNo}</Tag>
        <Tag tone="mu">{tx('โมเดล')} {result.model}</Tag>
        {result.matching?.employee ? (
          <StatusPill tone="ok">{tx('จับคู่')}: {result.matching.employee!.nameTh}</StatusPill>
        ) : (
          <StatusPill tone="cr">{tx('จับคู่พนักงานไม่ได้')}</StatusPill>
        )}
        {result.contract && <Tag tone="mu">{result.contract.customerName}</Tag>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px,1fr))', gap: 14, marginBottom: 18 }}>
        <Field label={tx('ชื่อพนักงาน')} value={employeeName} onChange={setEmployeeName} />
        <Field label={tx('ตำแหน่ง')} value={position} onChange={setPosition} />
        <Field label={tx('รอบเดือน (YYYY-MM)')} value={period} onChange={setPeriod} />
        <Field label={tx('วันทำงาน')} value={workDays} onChange={setWorkDays} />
        {/* วันลาเป็นค่าที่นับจากรายการ "วันลาที่อ่านได้" ด้านล่าง ซึ่งเป็นตัวจริงที่แก้ไขได้ — ทำเป็นช่อง
            พิมพ์ได้ด้วยจะขัดกันเองทันทีที่สองค่าไม่ตรง จึงโชว์เป็นช่องอ่านอย่างเดียวให้รูปแบบเหมือนกัน */}
        <Field label={tx('วันลา (นับอัตโนมัติ)')} value={String(leaveDays.length)} readOnly />
      </div>
      {/* โน้ตเรื่องรอบเดือนอยู่ติดช่อง "รอบเดือน" ด้านบนทันที แทนที่จะลอยรวมอยู่ท้ายฟอร์ม */}
      <NoteList notes={periodNotes} />

      <div style={{ marginBottom: 18 }}>
        <div className="section-head" style={{ marginTop: 0 }}>
          <div>
            <div className="section-title">{tx('วันลาที่อ่านได้')}</div>
            <div className="sub" style={{ marginTop: 2 }}>{tx('แก้ไขได้ก่อนยืนยัน — เทียบกับ HRDD ด้านล่างเพื่อตรวจสอบ')}</div>
          </div>
          <button className="btn ghost sm" type="button" onClick={addLeaveDay}>
            + {tx('เพิ่มวันลา')}
          </button>
        </div>
        {/* โน้ตเรื่องตารางรายวัน/วันลา/OT/วันทำงาน — เกี่ยวกับข้อมูลรายวันทั้งหมด จึงมาก่อนรายการวันลา
            ที่เป็นข้อมูลรายวันส่วนเดียวที่มีอยู่จริงในฟอร์มนี้ */}
        <NoteList notes={dataNotes} />
        {leaveDays.length === 0 ? (
          <div className="leave-empty">{tx('ไม่มีวันลา')}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {leaveDays.map((l, i) => (
              <div key={i} className={`leave-row lv-${l.type}`}>
                <span className="lv-ic">
                  <Icon name={LEAVE_TYPE_ICON[l.type] ?? 'cal'} className="sm" />
                </span>
                <DatePicker value={l.date} onChange={(v) => updateLeaveDay(i, { date: v })} />
                <select value={l.type} onChange={(e) => updateLeaveDay(i, { type: e.target.value })} style={{ height: 36 }}>
                  {Object.entries(LEAVE_TYPE_LABEL)
                    .filter(([v]) => !['unpaid', 'unknown'].includes(v))
                    .map(([v, label]) => (
                      <option key={v} value={v}>
                        {tx(label)}
                      </option>
                    ))}
                </select>
                <button className="btn ghost sm icon" type="button" title={tx('ลบ')} aria-label={tx('ลบ')} onClick={() => removeLeaveDay(i)}>
                  <Icon name="x" />
                </button>
              </div>
            ))}
          </div>
        )}
        <HrddCompare
          employeeId={result.matching?.employee?.id ?? null}
          period={period}
          leaveDays={leaveDays}
          onLeaveDaysChange={setLeaveDays}
        />
      </div>

      <WhtSection contract={result.contract} pct={whtPct} onChange={setWhtPct} />

      {error && <div style={{ color: 'var(--cr)', marginBottom: 14 }}>{error}</div>}

      {(result.blockers ?? []).length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
          {(result.blockers ?? []).map((b, i) => (
            <div key={i} style={{ display: 'flex', gap: 10 }}>
              <StatusPill tone="cr">{tx('ติดปัญหา (ตอนอ่านไฟล์)')}</StatusPill>
              <span className="sub" style={{ marginTop: 4 }}>
                {b}
              </span>
            </div>
          ))}
          <span className="sub">
            {tx('แก้ไขช่องด้านบนแล้วลองกด "ยืนยัน" ได้เลย — ระบบตรวจซ้ำจากค่าที่แก้แล้วอีกครั้งตอนบันทึกจริง')}
          </span>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button className="btn ghost" onClick={onDone}>
          {tx('ทิ้งผลนี้')}
        </button>
        <button className="btn pri" disabled={confirming} onClick={doConfirm}>
          {confirming ? tx('กำลังบันทึก…') : tx('ยืนยันและบันทึกเข้าระบบ')}
        </button>
      </div>
    </div>
  );
}

/**
 * เดิม `result.data.notes` ทั้งหมดไม่ว่าจะพูดเรื่องอะไรถูกโยนรวมเป็นก้อนเดียวลอยไว้ท้ายฟอร์ม —
 * อ่านไม่รู้เรื่องว่าโน้ตไหนเตือนเรื่องอะไร เพราะไกลจากช่องที่พูดถึงเกินไป (เจ้าของระบบสั่ง 18 ก.ย. 69)
 *
 * โน้ตเป็น string ดิบจากฝั่งเซิร์ฟเวอร์ ไม่มีแท็กบอกว่าเกี่ยวกับส่วนไหน จึงแยกด้วยการจับคำในเนื้อความ
 * เอง — แยกแค่สองกลุ่มพอ ไม่ทำละเอียดเกินไปจนเปราะ เพราะเนื้อความมาจาก abbyyClient.ts และเปลี่ยนคำ
 * ได้ทุกเมื่อ: กลุ่ม "รอบเดือน" ไปอยู่ติดช่องกรอกรอบเดือน ที่เหลือ (ตาราง/วันลา/OT/วันทำงาน) ไปอยู่ติด
 * ส่วน "วันลาที่อ่านได้" เพราะเป็นส่วนข้อมูลรายวันส่วนเดียวที่มีอยู่จริงในฟอร์มนี้
 */
function splitNotesByTopic(notes: string[]): { period: string[]; data: string[] } {
  const period = notes.filter((n) => n.includes('รอบเดือน'));
  const data = notes.filter((n) => !n.includes('รอบเดือน'));
  return { period, data };
}

function NoteList({ notes }: { notes: string[] }) {
  if (notes.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8, marginBottom: 8 }}>
      {notes.map((n, i) => (
        <div key={i} className="sub">
          ⓘ {n}
        </div>
      ))}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  readOnly,
}: {
  label: string;
  value: string;
  onChange?: (v: string) => void;
  readOnly?: boolean;
}) {
  return (
    <label>
      <div className="ey">{label}</div>
      <input
        value={value}
        readOnly={readOnly}
        onChange={(e) => onChange?.(e.target.value)}
        style={{
          marginTop: 6,
          width: '100%',
          height: 38,
          borderRadius: 'var(--r-ctl)',
          border: '1px solid var(--rule)',
          padding: '0 12px',
          ...(readOnly ? { background: 'var(--sunk)', color: 'var(--mut)', cursor: 'default' } : null),
        }}
      />
    </label>
  );
}

/** กดปุ่มค้างไว้ให้ทำซ้ำเรื่อยๆ — ported from public/app.js's bindHoldRepeat(). กดครั้งแรกทำทันที
 * 1 ครั้ง แล้วรอ `delay` ก่อนเริ่มถี่ทุก `interval` รองรับทั้งเมาส์และจอสัมผัส */
function useHoldRepeat(callback: () => void, { delay = 400, interval = 80 } = {}) {
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  function stop() {
    if (timeout.current) clearTimeout(timeout.current);
    if (repeatTimer.current) clearInterval(repeatTimer.current);
    timeout.current = null;
    repeatTimer.current = null;
  }
  function start() {
    stop();
    callback();
    timeout.current = setTimeout(() => {
      repeatTimer.current = setInterval(callback, interval);
    }, delay);
  }
  return { onMouseDown: start, onMouseUp: stop, onMouseLeave: stop, onTouchStart: start, onTouchEnd: stop };
}

/** ส่วน "หัก ณ ที่จ่าย" — ported from public/app.js's whtSectionHtml()/the wht stepper wiring in
 * bindUploadTab(). ตั้งต้นจากอัตราที่ตั้งไว้ในสัญญาอยู่แล้ว เลือกประเภท/ปรับ % แล้วกดยืนยันตอนท้าย
 * จะอัปเดตอัตราของสัญญานี้ให้ด้วย (ดู doConfirm() ด้านบน) — ไม่มีสัญญาให้ยังปรับไม่ได้ */
function WhtSection({
  contract,
  pct,
  onChange,
}: {
  contract: { monthlyRate: number } | null;
  pct: number;
  onChange: Dispatch<SetStateAction<number>>;
}) {
  const { tx } = useLang();
  // ใช้ functional update (onChange(p => ...)) แทนอ่านค่า pct จาก closure ตรงๆ — ตอนกดค้าง
  // useHoldRepeat ตั้ง callback ไว้ตัวเดียวครั้งแรกที่กด แล้วเรียกซ้ำผ่าน setInterval เดิมตลอด ถ้าอ่าน
  // pct จาก closure จะได้ค่าตอนเริ่มกดค้างซ้ำๆ ไม่ขยับ ต้องให้ React ส่งค่าล่าสุดให้ทุกครั้งแทน
  const plus = useHoldRepeat(() => onChange((p) => pctRound(Math.min(30, p + 0.25))));
  const minus = useHoldRepeat(() => onChange((p) => pctRound(Math.max(0, p - 0.25))));

  if (!contract) {
    return (
      <div className="fsec">
        <div className="fsec-h">
          <b>{tx('หัก ณ ที่จ่าย')}</b>
        </div>
        <div className="sub">{tx('จับคู่ชื่อพนักงานกับคนในระบบก่อน ถึงจะเลือกประเภทหัก ณ ที่จ่ายได้')}</div>
      </div>
    );
  }

  const base = contract.monthlyRate || 0;
  const amount = Math.round(base * pct) / 100;

  return (
    <div className="fsec">
      <div className="fsec-h">
        <b>{tx('หัก ณ ที่จ่าย')}</b>
      </div>
      <div className="wht-types">
        {WHT_TYPES.map((w) => (
          <div key={w.pct} className={`wht-type${w.pct === pct ? ' on' : ''}`} onClick={() => onChange(w.pct)}>
            <div className="nm">{tx(w.name)}</div>
          </div>
        ))}
      </div>
      <div className="stepper-row">
        <div className="lbl">{tx('อัตราหัก ณ ที่จ่าย')}</div>
        <div className="stepper">
          <button type="button" {...minus}>
            −
          </button>
          {/* พิมพ์เองได้ ไม่ต้องกด −/+ ทีละขั้น — ปุ่มยังอยู่สำหรับปรับละเอียดทีละ 0.1 */}
          <span className="valbox">
            <input
              className="val"
              type="number"
              step="0.1"
              min="0"
              max="100"
              value={pct}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (e.target.value === '' || !Number.isFinite(n)) return;
                onChange(pctRound(Math.min(100, Math.max(0, n))));
              }}
            />
            <span className="pcs">%</span>
          </span>
          <button type="button" {...plus}>
            +
          </button>
        </div>
      </div>
      <div className="wht-result">
        <span>
          {tx('หัก ณ ที่จ่าย')} {pct}% {tx('จากยอดประมาณ')} {money(base)}
        </span>
        <span>−{money(amount)}</span>
      </div>
    </div>
  );
}
