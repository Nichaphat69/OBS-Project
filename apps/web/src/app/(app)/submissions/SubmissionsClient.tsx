'use client';

import { useEffect, useRef, useState } from 'react';
import { Card, ErrorState, Loading, PageHeader, StatusPill, Tag, TabStrip } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import SupportTicketsPanel from './SupportTicketsPanel';
import { useLang } from '../../../lib/language';

/**
 * หน้ารวม "บันทึกการส่ง Timesheet ตามรอบบิล"
 *
 * คำถามที่หน้านี้ต้องตอบได้ในหน้าจอเดียว: รอบนี้ใครส่งแล้วหรือยัง · ส่งผ่านช่องทางไหน · เมื่อไหร่ ·
 * ตอนนี้อยู่ขั้นไหน · มีใครแจ้งปัญหาไหม
 *
 * ⚠️ คำที่ใช้เรียก "ช่องทางการส่ง" มีได้แค่สามคำตามที่เจ้าของระบบกำหนด และ **ห้ามมีคำว่า LINE อยู่ใน
 * คอลัมน์นั้น** — LINE คือช่องแจ้งเตือนที่ยิงไปให้พนักงานเลือกวิธี ไม่ใช่วิธีส่ง ด้วยเหตุผลเดียวกัน
 * "กดเลื่อนไว้ก่อน" ก็ไม่ใช่ช่องทาง แต่เป็นการตอบกลับ — คนกดเลื่อนยังไม่ได้เลือกช่องทางเลย จึงแสดง
 * ช่องทางเป็น "—" แล้วติดป้ายแยกว่าขอเลื่อนเมื่อไหร่ ไม่ปนกับตัวเลข "ยังไม่ส่ง" ในการ์ดสรุป
 *
 * แถวมาจากฝั่งเซิร์ฟเวอร์ครบทุกคนในรอบ (หนึ่งคน-หนึ่งรอบ = หนึ่งแถวเสมอ) รวมคนที่ยังไม่กดอะไรเลยด้วย —
 * หน้านี้ห้าม filter คนที่ไม่มีข้อมูลออกไปเอง เพราะคนที่ยังเงียบคือคนที่ต้องตามมากที่สุด
 *
 * ⚠️ หน้านี้เป็นหน้า "ดู" ล้วนๆ ไม่ใช่หน้าอนุมัติ/รีวิว (เจ้าของระบบยืนยันตรงๆ 18 ก.ย. 69) — admin/
 * accounting เปิดมาเพื่อรู้ว่าใครจะส่งทางไหน ไม่ได้มากดยืนยัน/ตีกลับจากหน้านี้ จึงไม่มีปุ่ม action
 * ใดๆ ในตาราง แม้แต่ในแท็บ "รอตรวจสอบ" — เส้น PATCH .../review ฝั่ง API ยังอยู่เผื่อมีที่ใช้ทีหลัง
 * แค่หน้านี้ไม่เรียกมันแล้ว
 */

type Status = 'not_submitted' | 'submitted' | 'pending_review' | 'confirmed' | 'problem';
type Method = 'self_obs' | 'self_email' | 'proxy_email';

const METHOD_LABEL: Record<Method, string> = {
  self_obs: 'ส่งผ่านระบบ OBS',
  self_email: 'ส่งผ่าน Email',
  proxy_email: 'ให้ผู้ดูแลเป็นคนส่ง',
};

const STATUS_LABEL: Record<Status, string> = {
  not_submitted: 'ยังไม่ส่ง',
  submitted: 'ส่งแล้ว',
  pending_review: 'รอตรวจสอบ',
  confirmed: 'ยืนยันแล้ว',
  problem: 'มีปัญหา',
};

const STATUS_TONE: Record<Status, 'ok' | 'wn' | 'cr' | 'mu'> = {
  not_submitted: 'mu',
  submitted: 'wn',
  pending_review: 'wn',
  confirmed: 'ok',
  problem: 'cr',
};

