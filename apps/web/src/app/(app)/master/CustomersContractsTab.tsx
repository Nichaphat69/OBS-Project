'use client';

import { useEffect, useState } from 'react';
import { Card, ErrorState, Loading } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { DatePicker } from '../../../components/DatePicker';
import { useConfirm, useToast } from '../../../components/Overlays';
import { useLang } from '../../../lib/language';
import { SETTINGS_CHANGED_EVENT } from '../../../lib/settingsChanged';

interface ContractRow {
  id: string;
  poNo: string;
  poDate: string | null;
  customerId: string;
  customerName: string;
  taxId: string;
  billingPlace: string | null;
  contactName: string | null;
  contactPhone: string | null;
  projectName: string;
  contractNo: string | null;
  startDate: string;
  endDate: string;
  creditDays: number;
  divisorMode: string;
  divisorValue: number;
  vatRate: number;
  whtRate: number;
  /** ยังอยู่ในข้อมูลและยังถูกใช้จริงโดยเส้น Gmail ที่ไม่มีคนมากดเลือก Skill ให้ — หน้านี้แค่เลิกแก้มัน
   * (ผู้ใช้เลือก Skill ที่หน้าอัปโหลดแทนแล้ว) จึงไม่ส่งคีย์นี้ขึ้นไปตอนบันทึก ไม่ใช่ส่ง null ซึ่งจะล้างค่า */
  abbyySkillId: string | null;
  headcount: number;
  monthlyTotal: number;
  status: string;
  /** บริษัทผูก FlowAccount แล้ว → พนักงาน/เรทแก้เองไม่ได้ ใช้ปุ่มซิงก์แทน */
  flowaccountLinked?: boolean;
  zipCode?: string | null;
  faReference?: string | null;
  quotationDate?: string | null;
  priceIncludesVat?: boolean;
  salesName?: string | null;
  remarks?: string | null;
  internalNotes?: string | null;
  quotationSubTotal?: number | null;
  quotationDiscount?: number | null;
  quotationGrandTotal?: number | null;
}
/** บริษัทที่สร้างไว้แล้วแต่ยังไม่มีสัญญาเลย — ดู GET /api/customers/without-contract */
interface CustomerWithoutContract {
  id: string;
  nameTh: string;
  taxId: string;
}
interface FlowAccountEmployee {
  nameTh: string;
  invoicePosition: string;
  monthlyRate: number;
  quantity?: number | null;
  unitName?: string | null;
}
interface FlowAccountCompany {
  flowaccountContactId: string;
  nameTh: string;
  taxId: string;
  branch: string;
  address: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  quotationNo: string | null;
  projectName: string | null;
  // ฟิลด์ที่ดึงเพิ่มจากใบเสนอราคา (5 ต.ค. 69) — ดู FlowAccountCompany ฝั่ง apps/api
  zipCode?: string | null;
  reference?: string | null;
  creditDays?: number | null;
  quotationDate?: string | null;
  withholdingPercent?: number | null;
  vatPercent?: number | null;
  isVatInclusive?: boolean;
  remarks?: string | null;
  internalNotes?: string | null;
  salesName?: string | null;
  subTotal?: number | null;
  discountAmount?: number | null;
  grandTotal?: number | null;
  employees: FlowAccountEmployee[];
}

/** ปุ่มเชื่อมต่อ FlowAccount — ย้ายมาจากแถบบน (topbar) เดิม เพราะเป็นสวิตช์ที่คุมข้อมูลบริษัท/สัญญาที่
 * ซิงก์มาจาก FlowAccount โดยตรง จึงควรอยู่ในแท็บนี้แทน ไม่ใช่ปุ่มลอยบนแถบบนที่ไม่เกี่ยวกับหน้าที่เปิดอยู่ */
function FlowAccountToggle() {
  const confirm = useConfirm();
  const toast = useToast();
  const { tx } = useLang();
  const [mode, setMode] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  function loadMode() {
    setFailed(false);
    fetch('/api/pulse', { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error('failed');
        return r.json();
      })
      .then((data) => setMode(data.flowAccountMode))
      .catch(() => setFailed(true));
  }
  useEffect(loadMode, []);

  async function toggle() {
    const turningOn = mode === 'dry-run';
    const ok = await confirm({
      iconName: turningOn ? 'signin' : 'signout',
      danger: !turningOn,
      title: tx(turningOn ? 'เชื่อมต่อ FlowAccount?' : 'ปิดการเชื่อมต่อ FlowAccount?'),
      message: tx(
        turningOn
          ? 'ระบบจะเริ่มเชื่อมต่อกับ FlowAccount จริง ดึงข้อมูลบริษัท/พนักงานได้ และใช้ยิงเอกสารตอนกดอนุมัติวางบิล'
          : 'ทุกคำขอจะกลายเป็น dry-run (ข้อมูลจำลอง) ทั้งระบบ ไม่เชื่อมต่อกับ FlowAccount จริงอีก จนกว่าจะเปิดใหม่',
      ),
      confirmLabel: tx(turningOn ? 'เชื่อมต่อ' : 'ปิดการเชื่อมต่อ'),
    });
    if (!ok) return;
    try {
      const res = await fetch('/api/settings/flowaccount-connected', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: turningOn }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data?.error ?? tx('ทำรายการไม่สำเร็จ'), true);
        return;
      }
      toast(tx(turningOn ? 'เชื่อมต่อ FlowAccount แล้ว' : 'ปิดการเชื่อมต่อ FlowAccount แล้ว'));
      loadMode();
      window.dispatchEvent(new Event(SETTINGS_CHANGED_EVENT));
    } catch {
      toast(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'), true);
    }
  }

  if (failed) {
    return (
      <button type="button" className="btn ghost sm" title={tx('โหลดสถานะ FlowAccount ไม่สำเร็จ — กดเพื่อลองใหม่')} onClick={loadMode}>
        {tx('โหลด FlowAccount ไม่สำเร็จ')}
      </button>
    );
  }
  if (mode === null) return null;
  return (
    <button type="button" className={`env ${mode === 'dry-run' ? 'dry' : 'live'}`} title={tx('โหมดการเชื่อมต่อ FlowAccount — กดเพื่อเปิด/ปิด')} onClick={toggle}>
      <span className="sw" /> FlowAccount
    </button>
  );
}

