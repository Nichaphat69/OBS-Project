'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Card, Loading, PageHeader, StatusPill, Tag } from '../../../../../components/ui';
import { Icon } from '../../../../../components/Icon';
import { usePdfPreview, fileBadge } from '../../../../../components/Overlays';
import { useLang } from '../../../../../lib/language';
import { useContractRef } from '../../../../../lib/scope';

interface InvoiceItem {
  seq: number;
  name: string;
  employeeId: string;
  employeeName: string;
  quantity: number;
  unitName: string;
  pricePerUnit: number;
  discount: number;
  amount: number;
}

interface MandayCalc {
  standardWorkingDays: number;
  leaveCount: number;
  payableDays: number;
  monthlyRate: number;
  dailyRate: number;
  discount: number;
  lineAmount: number;
}

interface CycleEntry {
  timesheetId: string;
  employee: { id: string; nameTh: string; invoicePosition: string; quotationNo: string | null };
  manday: MandayCalc;
}

interface Attachment {
  label: string;
  invoiceId: string | null;
  timesheetId: string | null;
}

interface CyclePreview {
  contract: { id: string; poNo: string; projectName: string; customerName: string };
  period: string;
  periodLabel: string;
  cycle: { expected: number; received: number; missing: string[] };
  invoice: {
    documentDate: string;
    dueDate: string;
    creditDays: number;
    customer: { name: string; taxId: string; branch?: string | null };
    items: InvoiceItem[];
    totals: {
      total: number;
      discountTotal: number;
      totalAfterDiscount: number;
      vatRate: number;
      vat: number;
      grandTotal: number;
      whtRate: number;
      withholdingTax: number;
      paymentAmount: number;
    };
    remark: string;
    payload: unknown;
  } | null;
  entries: CycleEntry[];
  blockers: string[];
  warnings: Array<{ employee: string; title: string; detail: string }>;
  emailDraft: {
    to: string;
    cc: string;
    subject: string;
    body: string;
    highlights?: string[];
    source?: string;
    note?: string;
    attachments: Attachment[];
  } | null;
  existing: { id: string; documentNo: string | null; shareLink: string | null; status: string } | null;
}

interface PeriodEmployee {
  employeeId: string;
  nameTh: string;
  position: string;
  status: string;
  statusLabel: string;
}

function money(n: number | null | undefined) {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * ป้ายสถานะ Timesheet เฉพาะหน้ารายละเอียดรอบบิลนี้เท่านั้น — เจ้าของระบบชี้ 18 ก.ย. 69 ว่า "ตรวจผ่าน"
 * (มาจาก statusLabel ฝั่งเซิร์ฟเวอร์ ใช้คำเดียวกับหน้าตรวจ Manday) ไม่สื่อความในบริบทนี้ เพราะมาถึง
 * หน้านี้แล้วแปลว่าผ่านการตรวจมาแล้วเสมอ สิ่งที่ยังไม่รู้คือ "ออก INV หรือยัง" จึงเขียนทับเฉพาะสถานะ
 * 'verified' เป็น "รอออก INV" — สถานะอื่น (เช่น billed) ยังใช้คำจากเซิร์ฟเวอร์เหมือนเดิม
 */
function cycleStatusLabel(e: { status: string; statusLabel: string }): string {
  return e.status === 'verified' ? 'รอออก INV' : e.statusLabel;
}

function initials(name: string) {
  const parts = String(name ?? '').trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] ?? '') + (parts[1][0] ?? '');
  return (parts[0] ?? '?').slice(0, 2);
}

