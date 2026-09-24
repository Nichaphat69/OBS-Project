'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { PageHeader, PoTag, ReadModelTag, StatusPill, parseReadModel } from '../../../../components/ui';
import { useReadModelNameMap } from '../../../../components/readModelNames';
import { Icon } from '../../../../components/Icon';
import { usePdfPreview, useToast } from '../../../../components/Overlays';
import { useLang } from '../../../../lib/language';

interface CalendarDay {
  date: string;
  day: number;
  dayOfWeek: number;
  kind: 'workday' | 'weekend' | 'holiday' | 'leave';
  label: string | null;
}

interface Manday {
  monthlyRate: number;
  standardWorkingDays: number;
  leaveCount: number;
  // เผื่อ timesheet เก่าที่คำนวณไว้ก่อน field พวกนี้จะถูกเพิ่มเข้ามา (timesheets.computed เป็นสแนปช็อต
  // ตอนคำนวณครั้งล่าสุด ไม่ใช่ทุกใบจะถูกคำนวณใหม่หลัง schema เปลี่ยน) — ต้อง optional ทุกฟิลด์ที่เพิ่มทีหลัง
  leaveDays?: Array<{ date: string; type: string }>;
  divisor?: { mode: string; value: number; applied: number };
  dailyRate: number;
  discount: number;
  otDays?: Array<{ date: string; hours: number; otAmount: number; dayAmount: number }>;
  otTotal?: number;
  lineAmount: number;
  remarkLines: string[];
  checks: Array<{ id: string; severity: 'pass' | 'warn' | 'fail'; title: string; detail: string }>;
  calendar: { days: CalendarDay[]; counts: { workday: number; weekend: number; holiday: number; leave: number } };
}

interface TimesheetDetail {
  id: string;
  period: string;
  periodLabel: string;
  receivedAt: string;
  sourceFile: string | null;
  status: string;
  statusLabel: string;
  employee: { nameTh: string | null; invoicePosition: string | null; monthlyRate: number | null; quotationNo: string | null };
  rawEmployeeName: string | null;
  rawPosition: string | null;
  reportedWorkDays: number | null;
  reportedLeave: number | null;
  contract: { id: string; poNo: string; contractNo: string | null; projectName: string; customerName: string };
  invoiceNo: string | null;
  check: { checked: boolean; stale: boolean; at: string | null; by: string | null };
  approvedAt: string | null;
  approvedByLabel: string | null;
  sourceEmailId: string | null;
  sourceEmailSubject: string | null;
  extraction: any;
  manday: Manday | null;
  leaveDays: Array<{ date: string; leaveType: string }>;
  dayLabels: Array<{
    date: string;
    dayOfWeek: string | null;
    project: string | null;
    label: string | null;
    type: string | null;
    timeIn: string | null;
    timeOut: string | null;
    otTimeIn: string | null;
    otTimeOut: string | null;
    jobDesc: string | null;
    remark: string | null;
    normalHours: number | null;
    otHours: number | null;
    totalHours: number | null;
  }>;
  contractDetail: {
    taxId: string;
    billingPlace: string | null;
    contactName: string | null;
    divisorMode: string;
    divisorValue: number;
    startDate: string;
    endDate: string;
    creditDays: number;
    vatRate: number;
    whtRate: number;
  };
  audit: Array<{ at: string; actor: string; action: string; detail: any }>;
}

