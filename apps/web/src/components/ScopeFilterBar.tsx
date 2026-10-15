'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import './scope-filter.css';
import { Icon } from './Icon';
import { useLang, formatYear, type Lang } from '../lib/language';
import { useScope, type FilterContract } from '../lib/scope';

const MONTHS_TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function monthYear(iso: string, lang: Lang) {
  const [y, m] = iso.split('-');
  const name = (lang === 'en' ? MONTHS_EN : MONTHS_TH)[Number(m) - 1] ?? m;
  return `${name} ${formatYear(Number(y), lang)}`;
}
export const contractRange = (c: Pick<FilterContract, 'startDate' | 'endDate'>, lang: Lang) => `${monthYear(c.startDate, lang)} – ${monthYear(c.endDate, lang)}`;

/** ชื่อเรียกสัญญาในตัวกรอง: เลขใบเสนอราคา FlowAccount (QT…) ถ้ามี (12 ต.ค. 69 ตามที่สั่ง) ไม่งั้นใช้เลข PO ของสัญญาที่กรอกเอง */
export const contractRef = (c: Pick<FilterContract, 'poNo' | 'quotationNo'>) => c.quotationNo || `PO ${c.poNo}`;

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
  const { tx, lang } = useLang();
  const { contracts, filters, isDefault, isExecutive, setFilter, reset, ready } = useScope();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      // ปิดด้วยการคลิกนอกกล่องก็ต้องล้างคำค้น/ตำแหน่งที่เลือกค้างไว้ด้วย (เหมือนปุ่มปิด/เลือก) ไม่งั้นเปิดครั้งหน้ายังเห็นคำที่พิมพ์ทิ้งไว้
      if (!ref.current?.contains(e.target as Node)) {
        setOpen(false);
        setQ('');
        setHi(0);
      }
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // เลข PO ที่ขึ้นต้นด้วยที่พิมพ์ มาก่อน แล้วค่อยตามด้วยที่มีคำนั้นอยู่ตรงอื่น (เลข PO / บริษัท / โครงการ / เลขสัญญา)
  const options = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = contracts.filter(
      (c) => !needle || `${c.quotationNo ?? ''} ${c.poNo} ${c.customerName} ${c.projectName} ${c.contractNo ?? ''}`.toLowerCase().includes(needle),
    );
    const rank = (c: FilterContract) => {
      if (!needle) return 0;
      const keys = [c.quotationNo ?? '', c.poNo].map((k) => k.toLowerCase());
      return keys.some((k) => k.startsWith(needle)) ? 0 : keys.some((k) => k.includes(needle)) ? 1 : 2;
    };
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
        title={current ? `${contractRef(current)} · ${current.customerName}` : tx('ทุกใบเสนอราคา')}
        onClick={() => {
          if (open) return close();
          setOpen(true);
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
      >
        <Icon name="search" className="sm" />
        <span className="ctx-label">
          <small>{tx('เลขที่ QT / PO')}</small>
          <b>{current ? `${contractRef(current)} · ${current.customerName}` : tx('ทุกใบเสนอราคา')}</b>
        </span>
        <Icon name="cd" className="sm cv" />
      </button>
      {open && (
        <div className="scopef-panel" role="dialog" aria-label={tx('เลขที่ QT / PO')}>
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
              placeholder={tx('พิมพ์เลข QT / PO / ชื่อบริษัท เพื่อค้นหา…')}
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
                  <b>{tx('ทุกใบเสนอราคา')}</b>
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
                      {c.quotationNo ? <Highlight text={c.quotationNo} q={q} /> : <>PO <Highlight text={c.poNo} q={q} /></>}
                    </b>
                    <span>
                      <Highlight text={c.customerName} q={q} /> · {contractRange(c, lang)}
                    </span>
                    <span>
                      <Highlight text={c.projectName} q={q} />
                    </span>
                  </span>
                </button>
              );
            })}
            {options.length === 0 && <div className="scope-empty">{tx('ไม่พบใบเสนอราคาที่ตรงกับ')} “{q}”</div>}
          </div>
        </div>
      )}
    </div>
  );
}

/** แถบสรุปขอบเขตที่กำลังดูอยู่ ใช้บนหน้าหลัก (ตรวจ Manday / วางบิล / อัปโหลด) ให้เห็นทันทีว่าตัวเลขและรายการ
 * ที่เห็นเป็นของ site · PO · พนักงานไหน — ใช้ class `.scopebar` เดิมของหน้าตรวจ Manday */
export function ScopeSummary() {
  const { tx, lang } = useLang();
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
            {tx('กำลังดู')} <b>{contractRef(po!)}</b>
            {' · '}
            <b>{po!.customerName}</b>
            <span style={{ opacity: 0.75 }}> ({contractRange(po!, lang)})</span>
            {po!.employees.length > 0 && <span style={{ opacity: 0.75 }}> · {tx('พนักงาน')} {po!.employees.map((e) => e.nameTh).join(', ')}</span>}
          </>
        )}
      </span>
    </div>
  );
}
