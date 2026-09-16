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

type Section = 'header' | 'detail';

/** ค่าที่ตั้งได้ต่อหนึ่งฟิลด์มีสามสถานะ ไม่ใช่สอง — ตรงกับ TimesheetFieldMap ใน @obs/domain:
 *   undefined = ยังไม่ได้ตั้ง (ให้ตัวอ่านใช้ค่า default ของมันเอง)
 *   null      = ฟอร์มนี้ไม่มีฟิลด์นี้จริงๆ (อย่าไปเตือนว่าหาไม่เจอ)
 *   string    = เอกสารของลูกค้ารายนี้เรียกฟิลด์นี้ว่าอะไร
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

  const stats = useMemo(() => {
    const documentFields = [...TIMESHEET_HEADER_FIELDS, ...TIMESHEET_SUMMARY_FIELDS];
    const all = [
      ...documentFields.map((f) => entryOf(value, 'header', f.key)),
      ...TIMESHEET_DETAIL_FIELDS.map((f) => entryOf(value, 'detail', f.key)),
    ];
    const mapped = all.filter((v) => typeof v === 'string' && v.trim()).length;
    // ฟอร์มที่แยกเดือน/ปี ไม่ได้ตั้ง header.monthYear ไว้ แต่ถือว่าตั้งค่าฟิลด์นั้นแล้วเหมือนกัน
    const splitCounts = value.monthYearSplit && (value.monthYearSplit.month || value.monthYearSplit.year) ? 1 : 0;
    return {
      total: all.length,
      mapped: mapped + splitCounts,
      absent: all.filter((v) => v === null).length,
    };
  }, [value]);

  function renderField(section: Section, f: TimesheetFieldSpec) {
    const entry = entryOf(value, section, f.key);
    const absent = entry === null;
    return (
      <label key={`${section}.${f.key}`} title={f.description}>
        <b>{f.label}</b>
        <small className="fieldmeta">
          {f.name}
          {f.examples.length > 0 && ` · ${tx('ตัวอย่าง')}: ${f.examples.slice(0, 3).join(', ')}`}
        </small>
        <input
          value={typeof entry === 'string' ? entry : ''}
          disabled={disabled || absent}
          placeholder={absent ? '—' : f.name}
          onChange={(e) => onChange(withEntry(value, section, f.key, e.target.value || undefined))}
        />
        <span className="fieldabsent">
          <input
            type="checkbox"
            checked={absent}
            disabled={disabled}
            onChange={(e) => onChange(withEntry(value, section, f.key, e.target.checked ? null : undefined))}
          />
          {tx('ไม่มีในฟอร์ม')}
        </span>
      </label>
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

    return (
      <label key="header.monthYear" title={f.description}>
        <b>{f.label}</b>
        <small className="fieldmeta">
          {f.name}
          {f.examples.length > 0 && ` · ${tx('ตัวอย่าง')}: ${f.examples.slice(0, 3).join(', ')}`}
        </small>

        {isSplit ? (
          <span style={{ display: 'flex', gap: 8 }}>
            <input
              value={split?.month ?? ''}
              disabled={disabled}
              placeholder={tx('ช่องเดือน')}
              onChange={(e) => setSplitPart('month', e.target.value)}
            />
            <input
              value={split?.year ?? ''}
              disabled={disabled}
              placeholder={tx('ช่องปี')}
              onChange={(e) => setSplitPart('year', e.target.value)}
            />
          </span>
        ) : (
          <input
            value={typeof entry === 'string' ? entry : ''}
            disabled={disabled || absent}
            placeholder={absent ? '—' : f.name}
            onChange={(e) => onChange(withEntry(value, 'header', f.key, e.target.value || undefined))}
          />
        )}

        {bothSet && (
          <span className="fieldnote">
            {tx('ตั้งไว้ทั้งช่องรวมและช่องแยก — ระบบอ่านช่องรวมก่อน ถ้าเอกสารฉบับไหนไม่มีช่องรวมหรืออ่านค่าไม่ได้ จะใช้ช่องแยกที่เก็บไว้')}{' '}
            ({split?.month || '—'} / {split?.year || '—'}) {tx('แทน — เก็บไว้ทั้งคู่ได้ ไม่ใช่ค่าที่ต้องลบทิ้ง')}
          </span>
        )}

        <span style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          <span className="fieldabsent">
            <input type="checkbox" checked={isSplit} disabled={disabled} onChange={(e) => setSplit(e.target.checked)} />
            {tx('แยกเดือน/ปีสองช่อง')}
          </span>
          {!isSplit && (
            <span className="fieldabsent">
              <input
                type="checkbox"
                checked={absent}
                disabled={disabled}
                onChange={(e) => onChange(withEntry(value, 'header', f.key, e.target.checked ? null : undefined))}
              />
              {tx('ไม่มีในฟอร์ม')}
            </span>
          )}
        </span>
      </label>
    );
  }

  const visibleHeader = TIMESHEET_HEADER_FIELDS.filter((f) => matches(f, query));
  const visibleSummary = TIMESHEET_SUMMARY_FIELDS.filter((f) => matches(f, query));
  const visibleDetail = TIMESHEET_DETAIL_FIELDS.filter((f) => matches(f, query));
  const nothingFound = visibleHeader.length === 0 && visibleSummary.length === 0 && visibleDetail.length === 0;

  return (
    <div>
      <div className="section-head" style={{ marginTop: 0 }}>
        <div className="section-title">{tx('จับคู่ชื่อฟิลด์กับเอกสารของลูกค้า')}</div>
        <span className="sub">
          {tx('ตั้งค่าแล้ว')} {stats.mapped}/{stats.total}
          {stats.absent > 0 ? ` · ${tx('ระบุว่าไม่มี')} ${stats.absent}` : ''}
        </span>
      </div>

      <div className="sub" style={{ marginBottom: 12 }}>
        {tx('กรอกว่าเอกสารของลูกค้ารายนี้เรียกแต่ละฟิลด์ว่าอะไร — เว้นว่างไว้ถ้ายังไม่ตั้ง ระบบจะใช้ค่าเริ่มต้นของตัวอ่าน ส่วนช่องที่ติ๊กว่าไม่มี ระบบจะไม่เตือนว่าหาฟิลด์ไม่เจอ')}
      </div>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={tx('ค้นหาฟิลด์ (ชื่อไทย ชื่อสเปก หรือตัวอย่าง)')}
        style={{
          width: '100%',
          height: 'var(--h-ctl)',
          padding: '0 12px',
          marginBottom: 16,
          borderRadius: 'var(--r-ctl)',
          border: '1px solid var(--rule)',
          font: 'inherit',
          fontSize: 13.5,
        }}
      />

      {nothingFound && <div className="sub">{tx('ไม่พบฟิลด์ที่ค้นหา')}</div>}

      {visibleHeader.length > 0 && (
        <>
          <div className="section-head" style={{ marginTop: 0 }}>
            <div className="section-title">
              {tx('ฟิลด์หัวเอกสาร')}{' '}
              <span className="sub">({visibleHeader.length}/{TIMESHEET_HEADER_FIELDS.length})</span>
            </div>
          </div>
          <div className="frm">
            {visibleHeader.map((f) => (f.key === 'monthYear' ? renderMonthYear(f) : renderField('header', f)))}
          </div>
        </>
      )}

      {visibleSummary.length > 0 && (
        <>
          <div className="section-head">
            <div className="section-title">
              {tx('ช่องสรุปท้ายเอกสาร')}{' '}
              <span className="sub">({visibleSummary.length}/{TIMESHEET_SUMMARY_FIELDS.length})</span>
            </div>
          </div>
          <div className="sub" style={{ marginBottom: 12 }}>
            {tx('ไม่ได้อยู่ในแม่แบบที่ลูกค้าให้มา — เพิ่มเองสำหรับฟอร์มที่พิมพ์ยอดรวมไว้ท้ายเอกสาร อ่านจากช่องสรุปเท่านั้น ไม่นับจากตารางให้')}
          </div>
          <div className="frm">{visibleSummary.map((f) => renderField('header', f))}</div>
        </>
      )}

      {visibleDetail.length > 0 && (
        <>
          <div className="section-head">
            <div className="section-title">
              {tx('ฟิลด์ในตารางรายวัน')}{' '}
              <span className="sub">({visibleDetail.length}/{TIMESHEET_DETAIL_FIELDS.length})</span>
            </div>
          </div>

          <div className="frm" style={{ marginBottom: 13 }}>
            <label title={tx('ชื่อตาราง/line item ที่ตัวอ่านใช้เรียกตารางรายวัน')}>
              <b>{tx('ชื่อตารางรายวัน')}</b>
              <small>
                {tx('ตัวอย่าง')}: {TIMESHEET_DETAIL_LINE_ITEM}, New Table
              </small>
              <input
                value={value.tableName ?? ''}
                disabled={disabled}
                placeholder={TIMESHEET_DETAIL_LINE_ITEM}
                onChange={(e) => {
                  const next = { ...value };
                  if (e.target.value) next.tableName = e.target.value;
                  else delete next.tableName;
                  onChange(next);
                }}
              />
            </label>
          </div>

          <div className="frm">{visibleDetail.map((f) => renderField('detail', f))}</div>
        </>
      )}
    </div>
  );
}