function money(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function dateOnly(iso: string, lang: 'th' | 'en'): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(lang === 'en' ? 'en-US' : 'th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** ปัดเป็นทศนิยม 2 ตำแหน่งไม่ให้เพี้ยนจาก floating point (เช่น 0.0158*100 อาจได้ 1.5800000000000001)
 * แต่ไม่บังคับโชว์ทศนิยมท้ายที่ไม่มีนัยสำคัญ (3% ยังโชว์ "3" ไม่ใช่ "3.00") */
function pctPrecise(rate: number) {
  return Math.round(rate * 10000) / 100;
}

/** ช่องอัตราหัก ณ ที่จ่าย พร้อมปุ่มดินสอแก้เฉพาะช่องนี้ — เดิมมีแต่ตัวเลขปัดเศษเต็ม (Math.round) ล้วนๆ
 * แก้ค่าละเอียด (เช่น 1.58%) ไม่ได้เลยนอกจากเปิดฟอร์ม "แก้ไขข้อมูลสัญญา" ทั้งใบซึ่งต้องกรอกทุกช่อง
 * ยิงตรงไปที่ PATCH /:id/wht-rate (จุดเดียวกับที่หน้าอัปโหลด/ตรวจ Timesheet ใช้อยู่แล้ว) ไม่ผ่าน
 * updateContract() แบบ full-replace — validation 0–30% อยู่ฝั่ง server (updateContractWhtRate) แล้ว */
function WhtRateCell({ contract, onSaved }: { contract: ContractRow; onSaved: () => void }) {
  const toast = useToast();
  const { tx } = useLang();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(pctPrecise(contract.whtRate)));
  const [saving, setSaving] = useState(false);

  async function save() {
    const pct = Number(value);
    if (!Number.isFinite(pct) || pct < 0 || pct > 30) {
      toast(tx('อัตราหัก ณ ที่จ่ายต้องอยู่ระหว่าง 0–30%'), true);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/contracts/${encodeURIComponent(contract.id)}/wht-rate`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ whtRate: pct / 100 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data?.error ?? tx('บันทึกไม่สำเร็จ'), true);
        return;
      }
      toast(tx('บันทึกอัตราหัก ณ ที่จ่ายแล้ว'));
      setEditing(false);
      onSaved();
    } catch {
      toast(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'), true);
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {pctPrecise(contract.whtRate)}%
        <button
          type="button"
          className="btn sm icon"
          title={tx('แก้อัตราหัก ณ ที่จ่าย')}
          aria-label={tx('แก้ไข')}
          onClick={() => {
            setValue(String(pctPrecise(contract.whtRate)));
            setEditing(true);
          }}
        >
          <Icon name="edit" />
        </button>
      </span>
    );
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <input
        type="number"
        min={0}
        max={30}
        step={0.01}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoFocus
        style={{
          width: 64,
          height: 30,
          borderRadius: 'var(--r-ctl)',
          border: '1px solid var(--rule)',
          padding: '0 8px',
          fontSize: 12.5,
        }}
      />
      %
      <button type="button" className="btn sm pri" disabled={saving} onClick={save}>
        {tx('บันทึก')}
      </button>
      <button type="button" className="btn sm ghost" disabled={saving} onClick={() => setEditing(false)}>
        {tx('ยกเลิก')}
      </button>
    </span>
  );
}

/** ported from public/app.js's renderMaster() tab 2 (บริษัท & สัญญา) + renderCustomerAddForm()/
 * renderContractEditForm() */
export default function CustomersContractsTab() {
  const confirm = useConfirm();
  const toast = useToast();
  const { tx, lang } = useLang();

  const [contracts, setContracts] = useState<ContractRow[] | null>(null);
  const [orphanCustomers, setOrphanCustomers] = useState<CustomerWithoutContract[]>([]);
  // เดิมโชว์เป็นการ์ดแจ้งเตือนเปิดค้างไว้เสมอ ดูเหมือนบั๊ก/ของแปลกเทียบกับ FlowAccount ที่ไม่มีแนวคิดนี้
  // เลย (เจ้าของระบบทักไว้ 25 ก.ย. 69) — เก็บความสามารถ "กลับมาเพิ่มสัญญาทีหลัง" ไว้เหมือนเดิม (ยังจำเป็น
  // เพราะ CustomerAddForm ด้านล่างยอมให้เว้นสัญญาว่างไว้ตอนสร้างบริษัทได้) แค่พับซ่อนไว้เป็นค่าเริ่มต้น
  // ไม่โผล่เป็นแบนเนอร์เด่นเหมือนมีปัญหาให้ต้องรีบแก้
  const [showOrphans, setShowOrphans] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editContractId, setEditContractId] = useState<string | null>(null);
  const [addContractForCustomerId, setAddContractForCustomerId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setError(null);
    fetch('/api/contracts', { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          setError(data?.error ?? tx('โหลดข้อมูลไม่สำเร็จ'));
          return;
        }
        setContracts(await r.json());
      })
      .catch(() => setError(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้')));
    // บริษัทที่สร้างไว้แต่ยังไม่มีสัญญา (เพิ่งแยกขั้นตอนสร้างบริษัท/สัญญาออกจากกัน) — ล้มเหลวได้เงียบๆ
    // เพราะไม่ใช่ข้อมูลหลักของหน้านี้ ไม่ควรทำให้ทั้งหน้าใช้งานไม่ได้ถ้าดึงไม่สำเร็จ
    fetch('/api/customers/without-contract', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then(setOrphanCustomers)
      .catch(() => setOrphanCustomers([]));
  }
  useEffect(load, []);

  async function toggleActive(contract: ContractRow, turningOn: boolean) {
    setTogglingId(contract.id);
    try {
      const res = await fetch(`/api/contracts/${encodeURIComponent(contract.id)}/active`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ active: turningOn }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data?.error ?? tx('ทำรายการไม่สำเร็จ'), true);
        return;
      }
      toast(turningOn ? tx('เปิดใช้งานบริษัทนี้แล้ว — บริษัทอื่นที่เปิดอยู่ถูกปิดให้อัตโนมัติ') : tx('ปิดใช้งานแล้ว'));
      load();
    } catch {
      toast(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'), true);
    } finally {
      setTogglingId(null);
    }
  }

  const [syncingId, setSyncingId] = useState<string | null>(null);

  /** ปุ่ม "ซิงก์จาก FlowAccount" (QA EMPLOCK-003, 1 ต.ค. 69) — ข้อความ "แก้เองไม่ได้ ใช้ปุ่มซิงก์แทน" เคยชี้ไปที่ปุ่มที่ไม่มีใน
   * หน้าจอเลย (มีแต่ endpoint ฝั่ง API) ซิงก์เพิ่ม/อัปเดตเรท/ปิดสถานะพนักงานของสัญญานี้ให้ตรงกับใบเสนอราคาล่าสุดใน FlowAccount */
  async function syncFromFlowAccount(contract: ContractRow) {
    const ok = await confirm({
      iconName: 'rf',
      title: tx('ซิงก์พนักงานจาก FlowAccount?'),
      message: `"${contract.poNo} — ${contract.projectName}" ${tx('จะเพิ่ม/ปรับเรท/ปิดสถานะพนักงานในสัญญานี้ให้ตรงกับใบเสนอราคาล่าสุดของบริษัทนี้ใน FlowAccount')}`,
      confirmLabel: tx('ซิงก์'),
    });
    if (!ok) return;
    setSyncingId(contract.id);
    try {
      const res = await fetch(`/api/contracts/${encodeURIComponent(contract.id)}/sync-flowaccount`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data?.error ?? tx('ซิงก์ไม่สำเร็จ'), true);
        return;
      }
      toast(
        `${tx('ซิงก์แล้ว')}: ${tx('เพิ่ม')} ${data.created?.length ?? 0} · ${tx('ปรับเรท')} ${data.updated?.length ?? 0} · ${tx('ปิดสถานะ')} ${data.deactivated?.length ?? 0} · ${tx('ไม่เปลี่ยน')} ${data.unchanged ?? 0}`,
      );
      load();
    } catch {
      toast(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'), true);
    } finally {
      setSyncingId(null);
    }
  }

  async function deleteContract(contract: ContractRow) {
    const ok = await confirm({
      iconName: 'trash-solid',
      danger: true,
      title: tx('ลบสัญญานี้?'),
      message: `"${contract.poNo} — ${contract.projectName}" ${tx('และพนักงาน/Timesheet ทั้งหมดของสัญญานี้จะหายไปถาวร — กู้คืนไม่ได้ (ลบได้เฉพาะสัญญาที่ยังไม่เคยออกใบแจ้งหนี้เลยเท่านั้น ถ้าเคยวางบิลไปแล้วแม้แต่ใบเดียว ระบบจะปฏิเสธการลบทั้งหมด)')}`,
      confirmLabel: tx('ลบ'),
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/contracts/${encodeURIComponent(contract.id)}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        toast(data?.error ?? tx('ลบไม่สำเร็จ'), true);
        return;
      }
      toast(tx('ลบสัญญาแล้ว'));
      load();
    } catch {
      toast(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'), true);
    }
  }

  async function deleteOrphanCustomer(customer: CustomerWithoutContract) {
    const ok = await confirm({
      iconName: 'trash-solid',
      danger: true,
      title: tx('ลบบริษัทรายนี้?'),
      message: `"${customer.nameTh}" ${tx('จะถูกลบถาวร — กู้คืนไม่ได้ (ลบได้เพราะยังไม่มีสัญญาผูกอยู่)')}`,
      confirmLabel: tx('ลบ'),
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/customers/${encodeURIComponent(customer.id)}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        toast(data?.error ?? tx('ลบไม่สำเร็จ'), true);
        return;
      }
      toast(tx('ลบบริษัทแล้ว'));
      load();
    } catch {
      toast(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'), true);
    }
  }

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!contracts)
    return (
      <Card>
        <Loading />
      </Card>
    );

  return (
    <>
      <div className="metabar">
        <FlowAccountToggle />
        <button className="btn pri sm" onClick={() => setAddOpen(true)}>
          <Icon name="grid" className="sm" /> {tx('เพิ่มบริษัทใหม่')}
        </button>
      </div>

      {addOpen && (
        <CustomerAddForm
          onCancel={() => setAddOpen(false)}
          onSaved={() => {
            setAddOpen(false);
            load();
          }}
        />
      )}

      {/* บริษัทที่สร้างไว้แล้วแต่ยังไม่มีสัญญา (เพิ่งเพิ่มบริษัทแบบเว้นสัญญาไว้ก่อน) — ต้องมีที่ให้กลับมา
          หาแล้วเพิ่มสัญญาต่อได้ ไม่งั้นบริษัทกลุ่มนี้จะหายไปจากหน้านี้ถาวรเพราะรายการหลักไล่จากสัญญา
          พับซ่อนไว้เป็นค่าเริ่มต้น (25 ก.ย. 69 ตามที่ขอ) ไม่โผล่เป็นแบนเนอร์เด่นเหมือนของเดิม */}
      {orphanCustomers.length > 0 &&
        (addContractForCustomerId ? (
          <AddContractForm
            customer={orphanCustomers.find((o) => o.id === addContractForCustomerId)!}
            onCancel={() => setAddContractForCustomerId(null)}
            onSaved={() => {
              setAddContractForCustomerId(null);
              load();
            }}
          />
        ) : (
          <div style={{ marginBottom: 18 }}>
            <button type="button" className="btn ghost sm" onClick={() => setShowOrphans((v) => !v)}>
              <Icon name="chev" className="xs" style={{ transform: showOrphans ? 'rotate(180deg)' : undefined }} />
              {tx('บริษัทที่ยังไม่มีสัญญา')} ({orphanCustomers.length})
            </button>
            {showOrphans && (
              <div style={{ marginTop: 10 }}>
                <Card title={tx('บริษัทที่ยังไม่มีสัญญา')} right={<span className="rt">{orphanCustomers.length}</span>}>
                  <div className="tasklist">
                    {orphanCustomers.map((o) => (
                      <div key={o.id} className="taskrow">
                        <div className="tt">
                          <b>{o.nameTh}</b>
                          <span>{tx('เลขผู้เสียภาษี')} {o.taxId}</span>
                        </div>
                        <div className="rowacts">
                          <button className="btn pri sm" onClick={() => setAddContractForCustomerId(o.id)}>
                            {tx('เพิ่มสัญญา')}
                          </button>
                          <button
                            className="btn sm icon dgr"
                            title={tx('ลบบริษัทรายนี้')}
                            aria-label={tx('ลบ')}
                            onClick={() => deleteOrphanCustomer(o)}
                          >
                            <Icon name="trash" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            )}
          </div>
        ))}

      {contracts.map((c) =>
        editContractId === c.id ? (
          <ContractEditForm
            key={c.id}
            contract={c}
              onCancel={() => setEditContractId(null)}
            onSaved={() => {
              setEditContractId(null);
              load();
            }}
          />
        ) : (
          <Card
            key={c.id}
            title={`${c.poNo} — ${c.projectName}`}
            right={
              <div className="rowacts">
                <label
                  className={`toggle${c.status === 'active' ? ' on' : ''}`}
                  title={tx(c.status === 'active' ? 'กำลังดำเนินการอยู่ — ปิดไปยังไม่มีบริษัทอื่นมาแทนที่อัตโนมัติ' : 'ปิดอยู่ — เปิดเพื่อให้ระบบทำงานกับบริษัทนี้ (จะปิดบริษัทอื่นที่เปิดอยู่ให้เองอัตโนมัติ)')}
                >
                  <input type="checkbox" checked={c.status === 'active'} disabled={togglingId === c.id} onChange={(e) => toggleActive(c, e.target.checked)} />
                  <span className="tk" />
                  <span className="tl">{c.status === 'active' ? tx('กำลังดำเนินการ') : tx('ปิดอยู่')}</span>
                </label>
                {c.flowaccountLinked && (
                  <button className="btn sm" disabled={syncingId === c.id} title={tx('ซิงก์รายชื่อและเรทพนักงานจากใบเสนอราคาล่าสุดใน FlowAccount')} onClick={() => syncFromFlowAccount(c)}>
                    <Icon name="rf" />
                    <span>{syncingId === c.id ? tx('กำลังซิงก์…') : tx('ซิงก์จาก FlowAccount')}</span>
                  </button>
                )}
                <button className="btn sm icon" title={tx('แก้ไขข้อมูลสัญญา')} aria-label={tx('แก้ไข')} onClick={() => setEditContractId(c.id)}>
                  <Icon name="edit" />
                </button>
                <button className="btn sm icon dgr" title={tx('ลบสัญญานี้')} aria-label={tx('ลบ')} onClick={() => deleteContract(c)}>
                  <Icon name="trash" />
                </button>
              </div>
            }
          >
            <div className="g2">
              <dl className="kv">
                <dt>{tx('บริษัท')}</dt>
                <dd>{c.customerName}</dd>
                <dt>{tx('เลขผู้เสียภาษี')}</dt>
                <dd className="n">{c.taxId}</dd>
                <dt>{tx('เลขที่สัญญา')}</dt>
                <dd className="n">{c.contractNo ?? '—'}</dd>
                <dt>{tx('ช่วงสัญญา')}</dt>
                <dd>
                  {dateOnly(c.startDate, lang)} – {dateOnly(c.endDate, lang)}
                </dd>
                <dt>{tx('จำนวนคน')}</dt>
                <dd className="n">{c.headcount} {tx('คน')}</dd>
              </dl>
              <dl className="kv">
                <dt>{tx('ยอดต่อเดือน')}</dt>
                <dd className="n">{money(c.monthlyTotal)} {tx('บาท')}</dd>
                <dt>{tx('ตัวหารอัตราต่อวัน')}</dt>
                <dd>{c.divisorMode === 'fixed' ? `${tx('คงที่')} ${c.divisorValue}` : tx('วันทำงานจริงของเดือน')}</dd>
                <dt>VAT</dt>
                <dd className="n">{Math.round(c.vatRate * 100)}%</dd>
                <dt>{tx('หัก ณ ที่จ่าย')}</dt>
                <dd className="n">
                  <WhtRateCell contract={c} onSaved={load} />
                </dd>
                <dt>{tx('เครดิต')}</dt>
                <dd className="n">{c.creditDays} {tx('วัน')}</dd>
                <dt>{tx('ผู้ประสานงาน')}</dt>
                <dd>
                  {c.contactName ?? '—'} {c.contactPhone ?? ''}
                </dd>
                {c.billingPlace && (
                  <>
                    <dt>{tx('สถานที่วางบิล')}</dt>
                    <dd>{c.billingPlace}</dd>
                  </>
                )}
              </dl>
            </div>
            {/* ข้อมูลที่ดึงจากใบเสนอราคา FlowAccount (5 ต.ค. 69) — โชว์เฉพาะสัญญาที่มีค่าอย่างน้อยหนึ่งช่อง */}
            {(c.faReference || c.quotationDate || c.salesName || c.remarks || c.internalNotes || c.zipCode || c.quotationGrandTotal != null || c.priceIncludesVat) && (
              <>
                <div className="sub" style={{ margin: '14px 0 6px', fontWeight: 600 }}>{tx('ข้อมูลจากใบเสนอราคา FlowAccount')}</div>
                <div className="g2">
                  <dl className="kv">
                    {c.faReference && (<><dt>{tx('เลขที่อ้างอิง')}</dt><dd className="n">{c.faReference}</dd></>)}
                    {c.quotationDate && (<><dt>{tx('วันที่ใบเสนอราคา')}</dt><dd>{dateOnly(c.quotationDate, lang)}</dd></>)}
                    <dt>{tx('ราคา')}</dt>
                    <dd>{c.priceIncludesVat ? tx('รวมภาษี') : tx('ไม่รวมภาษี')}</dd>
                    {c.salesName && (<><dt>{tx('พนักงานขาย')}</dt><dd>{c.salesName}</dd></>)}
                    {c.zipCode && (<><dt>{tx('รหัสไปรษณีย์')}</dt><dd className="n">{c.zipCode}</dd></>)}
                  </dl>
                  <dl className="kv">
                    {c.quotationSubTotal != null && (<><dt>{tx('ยอดก่อนส่วนลด')}</dt><dd className="n">{money(c.quotationSubTotal)} {tx('บาท')}</dd></>)}
                    {c.quotationDiscount != null && c.quotationDiscount > 0 && (<><dt>{tx('ส่วนลด')}</dt><dd className="n">{money(c.quotationDiscount)} {tx('บาท')}</dd></>)}
                    {c.quotationGrandTotal != null && (<><dt>{tx('ยอดรวมทั้งสิ้น')}</dt><dd className="n">{money(c.quotationGrandTotal)} {tx('บาท')}</dd></>)}
                    {c.remarks && (<><dt>{tx('หมายเหตุ')}</dt><dd>{c.remarks}</dd></>)}
                    {c.internalNotes && (<><dt>{tx('บันทึกภายใน')}</dt><dd>{c.internalNotes}</dd></>)}
                  </dl>
                </div>
              </>
            )}
          </Card>
        ),
      )}
    </>
  );
}

/** ฟอร์ม "เพิ่มบริษัทใหม่" — สร้างบริษัท + สัญญาแรกในคราวเดียว เพราะบริษัทที่ไม่มีสัญญาเลยใช้งานอะไร
 * ไม่ได้ (ไม่มีอัตราจ้าง ไม่มีรอบบิล) */
function CustomerAddForm({ onCancel, onSaved }: { onCancel: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { tx } = useLang();
  const [faCompanies, setFaCompanies] = useState<FlowAccountCompany[]>([]);
  const [faIndex, setFaIndex] = useState('');
  const [faContactId, setFaContactId] = useState<string | null>(null);
  const [faHint, setFaHint] = useState('');

  const [nameTh, setNameTh] = useState('');
  const [taxId, setTaxId] = useState('');
  const [branch, setBranch] = useState('สำนักงานใหญ่');
  const [address, setAddress] = useState('');
  const [creditDays, setCreditDays] = useState('30');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [billingPlace, setBillingPlace] = useState('');

  const [poNo, setPoNo] = useState('');
  const [contractNo, setContractNo] = useState('');
  const [projectName, setProjectName] = useState('');
  const [divisorMode, setDivisorMode] = useState('fixed');
  const [divisorValue, setDivisorValue] = useState('20');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [vat, setVat] = useState('7');
  const [wht, setWht] = useState('3');
  // ฟิลด์ที่ดึงเพิ่มจากใบเสนอราคา FlowAccount (5 ต.ค. 69) — แก้ได้ก่อนบันทึก ยกเว้นยอดรวม (อ่านอย่างเดียว)
  const [zipCode, setZipCode] = useState('');
  const [faReference, setFaReference] = useState('');
  const [quotationDate, setQuotationDate] = useState('');
  const [priceIncludesVat, setPriceIncludesVat] = useState(false);
  const [salesName, setSalesName] = useState('');
  const [remarks, setRemarks] = useState('');
  const [internalNotes, setInternalNotes] = useState('');
  const [faTotals, setFaTotals] = useState<{ sub: number | null; disc: number | null; grand: number | null }>({ sub: null, disc: null, grand: null });
  // เติมช่องไหนให้จากใบเสนอราคาแล้วบ้าง — ไว้ขึ้นข้อความเตือนให้ตรวจก่อนบันทึก (โดยเฉพาะเลข PO ที่เดามาจากเลขที่อ้างอิง)
  const [poFromRef, setPoFromRef] = useState(false);
  const [faNotes, setFaNotes] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch('/api/flowaccount/companies', { cache: 'no-store' })
      .then((r) => r.json())
      .then(setFaCompanies)
      .catch(() => setFaCompanies([]));
  }, []);

  function onFromFaChange(indexStr: string) {
    setFaIndex(indexStr);
    const c = faCompanies[Number(indexStr)];
    if (!c) return;
    setNameTh(c.nameTh);
    setTaxId(c.taxId);
    setBranch(c.branch || 'สำนักงานใหญ่');
    setAddress(c.address ?? '');
    setContactName(c.contactName ?? '');
    setContactPhone(c.contactPhone ?? '');
    setContactEmail(c.contactEmail ?? '');
    if (c.projectName) setProjectName(c.projectName);
    setFaContactId(c.flowaccountContactId);
    // ── ฟิลด์ที่ดึงเพิ่ม (5 ต.ค. 69 เจ้าของระบบสั่งให้ดึงจาก FlowAccount ให้ครบ) ──
    const notes: string[] = [];
    setZipCode(c.zipCode ?? '');
    setFaReference(c.reference ?? '');
    setQuotationDate(c.quotationDate ?? '');
    setPriceIncludesVat(Boolean(c.isVatInclusive));
    setSalesName(c.salesName ?? '');
    setRemarks(c.remarks ?? '');
    setInternalNotes(c.internalNotes ?? '');
    setFaTotals({ sub: c.subTotal ?? null, disc: c.discountAmount ?? null, grand: c.grandTotal ?? null });
    // เลข PO: "เลขที่อ้างอิง" ของ FlowAccount น่าจะเป็นเลข PO แต่มีค่าแค่บางใบและรูปแบบไม่เหมือนกัน — เติมให้เฉพาะตอนช่อง PO ยังว่าง
    // แล้วขึ้นข้อความให้ตรวจเทียบกับใบว่าจ้างก่อนบันทึกเสมอ (PO ผิดแล้วเสียหายกว่าช่องว่าง)
    if (c.reference && !poNo.trim()) {
      setPoNo(c.reference);
      setPoFromRef(true);
    } else {
      setPoFromRef(false);
    }
    // เครดิต/หัก ณ ที่จ่าย: FlowAccount ใส่ 0 เป็นค่าเริ่มต้นของใบเสนอราคาเกือบทุกใบ (ตรวจ 20 ใบ: เครดิต 0 อยู่ 13 ใบ, หัก ณ ที่จ่าย 0 ทั้ง 20 ใบ)
    // ซึ่งแปลว่า "ยังไม่ได้ตั้ง" มากกว่า "ไม่มีเครดิต/ไม่หัก" — ทับค่าเริ่มต้นของเราด้วย 0 จะทำให้วันครบกำหนด/ยอดหักผิดโดยไม่รู้ตัว
    // จึงเติมเฉพาะเมื่อมากกว่า 0 ส่วน 0 ใช้ค่าเริ่มต้นเดิมแล้วบอกให้รู้
    if (c.creditDays != null) {
      if (c.creditDays > 0) setCreditDays(String(c.creditDays));
      else notes.push(`${tx('FlowAccount ระบุเครดิต 0 วัน — ใช้ค่าเริ่มต้น')} ${creditDays} ${tx('วันไว้ แก้ได้ที่ช่อง "เครดิต"')}`);
    }
    if (c.vatPercent != null) setVat(String(c.vatPercent));
    if (c.withholdingPercent != null) {
      if (c.withholdingPercent > 0) setWht(String(c.withholdingPercent));
      else notes.push(`${tx('FlowAccount ไม่ได้ระบุหัก ณ ที่จ่าย — ใช้ค่าเริ่มต้น')} ${wht}% ${tx('ไว้ ตรวจให้ตรงกับสัญญา')}`);
    }
    if (c.isVatInclusive) notes.push(tx('⚠️ ใบเสนอราคานี้เป็นราคา "รวมภาษี" แต่ระบบคิดเงินแบบ "ไม่รวมภาษี" — ตรวจเรทต่อเดือนให้ตรงก่อนบันทึก'));
    setFaNotes(notes);
    // ข้อความหลังนี้เคยชวนไปเพิ่มพนักงานเองทีหลังจากแท็บ "พนักงาน" — ตัดออกแล้วเพราะแท็บนั้นไม่มีปุ่ม
    // เพิ่มพนักงานอีก (18 ก.ย. 69 ตามกติกาที่เจ้าของระบบยืนยัน: พนักงานเข้าระบบได้ทางเดียวคือผ่าน
    // ใบเสนอราคาที่ผูกกับสัญญาเท่านั้น) ถ้าใบเสนอราคาไม่มีรายชื่อ ทางแก้คือไปเพิ่มที่ต้นทางใน FlowAccount
    setFaHint(c.employees?.length ? `${tx('ดึงพนักงาน')} ${c.employees.length} ${tx('คน + เรทต่อเดือนจากใบเสนอราคานี้มาให้อัตโนมัติ')}` : tx('ใบเสนอราคานี้ไม่มีรายชื่อพนักงานให้ดึง — เพิ่มรายชื่อในใบเสนอราคาที่ FlowAccount ก่อน'));
  }

  async function save() {
    const nt = nameTh.trim();
    const ti = taxId.trim();
    const po = poNo.trim();
    const pn = projectName.trim();
    if (!nt || !ti) {
      setFieldErrors(new Set([!nt && 'nameTh', !ti && 'taxId'].filter(Boolean) as string[]));
      toast(tx('กรอกชื่อบริษัทและเลขผู้เสียภาษีให้ครบก่อน'), true);
      return;
    }
    // สัญญาไม่บังคับกรอกตอนสร้างบริษัทอีกต่อไป (createCustomer() เองก็ต้องการแค่ชื่อ+เลขผู้เสียภาษี
    // อยู่แล้ว) แต่ถ้าจะกรอกสัญญาด้วยก็ต้องครบทั้ง 4 ช่อง เพราะ createContract() ฝั่ง server ยัง
    // ต้องการครบเหมือนเดิม — ไม่แตะ validation นั้นเพราะมีเหตุผลของมันเอง (บิล/PO อ้างอิงฟิลด์พวกนี้)
    const hasAnyContractField = Boolean(po || pn || startDate || endDate);
    const hasAllContractFields = Boolean(po && pn && startDate && endDate);
    if (hasAnyContractField && !hasAllContractFields) {
      setFieldErrors(
        new Set([!po && 'poNo', !pn && 'projectName', !startDate && 'startDate', !endDate && 'endDate'].filter(Boolean) as string[]),
      );
      toast(tx('ถ้าจะเพิ่มสัญญาด้วยเลย ต้องกรอกเลขที่ใบว่าจ้าง ชื่อโครงการ และช่วงสัญญาให้ครบ — หรือเว้นว่างทั้งหมดไว้ก่อนแล้วเพิ่มสัญญาทีหลังก็ได้'), true);
      return;
    }
    setFieldErrors(new Set());
    setSaving(true);
    try {
      const customerRes = await fetch('/api/customers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          nameTh: nt,
          taxId: ti,
          branch: branch.trim() || undefined,
          address: address.trim() || null,
          zipCode: zipCode.trim() || null,
          creditDays: Number.isFinite(Number(creditDays)) && creditDays.trim() !== '' ? Number(creditDays) : 30,
          contactName: contactName.trim() || null,
          contactPhone: contactPhone.trim() || null,
          contactEmail: contactEmail.trim() || null,
          billingPlace: billingPlace.trim() || null,
          flowaccountContactId: faContactId || null,
        }),
      });
      const customer = await customerRes.json();
      if (!customerRes.ok) {
        toast(customer?.error ?? tx('สร้างบริษัทไม่สำเร็จ'), true);
        setSaving(false);
        return;
      }

      if (!hasAllContractFields) {
        // ยังไม่กรอกสัญญาเลย — สร้างแค่บริษัทไว้ก่อน ไปเพิ่มสัญญาทีหลังได้จากรายการ "บริษัทที่ยังไม่มี
        // สัญญา" ด้านบน (ดึงจาก GET /api/customers/without-contract)
        toast(`${tx('เพิ่มบริษัท')} "${nt}" ${tx('แล้ว — ยังไม่มีสัญญา เพิ่มสัญญาให้ทีหลังได้จากรายการ "บริษัทที่ยังไม่มีสัญญา" ด้านบน')}`);
        onSaved();
        return;
      }

      const contractRes = await fetch('/api/contracts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          customerId: customer.id,
          poNo: po,
          projectName: pn,
          contractNo: contractNo.trim() || null,
          divisorMode,
          divisorValue: Number(divisorValue) || 20,
          startDate,
          endDate,
          // เครดิตเดิมไม่เคยส่งไปกับสัญญาเลย (ใช้ค่าเริ่มต้น 30 ของฝั่ง server เสมอ) — ส่งค่าเดียวกับที่โชว์ในฟอร์ม
          creditDays: Number.isFinite(Number(creditDays)) && creditDays.trim() !== '' ? Number(creditDays) : 30,
          vatRate: (Number(vat) || 0) / 100,
          whtRate: (Number(wht) || 0) / 100,
          // ข้อมูลจากใบเสนอราคา FlowAccount (5 ต.ค. 69)
          faReference: faReference.trim() || null,
          quotationDate: quotationDate || null,
          priceIncludesVat,
          salesName: salesName.trim() || null,
          remarks: remarks.trim() || null,
          internalNotes: internalNotes.trim() || null,
          quotationSubTotal: faTotals.sub,
          quotationDiscount: faTotals.disc,
          quotationGrandTotal: faTotals.grand,
        }),
      });
      const contract = await contractRes.json();
      if (!contractRes.ok) {
        toast(contract?.error ?? tx('สร้างสัญญาไม่สำเร็จ'), true);
        setSaving(false);
        return;
      }

      const faCompany = faIndex ? faCompanies[Number(faIndex)] : null;
      let addedEmployees = 0;
      if (faCompany?.employees?.length) {
        for (const emp of faCompany.employees) {
          try {
            const empRes = await fetch('/api/employees', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                contractId: contract.id,
                nameTh: emp.nameTh,
                invoicePosition: emp.invoicePosition,
                monthlyRate: emp.monthlyRate,
                startDate,
                endDate,
                quotationNo: faCompany.quotationNo || null,
                quantity: emp.quantity ?? null,
                unitName: emp.unitName ?? null,
                fromFlowAccountSync: true,
              }),
            });
            if (!empRes.ok) {
              const empErr = await empRes.json();
              toast(`${tx('เพิ่มพนักงาน')} "${emp.nameTh}" ${tx('ไม่สำเร็จ')}: ${empErr?.error ?? tx('ผิดพลาด')}`, true);
              continue;
            }
            addedEmployees += 1;
          } catch {
            toast(`${tx('เพิ่มพนักงาน')} "${emp.nameTh}" ${tx('ไม่สำเร็จ')}`, true);
          }
        }
      }

      toast(addedEmployees ? `${tx('เพิ่ม')} "${nt}" ${tx('พร้อมพนักงาน')} ${addedEmployees} ${tx('คนแล้ว')}` : `${tx('เพิ่ม')} "${nt}"`);
      onSaved();
    } catch {
      toast(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'), true);
      setSaving(false);
    }
  }

  return (
    <Card
      title={tx('เพิ่มบริษัทใหม่')}
      right={<span className="rt">{tx('กรอกข้อมูลบริษัทและสัญญาแรกในคราวเดียว')}</span>}
      footer={
        <>
          <button className="btn" onClick={onCancel}>
            {tx('ยกเลิก')}
          </button>
          <button className="btn pri" disabled={saving} onClick={save}>
            {tx('บันทึกบริษัทใหม่')}
          </button>
        </>
      }
    >
      {faCompanies.length > 0 && (
        <div className="frm" style={{ marginBottom: 16 }}>
          <label>
            {tx('ดึงข้อมูลจาก FlowAccount')}
            <span className="selectchip grow">
              <select value={faIndex} onChange={(e) => onFromFaChange(e.target.value)}>
                <option value="">— {tx('เลือกบริษัทจากใบเสนอราคาที่มีอยู่แล้ว')} —</option>
                {faCompanies.map((c, i) => (
                  <option key={c.flowaccountContactId} value={i}>
                    {c.nameTh} ({c.quotationNo ?? '—'})
                  </option>
                ))}
              </select>
            </span>
          </label>
          <small className="fhint">{faHint}</small>
        </div>
      )}

      <div className="frm">
        <label>
          {tx('ชื่อบริษัท')}
          <input
            className={fieldErrors.has('nameTh') ? 'err' : undefined}
            value={nameTh}
            onChange={(e) => setNameTh(e.target.value)}
            placeholder="เช่น บริษัท ทดสอบ จำกัด"
          />
        </label>
        <label>
          {tx('เลขผู้เสียภาษี')}
          <input className={fieldErrors.has('taxId') ? 'err' : undefined} value={taxId} onChange={(e) => setTaxId(e.target.value)} />
        </label>
        <label>
          {tx('สาขา')}
          <input value={branch} onChange={(e) => setBranch(e.target.value)} />
        </label>
        <label>
          {tx('ที่อยู่')}
          <input value={address} onChange={(e) => setAddress(e.target.value)} />
        </label>
        <label>
          {tx('รหัสไปรษณีย์')}
          <input value={zipCode} onChange={(e) => setZipCode(e.target.value)} inputMode="numeric" />
        </label>
        <label>
          {tx('เครดิต (วัน)')}
          <input type="number" min={0} value={creditDays} onChange={(e) => setCreditDays(e.target.value)} />
        </label>
        <label>
          {tx('ผู้ประสานงาน')}
          <input value={contactName} onChange={(e) => setContactName(e.target.value)} />
        </label>
        <label>
          {tx('เบอร์ผู้ประสานงาน')}
          <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
        </label>
        <label>
          {tx('อีเมลผู้ประสานงาน')}
          <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
        </label>
        <label>
          {tx('สถานที่วางบิล')}
          <input value={billingPlace} onChange={(e) => setBillingPlace(e.target.value)} />
        </label>
      </div>

      <div className="fsec">
        <div className="fsec-h">
          <b>{tx('สัญญาแรก')}</b>
          <span style={{ fontSize: 12, color: 'var(--mut)' }}>{tx('ไม่บังคับ — เว้นว่างไว้ก่อนแล้วเพิ่มสัญญาทีหลังก็ได้')}</span>
        </div>
        <div className="frm">
          <label>
            {tx('เลขที่ใบว่าจ้าง (PO)')}
            <input
              className={fieldErrors.has('poNo') ? 'err' : undefined}
              value={poNo}
              placeholder="เช่น 26/B0200"
              onChange={(e) => { setPoNo(e.target.value); setPoFromRef(false); }}
            />
            {poFromRef && <small className="fhint" style={{ color: 'var(--wn)' }}>{tx('เติมจาก "เลขที่อ้างอิง" ของ FlowAccount — ตรวจให้ตรงกับใบว่าจ้างก่อนบันทึก')}</small>}
          </label>
          <label>
            {tx('เลขที่สัญญา')}
            <input value={contractNo} onChange={(e) => setContractNo(e.target.value)} />
          </label>
          <label>
            {tx('ชื่อโครงการ')}
            <input className={fieldErrors.has('projectName') ? 'err' : undefined} value={projectName} onChange={(e) => setProjectName(e.target.value)} />
          </label>
          <label>
            {tx('ตัวหารอัตราต่อวัน')}
            <span className="selectchip grow">
              <select value={divisorMode} onChange={(e) => setDivisorMode(e.target.value)}>
                <option value="fixed">{tx('คงที่ (ระบุจำนวนวัน)')}</option>
                <option value="actual_working_days">{tx('วันทำงานจริงของเดือน')}</option>
              </select>
            </span>
          </label>
          <label>
            {tx('จำนวนวัน (ถ้าคงที่)')}
            <input type="number" min={1} value={divisorValue} onChange={(e) => setDivisorValue(e.target.value)} />
          </label>
          <label>
            {tx('วันเริ่มสัญญา')}
            <DatePicker
              value={startDate}
              onChange={setStartDate}
              className={fieldErrors.has('startDate') ? 'err' : undefined}
              />
          </label>
          <label>
            {tx('วันสิ้นสุดสัญญา')}
            <DatePicker
              value={endDate}
              onChange={setEndDate}
              className={fieldErrors.has('endDate') ? 'err' : undefined}
              />
          </label>
          <label>
            VAT (%)
            <input type="number" min={0} max={100} step={0.1} value={vat} onChange={(e) => setVat(e.target.value)} />
          </label>
          <label>
            {tx('หัก ณ ที่จ่าย (%)')}
            <input type="number" min={0} max={100} step={0.1} value={wht} onChange={(e) => setWht(e.target.value)} />
          </label>
        </div>
        <small className="fhint">{tx('พนักงาน/อัตราจ้างของบริษัทรายนี้ดึงมาจากใบเสนอราคาใน FlowAccount อัตโนมัติ — แก้ไขทีหลังได้จากแท็บ "พนักงาน"')}</small>
      </div>

      {faIndex !== '' && (
        <div className="fsec">
          <div className="fsec-h">
            <b>{tx('ข้อมูลจากใบเสนอราคา FlowAccount')}</b>
            <span style={{ fontSize: 12, color: 'var(--mut)' }}>{tx('ดึงมาให้อัตโนมัติ — แก้ไขได้ก่อนบันทึก')}</span>
          </div>
          {faNotes.length > 0 && (
            <div className="note wn" style={{ marginBottom: 12 }}>
              <Icon name="alt" />
              <span>{faNotes.join(' · ')}</span>
            </div>
          )}
          <div className="frm">
            <label>
              {tx('เลขที่อ้างอิง')}
              <input value={faReference} onChange={(e) => setFaReference(e.target.value)} />
            </label>
            <label>
              {tx('วันที่ใบเสนอราคา')}
              <DatePicker value={quotationDate} onChange={setQuotationDate} />
            </label>
            <label>
              {tx('ราคา')}
              <span className="selectchip grow">
                <select value={priceIncludesVat ? 'inc' : 'exc'} onChange={(e) => setPriceIncludesVat(e.target.value === 'inc')}>
                  <option value="exc">{tx('ราคาไม่รวมภาษี')}</option>
                  <option value="inc">{tx('ราคารวมภาษี')}</option>
                </select>
              </span>
            </label>
            <label>
              {tx('พนักงานขาย')}
              <input value={salesName} onChange={(e) => setSalesName(e.target.value)} />
            </label>
            <label>
              {tx('หมายเหตุ')}
              <input value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </label>
            <label>
              {tx('บันทึกภายใน')}
              <input value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} />
            </label>
            <label>
              {tx('ยอดก่อนส่วนลด (อ่านอย่างเดียว)')}
              <input value={faTotals.sub != null ? faTotals.sub.toLocaleString('en-US', { minimumFractionDigits: 2 }) : '—'} readOnly />
            </label>
            <label>
              {tx('ยอดรวมทั้งสิ้น (อ่านอย่างเดียว)')}
              <input value={faTotals.grand != null ? faTotals.grand.toLocaleString('en-US', { minimumFractionDigits: 2 }) : '—'} readOnly />
            </label>
          </div>
        </div>
      )}

    </Card>
  );
}

/** ฟอร์ม "เพิ่มสัญญา" ให้บริษัทที่มีอยู่แล้วแต่ยังไม่มีสัญญาเลย (มาจาก CustomerAddForm ที่แยกขั้นตอนไว้
 * ให้เว้นสัญญาว่างไว้ก่อนได้) validation ฝั่งนี้ครบทุกช่องเหมือน createContract() ฝั่ง server เดิม
 * ไม่ได้ผ่อนอะไรลง แค่แยกเวลากรอกออกจากตอนสร้างบริษัทเท่านั้น */
function AddContractForm({ customer, onCancel, onSaved }: { customer: CustomerWithoutContract; onCancel: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { tx } = useLang();
  const [poNo, setPoNo] = useState('');
  const [contractNo, setContractNo] = useState('');
  const [projectName, setProjectName] = useState('');
  const [divisorMode, setDivisorMode] = useState('fixed');
  const [divisorValue, setDivisorValue] = useState('20');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [vat, setVat] = useState('7');
  const [wht, setWht] = useState('3');
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Set<string>>(new Set());

  async function save() {
    const po = poNo.trim();
    const pn = projectName.trim();
    if (!po || !pn || !startDate || !endDate) {
      setFieldErrors(
        new Set([!po && 'poNo', !pn && 'projectName', !startDate && 'startDate', !endDate && 'endDate'].filter(Boolean) as string[]),
      );
      toast(tx('กรอกเลขที่ใบว่าจ้าง ชื่อโครงการ และช่วงสัญญาให้ครบก่อน'), true);
      return;
    }
    setFieldErrors(new Set());
    setSaving(true);
    try {
      const res = await fetch('/api/contracts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          customerId: customer.id,
          poNo: po,
          projectName: pn,
          contractNo: contractNo.trim() || null,
          divisorMode,
          divisorValue: Number(divisorValue) || 20,
          startDate,
          endDate,
          vatRate: (Number(vat) || 0) / 100,
          whtRate: (Number(wht) || 0) / 100,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data?.error ?? tx('สร้างสัญญาไม่สำเร็จ'), true);
        setSaving(false);
        return;
      }
      toast(`${tx('เพิ่มสัญญาให้')} "${customer.nameTh}" ${tx('แล้ว')}`);
      onSaved();
    } catch {
      toast(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'), true);
      setSaving(false);
    }
  }

  return (
    <Card
      title={tx('เพิ่มสัญญา')}
      right={<span className="rt">{customer.nameTh}</span>}
      footer={
        <>
          <button className="btn" onClick={onCancel}>
            {tx('ยกเลิก')}
          </button>
          <button className="btn pri" disabled={saving} onClick={save}>
            {tx('บันทึก')}
          </button>
        </>
      }
    >
      <div className="frm">
        <label>
          {tx('เลขที่ใบว่าจ้าง (PO)')}
          <input
            className={fieldErrors.has('poNo') ? 'err' : undefined}
            value={poNo}
            onChange={(e) => setPoNo(e.target.value)}
            placeholder="เช่น 26/B0200"
          />
        </label>
        <label>
          {tx('เลขที่สัญญา')}
          <input value={contractNo} onChange={(e) => setContractNo(e.target.value)} />
        </label>
        <label>
          {tx('ชื่อโครงการ')}
          <input className={fieldErrors.has('projectName') ? 'err' : undefined} value={projectName} onChange={(e) => setProjectName(e.target.value)} />
        </label>
        <label>
          {tx('ตัวหารอัตราต่อวัน')}
          <span className="selectchip grow">
            <select value={divisorMode} onChange={(e) => setDivisorMode(e.target.value)}>
              <option value="fixed">{tx('คงที่ (ระบุจำนวนวัน)')}</option>
              <option value="actual_working_days">{tx('วันทำงานจริงของเดือน')}</option>
            </select>
          </span>
        </label>
        <label>
          {tx('จำนวนวัน (ถ้าคงที่)')}
          <input type="number" min={1} value={divisorValue} onChange={(e) => setDivisorValue(e.target.value)} />
        </label>
        <label>
          {tx('วันเริ่มสัญญา')}
          <DatePicker
            value={startDate}
            onChange={setStartDate}
            className={fieldErrors.has('startDate') ? 'err' : undefined}
            />
        </label>
        <label>
          {tx('วันสิ้นสุดสัญญา')}
          <DatePicker
            value={endDate}
            onChange={setEndDate}
            className={fieldErrors.has('endDate') ? 'err' : undefined}
            />
        </label>
        <label>
          VAT (%)
          <input type="number" min={0} max={100} step={0.1} value={vat} onChange={(e) => setVat(e.target.value)} />
        </label>
        <label>
          {tx('หัก ณ ที่จ่าย (%)')}
          <input type="number" min={0} max={100} step={0.1} value={wht} onChange={(e) => setWht(e.target.value)} />
        </label>
      </div>
      <small className="fhint">{tx('พนักงาน/อัตราจ้างของบริษัทรายนี้ดึงมาจากใบเสนอราคาใน FlowAccount อัตโนมัติ — แก้ไขทีหลังได้จากแท็บ "พนักงาน"')}</small>
    </Card>
  );
}

/** ฟอร์ม "แก้ไขข้อมูลสัญญา" — แก้ทั้งบริษัท+สัญญาในคราวเดียว (มาแทนที่การ์ดของสัญญานั้นเลยในหน้า) */
function ContractEditForm({ contract, onCancel, onSaved }: { contract: ContractRow; onCancel: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { tx } = useLang();
  const [customerNameTh, setCustomerNameTh] = useState(contract.customerName);
  const [taxId, setTaxId] = useState(contract.taxId);
  const [contactName, setContactName] = useState(contract.contactName ?? '');
  const [contactPhone, setContactPhone] = useState(contract.contactPhone ?? '');
  const [billingPlace, setBillingPlace] = useState(contract.billingPlace ?? '');

  const [poNo, setPoNo] = useState(contract.poNo);
  const [contractNo, setContractNo] = useState(contract.contractNo ?? '');
  const [projectName, setProjectName] = useState(contract.projectName);
  const [divisorMode, setDivisorMode] = useState(contract.divisorMode);
  const [divisorValue, setDivisorValue] = useState(String(contract.divisorValue));
  const [startDate, setStartDate] = useState(contract.startDate);
  const [endDate, setEndDate] = useState(contract.endDate);
  const [vat, setVat] = useState(String(Math.round(contract.vatRate * 100)));
  const [wht, setWht] = useState(String(Math.round(contract.whtRate * 100)));
  const [creditDays, setCreditDays] = useState(String(contract.creditDays));
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Set<string>>(new Set());

  async function save() {
    const cnt = customerNameTh.trim();
    const ti = taxId.trim();
    const po = poNo.trim();
    const pn = projectName.trim();
    if (!cnt || !ti || !po || !pn || !startDate || !endDate) {
      setFieldErrors(
        new Set(
          [!cnt && 'customerNameTh', !ti && 'taxId', !po && 'poNo', !pn && 'projectName', !startDate && 'startDate', !endDate && 'endDate'].filter(
            Boolean,
          ) as string[],
        ),
      );
      toast(tx('กรอกชื่อบริษัท เลขผู้เสียภาษี เลขที่ใบว่าจ้าง ชื่อโครงการ และช่วงสัญญาให้ครบก่อน'), true);
      return;
    }
    setFieldErrors(new Set());
    setSaving(true);
    try {
      const res = await fetch(`/api/contracts/${encodeURIComponent(contract.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          customerNameTh: cnt,
          taxId: ti,
          poNo: po,
          projectName: pn,
          startDate,
          endDate,
          contractNo: contractNo.trim() || null,
          divisorMode,
          divisorValue: Number(divisorValue) || 20,
          vatRate: (Number(vat) || 0) / 100,
          whtRate: (Number(wht) || 0) / 100,
          creditDays: Number(creditDays) || 30,
          contactName: contactName.trim() || null,
          contactPhone: contactPhone.trim() || null,
          billingPlace: billingPlace.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data?.error ?? tx('บันทึกไม่สำเร็จ'), true);
        setSaving(false);
        return;
      }
      toast(`${tx('บันทึกการแก้ไข')} "${cnt}"`);
      onSaved();
    } catch {
      toast(tx('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'), true);
      setSaving(false);
    }
  }

  return (
    <Card
      title={tx('แก้ไขข้อมูลสัญญา')}
      right={
        <span className="rt">
          {contract.poNo} — {contract.projectName}
        </span>
      }
      footer={
        <>
          <button className="btn" onClick={onCancel}>
            {tx('ยกเลิก')}
          </button>
          <button className="btn pri" disabled={saving} onClick={save}>
            {tx('บันทึกการแก้ไข')}
          </button>
        </>
      }
    >
      <div className="frm">
        <label>
          {tx('ชื่อบริษัท')}
          <input className={fieldErrors.has('customerNameTh') ? 'err' : undefined} value={customerNameTh} onChange={(e) => setCustomerNameTh(e.target.value)} />
        </label>
        <label>
          {tx('เลขผู้เสียภาษี')}
          <input className={fieldErrors.has('taxId') ? 'err' : undefined} value={taxId} onChange={(e) => setTaxId(e.target.value)} />
        </label>
        <label>
          {tx('ผู้ประสานงาน')}
          <input value={contactName} onChange={(e) => setContactName(e.target.value)} />
        </label>
        <label>
          {tx('เบอร์ผู้ประสานงาน')}
          <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
        </label>
        <label>
          {tx('สถานที่วางบิล')}
          <input value={billingPlace} onChange={(e) => setBillingPlace(e.target.value)} />
        </label>
      </div>

      <div className="fsec">
        <div className="fsec-h">
          <b>{tx('ข้อมูลสัญญา')}</b>
        </div>
        <div className="frm">
          <label>
            {tx('เลขที่ใบว่าจ้าง (PO)')}
            <input className={fieldErrors.has('poNo') ? 'err' : undefined} value={poNo} onChange={(e) => setPoNo(e.target.value)} />
          </label>
          <label>
            {tx('เลขที่สัญญา')}
            <input value={contractNo} onChange={(e) => setContractNo(e.target.value)} />
          </label>
          <label>
            {tx('ชื่อโครงการ')}
            <input className={fieldErrors.has('projectName') ? 'err' : undefined} value={projectName} onChange={(e) => setProjectName(e.target.value)} />
          </label>
          <label>
            {tx('ตัวหารอัตราต่อวัน')}
            <span className="selectchip grow">
              <select value={divisorMode} onChange={(e) => setDivisorMode(e.target.value)}>
                <option value="fixed">{tx('คงที่ (ระบุจำนวนวัน)')}</option>
                <option value="actual_working_days">{tx('วันทำงานจริงของเดือน')}</option>
              </select>
            </span>
          </label>
          <label>
            {tx('จำนวนวัน (ถ้าคงที่)')}
            <input type="number" min={1} value={divisorValue} onChange={(e) => setDivisorValue(e.target.value)} />
          </label>
          <label>
            {tx('วันเริ่มสัญญา')}
            <DatePicker
              value={startDate}
              onChange={setStartDate}
              className={fieldErrors.has('startDate') ? 'err' : undefined}
              />
          </label>
          <label>
            {tx('วันสิ้นสุดสัญญา')}
            <DatePicker
              value={endDate}
              onChange={setEndDate}
              className={fieldErrors.has('endDate') ? 'err' : undefined}
              />
          </label>
          <label>
            VAT (%)
            <input type="number" min={0} max={100} step={0.1} value={vat} onChange={(e) => setVat(e.target.value)} />
          </label>
          <label>
            {tx('หัก ณ ที่จ่าย (%)')}
            <input type="number" min={0} max={100} step={0.1} value={wht} onChange={(e) => setWht(e.target.value)} />
          </label>
          <label>
            {tx('เครดิต (วัน)')}
            <input type="number" min={0} value={creditDays} onChange={(e) => setCreditDays(e.target.value)} />
          </label>
        </div>
      </div>

    </Card>
  );
}
