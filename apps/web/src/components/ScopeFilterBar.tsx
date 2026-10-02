'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import './scope-filter.css';
import { Icon } from './Icon';
import { useLang } from '../lib/language';
import { useScope, type FilterContract } from '../lib/scope';

const MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
function thaiMonthYear(iso: string) {
  const [y, m] = iso.split('-');
  return `${MONTHS[Number(m) - 1] ?? m} ${(Number(y) + 543) % 100}`;
}
export const contractRange = (c: Pick<FilterContract, 'startDate' | 'endDate'>) => `${thaiMonthYear(c.startDate)} – ${thaiMonthYear(c.endDate)}`;

/** ไฮไลต์ส่วนที่ตรงกับที่พิมพ์ในเลข PO — ให้เห็นว่ารายการแนะนำตรงกับตัวอักษรไหน */
function Highlight({ text, q }: { text: string; q: string }) {
  const needle = q.trim();
  const at = needle ? text.toLowerCase().indexOf(needle.toLowerCase()) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <em>{text.slice(at, at + needle.length)}</em>
      {text.slice(at + needle.length)}
    </>
  );
}

/** ตัวกรองเดียวคือ "เลขที่ PO" (2 ต.ค. 69 — เดิมมี Site + PO) พิมพ์ค้นหาได้ มีรายการแนะนำขึ้นตามที่พิมพ์ พร้อมชื่อบริษัท
 * และระยะสัญญากำกับ เลือกแล้วทุกหน้าในระบบเป็นข้อมูลของ PO นั้น (ผ่าน cookie obs_scope ดู lib/scope.tsx) —
 * เลือกด้วยเมาส์ หรือพิมพ์แล้วใช้ ↑ ↓ Enter ก็ได้ */
export function ScopeFilterBar() {
  const { tx } = useLang();
  const { contracts, filters, isDefault, isExecutive, setFilter, reset, ready } = useScope();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // เลข PO ที่ขึ้นต้นด้วยที่พิมพ์ มาก่อน แล้วค่อยตามด้วยที่มีคำนั้นอยู่ตรงอื่น (เลข PO / บริษัท / โครงการ / เลขสัญญา)
  const options = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = contracts.filter(
      (c) => !needle || `${c.poNo} ${c.customerName} ${c.projectName} ${c.contractNo ?? ''}`.toLowerCase().includes(needle),
    );
    const rank = (c: FilterContract) => (!needle ? 0 : c.poNo.toLowerCase().startsWith(needle) ? 0 : c.poNo.toLowerCase().includes(needle) ? 1 : 2);
    return [...list].sort((a, b) => rank(a) - rank(b));
  }, [contracts, q]);

  if (!ready || contracts.length === 0) return null;

  const current = contracts.find((c) => c.id === filters.contractId) ?? null;
  // ตัวเลือกแรกในรายการ = "ทุก PO" (index 0) ตามด้วย PO ที่ตรง (index 1…) — แสดง "ทุก PO" เฉพาะตอนยังไม่ได้พิมพ์
  const showAll = !q.trim();
  const total = options.length + (showAll ? 1 : 0);

  function close() {
    setOpen(false);
    setQ('');
    setHi(0);
  }
  function choose(id: string | null) {
    setFilter('contractId', id);
    close();
  }
  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') return close();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHi((h) => Math.min(h + 1, total - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHi((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (showAll) choose(hi === 0 ? null : options[hi - 1]?.id ?? null);
      else if (options[hi]) choose(options[hi].id);
    }
  }

  return (
    <div className="scopef" role="group" aria-label={tx('ตัวกรอง')} ref={ref}>
      <button
        type="button"
        className={`ctxbtn scopef-btn${current ? ' set' : ''}${current && isDefault ? ' dflt' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={current ? `PO ${current.poNo} · ${current.customerName}` : tx('ทุก PO')}
        onClick={() => {
          if (open) return close();
          setOpen(true);
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
      >
        <Icon name="search" className="sm" />
        <span className="ctx-label">
          <small>{tx('เลขที่ PO')}</small>
          <b>{current ? `PO ${current.poNo} · ${current.customerName}` : tx('ทุก PO')}</b>
        </span>
        <Icon name="cd" className="sm cv" />
      </button>
      {open && (
        <div className="scopef-panel" role="dialog" aria-label={tx('เลขที่ PO')}>
          <div className="scopef-head">
            <input
              ref={inputRef}
              className="scope-search"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setHi(0);
              }}
              onKeyDown={onKey}
              placeholder={tx('พิมพ์เลข PO / ชื่อบริษัท เพื่อค้นหา…')}
              inputMode="search"
              autoComplete="off"
              role="combobox"
              aria-expanded
              aria-controls="scopef-po-list"
            />
            {!isDefault && (
              <button type="button" className="scope-clear" onClick={() => { reset(); close(); }} title={tx(isExecutive ? 'ล้างตัวกรอง — ดูทุกบริษัท' : 'กลับไปค่าเริ่มต้น — สัญญาที่กำลังดำเนินการอยู่')}>
                {tx('ล้าง')}
              </button>
            )}
          </div>
          <div className="scopef-list" id="scopef-po-list" role="listbox">
            {showAll && (
              <button type="button" className={`ctx-item${hi === 0 ? ' hi' : ''}${!current ? ' on' : ''}`} role="option" aria-selected={!current} onMouseEnter={() => setHi(0)} onClick={() => choose(null)}>
                <span className="chk">{!current && <Icon name="chk" className="sm" />}</span>
                <span className="tx">
                  <b>{tx('ทุก PO')}</b>
                  <span>{tx('ดูข้อมูลของทุกบริษัท')}</span>
                </span>
              </button>
            )}
            {options.map((c, idx) => {
              const index = idx + (showAll ? 1 : 0);
              const on = c.id === current?.id;
              return (
                <button key={c.id} type="button" className={`ctx-item${hi === index ? ' hi' : ''}${on ? ' on' : ''}`} role="option" aria-selected={on} onMouseEnter={() => setHi(index)} onClick={() => choose(c.id)}>
                  <span className="chk">{on && <Icon name="chk" className="sm" />}</span>
                  <span className="tx">
                    <b>
                      PO <Highlight text={c.poNo} q={q} />
                    </b>
                    <span>
                      <Highlight text={c.customerName} q={q} /> · {contractRange(c)}
                    </span>
                    <span>
                      <Highlight text={c.projectName} q={q} />
                    </span>
                  </span>
                </button>
              );
            })}
            {options.length === 0 && <div className="scope-empty">{tx('ไม่พบ PO ที่ตรงกับ')} “{q}”</div>}
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
  const po = filters.contractId ? contracts.find((c) => c.id === filters.contractId) : null;
  const all = !po;
  return (
    <div className={all ? 'scopebar all' : 'scopebar'}>
      <Icon name={all ? 'info' : 'building'} />
      <span>
        {all ? (
          <b>{tx('กำลังดูข้ามทุกบริษัท')}</b>
        ) : (
          <>
            {tx('กำลังดู')} <b>PO {po!.poNo}</b>
            {' · '}
            <b>{po!.customerName}</b>
            <span style={{ opacity: 0.75 }}> ({contractRange(po!)})</span>
            {po!.employees.length > 0 && <span style={{ opacity: 0.75 }}> · {tx('พนักงาน')} {po!.employees.map((e) => e.nameTh).join(', ')}</span>}
          </>
        )}
      </span>
    </div>
  );
}
