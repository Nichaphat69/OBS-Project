'use client';

import { useEffect, useState } from 'react';
import { Card, ErrorState } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { DatePicker } from '../../../components/DatePicker';
import { useConfirm, useToast } from '../../../components/Overlays';
import { useLang } from '../../../lib/language';

interface Alias {
  alias: string;
  source: string | null;
}
interface EmployeeRow {
  id: string;
  nameTh: string;
  nameEn: string | null;
  invoicePosition: string;
  hrddEmployeeCode: string | null;
  assignmentId: string | null;
  contractId: string | null;
  monthlyRate: number | null;
  quotationNo: string | null;
  startDate: string | null;
  endDate: string | null;
  status: string | null;
  poNo: string | null;
  contractNo: string | null;
  customerName: string | null;
  nameAliases: Alias[];
  positionAliases: Alias[];
}
interface ActiveContract {
  id: string;
  customerName: string;
  projectName: string;
  endDate: string;
}

function money(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type AliasEditState = { employeeId: string; kind: 'name' | 'position'; mode: 'add' | 'edit'; original?: string } | null;

/** ported from public/app.js's renderMaster() tab 1 (พนักงาน & ชื่อพ้อง) + renderAliasCell()/
 * renderRateCell()/renderEmployeeAddForm()/renderEmployeeEditForm() — inline edit ของ React ใช้
 * local state แทนการแก้ DOM ตรงๆ แต่พฤติกรรม/ฟิลด์/ข้อความตรงกับต้นฉบับทุกจุด */
export default function EmployeesTab() {
  const confirm = useConfirm();
  const toast = useToast();
  const { tx } = useLang();

  const [employees, setEmployees] = useState<EmployeeRow[] | null>(null);
  const [editRowKey, setEditRowKey] = useState<string | null>(null);

  const [aliasEdit, setAliasEdit] = useState<AliasEditState>(null);
  const [aliasValue, setAliasValue] = useState('');

  const [rateEditId, setRateEditId] = useState<string | null>(null);
  const [rateValue, setRateValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  function load() {
    setError(null);
    fetch('/api/contracts/active', { cache: 'no-store' })
      .then((r) => r.json())
      .then((c: ActiveContract | null) => {
        const qs = c ? `?shape=full&contractId=${encodeURIComponent(c.id)}` : '?shape=full';
        return fetch(`/api/employees${qs}`, { cache: 'no-store' });
      })
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          setError(data?.error ?? tx('โหลดข้อมูลไม่สำเร็จ'));
          return;
        }
        setEmployees(await r.json());
      })
      .catch(() => setError(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้')));
  }

  useEffect(load, []);

  async function saveAlias() {
    if (!aliasEdit) return;
    const clean = aliasValue.trim();
    if (!clean) return;
    try {
      const res = await fetch(`/api/employees/${encodeURIComponent(aliasEdit.employeeId)}/aliases`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: aliasEdit.kind, alias: clean }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data?.error ?? tx('บันทึกไม่สำเร็จ'), true);
        return;
      }
      // แก้ไข = เพิ่มใหม่ก่อนแล้วค่อยลบของเดิม (ล้มเหลวตอนเพิ่มก็ยังเหลือของเดิมไว้)
      //
      // ⚠️ ต้องเช็คผลของ DELETE ด้วย — เดิมทิ้งผลไปเฉยๆ ถ้าลบไม่สำเร็จ ผู้ใช้จะเห็นว่า "แก้ชื่อพ้องแล้ว"
      // ทั้งที่จริงกลายเป็น **เพิ่มชื่อพ้องซ้ำอีกตัว** โดยของเดิมยังอยู่ และไม่มีอะไรบอกเลย
      if (aliasEdit.mode === 'edit' && aliasEdit.original && aliasEdit.original !== clean) {
        const delRes = await fetch(`/api/employees/${encodeURIComponent(aliasEdit.employeeId)}/aliases?kind=${encodeURIComponent(aliasEdit.kind)}&alias=${encodeURIComponent(aliasEdit.original)}`, { method: 'DELETE' });
        if (!delRes.ok) {
          const delData = await delRes.json().catch(() => ({}));
          toast(delData?.error ?? `${tx('ลบชื่อพ้องเดิมไม่สำเร็จ — ตอนนี้มีทั้งของเดิมและของใหม่')} "${aliasEdit.original}"`, true);
        }
      }
      setAliasEdit(null);
      setAliasValue('');
      load();
    } catch {
      toast(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'), true);
    }
  }

  async function removeAlias(employeeId: string, kind: 'name' | 'position', alias: string) {
    const label = tx(kind === 'name' ? 'ชื่อพ้อง' : 'ตำแหน่งพ้อง');
    const ok = await confirm({
      iconName: 'trash-solid',
      title: tx(kind === 'name' ? 'ลบชื่อพ้องนี้?' : 'ลบตำแหน่งพ้องนี้?'),
      message: `"${alias}" ${tx(kind === 'name' ? 'จะหายไปจากรายการชื่อพ้อง' : 'จะหายไปจากรายการตำแหน่งพ้อง')}`,
      confirmLabel: tx('ลบ'),
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/employees/${encodeURIComponent(employeeId)}/aliases?kind=${encodeURIComponent(kind)}&alias=${encodeURIComponent(alias)}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        toast(data?.error ?? tx('ลบไม่สำเร็จ'), true);
        return;
      }
      toast(tx('ลบแล้ว'));
      load();
    } catch {
      toast(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'), true);
    }
  }

  function renderAliasCell(e: EmployeeRow, kind: 'name' | 'position', aliases: Alias[]) {
    const editing = aliasEdit;
    const addingHere = editing?.mode === 'add' && editing.employeeId === e.id && editing.kind === kind;
    const label = tx(kind === 'name' ? 'ชื่อพ้อง' : 'ตำแหน่งพ้อง');

    return (
      <>
        {aliases.length === 0 && !addingHere && <span className="sub">{tx('ไม่มี')}</span>}{' '}
        {aliases.map((a) => {
          const editingThis = editing?.mode === 'edit' && editing.employeeId === e.id && editing.kind === kind && editing.original === a.alias;
          if (editingThis) {
            return (
              <span key={a.alias} className="tg alias editing">
                <input
                  type="text"
                  className="aliasInput"
                  autoFocus
                  value={aliasValue}
                  onChange={(ev) => setAliasValue(ev.target.value)}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter') saveAlias();
                    if (ev.key === 'Escape') setAliasEdit(null);
                  }}
                />
                <button className="ax save" title={tx('บันทึก')} onClick={saveAlias}>
                  ✓
                </button>
                <button className="ax cancel" title={tx('ยกเลิก')} onClick={() => setAliasEdit(null)}>
                  ×
                </button>
              </span>
            );
          }
          return (
            <span key={a.alias} className={`tg alias-${kind} alias aliastag`} title={`${a.source ?? ''} — ${tx('คลิกเพื่อแก้ไข')}`} onClick={() => { setAliasEdit({ employeeId: e.id, kind, mode: 'edit', original: a.alias }); setAliasValue(a.alias); }}>
              {a.alias}
              <button
                className="ax rm"
                title={tx(kind === 'name' ? 'ลบชื่อพ้องนี้' : 'ลบตำแหน่งพ้องนี้')}
                onClick={(ev) => {
                  ev.stopPropagation();
                  removeAlias(e.id, kind, a.alias);
                }}
              >
                ×
              </button>
            </span>
          );
        })}
        <div className="arow">
          {addingHere ? (
            <span className="tg alias editing">
              <input
                type="text"
                className="aliasInput"
                autoFocus
                placeholder={tx(kind === 'name' ? 'ชื่อพ้องใหม่' : 'ตำแหน่งพ้องใหม่')}
                value={aliasValue}
                onChange={(ev) => setAliasValue(ev.target.value)}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter') saveAlias();
                  if (ev.key === 'Escape') setAliasEdit(null);
                }}
              />
              <button className="ax save" title={tx('บันทึก')} onClick={saveAlias}>
                ✓
              </button>
              <button className="ax cancel" title={tx('ยกเลิก')} onClick={() => setAliasEdit(null)}>
                ×
              </button>
            </span>
          ) : (
            <button className="lk addal" onClick={() => { setAliasEdit({ employeeId: e.id, kind, mode: 'add' }); setAliasValue(''); }}>
              + {label}
            </button>
          )}
        </div>
      </>
    );
  }

  async function saveRate() {
    if (!rateEditId) return;
    const rate = Number(rateValue);
    try {
      const res = await fetch(`/api/assignments/${encodeURIComponent(rateEditId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ monthlyRate: rate }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data?.error ?? tx('บันทึกไม่สำเร็จ'), true);
        return;
      }
      toast(`${data.employeeName}: ${money(data.from)} → ${money(data.to)} · ${data.note}`);
      setRateEditId(null);
      load();
    } catch {
      toast(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'), true);
    }
  }

  function renderRateCell(e: EmployeeRow) {
    if (!e.assignmentId) return money(e.monthlyRate ?? 0);
    if (rateEditId === e.assignmentId) {
      return (
        <div className="rateEditRow">
          <input
            type="number"
            step="0.01"
            min="0"
            className="rateInput"
            autoFocus
            value={rateValue}
            onChange={(ev) => setRateValue(ev.target.value)}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter') saveRate();
              if (ev.key === 'Escape') setRateEditId(null);
            }}
          />
          <button className="ax save" title={tx('บันทึก')} onClick={saveRate}>
            ✓
          </button>
          <button className="ax cancel" title={tx('ยกเลิก')} onClick={() => setRateEditId(null)}>
            ×
          </button>
        </div>
      );
    }
    return (
      <>
        {money(e.monthlyRate ?? 0)}{' '}
        <button className="lk edrate" onClick={() => { setRateEditId(e.assignmentId!); setRateValue(String(e.monthlyRate ?? 0)); }}>
          {tx('แก้เรท')}
        </button>
      </>
    );
  }

  async function removeFromProject(assignmentId: string, empName: string) {
    const ok = await confirm({
      iconName: 'trash-solid',
      title: tx('นำพนักงานออกจากโครงการนี้?'),
      message: `"${empName}" ${tx('จะหายไปจากรายการของโครงการนี้ — ข้อมูลพนักงาน/ชื่อพ้องเดิมยังอยู่ เผื่อย้ายไปผูกโครงการอื่นทีหลัง')}`,
      confirmLabel: tx('นำออก'),
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/assignments/${encodeURIComponent(assignmentId)}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        toast(data?.error ?? tx('นำออกไม่สำเร็จ'), true);
        return;
      }
      toast(tx('นำออกจากโครงการแล้ว'));
      load();
    } catch {
      toast(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'), true);
    }
  }

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!employees) return null;

  const editingEmployee = employees.find((e) => (e.assignmentId ?? e.id) === editRowKey) ?? null;

  return (
    <>
      {/* ไม่มีปุ่มเพิ่ม/ผูกพนักงานแล้วโดยตั้งใจ (เจ้าของระบบยืนยัน 18 ก.ย. 69) — พนักงานเข้าระบบได้ทาง
          เดียวคือผ่านการเพิ่มสัญญา/PO ที่ดึงจาก FlowAccount เท่านั้น ห้ามเพิ่มมือระหว่างสัญญา
          ("มันต้องอิงจากสัญญาใบว่าจ้าง PO ที่เพิ่มใน FlowAccount เท่านั้น ไม่ควรเพิ่มเองได้") หน้านี้
          จึงเหลือแค่แก้ไข/นำออกพนักงานที่มีอยู่แล้วในตารางด้านล่าง */}

      {editingEmployee && (
        <EmployeeForm
          mode="edit"
          employee={editingEmployee}
          onCancel={() => setEditRowKey(null)}
          onSaved={() => {
            setEditRowKey(null);
            load();
          }}
        />
      )}

      <Card flush>
        <div className="tw">
          <table>
            <thead>
              <tr>
                <th>{tx('รหัส')}</th>
                <th>{tx('ชื่อ')}</th>
                <th>{tx('ชื่อพ้อง')}</th>
                <th>{tx('ตำแหน่งพ้อง')}</th>
                <th>{tx('ตำแหน่งบนใบแจ้งหนี้')}</th>
                <th className="r">{tx('เรท/เดือน')}</th>
                <th>{tx('บริษัท')}</th>
                <th style={{ width: 80 }}></th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => (
                <tr key={`${e.id}-${e.assignmentId ?? ''}`}>
                  <td className="n">{e.id}</td>
                  <td>
                    <span className="nm">{e.nameTh}</span>
                    <span className="sub">{e.nameEn ?? ''}</span>
                  </td>
                  <td>{renderAliasCell(e, 'name', e.nameAliases)}</td>
                  <td>{renderAliasCell(e, 'position', e.positionAliases)}</td>
                  <td>{e.invoicePosition}</td>
                  <td className="r n">{renderRateCell(e)}</td>
                  <td>
                    {e.customerName ?? '—'}
                    <span className="sub">{e.quotationNo ?? ''}</span>
                  </td>
                  <td>
                    <div className="rowacts">
                      <button className="btn sm icon" title={tx('แก้ไขข้อมูลพนักงาน')} aria-label={tx('แก้ไข')} onClick={() => setEditRowKey(e.assignmentId ?? e.id)}>
                        <Icon name="edit" />
                      </button>
                      {e.assignmentId && (
                        <button className="btn sm icon dgr" title={tx('นำออกจากโครงการนี้')} aria-label={tx('ลบ')} onClick={() => removeFromProject(e.assignmentId!, e.nameTh)}>
                          <Icon name="trash" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {employees.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', color: 'var(--mut)' }}>
                    {tx('ยังไม่มีพนักงานในระบบ')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

/** ฟอร์ม "เพิ่มพนักงานใหม่"/"แก้ไขข้อมูลพนักงาน" — ฟิลด์เดียวกันทั้งคู่ ต่างแค่ endDate บังคับกรอกใน
 * โหมดแก้ไข (ไม่บังคับตอนเพิ่ม เพราะไม่ระบุ = ตามวันสิ้นสุดของสัญญา) */
function EmployeeForm({
  mode,
  activeContract,
  employee,
  onCancel,
  onSaved,
}: {
  mode: 'add' | 'edit';
  activeContract?: ActiveContract;
  employee?: EmployeeRow;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const { tx } = useLang();
  const [nameTh, setNameTh] = useState(employee?.nameTh ?? '');
  const [nameEn, setNameEn] = useState(employee?.nameEn ?? '');
  const [invoicePosition, setInvoicePosition] = useState(employee?.invoicePosition ?? '');
  const [hrddCode, setHrddCode] = useState(employee?.hrddEmployeeCode ?? '');
  const [quotationNo, setQuotationNo] = useState(employee?.quotationNo ?? '');
  const [monthlyRate, setMonthlyRate] = useState(employee?.monthlyRate != null ? String(employee.monthlyRate) : '');
  const [startDate, setStartDate] = useState(employee?.startDate ?? '');
  const [endDate, setEndDate] = useState(employee?.endDate ?? '');
  const [saving, setSaving] = useState(false);

  async function save() {
    // endDate บังคับกรอกเฉพาะตอนแก้ไขพนักงานที่ยัง "ผูก" อยู่กับ assignment จริง — พนักงานที่ถูกนำออก
    // จากโครงการไปแล้ว (assignmentId เป็น null) ไม่มี assignment ให้มีวันสิ้นสุด บังคับกรอกไปก็ไม่มี
    // ความหมาย (แก้แค่ชื่อ/ตำแหน่งที่พิมพ์ผิดควรทำได้โดยไม่ต้องกรอกวันที่มั่วๆ)
    const needsEndDate = mode === 'edit' && Boolean(employee?.assignmentId);
    if (mode === 'add') {
      if (!nameTh || !invoicePosition || !monthlyRate || !startDate) {
        toast(tx('กรอกชื่อ ตำแหน่งบนใบแจ้งหนี้ เรทต่อเดือน และวันเริ่มงานให้ครบก่อน'), true);
        return;
      }
    } else if (!nameTh || !invoicePosition || !monthlyRate || !startDate || (needsEndDate && !endDate)) {
      toast(tx('กรอกชื่อ ตำแหน่งบนใบแจ้งหนี้ เรทต่อเดือน และช่วงวันที่ให้ครบก่อน'), true);
      return;
    }

    setSaving(true);
    try {
      const body =
        mode === 'add'
          ? {
              contractId: activeContract!.id,
              nameTh,
              invoicePosition,
              monthlyRate: Number(monthlyRate),
              startDate,
              nameEn: nameEn || null,
              hrddEmployeeCode: hrddCode || null,
              quotationNo: quotationNo || null,
              endDate: endDate || null,
            }
          : {
              assignmentId: employee!.assignmentId || null,
              nameTh,
              invoicePosition,
              monthlyRate: Number(monthlyRate),
              startDate,
              endDate: endDate || null,
              nameEn: nameEn || null,
              hrddEmployeeCode: hrddCode || null,
              quotationNo: quotationNo || null,
            };
      const res = await fetch(mode === 'add' ? '/api/employees' : `/api/employees/${encodeURIComponent(employee!.id)}`, {
        method: mode === 'add' ? 'POST' : 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data?.error ?? tx('บันทึกไม่สำเร็จ'), true);
        setSaving(false);
        return;
      }
      toast(mode === 'add' ? `${tx('เพิ่ม')} "${nameTh}"` : `${tx('บันทึกการแก้ไข')} "${nameTh}"`);
      onSaved();
    } catch {
      toast(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'), true);
      setSaving(false);
    }
  }

  return (
    <Card
      title={tx(mode === 'add' ? 'เพิ่มพนักงานใหม่' : 'แก้ไขข้อมูลพนักงาน')}
      right={
        <span className="sub">
          {mode === 'add' ? `${tx('ผูกอัตราจ้างกับ')} "${activeContract!.customerName} — ${activeContract!.projectName}"` : `${employee!.customerName ?? '—'}${employee!.quotationNo ? ` · ${employee!.quotationNo}` : ''}`}
        </span>
      }
      footer={
        <>
          <button className="btn" onClick={onCancel}>
            {tx('ยกเลิก')}
          </button>
          <button className="btn pri" disabled={saving} onClick={save}>
            {tx(mode === 'add' ? 'บันทึกพนักงานใหม่' : 'บันทึกการแก้ไข')}
          </button>
        </>
      }
    >
      <div className="frm">
        <label>
          {tx('ชื่อ-นามสกุล (ไทย)')}
          <input value={nameTh} onChange={(e) => setNameTh(e.target.value)} />
        </label>
        <label>
          {tx('ชื่อ-นามสกุล (อังกฤษ)')}
          <input value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
        </label>
        <label>
          {tx('ตำแหน่งบนใบแจ้งหนี้')}
          <input value={invoicePosition} onChange={(e) => setInvoicePosition(e.target.value)} />
        </label>
        <label>
          {tx('รหัสพนักงาน HRDD')}
          <input value={hrddCode} onChange={(e) => setHrddCode(e.target.value)} />
        </label>
        <label>
          {tx('เลขที่ใบเสนอราคา (QT)')}
          <input value={quotationNo} onChange={(e) => setQuotationNo(e.target.value)} />
        </label>
        <label>
          {tx('เรทต่อเดือน (บาท)')}
          <input type="number" min={0} step={0.01} value={monthlyRate} onChange={(e) => setMonthlyRate(e.target.value)} />
        </label>
        <label>
          {tx('วันเริ่มงาน')}
          <DatePicker value={startDate} onChange={setStartDate} />
        </label>
        <label>
          {tx(mode === 'add' ? 'วันสิ้นสุด (ถ้าไม่ระบุ = ตามสัญญา)' : 'วันสิ้นสุด')}
          <DatePicker value={endDate} onChange={setEndDate} />
        </label>
      </div>
    </Card>
  );
}