export default function CycleDetailPage() {
  const { tx, formatDate, formatPeriodLabel } = useLang();
  const refOf = useContractRef();
  const openPdfPreview = usePdfPreview();
  const params = useParams<{ contractId: string; period: string }>();
  const [data, setData] = useState<CyclePreview | null>(null);
  const [employees, setEmployees] = useState<PeriodEmployee[] | null>(null);
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [approveResult, setApproveResult] = useState<{ documentNo: string | null; shareLink: string | null; mode: string; note: string | null } | null>(
    null,
  );
  // สร้างร่างจริงในกล่อง Drafts ของ Gmail พร้อมไฟล์แนบ (25 ก.ย. 69 ตามที่ขอ) — ฝั่งเซิร์ฟเวอร์
  // (createGmailDraft) ทำไว้ครบและมีเทสต์คลุมอยู่แล้วตั้งแต่ก่อนย้ายมา Next.js แค่ไม่เคยมีปุ่มเรียกใช้
  // ในหน้าเว็บชุดใหม่เลย — ปุ่มนี้แค่เรียกเส้นที่มีอยู่แล้ว ไม่มีตรรกะแนบไฟล์/สร้าง MIME ใหม่ตรงนี้เลย
  const [creatingGmailDraft, setCreatingGmailDraft] = useState(false);
  const [gmailDraftError, setGmailDraftError] = useState<string | null>(null);
  const [gmailDraftResult, setGmailDraftResult] = useState<{ url: string; to: string; note?: string; attachmentCount: number } | null>(null);

  function load() {
    fetch(`/api/cycles/${params.contractId}/${params.period}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then(setData);
    fetch(`/api/cycles/${params.contractId}/${params.period}/employees`, { cache: 'no-store' })
      .then((r) => r.json())
      .then(setEmployees);
  }

  useEffect(load, [params.contractId, params.period]);

  /* payload ที่จะยิงเข้า FlowAccount เคยโชว์เป็นแท็บ JSON ดิบบนหน้านี้ — เอาออกจากหน้าจอทั้งหมด
     (เจ้าของระบบสั่ง 25 ก.ย. 69 "ไม่ต้องแสดงในระบบเลย เปลี่ยนเป็น console F12 ถึงจะดูได้") เป็นข้อมูล
     เชิงเทคนิคไว้ไล่ปัญหาฝั่งพัฒนา ไม่ใช่สิ่งที่คนทำบิลต้องเห็น ยังพิมพ์ลง console ไว้ให้เปิด DevTools
     ดูได้ตอนต้องเทียบชื่อฟิลด์กับ API docs */
  useEffect(() => {
    if (data?.invoice?.payload) console.log('[OBS] FlowAccount payload', data.invoice.payload);
  }, [data]);

  async function doApprove() {
    setApproving(true);
    setApproveError(null);
    try {
      const res = await fetch(`/api/cycles/${params.contractId}/${params.period}/approve`, { method: 'POST' });
      const result = await res.json();
      if (!res.ok) {
        setApproveError(result.blockers ? `${result.error}: ${result.blockers.join(' · ')}` : result.error ?? tx('อนุมัติไม่สำเร็จ'));
        return;
      }
      setApproveResult(result);
      load();
    } finally {
      setApproving(false);
    }
  }

  async function doCreateGmailDraft() {
    setCreatingGmailDraft(true);
    setGmailDraftError(null);
    try {
      const res = await fetch(`/api/cycles/${params.contractId}/${params.period}/gmail-draft`, { method: 'POST' });
      const result = await res.json();
      if (!res.ok) {
        setGmailDraftError(result.error ?? tx('สร้างร่างอีเมลใน Gmail ไม่สำเร็จ'));
        return;
      }
      setGmailDraftResult(result);
    } catch {
      setGmailDraftError(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'));
    } finally {
      setCreatingGmailDraft(false);
    }
  }

  if (!data) {
    return (
      <>
        <PageHeader eyebrow={tx('ออก INV & ร่างอีเมล')} title={tx('กำลังโหลด…')} />
        <Loading variant="cards" rows={3} />
        <div style={{ marginTop: 22 }}>
          <Card>
            <Loading rows={6} />
          </Card>
        </div>
      </>
    );
  }

  const billed = data.existing?.status === 'sent_to_flowaccount';
  const inv = data.invoice;

  return (
    <>
      <PageHeader
        eyebrow={`${refOf(data.contract).value} · ${formatPeriodLabel(data.periodLabel)}`}
        title={data.contract.customerName}
        subtitle={data.contract.projectName}
      />

      {approveError && (
        <div className="card">
          <div className="bd" style={{ color: 'var(--cr)' }}>
            {approveError}
          </div>
        </div>
      )}

      {approveResult && (
        <div className="card">
          <div className="bd" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <StatusPill tone="ok">{tx('สร้างเอกสารสำเร็จ')}</StatusPill>
            <div>
              {tx('เลขที่เอกสาร')}: <b>{approveResult.documentNo}</b> ({approveResult.mode})
            </div>
            {approveResult.shareLink && (
              <a href={approveResult.shareLink} target="_blank" rel="noreferrer" className="sub">
                {tx('ดูเอกสาร')} →
              </a>
            )}
            {approveResult.note && <div className="sub">{approveResult.note}</div>}
          </div>
        </div>
      )}

      {data.blockers.length > 0 && (
        <div className="card">
          <div className="bd" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {data.blockers.map((b, i) => (
              <div key={i} style={{ display: 'flex', gap: 10 }}>
                <StatusPill tone="cr">{tx('ติดปัญหา')}</StatusPill>
                <span className="sub" style={{ marginTop: 4 }}>
                  {b}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {employees && (
        <Card title={tx('พนักงานในสัญญา')} flush>
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th>{tx('พนักงาน')}</th>
                  <th>{tx('ตำแหน่ง')}</th>
                  <th>{tx('สถานะ Timesheet')}</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((e) => (
                  <tr key={e.employeeId}>
                    <td className="nm">{e.nameTh}</td>
                    <td>{e.position}</td>
                    <td>
                      <Tag tone={e.status === 'not_submitted' ? 'mu' : e.status === 'billed' ? 'ok' : 'wn'}>
                        {tx(cycleStatusLabel(e))}
                      </Tag>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {!inv ? (
        <div className="card">
          <div className="empty">{tx('ยังไม่มีรายการที่ออก INV ได้ในรอบนี้')}</div>
        </div>
      ) : (
        <>
          <div className="split2">
            {/* ซ้าย: รายการในรอบบิล — แยกตามพนักงาน + ร่างอีเมล INV */}
            <div>
              <Card title={tx('รายการในรอบบิล')} flush>
                <div className="cardgrid" style={{ gridTemplateColumns: '1fr' }}>
                  {data.entries.map((entry) => {
                    const m = entry.manday;
                    return (
                      <div className="rec" key={entry.timesheetId}>
                        <div className="rec-hd">
                          <span className="ava">{initials(entry.employee.nameTh)}</span>
                          <span>
                            <span className="nm2">{entry.employee.invoicePosition}</span>
                            <span className="mt2">
                              {entry.employee.nameTh} · {entry.employee.quotationNo ?? ''}
                            </span>
                          </span>
                          <span className="rt2">
                            <StatusPill tone={m.discount ? 'wn' : 'ok'}>
                              {m.payableDays} / {m.standardWorkingDays} {tx('วัน')}
                            </StatusPill>
                          </span>
                        </div>
                        <div className="minitab">
                          <div className="mh2">
                            <span>{tx('รายการคำนวณ')}</span>
                            <span className="q">{tx('จำนวน')}</span>
                            <span className="p">{tx('บาท')}</span>
                          </div>
                          <div className="mr">
                            <span className="lb2">{tx('เรทค่าบริการต่อเดือน')}</span>
                            <span className="q">
                              1 {tx('เดือน')}
                            </span>
                            <span className="p">{money(m.monthlyRate)}</span>
                          </div>
                          {m.leaveCount ? (
                            <div className="mr neg">
                              <span className="lb2">
                                {tx('ส่วนลดวันลา')}
                                <small>
                                  {money(m.dailyRate)} × {m.leaveCount} {tx('วัน')}
                                </small>
                              </span>
                              <span className="q">
                                {m.leaveCount} {tx('วัน')}
                              </span>
                              <span className="p">−{money(m.discount)}</span>
                            </div>
                          ) : (
                            <div className="mr">
                              <span className="lb2">
                                {tx('ส่วนลดวันลา')}
                                <small>{tx('ไม่มีวันลา')}</small>
                              </span>
                              <span className="q">0 {tx('วัน')}</span>
                              <span className="p">—</span>
                            </div>
                          )}
                        </div>
                        <div className="rec-total">
                          <span className="tl">{tx('ยอดของรายการนี้')}</span>
                          <span className="tv">{money(m.lineAmount)}</span>
                        </div>
                        <div className="rec-acts one">
                          <Link href={`/manday/${entry.timesheetId}`} className="btn">
                            <Icon name="file" className="sm" /> {tx('ดู Timesheet')}
                          </Link>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>

              <div className="tp on">
                {data.emailDraft && (
                  <Card title={tx('ร่างอีเมล INV')}>
                    <div className="mailacts">
                      <button className="btn sm pri" disabled={creatingGmailDraft} onClick={doCreateGmailDraft}>
                        <Icon name="mail" className="sm" /> {creatingGmailDraft ? tx('กำลังสร้างร่าง…') : tx('สร้างร่างใน Gmail')}
                      </button>
                    </div>
                    {gmailDraftError && <div style={{ color: 'var(--cr)', marginBottom: 10 }}>{gmailDraftError}</div>}
                    {gmailDraftResult && (
                      <div className="note ok" style={{ marginBottom: 14 }}>
                        <Icon name="chk" />
                        <span>
                          <strong>{tx('สร้างร่างในกล่อง Drafts แล้ว')}</strong>
                          <br />
                          {gmailDraftResult.note ?? `${tx('แนบไฟล์แล้ว')} ${gmailDraftResult.attachmentCount} ${tx('ไฟล์')}`}
                          <br />
                          <a className="btn sm pri notebtn" href={gmailDraftResult.url} target="_blank" rel="noreferrer">
                            <Icon name="mail" className="sm" /> {tx('เปิดร่างใน Gmail')}
                          </a>
                        </span>
                      </div>
                    )}
                    {data.emailDraft.highlights && data.emailDraft.highlights.length > 0 && (
                      <div className="note info" style={{ marginBottom: 14 }}>
                        <Icon name="info" />
                        <span>
                          <strong>{tx('ข้อสังเกตจากระบบ')}</strong>
                          <br />
                          {data.emailDraft.highlights.join(' · ')}
                        </span>
                      </div>
                    )}
                    <div className="cmp">
                      <div className="f">
                        <span className="l">{tx('ถึง')}</span>
                        <span>{data.emailDraft.to}</span>
                      </div>
                      <div className="f">
                        <span className="l">{tx('สำเนา')}</span>
                        <span>{data.emailDraft.cc}</span>
                      </div>
                      <div className="f sj">
                        <span className="l">{tx('เรื่อง')}</span>
                        <span>{data.emailDraft.subject}</span>
                      </div>
                      <div className="lt">{data.emailDraft.body}</div>
                      <div className="en">
                        <div className="files">
                          {data.emailDraft.attachments.map((a, i) => {
                            const href = a.invoiceId
                              ? `/api/invoices/${encodeURIComponent(a.invoiceId)}/file`
                              : a.timesheetId
                                ? `/api/timesheets/${encodeURIComponent(a.timesheetId)}/file`
                                : null;
                            return href ? (
                              <button key={i} type="button" className="file" onClick={() => openPdfPreview(href, a.label)} title={tx('เปิดดูไฟล์นี้')}>
                                <span className="pd">{a.invoiceId ? 'PDF' : fileBadge(a.label) === 'FILE' ? 'PDF' : fileBadge(a.label)}</span> {a.label}
                              </button>
                            ) : (
                              <span key={i} className="file">
                                <span className="pd">{a.invoiceId ? 'PDF' : fileBadge(a.label) === 'FILE' ? 'PDF' : fileBadge(a.label)}</span> {a.label}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                    {data.emailDraft.note && (
                      <div className="sub" style={{ marginTop: 10 }}>
                        {data.emailDraft.note}
                      </div>
                    )}
                  </Card>
                )}
              </div>
            </div>

            {/* ขวา: ใบแจ้งหนี้ที่จะสร้าง */}
            <div className="sticky">
              <Card
                title={tx('ใบแจ้งหนี้ที่จะสร้าง')}
                right={
                  billed ? (
                    <>
                      {tx('สร้างแล้ว')} — {data.existing?.documentNo}
                      {data.existing?.shareLink && (
                        <>
                          {' '}
                          ·{' '}
                          <a href={data.existing.shareLink} target="_blank" rel="noreferrer">
                            {tx('เปิดดูเอกสาร')}
                          </a>
                        </>
                      )}
                    </>
                  ) : (
                    tx('เลขเอกสารจะได้จาก FlowAccount')
                  )
                }
              >
                <div className="doc">
                  <div className="dh">
                    <div>
                      <Tag tone={billed ? 'ok' : 'wn'}>{billed ? tx('สร้างร่างแล้ว') : `${tx('ร่าง')} · Draft`}</Tag>
                      <div className="cs">{inv.customer.name}</div>
                      <div className="ti">
                        {tx('เลขประจำตัวผู้เสียภาษี')} {inv.customer.taxId} · {inv.customer.branch ?? ''}
                      </div>
                    </div>
                    <dl className="kv">
                      <dt>{tx('วันที่เอกสาร')}</dt>
                      <dd>{formatDate(inv.documentDate)}</dd>
                      <dt>{tx('เครดิต')}</dt>
                      <dd>
                        {inv.creditDays} {tx('วัน')} · {tx('ครบ')} {formatDate(inv.dueDate)}
                      </dd>
                    </dl>
                  </div>
                  <div className="tw">
                    <table style={{ minWidth: 0 }}>
                      <thead>
                        <tr>
                          <th style={{ width: 34 }}>#</th>
                          <th>{tx('รายการ')}</th>
                          <th className="r" style={{ width: 96 }}>
                            {tx('ส่วนลด')}
                          </th>
                          <th className="r" style={{ width: 112 }}>
                            {tx('จำนวนเงิน')}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {inv.items.map((i) => (
                          <tr key={i.seq}>
                            <td className="n">{i.seq}</td>
                            <td>
                              <span className="nm">{i.name}</span>
                              <span className="sub">{i.employeeName}</span>
                              <span className="sub">
                                {i.quantity} {i.unitName} × {money(i.pricePerUnit)}
                              </span>
                            </td>
                            <td className="r n" style={{ color: i.discount ? 'var(--cr)' : 'var(--fnt)' }}>
                              {i.discount ? `−${money(i.discount)}` : '—'}
                            </td>
                            <td className="r n">{money(i.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="dfoot">
                    <div className="tot">
                      <div className="t">
                        <span>{tx('รวมเป็นเงิน')}</span>
                        <span className="v">{money(inv.totals.total)}</span>
                      </div>
                      <div className="t mi">
                        <span>{tx('ส่วนลด')}</span>
                        <span className="v">−{money(inv.totals.discountTotal)}</span>
                      </div>
                      <div className="t rl">
                        <span>{tx('รวมหลังหักส่วนลด')}</span>
                        <span className="v">{money(inv.totals.totalAfterDiscount)}</span>
                      </div>
                      <div className="t">
                        <span>
                          {tx('ภาษีมูลค่าเพิ่ม')} {Math.round(inv.totals.vatRate * 100)}%
                        </span>
                        <span className="v">{money(inv.totals.vat)}</span>
                      </div>
                      <div className="t gr">
                        <span>{tx('รวมทั้งสิ้น')}</span>
                        <span className="v">{money(inv.totals.grandTotal)}</span>
                      </div>
                      <div className="t mi">
                        <span>
                          {tx('หักภาษี ณ ที่จ่าย')} {Math.round(inv.totals.whtRate * 100)}%
                        </span>
                        <span className="v">−{money(inv.totals.withholdingTax)}</span>
                      </div>
                      <div className="t py">
                        <span>{tx('ยอดรับชำระ')}</span>
                        <span className="v">{money(inv.totals.paymentAmount)}</span>
                      </div>
                    </div>
                    {inv.remark && (
                      <div className="rmk">
                        <span className="ey">{tx('หมายเหตุ')}</span>
                        {inv.remark}
                      </div>
                    )}
                    <div className="note">
                      <Icon name="info" />
                      <span>
                        {tx('ภาษีหัก ณ ที่จ่ายคิดจากยอดหลังหักส่วนลดก่อน VAT')} ({money(inv.totals.totalAfterDiscount)} ×{' '}
                        {Math.round(inv.totals.whtRate * 100)}% = {money(inv.totals.withholdingTax)}) {tx('ตามที่ใบแจ้งหนี้ตัวอย่างทำ ไม่ใช่คิดจากยอดรวมทั้งสิ้น')}
                      </span>
                    </div>
                  </div>
                </div>
              </Card>
            </div>
          </div>

          <div className="fbar">
            <span className="sx">
              {billed ? (
                <>
                  <b>{tx('สร้างร่างใน FlowAccount แล้ว')}</b> — {data.existing?.documentNo}
                </>
              ) : (
                data.blockers.length > 0 && (
                  <>
                    <b>{tx('ยังอนุมัติไม่ได้')}</b> — {data.blockers.length} {tx('ข้อ')}
                  </>
                )
              )}
            </span>
            <div className="gap" />
            <button className="btn pri" disabled={billed || data.blockers.length > 0 || approving} onClick={doApprove}>
              <Icon name="send" className="sm" /> {approving ? tx('กำลังสร้างเอกสาร…') : tx('อนุมัติและสร้างร่างใน FlowAccount')}
            </button>
          </div>
        </>
      )}
    </>
  );
}
