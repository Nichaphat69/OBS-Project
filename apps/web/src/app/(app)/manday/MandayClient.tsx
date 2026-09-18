'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PageHeader, ReadModelTag, StatusPill, Tag } from '../../../components/ui';
import { useReadModelNameMap } from '../../../components/readModelNames';
import { Icon } from '../../../components/Icon';
import { useLang } from '../../../lib/language';

interface TimesheetListItem {
  id: string;
  period: string;
  periodLabel: string;
  receivedAt: string;
  status: string;
  statusLabel: string;
  employee: { nameTh: string | null; invoicePosition: string | null; monthlyRate: number | null };
  rawEmployeeName: string | null;
  contract: { poNo: string; projectName: string; customerName: string };
  check: { checked: boolean; stale: boolean };
  payableDays: number | null;
  reportedWorkDays: number | null;
  discount: number | null;
  lineAmount: number | null;
  leaveDatesText: string;
  /** optional เพราะเป็นฟิลด์ที่เพิ่งเพิ่มฝั่ง API — ตอน deploy หน้าเว็บขึ้นก่อน (ซึ่งเป็นลำดับที่ระบบนี้
   * ใช้อยู่) API ตัวเก่ายังไม่ส่งฟิลด์นี้มา ถ้าประกาศเป็น required แล้ว .map() ตรงๆ หน้าจะพังทั้งหน้า */
  leaveDates?: Array<{ date: string; type: string; label: string }>;
  readModel: string | null;
}