function money(n: number | null | undefined) {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function int(n: number | null | undefined) {
  return n === null || n === undefined ? '—' : Math.round(n).toLocaleString('en-US');
}
function dateOnly(iso: string | null | undefined) {
  return iso ? iso.slice(0, 10) : '—';
}
function dt(iso: string | null | undefined) {
  return iso ? iso.slice(0, 19).replace('T', ' ') : '—';
}
function hoursCell(v: number | null | undefined) {
  return v === null || v === undefined ? '—' : Number(v).toFixed(2);
}
function sumHours(days: TimesheetDetail['dayLabels'], key: 'normalHours' | 'otHours' | 'totalHours') {
  const values = days.map((d) => d[key]).filter((v): v is number => v !== null && v !== undefined);
  return values.length ? values.reduce((s, v) => s + Number(v), 0) : null;
}
function auditActionLabel(action: string) {
  return action.replace(/_/g, ' ');
}

const DOW = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
const LEAVE_ICON: Record<string, string> = { sick: 'sickface', personal: 'idcard', vacation: 'plane', unpaid: 'cal' };
const DAY_TYPE_LABEL: Record<string, string> = {
  work: 'ทำงาน', weekend: 'วันหยุด', holiday: 'วันหยุดนักขัตฤกษ์',
  sick: 'ลาป่วย', personal: 'ลากิจ', vacation: 'ลาพักร้อน', unpaid: 'ลาไม่รับค่าจ้าง',
};

/** โทนสี+ป้ายของ "ประเภท" ในตารางรายละเอียดรายวัน — เดาโทนจากคำในข้อความ ไม่ยึดว่าต้องเป็นค่าคงที่ตายตัว
 * เพราะ ABBYY แต่ละ Skill ใช้คำไม่เหมือนกัน */
function dayTypeInfo(type: string | null | undefined): { tone: string; label: string } {
  const t = String(type ?? '').toLowerCase();
  if (/holiday|หยุด/.test(t)) return { tone: 'dt-holiday', label: DAY_TYPE_LABEL.holiday };
  if (/weekend|เสาร์|อาทิตย์/.test(t)) return { tone: 'dt-weekend', label: DAY_TYPE_LABEL.weekend };
  if (/leave|ลา|sick|vacation|personal|annual|absent/.test(t)) return { tone: 'wn', label: type ?? '—' };
  if (/work|ทำงาน/.test(t)) return { tone: 'dt-work', label: DAY_TYPE_LABEL.work };
  return { tone: 'mu', label: type ?? '—' };
}

function dedupeRepeatedText(text: string | null | undefined): string {
  const s = String(text ?? '').trim();
  if (!s) return text ?? '';
  const words = s.split(/\s+/);
  if (words.length < 2 || words.length % 2 !== 0) return s;
  const half = words.length / 2;
  const first = words.slice(0, half).join(' ');
  const second = words.slice(half).join(' ');
  return first.toLowerCase() === second.toLowerCase() ? first : s;
}

export default function ManadyDetailPage() {
  const { tx } = useLang();
  const openPdfPreview = usePdfPreview();
  const params = useParams<{ id: string }>();
  const [sheet, setSheet] = useState<TimesheetDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [recomputing, setRecomputing] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const readModelNames = useReadModelNameMap();
  const [tab, setTab] = useState<1 | 2 | 3>(1);
  const [calDay, setCalDay] = useState<string | null>(null);

  async function load() {
    const res = await fetch(`/api/timesheets/${params.id}`, { cache: 'no-store' });
    if (res.ok) setSheet(await res.json());
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  /**
   * ⚠️ เดิมทิ้งผลลัพธ์ของ fetch ทั้งก้อน (ไม่เช็ค `res.ok`) — ปุ่มจึงขึ้น "กำลังคำนวณ…" แล้วจบเงียบๆ
   * เหมือนสำเร็จทุกครั้ง **ต่อให้เส้นนั้นไม่มีอยู่จริง** ซึ่งเป็นสถานะจริงตอนนี้: ไล่ดูแล้วไม่มีทั้ง
   * proxy ฝั่ง Next (`/api/timesheets/[id]/recompute`) และ route ฝั่ง Express — มีแต่ฟังก์ชัน
   * `recomputeTimesheet()` ใน timesheetsService.ts ที่ไม่มีใครเปิดเส้นให้เรียก (ยืนยันด้วย curl:
   * เส้นนี้ได้ 404 จาก Next ส่วนเส้นที่มีจริงอย่าง /check ได้ 401) จนกว่าฝั่ง backend จะเปิดเส้นให้
   * ปุ่มนี้จะแจ้ง error ตรงๆ แทนที่จะแกล้งทำเป็นสำเร็จ
   */
  async function doRecompute() {
    setRecomputing(true);
    setError(null);
    try {
      const res = await fetch(`/api/timesheets/${params.id}/recompute`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? tx('คำนวณใหม่ไม่สำเร็จ — ระบบยังไม่เปิดเส้นทางนี้ให้ใช้งาน'));
        return;
      }
      await load();
    } catch {
      setError(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'));
    } finally {
      setRecomputing(false);
    }
  }

  async function doCheck() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/timesheets/${params.id}/check`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? tx('ยืนยันไม่สำเร็จ'));
        return;
      }
      setSheet(data);
    } finally {
      setBusy(false);
    }
  }

  async function doReject() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/timesheets/${params.id}/reject`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: reason || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? tx('ตีกลับไม่สำเร็จ'));
        return;
      }
      setSheet(data);
      setRejecting(false);
    } finally {
      setBusy(false);
    }
  }

  const m = sheet?.manday ?? null;
  // `sourceFile` ของรายการที่ป้อนด้วยมือเป็นข้อความปลอมของฝั่งเซิร์ฟเวอร์ ("ป้อนด้วยมือ · 2026-08")
  // ไม่ใช่ชื่อไฟล์จริง — เดิมโค้ดเช็คแค่ว่า sourceFile มีค่าไหมแล้วทำเป็นปุ่มเปิด/ดาวน์โหลด PDF ให้
  // กดแล้วไปเจอ `{"error":"ไม่พบไฟล์ต้นฉบับ"}` ดิบๆ เพราะไม่มีไฟล์จริงเก็บไว้เลย (บั๊กที่เจอจริง
  // 18 ก.ย. 69 กับ OBS202675) เช็ค engine จาก extraction.model แทนการเดาจากรูปข้อความ
  const isManualEntry = parseReadModel(sheet?.extraction?.model)?.engine === 'manual';
  const failures = (m?.checks ?? []).filter((c) => c.severity === 'fail');
  const step = !sheet ? 1 : sheet.status === 'billed' ? 4 : failures.length || !sheet.check?.checked ? 2 : 3;

  const leaveTypeByDate = useMemo(() => new Map((m?.leaveDays ?? []).map((l) => [l.date, l.type])), [m]);
  const holidayLabelByDate = useMemo(
    () => new Map((m?.calendar?.days ?? []).filter((d) => d.kind === 'holiday').map((d) => [d.date, d.label])),
    [m],
  );
  const leaveCounts = useMemo(() => {
    const counts: Record<string, number> = { sick: 0, personal: 0, vacation: 0, unpaid: 0 };
    for (const l of m?.leaveDays ?? []) counts[l.type] = (counts[l.type] ?? 0) + 1;
    return counts;
  }, [m]);
  const dayCounts = m?.calendar?.counts ?? { workday: 0, leave: 0, holiday: 0, weekend: 0 };

  if (!sheet) {
    return <PageHeader eyebrow={tx('ตรวจ Manday')} title={tx('กำลังโหลด…')} />;
  }

  return (
    <>
      <Link href="/manday" className="back">
        <Icon name="cl" /> {tx('กลับไปกล่องงาน')}
      </Link>

      <div className="phd">
        <div>
          <span className="ey">
            Timesheet {sheet.id} · {tx('รอบบิล')} {sheet.periodLabel}
          </span>
          <h1>
            {sheet.employee.nameTh ?? sheet.rawEmployeeName ?? tx('ไม่ทราบชื่อ')} — {sheet.employee.invoicePosition ?? sheet.rawPosition ?? ''}
          </h1>
          <p>
            {sheet.contract.customerName} · {tx('โครงการ')} {sheet.contract.projectName} · <PoTag>{sheet.contract.poNo}</PoTag> · {tx('สัญญา')} {sheet.contract.contractNo ?? '—'}
            {sheet.extraction?.model && (
              <>
                {' '}
                <ReadModelTag model={sheet.extraction.model} sourceEmailId={sheet.sourceEmailId} nameMap={readModelNames} />
              </>
            )}
          </p>
        </div>
        <div className="acts">
          <button className="btn" disabled={recomputing} onClick={doRecompute}>
            <Icon name="rf" /> {recomputing ? tx('กำลังคำนวณ…') : tx('คำนวณใหม่')}
          </button>
        </div>
      </div>

      <div className="prog">
        <div className="pstep dn">
          <span className="cir">
            <Icon name="chk" />
          </span>
          <span className="cap">Step 01</span>
          <span className="pl">{tx('อัปโหลด · ระบบอ่านไฟล์')}</span>
        </div>
        <div className="pline dn" />
        <div className={`pstep ${step >= 3 ? 'dn' : 'cu'}`}>
          <span className="cir">
            <Icon name={step >= 3 ? 'chk' : 'list-chk'} />
          </span>
          <span className="cap">Step 02</span>
          <span className="pl">{tx('ตรวจ Manday · คนยืนยัน')}</span>
        </div>
        <div className={`pline ${step >= 3 ? 'dn' : ''}`} />
        <div className={`pstep ${step === 3 ? 'cu' : step > 3 ? 'dn' : ''}`}>
          <span className="cir">
            <Icon name={step > 3 ? 'chk' : 'money'} />
          </span>
          <span className="cap">Step 03</span>
          <span className="pl">{tx('วางบิล FlowAccount')}</span>
        </div>
        <div className={`pline ${step > 3 ? 'dn' : ''}`} />
        <div className={`pstep ${step === 4 ? 'cu' : ''}`}>
          <span className="cir">
            <Icon name="mail" />
          </span>
          <span className="cap">Step 04</span>
          <span className="pl">{tx('ร่างอีเมลถึงลูกค้า')}</span>
        </div>
      </div>

      <div className="tabs" role="tablist">
        {(['ภาพรวม', 'รายละเอียด', 'ปฏิทิน'] as const).map((label, i) => (
          <button key={label} className={`tab ${tab === i + 1 ? 'on' : ''}`} onClick={() => setTab((i + 1) as 1 | 2 | 3)}>
            {tx(label)}
          </button>
        ))}
      </div>

      {error && (
        <div className="card">
          <div className="bd" style={{ color: 'var(--cr)' }}>
            {error}
          </div>
        </div>
      )}

      {/* ภาพรวม */}
      {tab === 1 && (
        <div className="g3">
          <div>
            <div className="card">
              <div className="hd">
                <h3>{tx('สรุปรายการที่จะวางบิล')}</h3>
              </div>
              <div className="bd flush">
                <table className="ldg">
                  <tbody>
                    <tr>
                      <td>{tx('เรทค่าบริการต่อเดือนตามใบว่าจ้าง')}</td>
                      <td className="r">{money(m?.monthlyRate)}</td>
                    </tr>
                    <tr>
                      <td>
                        {tx('วันทำงานของเดือน')}<span className="sub">{tx('หักเสาร์–อาทิตย์ และวันหยุดแล้ว')}</span>
                      </td>
                      <td className="r">{int(m?.standardWorkingDays)} {tx('วัน')}</td>
                    </tr>
                    <tr>
                      <td>{tx('ทำงานจริงตาม Timesheet')}</td>
                      <td className="r">{int(sheet.reportedWorkDays)} {tx('วัน')}</td>
                    </tr>
                    <tr>
                      <td>{tx('วันลา')}</td>
                      <td className="r">{int(m?.leaveCount)} {tx('วัน')}</td>
                    </tr>
                    <tr>
                      <td>
                        {tx('อัตราต่อวัน')}<span className="sub">{money(m?.monthlyRate)} ÷ {int(m?.divisor?.applied)}</span>
                      </td>
                      <td className="r">{money(m?.dailyRate)}</td>
                    </tr>
                    <tr className="res">
                      <td>{tx('ส่วนลดวันลา')}</td>
                      <td className="r">−{money(m?.discount)}</td>
                    </tr>
                    {m && (m.otTotal ?? 0) > 0 && (
                      <tr className="res">
                        <td>
                          {tx('ค่าล่วงเวลา (OT)')}<span className="sub">{m.otDays?.length ?? 0} {tx('วัน')}</span>
                        </td>
                        <td className="r" style={{ color: 'var(--ok)' }}>
                          +{money(m.otTotal)}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="bd">
                <div className="tot">
                  <div className="t py">
                    <span>{tx('ยอดของรายการนี้')}</span>
                    <span className="v">{money(m?.lineAmount)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div>
            <div className="card">
              <div className="hd">
                <h3>{tx('ข้อมูลอ้างอิง')}</h3>
              </div>
              <div className="bd">
                <dl className="kv">
                  <dt>{tx('ลูกค้า')}</dt>
                  <dd>{sheet.contract.customerName}</dd>
                  <dt>{tx('เลขผู้เสียภาษี')}</dt>
                  <dd className="n">{sheet.contractDetail.taxId ?? '—'}</dd>
                  <dt>{tx('อ่านด้วย')}</dt>
                  <dd>{sheet.extraction?.model ? <ReadModelTag model={sheet.extraction.model} sourceEmailId={sheet.sourceEmailId} nameMap={readModelNames} /> : '—'}</dd>
                  <dt>{tx('ใบว่าจ้าง')}</dt>
                  <dd className="n"><PoTag>{sheet.contract.poNo}</PoTag></dd>
                  <dt>{tx('สัญญา')}</dt>
                  <dd className="n">{sheet.contract.contractNo ?? '—'}</dd>
                  <dt>{tx('ใบเสนอราคา')}</dt>
                  <dd className="n">{sheet.employee.quotationNo ?? '—'}</dd>
                  <dt>{tx('ช่วงสัญญา')}</dt>
                  <dd>
                    {dateOnly(sheet.contractDetail.startDate)} – {dateOnly(sheet.contractDetail.endDate)}
                  </dd>
                  <dt>{tx('เครดิต')}</dt>
                  <dd>{int(sheet.contractDetail.creditDays)} {tx('วัน')}</dd>
                  <dt>{tx('ตัวหารอัตราต่อวัน')}</dt>
                  <dd>{sheet.contractDetail.divisorMode === 'fixed' ? `${tx('คงที่')} ${int(sheet.contractDetail.divisorValue)}` : tx('วันทำงานจริงของเดือน')}</dd>
                  <dt>{tx('หัก ณ ที่จ่าย')}</dt>
                  <dd>
                    <WhtRateInline contractId={sheet.contract.id} whtRate={sheet.contractDetail.whtRate} onSaved={load} />
                  </dd>
                  <dt>{tx('ผู้ประสานงาน')}</dt>
                  <dd>{sheet.contractDetail.contactName ?? '—'}</dd>
                </dl>
              </div>
            </div>

            <div className="card">
              <div className="hd">
                <h3>{tx('ประวัติการดำเนินการ')}</h3>
              </div>
              <div className="bd">
                <ul className="acts-l">
                  {/* รวมทุกเหตุการณ์ (รับเข้าระบบ/ลูกค้าอนุมัติ/audit log) เป็นรายการเดียวแล้วเรียงตาม
                      เวลาจริงจากล่าสุดไปเก่าสุด (เจ้าของระบบสั่ง 24 ก.ย. 69) — เดิมตรึง "รับเข้าระบบ"/
                      "ลูกค้าอนุมัติ" ไว้บนสุดตายตัวสองรายการก่อนเสมอ ไม่ได้เทียบเวลาจริงกับ audit log
                      ที่ตามมาทีหลังเลย ทำให้เหตุการณ์ล่าสุดจริงๆ (เช่น ยืนยัน/ตีกลับ) ไปโผล่ท้ายสุดแทน */}
                  {[
                    { at: sheet.receivedAt, label: tx('รับเข้าระบบ'), detail: sheet.sourceFile ?? sheet.sourceEmailId ?? '—' },
                    ...(sheet.approvedAt
                      ? [{ at: sheet.approvedAt, label: tx('ลูกค้าอนุมัติ Timesheet'), detail: sheet.approvedByLabel ?? '—' }]
                      : []),
                    ...sheet.audit.map((a) => ({ at: a.at, label: auditActionLabel(a.action), detail: a.actor })),
                  ]
                    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
                    .map((ev, i) => (
                      <li key={i}>
                        <span className="tx">
                          {ev.label}
                          <small>{ev.detail}</small>
                        </span>
                        <span className="tm">{dt(ev.at)}</span>
                      </li>
                    ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* รายละเอียด */}
      {tab === 2 && (
        <>
          <div className="card">
            <div className="hd">
              <h3>{tx('ที่มาของข้อมูล')}</h3>
            </div>
            <div className="bd">
              <dl className="kv" style={{ marginBottom: 16 }}>
                <dt>{tx('ไฟล์ที่อัปโหลด')}</dt>
                <dd>{sheet.sourceFile ?? '—'}</dd>
                <dt>{tx('อ้างอิงอีเมล')}</dt>
                <dd>{sheet.sourceEmailSubject ?? sheet.sourceEmailId ?? tx('ไม่ได้ระบุ')}</dd>
                <dt>{tx('ชื่อที่เขียนในไฟล์')}</dt>
                <dd>{sheet.rawEmployeeName ?? '—'}</dd>
                <dt>{tx('ตำแหน่งที่เขียนในไฟล์')}</dt>
                <dd>{sheet.rawPosition ?? '—'}</dd>
                <dt>Total Work days</dt>
                <dd className="n">{int(sheet.reportedWorkDays)}</dd>
                <dt>Leave / Sick (days)</dt>
                <dd className="n">{int(sheet.reportedLeave)}</dd>
              </dl>
              <div className="attrow" style={{ marginTop: 12 }}>
                {sheet.sourceFile && !isManualEntry ? (
                  <>
                    <button
                      type="button"
                      className="file"
                      onClick={() => openPdfPreview(`/api/timesheets/${sheet.id}/file`, sheet.sourceFile)}
                      title={tx('เปิดดูไฟล์ต้นฉบับ')}
                    >
                      <span className="pd">PDF</span> {sheet.sourceFile}
                    </button>
                    <a className="btn sm icon" href={`/api/timesheets/${sheet.id}/file?dl`} title={tx('ดาวน์โหลดไฟล์ต้นฉบับ')}>
                      <Icon name="download" />
                    </a>
                  </>
                ) : (
                  <span className="file">
                    <span className="pd">PDF</span>{' '}
                    {isManualEntry ? tx('ป้อนข้อมูลด้วยมือ — ไม่มีไฟล์ต้นฉบับ') : tx('ไม่มีไฟล์ต้นฉบับเก็บไว้')}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="hd">
              <h3>{tx('รายละเอียด')}</h3>
            </div>
            <div className="bd flush">
              <div className="tw">
                <table className="ldg" style={{ minWidth: 1080 }}>
                  <thead>
                    <tr>
                      <th>{tx('วันที่')}</th>
                      <th>{tx('วันในสัปดาห์')}</th>
                      <th>{tx('โครงการ')}</th>
                      <th>{tx('เวลาเข้า–ออก')}</th>
                      <th>{tx('เวลา OT')}</th>
                      <th>{tx('ประเภท')}</th>
                      <th>{tx('รายละเอียดงาน')}</th>
                      <th className="r">{tx('ชม.ปกติ')}</th>
                      <th className="r">{tx('ชม. OT')}</th>
                      <th className="r">{tx('รวม/วัน')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sheet.dayLabels.length ? (
                      sheet.dayLabels.map((d) => {
                        const leaveType = leaveTypeByDate.get(d.date);
                        const info = leaveType ? { tone: `lv-${leaveType}`, label: DAY_TYPE_LABEL[leaveType] ?? leaveType } : dayTypeInfo(d.type);
                        return (
                          <tr key={d.date}>
                            <td className="n">{d.date}</td>
                            <td className="n">{d.dayOfWeek ?? '—'}</td>
                            <td>{d.project ?? '—'}</td>
                            <td className="n">{d.timeIn && d.timeOut ? `${d.timeIn} – ${d.timeOut}` : '—'}</td>
                            <td className="n">{d.otTimeIn && d.otTimeOut ? `${d.otTimeIn} – ${d.otTimeOut}` : '—'}</td>
                            <td>
                              <span className={`tg ${info.tone}`}>{tx(info.label)}</span>
                            </td>
                            <td style={{ whiteSpace: 'pre-line' }}>{holidayLabelByDate.get(d.date) ?? dedupeRepeatedText(d.jobDesc ?? d.remark ?? '—')}</td>
                            <td className="r n">{hoursCell(d.normalHours)}</td>
                            <td className="r n">{hoursCell(d.otHours)}</td>
                            <td className="r n" style={{ fontWeight: 600 }}>
                              {hoursCell(d.totalHours)}
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={10} className="empty">
                          {tx('ไม่มีข้อมูล')}
                        </td>
                      </tr>
                    )}
                  </tbody>
                  {sheet.dayLabels.length > 0 && (
                    <tfoot>
                      <tr>
                        <td colSpan={7} style={{ fontWeight: 600 }}>
                          {tx('รวมทั้งเดือน')}
                        </td>
                        <td className="r n" style={{ fontWeight: 600 }}>
                          {hoursCell(sumHours(sheet.dayLabels, 'normalHours'))}
                        </td>
                        <td className="r n" style={{ fontWeight: 600 }}>
                          {hoursCell(sumHours(sheet.dayLabels, 'otHours'))}
                        </td>
                        <td className="r n" style={{ fontWeight: 600 }}>
                          {hoursCell(sumHours(sheet.dayLabels, 'totalHours'))}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          </div>

          {m && (m.otDays?.length ?? 0) > 0 && (
            <div className="card">
              <div className="hd">
                <h3>{tx('ค่าล่วงเวลา (OT)')}</h3>
                <span className="rt">{tx('ตรวจจับอัตโนมัติจาก Timesheet — ตรวจสอบชั่วโมงกับ PDF ต้นฉบับก่อนยืนยัน')}</span>
              </div>
              <div className="bd flush">
                <div className="tw">
                  <table style={{ minWidth: 0 }}>
                    <thead>
                      <tr>
                        <th>{tx('วันที่')}</th>
                        <th className="r">{tx('ชั่วโมง OT')}</th>
                        <th className="r">{tx('ค่าจ้างวันนั้น (รวม OT)')}</th>
                        <th className="r">{tx('ค่า OT เพิ่ม')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(m.otDays ?? []).map((o) => (
                        <tr key={o.date}>
                          <td className="n">{dateOnly(o.date)}</td>
                          <td className="r n">{o.hours}</td>
                          <td className="r n">{money(o.dayAmount)}</td>
                          <td className="r n" style={{ color: 'var(--ok)' }}>
                            +{money(o.otAmount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="bd">
                <div className="tot">
                  <div className="t py">
                    <span>{tx('รวมค่า OT ทั้งหมด')}</span>
                    <span className="v">+{money(m.otTotal)}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {sheet.extraction && (
            <div className="card">
              <div className="hd">
                <h3>{tx('ผลการอ่านไฟล์ดิบ')}</h3>
              </div>
              <div className="bd">
                <pre className="code">{JSON.stringify(sheet.extraction, null, 2)}</pre>
              </div>
            </div>
          )}
        </>
      )}

      {/* ปฏิทิน */}
      {tab === 3 && (
        <div className="g3 cal-grid">
          <div>
            <div className="card">
              <div className="hd">
                <h3>{tx('ปฏิทิน')} {sheet.periodLabel}</h3>
              </div>
              <div className="bd">
                <CalendarView manday={m} calDay={calDay} onSelect={setCalDay} />
              </div>
            </div>

            <div className="card">
              <div className="hd">
                <h3>{tx('หมายเหตุที่จะขึ้นบนใบแจ้งหนี้')}</h3>
              </div>
              <div className="bd">
                {m?.remarkLines?.length ? <div className="rmk">{m.remarkLines.join('\n')}</div> : <div className="empty">{tx('ไม่มีวันลา จึงไม่มีหมายเหตุ')}</div>}
              </div>
            </div>
          </div>

          <div>
            <div className="card">
              <div className="hd">
                <h3>{tx('สรุปประจำเดือน')}</h3>
              </div>
              <div className="bd">
                <div className="stat-tiles cal-summary">
                  <div className="stat-tile ok">
                    <span className="sti">
                      <Icon name="monitor" className="lg" />
                    </span>
                    <span className="stx">
                      <span className="stv">{int(dayCounts.workday)}</span>
                      <span className="stl">{tx('ทำงาน (วัน)')}</span>
                    </span>
                  </div>
                  <div className="stat-tile cr">
                    <span className="sti">
                      <Icon name="sickface" className="lg" />
                    </span>
                    <span className="stx">
                      <span className="stv">{int(leaveCounts.sick)}</span>
                      <span className="stl">{tx('ลาป่วย (วัน)')}</span>
                    </span>
                  </div>
                  <div className="stat-tile pr">
                    <span className="sti">
                      <Icon name="idcard" className="lg" />
                    </span>
                    <span className="stx">
                      <span className="stv">{int(leaveCounts.personal)}</span>
                      <span className="stl">{tx('ลากิจ (วัน)')}</span>
                    </span>
                  </div>
                  <div className="stat-tile wn">
                    <span className="sti">
                      <Icon name="plane" className="lg" />
                    </span>
                    <span className="stx">
                      <span className="stv">{int(leaveCounts.vacation)}</span>
                      <span className="stl">{tx('ลาพักร้อน (วัน)')}</span>
                    </span>
                  </div>
                  <div className="stat-tile mu">
                    <span className="sti">
                      <Icon name="cal" className="lg" />
                    </span>
                    <span className="stx">
                      <span className="stv">{int(dayCounts.weekend)}</span>
                      <span className="stl">{tx('เสาร์–อาทิตย์ (วัน)')}</span>
                    </span>
                  </div>
                  <div className="stat-tile pk">
                    <span className="sti">
                      <Icon name="gift" className="lg" />
                    </span>
                    <span className="stx">
                      <span className="stv">{int(dayCounts.holiday)}</span>
                      <span className="stl">{tx('วันหยุด (วัน)')}</span>
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="hd">
                <h3>{tx('รายละเอียดวันที่เลือก')}</h3>
              </div>
              <div className="bd">
                <DayDetail date={calDay} sheet={sheet} manday={m} />
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="fbar">
        <span className="sx">
          {failures.length ? (
            <>
              <b>{tx('ยังยืนยันไม่ได้')}</b> — {failures.map((f) => f.title).join(' · ')}
            </>
          ) : sheet.status === 'billed' ? (
            <>
              <b>{tx('วางบิลแล้ว')}</b> — {sheet.invoiceNo ?? ''}
            </>
          ) : sheet.check?.checked ? (
            <>
              <b>{tx('ยืนยันแล้ว')}</b> — {sheet.check.by ?? ''} · {dt(sheet.check.at)}
            </>
          ) : sheet.check?.stale ? (
            <>
              <b>{tx('ยอดเปลี่ยนหลังยืนยันไปแล้ว')}</b> — {tx('อ่านตัวเลขชุดใหม่แล้วยืนยันอีกครั้ง')}
            </>
          ) : null}
        </span>
        <div className="gap" />
        {!rejecting ? (
          <button className="btn dgr" onClick={() => setRejecting(true)}>
            {tx('ตีกลับให้แก้ Timesheet')}
          </button>
        ) : (
          <>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="เหตุผลที่ตีกลับ (ไม่บังคับ)"
              style={{ flex: 1, height: 40, borderRadius: 'var(--r-ctl)', border: '1px solid var(--rule)', padding: '0 14px' }}
            />
            <button className="btn ghost" onClick={() => setRejecting(false)}>
              {tx('ยกเลิก')}
            </button>
            <button className="btn dgr" disabled={busy} onClick={doReject}>
              {tx('ยืนยันตีกลับ')}
            </button>
          </>
        )}
        {!rejecting &&
          (sheet.status === 'billed' || sheet.check?.checked ? (
            <Link href={`/billing/${sheet.contract.id}/${sheet.period}`} className="btn pri">
              <Icon name="send" /> {tx('ไปขั้น 3 วางบิล')}
            </Link>
          ) : (
            <button className="btn pri" disabled={busy || failures.length > 0} onClick={doCheck}>
              <Icon name="chk" /> {tx('ยืนยันว่าตรวจแล้ว')}
            </button>
          ))}
      </div>
    </>
  );
}

/** ปัดเป็นทศนิยม 2 ตำแหน่งไม่ให้เพี้ยนจาก floating point แต่ไม่บังคับโชว์ทศนิยมท้ายที่ไม่มีนัยสำคัญ —
 * ตัดมาจากตัวเดียวกับที่ใช้ในหน้าสัญญา (CustomersContractsTab.tsx's pctPrecise) */
function pctPrecise(rate: number) {
  return Math.round(rate * 10000) / 100;
}

/**
 * ไอคอนดินสอแก้อัตราหัก ณ ที่จ่ายในหน้าตรวจ/ยืนยัน Timesheet — คนละจุดกับใน CustomersContractsTab.tsx
 * (หน้าสัญญา) ตามที่เจ้าของระบบขอ 18 ก.ย. 69 แต่ยิงเข้า endpoint เดียวกัน (`PATCH /:id/wht-rate`)
 * เพราะเป็นค่าเดียวกันของสัญญาเดียวกัน แก้จากที่ไหนก็ต้องได้ผลเดียวกัน validation 0–30% อยู่ฝั่ง
 * server แล้ว (updateContractWhtRate) จึงเช็คซ้ำแค่ฝั่ง UI พอกันกดส่งค่าที่ผิดชัดๆ ไปเปล่าๆ
 */
function WhtRateInline({ contractId, whtRate, onSaved }: { contractId: string; whtRate: number; onSaved: () => void }) {
  const { tx } = useLang();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(pctPrecise(whtRate)));
  const [saving, setSaving] = useState(false);

  async function save() {
    const pct = Number(value);
    if (!Number.isFinite(pct) || pct < 0 || pct > 30) {
      toast(tx('อัตราหัก ณ ที่จ่ายต้องอยู่ระหว่าง 0–30%'), true);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/contracts/${encodeURIComponent(contractId)}/wht-rate`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ whtRate: pct / 100 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data?.error ?? tx('บันทึกไม่สำเร็จ'), true);
        return;
      }
      toast(tx('บันทึกอัตราหัก ณ ที่จ่ายแล้ว'));
      setEditing(false);
      onSaved();
    } catch {
      toast(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'), true);
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {pctPrecise(whtRate)}%
        <button
          type="button"
          className="btn sm icon"
          title={tx('แก้อัตราหัก ณ ที่จ่าย')}
          aria-label={tx('แก้ไข')}
          onClick={() => {
            setValue(String(pctPrecise(whtRate)));
            setEditing(true);
          }}
        >
          <Icon name="edit" />
        </button>
      </span>
    );
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <input
        type="number"
        min={0}
        max={30}
        step={0.01}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoFocus
        style={{ width: 64, height: 30, borderRadius: 'var(--r-ctl)', border: '1px solid var(--rule)', padding: '0 8px' }}
      />
      %
      <button type="button" className="btn sm icon" disabled={saving} title={tx('บันทึก')} onClick={save}>
        <Icon name="chk" />
      </button>
      <button type="button" className="btn sm icon" disabled={saving} title={tx('ยกเลิก')} onClick={() => setEditing(false)}>
        <Icon name="x" />
      </button>
    </span>
  );
}

function CalendarView({ manday, calDay, onSelect }: { manday: Manday | null; calDay: string | null; onSelect: (d: string | null) => void }) {
  const { tx } = useLang();
  // ⚠️ เช็ค days ว่าง ไม่ใช่แค่ว่ามี calendar — `buildMonth()` วนลูปจาก `daysInMonth()` ซึ่งคืน NaN
  // ถ้า period ของใบนั้น parse ไม่ออก ลูปจึงไม่ทำงานเลยและได้ days เป็น [] (ไม่ใช่เคสสมมติ: ตัวอ่าน
  // มีโน้ต "ABBYY ยังไม่ส่งรอบเดือนมา" / "เอกสารไม่มีช่องรอบเดือน" อยู่จริง) เดิม `days[0].dayOfWeek`
  // จะโยน TypeError ทำให้แท็บ "ปฏิทิน" จอขาวทั้งหน้า แทนที่จะบอกว่าคำนวณไม่ได้
  if (!manday?.calendar?.days?.length) return <div className="empty">{tx('ยังไม่ได้คำนวณ')}</div>;
  const { days } = manday.calendar;
  const firstCol = days[0].dayOfWeek;
  const leaveByDate = new Map((manday.leaveDays ?? []).map((l) => [l.date, l.type]));
  const trailing = (7 - ((firstCol + days.length) % 7)) % 7;

  return (
    <>
      <div className="cal">
        {DOW.map((d) => (
          <div key={d} className="dw">
            {tx(d)}
          </div>
        ))}
        {Array.from({ length: firstCol }, (_, i) => (
          <div key={`lead-${i}`} className="cl vd" />
        ))}
        {days.map((d) => {
          const sel = d.date === calDay ? ' sel' : '';
          if (d.kind === 'holiday') {
            return (
              <div key={d.date} className={`cl holiday${sel}`} onClick={() => onSelect(calDay === d.date ? null : d.date)}>
                <span className="dn">{d.day}</span>
                <span className="dbanner">
                  <Icon name="gift" className="xs" />
                  {d.label ?? tx(DAY_TYPE_LABEL.holiday)}
                </span>
              </div>
            );
          }
          if (d.kind === 'weekend') {
            return (
              <div key={d.date} className={`cl weekend${sel}`} onClick={() => onSelect(calDay === d.date ? null : d.date)}>
                <span className="dn">{d.day}</span>
              </div>
            );
          }
          if (d.kind === 'leave') {
            const leaveType = leaveByDate.get(d.date) ?? 'unpaid';
            return (
              <div key={d.date} className={`cl lv-${leaveType}${sel}`} onClick={() => onSelect(calDay === d.date ? null : d.date)}>
                <span className="dn">{d.day}</span>
                <span className={`dbadge lv-${leaveType}`} title={tx(DAY_TYPE_LABEL[leaveType] ?? leaveType)}>
                  <Icon name={LEAVE_ICON[leaveType] ?? 'cal'} className="sm" />
                </span>
              </div>
            );
          }
          return (
            <div key={d.date} className={`cl workday${sel}`} onClick={() => onSelect(calDay === d.date ? null : d.date)}>
              <span className="dn">{d.day}</span>
              <span className="dbadge workday" title={tx(DAY_TYPE_LABEL.work)}>
                <Icon name="monitor" className="sm" />
              </span>
            </div>
          );
        })}
        {Array.from({ length: trailing }, (_, i) => (
          <div key={`trail-${i}`} className="cl vd" />
        ))}
      </div>
      <div className="cal-legend">
        <span className="legend-item workday">
          <Icon name="monitor" className="lg" />
          {tx('ทำงาน')}
        </span>
        <span className="legend-item holiday">{tx('วันหยุด')}</span>
        <span className="legend-item sick">
          <Icon name="sickface" className="lg" />
          {tx('ลาป่วย')}
        </span>
        <span className="legend-item personal">
          <Icon name="idcard" className="lg" />
          {tx('ลากิจ')}
        </span>
        <span className="legend-item vacation">
          <Icon name="plane" className="lg" />
          {tx('ลาพักร้อน')}
        </span>
        <span className="cal-legend-mu">{tx('เสาร์–อาทิตย์ไม่มีป้าย')}</span>
      </div>
    </>
  );
}

function DayDetail({ date, sheet, manday }: { date: string | null; sheet: TimesheetDetail; manday: Manday | null }) {
  const { tx, lang } = useLang();
  if (!date) return <div className="empty">{tx('คลิกวันที่ในปฏิทินเพื่อดูรายละเอียดวันนั้น')}</div>;
  const d = sheet.dayLabels.find((r) => r.date === date);
  const calDayInfo = manday?.calendar?.days?.find((c) => c.date === date);
  const leaveType = new Map((manday?.leaveDays ?? []).map((l) => [l.date, l.type])).get(date);
  const fallbackType = calDayInfo?.kind === 'weekend' ? 'Weekend' : calDayInfo?.kind === 'holiday' ? 'Holiday' : calDayInfo?.kind === 'workday' ? 'Working' : '';
  const info = leaveType ? { tone: `lv-${leaveType}`, label: DAY_TYPE_LABEL[leaveType] ?? leaveType } : dayTypeInfo(d?.type ?? fallbackType);
  const note = calDayInfo?.kind === 'holiday' && calDayInfo?.label ? calDayInfo.label : d?.jobDesc || d?.remark ? dedupeRepeatedText(d.jobDesc ?? d.remark) : null;
  const dow = new Date(`${date}T00:00:00`).toLocaleDateString(lang === 'en' ? 'en-US' : 'th-TH', { weekday: 'long' });

  return (
    <div>
      <div className="ddhd">
        <span className="ddhd-l">
          <span className="ddate">{dateOnly(date)}</span>
          <span className="ddow">{dow}</span>
        </span>
        <span className={`tg ${info.tone}`}>{tx(info.label)}</span>
      </div>
      {d?.timeIn && d?.timeOut && (
        <div className="dd-times">
          <div className="dd-time-box">
            <span className="ic">
              <Icon name="signin" className="sm" />
            </span>
            <span className="lbl">{tx('เข้างาน')}</span>
            <span className="val">{d.timeIn}</span>
          </div>
          <div className="dd-time-box">
            <span className="ic">
              <Icon name="signout" className="sm" />
            </span>
            <span className="lbl">{tx('ออกงาน')}</span>
            <span className="val">{d.timeOut}</span>
          </div>
        </div>
      )}
      <dl className="kv">
        {d?.otTimeIn && d?.otTimeOut && (
          <>
            <dt>{tx('เวลา OT')}</dt>
            <dd className="n">
              {d.otTimeIn} – {d.otTimeOut}
            </dd>
          </>
        )}
        {d?.project && (
          <>
            <dt>{tx('โครงการ')}</dt>
            <dd>{d.project}</dd>
          </>
        )}
        {d?.totalHours !== null && d?.totalHours !== undefined && (
          <>
            <dt>{tx('รวม/วัน')}</dt>
            <dd className="n">{hoursCell(d.totalHours)}</dd>
          </>
        )}
      </dl>
      {note && <div className="rmk">{note}</div>}
    </div>
  );
}
