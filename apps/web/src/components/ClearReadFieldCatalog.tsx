'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from './Icon';
import { useConfirm, useToast } from './Overlays';
import { Loading } from './ui';
import { useLang } from '../lib/language';

/**
 * รายการฟิลด์ของแม่แบบ Clear Read ตัวจริง พร้อม "คำอธิบาย" เต็มๆ ต่อฟิลด์
 *
 * ทำไมคำอธิบายต้องอ่านได้ครบ ไม่ใช่ตัดด้วย ellipsis: `description` ไม่ใช่ tooltip ประกอบ แต่คือ
 * prompt ตัวจริงที่สั่งเครื่องอ่านว่าช่องไหนในเอกสารคือฟิลด์นี้ — แก้ข้อความ = เปลี่ยนพฤติกรรมการอ่าน
 * ข้อความบางช่องยาวหลายบรรทัดและมีไทยปนอังกฤษ จึงย่อได้แต่ต้องกดขยายอ่านเต็มได้เสมอ
 *
 * ทำไมต้องแยกสองกลุ่มให้ขาดจากกัน: Master Template V4 ทั้งฉบับสร้างมาเพื่อแยก "ระดับเอกสาร" ออกจาก
 * "ตารางรายวัน" — คู่ที่ชื่อคล้ายกันแต่คนละระดับ (Document_Site vs Daily_Site, Monthly_Total_Hours
 * vs Daily_Total_Hours) คือหัวใจของสเปก ถ้าหน้าจอปนสองกลุ่มกัน คนตั้งค่าจะจับคู่ผิดข้ามระดับทันที
 *
 * เส้น API นี้อ่านอย่างเดียว ไม่มีทางเขียนกลับไปแก้แม่แบบ — เจ้าของระบบอนุญาตให้ "เชื่อมต่อและอ่าน"
 * เท่านั้น ยังไม่ได้อนุญาตให้เขียนทับ จึงห้ามมีปุ่มแนว "อัปเดตแม่แบบให้ตรง V4" จนกว่าจะถามเจ้าของก่อน
 */

interface TemplateField {
  name: string;
  description: string | null;
  type: string | null;
}

interface ForbiddenName {
  name: string;
  useInstead: string;
}

interface TemplateResult {
  connected: boolean;
  templateId: string | null;
  /** ตัวที่เปิดดูอยู่คือตัวที่ระบบใช้อ่านจริงหรือไม่ — คิดฝั่ง server จะได้ไม่มีใครเทียบ id ผิดฝั่ง */
  isPinned?: boolean;
  error?: string;
  template?: {
    id: string;
    name: string;
    version: number | null;
    isDefault: boolean;
    description: string | null;
    fields: TemplateField[];
    detailColumns: TemplateField[];
  };
  registry?: {
    promptVersion: string;
    forbidden: ForbiddenName[];
    documentMissing: string[];
    detailMissing: string[];
    unknownDocument: string[];
    unknownDetail: string[];
  };
}

interface TemplateSummary {
  id: string;
  name: string;
  isDefault: boolean;
  version: number | null;
  fieldCount: number;
  /** 0 = แม่แบบนี้อ่านตารางรายวันไม่ได้เลย (ใบกำกับภาษี/บัตรประชาชน ฯลฯ ที่อยู่ในบัญชีเดียวกัน) */
  detailColumnCount: number;
  pinned: boolean;
}

interface TemplateListResult {
  connected: boolean;
  pinnedTemplateId: string | null;
  error?: string;
  templates: TemplateSummary[];
}

function matches(f: TemplateField, q: string): boolean {
  return f.name.toLowerCase().includes(q) || (f.description ?? '').toLowerCase().includes(q);
}

