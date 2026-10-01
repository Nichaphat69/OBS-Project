'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import './scope-filter.css';
import { Icon } from './Icon';
import { useLang } from '../lib/language';
import { matching, useScope, type FilterContract, type ScopeKey } from '../lib/scope';

const MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
function thaiMonthYear(iso: string) {
  const [y, m] = iso.split('-');
  return `${MONTHS[Number(m) - 1] ?? m} ${(Number(y) + 543) % 100}`;
}
export const contractRange = (c: Pick<FilterContract, 'startDate' | 'endDate'>) => `${thaiMonthYear(c.startDate)} – ${thaiMonthYear(c.endDate)}`;

interface Option {
  value: string;
  title: string;
  sub?: string;
  /** ข้อความที่ใช้ค้นหา */
  hay: string;
}

/** รายการเลือกหนึ่งช่องในแผงตัวกรอง (ไม่ใช่ popup แยก) — มีช่องค้นหาเมื่อตัวเลือกเยอะ */
function FilterSection({
  label,
  selectedValue,
  options,
  allLabel,
  onPick,
  searchPlaceholder,
}: {
  label: string;
  selectedValue: string | null;
  options: Option[];
  allLabel: string;
  onPick: (value: string | null) => void;
  searchPlaceholder: string;
}) {
  const { tx } = useLang();
  const [q, setQ] = useState('');
  const shown = q.trim() ? options.filter((o) => o.hay.toLowerCase().includes(q.trim().toLowerCase())) : options;
  return (
    <div className="scopef-sec">
      <div className="scopef-lbl">{label}</div>
      {options.length > 6 && (
        <input className="scope-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchPlaceholder} />
      )}
      <div className="scopef-list" role="listbox" aria-label={label}>
        <button type="button" className={`ctx-item${!selectedValue ? ' on' : ''}`} role="option" aria-selected={!selectedValue} onClick={() => onPick(null)}>
          <span className="chk">{!selectedValue && <Icon name="chk" className="sm" />}</span>
          <span className="tx">
            <b>{allLabel}</b>
          </span>
        </button>
        {shown.map((o) => {
          const on = o.value === selectedValue;
          return (
            <button key={o.value} type="button" className={`ctx-item${on ? ' on' : ''}`} role="option" aria-selected={on} onClick={() => onPick(o.value)}>
              <span className="chk">{on && <Icon name="chk" className="sm" />}</span>
              <span className="tx">
                <b>{o.title}</b>
                {o.sub && <span>{o.sub}</span>}
              </span>
            </button>
          );
        })}
        {shown.length === 0 && <div className="scope-empty">{tx('ไม่พบรายการที่ตรงกับตัวกรองอื่นที่เลือกไว้')}</div>}
      </div>
    </div>
  );
}

/** ตัวกรอง site · เลขที่ PO รวมเป็นปุ่มเดียว (1 ต.ค. 69) — กดแล้วเปิดแผงที่มีสองช่อง เลือกช่องใดช่องหนึ่งก็พอ ไม่มีช่องพนักงานเพราะสัญญา (PO) หนึ่งใบมีพนักงานได้หลายคน กรองที่ PO ก็ได้ทุกคนใน PO นั้นแล้ว
 * ช่องที่เหลือแสดง "ทั้งหมด" ภายใต้ช่องที่เลือก แผงไม่ปิดเองหลังเลือก จะได้เห็นว่าอีกสองช่องเหลือตัวเลือกอะไรบ้าง */