function shortDate(iso: string) {
  const [, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}`;
}

interface ListResult {
  items: TimesheetListItem[];
  counts: { needsReview: number; checked: number; all: number; billed: number; rejected: number };
  /** ขอบเขตที่เซิร์ฟเวอร์ใช้จริง ไม่ใช่ที่หน้านี้ตั้งใจขอ — ต้องเอาอันนี้ขึ้นจอ ไม่ใช่เดาจากรายการที่เห็น */
  scope?: { contractId: string | null; allCompanies: boolean };
}

const TABS = [
  { key: 'needsReview', label: 'ต้องตรวจ' },
  { key: 'checked', label: 'ยืนยันแล้ว' },
  { key: 'all', label: 'ทั้งหมด' },
  { key: 'billed', label: 'วางบิลแล้ว' },
  { key: 'rejected', label: 'ตีกลับ' },
] as const;

function money(n: number | null) {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function matchesTab(item: TimesheetListItem, tab: string): boolean {
  switch (tab) {
    case 'billed':
      return item.status === 'billed';
    case 'rejected':
      return item.status === 'rejected';
    case 'checked':
      return item.check.checked && item.status !== 'billed' && item.status !== 'rejected';
    case 'needsReview':
      return item.status !== 'billed' && item.status !== 'rejected' && !item.check.checked;
    default:
      return true;
  }
}

export default function MandayClient() {
  const { tx } = useLang();
  const [data, setData] = useState<ListResult | null>(null);
  const [scopeName, setScopeName] = useState<string | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('needsReview');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const readModelNames = useReadModelNameMap();

  /**
   * ไม่ส่ง `contractId` ขึ้นไปแล้วโดยตั้งใจ — ให้เซิร์ฟเวอร์เลือกสัญญาที่กำลังดำเนินการอยู่เอง
   *
   * ของเดิมหน้านี้ดึงสัญญา active มาแล้วแนบไปเอง ซึ่งแปลว่าถ้าหน้าดึงมาไม่ทัน/ดึงพลาด มันจะกลายเป็น
   * "ขอทุกบริษัท" คือ**พลาดแล้วขอบเขตกว้างขึ้น** ซึ่งผิดทิศสำหรับข้อมูลค่าจ้างรายคน (เจอจริง: เลือก ปตท.
   * อยู่แต่รายการขึ้นพนักงานไทยประกันชีวิตมาด้วย) ตอนนี้ฝั่งเซิร์ฟเวอร์ตั้งค่าเริ่มต้นให้แล้ว หน้านี้จึงไม่ควร
   * ส่งค่าที่อาจเก่ากว่าของจริงไปทับ
   *
   * ชื่อบริษัทที่โชว์ยึด `scope.contractId` ที่เซิร์ฟเวอร์ตอบกลับมาเป็นหลัก แล้วค่อยหาชื่อจากสัญญา active
   * ถ้า id ไม่ตรงกันแปลว่าเพิ่งมีการสลับบริษัทคาบเกี่ยวกัน — โชว์ชื่อไม่ได้ ดีกว่าโชว์ชื่อผิด
   */
  async function load() {
    const [listRes, activeRes] = await Promise.all([
      fetch('/api/timesheets', { cache: 'no-store' }),
      fetch('/api/contracts/active', { cache: 'no-store' }),
    ]);
    const list: ListResult = await listRes.json();
    const active: { id: string; customerName: string } | null = await activeRes.json().catch(() => null);
    setData(list);
    setScopeName(active && active.id === list.scope?.contractId ? active.customerName : null);
  }

  useEffect(() => {
    load();
  }, []);

  async function doCheck(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/timesheets/${id}/check`, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error ?? tx('ยืนยันไม่สำเร็จ'));
        return;
      }
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function doReject(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/timesheets/${id}/reject`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: rejectReason || undefined }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error ?? tx('ตีกลับไม่สำเร็จ'));
        return;
      }
      setRejectingId(null);
      setRejectReason('');
      await load();
    } finally {
      setBusyId(null);
    }
  }

  if (!data) {
    return (
      <>
        <PageHeader eyebrow={tx('ขั้นตอน 2 · ตรวจ Manday')} title={tx('ตรวจ Manday')} />
        <div style={{ color: 'var(--mut)' }}>{tx('กำลังโหลด…')}</div>
      </>
    );
  }

  const items = data.items.filter((i) => matchesTab(i, tab));

  return (
    <>
      <PageHeader eyebrow={tx('ขั้นตอน 2 · ตรวจ Manday')} title={tx('ตรวจ Manday')} subtitle={tx('ตรวจผลคำนวณ Manday แล้วยืนยันหรือตีกลับให้แก้ไข')} />

      {/* บอกขอบเขตที่เซิร์ฟเวอร์ใช้จริง — ก่อนหน้านี้หน้านี้ไม่เคยบอก คนจึงต้องเดาจากรายชื่อที่เห็น
          และนั่นคือเหตุผลที่รายการข้ามบริษัทอยู่นานโดยไม่มีใครจับได้ */}
      {data.scope && (
        <div className={data.scope.allCompanies ? 'scopebar all' : 'scopebar'}>
          <Icon name={data.scope.allCompanies ? 'info' : 'building'} />
          <span>
            {data.scope.allCompanies ? (
              <b>{tx('กำลังดูข้ามทุกบริษัท')}</b>
            ) : (
              <>
                {tx('กำลังดูเฉพาะ')} <b>{scopeName ?? tx('บริษัทที่กำลังดำเนินการอยู่')}</b>
              </>
            )}
          </span>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 22 }}>
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className={`btn sm${tab === t.key ? ' pri' : ''}`}>
            {tx(t.label)} <span className="n">{data.counts[t.key]}</span>
          </button>
        ))}
      </div>

      {items.length === 0 && (
        <div className="card">
          <div className="empty">{tx('ไม่มีรายการในหมวดนี้')}</div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 18 }}>
        {items.map((item) => (
          <div key={item.id} className="card" style={{ marginBottom: 0 }}>
            <div className="hd">
              <h3>{item.employee.nameTh ?? item.rawEmployeeName ?? tx('ไม่ทราบชื่อ')}</h3>
              <div className="rt">
                <StatusPill tone={item.status === 'mismatch' ? 'cr' : item.status === 'verified' ? 'ok' : 'mu'}>
                  {tx(item.statusLabel)}
                </StatusPill>
              </div>
            </div>
            <div className="bd">
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
                <Tag tone="mu">{item.periodLabel}</Tag>
                <Tag tone="mu">{tx('เลขที่')} {item.id}</Tag>
                {/* กล่องข้อความแยกทีละวัน ไม่รวมเป็นบรรทัดเดียวคั่นจุลภาค — เดือนที่ลาหลายวันจะได้ไม่ต้อง
                    ไล่อ่านทีละคำ (18 ก.ย. 69 ตามที่เจ้าของระบบขอ) */}
                {(item.leaveDates ?? []).map((l) => (
                  <Tag key={l.date} tone="wn">{l.label} {shortDate(l.date)}</Tag>
                ))}
                {/* กวาดตาทีเดียวว่าใบไหนมาจากเครื่องอ่านตัวไหน — จุดประสงค์หลักของการแสดงตรงนี้
                    คือเทียบหลังสลับตัวอ่านไปมา ซึ่งดูทีละใบในหน้ารายละเอียดไม่ตอบโจทย์ */}
                <ReadModelTag model={item.readModel} nameMap={readModelNames} />
              </div>
              <div className="sub" style={{ marginBottom: 14 }}>
                {tx('รับเมื่อ')} {item.receivedAt?.slice(0, 10)} · {item.contract.customerName} · {item.contract.projectName}
              </div>

              <table style={{ minWidth: 0 }}>
                <tbody>
                  <tr>
                    <td style={{ padding: '8px 0', border: 'none' }}>{tx('เรทค่าบริการต่อเดือน')}</td>
                    <td className="r n" style={{ padding: '8px 0', border: 'none' }}>
                      {money(item.employee.monthlyRate)}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: '8px 0', border: 'none' }}>
                      {tx('วันทำงานที่วางบิลได้')}
                      <span className="sub">{tx('ตาม Timesheet')} {item.reportedWorkDays ?? '—'} {tx('วัน')}</span>
                    </td>
                    <td className="r n" style={{ padding: '8px 0', border: 'none' }}>
                      {item.payableDays ?? '—'} {tx('วัน')}
                    </td>
                  </tr>
                  {item.discount ? (
                    <tr>
                      <td style={{ padding: '8px 0', border: 'none', color: 'var(--cr)' }}>{tx('ส่วนลดวันลา')}</td>
                      <td className="r n" style={{ padding: '8px 0', border: 'none', color: 'var(--cr)' }}>
                        −{money(item.discount)}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <div className="ft" style={{ justifyContent: 'space-between' }}>
              <div>
                <div className="sub">{tx('ยอดที่วางบิลได้')}</div>
                <div className="amt" style={{ fontSize: 20 }}>
                  {money(item.lineAmount)}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {rejectingId === item.id ? (
                  <>
                    <input
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      placeholder="เหตุผล (ไม่บังคับ)"
                      style={{
                        height: 34,
                        borderRadius: 'var(--r-ctl)',
                        border: '1px solid var(--rule)',
                        padding: '0 10px',
                        fontSize: 12.5,
                        width: 140,
                      }}
                    />
                    <button className="btn dgr sm" disabled={busyId === item.id} onClick={() => doReject(item.id)}>
                      {tx('ยืนยันตีกลับ')}
                    </button>
                    <button className="btn ghost sm" onClick={() => setRejectingId(null)}>
                      {tx('ยกเลิก')}
                    </button>
                  </>
                ) : (
                  <>
                    <Link href={`/manday/${item.id}`} className="btn pri sm">
                      {tx('เปิดตรวจ')}
                    </Link>
                    <button className="btn dgr sm" onClick={() => setRejectingId(item.id)}>
                      {tx('ตีกลับ')}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
