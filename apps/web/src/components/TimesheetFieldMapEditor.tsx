'use client';

import { useMemo, useState } from 'react';
import {
  TIMESHEET_DETAIL_FIELDS,
  TIMESHEET_DETAIL_LINE_ITEM,
  TIMESHEET_HEADER_FIELDS,
  TIMESHEET_SUMMARY_FIELDS,
  type TimesheetFieldMap,
  type TimesheetFieldSpec,
} from '@obs/domain';
import { useLang } from '../lib/language';
import { Icon } from './Icon';

type Section = 'header' | 'detail';

/** ค่าที่ตั้งได้ต่อหนึ่งฟิลด์มีสามสถานะ ไม่ใช่สอง — ตรงกับ TimesheetFieldMap ใน @obs/domain:
 *   undefined = ยังไม่ได้ตั้ง (ให้ตัวอ่านใช้ค่า default ของมันเอง)
 *   null      = ฟอร์มนี้ไม่มีฟิลด์นี้จริงๆ (อย่าไปเตือนว่าหาไม่เจอ)
 *   string    = เอกสารของบริษัทรายนี้เรียกฟิลด์นี้ว่าอะไร
 * สองอันหลังต่างกันมากสำหรับฝั่งที่อ่านเอกสาร จึงต้องกดบอกให้ชัด ไม่ใช่เดาเอาจากช่องว่าง */
function entryOf(map: TimesheetFieldMap, section: Section, key: string): string | null | undefined {
  return map[section]?.[key];
}

function withEntry(
  map: TimesheetFieldMap,
  section: Section,
  key: string,
  next: string | null | undefined,
): TimesheetFieldMap {
  const current = { ...(map[section] ?? {}) };
  if (next === undefined) delete current[key];
  else current[key] = next;

  const out: TimesheetFieldMap = { ...map, [section]: current };
  // ไม่เก็บ section เปล่าไว้ใน payload — "ไม่มีคีย์เลย" กับ "มี object ว่าง" ควรมีผลเหมือนกัน
  if (Object.keys(current).length === 0) delete out[section];
  return out;
}

function matches(f: TimesheetFieldSpec, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    f.label.toLowerCase().includes(needle) ||
    f.name.toLowerCase().includes(needle) ||
    f.key.toLowerCase().includes(needle) ||
    f.examples.some((e) => e.toLowerCase().includes(needle))
  );
}

type FieldState = 'set' | 'absent' | 'default';

/** สถานะของหนึ่งฟิลด์ — ใช้ทั้งสีแถว ป้ายสถานะ และตัวนับด้านบน ให้ตรงกันทุกจุด
 *   set     = ใส่ชื่อที่เอกสารเรียกแล้ว (ฟอร์มที่แยกเดือน/ปีก็นับว่าตั้งแล้ว)
 *   absent  = ติ๊กว่าฟอร์มนี้ไม่มีฟิลด์นี้
 *   default = ยังไม่ตั้ง ตัวอ่านใช้ชื่อมาตรฐานของมันเอง */
function stateOf(map: TimesheetFieldMap, section: Section, f: TimesheetFieldSpec): FieldState {
  if (section === 'header' && f.key === 'monthYear' && map.monthYearSplit && (map.monthYearSplit.month || map.monthYearSplit.year)) {
    return 'set';
  }
  const e = entryOf(map, section, f.key);
  if (e === null) return 'absent';
  if (typeof e === 'string' && e.trim()) return 'set';
  return 'default';
}

function countStates(map: TimesheetFieldMap, section: Section, fields: TimesheetFieldSpec[]) {
  let set = 0;
  let absent = 0;
  for (const f of fields) {
    const st = stateOf(map, section, f);
    if (st === 'set') set += 1;
    else if (st === 'absent') absent += 1;
  }
  return { set, absent, total: fields.length };
}