export function ScopeFilterBar() {
  const { tx } = useLang();
  const { contracts, filters, isDefault, isExecutive, setFilter, reset, ready } = useScope();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const sites = useMemo<Option[]>(() => {
    const seen = new Map<string, { name: string; n: number }>();
    for (const c of matching(contracts, filters, 'customerId')) {
      const e = seen.get(c.customerId);
      seen.set(c.customerId, { name: c.customerName, n: (e?.n ?? 0) + 1 });
    }
    return [...seen].map(([value, v]) => ({ value, title: v.name, sub: `${v.n} ${tx('สัญญา')}`, hay: v.name }));
  }, [contracts, filters, tx]);

  const pos = useMemo<Option[]>(
    () =>
      matching(contracts, filters, 'contractId').map((c) => ({
        value: c.id,
        title: `PO ${c.poNo}`,
        sub: `${c.customerName} · ${c.projectName} · ${contractRange(c)}`,
        hay: `${c.poNo} ${c.customerName} ${c.projectName} ${c.contractNo ?? ''}`,
      })),
    [contracts, filters],
  );

  if (!ready || contracts.length === 0) return null;

  const site = contracts.find((c) => c.customerId === filters.customerId)?.customerName ?? null;
  const po = contracts.find((c) => c.id === filters.contractId)?.poNo ?? null;
  const parts = [site, po ? `PO ${po}` : null].filter(Boolean) as string[];
  const nSet = parts.length;
  const summary = parts.length ? parts.join(' · ') : tx('ทุกบริษัท');
  const pick = (key: ScopeKey) => (v: string | null) => setFilter(key, v);

  return (
    <div className="scopef" role="group" aria-label={tx('ตัวกรอง')} ref={ref}>
      <button
        type="button"
        className={`ctxbtn scopef-btn${nSet ? ' set' : ''}${nSet && isDefault ? ' dflt' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={summary}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="search" className="sm" />
        <span className="ctx-label">
          <small>{tx('ตัวกรอง')}{nSet > 0 ? ` (${nSet})` : ''}</small>
          <b>{summary}</b>
        </span>
        <Icon name="cd" className="sm cv" />
      </button>
      {open && (
        <div className="scopef-panel" role="dialog" aria-label={tx('ตัวกรอง')}>
          <div className="scopef-head">
            <b>{tx('ตัวกรอง')}</b>
            <span className="sub">{tx('เลือกช่องใดช่องหนึ่งก็ได้ ช่องที่ไม่เลือกคือทั้งหมด')}</span>
            {!isDefault && (
              <button type="button" className="scope-clear" onClick={reset} title={tx(isExecutive ? 'ล้างตัวกรอง — ดูทุกบริษัท' : 'กลับไปค่าเริ่มต้น — สัญญาที่กำลังดำเนินการอยู่')}>
                {tx('ล้าง')}
              </button>
            )}
          </div>
          <div className="scopef-body">
            <FilterSection label={tx('Site / บริษัท')} selectedValue={filters.customerId} options={sites} allLabel={tx('ทุก site')} onPick={pick('customerId')} searchPlaceholder={tx('ค้นหา site…')} />
            <FilterSection label={tx('เลขที่ PO')} selectedValue={filters.contractId} options={pos} allLabel={tx('ทุก PO')} onPick={pick('contractId')} searchPlaceholder={tx('ค้นหาเลข PO / โครงการ…')} />
          </div>
          <div className="scopef-foot">
            <button type="button" className="btn sm" onClick={() => setOpen(false)}>
              {tx('เสร็จ')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** แถบสรุปขอบเขตที่กำลังดูอยู่ ใช้บนหน้าหลัก (ตรวจ Manday / วางบิล / อัปโหลด) ให้เห็นทันทีว่าตัวเลขและรายการ
 * ที่เห็นเป็นของ site · PO · พนักงานไหน — ใช้ class `.scopebar` เดิมของหน้าตรวจ Manday */
export function ScopeSummary() {
  const { tx } = useLang();
  const { contracts, filters, ready } = useScope();
  if (!ready || contracts.length === 0) return null;
  const site = filters.customerId ? contracts.find((c) => c.customerId === filters.customerId)?.customerName : null;
  const po = filters.contractId ? contracts.find((c) => c.id === filters.contractId) : null;
  const all = !site && !po;
  return (
    <div className={all ? 'scopebar all' : 'scopebar'}>
      <Icon name={all ? 'info' : 'building'} />
      <span>
        {all ? (
          <b>{tx('กำลังดูข้ามทุกบริษัท')}</b>
        ) : (
          <>
            {tx('กำลังดู')} <b>{site ?? tx('ทุก site')}</b>
            {' · '}
            <b>{po ? `PO ${po.poNo}` : tx('ทุก PO')}</b>
            {po && <span style={{ opacity: 0.75 }}> ({contractRange(po)})</span>}
            {po && po.employees.length > 0 && <span style={{ opacity: 0.75 }}> · {tx('พนักงาน')} {po.employees.map((e) => e.nameTh).join(', ')}</span>}
          </>
        )}
      </span>
    </div>
  );
}