export default function ClearReadFieldCatalog({ canSwitch }: { canSwitch: boolean }) {
  const { tx } = useLang();
  const confirm = useConfirm();
  const toast = useToast();
  const [switching, setSwitching] = useState(false);
  const [data, setData] = useState<TemplateResult | null>(null);
  const [list, setList] = useState<TemplateListResult | null>(null);
  // null = ดูตัวที่ระบบใช้อ่านจริง (ไม่ส่ง id) — เลือกตัวอื่นคือ "เปิดดู" เท่านั้น ไม่ได้เปลี่ยนตัวที่ใช้อ่าน
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [allOpen, setAllOpen] = useState(false);
  const [tab, setTab] = useState<'doc' | 'detail'>('doc');

  const load = useCallback((id: string | null, refresh = false) => {
    setBusy(true);
    setFailed(false);
    const p = new URLSearchParams();
    if (id) p.set('id', id);
    if (refresh) p.set('refresh', '1');
    const qs = p.toString();
    fetch(`/api/settings/clear-read/template${qs ? `?${qs}` : ''}`, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        setData(await r.json());
      })
      .catch(() => setFailed(true))
      .finally(() => setBusy(false));
  }, []);

  const loadList = useCallback((refresh = false) => {
    fetch(`/api/settings/clear-read/templates${refresh ? '?refresh=1' : ''}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then(setList)
      .catch(() => setList(null));
  }, []);

  useEffect(() => loadList(false), [loadList]);
  useEffect(() => {
    // เปลี่ยนแม่แบบที่ดู = รายการฟิลด์คนละชุด แถวที่กางค้างไว้จึงไม่มีความหมายอีก ปิดให้หมดก่อน
    setOpen(new Set());
    setAllOpen(false);
    load(viewingId, false);
  }, [load, viewingId]);

  function refreshAll() {
    loadList(true);
    load(viewingId, true);
  }

  /**
   * เปลี่ยนแม่แบบที่ระบบใช้อ่านจริง — คนละการกระทำกับการเลือกใน dropdown โดยตั้งใจ
   *
   * dropdown = เปิดดู ปุ่มนี้ = เปลี่ยนของจริงทั้งระบบ ถ้าให้แค่เลือกแล้วเปลี่ยนทันที พลาดคลิกเดียว
   * บิลรอบถัดไปจะถูกอ่านด้วยแม่แบบผิดโดยไม่มีใครรู้ จึงต้องมีจังหวะยืนยันเสมอ และถ้าตัวที่จะยืนยันไม่มี
   * คอลัมน์รายวันเลย ต้องเตือนแรงกว่าปกติ เพราะนั่นคือแม่แบบที่อ่าน Timesheet ไม่ได้ทั้งใบ
   */
  async function applyTemplate(row: TemplateSummary) {
    const noDaily = row.detailColumnCount === 0;
    const ok = await confirm({
      danger: true,
      iconName: noDaily ? 'info' : 'doc',
      title: noDaily ? tx('แม่แบบนี้อ่าน Timesheet ไม่ได้ ยืนยันหรือไม่?') : tx('เปลี่ยนแม่แบบที่ใช้อ่านจริง?'),
      message: (
        <>
          <div>
            {tx('ไฟล์ที่อ่านหลังจากนี้จะใช้')} <b>{row.name}</b> · {tx('ใบที่อ่านไปแล้วไม่เปลี่ยนตาม')}
          </div>
          {noDaily && (
            <div style={{ marginTop: 8, color: 'var(--red)', fontWeight: 600 }}>
              {tx('แม่แบบนี้ไม่มีคอลัมน์รายวันเลย จะอ่านไม่ได้ทั้งวันลาและ OT และไม่มีข้อมูลพอจะตั้งบิล')}
            </div>
          )}
        </>
      ),
      confirmLabel: tx('เปลี่ยน'),
    });
    if (!ok) return;

    setSwitching(true);
    try {
      const res = await fetch('/api/settings/clear-read/template/active', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: row.id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(body?.error ?? tx('เปลี่ยนแม่แบบไม่สำเร็จ'), true);
        return;
      }
      toast(`${tx('ตอนนี้ระบบอ่านด้วยแม่แบบ')} ${body?.name ?? row.name}`);
      // ดึงรายการใหม่เพื่อให้ pinned ย้ายตาม แล้วกลับไปดู "ตัวที่ระบบใช้อ่าน" (id เดิม แต่ไม่ต้องส่ง id)
      setViewingId(null);
      loadList(true);
    } catch {
      toast(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'), true);
    } finally {
      setSwitching(false);
    }
  }

  const templates = list?.templates ?? [];
  const usable = templates.filter((t) => t.detailColumnCount > 0);
  const others = templates.filter((t) => t.detailColumnCount === 0);
  const pinnedId = list?.pinnedTemplateId ?? null;
  const pinnedName = templates.find((t) => t.id === pinnedId)?.name ?? null;
  const viewingRow = templates.find((t) => t.id === (viewingId ?? pinnedId)) ?? null;
  const viewingOther = !!viewingRow && viewingRow.detailColumnCount === 0;
  // เชื่อ isPinned จาก server ก่อนเสมอ — ถูกต้องแม้รายการแม่แบบจะโหลดไม่ขึ้น ส่วนการเทียบ id เองเป็นแค่
  // ทางสำรองสำหรับ API รุ่นก่อนที่ยังไม่ส่งฟิลด์นี้มา
  const viewingNotPinned = data
    ? data.isPinned === false
    : !!pinnedId && !!viewingRow && viewingRow.id !== pinnedId;

  const reg = data?.registry;
  // แยกตามระดับ ไม่รวมเป็นเซ็ตเดียว — ชื่อเดียวกันอาจ "ไม่รู้จัก" เฉพาะฝั่งรายวัน แต่รู้จักในระดับเอกสาร
  // ถ้ารวมกันจะไปติดป้าย "ระบบอ่านไม่ได้" ให้ช่องที่อ่านได้จริง
  const unknownDoc = useMemo(() => new Set(reg?.unknownDocument ?? []), [reg]);
  const unknownDetail = useMemo(() => new Set(reg?.unknownDetail ?? []), [reg]);
  const unknownCount = unknownDoc.size + unknownDetail.size;
  const forbidden = useMemo(
    () => new Map((reg?.forbidden ?? []).map((f) => [f.name, f.useInstead])),
    [reg],
  );

  const groups = useMemo(() => {
    const t = data?.template;
    if (!t) return [];
    return [
      {
        id: 'doc',
        title: tx('ระดับเอกสาร'),
        hint: tx('หนึ่งค่าต่อหนึ่งใบ Timesheet — หัวเอกสาร ช่องสรุป และลายเซ็น'),
        fields: t.fields,
        missing: reg?.documentMissing ?? [],
        unknown: unknownDoc,
      },
      {
        id: 'detail',
        title: `${tx('ตารางรายวัน')} · TimesheetDetails`,
        hint: tx('หนึ่งแถวต่อหนึ่งวันที่มีการลงเวลา — คนละระดับกับด้านบน แม้ชื่อฟิลด์จะคล้ายกัน'),
        fields: t.detailColumns,
        missing: reg?.detailMissing ?? [],
        unknown: unknownDetail,
      },
    ];
  }, [data, reg, tx, unknownDoc, unknownDetail]);

  const needle = q.trim().toLowerCase();
  const shown = useMemo(
    () => groups.map((g) => ({ ...g, fields: needle ? g.fields.filter((f) => matches(f, needle)) : g.fields })),
    [groups, needle],
  );
  const total = shown.reduce((n, g) => n + g.fields.length, 0);

  function toggle(id: string) {
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    const next = !allOpen;
    setAllOpen(next);
    // "ขยายทั้งหมด" = ทุกแถวที่แสดงอยู่ตอนนี้ ไม่ใช่ทุกแถวในแม่แบบ จะได้ไม่ค้างเปิดช่องที่ถูกค้นหากรองออกไป
    setOpen(next ? new Set(shown.flatMap((g) => g.fields.map((f) => `${g.id}:${f.name}`))) : new Set());
  }

  /* ตัวเลือกแม่แบบต้องอยู่นอกทุกสาขาที่คืนก่อน — ถ้าเปิดดูตัวที่โหลดไม่ขึ้นแล้วตัวเลือกหายไปด้วย
     คนจะติดอยู่กับหน้าเสียโดยไม่มีทางกลับไปเลือกตัวอื่น */
  const picker = templates.length > 0 && (
    <div className="cx-top">
      <label className="cx-lbl" htmlFor="cr-template">{tx('แม่แบบที่เปิดดู')}</label>
      <select
        id="cr-template"
        className="cx-select"
        value={viewingId ?? pinnedId ?? ''}
        disabled={busy}
        onChange={(e) => setViewingId(e.target.value || null)}
      >
        {/* แบ่งกลุ่มตาม "มีตารางรายวันไหม" ซึ่งเป็นข้อเท็จจริง ไม่ใช่ "ใช้กับ Timesheet ได้ไหม" ซึ่งเป็นการตัดสิน
            — บัญชีนี้มี hospital_receipt_template ที่มีตารางรายวัน 6 คอลัมน์แต่ไม่ใช่ Timesheet เลย
            ป้ายกลุ่มจึงพูดได้แค่สิ่งที่รู้จริง ส่วนกลุ่มที่ 0 คอลัมน์พูดได้เต็มปากว่าใช้กับ Timesheet ไม่ได้
            ไม่ปิดไม่ให้เลือกทั้งสองกลุ่ม เพราะเปิดดูฟิลด์เฉยๆ ได้ */}
        {usable.length > 0 && (
          <optgroup label={`${tx('มีตารางรายวัน')} (${usable.length})`}>
            {usable.map((tpl) => (
              <option key={tpl.id} value={tpl.id}>
                {tpl.name} — {tpl.fieldCount} {tx('ช่อง')} / {tpl.detailColumnCount} {tx('คอลัมน์รายวัน')}
                {tpl.pinned ? ` · ${tx('ตัวที่ระบบใช้อ่าน')}` : ''}
              </option>
            ))}
          </optgroup>
        )}
        {others.length > 0 && (
          <optgroup label={`${tx('ไม่มีตารางรายวัน — ใช้กับ Timesheet ไม่ได้')} (${others.length})`}>
            {others.map((tpl) => (
              <option key={tpl.id} value={tpl.id}>
                {tpl.name} — {tpl.fieldCount} {tx('ช่อง')} / 0 {tx('คอลัมน์รายวัน')}
                {tpl.pinned ? ` · ${tx('ตัวที่ระบบใช้อ่าน')}` : ''}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      <button type="button" className="btn" disabled={busy} onClick={refreshAll}>
        {busy ? tx('กำลังโหลด…') : tx('ดึงใหม่')}
      </button>
    </div>
  );

  /* สองแถบนี้กันความเข้าใจผิดที่อันตรายที่สุดของหน้านี้ — เลือกแล้วยังไม่ได้เปลี่ยนตัวที่ใช้อ่านจริง
     และแม่แบบที่ไม่มีคอลัมน์รายวันถ้าเอามาอ่าน Timesheet จะไม่มีวันลา ไม่มี OT ไม่มีอะไรตั้งบิลได้ */
  const notices = (
    <>
      {viewingOther && (
        <div className="note bad" style={{ marginTop: 11 }}>
          <Icon name="info" />
          <div>
            <b>{tx('แม่แบบนี้อ่านตารางรายวันไม่ได้')}</b>
            <div>{tx('ไม่มีคอลัมน์รายวันเลย ถ้าเอามาอ่าน Timesheet จะไม่ได้วันลา ไม่ได้ OT และไม่มีข้อมูลพอจะตั้งบิล — เปิดดูฟิลด์ได้ตามปกติ แต่คนละงานกับ Timesheet')}</div>
          </div>
        </div>
      )}
      {viewingNotPinned && (
        <div className="tplview">
          <Icon name="eye" />
          <span>
            {tx('กำลังเปิดดูเฉยๆ ยังไม่ได้เปลี่ยนแม่แบบที่ใช้อ่านจริง ระบบยังอ่านด้วย')}{' '}
            <b>{pinnedName ?? pinnedId}</b>
          </span>
          {viewingRow && (
            <button
              type="button"
              className="btn sm pri"
              disabled={!canSwitch || switching || busy}
              title={canSwitch ? undefined : tx('เปลี่ยนแม่แบบที่ใช้อ่านได้เฉพาะ admin')}
              onClick={() => applyTemplate(viewingRow)}
            >
              {switching ? tx('กำลังเปลี่ยน…') : tx('ใช้ตัวนี้อ่านจริง')}
            </button>
          )}
        </div>
      )}
    </>
  );

  if (failed) {
    return (
      <div className="crfields">
        {picker}
        {notices}
        <div className="note bad" style={{ marginTop: 11 }}>
          <Icon name="info" />
          <div>
            <b>{tx('โหลดรายการฟิลด์ไม่สำเร็จ')}</b>
            <div>{tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้')}</div>
          </div>
          <button type="button" className="btn sm" onClick={() => load(viewingId, false)}>{tx('ลองอีกครั้ง')}</button>
        </div>
      </div>
    );
  }

  if (!data) {
    return <div className="crfields">{picker}<Loading variant="lines" rows={4} /></div>;
  }

  // ต่อ Clear Read ไม่ได้ ≠ หน้าพัง — API จงใจตอบ 200 พร้อมเหตุผล เพื่อให้หน้าตั้งค่ายังเปิดดูได้
  if (!data.connected || !data.template) {
    return (
      <div className="crfields">
        {picker}
        {notices}
        <div className="note bad" style={{ marginTop: 11 }}>
          <Icon name="info" />
          <div>
            <b>{tx('ต่อกับ Clear Read ไม่ได้ตอนนี้')}</b>
            <div>{data.error || tx('ไม่ทราบสาเหตุ')}</div>
            {data.templateId && <div className="mono">{tx('รหัสแม่แบบ')} {data.templateId}</div>}
          </div>
          <button type="button" className="btn sm" disabled={busy} onClick={() => load(viewingId, true)}>
            {busy ? tx('กำลังโหลด…') : tx('ลองอีกครั้ง')}
          </button>
        </div>
      </div>
    );
  }

  const t = data.template;
  const clean =
    !!reg
    && forbidden.size === 0
    && unknownCount === 0
    && (reg.documentMissing.length + reg.detailMissing.length) === 0;

  // รายการที่ต้องดู (นับเฉพาะที่มีผล) — โชว์เป็นป้ายเล็กๆ บนแถบสรุป กดขยายดูรายละเอียดทีละกลุ่มได้
  const missingAll = reg ? [...new Set([...reg.documentMissing, ...reg.detailMissing])] : [];
  const unknownAll = [...new Set([...unknownDoc, ...unknownDetail])];
  const issueCount = unknownAll.length + forbidden.size + missingAll.length;
  const active = shown.find((g) => g.id === tab) ?? shown[0];

  // จัดหน้าใหม่ 6 ต.ค. 69: แถบเลือกแม่แบบ → การ์ดสรุป (ป้ายจำนวน + ผลเทียบสารบัญพับได้) → แท็บสลับระดับเอกสาร/ตารางรายวัน
  // (ทีละระดับ ไม่ต่อกันยาวเป็นพันแถว) + ค้นหา → รายการฟิลด์เป็นแถวเรียบ กดขยายอ่านคำอธิบายเต็ม · ตรรกะทุกอย่างเหมือนเดิม
  return (
    <div className="crfields cx">
      {picker}
      {notices}

      <div className={`cx-sum${reg ? (clean ? ' ok' : ' warn') : ''}`}>
        <div className="cx-sum-hd">
          {reg && <span className="cx-sico"><Icon name={clean ? 'chk' : 'info'} /></span>}
          <div className="cx-stt">
            <b>
              {reg
                ? `${clean ? tx('ตรงตามสารบัญฟิลด์กลาง') : tx('เทียบกับสารบัญฟิลด์กลาง')} ${reg.promptVersion}`
                : tx('แม่แบบที่เปิดดู')}
            </b>
            {/* รหัสแม่แบบไว้เทียบกับหน้า Clear Read ตรงๆ ตอนไล่ปัญหา — เก็บไว้แต่ทำให้เงียบที่สุด */}
            <span className="cx-id" title={t.id}>{t.id}</span>
          </div>
          <div className="cx-chips">
            <span className="cx-chip"><b>{t.fields.length}</b>{tx('ช่องระดับเอกสาร')}</span>
            <span className="cx-chip"><b>{t.detailColumns.length}</b>{tx('คอลัมน์รายวัน')}</span>
            {t.version !== null && <span className="cx-chip mu">v{t.version}</span>}
            {t.isDefault && <span className="cx-chip mu">{tx('ค่าเริ่มต้น')}</span>}
          </div>
        </div>

        {reg && !clean && (
          <details className="cx-iss">
            <summary>
              <span className="cx-sumtxt">{tx('ข้อสังเกตจากการเทียบสารบัญ')}</span>
              {unknownAll.length > 0 && <span className="cx-b bad">{tx('อ่านไม่ได้')} {unknownAll.length}</span>}
              {forbidden.size > 0 && <span className="cx-b warn">{tx('เลิกใช้')} {forbidden.size}</span>}
              {missingAll.length > 0 && <span className="cx-b mu">{tx('ยังไม่มี')} {missingAll.length}</span>}
              <span className="cx-more">{issueCount} {tx('รายการ')}</span>
            </summary>
            <div className="cx-igrid">
              {unknownAll.length > 0 && (
                <div className="cx-ic bad">
                  <b>{tx('ระบบอ่านค่าจากช่องเหล่านี้ไม่ได้')} ({unknownAll.length})</b>
                  <p>{tx('ตั้งไว้ในแม่แบบแล้ว แต่ระบบไม่รู้จักชื่อนี้ ข้อมูลจึงไม่ไหลเข้ามา')}</p>
                  <div className="cx-codes">{unknownAll.map((n) => <code key={n}>{n}</code>)}</div>
                </div>
              )}
              {forbidden.size > 0 && (
                <div className="cx-ic warn">
                  <b>{tx('ชื่อที่ V4 เลิกใช้แล้ว')} ({forbidden.size})</b>
                  <p>{tx('สเปกห้ามใช้ชื่อซ้ำข้ามระดับ จึงแยกเป็นชื่อใหม่แทน')}</p>
                  <div className="cx-codes">{[...forbidden].map(([n, use]) => <code key={n}>{n} → {use}</code>)}</div>
                </div>
              )}
              {missingAll.length > 0 && (
                <div className="cx-ic mu">
                  <b>{tx('สเปกมีแต่แม่แบบยังไม่มี')} ({missingAll.length})</b>
                  <p>{tx('ไม่ใช่ข้อผิดพลาดเสมอไป — ถ้าฟอร์มบริษัทไม่มีช่องนี้จริงก็ไม่ต้องมี')}</p>
                  <div className="cx-codes">{missingAll.map((n) => <code key={n}>{n}</code>)}</div>
                </div>
              )}
            </div>
          </details>
        )}
      </div>

      <div className="cx-bar">
        <div className="cx-tabs" role="tablist">
          {shown.map((g) => (
            <button
              key={g.id}
              type="button"
              role="tab"
              aria-selected={active?.id === g.id}
              className={`cx-tab${active?.id === g.id ? ' on' : ''}`}
              onClick={() => { setTab(g.id as 'doc' | 'detail'); setOpen(new Set()); setAllOpen(false); }}
            >
              {g.id === 'doc' ? tx('ระดับเอกสาร') : tx('ตารางรายวัน')}
              <b>{g.fields.length}</b>
            </button>
          ))}
        </div>
        <div className="cx-find">
          <Icon name="search" className="sm" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={tx('ค้นหาชื่อช่อง หรือข้อความในคำอธิบาย')}
            aria-label={tx('ค้นหาฟิลด์')}
          />
        </div>
        <button type="button" className="btn" onClick={toggleAll}>
          {allOpen ? tx('ย่อทั้งหมด') : tx('ขยายทั้งหมด')}
        </button>
      </div>

      {active && <p className="cx-hint">{active.hint}</p>}

      {needle && active && active.fields.length === 0 ? (
        <div className="cx-none">{tx('ไม่พบฟิลด์ที่ตรงกับคำค้น')} “{q.trim()}”</div>
      ) : (
        active && (
          <ul className="cx-rows">
            {active.fields.map((f) => {
              const id = `${active.id}:${f.name}`;
              const isOpen = open.has(id);
              const isUnknown = active.unknown.has(f.name);
              const useInstead = forbidden.get(f.name);
              return (
                <li key={id} className={`cx-fr${isOpen ? ' open' : ''}`}>
                  <button type="button" className="cx-hd" onClick={() => toggle(id)} aria-expanded={isOpen}>
                    <span className="cx-nm">{f.name}</span>
                    {isUnknown && <span className="cx-b bad">{tx('ระบบอ่านไม่ได้')}</span>}
                    {useInstead && <span className="cx-b warn">{tx('ชื่อที่เลิกใช้')}</span>}
                    <span className="cx-gap" />
                    {f.type && <span className={`cx-ty ${f.type.toLowerCase()}`}>{f.type}</span>}
                    <Icon name="chev" className="cx-cv" />
                  </button>
                  {isOpen && (
                    <div className="cx-body">
                      {useInstead && <p className="cx-use">{tx('ใช้แทนด้วย')} <code>{useInstead}</code></p>}
                      {f.description ? (
                        <p className="cx-ds">{f.description}</p>
                      ) : (
                        <p className="cx-ds nodesc">{tx('ช่องนี้ไม่มีคำอธิบายในแม่แบบ — เครื่องอ่านจะเดาจากชื่อช่องอย่างเดียว')}</p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )
      )}
      {!needle && active && active.missing.length > 0 && (
        <p className="cx-miss">
          {tx('สเปกมีแต่แม่แบบยังไม่มี')}: {active.missing.map((n) => <code key={n}>{n}</code>)}
        </p>
      )}
    </div>
  );
}