interface SubmissionRow {
  employeeId: string;
  employeeName: string;
  contractId: string;
  customerId: string;
  customerName: string;
  projectName: string;
  period: string;
  periodLabel: string;
  dueDate: string;
  status: Status;
  method: Method | null;
  methodChosenAt: string | null;
  deferredAt: string | null;
  actedBy: string | null;
  replyOk: boolean | null;
  replyFailureReason: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  note: string | null;
  timesheetId: string | null;
  canReceiveLineUpdates: boolean;
}

interface ListResult {
  scope: { restrictedToEmployeeId: string | null; mine: boolean };
  rows: SubmissionRow[];
  summary: Record<Status, number>;
  unknownDueToNoLineLink: number;
}

/* เหลือสองแท็บตามที่เจ้าของระบบสั่ง 18 ก.ย. 69 — "ภาพรวม" กับ "รายการส่ง" วาดตารางชุดเดียวกันเป๊ะ
   จึงเป็นแท็บซ้ำที่ไม่ได้ให้อะไรเพิ่ม ส่วน "รอตรวจสอบ" เป็นซากของตอนที่หน้านี้ยังมีปุ่มยืนยัน/ตีกลับ
   ซึ่งถูกถอดออกไปแล้ว (ดูหมายเหตุหัวไฟล์: หน้านี้เป็นหน้า "ดู" ล้วนๆ) — สถานะรอตรวจสอบยังกรองได้จาก
   ตัวกรอง "ทุกสถานะ" อยู่แล้ว ไม่ต้องมีแท็บของตัวเอง */