export function TimesheetFieldMapEditor({
  value,
  onChange,
  disabled,
}: {
  value: TimesheetFieldMap;
  onChange: (next: TimesheetFieldMap) => void;
  disabled?: boolean;
}) {
  const { tx } = useLang();
  const [query, setQuery] = useState('');
  const split = value.monthYearSplit;

  /* หัวข้อพับ/กางได้ — เดิมโชว์ทั้ง 57 ฟิลด์ต่อกันเป็นกำแพงยาว (จัดรูปแบบใหม่ 5 ต.ค. 69 ให้ดูง่ายขึ้น)
     ค้นหาอยู่ = กางทุกหัวข้อให้เห็นผลที่เจอทั้งหมด */
  const [openSec, setOpenSec] = useState<Record<string, boolean>>({ header: true, summary: false, detail: false });

  const stats = useMemo(() => {
    const h = countStates(value, 'header', TIMESHEET_HEADER_FIELDS);
    const s = countStates(value, 'header', TIMESHEET_SUMMARY_FIELDS);
    const d = countStates(value, 'detail', TIMESHEET_DETAIL_FIELDS);
    const total = h.total + s.total + d.total;
    const mapped = h.set + s.set + d.set;
    const absent = h.absent + s.absent + d.absent;
    return { total, mapped, absent, byDefault: total - mapped - absent, header: h, summary: s, detail: d };
  }, [value]);

  /** แถวเดียวของตาราง: ซ้าย = ฟิลด์ที่ระบบต้องการ · กลาง = ชื่อที่เอกสารบริษัทเรียก · ขวา = สถานะ + ปุ่ม
   * เป็นฟังก์ชันที่คืน JSX ไม่ใช่คอมโพเนนต์ที่ประกาศซ้อน — ประกาศคอมโพเนนต์ไว้ข้างในนี้ห้ามเด็ดขาด
   * เพราะทุกครั้งที่พิมพ์ React จะเห็นเป็นตัวใหม่แล้วทิ้งช่องกรอกสร้างใหม่ ทำให้เสียโฟกัสทุกตัวอักษร */
  function row(key: string, f: TimesheetFieldSpec, state: FieldState, control: React.ReactNode, actions: React.ReactNode, note?: React.ReactNode) {
    return (
      <div key={key} className={`fm-row ${state}`} title={f.description}>
        <div className="fm-name">
          <b>{f.label}</b>
          <code>{f.name}</code>
          {f.examples.length > 0 && (
            <span className="fm-ex">
              {tx('ตัวอย่าง')}: {f.examples.slice(0, 2).join(' · ')}
            </span>
          )}
        </div>
        <div className="fm-ctl">
          {control}
          {note}
        </div>
        <div className="fm-act">
          <span className={`fm-badge ${state}`}>
            {state === 'set' ? tx('ตั้งค่าแล้ว') : state === 'absent' ? tx('ไม่มีในฟอร์ม') : tx('ใช้ค่าเริ่มต้น')}
          </span>
          {actions}
        </div>
      </div>
    );
  }

  function absentToggle(section: Section, f: TimesheetFieldSpec, absent: boolean) {
    return (
      <button
        type="button"
        className={`fm-toggle${absent ? ' on' : ''}`}
        disabled={disabled}
        aria-pressed={absent}
        onClick={() => onChange(withEntry(value, section, f.key, absent ? undefined : null))}
      >
        {absent ? tx('มีฟิลด์นี้ในฟอร์ม') : tx('ไม่มีในฟอร์ม')}
      </button>
    );
  }

  function renderField(section: Section, f: TimesheetFieldSpec) {
    const entry = entryOf(value, section, f.key);
    const absent = entry === null;
    return row(
      `${section}.${f.key}`,
      f,
      stateOf(value, section, f),
      <input
        value={typeof entry === 'string' ? entry : ''}
        disabled={disabled || absent}
        placeholder={absent ? '—' : f.name}
        aria-label={f.label}
        onChange={(e) => onChange(withEntry(value, section, f.key, e.target.value || undefined))}
      />,
      absentToggle(section, f, absent),
    );
  }

  /** monthYear มีโหมดพิเศษ: ฟอร์มบางเจ้า (เช่น Lotus) แยก "เดือน" กับ "ปี" เป็นคนละช่อง ซึ่งไม่ใช่ฟิลด์
   * กลางคนละตัว แต่เป็นสองช่องในเอกสารที่รวมกันได้ monthYear ตัวเดิม จึงทำเป็นสลับโหมดบนฟิลด์เดียวกัน
   * แทนที่จะเพิ่มอีกสองแถว (ดูคอมเมนต์ monthYearSplit ใน @obs/domain) */
  function renderMonthYear(f: TimesheetFieldSpec) {
    const entry = entryOf(value, 'header', f.key);
    const absent = entry === null;
    const combined = typeof entry === 'string' ? entry : '';
    const splitHasValue = !!split && !!(split.month || split.year);
    // ตัวอ่านอ่านช่องรวมก่อนเสมอ ถ้าได้ค่าแล้วไม่แตะช่องแยกเลย (ดู abbyyClient.ts ตรงที่ pick
    // header.monthYear ก่อน แล้วค่อย fallback ไป monthYearSplit) — ฟอร์มจึงต้องโชว์ช่องรวมเป็นตัวที่
    // ใช้งานจริงเมื่อมีทั้งคู่ ไม่ใช่โชว์โหมดแยกแล้วซ่อนช่องที่กำลังมีผลจริง อย่างที่ Big-C เป็น
    const isSplit = !!split && !combined;
    const bothSet = !!combined && splitHasValue;

    function setSplit(on: boolean) {
      const next: TimesheetFieldMap = { ...value };
      if (on) {
        // แถวที่แปลงมาจากรูปเก่าอาจมีค่าช่องแยกเก็บไว้แล้ว (Big-C มี Month/Year อยู่จริง) — ต้องคงไว้
        // ไม่ใช่เขียนทับด้วยค่าว่าง ไม่งั้นแค่กดติ๊กดูก็ลบ mapping ที่ใช้งานอยู่ทิ้ง
        next.monthYearSplit = { month: split?.month ?? null, year: split?.year ?? null };
        // สองโหมดนี้ใช้แทนกัน ไม่ใช่ใช้ร่วมกัน — เปิดโหมดแยกแล้วต้องไม่เหลือค่าช่องรวมค้างไว้
        const header = { ...(next.header ?? {}) };
        delete header[f.key];
        if (Object.keys(header).length === 0) delete next.header;
        else next.header = header;
      } else {
        delete next.monthYearSplit;
      }
      onChange(next);
    }

    function setSplitPart(part: 'month' | 'year', text: string) {
      // ช่องว่าง = ยังไม่ได้ตั้ง ต้องเก็บเป็น null ตามสัญญาของ TimesheetFieldMap ไม่ใช่สตริงว่าง — สตริง
      // ว่างแปลว่า "ฟิลด์ในเอกสารชื่อว่าง" ซึ่งไม่มีความหมาย และเก็บค่าขยะไว้ใน DB เปล่าๆ
      onChange({
        ...value,
        monthYearSplit: {
          month: split?.month ?? null,
          year: split?.year ?? null,
          [part]: text || null,
        },
      });
    }

    const control = isSplit ? (
      <span className="fm-pair">
        <input
          value={split?.month ?? ''}
          disabled={disabled}
          placeholder={tx('ช่องเดือน')}
          aria-label={tx('ช่องเดือน')}
          onChange={(e) => setSplitPart('month', e.target.value)}
        />
        <input
          value={split?.year ?? ''}
          disabled={disabled}
          placeholder={tx('ช่องปี')}
          aria-label={tx('ช่องปี')}
          onChange={(e) => setSplitPart('year', e.target.value)}
        />
      </span>
    ) : (
      <input
        value={typeof entry === 'string' ? entry : ''}
        disabled={disabled || absent}
        placeholder={absent ? '—' : f.name}
        aria-label={f.label}
        onChange={(e) => onChange(withEntry(value, 'header', f.key, e.target.value || undefined))}
      />
    );

    const note = bothSet ? (
      <span className="fm-note">
        {tx('ตั้งไว้ทั้งช่องรวมและช่องแยก — ระบบอ่านช่องรวมก่อน ถ้าเอกสารฉบับไหนไม่มีช่องรวมหรืออ่านค่าไม่ได้ จะใช้ช่องแยกที่เก็บไว้')}{' '}
        ({split?.month || '—'} / {split?.year || '—'}) {tx('แทน — เก็บไว้ทั้งคู่ได้ ไม่ใช่ค่าที่ต้องลบทิ้ง')}
      </span>
    ) : undefined;

    const actions = (
      <>
        <button
          type="button"
          className={`fm-toggle${isSplit ? ' on' : ''}`}
          disabled={disabled}
          aria-pressed={isSplit}
          onClick={() => setSplit(!isSplit)}
        >
          {tx('แยกเดือน/ปีสองช่อง')}
        </button>
        {!isSplit && absentToggle('header', f, absent)}
      </>
    );

    return row('header.monthYear', f, stateOf(value, 'header', f), control, actions, note);
  }

  const visibleHeader = TIMESHEET_HEADER_FIELDS.filter((f) => matches(f, query));
  const visibleSummary = TIMESHEET_SUMMARY_FIELDS.filter((f) => matches(f, query));
  const visibleDetail = TIMESHEET_DETAIL_FIELDS.filter((f) => matches(f, query));
  const nothingFound = visibleHeader.length === 0 && visibleSummary.length === 0 && visibleDetail.length === 0;
  const pct = stats.total > 0 ? Math.round((stats.mapped / stats.total) * 100) : 0;

  /** หัวข้อที่พับ/กางได้ พร้อมตัวนับและแถบความคืบหน้าของหัวข้อนั้น */
  function section(
    id: 'header' | 'summary' | 'detail',
    title: string,
    counts: { set: number; absent: number; total: number },
    shown: number,
    hint: string | null,
    children: React.ReactNode,
  ) {
    const isOpen = !!query || !!openSec[id];
    const done = counts.set + counts.absent;
    return (
      <div key={id} className={`fm-sec${isOpen ? ' open' : ''}`}>
        <button
          type="button"
          className="fm-sec-hd"
          aria-expanded={isOpen}
          onClick={() => setOpenSec((o) => ({ ...o, [id]: !o[id] }))}
        >
          <span className="t">{title}</span>
          {query && (
            <span className="fm-found">
              {tx('พบ')} {shown}
            </span>
          )}
          <span className="c">
            {done}/{counts.total}
          </span>
          <span className="fm-mini">
            <i style={{ width: `${counts.total ? (done / counts.total) * 100 : 0}%` }} />
          </span>
          <Icon name="cd" className="chev" />
        </button>
        {isOpen && (
          <>
            {hint && <div className="fm-hint">{hint}</div>}
            <div className="fm-cols">
              <span>{tx('ฟิลด์ที่ระบบต้องการ')}</span>
              <span>{tx('ชื่อที่เอกสารของบริษัทเรียก')}</span>
              <span>{tx('สถานะ')}</span>
            </div>
            {children}
          </>
        )}
      </div>
    );
  }

  const tableNameState: FieldState = value.tableName ? 'set' : 'default';

  return (
    <div className="fm">
      <div className="fm-sum">
        <div className="fm-prog">
          <div className="fm-big">
            <b>{stats.mapped}</b>
            <span>
              / {stats.total} {tx('ฟิลด์ที่ตั้งค่าแล้ว')}
            </span>
          </div>
          <div className="fm-bar">
            <i style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="fm-legend">
          <span>
            <i className="fm-dot set" />
            {tx('ตั้งค่าแล้ว')} <b>{stats.mapped}</b>
          </span>
          <span>
            <i className="fm-dot absent" />
            {tx('ไม่มีในฟอร์ม')} <b>{stats.absent}</b>
          </span>
          <span>
            <i className="fm-dot default" />
            {tx('ใช้ค่าเริ่มต้น')} <b>{stats.byDefault}</b>
          </span>
        </div>
      </div>

      <div className="fm-help">
        <b>{tx('วิธีใช้')}</b>
        <ol>
          <li>{tx('ช่องตรงกลาง: พิมพ์ชื่อที่เอกสารของบริษัทนี้เรียกฟิลด์นั้น (ดูจากเอกสารจริง)')}</li>
          <li>{tx('ถ้าเอกสารไม่มีฟิลด์นั้นเลย: กด "ไม่มีในฟอร์ม" ระบบจะไม่เตือนว่าหาฟิลด์ไม่เจอ')}</li>
          <li>{tx('ไม่แน่ใจ: เว้นว่างไว้ ระบบจะใช้ชื่อมาตรฐานของตัวอ่านเอง')}</li>
        </ol>
      </div>

      <input
        className="fm-search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={tx('ค้นหาฟิลด์ (ชื่อไทย ชื่อสเปก หรือตัวอย่าง)')}
      />

      {nothingFound && <div className="sub">{tx('ไม่พบฟิลด์ที่ค้นหา')}</div>}

      {visibleHeader.length > 0 &&
        section(
          'header',
          tx('ฟิลด์หัวเอกสาร'),
          stats.header,
          visibleHeader.length,
          null,
          <div className="fm-rows">
            {visibleHeader.map((f) => (f.key === 'monthYear' ? renderMonthYear(f) : renderField('header', f)))}
          </div>,
        )}

      {visibleSummary.length > 0 &&
        section(
          'summary',
          tx('ช่องสรุปท้ายเอกสาร'),
          stats.summary,
          visibleSummary.length,
          tx('ไม่ได้อยู่ในแม่แบบที่บริษัทให้มา — เพิ่มเองสำหรับฟอร์มที่พิมพ์ยอดรวมไว้ท้ายเอกสาร อ่านจากช่องสรุปเท่านั้น ไม่นับจากตารางให้'),
          <div className="fm-rows">{visibleSummary.map((f) => renderField('header', f))}</div>,
        )}

      {visibleDetail.length > 0 &&
        section(
          'detail',
          tx('ฟิลด์ในตารางรายวัน'),
          stats.detail,
          visibleDetail.length,
          null,
          <div className="fm-rows">
            <div className={`fm-row ${tableNameState}`} title={tx('ชื่อตาราง/line item ที่ตัวอ่านใช้เรียกตารางรายวัน')}>
              <div className="fm-name">
                <b>{tx('ชื่อตารางรายวัน')}</b>
                <code>{TIMESHEET_DETAIL_LINE_ITEM}</code>
                <span className="fm-ex">
                  {tx('ตัวอย่าง')}: {TIMESHEET_DETAIL_LINE_ITEM} · New Table
                </span>
              </div>
              <div className="fm-ctl">
                <input
                  value={value.tableName ?? ''}
                  disabled={disabled}
                  placeholder={TIMESHEET_DETAIL_LINE_ITEM}
                  aria-label={tx('ชื่อตารางรายวัน')}
                  onChange={(e) => {
                    const next = { ...value };
                    if (e.target.value) next.tableName = e.target.value;
                    else delete next.tableName;
                    onChange(next);
                  }}
                />
              </div>
              <div className="fm-act">
                <span className={`fm-badge ${tableNameState}`}>{tableNameState === 'set' ? tx('ตั้งค่าแล้ว') : tx('ใช้ค่าเริ่มต้น')}</span>
              </div>
            </div>
            {visibleDetail.map((f) => renderField('detail', f))}
          </div>,
        )}
    </div>
  );
}