const TABS = [
  { key: 'list', label: 'รายการส่ง' },
  { key: 'tickets', label: 'แจ้งปัญหา' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

function dt(s: string | null) {
  return s ? s.replace('T', ' ').slice(0, 16) : '—';
}

function pct(n: number, total: number): string {
  if (total === 0) return '0%';
  return `${Math.round((n / total) * 100)}%`;
}

/**
 * ตัวกรองทั้งหมดรวมอยู่ในปุ่มเดียว กดแล้วกางแผงให้เลือกทีละหัวข้อ (เจ้าของระบบสั่ง 27 ก.ย. 69
 * "รวมทั้ง 4 ปุ่มให้อยู่ในปุ่มเดียวกันเลย พอคลิกเข้าไปแล้วก็ให้เลือก 4 หัวข้อย่อยอีกที")
 *
 * เดิมวางชิปเลือก 3 อันเรียงกันบนหัวการ์ด พอเพิ่มตัวกรองบริษัทเข้าไปเป็น 4 อันก็ยาวจนเบียดชื่อการ์ด
 * ปุ่มเดียวยังบอกจำนวนตัวกรองที่เปิดอยู่ด้วย จะได้รู้ว่ากำลังดูข้อมูลที่ถูกกรองอยู่ ไม่ใช่ทั้งหมด
 */
function FilterMenu({
  open, onToggle, onClose, activeCount, onClear, groups,
}: {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  activeCount: number;
  onClear: () => void;
  groups: Array<{
    label: string;
    value: string;
    onChange: (v: string) => void;
    allLabel: string;
    options: Array<{ value: string; label: string }>;
  }>;
}) {
  const { tx } = useLang();
  const box = useRef<HTMLDivElement>(null);

  // ปิดเมื่อคลิกนอกแผง — แผงลอยทับเนื้อหาอยู่ ถ้าไม่ปิดเองจะบังตารางที่เพิ่งกรองเสร็จ
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) onClose();
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open, onClose]);

  return (
    <div className="fmenu" ref={box}>
      <button type="button" className={`btn sm${activeCount ? ' pri' : ''}`} onClick={onToggle} aria-expanded={open}>
        <Icon name="cog" className="sm" /> {tx('ตัวกรอง')}
        {activeCount > 0 && <span className="fmenu-n">{activeCount}</span>}
      </button>
      {open && (
        <div className="fmenu-panel">
          {groups.map((g) => (
            <label key={g.label} className="fmenu-row">
              <span className="fmenu-lbl">{tx(g.label)}</span>
              <span className="selectchip grow">
                <select value={g.value} onChange={(e) => g.onChange(e.target.value)}>
                  <option value="">{tx(g.allLabel)}</option>
                  {g.options.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <Icon name="chev" />
              </span>
            </label>
          ))}
          <div className="fmenu-foot">
            <button type="button" className="btn sm" onClick={onClear} disabled={activeCount === 0}>
              {tx('ล้างตัวกรอง')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SubmissionsClient({ role }: { role: string }) {
  const { tx } = useLang();
  const isStaff = role === 'admin' || role === 'accounting';

  const [tab, setTab] = useState<TabKey>('list');
  const [period, setPeriod] = useState('');
  const [status, setStatus] = useState('');
  const [method, setMethod] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [data, setData] = useState<ListResult | null>(null);
  /* รอบบิลที่มีอยู่จริง เก็บไว้ตอนที่ยังไม่ได้กรองรอบ — พอกรองรอบแล้วผลลัพธ์จะเหลือรอบเดียว ถ้าสร้าง
     ตัวเลือกจากผลลัพธ์ที่กรองแล้วจะเหลือให้เลือกแค่รอบที่เลือกอยู่ กลับไปรอบอื่นไม่ได้อีกเลย */
  const [periodOptions, setPeriodOptions] = useState<Array<{ value: string; label: string }>>([]);
  /* บริษัทที่มีอยู่จริง — เก็บตอนยังไม่ได้กรองบริษัท ด้วยเหตุผลเดียวกับ periodOptions ข้างบน */
  const [companyOptions, setCompanyOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [error, setError] = useState<string | null>(null);

  // แท็บแจ้งปัญหายังเป็นของ admin เท่านั้นเหมือนเดิม — หน้านี้เปิดกว้างขึ้น แต่ไม่ได้แปลว่าฟังก์ชันเดิม
  // ต้องเปิดตามไปด้วย ตัวกันจริงอยู่ที่ /api/support-tickets ซึ่ง requireAdmin อยู่แล้ว
  const visibleTabs = TABS.filter((t) => (t.key === 'tickets' ? role === 'admin' : true));

  // พนักงานยิงเส้น /mine เสมอ — ไม่ใช่ /?employeeId=... เพราะการกันคนอื่นเห็นของตัวเองต้องอยู่ที่ว่า
  // ยิงเส้นไหน ไม่ใช่ที่พารามิเตอร์ ถ้าให้พนักงานยิงเส้นเดียวกับ admin แล้วหวังว่า query จะจำกัดถูก
  // มันจะกลายเป็นช่องโหว่ทันทีที่มีใครลืมเช็ค role ในโค้ดสักจุด
  function load() {
    setError(null);
    const qs = new URLSearchParams();
    if (period) qs.set('period', period);
    if (status) qs.set('status', status);
    if (method) qs.set('method', method);
    if (customerId) qs.set('customerId', customerId);
    const path = isStaff ? '/api/timesheet-submissions' : '/api/timesheet-submissions/mine';
    fetch(`${path}${qs.toString() ? `?${qs}` : ''}`, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          setError(body?.error ?? tx('โหลดข้อมูลไม่สำเร็จ'));
          return;
        }
        const body: ListResult = await r.json();
        setData(body);
        if (!period) {
          const seen = new Map<string, string>();
          for (const row of body.rows) seen.set(row.period, row.periodLabel);
          setPeriodOptions(
            [...seen]
              .sort((a, b) => b[0].localeCompare(a[0]))
              .map(([value, label]) => ({ value, label })),
          );
        }
        if (!customerId) {
          const seen = new Map<string, string>();
          for (const row of body.rows) seen.set(row.customerId, row.customerName);
          setCompanyOptions(
            [...seen]
              .filter(([value]) => value)
              .sort((a, b) => a[1].localeCompare(b[1], 'th'))
              .map(([value, label]) => ({ value, label })),
          );
        }
      })
      .catch(() => setError(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้')));
  }

  useEffect(load, [period, status, method, customerId, isStaff]);

  const rows = data?.rows ?? [];
  const submitted = data ? data.summary.submitted + data.summary.confirmed : 0;

  return (
    <>
      <PageHeader eyebrow={tx('อ้างอิง')} title={tx('บันทึกการส่ง')} />

      {data?.scope.mine && (
        <div className="scopebar">
          <Icon name="info" />
          <span>{tx('หน้านี้แสดงเฉพาะรายการส่งของคุณเอง')}</span>
        </div>
      )}

      {/* สรุปรอบนี้ — เดิมเป็นการ์ดขนาดเท่ากัน 5 ใบเรียงกัน ซึ่งบอกได้แค่ตัวเลขลอยๆ คนอ่านต้องเอา
          "ส่งแล้ว" ไปหารกับ "ทั้งหมด" เองถึงจะรู้คำตอบของคำถามเดียวที่หน้านี้มีอยู่ว่า "รอบนี้ครบหรือยัง"
          เปลี่ยนเป็นแถบความคืบหน้าอันเดียวที่ตอบตรงๆ แล้วแจกแจงส่วนที่เหลือเป็นชิปเล็กด้านล่าง
          (เจ้าของระบบสั่ง 18 ก.ย. 69: ให้ดูเข้าใจง่ายกว่านี้) */}
      {data && (
        <div className="subsum">
          <div className="ssh">
            {/* หน่วยนับต้องตรงกับสิ่งที่แถวหนึ่งแถวหมายถึงจริงๆ — เดิมเขียน "คน" ทั้งสองมุมมองซึ่งผิดทั้งคู่
                มุมพนักงาน: ทุกแถวเป็นของตัวเองคนเดียว ต่างกันแค่รอบเดือน → นับเป็น "รอบ"
                มุม admin/บัญชี: หนึ่งแถว = พนักงานหนึ่งคนต่อหนึ่งรอบ คนเดียวกันโผล่ได้หลายแถว จึงไม่ใช่
                จำนวนคนเช่นกัน → นับเป็น "รายการ" (เจ้าของระบบทักมา 18 ก.ย. 69) */}
            <span className="ssl">
              {data.scope.mine ? tx('รอบที่ส่ง Timesheet แล้ว') : tx('ส่ง Timesheet แล้ว')}
            </span>
            <span className="ssv">
              <b>{submitted}</b>
              <span className="of">
                / {rows.length} {data.scope.mine ? tx('รอบ') : tx('รายการ')}
              </span>
            </span>
            <span className="sspc">{pct(submitted, rows.length)}</span>
          </div>
          <div className="ssbar">
            <span className="fill" style={{ width: rows.length ? `${(submitted / rows.length) * 100}%` : '0%' }} />
          </div>
          <div className="sschips">
            <span className={`ssc mu${data.summary.not_submitted ? ' on' : ''}`}>
              {tx('ยังไม่ส่ง')} <b>{data.summary.not_submitted}</b>
            </span>
            <span className={`ssc wn${data.summary.pending_review ? ' on' : ''}`}>
              {tx('รอตรวจสอบ')} <b>{data.summary.pending_review}</b>
            </span>
            <span className={`ssc cr${data.summary.problem ? ' on' : ''}`}>
              {tx('มีปัญหา')} <b>{data.summary.problem}</b>
            </span>
          </div>
        </div>
      )}

      <TabStrip tabs={visibleTabs} active={tab} onChange={setTab} />

      {tab === 'tickets' ? (
        // ฟังก์ชันแจ้งปัญหาเดิมยกมาทั้งก้อน ไม่แตะตรรกะเลย — เจ้าของระบบสั่งว่าอย่าทิ้งของเดิม
        <SupportTicketsPanel />
      ) : (
        <Card
          title={tx(TABS.find((t) => t.key === tab)?.label ?? '')}
          right={
            <FilterMenu
              open={filtersOpen}
              onToggle={() => setFiltersOpen((v) => !v)}
              onClose={() => setFiltersOpen(false)}
              activeCount={[period, status, method, customerId].filter(Boolean).length}
              onClear={() => { setPeriod(''); setStatus(''); setMethod(''); setCustomerId(''); }}
              groups={[
                { label: 'บริษัท', value: customerId, onChange: setCustomerId, allLabel: 'ทุกบริษัท',
                  options: companyOptions },
                { label: 'รอบบิล', value: period, onChange: setPeriod, allLabel: 'ทุกรอบบิล',
                  options: periodOptions },
                { label: 'สถานะ', value: status, onChange: setStatus, allLabel: 'ทุกสถานะ',
                  options: (Object.keys(STATUS_LABEL) as Status[]).map((v) => ({ value: v, label: tx(STATUS_LABEL[v]) })) },
                { label: 'ช่องทาง', value: method, onChange: setMethod, allLabel: 'ทุกช่องทาง',
                  options: (Object.keys(METHOD_LABEL) as Method[]).map((v) => ({ value: v, label: tx(METHOD_LABEL[v]) })) },
              ]}
            />
          }
        >
          {error ? (
            <ErrorState message={error} onRetry={load} />
          ) : !data ? (
            <Loading rows={6} />
          ) : (
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th>{tx('ลำดับ')}</th>
                    <th>{tx('พนักงาน')}</th>
                    <th>{tx('รอบบิล')}</th>
                    <th>{tx('สถานะการส่ง')}</th>
                    <th>{tx('ช่องทางการส่ง')}</th>
                    {/* คอลัมน์ "สถานะการตรวจสอบ" กับ "ผู้ดำเนินการ" ถูกเอาออก 18 ก.ย. 69 — เป็นซากจาก
                        ตอนที่หน้านี้ยังมีปุ่มยืนยัน/ตีกลับ พอถอดปุ่มออกแล้วสองคอลัมน์นี้ขึ้น "ยังไม่มีคนตรวจ"
                        กับ "—" ทุกแถวตลอดไป กินที่โดยไม่บอกอะไรเลย */}
                    <th>{tx('วันและเวลาที่ส่ง')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={`${r.employeeId}|${r.period}`}>
                      <td className="sub">{i + 1}</td>
                      <td>
                        {r.employeeName}
                        <div className="sub">{r.customerName} · {r.projectName}</div>
                      </td>
                      <td>{r.periodLabel}</td>
                      <td>
                        <div className="status-cell">
                          <StatusPill tone={STATUS_TONE[r.status]}>{tx(STATUS_LABEL[r.status])}</StatusPill>
                          {r.deferredAt && (
                            <div className="sub">{tx('ขอเลื่อน')} · {dt(r.deferredAt)}</div>
                          )}
                          {/* ป้ายสั้น ไม่ใช่ประโยคอธิบาย — แต่ยังแยกจาก "ยังไม่ส่ง" เดิมอยู่ เพราะเป็นคนละความจริง:
                              อันนี้คือระบบไม่มีทางรู้ ไม่ใช่ยืนยันแล้วว่าเงียบจริง เอาป้ายออกจะทำให้สองเคสนี้
                              กลืนกันจนดูเหมือนยืนยันแล้วว่าไม่ส่งทั้งคู่ — เป็นบรรทัดหมายเหตุใต้ pill ไม่ใช่ pill
                              ที่สอง (pill เทาสองอันวางคู่กันอ่านเหมือนสถานะสองอัน, 24 ก.ย. 69) */}
                          {!r.canReceiveLineUpdates && r.status === 'not_submitted' && (
                            <span className="status-note">{tx('ยังไม่ผูก LINE OA')}</span>
                          )}
                        </div>
                      </td>
                      <td>
                        {r.method ? <Tag tone="mu">{tx(METHOD_LABEL[r.method])}</Tag> : <span className="sub">—</span>}
                        {r.replyOk === false && (
                          <div className="sub" style={{ color: 'var(--wn)' }}>{tx('พนักงานอาจไม่เห็นข้อความตอบกลับ')}</div>
                        )}
                      </td>
                      <td className="sub">{dt(r.methodChosenAt)}</td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', color: 'var(--mut)' }}>
                        {tx('ไม่มีรายการในหมวดนี้')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
